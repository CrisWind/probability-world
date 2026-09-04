/* Step 4: quest + achievement + reward + archive integration
 * Idempotent: checks markers before each change. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');

function writeFile(relPath, content) {
  const full = path.join(BASE, relPath);
  fs.writeFileSync(full, content, 'utf8');
  console.log('WRITE', relPath, '(' + content.length + ' bytes)');
}
function readFile(relPath) {
  return fs.readFileSync(path.join(BASE, relPath), 'utf8');
}
function syntaxCheck(relPath) {
  const full = path.join(BASE, relPath);
  try {
    execSync('node -c "' + full + '"', { stdio: 'pipe' });
    console.log('SYNTAX OK:', relPath);
    return true;
  } catch (e) {
    console.error('SYNTAX FAIL:', relPath, e.stderr ? e.stderr.toString().slice(0, 500) : e.message);
    return false;
  }
}

/* ============================================================
 * 1. Create fleet-stats.js
 * ============================================================ */
const STATS_FILE = 'fleet-stats.js';
const STATS_MARKER = 'FleetStats';

const statsContent = `/* 概率世界 · 商会船队风险盘 —— 行为统计
 * 监听风险盘事件，将行为模式写入 stats.flags.fleet，供成就系统 stat_check 使用。
 * 不修改任务、成就、资金或风险模型。 */
(function attachFleetStats(global) {
  'use strict';
  var store = global.__gameStore;
  var bus = global.GameEventBus;
  var config = function() { return global.FLEET_CONFIG; };
  if (!store || !bus) return;

  var unsubscribers = [];

  function setFlag(key, value) {
    var flags = store.get('stats.flags') || {};
    if (!flags.fleet) flags.fleet = {};
    flags.fleet[key] = value;
    store.set('stats.flags', flags);
    store.scheduleSave && store.scheduleSave();
  }

  function handlePlanSubmitted(event) {
    var p = event.payload || {};
    var assignments = p.assignments || {};
    var cfg = config();
    if (!cfg) return;
    var vessels = cfg.vessels;
    var assigned = [];
    for (var i = 0; i < vessels.length; i++) {
      if (assignments[vessels[i].shipId] !== null && assignments[vessels[i].shipId] !== undefined) {
        assigned.push({ shipId: vessels[i].shipId, routeId: assignments[vessels[i].shipId], batchId: vessels[i].batchId });
      }
    }
    if (assigned.length < 2) return;
    var routeSet = {};
    var batchSet = {};
    for (var j = 0; j < assigned.length; j++) {
      routeSet[assigned[j].routeId] = true;
      batchSet[assigned[j].batchId] = true;
    }
    var diversified = Object.keys(routeSet).length > 1 || Object.keys(batchSet).length > 1;
    setFlag('diversified_assignments', diversified);
  }

  function handleCampaignCompleted(event) {
    var p = event.payload || {};
    var rounds = p.rounds || [];
    var finalReserve = typeof p.reserve === 'number' ? p.reserve : (typeof p.finalReserve === 'number' ? p.finalReserve : 0);
    var stormsOccurred = false;
    for (var i = 0; i < rounds.length; i++) {
      if (rounds[i].storms && rounds[i].storms.length > 0) { stormsOccurred = true; break; }
    }
    if (!stormsOccurred) return;
    var cfg = config();
    if (!cfg) return;
    var camp = store.get('world.fleet.activeCampaign');
    if (!camp) {
      var archived = store.get('world.fleet.archivedCampaigns') || [];
      for (var k = archived.length - 1; k >= 0; k--) {
        if (archived[k].campaignId === p.campaignId) { camp = archived[k]; break; }
      }
    }
    if (!camp || !camp.assignments) return;
    var vessels = cfg.vessels;
    var totalCargoValue = 0;
    for (var j = 0; j < vessels.length; j++) {
      if (camp.assignments[vessels[j].shipId] !== null && camp.assignments[vessels[j].shipId] !== undefined) {
        totalCargoValue += vessels[j].cargoValue;
      }
    }
    if (totalCargoValue <= 0) return;
    var reservesAdequate = finalReserve >= totalCargoValue * 0.15;
    setFlag('storm_reserves_held', reservesAdequate);
  }

  function handleEvent(event) {
    if (!event || !event.type) return;
    if (event.type === 'fleet_plan_submitted') handlePlanSubmitted(event);
    if (event.type === 'fleet_campaign_completed') handleCampaignCompleted(event);
  }

  function init() {
    if (unsubscribers.length) return;
    unsubscribers.push(bus.on('fleet_plan_submitted', handleEvent));
    unsubscribers.push(bus.on('fleet_campaign_completed', handleEvent));
  }

  function dispose() {
    unsubscribers.splice(0).forEach(function(fn) { fn(); });
  }

  init();
  global.FleetStats = Object.freeze({ init: init, dispose: dispose, handleEvent: handleEvent });
})(typeof window !== 'undefined' ? window : globalThis);
`;

