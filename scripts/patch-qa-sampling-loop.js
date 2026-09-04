/* QA 抽样代表性闭环 + 质检结果迁移到风险盘 —— 幂等补丁
 * 生成 sampling-learning.js；补丁：fleet-input-adapter / fleet-model / fleet-runtime /
 *     fleet-ui / shipyard-runtime / shipyard-ui / index.html
 * 每次 edit()：anchor 必须出现且唯一，marker 已存在则跳过（防重复）。
 * 仅 Node.js 执行；不含 apply_patch / PowerShell / git。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function write(rel, s) { fs.writeFileSync(path.join(ROOT, rel), s); }

const edits = [];
let appliedCount = 0, skippedCount = 0;

function edit(rel, label, oldStr, newStr, marker) {
  edits.push({ rel, label, oldStr, newStr, marker });
}

function run() {
  for (const e of edits) {
    const file = read(e.rel);
    if (e.marker && file.includes(e.marker)) {
      console.log('SKIP  [' + e.rel + '] ' + e.label + ' (marker already present)');
      skippedCount++;
      continue;
    }
    const occurrences = file.split(e.oldStr).length - 1;
    if (occurrences !== 1) {
      throw new Error('ANCHOR FAIL [' + e.rel + '] ' + e.label + ': found ' + occurrences + ' occurrences');
    }
    write(e.rel, file.replace(e.oldStr, e.newStr));
    console.log('APPLY [' + e.rel + '] ' + e.label);
    appliedCount++;
  }
}

/* =====================================================================
 * 1. 新建 sampling-learning.js —— sampling_representativeness 学习证据
 * ===================================================================== */
const SAMPLING_LEARNING = [
'/* 概率世界 · 抽样代表性学习证据层（sampling_representativeness）',
' * 概念：抽样代表性——样本覆盖之外的部位仍是未知，检查过的部分不代表未检查部分。',
' * 只把最小跨玩法证据写入 world.learning.concepts.sampling_representativeness：',
' *   encounters   = 玩家真实完成一次质检（报告已落盘）后记录一次（“已亲历”）；',
' *   applications = 风险盘中相对上一回合的实际方案调整涉及质检船/同批次船或准备金（“已使用/已迁移”）。',
' * 无 mastered/correct/wrong/score 字段；不建等级、不改成就/奖励、不操作 DOM、不发事件。',
' * 写入入口：shipyard-runtime.submitDecision（质检侧）+ fleet-runtime.submitPlan（风险盘侧）。 */',
'(function attachSamplingLearning(global) {',
"  'use strict';",
'',
'  var CONCEPT_ID = \'sampling_representativeness\';',
'',
'  function store() { return global.__gameStore; }',
'  function shipyardConfig() { return global.SHIPYARD_CONFIG; }',
'  function fleetLearning() { return global.FleetLearning; }',
'',
'  function readLearning() {',
'    var gs = store();',
'    if (!gs || !gs.get) return null;',
'    var l = gs.get(\'world.learning\');',
'    return l && typeof l === \'object\' ? l : null;',
'  }',
'',
'  function writeLearning(learning) {',
'    var gs = store();',
'    if (!gs || !gs.set) return;',
'    gs.set(\'world.learning\', learning);',
'    gs.save();',
'  }',
'',
'  function ensureConcept(learning) {',
'    var l = learning && typeof learning === \'object\' ? learning : { version: 1, concepts: {} };',
'    if (!l.concepts || typeof l.concepts !== \'object\') l.concepts = {};',
'    var c = l.concepts[CONCEPT_ID];',
'    if (!c) {',
'      c = { conceptId: CONCEPT_ID, encounters: [], applications: [] };',
'      l.concepts[CONCEPT_ID] = c;',
'    }',
'    if (!Array.isArray(c.encounters)) c.encounters = [];',
'    if (!Array.isArray(c.applications)) c.applications = [];',
'    return c;',
'  }',
'',
'  /* 质检批次 24 个部位 id 是确定性的（zone 1..6），只用于推导“未检查部位”清单，不重算缺陷。 */',
'  function allPartIds() {',
'    var cfg = shipyardConfig();',
'    if (!cfg || !cfg.batch) return [];',
'    var zones = cfg.batch.zones || [];',
'    var per = cfg.batch.partsPerZone || 6;',
'    var ids = [];',
'    for (var z = 0; z < zones.length; z++) {',
'      for (var i = 1; i <= per; i++) ids.push(zones[z] + \'-\' + i);',
'    }',
'    return ids;',
'  }',
'',
'  function difference(all, sampled) {',
'    var result = [];',
'    for (var i = 0; i < all.length; i++) {',
'      if (sampled.indexOf(all[i]) === -1) result.push(all[i]);',
'    }',
'    return result;',
'  }',
'',
'  /* ---- 亲历：质检报告落盘后记录（同 reportId 只记一次） ---- */',
'  function recordInspectionEncounter(report) {',
'    if (!report || !report.reportId || !report.shipId) return null;',
'    var l = readLearning() || { version: 1, concepts: {} };',
'    var c = ensureConcept(l);',
'    for (var i = 0; i < c.encounters.length; i++) {',
'      if (c.encounters[i] && c.encounters[i].reportId === report.reportId) return c.encounters[i];',
'    }',
'    var sampled = Array.isArray(report.sampledParts) ? report.sampledParts : [];',
'    var outcome = report.actualOutcome || {};',
'    var entry = {',
'      reportId: report.reportId,',
'      shipId: report.shipId,',
'      sampledParts: sampled.slice(),',
'      uninspectedParts: difference(allPartIds(), sampled),',
'      defectsFound: Array.isArray(report.defectsFound) ? report.defectsFound.slice() : [],',
'      actualDefects: Array.isArray(outcome.allDefectIds) ? outcome.allDefectIds.slice() : [],',
'      decision: report.decision,',
'      outcome: {',
'        sailed: outcome.sailed === true,',
'        accident: outcome.accident === true,',
'        accidentCause: outcome.accidentCause || null,',
'        remainingDefects: Array.isArray(outcome.remainingDefects) ? outcome.remainingDefects.slice() : [],',
'        missedDefects: Array.isArray(outcome.missedDefects) ? outcome.missedDefects.slice() : []',
'      }',
'    };',
'    c.encounters.push(entry);',
'    writeLearning(l);',
'    return entry;',
'  }',
'',
'  /* ---- 风险盘应用：仅当快照带质检效果、且调整涉及质检船或其同批次船/准备金 ----',
'   * 复用 FleetLearning.planChanges（事实差异），再补“被强制留港后恢复出航”这一项；',
'   * 只记录实际发生的安排，不做因果断言。 ---- */',
'  function fleetAdjustmentChanges(campaign, prevRoundRes, curAssignments, curReserve) {',
'    if (!campaign || !prevRoundRes) return [];',
'    var effects = Array.isArray(campaign.shipyardEffects) ? campaign.shipyardEffects : [];',
'    if (effects.length === 0) return [];',
'    var cfg = global.FLEET_CONFIG || null;',
'    var vessels = cfg && Array.isArray(cfg.vessels) ? cfg.vessels : [];',
'    var batchOf = {}, membersOf = {};',
'    for (var i = 0; i < vessels.length; i++) {',
'      batchOf[vessels[i].shipId] = vessels[i].batchId;',
'      if (!membersOf[vessels[i].batchId]) membersOf[vessels[i].batchId] = [];',
'      membersOf[vessels[i].batchId].push(vessels[i].shipId);',
'    }',
'    var relevant = {};',
'    for (var e = 0; e < effects.length; e++) {',
'      var sid = effects[e].shipId;',
'      relevant[sid] = true;',
'      var bid = batchOf[sid];',
'      var members = membersOf[bid] || [];',
'      for (var m = 0; m < members.length; m++) relevant[members[m]] = true;',
'    }',
'    var fl = fleetLearning();',
'    var base = (fl && fl.planChanges) ? fl.planChanges(',
'      prevRoundRes.assignments || {}, curAssignments || {},',
'      typeof prevRoundRes.reserveAfter === \'number\' ? prevRoundRes.reserveAfter : 0,',
'      typeof curReserve === \'number\' ? curReserve : 0',
'    ) : [];',
'    var changes = [];',
'    for (var b = 0; b < base.length; b++) {',
'      var ch = base[b];',
'      if (ch.change === \'reserve-increased\') { changes.push(ch); continue; }',
'      if (ch.shipId && relevant[ch.shipId]) changes.push(ch);',
'    }',
'    var prev = prevRoundRes.assignments || {};',
'    var cur = curAssignments || {};',
'    for (var s = 0; s < vessels.length; s++) {',
'      var v = vessels[s];',
'      if (!relevant[v.shipId]) continue;',
'      var wasSailing = prev[v.shipId] !== null && prev[v.shipId] !== undefined;',
'      var nowSailing = cur[v.shipId] !== null && cur[v.shipId] !== undefined;',
'      if (!wasSailing && nowSailing) {',
'        changes.push({ change: \'ship-set-sailing\', shipId: v.shipId, fromRoute: null, toRoute: cur[v.shipId] });',
'      }',
'    }',
'    return changes;',
'  }',
'',
'  /* ---- 风险盘应用证据（同 campaignId+round+sourceReportId 只记一次） ---- */',
'  function recordFleetApplication(campaign, changes, sourceReportId) {',
'    if (!campaign || !campaign.campaignId || !changes || changes.length === 0 || !sourceReportId) return null;',
'    var l = readLearning() || { version: 1, concepts: {} };',
'    var c = ensureConcept(l);',
'    var round = campaign.currentRound;',
'    for (var i = 0; i < c.applications.length; i++) {',
'      var a = c.applications[i];',
'      if (a && a.campaignId === campaign.campaignId && a.round === round && a.sourceReportId === sourceReportId) return a;',
'    }',
'    var entry = { campaignId: campaign.campaignId, round: round, changes: changes, sourceReportId: sourceReportId };',
'    c.applications.push(entry);',
'    writeLearning(l);',
'    return entry;',
'  }',
'',
'  function getConcept() {',
'    var l = readLearning();',
'    if (!l || !l.concepts || !l.concepts[CONCEPT_ID]) return null;',
'    return l.concepts[CONCEPT_ID];',
'  }',
'',
'  global.SamplingLearning = Object.freeze({',
'    recordInspectionEncounter: recordInspectionEncounter,',
'    fleetAdjustmentChanges: fleetAdjustmentChanges,',
'    recordFleetApplication: recordFleetApplication,',
'    getConcept: getConcept',
'  });',
'})(typeof window !== \'undefined\' ? window : globalThis);',
''
].join('\n');

