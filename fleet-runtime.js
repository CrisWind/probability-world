/* 概率世界 · 商会船队风险盘 V0.1 —— 运行时（状态机 + 存档 + 事件）
 * 职责边界：
 *  - 唯一的 fleet 状态持有者（读写 store.world.fleet，不新建持久化入口）；
 *  - 管理 campaign 生命周期：开始、分配、结算、归档；
 *  - 不解锁成就、不完成任务、不发奖励、不碰承保/风闻/质检结果；
 *  - UI（fleet-ui.js）只调用这里的方法并渲染返回值。 */
(function attachFleetRuntime(global) {
  'use strict';

  var store = function() { return global.__gameStore; };
  var bus = function() { return global.GameEventBus; };
  var config = function() { return global.FLEET_CONFIG; };
  var model = function() { return global.FleetModel; };

  var NAMESPACE_DEFAULT = function() { return { version: 1, activeCampaign: null, archivedCampaigns: [] }; };

  function readNamespace() {
    var gs = store();
    var ns = gs && gs.get && gs.get('world.fleet');
    if (ns && typeof ns === 'object' && ns.version) {
      return {
        version: Number(ns.version) || 1,
        activeCampaign: ns.activeCampaign || null,
        archivedCampaigns: Array.isArray(ns.archivedCampaigns) ? ns.archivedCampaigns : []
      };
    }
    return NAMESPACE_DEFAULT();
  }

  function writeNamespace(ns) {
    store() && store().set && store().set('world.fleet', ns);
    store() && store().save && store().save();
  }

  function emit(type, payload) {
    bus() && bus().emit && bus().emit({ type: type, payload: payload });
  }

  function newCampaignId() {
    return 'flt-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xffffff).toString(36);
  }

  function newSeed() {
    return 'fleet-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xffffff).toString(36);
  }

  /* ---- Campaign 生命周期 ---- */

  function startCampaign() {
    var ns = readNamespace();
    if (ns.activeCampaign && ns.activeCampaign.phase !== 'completed') {
      return { ok: false, reason: 'campaign-in-progress', campaign: ns.activeCampaign };
    }

    var cfg = config();
    var campaignId = newCampaignId();
    var seed = newSeed();

    var batchIds = [];
    var vessels = cfg.vessels;
    for (var i = 0; i < vessels.length; i++) {
      if (batchIds.indexOf(vessels[i].batchId) === -1) batchIds.push(vessels[i].batchId);
    }

    var commonRiskState = model().deriveCommonRiskState(seed, batchIds);

    var assignments = {};
    for (var j = 0; j < vessels.length; j++) {
      assignments[vessels[j].shipId] = vessels[j].defaultRouteId;
    }

    var campaign = {
      campaignId: campaignId,
      seed: seed,
      currentRound: 1,
      totalRounds: cfg.campaign.totalRounds,
      phase: 'planning',
      operatingCash: cfg.capital.startingCash,
      reserve: cfg.capital.startingReserve,
      reinsuranceActive: false,
      assignments: assignments,
      commonRiskState: commonRiskState,
      rounds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    ns.activeCampaign = campaign;
    writeNamespace(ns);
    return { ok: true, campaign: campaign };
  }

  function getCampaign() {
    return readNamespace().activeCampaign;
  }

  /* ---- 回合内操作 ---- */

  function setAssignment(shipId, routeId) {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };

    if (routeId !== null) {
      var route = model().findRoute(routeId);
      if (!route) return { ok: false, reason: 'invalid-route' };
    }

    var vessel = model().findVessel(shipId);
    if (!vessel) return { ok: false, reason: 'invalid-ship' };

    camp.assignments[shipId] = routeId;
    camp.updatedAt = new Date().toISOString();
    ns.activeCampaign = camp;
    writeNamespace(ns);
    return { ok: true, assignments: camp.assignments };
  }

  function setReserve(amount) {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };

    var capCfg = config().capital;
    var totalFunds = camp.operatingCash + camp.reserve;
    var newReserve = Math.max(0, Math.min(capCfg.reserveMax, Math.round(amount)));
    var newCash = totalFunds - newReserve;

    if (newCash < 0) {
      newCash = 0;
      newReserve = totalFunds;
    }

    camp.operatingCash = Math.round(newCash * 100) / 100;
    camp.reserve = Math.round(newReserve * 100) / 100;
    camp.updatedAt = new Date().toISOString();
    ns.activeCampaign = camp;
    writeNamespace(ns);
    return { ok: true, operatingCash: camp.operatingCash, reserve: camp.reserve };
  }

  function setReinsurance(active) {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };

    camp.reinsuranceActive = !!active;
    camp.updatedAt = new Date().toISOString();
    ns.activeCampaign = camp;
    writeNamespace(ns);
    return { ok: true, reinsuranceActive: camp.reinsuranceActive };
  }

  function getExpected() {
    var camp = readNamespace().activeCampaign;
    if (!camp || camp.phase !== 'planning') return null;
    return model().expectedRound(camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound);
  }

  /* ---- 提交方案 & 结算 ---- */

  function submitPlan() {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };

    emit('fleet_plan_submitted', {
      campaignId: camp.campaignId,
      round: camp.currentRound,
      assignments: Object.assign({}, camp.assignments),
      reserve: camp.reserve,
      reinsuranceActive: camp.reinsuranceActive
    });

    var roundResult = model().resolveRound(camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound);

    if (roundResult.storms && roundResult.storms.length > 0) {
      emit('fleet_storm_triggered', {
        campaignId: camp.campaignId,
        round: camp.currentRound,
        storms: roundResult.storms.map(function(s) { return { routeId: s.routeId, severity: s.severity }; })
      });
    }

    var riCfg = config().reinsurance;
    var actualReinsuranceCost = camp.reinsuranceActive ? roundResult.totals.reinsuranceCost : 0;
    var actualReinsuranceRecovery = camp.reinsuranceActive ? roundResult.totals.reinsuranceRecovery : 0;

    var adjustedNetProfit = roundResult.totals.voyageIncome
      - roundResult.totals.cargoLoss
      + actualReinsuranceRecovery
      - actualReinsuranceCost;
    adjustedNetProfit = Math.round(adjustedNetProfit * 100) / 100;

    roundResult.totals.reinsuranceCost = actualReinsuranceCost;
    roundResult.totals.reinsuranceRecovery = actualReinsuranceRecovery;
    roundResult.totals.netProfit = adjustedNetProfit;

    roundResult.reserve = camp.reserve;
    roundResult.reinsuranceActive = camp.reinsuranceActive;

    var operatingCashBefore = camp.operatingCash;
    var reserveBefore = camp.reserve;
    var totalFundsBefore = Math.round((operatingCashBefore + reserveBefore) * 100) / 100;

    var reserveResult = model().applyReserve(operatingCashBefore, reserveBefore, adjustedNetProfit);

    roundResult.operatingCashBefore = operatingCashBefore;
    roundResult.operatingCashAfter = reserveResult.operatingCashAfter;
    roundResult.reserveBefore = reserveBefore;
    roundResult.reserveUsed = reserveResult.reserveUsed;
    roundResult.reserveAfter = reserveResult.reserveAfter;
    roundResult.totalFundsBefore = totalFundsBefore;
    roundResult.totalFundsAfter = Math.round((reserveResult.operatingCashAfter + reserveResult.reserveAfter) * 100) / 100;
    roundResult.insolvent = reserveResult.insolvent;

    camp.rounds.push(roundResult);
    camp.operatingCash = reserveResult.operatingCashAfter;
    camp.reserve = reserveResult.reserveAfter;

    var expected = model().expectedRound(camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound);
    roundResult.totals.expectedVoyageIncome = expected.expectedVoyageIncome;
    roundResult.totals.expectedNetProfit = expected.expectedNetProfit;

    if (reserveResult.insolvent) {
      camp.phase = 'insolvent';
      emit('fleet_insolvent', {
        campaignId: camp.campaignId,
        round: camp.currentRound,
        operatingCashAfter: reserveResult.operatingCashAfter,
        reserveAfter: reserveResult.reserveAfter,
        totalFundsAfter: roundResult.totalFundsAfter
      });
    } else if (camp.currentRound >= camp.totalRounds) {
      camp.phase = 'completed';
      emit('fleet_campaign_completed', {
        campaignId: camp.campaignId,
        totalRounds: camp.totalRounds,
        finalOperatingCash: camp.operatingCash,
        finalReserve: camp.reserve,
        finalTotalFunds: roundResult.totalFundsAfter
      });
    } else {
      camp.currentRound++;
      camp.phase = 'planning';
    }

    camp.updatedAt = new Date().toISOString();
    ns.activeCampaign = camp;
    writeNamespace(ns);

    emit('fleet_round_settled', {
      campaignId: camp.campaignId,
      round: roundResult.round,
      voyageIncome: roundResult.totals.voyageIncome,
      cargoLoss: roundResult.totals.cargoLoss,
      reinsuranceCost: roundResult.totals.reinsuranceCost,
      reinsuranceRecovery: roundResult.totals.reinsuranceRecovery,
      netProfit: roundResult.totals.netProfit,
      operatingCashAfter: roundResult.operatingCashAfter,
      reserveAfter: roundResult.reserveAfter,
      totalFundsAfter: roundResult.totalFundsAfter,
      storms: roundResult.storms.map(function(s) { return s.routeId; }),
      batchDefects: roundResult.batchDefects,
      insolvent: roundResult.insolvent
    });

    return { ok: true, roundResult: roundResult, campaign: camp };
  }

  /* ---- 放弃 campaign（归档，不删除） ---- */

  function abandonCampaign() {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp) return { ok: false, reason: 'no-active-campaign' };

    var lastRound = camp.rounds.length > 0 ? camp.rounds[camp.rounds.length - 1] : null;
    var archived = {
      campaignId: camp.campaignId,
      seed: camp.seed,
      outcome: 'abandoned',
      totalRounds: camp.totalRounds,
      roundsSettled: camp.rounds.length,
      finalOperatingCash: camp.operatingCash,
      finalReserve: camp.reserve,
      finalTotalFunds: Math.round((camp.operatingCash + camp.reserve) * 100) / 100,
      stormsEncountered: countStorms(camp.rounds),
      totalCargoLoss: sumCargoLoss(camp.rounds),
      abandonedAtRound: camp.currentRound,
      completedAt: new Date().toISOString()
    };

    ns.archivedCampaigns.push(archived);
    ns.activeCampaign = null;
    writeNamespace(ns);
    return { ok: true, archived: archived };
  }

  function countStorms(rounds) {
    var count = 0;
    for (var i = 0; i < rounds.length; i++) {
      count += (rounds[i].storms || []).length;
    }
    return count;
  }

  function sumCargoLoss(rounds) {
    var total = 0;
    for (var i = 0; i < rounds.length; i++) {
      total += (rounds[i].totals && rounds[i].totals.cargoLoss) || 0;
    }
    return Math.round(total * 100) / 100;
  }

  function listArchived() {
    return readNamespace().archivedCampaigns;
  }

  /* ---- 导出 ---- */

  global.FleetRuntime = Object.freeze({
    startCampaign: startCampaign,
    getCampaign: getCampaign,
    setAssignment: setAssignment,
    setReserve: setReserve,
    setReinsurance: setReinsurance,
    getExpected: getExpected,
    submitPlan: submitPlan,
    abandonCampaign: abandonCampaign,
    listArchived: listArchived
  });
})(typeof window !== 'undefined' ? window : globalThis);