if (fs.existsSync(path.join(BASE, STATS_FILE))) {
  var existingStats = readFile(STATS_FILE);
  if (existingStats.indexOf(STATS_MARKER) !== -1) {
    console.log('SKIP', STATS_FILE, '— already applied');
  } else { writeFile(STATS_FILE, statsContent); }
} else { writeFile(STATS_FILE, statsContent); }

/* ============================================================
 * 2. Patch fleet-runtime.js: enhanced fleet_campaign_completed
 * ============================================================ */
var RT_FILE = 'fleet-runtime.js';
var RT_MARKER = "cumulativeVoyageIncome";

var rtContent = readFile(RT_FILE);
if (rtContent.indexOf(RT_MARKER) !== -1) {
  console.log('SKIP', RT_FILE, '— enhanced payload already present');
} else {
  var rtOld = [
    "    if (roundResult.insolvent) {",
    "      camp.phase = 'insolvent';",
    "      emit('fleet_insolvent', {",
    "        round: camp.currentRound,",
    "        campaignId: camp.campaignId,",
    "        assignments: Object.assign({}, camp.assignments),",
    "        voyageIncome: roundResult.voyageIncome,",
    "        cargoLoss: roundResult.cargoLoss,",
    "        reserveUsed: roundResult.reserveUsed,",
    "        operatingCashAfter: roundResult.operatingCashAfter,",
    "        reserveAfter: roundResult.reserveAfter,",
    "        insolvent: true",
    "      });",
    "    } else if (camp.currentRound >= camp.totalRounds) {",
    "      camp.phase = 'completed';",
    "      emit('fleet_campaign_completed', {",
    "        campaignId: camp.campaignId,",
    "        totalRounds: camp.totalRounds,",
    "        finalOperatingCash: camp.operatingCash,",
    "        finalReserve: camp.reserve,",
    "        finalTotalFunds: roundResult.totalFundsAfter",
    "      });",
    "    } else {",
    "      camp.currentRound++;",
    "      camp.phase = 'planning';",
    "    }"
  ].join('\n');

  var rtNew = [
    "    if (roundResult.insolvent) {",
    "      camp.phase = 'insolvent';",
    "      emit('fleet_insolvent', {",
    "        round: camp.currentRound,",
    "        campaignId: camp.campaignId,",
    "        assignments: Object.assign({}, camp.assignments),",
    "        voyageIncome: roundResult.voyageIncome,",
    "        cargoLoss: roundResult.cargoLoss,",
    "        reserveUsed: roundResult.reserveUsed,",
    "        operatingCashAfter: roundResult.operatingCashAfter,",
    "        reserveAfter: roundResult.reserveAfter,",
    "        insolvent: true",
    "      });",
    "    } else if (camp.currentRound >= camp.totalRounds) {",
    "      camp.phase = 'completed';",
    "    } else {",
    "      camp.currentRound++;",
    "      camp.phase = 'planning';",
    "    }",
    "",
    "    /* Step 4: fleet_campaign_completed fires on every campaign end (normal or insolvent) */",
    "    if (camp.phase === 'completed' || camp.phase === 'insolvent') {",
    "      var cumulativeVoyageIncome = 0, cumulativeCargoLoss = 0;",
    "      var totalReinsuranceCost = 0, totalReinsuranceRecovery = 0;",
    "      for (var ri = 0; ri < camp.rounds.length; ri++) {",
    "        cumulativeVoyageIncome += camp.rounds[ri].voyageIncome || 0;",
    "        cumulativeCargoLoss += camp.rounds[ri].cargoLoss || 0;",
    "        totalReinsuranceCost += camp.rounds[ri].reinsuranceCost || 0;",
    "        totalReinsuranceRecovery += camp.rounds[ri].reinsuranceRecovery || 0;",
    "      }",
    "      emit('fleet_campaign_completed', {",
    "        campaignId: camp.campaignId,",
    "        seed: camp.seed,",
    "        roundsSettled: camp.rounds.length,",
    "        outcome: camp.phase,",
    "        operatingCash: camp.operatingCash,",
    "        reserve: camp.reserve,",
    "        totalFunds: Math.round((camp.operatingCash + camp.reserve) * 100) / 100,",
    "        cumulativeVoyageIncome: Math.round(cumulativeVoyageIncome * 100) / 100,",
    "        cumulativeCargoLoss: Math.round(cumulativeCargoLoss * 100) / 100,",
    "        totalReinsuranceCost: Math.round(totalReinsuranceCost * 100) / 100,",
    "        totalReinsuranceRecovery: Math.round(totalReinsuranceRecovery * 100) / 100,",
    "        insolvent: camp.phase === 'insolvent',",
    "        rounds: camp.rounds",
    "      });",
    "    }"
  ].join('\n');

  if (rtContent.indexOf(rtOld) === -1) {
    console.error('ANCHOR NOT FOUND in', RT_FILE);
    process.exit(1);
  }
  rtContent = rtContent.replace(rtOld, rtNew);
  writeFile(RT_FILE, rtContent);
  console.log('PATCH', RT_FILE, '— enhanced campaign_completed + always emit');
}