fs.writeFileSync(path.join(ROOT, 'sampling-learning.js'), SAMPLING_LEARNING);
console.log('CREATE sampling-learning.js');

/* =====================================================================
 * 2. fleet-input-adapter.js —— QA 效果派生（纯函数，不写存档）
 * ===================================================================== */
edit('fleet-input-adapter.js', 'header V0.3->V0.4',
  '/* 概率世界 · 商会船队风险盘 V0.3 —— 输入适配层',
  '/* 概率世界 · 商会船队风险盘 V0.4 —— 输入适配层',
  'V0.4 —— 输入适配层');

/* 2a. 模块内常量（放 store/config 之后） */
edit('fleet-input-adapter.js', 'add QA_RULES constants',
  '  var store = function() { return global.__gameStore; };\n  var config = function() { return global.FLEET_CONFIG; };',
  '  var store = function() { return global.__gameStore; };\n  var config = function() { return global.FLEET_CONFIG; };\n\n  /* ---- 质检→船队效果策略常量（单点维护；乘入事故概率，仍由风险模型与 seed 结算） ---- */\n  var QA_RULES = {\n    modFullRepair: 0.6,\n    modPartialClean: 0.8,\n    modPartialPerRemaining: 0.12,\n    modReleasePerRemaining: 0.18,\n    modHoldPerActualDefect: 0.18\n  };\n\n  function shipyardCfg() {\n    var c = global.SHIPYARD_CONFIG;\n    return (c && c.batch) ? c.batch : null;\n  }',
  'var QA_RULES');

