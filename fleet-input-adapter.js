/* 概率世界 · 商会船队风险盘 V0.4 —— 输入适配层
 * 读取造船厂质检报告、承保咖啡馆记录、风闻局知识，生成战役输入快照。
 * 纯读取，不修改任何外部系统状态；不写入 GameStore；不发事件。
 * 匹配规则：按船名（name）匹配造船厂报告与承保记录到船队船只；
 *  无法匹配的数据标记为 unmatched，不猜测。
 * 风闻局数据按聚合信号读取，不做逐船匹配。 */
(function attachFleetInputAdapter(global) {
  'use strict';

  var store = function() { return global.__gameStore; };
  var config = function() { return global.FLEET_CONFIG; };

  /* ---- 质检→船队效果策略常量（单点维护；乘入事故概率，仍由风险模型与 seed 结算） ---- */
  var QA_RULES = {
    modFullRepair: 0.6,
    modPartialClean: 0.8,
    modPartialPerRemaining: 0.12,
    modReleasePerRemaining: 0.18,
    modHoldPerActualDefect: 0.18
  };

  function shipyardCfg() {
    var c = global.SHIPYARD_CONFIG;
    return (c && c.batch) ? c.batch : null;
  }

  /* ---- 造船厂质检信号 ---- */
  function readShipyardReports() {
    var gs = store();
    if (!gs) return [];
    var reports = gs.get('world.shipyard.reports');
    return Array.isArray(reports) ? reports : [];
  }

  /* 造船厂只有 testShip（'曙光号'），按船名匹配到船队 vessel */
  function buildShipyardSignals(vessels, reports) {
    var signals = {};
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var matched = [];
      for (var j = 0; j < reports.length; j++) {
        if (reports[j].shipName === v.name) matched.push(reports[j]);
      }
      signals[v.shipId] = {
        matched: matched.length > 0,
        reportCount: matched.length,
        lastReport: matched.length > 0 ? summarizeReport(matched[matched.length - 1]) : null,
        totalDefectsFound: sumField(matched, 'defectsFound', true),
        totalDelays: sumDelays(matched),
        lastDecision: matched.length > 0 ? matched[matched.length - 1].decision : null,
        lastOutcome: matched.length > 0 ? matched[matched.length - 1].actualOutcome : null,
        allMatched: false
      };
    }
    var unmatchedCount = 0;
    for (var k = 0; k < reports.length; k++) {
      var found = false;
      for (var m = 0; m < vessels.length; m++) {
        if (reports[k].shipName === vessels[m].name) { found = true; break; }
      }
      if (!found) unmatchedCount++;
    }
    return { perVessel: signals, unmatchedReportCount: unmatchedCount };
  }

  function summarizeReport(r) {
    return {
      reportId: r.reportId,
      decision: r.decision,
      repairLevel: r.repairLevel,
      defectsFound: Array.isArray(r.defectsFound) ? r.defectsFound.length : 0,
      departureDelay: r.departureDelay || 0,
      actualOutcome: r.actualOutcome || null,
      completedAt: r.completedAt || null
    };
  }

  function sumField(arr, field, isArray) {
    var total = 0;
    for (var i = 0; i < arr.length; i++) {
      var val = arr[i][field];
      if (isArray && Array.isArray(val)) total += val.length;
      else if (typeof val === 'number') total += val;
    }
    return total;
  }

  function sumDelays(reports) {
    var total = 0;
    for (var i = 0; i < reports.length; i++) {
      total += reports[i].departureDelay || 0;
    }
    return total;
  }

  /* ---- 承保咖啡馆信号 ---- */
  function readMarketProfile() {
    var gs = store();
    if (!gs) return null;
    return gs.get('player.marketProfile') || null;
  }

  function buildMarketSignals(vessels, profile) {
    var result = {
      perVessel: {},
      aggregate: { games: 0, totalProfit: 0, totalAccidents: 0, totalRecords: 0, accidentRate: null, lastGameProfit: null },
      unmatchedLedgerCount: 0
    };
    if (!profile) return result;

    var ledger = Array.isArray(profile.ledger) ? profile.ledger : [];
    var vesselNames = {};
    for (var i = 0; i < vessels.length; i++) {
      vesselNames[vessels[i].name] = vessels[i].shipId;
    }

    /* 按船名分组 ledger 条目 */
    var perVessel = {};
    for (var j = 0; j < vessels.length; j++) {
      perVessel[vessels[j].shipId] = { matched: false, records: 0, accidents: 0, totalProfit: 0 };
    }

    var unmatchedLedger = 0;
    for (var k = 0; k < ledger.length; k++) {
      var entry = ledger[k];
      var sid = vesselNames[entry.ship];
      if (sid) {
        perVessel[sid].matched = true;
        perVessel[sid].records++;
        perVessel[sid].accidents += entry.accident ? 1 : 0;
        perVessel[sid].totalProfit += (typeof entry.profit === 'number' ? entry.profit : 0);
      } else {
        unmatchedLedger++;
      }
    }
    result.perVessel = perVessel;
    result.unmatchedLedgerCount = unmatchedLedger;

    /* 聚合 */
    var totalProfit = 0, totalAccidents = 0;
    for (var m = 0; m < ledger.length; m++) {
      totalProfit += (typeof ledger[m].profit === 'number' ? ledger[m].profit : 0);
      totalAccidents += ledger[m].accident ? 1 : 0;
    }
    result.aggregate.games = typeof profile.games === 'number' ? profile.games : 0;
    result.aggregate.totalProfit = Math.round(totalProfit * 100) / 100;
    result.aggregate.totalAccidents = totalAccidents;
    result.aggregate.totalRecords = ledger.length;
    result.aggregate.accidentRate = ledger.length > 0 ? Math.round(totalAccidents / ledger.length * 1000) / 1000 : null;
    result.aggregate.lastGameProfit = ledger.length > 0 ? (typeof ledger[ledger.length - 1].profit === 'number' ? ledger[ledger.length - 1].profit : null) : null;

    return result;
  }

  /* ---- 风闻局信号 ---- */
  function readRumorProfile() {
    var gs = store();
    if (!gs) return null;
    return gs.get('world.rumorProfile') || null;
  }

  function buildRumorSignals(profile) {
    var result = {
      handbook: { herd: 'unseen', cascade: 'unseen', source: 'unseen', independence: 'unseen', outcome: 'unseen' },
      games: 0,
      historyCount: 0,
      recentHistory: [],
      lastSeed: null
    };
    if (!profile) return result;

    var hb = profile.handbook || {};
    result.handbook = {
      herd: hb.herd || 'unseen',
      cascade: hb.cascade || 'unseen',
      source: hb.source || 'unseen',
      independence: hb.independence || 'unseen',
      outcome: hb.outcome || 'unseen'
    };
    result.games = typeof profile.games === 'number' ? profile.games : 0;

    var history = Array.isArray(profile.history) ? profile.history : [];
    result.historyCount = history.length;
    result.lastSeed = profile.lastSeed || null;

    /* 最近 5 条（不假设与船队有关） */
    var start = Math.max(0, history.length - 5);
    for (var i = start; i < history.length; i++) {
      var h = history[i];
      if (h) {
        result.recentHistory.push({
          scenario: h.scenario || null,
          decision: h.decision || null,
          risks: Array.isArray(h.risks) ? h.risks : [],
          seed: h.seed || null
        });
      }
    }

    return result;
  }

  /* ---- 主函数：生成战役输入快照 ---- */
  function buildCampaignInputSnapshot() {
    var cfg = config();
    var vessels = cfg.vessels;

    var reports = readShipyardReports();
    var marketProfile = readMarketProfile();
    var rumorProfile = readRumorProfile();

    return {
      capturedAt: new Date().toISOString(),
      shipyard: buildShipyardSignals(vessels, reports),
      shipyardEffects: deriveShipyardEffects(vessels, reports),
      market: buildMarketSignals(vessels, marketProfile),
      rumor: buildRumorSignals(rumorProfile),
      unmatched: {
        shipyardReports: countUnmatchedShipyard(vessels, reports),
        marketLedgerEntries: countUnmatchedMarket(vessels, marketProfile)
      }
    };
  }

  function countUnmatchedShipyard(vessels, reports) {
    var count = 0;
    for (var i = 0; i < reports.length; i++) {
      var found = false;
      for (var j = 0; j < vessels.length; j++) {
        if (reports[i].shipName === vessels[j].name) { found = true; break; }
      }
      if (!found) count++;
    }
    return count;
  }

  /* 派生单船质检效果：取该船最新一份已完成报告（按 completedAt），
   * 只引用报告已存事实（decision/repairLevel/样本与真实缺陷数量），不重算抽样、不复制报告。
   * 效果固定于 campaign 开始时（快照冻结），campaign 期间新质检不静默生效。 */
  function deriveShipyardEffects(vessels, reports) {
    var batch = shipyardCfg();
    var totalParts = (batch && batch.totalParts) || 24;
    var byVessel = {};
    for (var i = 0; i < vessels.length; i++) byVessel[vessels[i].name] = vessels[i];
    var latestById = {};
    for (var r = 0; r < reports.length; r++) {
      var rep = reports[r];
      if (!rep || !rep.shipName || !byVessel[rep.shipName]) continue;
      var prev = latestById[rep.shipName];
      if (!prev || String(rep.completedAt || '') >= String(prev.completedAt || '')) latestById[rep.shipName] = rep;
    }
    var effects = [];
    var names = Object.keys(latestById);
    for (var n = 0; n < names.length; n++) {
      var name = names[n];
      var report = latestById[name];
      var vessel = byVessel[name];
      var out = report.actualOutcome || {};
      var sampledCount = Array.isArray(report.sampledParts) ? report.sampledParts.length : 0;
      var foundCount = Array.isArray(report.defectsFound) ? report.defectsFound.length : 0;
      var actualCount = Array.isArray(out.allDefectIds) ? out.allDefectIds.length : 0;
      var remainingCount = Array.isArray(out.remainingDefects) ? out.remainingDefects.length : 0;
      var missedCount = Array.isArray(out.missedDefects) ? out.missedDefects.length : 0;
      var qaMod = null;
      var holdRound1 = false;
      if (report.repairLevel === 'full') {
        qaMod = QA_RULES.modFullRepair;            /* 全面返修：整体风险下降但不清零 */
      } else if (report.repairLevel === 'partial') {
        qaMod = remainingCount > 0
          ? 1 + QA_RULES.modPartialPerRemaining * remainingCount
          : QA_RULES.modPartialClean;              /* 样本发现的缺陷已全部修复 */
      } else if (report.repairLevel === 'none') {
        qaMod = remainingCount > 0
          ? 1 + QA_RULES.modReleasePerRemaining * remainingCount
          : 1;                                     /* 样本无发现≠绝对安全，未检查部位仍未知 */
      } else if (report.repairLevel === 'hold') {
        holdRound1 = true;                         /* 错过这一潮：campaign 第 1 回合自动留港 */
        qaMod = 1 + QA_RULES.modHoldPerActualDefect * Math.max(actualCount, 0); /* 第 2 回合起出航适用 */
      }
      effects.push({
        shipId: vessel.shipId,
        shipName: vessel.name,
        sourceReportId: report.reportId,
        sourceCompletedAt: report.completedAt || null,
        decision: report.decision,
        repairLevel: report.repairLevel,
        sampledCount: sampledCount,
        uninspectedCount: totalParts - sampledCount,
        foundCount: foundCount,
        actualDefectCount: actualCount,
        missedCount: missedCount,
        remainingCount: remainingCount,
        sailed: out.sailed === true,
        accident: out.accident === true,
        accidentCause: out.accidentCause || null,
        holdRound1: holdRound1,
        qaMod: Math.round(qaMod * 1000) / 1000
      });
    }
    return effects;
  }

  /* 读取快照中的质检效果（只读；无快照返回空数组） */
  function getShipyardEffects(snapshot) {
    if (!snapshot) return [];
    if (Array.isArray(snapshot.shipyardEffects)) return snapshot.shipyardEffects;
    if (snapshot.shipyard && Array.isArray(snapshot.shipyard.effects)) return snapshot.shipyard.effects;
    return [];
  }

  function countUnmatchedMarket(vessels, profile) {
    if (!profile) return 0;
    var ledger = Array.isArray(profile.ledger) ? profile.ledger : [];
    var vesselNames = {};
    for (var i = 0; i < vessels.length; i++) vesselNames[vessels[i].name] = true;
    var count = 0;
    for (var j = 0; j < ledger.length; j++) {
      if (!vesselNames[ledger[j].ship]) count++;
    }
    return count;
  }

  /* ---- 读取快照（供 UI 显示） ---- */
  function getInputSnapshot(campaign) {
    if (!campaign) return null;
    return campaign.inputSnapshot || null;
  }

  global.FleetInputAdapter = Object.freeze({
    buildCampaignInputSnapshot: buildCampaignInputSnapshot,
    getInputSnapshot: getInputSnapshot,
    deriveShipyardEffects: deriveShipyardEffects,
    getShipyardEffects: getShipyardEffects,
    readShipyardReports: readShipyardReports,
    readMarketProfile: readMarketProfile,
    readRumorProfile: readRumorProfile
  });
})(typeof window !== 'undefined' ? window : globalThis);
