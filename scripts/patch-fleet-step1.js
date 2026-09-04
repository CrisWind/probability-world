#!/usr/bin/env node
/* Patch: align fleet-config / fleet-model / fleet-runtime with Step 1 spec.
 * Minimal fleet-ui.js edits for renamed config fields.
 * Usage: node scripts/patch-fleet-step1.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function writeFile(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.writeFileSync(abs, content, 'utf8');
  console.log('[patch] wrote ' + relPath + ' (' + content.length + ' bytes)');
}

function editFile(relPath, replacements) {
  const abs = path.join(ROOT, relPath);
  let text = fs.readFileSync(abs, 'utf8');
  for (const [label, old, fn] of replacements) {
    if (!text.includes(old)) {
      console.error('[patch] FAIL: "' + label + '" — target string not found in ' + relPath);
      process.exit(1);
    }
    text = text.replace(old, typeof fn === 'function' ? fn(text) : fn);
    console.log('[patch] applied: ' + label);
  }
  fs.writeFileSync(abs, text, 'utf8');
  console.log('[patch] edited ' + relPath);
}

/* ================================================================
 * 1. fleet-config.js — rename route names + config field names
 * ================================================================ */
editFile('fleet-config.js', [
  [
    'route north name',
    "name: '北方航线'",
    () => "name: '北岬航线'"
  ],
  [
    'route coastal name',
    "name: '近海航线'",
    () => "name: '沿岸航线'"
  ],
  [
    'route south name',
    "name: '南方航线'",
    () => "name: '南洋航线'"
  ],
  [
    'startingCash → startingOperatingCash',
    'startingCash: 80',
    () => 'startingOperatingCash: 80'
  ],
  [
    'reserveMax → maxReserve',
    'reserveMax: 60',
    () => 'maxReserve: 60'
  ],
  [
    'threshold → perClaimThreshold',
    'threshold: 40',
    () => 'perClaimThreshold: 40'
  ]
]);

/* ================================================================
 * 2. fleet-model.js — full rewrite
 * ================================================================ */