/* 2b. 派生函数（插在 countUnmatchedMarket 之后、buildCampaignInputSnapshot 之前） */
edit('fleet-input-adapter.js', 'add deriveShipyardEffects + getShipyardEffects',
  '  function countUnmatchedMarket(vessels, profile) {',
  '  /* 派生单船质检效果：取该船最新一份已完成报告（按 completedAt），\n   * 只引用报告已存事实（decision/repairLevel/样本与真实缺陷数量），不重算抽样、不复制报告。\n   * 效果固定于 campaign 开始时（快照冻结），campaign 期间新质检不静默生效。 */\n  function deriveShipyardEffects(vessels, reports) {\n    var batch = shipyardCfg();\n    var totalParts = (batch && batch.totalParts) || 24;\n    var byVessel = {};\n    for (var i = 0; i < vessels.length; i++) byVessel[vessels[i].name] = vessels[i];\n    var latestById = {};\n    for (var r = 0; r < reports.length; r++) {\n      var rep = reports[r];\n      if (!rep || !rep.shipName || !byVessel[rep.shipName]) continue;\n      var prev = latestById[rep.shipName];\n      if (!prev || String(rep.completedAt || \'\') >= String(prev.completedAt || \'\')) latestById[rep.shipName] = rep;\n    }\n    var effects = [];\n    var names = Object.keys(latestById);\n    for (var n = 0; n < names.length; n++) {\n      var name = names[n];\n      var report = latestById[name];\n      var vessel = byVessel[name];\n      var out = report.actualOutcome || {};\n      var sampledCount = Array.isArray(report.sampledParts) ? report.sampledParts.length : 0;\n      var foundCount = Array.isArray(report.defectsFound) ? report.defectsFound.length : 0;\n      var actualCount = Array.isArray(out.allDefectIds) ? out.allDefectIds.length : 0;\n      var remainingCount = Array.isArray(out.remainingDefects) ? out.remainingDefects.length : 0;\n      var missedCount = Array.isArray(out.missedDefects) ? out.missedDefects.length : 0;\n      var qaMod = null;\n      var holdRound1 = false;\n      if (report.repairLevel === \'full\') {\n        qaMod = QA_RULES.modFullRepair;            /* 全面返修：整体风险下降但不清零 */\n      } else if (report.repairLevel === \'partial\') {\n        qaMod = remainingCount > 0\n          ? 1 + QA_RULES.modPartialPerRemaining * remainingCount\n          : QA_RULES.modPartialClean;              /* 样本发现的缺陷已全部修复 */\n      } else if (report.repairLevel === \'none\') {\n        qaMod = remainingCount > 0\n          ? 1 + QA_RULES.modReleasePerRemaining * remainingCount\n          : 1;                                     /* 样本无发现≠绝对安全，未检查部位仍未知 */\n      } else if (report.repairLevel === \'hold\') {\n        holdRound1 = true;                         /* 错过这一潮：campaign 第 1 回合自动留港 */\n        qaMod = 1 + QA_RULES.modHoldPerActualDefect * Math.max(actualCount, 0); /* 第 2 回合起出航适用 */\n      }\n      effects.push({\n        shipId: vessel.shipId,\n        shipName: vessel.name,\n        sourceReportId: report.reportId,\n        sourceCompletedAt: report.completedAt || null,\n        decision: report.decision,\n        repairLevel: report.repairLevel,\n        sampledCount: sampledCount,\n        uninspectedCount: totalParts - sampledCount,\n        foundCount: foundCount,\n        actualDefectCount: actualCount,\n        missedCount: missedCount,\n        remainingCount: remainingCount,\n        sailed: out.sailed === true,\n        accident: out.accident === true,\n        accidentCause: out.accidentCause || null,\n        holdRound1: holdRound1,\n        qaMod: Math.round(qaMod * 1000) / 1000\n      });\n    }\n    return effects;\n  }\n\n  /* 读取快照中的质检效果（只读；无快照返回空数组） */\n  function getShipyardEffects(snapshot) {\n    if (!snapshot) return [];\n    if (Array.isArray(snapshot.shipyardEffects)) return snapshot.shipyardEffects;\n    if (snapshot.shipyard && Array.isArray(snapshot.shipyard.effects)) return snapshot.shipyard.effects;\n    return [];\n  }\n\n  function countUnmatchedMarket(vessels, profile) {',
  'function deriveShipyardEffects');

/* 2c. 主快照追加 shipyardEffects */
edit('fleet-input-adapter.js', 'snapshot gains shipyardEffects',
  '    return {\n      capturedAt: new Date().toISOString(),\n      shipyard: buildShipyardSignals(vessels, reports),\n      market: buildMarketSignals(vessels, marketProfile),',
  '    return {\n      capturedAt: new Date().toISOString(),\n      shipyard: buildShipyardSignals(vessels, reports),\n      shipyardEffects: deriveShipyardEffects(vessels, reports),\n      market: buildMarketSignals(vessels, marketProfile),',
  'shipyardEffects: deriveShipyardEffects(vessels, reports)');

/* 2d. 导出 */
edit('fleet-input-adapter.js', 'export derive/get',
  '  global.FleetInputAdapter = Object.freeze({\n    buildCampaignInputSnapshot: buildCampaignInputSnapshot,\n    getInputSnapshot: getInputSnapshot,',
  '  global.FleetInputAdapter = Object.freeze({\n    buildCampaignInputSnapshot: buildCampaignInputSnapshot,\n    getInputSnapshot: getInputSnapshot,\n    deriveShipyardEffects: deriveShipyardEffects,\n    getShipyardEffects: getShipyardEffects,',
  'getShipyardEffects: getShipyardEffects');

/* =====================================================================
 * 3. fleet-model.js —— 可选 QA 修正系数通道（不调用时行为与公式不变）
 * ===================================================================== */
edit('fleet-model.js', 'accidentProbability optional qaMod',
  '    var p = baseP * hullMod * volMod * batchMod * stormMod;\n    return Math.min(p, 0.95);\n  }',
  '    var p = baseP * hullMod * volMod * batchMod * stormMod;\n    /* 可选质检修正（无则不变）：由 campaign 快照派生，仍走同一事故概率上限 */\n    if (typeof qaMod === \'number\') p = p * qaMod;\n    return Math.min(p, 0.95);\n  }',
  'if (typeof qaMod === \'number\') p = p * qaMod;');

edit('fleet-model.js', 'resolveVessel signature + qaMod use + modifiers.qa',
  '  function resolveVessel(vessel, routeId, commonRiskState, storms, seed, round) {\n    var sailing = routeId !== null;',
  '  function resolveVessel(vessel, routeId, commonRiskState, storms, seed, round, qaMod) {\n    var sailing = routeId !== null;',
  'function resolveVessel(vessel, routeId, commonRiskState, storms, seed, round, qaMod)');

