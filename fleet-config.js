/* 概率世界 · 商会船队风险盘 V0.1 —— 集中参数配置
 * 所有数值只在此处调整；模型、运行时、UI 不得散落硬编码参数。
 * 本阶段不接入承保咖啡馆、风闻局、造船厂质检报告。 */
(function attachFleetConfig(global) {
  'use strict';

  var deepFreeze = function(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      Object.freeze(obj);
      Object.keys(obj).forEach(function(k) { deepFreeze(obj[k]); });
    }
    return obj;
  };

  var FLEET_CONFIG = deepFreeze({
    version: 1,

    /* ---- 船只 ---- */
    vessels: [
      { shipId: 'vessel.dawn',      name: '曙光号',     cargoValue: 80,  baseRisk: 0.08, hull: 0.9,  defaultRouteId: 'route.north',   batchId: 'batch.rope_a' },
      { shipId: 'vessel.gull',      name: '白鸥号',     cargoValue: 60,  baseRisk: 0.05, hull: 0.8,  defaultRouteId: 'route.coastal', batchId: 'batch.rope_a' },
      { shipId: 'vessel.guild',     name: '商会货船',   cargoValue: 120, baseRisk: 0.10, hull: 0.9,  defaultRouteId: 'route.south',   batchId: 'batch.rope_b' },
      { shipId: 'vessel.skiff',     name: '沿岸小船',   cargoValue: 30,  baseRisk: 0.12, hull: 0.6,  defaultRouteId: 'route.north',   batchId: 'batch.rope_b' },
      { shipId: 'vessel.ocean',     name: '远洋号',     cargoValue: 100, baseRisk: 0.06, hull: 0.95, defaultRouteId: 'route.coastal', batchId: 'batch.rope_c' },
      { shipId: 'vessel.sail',      name: '旧帆船',     cargoValue: 50,  baseRisk: 0.15, hull: 0.5,  defaultRouteId: 'route.south',   batchId: 'batch.rope_c' }
    ],

    /* ---- 航线 ---- */
    routes: [
      { routeId: 'route.north',   name: '北岬航线', baseRisk: 0.08, yieldRate: 0.12, volatility: 1.4, stormExposure: 0.8 },
      { routeId: 'route.coastal', name: '沿岸航线', baseRisk: 0.05, yieldRate: 0.08, volatility: 1.0, stormExposure: 0.4 },
      { routeId: 'route.south',   name: '南洋航线', baseRisk: 0.10, yieldRate: 0.15, volatility: 1.8, stormExposure: 0.6 }
    ],

    /* ---- 船材批次显示名（纯文案映射；内部 batchId 不变） ---- */
    batches: [
      { batchId: 'batch.rope_a', name: '第一批船材' },
      { batchId: 'batch.rope_b', name: '第二批船材' },
      { batchId: 'batch.rope_c', name: '第三批船材' }
    ],

    /* ---- 共同风险参数 ---- */
    commonRisk: {
      stormWindowStart: 4,
      stormWindowEnd: 5,
      batchDefectChance: 0.18,
      batchDefectModifier: 1.8,
      stormSeverityMin: 0.5,
      stormSeverityMax: 1.0,
      stormProbabilityFactor: 0.7
    },

    /* ---- 再保险 ---- */
    reinsurance: {
      premiumRate: 0.03,
      perClaimThreshold: 40,
      coverRate: 0.5
    },

    /* ---- 资金与准备金 ---- */
    capital: {
      startingOperatingCash: 80,
      startingReserve: 20,
      maxReserve: 60,
      reserveStep: 10
    },

    /* ---- 事故严重度 ---- */
    accidentSeverity: {
      totalLossWeight: 0.5,
      partialFractionMin: 0.3,
      partialFractionMax: 0.6
    },

    /* ---- Campaign ---- */
    campaign: {
      totalRounds: 5
    }
  });

  global.FLEET_CONFIG = FLEET_CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
