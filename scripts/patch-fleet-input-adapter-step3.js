/* Step 3: fleet-input-adapter.js + fleet-runtime.js inputSnapshot + index.html script tag
 * Idempotent: checks markers before each change. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');
const outDir = BASE;
const scriptsDir = __dirname;

function writeFile(relPath, content) {
  const full = path.join(outDir, relPath);
  fs.writeFileSync(full, content, 'utf8');
  console.log('WRITE', relPath, '(' + content.length + ' bytes)');
}

function readFile(relPath) {
  return fs.readFileSync(path.join(outDir, relPath), 'utf8');
}

function syntaxCheck(relPath) {
  const full = path.join(outDir, relPath);
  try {
    execSync('node -c "' + full + '"', { stdio: 'pipe' });
    console.log('SYNTAX OK:', relPath);
    return true;
  } catch (e) {
    console.error('SYNTAX FAIL:', relPath, e.stderr ? e.stderr.toString().slice(0, 300) : e.message);
    return false;
  }
}

/* ============================================================
 * 1. Create fleet-input-adapter.js
 * ============================================================ */
const ADAPTER_FILE = 'fleet-input-adapter.js';
const ADAPTER_MARKER = 'FleetInputAdapter';

const adapterContent = `/* 概率世界 · 商会船队风险盘 V0.3 —— 输入适配层
 * 读取造船厂质检报告、承保咖啡馆记录、风闻局知识，生成战役输入快照。
 * 纯读取，不修改任何外部系统状态；不写入 GameStore；不发事件。
 * 匹配规则：按船名（name）匹配造船厂报告与承保记录到船队船只；
 *  无法匹配的数据标记为 unmatched，不猜测。
 * 风闻局数据按聚合信号读取，不做逐船匹配。 */
(function attachFleetInputAdapter(global) {
  'use strict';

  var store = function() { return global.__gameStore; };
  var config = function() { return global.FLEET_CONFIG; };

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
    readShipyardReports: readShipyardReports,
    readMarketProfile: readMarketProfile,
    readRumorProfile: readRumorProfile
  });
})(typeof window !== 'undefined' ? window : globalThis);
`;

if (fs.existsSync(path.join(outDir, ADAPTER_FILE))) {
  var existing = readFile(ADAPTER_FILE);
  if (existing.indexOf(ADAPTER_MARKER) !== -1) {
    console.log('SKIP', ADAPTER_FILE, '— already applied');
  } else {
    writeFile(ADAPTER_FILE, adapterContent);
  }
} else {
  writeFile(ADAPTER_FILE, adapterContent);
}

/* ============================================================
 * 2. Patch fleet-runtime.js: add inputSnapshot to startCampaign
 * ============================================================ */
var RUNTIME_FILE = 'fleet-runtime.js';
var RUNTIME_MARKER = 'campaign.inputSnapshot = inputAdapter.buildCampaignInputSnapshot';

var runtimeContent = readFile(RUNTIME_FILE);

if (runtimeContent.indexOf(RUNTIME_MARKER) !== -1) {
  console.log('SKIP', RUNTIME_FILE, '— inputSnapshot already present');
} else {
  /* Add adapter reference at top of IIFE */
  var anchor1 = "var model = function() { return global.FleetModel; };";
  var anchor1Replacement = anchor1 + "\n  var adapter = function() { return global.FleetInputAdapter; };";

  if (runtimeContent.indexOf(anchor1Replacement) !== -1) {
    console.log('SKIP', RUNTIME_FILE, '— adapter reference already present');
  } else if (runtimeContent.indexOf(anchor1) === -1) {
    console.error('ANCHOR NOT FOUND in', RUNTIME_FILE, ':', anchor1.slice(0, 60));
    process.exit(1);
  } else {
    runtimeContent = runtimeContent.replace(anchor1, anchor1Replacement);
    console.log('PATCH', RUNTIME_FILE, '— added adapter reference');
  }

  /* Add inputSnapshot generation in startCampaign, after campaign object creation */
  var anchor2 = "    ns.activeCampaign = campaign;\n    writeNamespace(ns);\n    return { ok: true, campaign: campaign, resumed: false };";
  var anchor2Replacement = "    /* Step 3: capture input snapshot from external systems */\n    var inputAdapter = adapter();\n    if (inputAdapter && inputAdapter.buildCampaignInputSnapshot) {\n      campaign.inputSnapshot = inputAdapter.buildCampaignInputSnapshot();\n    }\n\n    ns.activeCampaign = campaign;\n    writeNamespace(ns);\n    return { ok: true, campaign: campaign, resumed: false };";

  if (runtimeContent.indexOf(RUNTIME_MARKER) !== -1) {
    console.log('SKIP', RUNTIME_FILE, '— inputSnapshot generation already present');
  } else if (runtimeContent.indexOf(anchor2) === -1) {
    console.error('ANCHOR NOT FOUND in', RUNTIME_FILE, ':', anchor2.slice(0, 80));
    process.exit(1);
  } else {
    runtimeContent = runtimeContent.replace(anchor2, anchor2Replacement);
    console.log('PATCH', RUNTIME_FILE, '— added inputSnapshot generation');
  }

  writeFile(RUNTIME_FILE, runtimeContent);
}