edit('fleet-model.js', 'accidentProbability call in resolveVessel',
  '    var effectiveP = accidentProbability(vessel, route, commonRiskState, storms);\n\n    var stormHit = false;',
  '    var effectiveP = accidentProbability(vessel, route, commonRiskState, storms, qaMod);\n\n    var stormHit = false;',
  'accidentProbability(vessel, route, commonRiskState, storms, qaMod)');

edit('fleet-model.js', 'resolveVessel modifiers gain qa',
  '      modifiers: { storm: stormHit, batchDefect: batchDefective, stormSeverity: stormSeverity || null },',
  '      modifiers: { storm: stormHit, batchDefect: batchDefective, stormSeverity: stormSeverity || null, qa: (typeof qaMod === \'number\' && qaMod !== 1) ? qaMod : null },',
  'qa: (typeof qaMod === \'number\' && qaMod !== 1) ? qaMod : null');

edit('fleet-model.js', 'resolveRound signature + qaMods map',
  '  function resolveRound(assignments, commonRiskState, seed, round, funds) {\n    var cfg = CONFIG();\n    var vessels = cfg.vessels;\n    var storms = resolveStorms(round, seed, cfg.routes);\n\n    var vesselResults = [];\n    for (var i = 0; i < vessels.length; i++) {\n      var v = vessels[i];\n      var routeId = assignments[v.shipId] !== undefined ? assignments[v.shipId] : v.defaultRouteId;\n      vesselResults.push(resolveVessel(v, routeId, commonRiskState, storms, seed, round));\n    }',
  '  function resolveRound(assignments, commonRiskState, seed, round, funds, qaMods) {\n    var cfg = CONFIG();\n    var vessels = cfg.vessels;\n    var storms = resolveStorms(round, seed, cfg.routes);\n\n    var vesselResults = [];\n    for (var i = 0; i < vessels.length; i++) {\n      var v = vessels[i];\n      var routeId = assignments[v.shipId] !== undefined ? assignments[v.shipId] : v.defaultRouteId;\n      vesselResults.push(resolveVessel(v, routeId, commonRiskState, storms, seed, round, qaMods ? qaMods[v.shipId] : null));\n    }',
  'resolveVessel(v, routeId, commonRiskState, storms, seed, round, qaMods ? qaMods[v.shipId] : null)');

edit('fleet-model.js', 'expectedRound signature',
  '  function expectedRound(assignments, commonRiskState, seed, round) {',
  '  function expectedRound(assignments, commonRiskState, seed, round, qaMods) {',
  'function expectedRound(assignments, commonRiskState, seed, round, qaMods)');

/* expectedRound 内两处 accidentProbability 调用 */
edit('fleet-model.js', 'expectedRound loop1 qaMod',
  '      var route = findRoute(routeId);\n      var p = accidentProbability(v, route, commonRiskState, storms);\n      var sevCfg = cfg.accidentSeverity;\n\n      var incomeIfSafe',
  '      var route = findRoute(routeId);\n      var p = accidentProbability(v, route, commonRiskState, storms, qaMods ? qaMods[v.shipId] : null);\n      var sevCfg = cfg.accidentSeverity;\n\n      var incomeIfSafe',
  'accidentProbability(v, route, commonRiskState, storms, qaMods ? qaMods[v.shipId] : null);\n      var sevCfg = cfg.accidentSeverity;\n\n      var incomeIfSafe');

edit('fleet-model.js', 'expectedRound loop2 qaMod',
  '      var routeJ = findRoute(rj);\n      var pJ = accidentProbability(vj, routeJ, commonRiskState, storms);\n      var sevCfgJ = cfg.accidentSeverity;',
  '      var routeJ = findRoute(rj);\n      var pJ = accidentProbability(vj, routeJ, commonRiskState, storms, qaMods ? qaMods[vj.shipId] : null);\n      var sevCfgJ = cfg.accidentSeverity;',
  'accidentProbability(vj, routeJ, commonRiskState, storms, qaMods ? qaMods[vj.shipId] : null)');

/* =====================================================================
 * 4. shipyard-runtime.js —— inspection_completed 前写抽样学习证据
 * ===================================================================== */
edit('shipyard-runtime.js', 'sampling learning evidence hook',
  '    ns.reports.push(report);\n    ns.activeInspection = null;\n    writeNamespace(ns);\n    store()?.save?.(); // 报告是硬事实：立即落盘，不等 scheduleSave\n    emit(\'inspection_completed\', {',
  '    ns.reports.push(report);\n    ns.activeInspection = null;\n    writeNamespace(ns);\n    store()?.save?.(); // 报告是硬事实：立即落盘，不等 scheduleSave\n    /* 学习证据（sampling_representativeness 亲历）：报告已写入 GameStore 后再记；失败不影响质检 */\n    var sLearn = global.SamplingLearning;\n    if (sLearn && sLearn.recordInspectionEncounter) {\n      try { sLearn.recordInspectionEncounter(report); }\n      catch (err) { console.error(\'[ShipyardRuntime] sampling learning record failed\', err); }\n    }\n    emit(\'inspection_completed\', {',
  'sLearn.recordInspectionEncounter(report)');

/* =====================================================================
 * 5. shipyard-ui.js —— 抽样前/中/决策前/航程后复盘事实展示
 * ===================================================================== */

/* 5a. sampling 视图：检查范围（未检查部位 chips，已查区域在船图上标暗） */
edit('shipyard-ui.js', 'sampling coverage chips',
  "      + (insp.samplingDelay ? '<span>耽误 <b>' + insp.samplingDelay + '</b> 分钟</span>' : '')"
  + "\n      + '</div></div>'",
  "      + (insp.samplingDelay ? '<span>耽误 <b>' + insp.samplingDelay + '</b> 分钟</span>' : '')"
  + "\n      + '</div>'"
  + "\n      + samplingCoverageHtml(insp)"
  + "\n      + '</div>'",
  'samplingCoverageHtml(insp)');

/* 5b. decide 视图：检查范围摘要（只陈述事实） */
edit('shipyard-ui.js', 'decide coverage summary',
  "      + '<div class=\"shipyard-muted\">还有 ' + unsampledCount + ' 个部位未检查，状态未知。</div></div>'",
  "      + zoneCoverageSummaryHtml(insp)"
  + "\n      + '<div class=\"shipyard-muted\">还有 ' + unsampledCount + ' 个部位未检查，状态未知。</div></div>'",
  'zoneCoverageSummaryHtml(insp)');