writeFile('fleet-model.js', `/* 概率世界 · 商会船队风险盘 V0.2 —— 核心模型（纯函数，无 DOM、无存档、无事件）
 * 所有随机来自 seed：同一 seed 必定复现同一结算结果。
 * 本模块不读写 GameStore，不发射事件，不操作 DOM。 */
(function attachFleetModel(global) {
  'use strict';

  var CONFIG = function() { return global.FLEET_CONFIG; };

  /* --- seeded RNG（FNV-1a + mulberry 变体，与 shipyard-model 独立） --- */
  function hashSeed(str) {
    var h = 2166136261;
    var s = String(str);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function rngFrom(seed) {
    var t = hashSeed(seed);
    return function next() {
      t += 0x6D2B79F5;
      var r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---- 辅助：查找表 ---- */
  function findVessel(shipId) {
    var vessels = CONFIG().vessels;
    for (var i = 0; i < vessels.length; i++) { if (vessels[i].shipId === shipId) return vessels[i]; }
    return null;
  }

  function findRoute(routeId) {
    var routes = CONFIG().routes;
    for (var i = 0; i < routes.length; i++) { if (routes[i].routeId === routeId) return routes[i]; }
    return null;
  }

  /* ---- 共同风险推导 ---- */

  /* 由 campaign seed 一次性推导所有批次的缺陷状态（campaign 级固定，不逐回合随机） */
  function deriveCommonRiskState(seed, batchIds) {
    var rng = rngFrom('fleet:commonRisk:' + seed);
    var chance = CONFIG().commonRisk.batchDefectChance;
    var batches = {};
    for (var i = 0; i < batchIds.length; i++) {
      var bid = batchIds[i];
      batches[bid] = { defective: rng() < chance };
    }
    return { batches: Object.freeze(batches) };
  }

  /* 由 seed 推导每回合每条航线的风暴状态 */
  function resolveStorms(round, seed, routes) {
    var cr = CONFIG().commonRisk;
    if (round < cr.stormWindowStart || round > cr.stormWindowEnd) return [];
    var storms = [];
    for (var i = 0; i < routes.length; i++) {
      var route = routes[i];
      var rng = rngFrom('fleet:storm:' + seed + ':r' + round + ':' + route.routeId);
      var prob = route.stormExposure * cr.stormProbabilityFactor;
      if (rng() < prob) {
        var severity = cr.stormSeverityMin + rng() * (cr.stormSeverityMax - cr.stormSeverityMin);
        storms.push({ routeId: route.routeId, severity: severity });
      }
    }
    return storms;
  }

  /* ---- 事故概率 ---- */

  /* effectiveP = baseRisk × (1/hull) × volatility × batchMod × stormMod, cap 0.95 */
  function accidentProbability(vessel, route, commonRiskState, storms) {
    var cr = CONFIG().commonRisk;
    var baseP = vessel.baseRisk;
    var hullMod = 1 / vessel.hull;
    var volMod = route.volatility;

    var batchState = commonRiskState.batches[vessel.batchId];
    var batchMod = (batchState && batchState.defective) ? cr.batchDefectModifier : 1;

    var stormMod = 1;
    for (var i = 0; i < storms.length; i++) {
      if (storms[i].routeId === route.routeId) {
        stormMod = 1 + storms[i].severity * route.stormExposure;
        break;
      }
    }

    var p = baseP * hullMod * volMod * batchMod * stormMod;
    return Math.min(p, 0.95);
  }

  /* ---- 再保险计算 ---- */

  function reinsuranceCost(assignments, vessels) {
    var rate = CONFIG().reinsurance.premiumRate;
    var total = 0;
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var routeId = assignments[v.shipId];
      if (routeId) total += v.cargoValue;
    }
    return total * rate;
  }

  function reinsuranceRecovery(cargoLoss) {
    var ri = CONFIG().reinsurance;
    if (cargoLoss <= ri.perClaimThreshold) return 0;
    var excess = cargoLoss - ri.perClaimThreshold;
    return excess * ri.coverRate;
  }

  /* ---- 单船结算 ---- */

  function resolveVessel(vessel, routeId, commonRiskState, storms, seed, round) {
    var sailing = routeId !== null;
    if (!sailing) {
      return {
        shipId: vessel.shipId, name: vessel.name, routeId: null, batchId: vessel.batchId,
        cargoValue: vessel.cargoValue, sailing: false,
        accidentProbability: 0, modifiers: { storm: false, batchDefect: false, stormSeverity: null },
        accident: false, severity: null, cargoLoss: 0, voyageIncome: 0,
        reinsuranceRecovery: 0, playerBorneLoss: 0
      };
    }
    var route = findRoute(routeId);
    if (!route) throw new Error('[FleetModel] unknown route: ' + routeId);

    var effectiveP = accidentProbability(vessel, route, commonRiskState, storms);

    var stormHit = false;
    var stormSeverity = 0;
    for (var i = 0; i < storms.length; i++) {
      if (storms[i].routeId === routeId) { stormHit = true; stormSeverity = storms[i].severity; break; }
    }

    var batchState = commonRiskState.batches[vessel.batchId];
    var batchDefective = batchState && batchState.defective;

    var rng = rngFrom('fleet:vessel:' + seed + ':r' + round + ':' + vessel.shipId);
    var accident = sailing && rng() < effectiveP;

    var severity = null;
    var cargoLoss = 0;
    var voyageIncome = 0;

    if (sailing && !accident) {
      voyageIncome = vessel.cargoValue * route.yieldRate;
    } else if (accident) {
      var sevCfg = CONFIG().accidentSeverity;
      if (rng() < sevCfg.totalLossWeight) {
        severity = 'total';
        cargoLoss = vessel.cargoValue;
      } else {
        severity = 'partial';
        var frac = sevCfg.partialFractionMin + rng() * (sevCfg.partialFractionMax - sevCfg.partialFractionMin);
        cargoLoss = Math.round(vessel.cargoValue * frac * 100) / 100;
      }
    }

    var recovery = accident ? reinsuranceRecovery(cargoLoss) : 0;
    var playerBorneLoss = cargoLoss - recovery;

    return {
      shipId: vessel.shipId,
      name: vessel.name,
      routeId: routeId,
      batchId: vessel.batchId,
      cargoValue: vessel.cargoValue,
      sailing: sailing,
      accidentProbability: Math.round(effectiveP * 10000) / 10000,
      modifiers: { storm: stormHit, batchDefect: batchDefective, stormSeverity: stormSeverity || null },
      accident: accident,
      severity: severity,
      cargoLoss: cargoLoss,
      voyageIncome: Math.round(voyageIncome * 100) / 100,
      reinsuranceRecovery: Math.round(recovery * 100) / 100,
      playerBorneLoss: Math.round(playerBorneLoss * 100) / 100
    };
  }

  /* ---- 资金结算 ---- */

  function settleFunds(operatingCash, reserve, voyageIncome, reinsuranceCostTotal, cargoLossTotal, reinsuranceRecoveryTotal) {
    var playerLoss = cargoLossTotal - reinsuranceRecoveryTotal;
    var netResult = voyageIncome - reinsuranceCostTotal - playerLoss;

    var operatingCashAfter = operatingCash + netResult;
    var reserveUsed = 0;
    var insolvent = false;

    if (operatingCashAfter < 0) {
      var deficit = -operatingCashAfter;
      if (deficit <= reserve) {
        reserveUsed = deficit;
        operatingCashAfter = 0;
      } else {
        reserveUsed = reserve;
        operatingCashAfter = 0;
        insolvent = true;
      }
    }

    var reserveAfter = reserve - reserveUsed;
    return {
      voyageIncome: r2(voyageIncome),
      cargoLoss: r2(cargoLossTotal),
      reinsuranceCost: r2(reinsuranceCostTotal),
      reinsuranceRecovery: r2(reinsuranceRecoveryTotal),
      playerLoss: r2(playerLoss),
      reserveUsed: r2(reserveUsed),
      operatingCashBefore: r2(operatingCash),
      reserveBefore: r2(reserve),
      operatingCashAfter: r2(operatingCashAfter),
      reserveAfter: r2(reserveAfter),
      totalFundsAfter: r2(operatingCashAfter + reserveAfter),
      insolvent: insolvent
    };
  }

  function r2(n) { return Math.round(n * 100) / 100; }

  /* ---- 整轮结算 ---- */

  function resolveRound(assignments, commonRiskState, seed, round, funds) {
    var cfg = CONFIG();
    var vessels = cfg.vessels;
    var storms = resolveStorms(round, seed, cfg.routes);

    var vesselResults = [];
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var routeId = assignments[v.shipId] !== undefined ? assignments[v.shipId] : v.defaultRouteId;
      vesselResults.push(resolveVessel(v, routeId, commonRiskState, storms, seed, round));
    }

    var totalVoyageIncome = 0;
    var totalCargoLoss = 0;
    var totalReinsuranceRecovery = 0;
    var sailingVessels = [];
    for (var j = 0; j < vesselResults.length; j++) {
      totalVoyageIncome += vesselResults[j].voyageIncome;
      totalCargoLoss += vesselResults[j].cargoLoss;
      totalReinsuranceRecovery += vesselResults[j].reinsuranceRecovery;
      if (vesselResults[j].sailing) sailingVessels.push(vessels[j]);
    }

    var riCost = reinsuranceCost(assignments, vessels);

    var batchDefects = [];
    var batchKeys = Object.keys(commonRiskState.batches);
    for (var k = 0; k < batchKeys.length; k++) {
      if (commonRiskState.batches[batchKeys[k]].defective) batchDefects.push(batchKeys[k]);
    }

    var fundsResult = settleFunds(
      funds.operatingCash, funds.reserve,
      totalVoyageIncome, riCost, totalCargoLoss, totalReinsuranceRecovery
    );

    return {
      round: round,
      seed: seed,
      assignments: Object.assign({}, assignments),
      storms: storms,
      batchDefects: batchDefects,
      vesselResults: vesselResults,
      voyageIncome: fundsResult.voyageIncome,
      cargoLoss: fundsResult.cargoLoss,
      reinsuranceCost: fundsResult.reinsuranceCost,
      reinsuranceRecovery: fundsResult.reinsuranceRecovery,
      playerLoss: fundsResult.playerLoss,
      reserveUsed: fundsResult.reserveUsed,
      operatingCashBefore: fundsResult.operatingCashBefore,
      reserveBefore: fundsResult.reserveBefore,
      operatingCashAfter: fundsResult.operatingCashAfter,
      reserveAfter: fundsResult.reserveAfter,
      totalFundsAfter: fundsResult.totalFundsAfter,
      insolvent: fundsResult.insolvent
    };
  }

  /* ---- 事前预期（概率加权） ---- */

  function expectedRound(assignments, commonRiskState, seed, round) {
    var cfg = CONFIG();
    var vessels = cfg.vessels;
    var storms = resolveStorms(round, seed, cfg.routes);

    var expectedIncome = 0;
    var expectedLoss = 0;
    var routeCounts = {};
    var batchCounts = {};

    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var routeId = assignments[v.shipId] !== undefined ? assignments[v.shipId] : v.defaultRouteId;
      if (!routeId) continue;
      var route = findRoute(routeId);
      var p = accidentProbability(v, route, commonRiskState, storms);
      var sevCfg = cfg.accidentSeverity;

      var incomeIfSafe = v.cargoValue * route.yieldRate;
      expectedIncome += incomeIfSafe * (1 - p);

      var expectedLossIfAccident = v.cargoValue * sevCfg.totalLossWeight
        + v.cargoValue * (1 - sevCfg.totalLossWeight)
          * (sevCfg.partialFractionMin + sevCfg.partialFractionMax) / 2;
      expectedLoss += p * expectedLossIfAccident;

      routeCounts[routeId] = (routeCounts[routeId] || 0) + 1;
      batchCounts[v.batchId] = (batchCounts[v.batchId] || 0) + 1;
    }

    var riCost = reinsuranceCost(assignments, vessels);

    var expectedRecovery = 0;
    for (var j = 0; j < vessels.length; j++) {
      var vj = vessels[j];
      var rj = assignments[vj.shipId] !== undefined ? assignments[vj.shipId] : vj.defaultRouteId;
      if (!rj) continue;
      var routeJ = findRoute(rj);
      var pJ = accidentProbability(vj, routeJ, commonRiskState, storms);
      var sevCfgJ = cfg.accidentSeverity;
      var expectedLossJ = pJ * (vj.cargoValue * sevCfgJ.totalLossWeight
        + vj.cargoValue * (1 - sevCfgJ.totalLossWeight)
          * (sevCfgJ.partialFractionMin + sevCfgJ.partialFractionMax) / 2);
      expectedRecovery += pJ * reinsuranceRecovery(expectedLossJ);
    }

    var sailingCount = Object.keys(routeCounts).reduce(function(s, k) { return s + routeCounts[k]; }, 0);
    var routeConcentration = sailingCount > 0
      ? Object.keys(routeCounts).map(function(k) { return { routeId: k, count: routeCounts[k] }; })
      : [];
    var batchConcentration = Object.keys(batchCounts).map(function(k) { return { batchId: k, count: batchCounts[k] }; });

    return {
      expectedVoyageIncome: r2(expectedIncome),
      expectedCargoLoss: r2(expectedLoss),
      expectedReinsuranceCost: r2(riCost),
      expectedReinsuranceRecovery: r2(expectedRecovery),
      expectedNetResult: r2(expectedIncome - expectedLoss + expectedRecovery - riCost),
      routeConcentration: routeConcentration,
      batchConcentration: batchConcentration
    };
  }

  /* ---- 导出 ---- */

  global.FleetModel = Object.freeze({
    hashSeed: hashSeed,
    rngFrom: rngFrom,
    findVessel: findVessel,
    findRoute: findRoute,
    deriveCommonRiskState: deriveCommonRiskState,
    resolveStorms: resolveStorms,
    accidentProbability: accidentProbability,
    reinsuranceCost: reinsuranceCost,
    reinsuranceRecovery: reinsuranceRecovery,
    resolveVessel: resolveVessel,
    resolveRound: resolveRound,
    expectedRound: expectedRound
  });
})(typeof window !== 'undefined' ? window : globalThis);
`);

