/*
 * Step 1: correlated-risk learning loop (亲历—解释—调整) — minimal evidence layer.
 * Creates fleet-learning.js; patches fleet-runtime.js, fleet-ui.js, index.html.
 * No risk-model / event / achievement / reward changes. Idempotent per edit.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const applied = [];
const skipped = [];

function load(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function save(rel, content) { fs.writeFileSync(path.join(ROOT, rel), content, 'utf8'); }

function edit(rel, label, oldText, newText, marker) {
  const file = path.join(ROOT, rel);
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes(marker)) { skipped.push(label + ' (already applied)'); return; }
  if (!content.includes(oldText)) throw new Error('[' + label + '] anchor not found');
  content = content.replace(oldText, newText);
  fs.writeFileSync(file, content, 'utf8');
  applied.push(label);
}

function eol(content) { return content.indexOf('\r\n') !== -1 ? '\r\n' : '\n'; }
function L(lines, nl) { return lines.join(nl); }

/* ═══════════════════ PART 0: create fleet-learning.js ═══════════════════ */
const learningRel = 'fleet-learning.js';
if (!fs.existsSync(path.join(ROOT, learningRel))) {
  const NL = '\n';
  const src = L([
    '/* 概率世界 · 商会船队风险盘 —— 学习证据层 V0.1',
    ' * 概念：correlated_risk（共同风险：亲历—解释—调整）。',
    ' * 只把跨回合最小证据写入 world.learning；不建“掌握度”、不改成就/奖励，',
    ' * 不改风险模型与结算，不发网络请求，不操作 DOM，不发事件。',
    ' * fleet-ui 只读本模块的纯函数输出；写入入口只有 fleet-runtime。 */',
    '(function attachFleetLearning(global) {',
    "  'use strict';",
    '',
    "  var CONCEPT_ID = 'correlated_risk';",
    '',
    '  function store() { return global.__gameStore; }',
    '',
    '  /* ---- world.learning 最小命名空间 ---- */',
    '  function readLearning() {',
    '    var gs = store();',
    "    if (!gs || !gs.get) return null;",
    "    var l = gs.get('world.learning');",
    "    return l && typeof l === 'object' ? l : null;",
    '  }',
    '',
    '  function writeLearning(learning) {',
    '    var gs = store();',
    "    if (!gs || !gs.set) return;",
    "    gs.set('world.learning', learning);",
    '    gs.save();',
    '  }',
    '',
    '  function ensureConcept(learning) {',
    "    var l = learning && typeof learning === 'object' ? learning : { version: 1, concepts: {} };",
    "    if (!l.concepts || typeof l.concepts !== 'object') l.concepts = {};",
    '    var c = l.concepts[CONCEPT_ID];',
    '    if (!c) {',
    '      c = { conceptId: CONCEPT_ID, encounteredAt: null, encounterRefs: [], focusedOn: [], appliedAt: [] };',
    '      l.concepts[CONCEPT_ID] = c;',
    '    }',
    "    if (!Array.isArray(c.encounterRefs)) c.encounterRefs = [];",
    "    if (!Array.isArray(c.focusedOn)) c.focusedOn = [];",
    "    if (!Array.isArray(c.appliedAt)) c.appliedAt = [];",
    '    return c;',
    '  }',
    '',
    '  /* ---- 共同风险事件推导（纯函数；只读单回合结算结果） ---- */',
    '  /* 事件条件：>=2 艘船因同一来源（同一航线上的风暴 / 同一缺陷批次）在本轮同时受损。 */',
    '  function analyzeRound(roundResult) {',
    '    var events = [];',
    '    if (!roundResult || !Array.isArray(roundResult.vesselResults)) return events;',
    '    var results = roundResult.vesselResults;',
    '    var storms = Array.isArray(roundResult.storms) ? roundResult.storms : [];',
    '    var defects = Array.isArray(roundResult.batchDefects) ? roundResult.batchDefects : [];',
    '    function groupWithLoss(match) {',
    '      var vesselIds = [], names = [], totalLoss = 0;',
    '      for (var i = 0; i < results.length; i++) {',
    '        var vr = results[i];',
    '        if (!vr.sailing || !(vr.cargoLoss > 0) || !match(vr)) continue;',
    '        vesselIds.push(vr.shipId);',
    '        names.push(vr.name);',
    '        totalLoss += vr.cargoLoss;',
    '      }',
    '      return { vesselIds: vesselIds, names: names, totalLoss: Math.round(totalLoss * 100) / 100 };',
    '    }',
    '    for (var s = 0; s < storms.length; s++) {',
    '      var storm = storms[s];',
    '      var stormGroup = groupWithLoss(function(vr) { return vr.routeId === storm.routeId; });',
    '      if (stormGroup.vesselIds.length >= 2) {',
    '        events.push({ type: \'storm\', sourceId: storm.routeId, vesselIds: stormGroup.vesselIds, names: stormGroup.names, totalLoss: stormGroup.totalLoss });',
    '      }',
    '    }',
    '    for (var d = 0; d < defects.length; d++) {',
    '      var batchId = defects[d];',
    '      var batchGroup = groupWithLoss(function(vr) { return vr.batchId === batchId; });',
    '      if (batchGroup.vesselIds.length >= 2) {',
    '        events.push({ type: \'batch\', sourceId: batchId, vesselIds: batchGroup.vesselIds, names: batchGroup.names, totalLoss: batchGroup.totalLoss });',
    '      }',
    '    }',
    '    return events;',
    '  }',
    '',
    '  /* 共同风险涉及的组合损失（按船去重；供“组合损失 vs 独立损失”对比） */',
    '  function coLossSummary(roundResult, events) {',
    '    var vesselIds = [], names = [], totalLoss = 0;',
    '    if (roundResult && Array.isArray(roundResult.vesselResults) && events && events.length) {',
    '      var byId = {};',
    '      for (var i = 0; i < roundResult.vesselResults.length; i++) {',
    '        byId[roundResult.vesselResults[i].shipId] = roundResult.vesselResults[i];',
    '      }',
    '      var seen = {};',
    '      for (var e = 0; e < events.length; e++) {',
    '        var ev = events[e];',
    '        for (var v = 0; v < ev.vesselIds.length; v++) {',
    '          var id = ev.vesselIds[v];',
    '          if (seen[id]) continue;',
    '          seen[id] = true;',
    '          var ship = byId[id];',
    '          if (!ship) continue;',
    '          vesselIds.push(id);',
    '          names.push(ship.name);',
    '          totalLoss += ship.cargoLoss || 0;',
    '        }',
    '      }',
    '    }',
    '    return { vesselIds: vesselIds, names: names, totalLoss: Math.round(totalLoss * 100) / 100 };',
    '  }',
    '',
    '  /* ---- encountered：结算事实落档后，确有共同风险才记录 ---- */',
    '  function recordEncounter(campaign, roundResult, events) {',
    '    if (!campaign || !campaign.campaignId || !roundResult || !events || events.length === 0) return null;',
    '    var l = readLearning() || { version: 1, concepts: {} };',
    '    var c = ensureConcept(l);',
    '    for (var i = 0; i < c.encounterRefs.length; i++) {',
    '      if (c.encounterRefs[i] && c.encounterRefs[i].campaignId === campaign.campaignId && c.encounterRefs[i].round === roundResult.round) {',
    '        return c.encounterRefs[i];',
    '      }',
    '    }',
    '    var vesselIds = [];',
    '    var commonRiskEvents = [];',
    '    for (var e = 0; e < events.length; e++) {',
    '      commonRiskEvents.push({ type: events[e].type, sourceId: events[e].sourceId, vesselIds: events[e].vesselIds.slice() });',
    '      for (var v = 0; v < events[e].vesselIds.length; v++) {',
    '        if (vesselIds.indexOf(events[e].vesselIds[v]) === -1) vesselIds.push(events[e].vesselIds[v]);',
    '      }',
    '    }',
    '    var ref = { campaignId: campaign.campaignId, round: roundResult.round, commonRiskEvents: commonRiskEvents, vesselIds: vesselIds };',
    '    c.encounterRefs.push(ref);',
    "    if (!c.encounteredAt) c.encounteredAt = new Date().toISOString();",
    '    writeLearning(l);',
    '    return ref;',
    '  }',
    '',
    '  function hasEncounterForCampaign(campaignId) {',
    '    var c = getConcept();',
    '    if (!c) return false;',
    '    for (var i = 0; i < c.encounterRefs.length; i++) {',
    '      if (c.encounterRefs[i] && c.encounterRefs[i].campaignId === campaignId) return true;',
    '    }',
    '    return false;',
    '  }',
    '',
    '  function getConcept() {',
    '    var l = readLearning();',
    '    if (!l || !l.concepts || !l.concepts[CONCEPT_ID]) return null;',
    '    return l.concepts[CONCEPT_ID];',
    '  }',
    '',
    '  /* ---- focusedOn：提交前的一次性“风险关注”（选项见 fleet-ui；无对错） ---- */',
    '  function recordFocus(campaign, focus) {',
    '    if (!campaign || !campaign.campaignId) return null;',
    '    var l = readLearning() || { version: 1, concepts: {} };',
    '    var c = ensureConcept(l);',
    '    var found = null;',
    '    for (var i = 0; i < c.focusedOn.length; i++) {',
    '      var f = c.focusedOn[i];',
    "      if (f && f.campaignId === campaign.campaignId && f.round === campaign.currentRound) { found = f; break; }",
    '    }',
    '    if (found) { found.focus = focus; }',
    '    else { found = { campaignId: campaign.campaignId, round: campaign.currentRound, focus: focus }; c.focusedOn.push(found); }',
    '    writeLearning(l);',
    '    return found;',
    '  }',
    '',
    '  /* ---- applied：玩家在下一回合真实改变方案才算（只看事实差异，不看对错） ---- */',
    '  function isSailing(a) { return a !== null && a !== undefined; }',
    '',
    '  function planChanges(prevAssignments, curAssignments, prevReserve, curReserve) {',
    '    var changes = [];',
    '    var prev = prevAssignments || {};',
    '    var cur = curAssignments || {};',
    '    var cfg = global.FLEET_CONFIG || null;',
    '    var vessels = cfg && Array.isArray(cfg.vessels) ? cfg.vessels : [];',
    '    var prevCounts = {}, curCounts = {};',
    '    for (var i = 0; i < vessels.length; i++) {',
    '      var pv = prev[vessels[i].shipId];',
    '      var cv = cur[vessels[i].shipId];',
    '      if (isSailing(pv)) prevCounts[pv] = (prevCounts[pv] || 0) + 1;',
    '      if (isSailing(cv)) curCounts[cv] = (curCounts[cv] || 0) + 1;',
    '    }',
    '    var routeKeys = {};',
    '    for (var r in prevCounts) routeKeys[r] = true;',
    '    for (var r2 in curCounts) routeKeys[r2] = true;',
    '    for (var rk in routeKeys) {',
    '      var fromN = prevCounts[rk] || 0;',
    '      var toN = curCounts[rk] || 0;',
    '      if (toN < fromN) changes.push({ change: \'route-thinned\', routeId: rk, from: fromN, to: toN });',
    '    }',
    '    for (var m = 0; m < vessels.length; m++) {',
    '      var shipId = vessels[m].shipId;',
    '      var pv2 = prev[shipId];',
    '      var cv2 = cur[shipId];',
    "      if (isSailing(pv2) && !isSailing(cv2)) changes.push({ change: 'ship-kept-in-port', shipId: shipId, fromRoute: pv2 });",
    "      else if (isSailing(pv2) && isSailing(cv2) && cv2 !== pv2) changes.push({ change: 'route-changed', shipId: shipId, fromRoute: pv2, toRoute: cv2 });",
    '    }',
    "    if (typeof prevReserve === 'number' && typeof curReserve === 'number' && curReserve > prevReserve) {",
    "      changes.push({ change: 'reserve-increased', from: prevReserve, to: curReserve });",
    '    }',
    '    return changes;',
    '  }',
    '',
    '  function recordApplied(campaign, fromRound, changes) {',
    "    if (!campaign || !campaign.campaignId || !fromRound || !changes || changes.length === 0) return null;",
    '    var toRound = campaign.currentRound;',
    '    var l = readLearning() || { version: 1, concepts: {} };',
    '    var c = ensureConcept(l);',
    '    for (var i = 0; i < c.appliedAt.length; i++) {',
    '      var a = c.appliedAt[i];',
    '      if (a && a.campaignId === campaign.campaignId && a.fromRound === fromRound && a.toRound === toRound) return a;',
    '    }',
    '    var entry = { campaignId: campaign.campaignId, fromRound: fromRound, toRound: toRound, changes: changes };',
    '    c.appliedAt.push(entry);',
    '    writeLearning(l);',
    '    return entry;',
    '  }',
    '',
    '  global.FleetLearning = Object.freeze({',
    '    analyzeRound: analyzeRound,',
    '    coLossSummary: coLossSummary,',
    '    recordEncounter: recordEncounter,',
    '    recordFocus: recordFocus,',
    '    recordApplied: recordApplied,',
    '    planChanges: planChanges,',
    '    hasEncounterForCampaign: hasEncounterForCampaign,',
    '    getConcept: getConcept',
    '  });',
    "})(typeof window !== 'undefined' ? window : globalThis);",
    ''
  ], NL);
  fs.writeFileSync(path.join(ROOT, learningRel), src, 'utf8');
  applied.push('created fleet-learning.js');
} else {
  skipped.push('fleet-learning.js (already exists)');
}