/* 5c. voyage 视图：样本 vs 整体复盘 */
edit('shipyard-ui.js', 'voyage coverage facts',
  "      + '<div class=\"shipyard-voyage-detail\">' + detailText + '</div>'",
  "      + '<div class=\"shipyard-voyage-detail\">' + detailText + '</div>'"
  + "\n      + (outcome.sailed ? '<div class=\"shipyard-fact\" style=\"margin-top:10px\">' + voyageCoverageFacts(report).join('<br>') + '</div>' : '')",
  'voyageCoverageFacts(report).join');

/* 5d. 辅助函数（插在 reportSections 之前，renderVoyage 之后使用） */
edit('shipyard-ui.js', 'coverage helpers',
  '  function renderVoyage(report, batch) {',
  '  /* 抽样覆盖事实：只依据报告里的样本与真实缺陷，不评判抽样好坏 */\n  function zoneParts(insp) {\n    const zones = config().batch.zones;\n    const per = config().batch.partsPerZone;\n    const sampled = insp.sampledParts || [];\n    const result = [];\n    zones.forEach(function(z) {\n      let count = 0;\n      sampled.forEach(function(id) { if (id.split(\'-\')[0] === z) count++; });\n      result.push({ zone: z, sampled: count, total: per });\n    });\n    return result;\n  }\n\n  function samplingCoverageHtml(insp) {\n    const chips = zoneParts(insp).map(function(z) {\n      const remain = z.total - z.sampled;\n      return remain > 0\n        ? \'<span class="shipyard-part unknown">\' + ZONE_LABEL(z.zone) + \' · 未查 \' + remain + \'</span>\'\n        : \'<span class="shipyard-part">\' + ZONE_LABEL(z.zone) + \' · 查完</span>\';\n    });\n    return \'<div class="shipyard-ledger" style="margin-top:2px">检查范围（已检查区域在船图上标暗）：\' + chips.join(\'\') + \'</div>\';\n  }\n\n  function zoneCoverageSummaryHtml(insp) {\n    const zones = zoneParts(insp);\n    const checked = zones.filter(function(z) { return z.sampled > 0; }).map(function(z) { return ZONE_LABEL(z.zone); });\n    const unchecked = zones.filter(function(z) { return z.sampled === 0; }).map(function(z) { return ZONE_LABEL(z.zone); });\n    let text = \'检查范围摘要：已检查：\' + (checked.length ? checked.join(\'、\') : \'无\') + \'；未检查：\' + (unchecked.length ? unchecked.join(\'、\') : \'无\') + \'。\';\n    return \'<div class="shipyard-ledger">\' + text + \'</div>\';\n  }\n\n  function voyageCoverageFacts(report) {\n    const outcome = report.actualOutcome || {};\n    const missed = Array.isArray(outcome.missedDefects) ? outcome.missedDefects : [];\n    const found = Array.isArray(report.defectsFound) ? report.defectsFound : [];\n    const facts = [];\n    if (missed.length > 0) {\n      facts.push(\'有 \' + missed.length + \' 处真实缺陷位于未检查部位——它们未被本次样本覆盖，问题在出航后才暴露。\');\n      if (found.length === 0) facts.push(\'本次抽到的部位没有发现问题，但未检查区域存在缺陷。\');\n    } else {\n      facts.push(\'本次样本结果与其他部位大致一致。\');\n    }\n    return facts;\n  }\n\n  function renderVoyage(report, batch) {',
  'function voyageCoverageFacts');

/* =====================================================================
 * 6. fleet-runtime.js —— 快照效果入 campaign + hold 限制 + qaMods 传模型 + 应用证据
 * ===================================================================== */
edit('fleet-runtime.js', 'accessor samplingLearning',
  '  var learning = function() { return global.FleetLearning; };',
  '  var learning = function() { return global.FleetLearning; };\n  var samplingLearning = function() { return global.SamplingLearning; };',
  'var samplingLearning = function() { return global.SamplingLearning; };');

edit('fleet-runtime.js', 'qaModsForRound helper',
  '  function getExpected() {',
  '  /* 质检效果（qaMods）：快照在 campaign 开始时固定；hold 的第 1 回合由 assignments=null 表达，不参与概率 */\n  function qaModsForRound(camp, round) {\n    var map = null;\n    var effects = camp && Array.isArray(camp.shipyardEffects) ? camp.shipyardEffects : [];\n    for (var i = 0; i < effects.length; i++) {\n      var e = effects[i];\n      var mod = null;\n      if (!(e.holdRound1 && round === 1)) mod = e.qaMod;\n      if (typeof mod === \'number\' && mod !== 1) {\n        if (!map) map = {};\n        map[e.shipId] = mod;\n      }\n    }\n    return map;\n  }\n\n  function getExpected() {',
  'function qaModsForRound(camp, round)');

edit('fleet-runtime.js', 'startCampaign derives effects + hold round1',
  '    /* Step 3: capture input snapshot from external systems */\n    var inputAdapter = adapter();\n    if (inputAdapter && inputAdapter.buildCampaignInputSnapshot) {\n      campaign.inputSnapshot = inputAdapter.buildCampaignInputSnapshot();\n    }\n\n    ns.activeCampaign = campaign;',
  '    /* Step 3: capture input snapshot from external systems */\n    var inputAdapter = adapter();\n    if (inputAdapter && inputAdapter.buildCampaignInputSnapshot) {\n      campaign.inputSnapshot = inputAdapter.buildCampaignInputSnapshot();\n    }\n\n    /* QA 迁移：从快照派生质检效果（只存最小事实 + 引用 reportId，不复制报告本体）；\n     * 暂停出航（hold）的船第 1 回合强制留港，下一回合起可重新安排 */\n    var qaEffects = [];\n    if (campaign.inputSnapshot && inputAdapter && inputAdapter.getShipyardEffects) {\n      qaEffects = inputAdapter.getShipyardEffects(campaign.inputSnapshot) || [];\n    }\n    if (qaEffects.length > 0) {\n      for (var qe = 0; qe < qaEffects.length; qe++) {\n        if (qaEffects[qe].holdRound1) campaign.assignments[qaEffects[qe].shipId] = null;\n      }\n      campaign.shipyardEffects = qaEffects;\n    }\n\n    ns.activeCampaign = campaign;',
  'campaign.shipyardEffects = qaEffects;');