/* ================================================================
 * 3. fleet-runtime.js — full rewrite
 * ================================================================ */
writeFile('fleet-runtime.js', `/* 概率世界 · 商会船队风险盘 V0.2 —— 运行时（状态机 + 存档 + 事件）
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

  function nowISO() { return new Date().toISOString(); }

  /* ---- Campaign 生命周期 ---- */

  function startCampaign(options) {
    var ns = readNamespace();
    var camp = ns.activeCampaign;

    /* 有 planning 状态的 activeCampaign 时恢复，不重置 */
    if (camp && camp.phase === 'planning') {
      return { ok: true, campaign: camp, resumed: true };
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

    var funds = { operatingCash: camp.operatingCash, reserve: camp.reserve };

    emit('fleet_plan_submitted', {
      round: camp.currentRound,
      campaignId: camp.campaignId,
      assignments: Object.assign({}, camp.assignments),
      operatingCash: camp.operatingCash,
      reserve: camp.reserve
    });

    /* 调用纯模型结算 */
    var roundResult = model().resolveRound(
      camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound, funds
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

    return { ok: true, roundResult: roundResult, campaign: camp };
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
    getExpected: getExpected,
    submitPlan: submitPlan,
    abandonCampaign: abandonCampaign,
    listArchived: listArchived
  });
})(typeof window !== 'undefined' ? window : globalThis);
`);

