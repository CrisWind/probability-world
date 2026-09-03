/* 概率世界 · 商会船队风险盘 V0.1 —— 核心模型（纯函数，无 DOM、无存档、无事件）
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

  function calcReinsuranceCost(assignments, vessels) {
    var rate = CONFIG().reinsurance.premiumRate;
    var total = 0;
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var routeId = assignments[v.shipId];
      if (routeId) total += v.cargoValue;
    }
    return total * rate;
  }

  function calcReinsuranceRecovery(cargoLoss) {
    var ri = CONFIG().reinsurance;
    if (cargoLoss <= ri.threshold) return 0;
    var excess = cargoLoss - ri.threshold;
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

    var reinsuranceRecovery = accident ? calcReinsuranceRecovery(cargoLoss) : 0;
    var playerBorneLoss = cargoLoss - reinsuranceRecovery;

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
      reinsuranceRecovery: Math.round(reinsuranceRecovery * 100) / 100,
      playerBorneLoss: Math.round(playerBorneLoss * 100) / 100
    };
  }

  /* ---- 整轮结算 ---- */

  function resolveRound(assignments, commonRiskState, seed, round) {
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
    for (var j = 0; j < vesselResults.length; j++) {
      totalVoyageIncome += vesselResults[j].voyageIncome;
      totalCargoLoss += vesselResults[j].cargoLoss;
      totalReinsuranceRecovery += vesselResults[j].reinsuranceRecovery;
    }

    var reinsuranceCost = calcReinsuranceCost(assignments, vessels);
    var netProfit = totalVoyageIncome - totalCargoLoss + totalReinsuranceRecovery - reinsuranceCost;

    var batchDefects = [];
    var batchKeys = Object.keys(commonRiskState.batches);
    for (var k = 0; k < batchKeys.length; k++) {
      if (commonRiskState.batches[batchKeys[k]].defective) batchDefects.push(batchKeys[k]);
    }

    return {
      round: round,
      seed: seed,
      assignments: Object.assign({}, assignments),
      storms: storms,
      batchDefects: batchDefects,
      vesselResults: vesselResults,
      totals: {
        voyageIncome: Math.round(totalVoyageIncome * 100) / 100,
        cargoLoss: Math.round(totalCargoLoss * 100) / 100,
        reinsuranceCost: Math.round(reinsuranceCost * 100) / 100,
        reinsuranceRecovery: Math.round(totalReinsuranceRecovery * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100
      }
    };
  }

  /* ---- 事前预期（概率加权） ---- */

  function expectedRound(assignments, commonRiskState, seed, round) {
    var cfg = CONFIG();
    var vessels = cfg.vessels;
    var storms = resolveStorms(round, seed, cfg.routes);

    var expectedIncome = 0;
    var expectedLoss = 0;

    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var routeId = assignments[v.shipId] !== undefined ? assignments[v.shipId] : v.defaultRouteId;
      if (!routeId) continue;
      var route = findRoute(routeId);
      var p = accidentProbability(v, route, commonRiskState, storms);
      var sevCfg = cfg.accidentSeverity;

      var incomeIfSafe = v.cargoValue * route.yieldRate;
      expectedIncome += incomeIfSafe * (1 - p);

      var totalLossProb = sevCfg.totalLossWeight;
      var partialFrac = (sevCfg.partialFractionMin + sevCfg.partialFractionMax) / 2;
      var expectedLossIfAccident = v.cargoValue * totalLossProb + v.cargoValue * (1 - totalLossProb) * partialFrac;
      expectedLoss += p * expectedLossIfAccident;
    }

    var reinsuranceCost = calcReinsuranceCost(assignments, vessels);
    var expectedRecovery = 0;
    for (var j = 0; j < vessels.length; j++) {
      var vj = vessels[j];
      var rj = assignments[vj.shipId] !== undefined ? assignments[vj.shipId] : vj.defaultRouteId;
      if (!rj) continue;
      var routeJ = findRoute(rj);
      var pJ = accidentProbability(vj, routeJ, commonRiskState, storms);
      var sevCfgJ = cfg.accidentSeverity;
      var totalLossProbJ = sevCfgJ.totalLossWeight;
      var partialFracJ = (sevCfgJ.partialFractionMin + sevCfgJ.partialFractionMax) / 2;
      var expectedLossJ = pJ * (vj.cargoValue * totalLossProbJ + vj.cargoValue * (1 - totalLossProbJ) * partialFracJ);
      expectedRecovery += pJ * calcReinsuranceRecovery(expectedLossJ);
    }

    return {
      expectedVoyageIncome: Math.round(expectedIncome * 100) / 100,
      expectedCargoLoss: Math.round(expectedLoss * 100) / 100,
      expectedReinsuranceRecovery: Math.round(expectedRecovery * 100) / 100,
      reinsuranceCost: Math.round(reinsuranceCost * 100) / 100,
      expectedNetProfit: Math.round((expectedIncome - expectedLoss + expectedRecovery - reinsuranceCost) * 100) / 100
    };
  }

  /* ---- 准备金与资金 ---- */

  function applyReserve(operatingCash, reserve, netProfit) {
    var capCfg = CONFIG().capital;
    var newCash = operatingCash + netProfit;
    var reserveUsed = 0;
    var insolvent = false;

    if (newCash < 0) {
      var deficit = -newCash;
      if (deficit <= reserve) {
        reserveUsed = deficit;
        newCash = 0;
      } else {
        reserveUsed = reserve;
        newCash = 0;
        insolvent = true;
      }
    }

    var newReserve = reserve - reserveUsed;
    return {
      operatingCashAfter: Math.round(newCash * 100) / 100,
      reserveUsed: Math.round(reserveUsed * 100) / 100,
      reserveAfter: Math.round(newReserve * 100) / 100,
      insolvent: insolvent
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
    calcReinsuranceCost: calcReinsuranceCost,
    calcReinsuranceRecovery: calcReinsuranceRecovery,
    resolveVessel: resolveVessel,
    resolveRound: resolveRound,
    expectedRound: expectedRound,
    applyReserve: applyReserve
  });
})(typeof window !== 'undefined' ? window : globalThis);