edit('fleet-runtime.js', 'setAssignment hold guard',
  '    var vessel = model().findVessel(shipId);\n    if (!vessel) return { ok: false, reason: \'invalid-ship\' };\n\n    camp.assignments[shipId] = routeIdOrNull;',
  '    var vessel = model().findVessel(shipId);\n    if (!vessel) return { ok: false, reason: \'invalid-ship\' };\n\n    /* QA hold：第 1 回合该船不能出航（自动留港），第 2 回合起可重新安排 */\n    var qaHold = Array.isArray(camp.shipyardEffects) ? camp.shipyardEffects : [];\n    for (var qh = 0; qh < qaHold.length; qh++) {\n      if (qaHold[qh].shipId === shipId && qaHold[qh].holdRound1 && camp.currentRound === 1 && routeIdOrNull !== null) {\n        return { ok: false, reason: \'qa-hold-round-1\' };\n      }\n    }\n\n    camp.assignments[shipId] = routeIdOrNull;',
  "return { ok: false, reason: 'qa-hold-round-1' };\n      }\n    }\n\n    camp.assignments[shipId] = routeIdOrNull;");

edit('fleet-runtime.js', 'getExpected passes qaMods',
  '    return model().expectedRound(camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound);',
  '    return model().expectedRound(camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound, qaModsForRound(camp, camp.currentRound));',
  'qaModsForRound(camp, camp.currentRound));');

edit('fleet-runtime.js', 'submitPlan QA hold validation',
  '    /* 校验 reserve 合法 */\n    var capCfg = cfg.capital;\n    if (camp.reserve < 0 || camp.reserve > capCfg.maxReserve || camp.reserve % capCfg.reserveStep !== 0) {\n      return { ok: false, reason: \'invalid-reserve\' };\n    }',
  '    /* 校验 reserve 合法 */\n    var capCfg = cfg.capital;\n    if (camp.reserve < 0 || camp.reserve > capCfg.maxReserve || camp.reserve % capCfg.reserveStep !== 0) {\n      return { ok: false, reason: \'invalid-reserve\' };\n    }\n\n    /* QA hold 兜底校验：第 1 回合该船必须留港 */\n    var qaSubmit = Array.isArray(camp.shipyardEffects) ? camp.shipyardEffects : [];\n    for (var qs = 0; qs < qaSubmit.length; qs++) {\n      if (qaSubmit[qs].holdRound1 && camp.currentRound === 1) {\n        var heldRoute = camp.assignments[qaSubmit[qs].shipId];\n        if (heldRoute !== null && heldRoute !== undefined) {\n          return { ok: false, reason: \'qa-hold-round-1\', shipId: qaSubmit[qs].shipId };\n        }\n      }\n    }',
  'qa-hold-round-1\', shipId: qaSubmit[qs].shipId };\n        }\n      }\n    }');

edit('fleet-runtime.js', 'submitPlan QA application evidence + resolveRound qaMods',
  '    var funds = { operatingCash: camp.operatingCash, reserve: camp.reserve };\n\n    emit(\'fleet_plan_submitted\', {',
  '    var funds = { operatingCash: camp.operatingCash, reserve: camp.reserve };\n\n    /* 学习证据（sampling_representativeness 应用/迁移）：快照带质检效果时，本轮相对上一回合的调整\n     * 涉及质检船或其同批次船/准备金才记录；不伪造无调整时的进展 */\n    var sLearn = samplingLearning();\n    if (sLearn && camp.rounds.length > 0 && Array.isArray(camp.shipyardEffects) && camp.shipyardEffects.length > 0) {\n      var qaPrevRound = camp.rounds[camp.rounds.length - 1];\n      if (qaPrevRound) {\n        var qaChanges = sLearn.fleetAdjustmentChanges(camp, qaPrevRound, camp.assignments, camp.reserve);\n        if (qaChanges.length > 0) {\n          sLearn.recordFleetApplication(camp, qaChanges, camp.shipyardEffects[0].sourceReportId);\n        }\n      }\n    }\n\n    emit(\'fleet_plan_submitted\', {',
  'sLearn.recordFleetApplication(camp, qaChanges, camp.shipyardEffects[0].sourceReportId);');

edit('fleet-runtime.js', 'resolveRound call with qaMods',
  '    var roundResult = model().resolveRound(\n      camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound, funds\n    );',
  '    var roundResult = model().resolveRound(\n      camp.assignments, camp.commonRiskState, camp.seed, camp.currentRound, funds,\n      qaModsForRound(camp, camp.currentRound)\n    );',
  'qaModsForRound(camp, camp.currentRound)\n    );');

/* =====================================================================
 * 7. fleet-ui.js —— 质检关联卡/同批次提示/hold 按钮/预期与修正列
 * ===================================================================== */