/* ═══════════════════ PART 1: fleet-runtime.js ═══════════════════ */
(function patchRuntime() {
  const rel = 'fleet-runtime.js';
  const content = load(rel);
  const NL = eol(content);

  /* R1: module accessor */
  edit(rel, 'R1 learning accessor',
    "  var adapter = function() { return global.FleetInputAdapter; };",
    "  var adapter = function() { return global.FleetInputAdapter; };" + NL +
    "  var learning = function() { return global.FleetLearning; };",
    "var learning = function() { return global.FleetLearning; };");

  /* R2: applied evidence at start of submitPlan (after validations, before settle) */
  const appliedBlock = L([
    '    /* 学习证据（applied）：上一轮存在共同风险回放且本轮真实调整了方案才记录 */',
    '    var flLearning = learning();',
    '    if (flLearning && camp.rounds.length > 0) {',
    '      var prevRoundRes = camp.rounds[camp.rounds.length - 1];',
    '      if (prevRoundRes && flLearning.analyzeRound(prevRoundRes).length > 0) {',
    '        var strategyChanges = flLearning.planChanges(',
    '          prevRoundRes.assignments || {}, camp.assignments,',
    "          typeof prevRoundRes.reserveAfter === 'number' ? prevRoundRes.reserveAfter : camp.reserve,",
    '          camp.reserve',
    '        );',
    '        if (strategyChanges.length > 0) flLearning.recordApplied(camp, prevRoundRes.round, strategyChanges);',
    '      }',
    '    }'
  ], NL);
  edit(rel, 'R2 applied evidence in submitPlan',
    "    /* 校验 reserve 合法 */" + NL +
    "    var capCfg = cfg.capital;" + NL +
    "    if (camp.reserve < 0 || camp.reserve > capCfg.maxReserve || camp.reserve % capCfg.reserveStep !== 0) {" + NL +
    "      return { ok: false, reason: 'invalid-reserve' };" + NL +
    "    }" + NL +
    NL +
    "    var funds = { operatingCash: camp.operatingCash, reserve: camp.reserve };",
    "    /* 校验 reserve 合法 */" + NL +
    "    var capCfg = cfg.capital;" + NL +
    "    if (camp.reserve < 0 || camp.reserve > capCfg.maxReserve || camp.reserve % capCfg.reserveStep !== 0) {" + NL +
    "      return { ok: false, reason: 'invalid-reserve' };" + NL +
    "    }" + NL +
    NL +
    appliedBlock + NL +
    NL +
    "    var funds = { operatingCash: camp.operatingCash, reserve: camp.reserve };",
    "flLearning.recordApplied");

  /* R3: encountered evidence at very end of submitPlan (after round facts are stored) */
  edit(rel, 'R3 encounter evidence after fleet_round_settled',
    "    emit('fleet_round_settled', {" + NL +
    "      round: roundResult.round," + NL +
    "      campaignId: camp.campaignId," + NL +
    "      assignments: Object.assign({}, camp.assignments)," + NL +
    "      voyageIncome: roundResult.voyageIncome," + NL +
    "      cargoLoss: roundResult.cargoLoss," + NL +
    "      reserveUsed: roundResult.reserveUsed," + NL +
    "      operatingCashAfter: roundResult.operatingCashAfter," + NL +
    "      reserveAfter: roundResult.reserveAfter," + NL +
    "      insolvent: roundResult.insolvent" + NL +
    "    });" + NL +
    NL +
    "    return {",
    "    emit('fleet_round_settled', {" + NL +
    "      round: roundResult.round," + NL +
    "      campaignId: camp.campaignId," + NL +
    "      assignments: Object.assign({}, camp.assignments)," + NL +
    "      voyageIncome: roundResult.voyageIncome," + NL +
    "      cargoLoss: roundResult.cargoLoss," + NL +
    "      reserveUsed: roundResult.reserveUsed," + NL +
    "      operatingCashAfter: roundResult.operatingCashAfter," + NL +
    "      reserveAfter: roundResult.reserveAfter," + NL +
    "      insolvent: roundResult.insolvent" + NL +
    "    });" + NL +
    NL +
    "    /* 学习证据（encountered）：结算事实已保存后再记录，不改任何结算 */" + NL +
    "    var flEn = learning();" + NL +
    "    if (flEn) {" + NL +
    "      var commonEvents = flEn.analyzeRound(roundResult);" + NL +
    "      if (commonEvents.length > 0) flEn.recordEncounter(camp, roundResult, commonEvents);" + NL +
    "    }" + NL +
    NL +
    "    return {",
    "flEn.recordEncounter");

  /* R4: setLearningFocus function */
  edit(rel, 'R4 setLearningFocus function',
    "  /* ---- 放弃 campaign（归档，不删除） ---- */" + NL +
    NL +
    "  function abandonCampaign() {",
    L([
      '  /* ---- 学习证据：本轮风险关注（每 campaign 一次；choice 为 null 表示跳过） ---- */',
      '  function setLearningFocus(choice) {',
      '    var ns = readNamespace();',
      '    var camp = ns.activeCampaign;',
      "    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };",
      '    var valid = { route: true, departure: true, batch: true, none: true };',
      "    if (choice !== null && !valid[choice]) return { ok: false, reason: 'invalid-focus' };",
      "    camp.learningFocus = { shown: true, choice: choice, round: camp.currentRound };",
      '    camp.updatedAt = nowISO();',
      '    ns.activeCampaign = camp;',
      '    writeNamespace(ns);',
      '    var fl = learning();',
      "    if (fl && choice !== null) fl.recordFocus(camp, choice);",
      '    return { ok: true, learningFocus: camp.learningFocus };',
      '  }',
      '',
      '  /* ---- 放弃 campaign（归档，不删除） ---- */',
      '',
      '  function abandonCampaign() {'
    ], NL),
    "function setLearningFocus(choice) {");

  /* R5: export */
  edit(rel, 'R5 export setLearningFocus',
    "    setReinsurance: setReinsurance,",
    "    setReinsurance: setReinsurance," + NL + "    setLearningFocus: setLearningFocus,",
    "setLearningFocus: setLearningFocus,");
})();

