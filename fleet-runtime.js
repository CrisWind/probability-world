/* 概率世界 · 商会船队风险盘 V0.2 —— 运行时（状态机 + 存档 + 事件）
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
  var adapter = function() { return global.FleetInputAdapter; };
  var learning = function() { return global.FleetLearning; };
  var samplingLearning = function() { return global.SamplingLearning; };

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

  function nowISO() { return new Date().toISOString(); }

  /* ---- Campaign 生命周期 ---- */

  function startCampaign(options) {
    var ns = readNamespace();
    var camp = ns.activeCampaign;

    /* 有 planning 状态的 activeCampaign 时恢复，不重置 */
    if (camp && camp.phase === 'planning') {
      return { ok: true, campaign: camp, resumed: true };
    }
    /* 有 completed/insolvent campaign 时先归档 */
    if (camp && (camp.phase === 'completed' || camp.phase === 'insolvent')) {
      archiveActiveCampaign();
    }

    /* 有非 completed/insolvent/abandoned 的 campaign 时拒绝 */
    if (camp && camp.phase !== 'completed' && camp.phase !== 'insolvent') {
      return { ok: false, reason: 'campaign-in-progress', campaign: camp };
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
      operatingCash: cfg.capital.startingOperatingCash,
      reserve: cfg.capital.startingReserve,
      assignments: assignments,
      commonRiskState: commonRiskState,
      rounds: [],
      createdAt: nowISO(),
      updatedAt: nowISO()
    };

    /* Step 3: capture input snapshot from external systems */
    var inputAdapter = adapter();
    if (inputAdapter && inputAdapter.buildCampaignInputSnapshot) {
      campaign.inputSnapshot = inputAdapter.buildCampaignInputSnapshot();
    }

    /* QA 迁移：从快照派生质检效果（只存最小事实 + 引用 reportId，不复制报告本体）；
     * 暂停出航（hold）的船第 1 回合强制留港，下一回合起可重新安排 */
    var qaEffects = [];
    if (campaign.inputSnapshot && inputAdapter && inputAdapter.getShipyardEffects) {
      qaEffects = inputAdapter.getShipyardEffects(campaign.inputSnapshot) || [];
    }
    if (qaEffects.length > 0) {
      for (var qe = 0; qe < qaEffects.length; qe++) {
        if (qaEffects[qe].holdRound1) campaign.assignments[qaEffects[qe].shipId] = null;
      }
      campaign.shipyardEffects = qaEffects;
    }

    ns.activeCampaign = campaign;
    writeNamespace(ns);
    return { ok: true, campaign: campaign, resumed: false };
  }

  function getCampaign() {
    return readNamespace().activeCampaign;
  }

  /* ---- 回合内操作 ---- */

  function setAssignment(shipId, routeIdOrNull) {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };

    if (routeIdOrNull !== null) {
      var route = model().findRoute(routeIdOrNull);
      if (!route) return { ok: false, reason: 'invalid-route' };
    }

    var vessel = model().findVessel(shipId);
    if (!vessel) return { ok: false, reason: 'invalid-ship' };

    /* QA hold：第 1 回合该船不能出航（自动留港），第 2 回合起可重新安排 */
    var qaHold = Array.isArray(camp.shipyardEffects) ? camp.shipyardEffects : [];
    for (var qh = 0; qh < qaHold.length; qh++) {
      if (qaHold[qh].shipId === shipId && qaHold[qh].holdRound1 && camp.currentRound === 1 && routeIdOrNull !== null) {
        return { ok: false, reason: 'qa-hold-round-1' };
      }
    }

    camp.assignments[shipId] = routeIdOrNull;
    camp.updatedAt = nowISO();
    ns.activeCampaign = camp;
    writeNamespace(ns);
    return { ok: true, assignments: camp.assignments };
  }

  function setReserve(amount) {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };

    var capCfg = config().capital;
    var step = capCfg.reserveStep;
    var maxR = capCfg.maxReserve;

    /* 必须按 step 递增 */
    if (typeof amount !== 'number' || amount < 0 || amount > maxR) {
      return { ok: false, reason: 'out-of-range' };
    }
    if (amount % step !== 0) {
      return { ok: false, reason: 'invalid-step' };
    }

    var totalFunds = camp.operatingCash + camp.reserve;
    var newReserve = amount;
    var newCash = totalFunds - newReserve;

    if (newCash < 0) {
      return { ok: false, reason: 'exceeds-total-funds' };
    }

    camp.operatingCash = Math.round(newCash * 100) / 100;
    camp.reserve = Math.round(newReserve * 100) / 100;
    camp.updatedAt = nowISO();
    ns.activeCampaign = camp;
    writeNamespace(ns);
    return { ok: true, operatingCash: camp.operatingCash, reserve: camp.reserve };
  }

  /* 再保险始终生效，保留接口兼容 */
  function setReinsurance() {
    return { ok: true, alwaysActive: true };
  }

  /* 质检效果（qaMods）：快照在 campaign 开始时固定；hold 的第 1 回合由 assignments=null 表达，不参与概率 */
  function qaModsForRound(camp, round) {
    var map = null;
    var effects = camp && Array.isArray(camp.shipyardEffects) ? camp.shipyardEffects : [];
    for (var i = 0; i < effects.length; i++) {
      var e = effects[i];
      var mod = null;
      if (!(e.holdRound1 && round === 1)) mod = e.qaMod;
      if (typeof mod === 'number' && mod !== 1) {
        if (!map) map = {};
        map[e.shipId] = mod;
      }
    }
    return map;
  }

  function getExpected() {
    var camp = readNamespace().activeCampaign;
    if (!camp || camp.phase !== 'planning') return null;
    return model().expectedRound(camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound, qaModsForRound(camp, camp.currentRound));
  }

  /* ---- 提交方案 & 结算 ---- */

  function submitPlan() {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };
    if (camp.phase === 'completed' || camp.phase === 'insolvent' || camp.phase === 'abandoned') {
      return { ok: false, reason: 'campaign-ended', phase: camp.phase };
    }

    /* 校验 assignments 合法 */
    var cfg = config();
    var vessels = cfg.vessels;
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var routeId = camp.assignments[v.shipId];
      if (routeId !== null && routeId !== undefined) {
        if (!model().findRoute(routeId)) {
          return { ok: false, reason: 'invalid-assignment', shipId: v.shipId };
        }
      }
    }

    /* 校验 reserve 合法 */
    var capCfg = cfg.capital;
    if (camp.reserve < 0 || camp.reserve > capCfg.maxReserve || camp.reserve % capCfg.reserveStep !== 0) {
      return { ok: false, reason: 'invalid-reserve' };
    }

    /* QA hold 兜底校验：第 1 回合该船必须留港 */
    var qaSubmit = Array.isArray(camp.shipyardEffects) ? camp.shipyardEffects : [];
    for (var qs = 0; qs < qaSubmit.length; qs++) {
      if (qaSubmit[qs].holdRound1 && camp.currentRound === 1) {
        var heldRoute = camp.assignments[qaSubmit[qs].shipId];
        if (heldRoute !== null && heldRoute !== undefined) {
          return { ok: false, reason: 'qa-hold-round-1', shipId: qaSubmit[qs].shipId };
        }
      }
    }

    /* 学习证据（applied）：上一轮存在共同风险回放且本轮真实调整了方案才记录 */
    var flLearning = learning();
    if (flLearning && camp.rounds.length > 0) {
      var prevRoundRes = camp.rounds[camp.rounds.length - 1];
      if (prevRoundRes && flLearning.analyzeRound(prevRoundRes).length > 0) {
        var strategyChanges = flLearning.planChanges(
          prevRoundRes.assignments || {}, camp.assignments,
          typeof prevRoundRes.reserveAfter === 'number' ? prevRoundRes.reserveAfter : camp.reserve,
          camp.reserve
        );
        if (strategyChanges.length > 0) flLearning.recordApplied(camp, prevRoundRes.round, strategyChanges);
      }
    }

    var funds = { operatingCash: camp.operatingCash, reserve: camp.reserve };

    /* 学习证据（sampling_representativeness 应用/迁移）：快照带质检效果时，本轮相对上一回合的调整
     * 涉及质检船或其同批次船/准备金才记录；不伪造无调整时的进展 */
    var sLearn = samplingLearning();
    if (sLearn && camp.rounds.length > 0 && Array.isArray(camp.shipyardEffects) && camp.shipyardEffects.length > 0) {
      var qaPrevRound = camp.rounds[camp.rounds.length - 1];
      if (qaPrevRound) {
        var qaChanges = sLearn.fleetAdjustmentChanges(camp, qaPrevRound, camp.assignments, camp.reserve);
        if (qaChanges.length > 0) {
          sLearn.recordFleetApplication(camp, qaChanges, camp.shipyardEffects[0].sourceReportId);
        }
      }
    }

    emit('fleet_plan_submitted', {
      round: camp.currentRound,
      campaignId: camp.campaignId,
      assignments: Object.assign({}, camp.assignments),
      operatingCash: camp.operatingCash,
      reserve: camp.reserve
    });

    /* 调用纯模型结算 */
    var roundResult = model().resolveRound(
      camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound, funds,
      qaModsForRound(camp, camp.currentRound)
    );

    if (roundResult.storms && roundResult.storms.length > 0) {
      emit('fleet_storm_triggered', {
        campaignId: camp.campaignId,
        round: camp.currentRound,
        storms: roundResult.storms.map(function(s) { return { routeId: s.routeId, severity: s.severity }; })
      });
    }

    /* 保存回合结果 */
    camp.rounds.push(roundResult);

    /* 更新资金 */
    camp.operatingCash = roundResult.operatingCashAfter;
    camp.reserve = roundResult.reserveAfter;

    if (roundResult.insolvent) {
      camp.phase = 'insolvent';
      emit('fleet_insolvent', {
        round: camp.currentRound,
        campaignId: camp.campaignId,
        assignments: Object.assign({}, camp.assignments),
        voyageIncome: roundResult.voyageIncome,
        cargoLoss: roundResult.cargoLoss,
        reserveUsed: roundResult.reserveUsed,
        operatingCashAfter: roundResult.operatingCashAfter,
        reserveAfter: roundResult.reserveAfter,
        insolvent: true
      });
    } else if (camp.currentRound >= camp.totalRounds) {
      camp.phase = 'completed';
    } else {
      camp.currentRound++;
      camp.phase = 'planning';
    }

    /* Step 4: fleet_campaign_completed fires on every campaign end (normal or insolvent) */
    if (camp.phase === 'completed' || camp.phase === 'insolvent') {
      var cumulativeVoyageIncome = 0, cumulativeCargoLoss = 0;
      var totalReinsuranceCost = 0, totalReinsuranceRecovery = 0;
      for (var ri = 0; ri < camp.rounds.length; ri++) {
        cumulativeVoyageIncome += camp.rounds[ri].voyageIncome || 0;
        cumulativeCargoLoss += camp.rounds[ri].cargoLoss || 0;
        totalReinsuranceCost += camp.rounds[ri].reinsuranceCost || 0;
        totalReinsuranceRecovery += camp.rounds[ri].reinsuranceRecovery || 0;
      }
      emit('fleet_campaign_completed', {
        campaignId: camp.campaignId,
        seed: camp.seed,
        roundsSettled: camp.rounds.length,
        outcome: camp.phase,
        operatingCash: camp.operatingCash,
        reserve: camp.reserve,
        totalFunds: Math.round((camp.operatingCash + camp.reserve) * 100) / 100,
        cumulativeVoyageIncome: Math.round(cumulativeVoyageIncome * 100) / 100,
        cumulativeCargoLoss: Math.round(cumulativeCargoLoss * 100) / 100,
        totalReinsuranceCost: Math.round(totalReinsuranceCost * 100) / 100,
        totalReinsuranceRecovery: Math.round(totalReinsuranceRecovery * 100) / 100,
        insolvent: camp.phase === 'insolvent',
        rounds: camp.rounds
      });
    }

    camp.updatedAt = nowISO();
    ns.activeCampaign = camp;
    writeNamespace(ns);

    emit('fleet_round_settled', {
      round: roundResult.round,
      campaignId: camp.campaignId,
      assignments: Object.assign({}, camp.assignments),
      voyageIncome: roundResult.voyageIncome,
      cargoLoss: roundResult.cargoLoss,
      reserveUsed: roundResult.reserveUsed,
      operatingCashAfter: roundResult.operatingCashAfter,
      reserveAfter: roundResult.reserveAfter,
      insolvent: roundResult.insolvent
    });

    /* 学习证据（encountered）：结算事实已保存后再记录，不改任何结算 */
    var flEn = learning();
    if (flEn) {
      var commonEvents = flEn.analyzeRound(roundResult);
      if (commonEvents.length > 0) flEn.recordEncounter(camp, roundResult, commonEvents);
    }

    return {
      ok: true,
      isFinal: camp.phase === 'completed' || camp.phase === 'insolvent',
      phase: camp.phase,
      round: roundResult.round,
      result: roundResult,
      campaign: camp
    };
  }

  /* ---- 学习证据：本轮风险关注（每 campaign 一次；choice 为 null 表示跳过） ---- */
  function setLearningFocus(choice) {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };
    var valid = { route: true, departure: true, batch: true, none: true };
    if (choice !== null && !valid[choice]) return { ok: false, reason: 'invalid-focus' };
    camp.learningFocus = { shown: true, choice: choice, round: camp.currentRound };
    camp.updatedAt = nowISO();
    ns.activeCampaign = camp;
    writeNamespace(ns);
    var fl = learning();
    if (fl && choice !== null) fl.recordFocus(camp, choice);
    return { ok: true, learningFocus: camp.learningFocus };
  }

  /* ---- 放弃 campaign（归档，不删除） ---- */

  function abandonCampaign() {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp) return { ok: false, reason: 'no-active-campaign' };

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
      completedAt: nowISO()
    };

    ns.archivedCampaigns.push(archived);
    ns.activeCampaign = null;
    writeNamespace(ns);
    return { ok: true, archived: archived };
  }

  function archiveActiveCampaign() {
    var ns = readNamespace();
    var camp = ns.activeCampaign;
    if (!camp) return { ok: false, reason: 'no-active-campaign' };
    if (camp.phase !== 'completed' && camp.phase !== 'insolvent' && camp.phase !== 'abandoned') {
      return { ok: false, reason: 'campaign-not-ended', phase: camp.phase };
    }
    var archived = {
      campaignId: camp.campaignId,
      seed: camp.seed,
      outcome: camp.phase,
      totalRounds: camp.totalRounds,
      roundsSettled: camp.rounds.length,
      finalOperatingCash: camp.operatingCash,
      finalReserve: camp.reserve,
      finalTotalFunds: Math.round((camp.operatingCash + camp.reserve) * 100) / 100,
      stormsEncountered: countStorms(camp.rounds),
      totalCargoLoss: sumCargoLoss(camp.rounds),
      completedAt: nowISO()
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
      total += rounds[i].cargoLoss || 0;
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
    setLearningFocus: setLearningFocus,
    getExpected: getExpected,
    submitPlan: submitPlan,
    abandonCampaign: abandonCampaign,
    archiveActiveCampaign: archiveActiveCampaign,
    listArchived: listArchived
  });
})(typeof window !== 'undefined' ? window : globalThis);