/* ============================================================
 * 3. Patch quest-definitions.js: add fleet quest
 * ============================================================ */
var QD_FILE = 'quest-definitions.js';
var QD_MARKER = 'quest.fleet_storm_ledger';

var qdContent = readFile(QD_FILE);
if (qdContent.indexOf(QD_MARKER) !== -1) {
  console.log('SKIP', QD_FILE, '— fleet quest already present');
} else {
  var qdAnchor = "      worldEffects:null\n    })\n  });";
  var qdReplacement = [
    "      worldEffects:null",
    "    }),",
    "    'quest.fleet_storm_ledger':Object.freeze({",
    "      id:'quest.fleet_storm_ledger',",
    "      type:'side',",
    "      title:'风暴季的账本',",
    "      summary:'商会需要有人跑完一整季船队风险盘，证明航线不是靠运气撑过去的。',",
    "      giverNpcId:null,",
    "      locationHint:'fleet',",
    "      unlockWhen:Object.freeze({event:'fleet_plan_submitted'}),",
    "      activateWhen:Object.freeze({event:'fleet_plan_submitted'}),",
    "      steps:Object.freeze([",
    "        Object.freeze({id:'complete_campaign',text:'完成一次完整的船队风险 campaign。',completeWhen:Object.freeze({event:'fleet_campaign_completed'}),outcomeId:null})",
    "      ]),",
    "      rewards:Object.freeze([",
    "        Object.freeze({id:'coins_18',type:'coins',amount:18})",
    "      ]),",
    "      worldEffects:null",
    "    })",
    "  });"
  ].join('\n');

  if (qdContent.indexOf(qdAnchor) === -1) {
    console.error('ANCHOR NOT FOUND in', QD_FILE);
    process.exit(1);
  }
  qdContent = qdContent.replace(qdAnchor, qdReplacement);
  writeFile(QD_FILE, qdContent);
  console.log('PATCH', QD_FILE, '— added fleet quest');
}

/* ============================================================
 * 4. Patch achievement-definitions.js: add 2 fleet achievements
 * ============================================================ */
var AD_FILE = 'achievement-definitions.js';
var AD_MARKER = 'achievement.fleet_diversified';

var adContent = readFile(AD_FILE);
if (adContent.indexOf(AD_MARKER) !== -1) {
  console.log('SKIP', AD_FILE, '— fleet achievements already present');
} else {
  var adAnchor = "condition:freeze({type:'event_match',eventType:'inspection_completed',payload:freeze({defectsFound:0,decision:['repair_partial','repair_full','hold']})}),groupId:null})\n});";
  var adReplacement = [
    "condition:freeze({type:'event_match',eventType:'inspection_completed',payload:freeze({defectsFound:0,decision:['repair_partial','repair_full','hold']})}),groupId:null}),",
    "  'achievement.fleet_diversified':freeze({id:'achievement.fleet_diversified',category:'restraint',title:'没有把船都押在一处',description:'在同一轮方案中，主动分散了航线或批次集中度。',visibility:'visible',progressMode:'none',condition:freeze({type:'stat_check',statPath:'fleet.diversified_assignments'}),groupId:null}),",
    "  'achievement.fleet_storm_reserves':freeze({id:'achievement.fleet_storm_reserves',category:'restraint',title:'风暴前留有余地',description:'在遭遇风暴的战役中保持了充足的准备金。',visibility:'named_hidden',progressMode:'none',condition:freeze({type:'stat_check',statPath:'fleet.storm_reserves_held'}),groupId:null})",
    "});"
  ].join('\n');

  if (adContent.indexOf(adAnchor) === -1) {
    console.error('ANCHOR NOT FOUND in', AD_FILE);
    process.exit(1);
  }
  adContent = adContent.replace(adAnchor, adReplacement);
  writeFile(AD_FILE, adContent);
  console.log('PATCH', AD_FILE, '— added 2 fleet achievements');
}