edit('fleet-ui.js', 'ui constants + helpers cluster (qa)',
  '  var FOCUS_LABELS = { route: \'多艘船同时走同一条航线\', departure: \'多艘船在相近时间出航\', batch: \'多艘船使用同一船材批次\', none: \'暂时没有特别关注的风险\' };\n  var FOCUS_ORDER = [[\'route\', \'多艘船同时走同一条航线\'], [\'departure\', \'多艘船在相近时间出航\'], [\'batch\', \'多艘船使用同一船材批次\'], [\'none\', \'暂时没有特别关注的风险\']];',
  '  var FOCUS_LABELS = { route: \'多艘船同时走同一条航线\', departure: \'多艘船在相近时间出航\', batch: \'多艘船使用同一船材批次\', none: \'暂时没有特别关注的风险\' };\n  var FOCUS_ORDER = [[\'route\', \'多艘船同时走同一条航线\'], [\'departure\', \'多艘船在相近时间出航\'], [\'batch\', \'多艘船使用同一船材批次\'], [\'none\', \'暂时没有特别关注的风险\']];\n\n  /* ── 质检关联（shipyard→fleet）：只读客观信息，不自动改方案 ── */\n  var QA_DECISION_LABELS = { release: \'直接放行\', repair_partial: \'局部返修\', repair_full: \'全面返修\', hold: \'暂停出航\' };\n\n  function qaEffects(camp) {\n    return (camp && Array.isArray(camp.shipyardEffects)) ? camp.shipyardEffects : [];\n  }\n\n  function qaEffectFor(camp, shipId) {\n    var es = qaEffects(camp);\n    for (var i = 0; i < es.length; i++) if (es[i].shipId === shipId) return es[i];\n    return null;\n  }\n\n  function qaModsOfCampaign(camp, round) {\n    var map = null;\n    var es = qaEffects(camp);\n    for (var i = 0; i < es.length; i++) {\n      var e = es[i];\n      var mod = null;\n      if (!(e.holdRound1 && round === 1)) mod = e.qaMod;\n      if (typeof mod === \'number\' && mod !== 1) {\n        if (!map) map = {};\n        map[e.shipId] = mod;\n      }\n    }\n    return map;\n  }\n\n  function qaCardText(e, camp) {\n    var total = (e.sampledCount || 0) + (e.uninspectedCount || 0);\n    var html = \'<span style="color:#3E2A1B">曾在造船厂接受抽样检查：已检查 <b>\' + e.sampledCount + \'</b>/\' + total + \' 个部位 · 仍有 <b>\' + e.uninspectedCount + \'</b> 个部位未检查 · 发现 <b>\' + e.foundCount + \'</b> 处缺陷 · 处置：\' + (QA_DECISION_LABELS[e.decision] || e.decision) + \'。</span>\';\n    if (e.holdRound1 && camp.currentRound === 1) {\n      html += \'<br><span style="color:#8C3A2E">质检：暂停出航——本回合自动留港，不承担风险也不产生收入；第 2 回合起可重新安排。</span>\';\n    } else if (typeof e.qaMod === \'number\') {\n      if (e.repairLevel === \'full\') {\n        html += \'<br>已处理（全面返修）：整体风险下降，本次出航事故概率修正 \\u00d7\' + e.qaMod.toFixed(2) + \'。\';\n      } else if (e.repairLevel === \'partial\') {\n        html += \'<br>\' + (e.remainingCount > 0\n          ? \'样本中的缺陷已返修，仍有 \' + e.remainingCount + \' 处实际缺陷未处理（未检查部位），修正 \\u00d7\' + e.qaMod.toFixed(2)\n          : \'样本发现的缺陷已全部返修，修正 \\u00d7\' + e.qaMod.toFixed(2)) + \'。\';\n      } else if (e.repairLevel === \'none\') {\n        html += \'<br>\' + (e.remainingCount > 0\n          ? \'有 \' + e.remainingCount + \' 处实际缺陷在未检查部位随船出航，修正 \\u00d7\' + e.qaMod.toFixed(2)\n          : \'样本没有发现问题——未检查部位仍是未知状态，不标记为绝对安全\') + \'。\';\n      } else if (e.repairLevel === \'hold\') {\n        html += \'<br>船在船台错过这一潮；第 2 回合起出航时修正 \\u00d7\' + e.qaMod.toFixed(2) + \'（实际缺陷仍未处理）。\';\n      }\n    }\n    return html;\n  }\n\n  function qaPeerWarning(camp, e) {\n    var cfg = config();\n    var vessels = cfg.vessels;\n    var batchOf = null;\n    var peers = [];\n    for (var i = 0; i < vessels.length; i++) {\n      var v = vessels[i];\n      if (v.shipId === e.shipId) { batchOf = v.batchId; continue; }\n      if (v.shipId !== e.shipId && v.batchId && batchOf === null) continue;\n    }\n    if (batchOf === null) return \'\';\n    for (var j = 0; j < vessels.length; j++) {\n      var w = vessels[j];\n      if (w.shipId !== e.shipId && w.batchId === batchOf) peers.push(w.name);\n    }\n    if (peers.length === 0) return \'\';\n    return \'<div class="fleet-warning">质检关联：\' + e.shipName + \'的船材批次（\' + vesselBatchLabel(batchOf) + \'）被实际检查：发现 \' + e.actualDefectCount + \' 处真实缺陷（未处理 \' + e.remainingCount + \' 处）。\' + peers.join(\'、\') + \' 与 \' + e.shipName + \' 共用该批次——批次缺陷风险仍按本轮种子结算，它们共享这一来源。</div>\';\n  }',
  'QA_DECISION_LABELS = { release');

/* 7a. planning 船卡：质检信息行 + hold 禁用航线按钮 */
edit('fleet-ui.js', 'vessel card qa info + hold disabled buttons',
  '    for (var i = 0; i < vessels.length; i++) {\n      var v = vessels[i];\n      var assigned = camp.assignments[v.shipId];\n      html += \'<div class="fleet-vessel">\';\n      html += \'<b>\' + v.name + \'</b> · 货值 \' + v.cargoValue + \' · 基础风险 \' + Math.round(v.baseRisk * 100) + \'% · 船体 \' + v.hull + \' · 批次 \' + vesselBatchLabel(v.batchId);\n      html += \'<div class="fleet-route-btns">\';\n      for (var j = 0; j < routes.length; j++) {\n        var r = routes[j];\n        var sel = assigned === r.routeId ? \' selected\' : \'\';\n        html += \'<button class="fleet-btn\' + sel + \'" data-ship="\' + v.shipId + \'" data-route="\' + r.routeId + \'">\'\n          + r.name + \'<br><span style="font-size:10px">收益\' + Math.round(r.yieldRate * 100) + \'% 风险\' + Math.round(r.baseRisk * 100) + \'%</span></button>\';\n      }\n      var staySel = assigned === null ? \' selected\' : \'\';\n      html += \'<button class="fleet-btn stay\' + staySel + \'" data-ship="\' + v.shipId + \'" data-route="null">留港</button>\';\n      html += \'</div></div>\';\n    }',
  '    for (var i = 0; i < vessels.length; i++) {\n      var v = vessels[i];\n      var assigned = camp.assignments[v.shipId];\n      var qaE = qaEffectFor(camp, v.shipId);\n      var qaHeld = qaE && qaE.holdRound1 && camp.currentRound === 1;\n      html += \'<div class="fleet-vessel">\';\n      html += \'<b>\' + v.name + \'</b> · 货值 \' + v.cargoValue + \' · 基础风险 \' + Math.round(v.baseRisk * 100) + \'% · 船体 \' + v.hull + \' · 批次 \' + vesselBatchLabel(v.batchId);\n      if (qaE) html += \'<div class="fleet-info" style="margin:6px 0 0">\' + qaCardText(qaE, camp) + \'</div>\';\n      html += \'<div class="fleet-route-btns">\';\n      for (var j = 0; j < routes.length; j++) {\n        var r = routes[j];\n        var sel = assigned === r.routeId ? \' selected\' : \'\';\n        html += \'<button class="fleet-btn\' + sel + (qaHeld ? \' disabled\' : \'\') + \'" data-ship="\' + v.shipId + \'" data-route="\' + r.routeId + \'">\'\n          + r.name + \'<br><span style="font-size:10px">收益\' + Math.round(r.yieldRate * 100) + \'% 风险\' + Math.round(r.baseRisk * 100) + \'%</span></button>\';\n      }\n      var staySel = assigned === null ? \' selected\' : \'\';\n      html += \'<button class="fleet-btn stay\' + staySel + (qaHeld ? \' disabled\' : \'\') + \'" data-ship="\' + v.shipId + \'" data-route="null">留港</button>\';\n      html += \'</div></div>\';\n    }',
  '(qaHeld ? \' disabled\' : \'\') + \'" data-ship="\' + v.shipId + \'" data-route="null">留港</button>\'');