/* ================================================================
 * 4. fleet-ui.js — minimal edits for renamed config fields
 * ================================================================ */
editFile('fleet-ui.js', [
  [
    'reserveMax → maxReserve',
    'cfg.capital.reserveMax',
    () => 'cfg.capital.maxReserve'
  ],
  [
    'threshold → perClaimThreshold',
    'cfg.reinsurance.threshold',
    () => 'cfg.reinsurance.perClaimThreshold'
  ],
  [
    'startingCash → startingOperatingCash',
    'cfg.capital.startingCash',
    () => 'cfg.capital.startingOperatingCash'
  ],
  [
    'reinsurance label: always active',
    "var riLabel = camp.reinsuranceActive ? '已购买' : '未购买';",
    () => "var riLabel = '已购买';"
  ],
  [
    'reinsurance button: always active',
    "html += '<button class=\"fleet-btn' + (camp.reinsuranceActive ? ' selected' : '') + '\" data-action=\"reinsurance\">';\n    html += camp.reinsuranceActive ? '已购买' : '未购买';",
    () => "html += '<button class=\"fleet-btn selected\" data-action=\"reinsurance\" disabled>';\n    html += '已购买';"
  ],
  [
    'reinsurance click handler: no-op',
    "runtime().setReinsurance(!camp.reinsuranceActive);",
    () => "/* reinsurance always active, no-op */"
  ]
]);

/* ================================================================
 * 5. Syntax verification
 * ================================================================ */
var files = ['fleet-config.js', 'fleet-model.js', 'fleet-runtime.js', 'fleet-ui.js'];
var allOk = true;
files.forEach(function(f) {
  var abs = path.join(ROOT, f);
  try {
    new Function(fs.readFileSync(abs, 'utf8'));
    console.log('[patch] syntax OK: ' + f);
  } catch (e) {
    console.error('[patch] SYNTAX ERROR in ' + f + ': ' + e.message);
    allOk = false;
  }
});

if (allOk) {
  console.log('\n[patch] All files patched and syntax-verified successfully.');
} else {
  console.error('\n[patch] Some files have syntax errors — review above.');
  process.exit(1);
}