/* ============================================================
 * 3. Patch index.html: add fleet-input-adapter.js script tag
 * ============================================================ */
var HTML_FILE = 'index.html';
var HTML_MARKER = 'fleet-input-adapter.js';

var htmlContent = readFile(HTML_FILE);

if (htmlContent.indexOf(HTML_MARKER) !== -1) {
  console.log('SKIP', HTML_FILE, '— script tag already present');
} else {
  /* Insert after fleet-model.js script tag */
  var htmlAnchor = '<script src="./fleet-model.js?v=20260903-1"></script>';
  var htmlReplacement = htmlAnchor + '<script src="./fleet-input-adapter.js?v=20260903-3"></script>';

  if (htmlContent.indexOf(htmlAnchor) === -1) {
    /* Try without version query string */
    var htmlAnchorAlt = '<script src="./fleet-model.js';
    var idx = htmlContent.indexOf(htmlAnchorAlt);
    if (idx === -1) {
      console.error('ANCHOR NOT FOUND in', HTML_FILE, '— fleet-model.js script tag');
      process.exit(1);
    }
    /* Find the closing </script> after this anchor */
    var closeIdx = htmlContent.indexOf('</script>', idx);
    if (closeIdx === -1) {
      console.error('Could not find closing </script> for fleet-model.js');
      process.exit(1);
    }
    var insertPoint = closeIdx + '</script>'.length;
    htmlContent = htmlContent.slice(0, insertPoint) + '<script src="./fleet-input-adapter.js?v=20260903-3"></script>' + htmlContent.slice(insertPoint);
    console.log('PATCH', HTML_FILE, '— added script tag (alt anchor)');
  } else {
    htmlContent = htmlContent.replace(htmlAnchor, htmlReplacement);
    console.log('PATCH', HTML_FILE, '— added script tag');
  }

  writeFile(HTML_FILE, htmlContent);
}

/* ============================================================
 * 4. Syntax verification
 * ============================================================ */
console.log('\n--- Syntax Verification ---');
var allOk = true;
allOk = syntaxCheck(ADAPTER_FILE) && allOk;
allOk = syntaxCheck(RUNTIME_FILE) && allOk;

/* For HTML, extract script blocks and check each */
var htmlFinal = readFile(HTML_FILE);
var scriptRegex = /<script(?:\s[^>]*)?>([^<]*)<\/script>/gi;
var match;
var blockIndex = 0;
while ((match = scriptRegex.exec(htmlFinal)) !== null) {
  blockIndex++;
  var code = match[1].trim();
  if (!code || code.length < 10) continue;
  try {
    new Function(code);
  } catch (e) {
    console.error('SYNTAX FAIL: HTML script block #' + blockIndex, e.message.slice(0, 200));
    allOk = false;
  }
}
if (blockIndex > 0) console.log('Checked', blockIndex, 'script blocks in', HTML_FILE);

if (allOk) {
  console.log('\n✓ All syntax checks passed');
} else {
  console.error('\n✗ Syntax errors detected — review above');
  process.exit(1);
}

/* ============================================================
 * 5. Readback verification
 * ============================================================ */
console.log('\n--- Readback Verification ---');

/* Adapter: first and last 3 lines */
var adapterFinal = readFile(ADAPTER_FILE);
var adapterLines = adapterFinal.split('\n');
console.log(ADAPTER_FILE, ':', adapterLines.length, 'lines');
console.log('  first:', adapterLines[0].trim());
console.log('  last:', adapterLines[adapterLines.length - 2].trim());

/* Runtime: check adapter ref and inputSnapshot */
var runtimeFinal = readFile(RUNTIME_FILE);
console.log(RUNTIME_FILE, '— adapter ref:', runtimeFinal.indexOf('global.FleetInputAdapter') !== -1 ? 'FOUND' : 'MISSING');
console.log(RUNTIME_FILE, '— inputSnapshot:', runtimeFinal.indexOf('campaign.inputSnapshot') !== -1 ? 'FOUND' : 'MISSING');

/* HTML: check script tag */
var htmlReadback = readFile(HTML_FILE);
console.log(HTML_FILE, '— fleet-input-adapter.js tag:', htmlReadback.indexOf('fleet-input-adapter.js') !== -1 ? 'FOUND' : 'MISSING');