/* 7b. planning 共同风险区：同批次提示（在既有共享批次行之后） */
edit('fleet-ui.js', 'common risk qa peer warning',
  '    var bkeys = Object.keys(batches);\n    for (var bk = 0; bk < bkeys.length; bk++) {\n      if (batches[bkeys[bk]].length > 1) {\n        html += \'<div class="fleet-info">\' + batches[bkeys[bk]].join(\'、\') + \' 共享 <b>\' + vesselBatchLabel(bkeys[bk]) + \'</b> 船材批次（缺陷风险共享）</div>\';\n      }\n    }\n\n    var routeCounts = {};',
  '    var bkeys = Object.keys(batches);\n    for (var bk = 0; bk < bkeys.length; bk++) {\n      if (batches[bkeys[bk]].length > 1) {\n        html += \'<div class="fleet-info">\' + batches[bkeys[bk]].join(\'、\') + \' 共享 <b>\' + vesselBatchLabel(bkeys[bk]) + \'</b> 船材批次（缺陷风险共享）</div>\';\n      }\n    }\n\n    var qaEs = qaEffects(camp);\n    for (var qp = 0; qp < qaEs.length; qp++) {\n      var peerWarn = qaPeerWarning(camp, qaEs[qp]);\n      if (peerWarn) html += peerWarn;\n    }\n\n    var routeCounts = {};',
  'var peerWarn = qaPeerWarning(camp, qaEs[qp]);');

/* 7c. result 视图：预期重算带 qaMods（与事前预览一致） */
edit('fleet-ui.js', 'result expected recompute with qaMods',
  '    var expected = model().expectedRound(lastRound.assignments, camp.commonRiskState, camp.seed, lastRound.round);',
  '    var expected = model().expectedRound(lastRound.assignments, camp.commonRiskState, camp.seed, lastRound.round, qaModsOfCampaign(camp, lastRound.round));',
  'qaModsOfCampaign(camp, lastRound.round));');

/* 7d. result 逐船表：修正列显示质检 */
edit('fleet-ui.js', 'result modifiers column qa',
  "      var mods = [];\n      if (vr.modifiers.storm) mods.push('风暴');\n      if (vr.modifiers.batchDefect) mods.push('批次缺陷');",
  "      var mods = [];\n      if (vr.modifiers.storm) mods.push('风暴');\n      if (vr.modifiers.batchDefect) mods.push('批次缺陷');\n      if (typeof vr.modifiers.qa === 'number') mods.push('质检×' + vr.modifiers.qa.toFixed(2));",
  "if (typeof vr.modifiers.qa === 'number') mods.push('质检×' + vr.modifiers.qa.toFixed(2));");

/* =====================================================================
 * 8. index.html —— 新模块 script 标签 + 版本号刷新
 * ===================================================================== */
const NL = '\r\n';

edit('index.html', 'insert sampling-learning.js script',
  '  <script src="./learning-adapter.js?v=20260902-1"></script>' + NL,
  '  <script src="./learning-adapter.js?v=20260902-1"></script>\' + NL + \'  <script src="./sampling-learning.js?v=20260903-1"></script>' + NL,
  '<script src="./sampling-learning.js?v=20260903-1"></script>');

edit('index.html', 'bump shipyard-runtime & shipyard-ui versions',
  '  <script src="./shipyard-runtime.js?v=20260903-1"></script><script src="./shipyard-ui.js?v=20260903-2"></script>' + NL,
  '  <script src="./shipyard-runtime.js?v=20260903-2"></script><script src="./shipyard-ui.js?v=20260903-3"></script>' + NL,
  '<script src="./shipyard-runtime.js?v=20260903-2"></script>');

edit('index.html', 'bump fleet-model & fleet-input-adapter versions',
  '  <script src="./fleet-config.js?v=20260903-1"></script><script src="./fleet-model.js?v=20260903-1"></script><script src="./fleet-input-adapter.js?v=20260903-3"></script><script src="./fleet-stats.js?v=20260903-4"></script><script src="./fleet-learning.js?v=20260903-1"></script>' + NL,
  '  <script src="./fleet-config.js?v=20260903-1"></script><script src="./fleet-model.js?v=20260903-2"></script><script src="./fleet-input-adapter.js?v=20260903-4"></script><script src="./fleet-stats.js?v=20260903-4"></script><script src="./fleet-learning.js?v=20260903-1"></script>' + NL,
  '<script src="./fleet-model.js?v=20260903-2"></script>');

edit('index.html', 'bump fleet-runtime & fleet-ui versions',
  '  <script src="./fleet-runtime.js?v=20260903-2"></script><script src="./fleet-ui.js?v=20260903-2"></script>' + NL,
  '  <script src="./fleet-runtime.js?v=20260903-3"></script><script src="./fleet-ui.js?v=20260903-3"></script>' + NL,
  '<script src="./fleet-runtime.js?v=20260903-3"></script>');

/* ---- 执行 ---- */
run();
console.log('done: applied=' + appliedCount + ' skipped=' + skippedCount);