/* ============================================================
 * 5. Patch achievement-runtime.js: stat_check + fleet subs + backfill
 * ============================================================ */
var AR_FILE = 'achievement-runtime.js';
var AR_MARKER = "stat_check";

var arContent = readFile(AR_FILE);
if (arContent.indexOf(AR_MARKER) !== -1) {
  console.log('SKIP', AR_FILE, '— stat_check already present');
} else {
  /* 5a. Extend matchesCondition to support stat_check */
  var arAnchor1 = [
    "  function matchesCondition(condition, event) {",
    "    if (!condition || condition.type !== 'event_match' || !event) return false;",
    "    if (condition.eventType !== event.type) return false;",
    "    return payloadMatches(condition.payload, event.payload);",
    "  }"
  ].join('\n');
  var arNew1 = [
    "  function matchesCondition(condition, event) {",
    "    if (!condition) return false;",
    "    if (condition.type === 'stat_check') {",
    "      var flagPath = 'stats.flags.' + condition.statPath;",
    "      return !!store.get(flagPath);",
    "    }",
    "    if (condition.type !== 'event_match' || !event) return false;",
    "    if (condition.eventType !== event.type) return false;",
    "    return payloadMatches(condition.payload, event.payload);",
    "  }"
  ].join('\n');

  if (arContent.indexOf(arAnchor1) === -1) {
    console.error('ANCHOR 1 NOT FOUND in', AR_FILE);
    process.exit(1);
  }
  arContent = arContent.replace(arAnchor1, arNew1);
  console.log('PATCH', AR_FILE, '— added stat_check to matchesCondition');

  /* 5b. Add fleet event subscriptions */
  var arAnchor2 = "unsubscribers = [bus.on('choice_made', handleEvent), bus.on('quest_completed', handleEvent), bus.on('inspection_completed', handleEvent)];";
  var arNew2 = "unsubscribers = [bus.on('choice_made', handleEvent), bus.on('quest_completed', handleEvent), bus.on('inspection_completed', handleEvent), bus.on('fleet_campaign_completed', handleEvent), bus.on('fleet_round_settled', handleEvent)];";

  if (arContent.indexOf(arAnchor2) === -1) {
    console.error('ANCHOR 2 NOT FOUND in', AR_FILE);
    process.exit(1);
  }
  arContent = arContent.replace(arAnchor2, arNew2);
  console.log('PATCH', AR_FILE, '— added fleet event subscriptions');

  /* 5c. Add persistedFleetStat after persistedFactAt */
  if (arContent.indexOf('function persistedFleetStat') !== -1) {
    console.log('SKIP', AR_FILE, '— persistedFleetStat already present');
  } else {
    var arAnchor3 = [
      "    if (condition.eventType === 'quest_completed' && condition.payload && condition.payload.questId) {",
      "      var quests = store.get('quests', {}) || {};",
      "      var instance = quests.instances && quests.instances[condition.payload.questId];",
      "      if (instance && instance.status === 'completed') return instance.completedAt || fallbackAt;",
      "    }",
      "    return null;",
      "  }"
    ].join('\n');
    var arNew3 = [
      "    if (condition.eventType === 'quest_completed' && condition.payload && condition.payload.questId) {",
      "      var quests = store.get('quests', {}) || {};",
      "      var instance = quests.instances && quests.instances[condition.payload.questId];",
      "      if (instance && instance.status === 'completed') return instance.completedAt || fallbackAt;",
      "    }",
      "    return null;",
      "  }",
      "",
      "  function persistedFleetStat(definition) {",
      "    var condition = definition && definition.condition;",
      "    if (!condition || condition.type !== 'stat_check') return null;",
      "    var flagPath = 'stats.flags.' + condition.statPath;",
      "    if (!store.get(flagPath)) return null;",
      "    return store.get('meta.savedAt', null) || new Date().toISOString();",
      "  }"
    ].join('\n');

    if (arContent.indexOf(arAnchor3) === -1) {
      console.error('ANCHOR 3 NOT FOUND in', AR_FILE);
      process.exit(1);
    }
    arContent = arContent.replace(arAnchor3, arNew3);
    console.log('PATCH', AR_FILE, '— added persistedFleetStat');
  }

  /* 5d. Wire persistedFleetStat into backfill */
  if (arContent.indexOf('persistedFactAt(definition) || persistedFleetStat(definition)') !== -1) {
    console.log('SKIP', AR_FILE, '— fleet backfill already wired');
  } else {
    var arAnchor4 = "      var factAt = persistedFactAt(definition);";
    var arNew4 = "      var factAt = persistedFactAt(definition) || persistedFleetStat(definition);";

    if (arContent.indexOf(arAnchor4) === -1) {
      console.error('ANCHOR 4 NOT FOUND in', AR_FILE);
      process.exit(1);
    }
    arContent = arContent.replace(arAnchor4, arNew4);
    console.log('PATCH', AR_FILE, '— wired fleet backfill into backfill()');
  }

  writeFile(AR_FILE, arContent);
}