/* ═══════════════════ PART 2: fleet-ui.js ═══════════════════ */
(function patchUi() {
  const rel = 'fleet-ui.js';
  const content = load(rel);
  const NL = eol(content);

  /* U1: extra styles */
  const styleAdd = L([
    "      '.fleet-start-center p{margin:0 0 20px;font-size:13px;color:#3E2A1B;line-height:1.6}',",
    "      '.fleet-learn{margin:8px 0;padding:8px 10px;background:#E8D7B0;border:1px dashed #8C6A4F;font-size:12px;color:#3E2A1B;line-height:1.6}',",
    "      '.fleet-learn b{color:#17324A}',",
    "      '.fleet-learn-options{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}',",
    "      '.fleet-learn-options .fleet-btn{min-height:30px;padding:4px 8px;font-size:11px;text-align:left}',",
    "      '.fleet-learn-note{margin:4px 0 0;font-size:11px;color:#6B4A2F}',",
    "      '.fleet-replay-line{margin:4px 0 0;padding-left:10px;border-left:2px solid #C89B3C;font-size:12px;line-height:1.6}'"
  ], NL);
  edit(rel, 'U1 learning styles',
    "      '.fleet-start-center p{margin:0 0 20px;font-size:13px;color:#3E2A1B;line-height:1.6}'",
    styleAdd,
    "'.fleet-replay-line{margin:4px 0 0;padding-left:10px");

  /* U2: helpers cluster before Result view */
  const helpers = L([
    '  /* ── 共同风险学习反馈（只读渲染；写入只经 FleetRuntime / FleetLearning） ── */',
    '  var FOCUS_LABELS = { route: \'多艘船同时走同一条航线\', departure: \'多艘船在相近时间出航\', batch: \'多艘船使用同一船材批次\', none: \'暂时没有特别关注的风险\' };',
    '  var FOCUS_ORDER = [[\'route\', \'多艘船同时走同一条航线\'], [\'departure\', \'多艘船在相近时间出航\'], [\'batch\', \'多艘船使用同一船材批次\'], [\'none\', \'暂时没有特别关注的风险\']];',
    '',
    '  function fleetLearning() { return global.FleetLearning; }',
    '',
    '  function focusLabel(choice) { return FOCUS_LABELS[choice] || null; }',
    '',
    '  function roundEvents(roundResult) {',
    '    var fl = fleetLearning();',
    '    return (fl && fl.analyzeRound && roundResult) ? (fl.analyzeRound(roundResult) || []) : [];',
    '  }',
    '',
    '  function hasConcentration(camp) {',
    '    if (!camp || !camp.assignments) return false;',
    '    var cfg = config();',
    '    var vessels = cfg.vessels;',
    '    var routeCounts = {};',
    '    var batchCounts = {};',
    '    for (var i = 0; i < vessels.length; i++) {',
    '      var rid = camp.assignments[vessels[i].shipId];',
    '      if (rid) {',
    '        routeCounts[rid] = (routeCounts[rid] || 0) + 1;',
    '        batchCounts[vessels[i].batchId] = (batchCounts[vessels[i].batchId] || 0) + 1;',
    '      }',
    '    }',
    '    var rks = Object.keys(routeCounts);',
    '    for (var j = 0; j < rks.length; j++) { if (routeCounts[rks[j]] >= 2) return true; }',
    '    var bks = Object.keys(batchCounts);',
    '    for (var k = 0; k < bks.length; k++) { if (batchCounts[bks[k]] >= 2) return true; }',
    '    return false;',
    '  }',
    '',
    '  function focusAskVisible(camp) {',
    "    if (!camp || camp.phase !== 'planning') return false;",
    '    if (camp.learningFocus && camp.learningFocus.shown) return false;',
    '    var fl = fleetLearning();',
    '    if (fl && fl.hasEncounterForCampaign && fl.hasEncounterForCampaign(camp.campaignId)) return false;',
    '    return hasConcentration(camp);',
    '  }',
    '',
    '  function eventHitText(ev) {',
    '    if (ev.type === \'storm\') {',
    '      return ev.names.join(\'、\') + \' 在同一回合同受\' + routeName(ev.sourceId) + \'风暴影响\';',
    '    }',
    '    return ev.names.join(\'、\') + \' 使用同一 \' + vesselBatchLabel(ev.sourceId) + \' 船材批次并同时受损\';',
    '  }',
    '',
    '  function eventShareSourceText(ev) {',
    '    if (ev.type === \'storm\') {',
    '      return routeName(ev.sourceId) + \' 上的风暴\';',
    '    }',
    '    return \'同一 \' + vesselBatchLabel(ev.sourceId) + \' 船材批次缺陷\';',
    '  }',
    '',
    '  function eventCardHtml(ev) {',
    '    var html = \'<div class="fleet-info"><b>发生了什么：</b>\' + eventHitText(ev) + \'。<br>\';',
    '    html += \'<div class="fleet-replay-line">共享风险来源：\' + eventShareSourceText(ev) + \'。</div>\';',
    '    if (ev.type === \'storm\') {',
    '      html += \'<div class="fleet-replay-line">它们在同一回合暴露于同一条航线，因此损失同时发生——这不是几次互不相关的事故。</div>\';',
    '    } else {',
    '      html += \'<div class="fleet-replay-line">本轮该批次的问题同时影响这些船；增加船只数量没有消除这个共同来源。</div>\';',
    '    }',
    '    html += \'<div class="fleet-replay-line">共同损失：\' + fmt(ev.totalLoss) + \'。</div></div>\';',
    '    return html;',
    '  }',
    '',
    '  function shortEventText(ev) {',
    '    return eventHitText(ev) + \'（共享来源：\' + eventShareSourceText(ev) + \'）。\';',
    '  }',
    '',
    '  function actualOutcomeText(events) {',
    '    var parts = [];',
    '    for (var i = 0; i < events.length; i++) {',
    '      var ev = events[i];',
    '      if (ev.type === \'storm\') {',
    '        parts.push(ev.names.join(\'、\') + \' 同时受\' + routeName(ev.sourceId) + \'风暴影响\');',
    '      } else {',
    '        parts.push(ev.names.join(\'、\') + \' 同时受\' + vesselBatchLabel(ev.sourceId) + \'批次缺陷影响\');',
    '      }',
    '    }',
    '    return parts.join(\'；\');',
    '  }',
    '',
    '  function renderRoundLearning(lastRound, camp) {',
    '    var events = roundEvents(lastRound);',
    '    var focusChoice = null;',
    '    if (camp && camp.learningFocus && camp.learningFocus.round === lastRound.round && camp.learningFocus.choice && camp.learningFocus.choice !== \'none\') {',
    '      focusChoice = camp.learningFocus.choice;',
    '    }',
    '    if (events.length === 0 && !focusChoice) return \'\';',
    '    var html = \'<div class="fleet-section"><h3 class="fleet-section-title">共同风险回放</h3>\';',
    '    if (focusChoice) {',
    '      html += \'<div class="fleet-learn">你本轮关注：<b>\' + focusLabel(focusChoice) + \'</b><br>\';',
    '      html += \'实际发生：\' + (events.length > 0 ? actualOutcomeText(events) : \'本轮没有出现多艘船因同一来源同时受损的情况。\') + \'</div>\';',
    '    }',
    '    for (var i = 0; i < events.length; i++) html += eventCardHtml(events[i]);',
    '    if (events.length > 0) {',
    '      var fl = fleetLearning();',
    '      var co = fl && fl.coLossSummary ? fl.coLossSummary(lastRound, events) : { names: [], totalLoss: 0 };',
    '      var independent = Math.round((lastRound.cargoLoss - co.totalLoss) * 100) / 100;',
    '      html += \'<div class="fleet-info"><b>组合影响：</b>共同风险损失合计 \' + fmt(co.totalLoss) + (co.names.length ? \'（\' + co.names.join(\'、\') + \'）\' : \'\');',
    '      html += \' ｜ 单船独立损失 \' + fmt(independent);',
    '      html += \' ｜ 准备金：\' + (lastRound.reserveUsed > 0 ? \'动用 \' + fmt(lastRound.reserveUsed) : \'未动用\') + \'。</div>\';',
    '    }',
    '    html += \'</div>\';',
    '    return html;',
    '  }',
    ''
  ], NL);
  edit(rel, 'U2 helpers cluster',
    '  /* ── Result 视图 ── */' + NL + '  function renderResult(camp) {',
    helpers + '  /* ── Result 视图 ── */' + NL + '  function renderResult(camp) {',
    'function focusAskVisible(camp) {');

  /* U3: planning - previous-round reminder (after expected is fetched) */
  const reminder = L([
    '',
    '    /* 学习反馈：上一轮共同风险 → 下一轮轻提示（无推荐，不自动改方案） */',
    '    var prevRound = camp.rounds.length > 0 ? camp.rounds[camp.rounds.length - 1] : null;',
    '    var prevEvents = prevRound ? roundEvents(prevRound) : [];',
    '    if (prevEvents.length > 0 && prevRound.round === camp.currentRound - 1) {',
    '      html += \'<div class="fleet-section"><h3 class="fleet-section-title">上一轮观察</h3>\';',
    '      for (var le = 0; le < prevEvents.length; le++) html += \'<div class="fleet-info">\' + shortEventText(prevEvents[le]) + \'</div>\';',
    '      html += \'<div class="fleet-learn">上一轮你观察到：多艘船共享同一风险来源并同时受损。本轮可以重新安排：是否继续集中在同一航线；是否错开航线；是否让部分船留港；是否调整准备金。<br>\';',
    '      html += \'<span class="fleet-learn-note">风险盘只记录你的实际安排，不做评价，不自动降低风险。</span></div>\';',
    '      html += \'</div>\';',
    '    }'
  ], NL);
  edit(rel, 'U3 previous-round reminder',
    "    var expected = runtime().getExpected();" + NL + NL + "    var html = fleetBar(camp);",
    "    var expected = runtime().getExpected();" + NL + NL + "    var html = fleetBar(camp);" + reminder,
    "fleet-section-title\">上一轮观察</h3>");

  /* U4: planning - one-time focus ask + recorded note (before submit actions) */
  const focusBlock = L([
    '    /* 学习反馈：一次性“风险关注”（已有同区方案确认流程，直接并入，不加新弹窗） */',
    '    var lf = camp.learningFocus;',
    '    if (lf && lf.choice && lf.round === camp.currentRound) {',
    '      html += \'<div class="fleet-learn">本轮风险关注已记录：<b>\' + focusLabel(lf.choice) + \'</b>（不做评价，不影响结算）。</div>\';',
    '    }',
    '    if (focusAskVisible(camp)) {',
    '      html += \'<div class="fleet-section"><h3 class="fleet-section-title">本轮风险关注</h3>\';',
    '      html += \'<div class="fleet-learn">只问一次、不做评价、不影响结算。当前方案已出现航线或批次集中，你比较担心哪一种共同风险？\';',
    '      html += \'<div class="fleet-learn-options">\';',
    '      for (var fo = 0; fo < FOCUS_ORDER.length; fo++) {',
    '        html += \'<button class="fleet-btn secondary" data-learning="\' + FOCUS_ORDER[fo][0] + \'">\' + FOCUS_ORDER[fo][1] + \'</button>\';',
    '      }',
    '      html += \'<button class="fleet-btn" data-learning="skip">暂时不选，直接提交</button>\';',
    '      html += \'</div></div></div>\';',
    '    }'
  ], NL);
  edit(rel, 'U4 one-time focus ask',
    "    /* 操作按钮 */" + NL + "    html += '<div class=\"fleet-actions\">';",
    focusBlock + NL +
    "    /* 操作按钮 */" + NL + "    html += '<div class=\"fleet-actions\">';",
    'data-learning="skip">暂时不选，直接提交</button>');

  /* U5: bind focus buttons at end of bindPlanningEvents */
  edit(rel, 'U5 focus buttons binding',
    "      });" + NL + "    });" + NL + "  }" + NL + NL + "  function showConfirmDialog(title, message, onConfirm) {",
    "      });" + NL + "    });" + NL + NL +
    "    var learnButtons = panelBody.querySelectorAll('[data-learning]');" + NL +
    "    for (var lb = 0; lb < learnButtons.length; lb++) {" + NL +
    "      learnButtons[lb].addEventListener('click', function() {" + NL +
    "        var key = this.getAttribute('data-learning');" + NL +
    "        runtime().setLearningFocus(key === 'skip' ? null : key);" + NL +
    "        render();" + NL +
    "      });" + NL +
    "    }" + NL +
    "  }" + NL + NL + "  function showConfirmDialog(title, message, onConfirm) {",
    'panelBody.querySelectorAll(\'[data-learning]\')');

  /* U6: result view - replay section insertion */
  edit(rel, 'U6 replay section in result view',
    "      html += '</table></div>';" + NL +
    "    }" + NL +
    NL +
    "    html += '<div class=\"fleet-section\"><h3 class=\"fleet-section-title\">逐船结算</h3>';",
    "      html += '</table></div>';" + NL +
    "    }" + NL +
    NL +
    "    html += renderRoundLearning(lastRound, camp);" + NL +
    NL +
    "    html += '<div class=\"fleet-section\"><h3 class=\"fleet-section-title\">逐船结算</h3>';",
    "html += renderRoundLearning(lastRound, camp);");
})();

/* ═══════════════════ PART 3: index.html ═══════════════════ */
(function patchIndex() {
  const rel = 'index.html';
  const content = load(rel);
  const NL = eol(content);

  edit(rel, 'I1 load fleet-learning.js',
    '<script src="./fleet-stats.js?v=20260903-4"></script>',
    '<script src="./fleet-stats.js?v=20260903-4"></script>' +
    '<script src="./fleet-learning.js?v=20260903-1"></script>',
    '<script src="./fleet-learning.js?v=20260903-1"></script>');

  edit(rel, 'I2 bump runtime/ui cache versions',
    '<script src="./fleet-runtime.js?v=20260903-1"></script><script src="./fleet-ui.js?v=20260903-1"></script>',
    '<script src="./fleet-runtime.js?v=20260903-2"></script><script src="./fleet-ui.js?v=20260903-2"></script>',
    './fleet-runtime.js?v=20260903-2');
})();

console.log('APPLIED:\n - ' + applied.join('\n - '));
console.log('SKIPPED:\n - ' + skipped.join('\n - '));
console.log('applied count:', applied.length, '| skipped count:', skipped.length);