/* ============================================================
 * 6. Patch index.html: add fleet-stats.js script tag
 * ============================================================ */
var HTML_FILE = 'index.html';
var HTML_MARKER = 'fleet-stats.js';

var htmlContent = readFile(HTML_FILE);
if (htmlContent.indexOf(HTML_MARKER) !== -1) {
  console.log('SKIP', HTML_FILE, '— fleet-stats.js tag already present');
} else {
  var htmlAnchor = '<script src="./fleet-input-adapter.js?v=20260903-3"></script>';
  var htmlReplacement = htmlAnchor + '<script src="./fleet-stats.js?v=20260903-4"></script>';

  if (htmlContent.indexOf(htmlAnchor) === -1) {
    console.error('ANCHOR NOT FOUND in', HTML_FILE);
    process.exit(1);
  }
  htmlContent = htmlContent.replace(htmlAnchor, htmlReplacement);
  writeFile(HTML_FILE, htmlContent);
  console.log('PATCH', HTML_FILE, '— added fleet-stats.js script tag');
}

/* ============================================================
 * 7. Syntax verification
 * ============================================================ */
console.log('\n--- Syntax Verification ---');
var allOk = true;
allOk = syntaxCheck(STATS_FILE) && allOk;
allOk = syntaxCheck(RT_FILE) && allOk;
allOk = syntaxCheck(QD_FILE) && allOk;
allOk = syntaxCheck(AD_FILE) && allOk;
allOk = syntaxCheck(AR_FILE) && allOk;

/* HTML script blocks */
var htmlFinal = readFile(HTML_FILE);
var scriptRegex = /<script(?:\s[^>]*)?>([^<]*)<\/script>/gi;
var match, blockIndex = 0;
while ((match = scriptRegex.exec(htmlFinal)) !== null) {
  blockIndex++;
  var code = match[1].trim();
  if (!code || code.length < 10) continue;
  try { new Function(code); } catch (e) {
    console.error('SYNTAX FAIL: HTML script block #' + blockIndex, e.message.slice(0, 200));
    allOk = false;
  }
}
if (blockIndex > 0) console.log('Checked', blockIndex, 'script blocks in', HTML_FILE);

if (allOk) {
  console.log('\n✓ All syntax checks passed');
} else {
  console.error('\n✗ Syntax errors detected');
  process.exit(1);
}

/* ============================================================
 * 8. Readback verification
 * ============================================================ */
console.log('\n--- Readback Verification ---');
console.log(STATS_FILE, ':', readFile(STATS_FILE).split('\n').length, 'lines');
console.log(RT_FILE, '— cumulativeVoyageIncome:', readFile(RT_FILE).indexOf('cumulativeVoyageIncome') !== -1 ? 'FOUND' : 'MISSING');
console.log(QD_FILE, '— fleet_storm_ledger:', readFile(QD_FILE).indexOf('fleet_storm_ledger') !== -1 ? 'FOUND' : 'MISSING');
console.log(AD_FILE, '— fleet_diversified:', readFile(AD_FILE).indexOf('fleet_diversified') !== -1 ? 'FOUND' : 'MISSING');
console.log(AR_FILE, '— stat_check:', readFile(AR_FILE).indexOf('stat_check') !== -1 ? 'FOUND' : 'MISSING');
console.log(HTML_FILE, '— fleet-stats.js:', readFile(HTML_FILE).indexOf('fleet-stats.js') !== -1 ? 'FOUND' : 'MISSING');
