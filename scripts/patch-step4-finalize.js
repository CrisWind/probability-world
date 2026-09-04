/* Step-4 finalize: 学习层收口补丁（幂等；Node 运行）
 * G1 sampling 亲历门槛：报告存在未检查风险（missedDefects>0）才记录；
 * G2 sampling 应用门槛：sourceReportId 必须已有亲历记录；
 * G3 LearningAdapter.onLearningEvidence 本地透传 + 5 个证据点接线；
 * G4 港口笔记空态文案；index.html 版本号。 */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');

const results = [];
function apply(file, label, oldStr, newStr, marker) {
  const p = path.join(DIR, file);
  let src = fs.readFileSync(p, 'utf8');
  if (marker && src.includes(marker)) { results.push({ label, status: 'SKIP(marker)' }); return; }
  const occ = src.split(oldStr).length - 1;
  if (occ === 0) { results.push({ label, status: 'SKIP(already)' }); return; }
  if (occ > 1) { results.push({ label, status: 'FAIL(multi x' + occ + ')' }); return; }
  src = src.replace(oldStr, newStr);
  fs.writeFileSync(p, src);
  results.push({ label, status: 'APPLY' });
}

/* 修复：上一版"锚点前插入"编辑重放导致 helper 块重复 —— 双份收敛为一份（幂等） */
const SAMPLING_HELPER = [
  '  /* G3 证据透传 LearningAdapter（本地校验+日志边界；调用失败不影响存档） */',
  '  function reportEvidence(ev) {',
  '    var adapter = global.LearningAdapter;',
  '    if (!adapter || typeof adapter.onLearningEvidence !== \'function\') return;',
  '    try { adapter.onLearningEvidence(ev); }',
  '    catch (err) { console.error(\'[SamplingLearning] adapter report failed\', err); }',
  '  }'
].join('\n');
apply('sampling-learning.js', 'REPAIR duplicate helper', SAMPLING_HELPER + '\n\n' + SAMPLING_HELPER, SAMPLING_HELPER);
const FLEET_HELPER = [
  '  /* G3 证据透传 LearningAdapter（本地校验+日志边界；调用失败不影响存档） */',
  '  function adapterReport(ev) {',
  '    var adapter = global.LearningAdapter;',
  '    if (!adapter || typeof adapter.onLearningEvidence !== \'function\') return;',
  '    try { adapter.onLearningEvidence(ev); }',
  '    catch (err) { console.error(\'[FleetLearning] adapter report failed\', err); }',
  '  }'
].join('\n');
apply('fleet-learning.js', 'REPAIR duplicate helper', FLEET_HELPER + '\n\n' + FLEET_HELPER, FLEET_HELPER);

/* ---------- sampling-learning.js（LF） ---------- */
apply('sampling-learning.js', 'G1 encounter guard', [
  '    var sampled = Array.isArray(report.sampledParts) ? report.sampledParts : [];',
  '    var outcome = report.actualOutcome || {};'
].join('\n'), [
  '    var outcome = report.actualOutcome || {};',
  '    /* G1 亲历门槛：必须存在真实未检查风险（缺陷落在未检查部位）才算"样本≠整体"；仅完成一次质检不自动记录。 */',
  '    if (!Array.isArray(outcome.missedDefects) || outcome.missedDefects.length === 0) return null;',
  '    var sampled = Array.isArray(report.sampledParts) ? report.sampledParts : [];'
].join('\n'));

/* 剥除 REFINE 后残留的重复旧式 G2 guard（oldStr 以 REFINE 先置 guard 文本开头，
 * 只匹配"先置 guard 与 dedupe 后旧式 guard 并存"的重复状态；剥除后与原始未 REFINE 状态均不匹配，任意顺序幂等） */
apply('sampling-learning.js', 'REPAIR duplicate G2 guard', [
  '    /* G2 应用门槛：必须先亲历过同一份报告的未检查风险，应用证据才有依据（无对应亲历则不建概念、不记录）。 */',
  '    var prior = readLearning();',
  '    var priorC = (prior && prior.concepts) ? prior.concepts[CONCEPT_ID] : null;',
  '    var priorEncs = (priorC && Array.isArray(priorC.encounters)) ? priorC.encounters : [];',
  '    var encSeen = false;',
  '    for (var j0 = 0; j0 < priorEncs.length; j0++) {',
  '      if (priorEncs[j0] && priorEncs[j0].reportId === sourceReportId) { encSeen = true; break; }',
  '    }',
  '    if (!encSeen) return null;',
  '    var l = prior || { version: 1, concepts: {} };',
  '    var c = ensureConcept(l);',
  '    var round = campaign.currentRound;',
  '    for (var i = 0; i < c.applications.length; i++) {',
  '      var a = c.applications[i];',
  '      if (a && a.campaignId === campaign.campaignId && a.round === round && a.sourceReportId === sourceReportId) return a;',
  '    }',
  '    /* G2 应用门槛：必须先亲历过同一份报告的未检查风险，应用证据才有依据（无对应亲历则不记）。 */',
  '    var encSeen = false;',
  '    var encs = c.encounters || [];',
  '    for (var e2 = 0; e2 < encs.length; e2++) {',
  '      if (encs[e2] && encs[e2].reportId === sourceReportId) { encSeen = true; break; }',
  '    }',
  '    if (!encSeen) return null;',
  '    var entry = { campaignId: campaign.campaignId, round: round, changes: changes, sourceReportId: sourceReportId };'
].join('\n'), [
  '    /* G2 应用门槛：必须先亲历过同一份报告的未检查风险，应用证据才有依据（无对应亲历则不建概念、不记录）。 */',
  '    var prior = readLearning();',
  '    var priorC = (prior && prior.concepts) ? prior.concepts[CONCEPT_ID] : null;',
  '    var priorEncs = (priorC && Array.isArray(priorC.encounters)) ? priorC.encounters : [];',
  '    var encSeen = false;',
  '    for (var j0 = 0; j0 < priorEncs.length; j0++) {',
  '      if (priorEncs[j0] && priorEncs[j0].reportId === sourceReportId) { encSeen = true; break; }',
  '    }',
  '    if (!encSeen) return null;',
  '    var l = prior || { version: 1, concepts: {} };',
  '    var c = ensureConcept(l);',
  '    var round = campaign.currentRound;',
  '    for (var i = 0; i < c.applications.length; i++) {',
  '      var a = c.applications[i];',
  '      if (a && a.campaignId === campaign.campaignId && a.round === round && a.sourceReportId === sourceReportId) return a;',
  '    }',
  '    var entry = { campaignId: campaign.campaignId, round: round, changes: changes, sourceReportId: sourceReportId };'
].join('\n'));

apply('sampling-learning.js', 'adapter helper', [
  '  function getConcept() {'
].join('\n'), [
  '  /* G3 证据透传 LearningAdapter（本地校验+日志边界；调用失败不影响存档） */',
  '  function reportEvidence(ev) {',
  '    var adapter = global.LearningAdapter;',
  '    if (!adapter || typeof adapter.onLearningEvidence !== \'function\') return;',
  '    try { adapter.onLearningEvidence(ev); }',
  '    catch (err) { console.error(\'[SamplingLearning] adapter report failed\', err); }',
  '  }',
  '',
  '  function getConcept() {'
].join('\n'), '/* G3 证据透传 LearningAdapter');

apply('sampling-learning.js', 'encounter adapter call', [
  '    c.encounters.push(entry);',
  '    writeLearning(l);',
  '    return entry;'
].join('\n'), [
  '    c.encounters.push(entry);',
  '    writeLearning(l);',
  '    reportEvidence({ conceptId: \'sampling_representativeness\', state: \'encountered\', context: \'inspection_completed\',',
  '      sourceRefs: [{ reportId: report.reportId, shipId: report.shipId }],',
  '      actions: [{ decision: report.decision }],',
  '      resultRefs: [{ sailed: outcome.sailed === true, accident: outcome.accident === true,',
  '        missedDefects: entry.outcome.missedDefects.length, uninspectedParts: entry.uninspectedParts.length }] });',
  '    return entry;'
].join('\n'));

apply('sampling-learning.js', 'application adapter call', [
  '    c.applications.push(entry);',
  '    writeLearning(l);',
  '    return entry;'
].join('\n'), [
  '    c.applications.push(entry);',
  '    writeLearning(l);',
  '    reportEvidence({ conceptId: \'sampling_representativeness\', state: \'applied\', context: \'fleet_plan_submitted\',',
  '      sourceRefs: [{ campaignId: campaign.campaignId, round: round, reportId: sourceReportId }],',
  '      actions: changes, resultRefs: [] });',
  '    return entry;'
].join('\n'));

/* ---------- fleet-learning.js（LF） ---------- */
apply('fleet-learning.js', 'adapter helper', [
  '  /* ---- migrations：跨场景"再次使用"（已迁移）。只由真实行为链达成一次，不重复追加 ----'
].join('\n'), [
  '  /* G3 证据透传 LearningAdapter（本地校验+日志边界；调用失败不影响存档） */',
  '  function adapterReport(ev) {',
  '    var adapter = global.LearningAdapter;',
  '    if (!adapter || typeof adapter.onLearningEvidence !== \'function\') return;',
  '    try { adapter.onLearningEvidence(ev); }',
  '    catch (err) { console.error(\'[FleetLearning] adapter report failed\', err); }',
  '  }',
  '',
  '  /* ---- migrations：跨场景"再次使用"（已迁移）。只由真实行为链达成一次，不重复追加 ----'
].join('\n'), '/* G3 证据透传 LearningAdapter');

apply('fleet-learning.js', 'encounter adapter call', [
  '    c.encounterRefs.push(ref);',
  '    if (!c.encounteredAt) c.encounteredAt = new Date().toISOString();',
  '    writeLearning(l);',
  '    return ref;'
].join('\n'), [
  '    c.encounterRefs.push(ref);',
  '    if (!c.encounteredAt) c.encounteredAt = new Date().toISOString();',
  '    writeLearning(l);',
  '    adapterReport({ conceptId: \'correlated_risk\', state: \'encountered\', context: \'fleet_round_settled\',',
  '      sourceRefs: [{ campaignId: campaign.campaignId, round: roundResult.round }], actions: [],',
  '      resultRefs: events.map(function (e) { return { type: e.type, sourceId: e.sourceId, vesselCount: (e.vesselIds || []).length }; }) });',
  '    return ref;'
].join('\n'));

apply('fleet-learning.js', 'applied adapter call', [
  '    c.appliedAt.push(entry);',
  '    writeLearning(l);',
  '    return entry;'
].join('\n'), [
  '    c.appliedAt.push(entry);',
  '    writeLearning(l);',
  '    adapterReport({ conceptId: \'correlated_risk\', state: \'applied\', context: \'fleet_plan_submitted\',',
  '      sourceRefs: [{ campaignId: campaign.campaignId, fromRound: fromRound, toRound: toRound }],',
  '      actions: changes, resultRefs: [] });',
  '    return entry;'
].join('\n'));

apply('fleet-learning.js', 'migration adapter call', [
  '    c.migrations.push(rec);',
  '    writeLearning(l);',
  '    return rec;'
].join('\n'), [
  '    c.migrations.push(rec);',
  '    writeLearning(l);',
  '    adapterReport({ conceptId: \'correlated_risk\', state: \'migrated\', context: rec.context,',
  '      sourceRefs: [{ contextKey: rec.contextKey, refs: rec.refs || null }],',
  '      actions: [{ decision: rec.decision || null, extendedSamples: rec.extendedSamples === true, managed: rec.managed === true }],',
  '      resultRefs: Array.isArray(rec.aggregations) ? rec.aggregations : [] });',
  '    return rec;'
].join('\n'));

/* ---------- learning-adapter.js（LF；整体替换） ---------- */
apply('learning-adapter.js', 'G3 adapter evidence method', [
  '(function (global) {',
  '  function onQuestCompleted(input) {',
  '    if (!input || !input.questId || !input.completedAt) return { success: false, reason: \'invalid_completion\' };',
  '    console.info(\'[LearningAdapter] quest completed\', { questId: input.questId, outcomeId: input.outcomeId || null, completedAt: input.completedAt });',
  '    return { success: true, deferred: true };',
  '  }',
  '  global.LearningAdapter = Object.freeze({ onQuestCompleted: onQuestCompleted });',
  '})(window);'
].join('\n'), [
  '(function (global) {',
  '  function onQuestCompleted(input) {',
  '    if (!input || !input.questId || !input.completedAt) return { success: false, reason: \'invalid_completion\' };',
  '    console.info(\'[LearningAdapter] quest completed\', { questId: input.questId, outcomeId: input.outcomeId || null, completedAt: input.completedAt });',
  '    return { success: true, deferred: true };',
  '  }',
  '  /* G3 learning-evidence pass-through boundary：只校验结构并本地记录，永不发起网络 IO；deferred 留给未来平台层。 */',
  '  var EXTRA_KEYS = [\'sourceRefs\', \'actions\', \'resultRefs\'];',
  '  function onLearningEvidence(input) {',
  '    if (!input || !input.conceptId || !input.state || !input.context) return { success: false, reason: \'invalid_evidence\' };',
  '    var payload = { conceptId: input.conceptId, state: input.state, context: input.context };',
  '    for (var i = 0; i < EXTRA_KEYS.length; i++) {',
  '      var k = EXTRA_KEYS[i];',
  '      if (input[k] !== undefined) payload[k] = input[k];',
  '    }',
  '    console.info(\'[LearningAdapter] learning evidence\', Object.assign({ receivedAt: new Date().toISOString() }, payload));',
  '    return { success: true, deferred: true };',
  '  }',
  '  global.LearningAdapter = Object.freeze({ onQuestCompleted: onQuestCompleted, onLearningEvidence: onLearningEvidence });',
  '})(window);'
].join('\n'));

/* ---------- harbor-notes.js（LF；空态文案不再暗示"完成质检必有笔记"） ---------- */
apply('harbor-notes.js', 'empty state copy', [
  '<div class="pn-empty">港口笔记还没有抄录下经历。<br>先在风险盘亲历共同风险并调整船队，或到质检房完成一次质检吧——笔记只记录发生过的行为。</div>'
].join('\n'), [
  '<div class="pn-empty">港口笔记还没有抄录下经历。<br>它只记录发生过的行为——先去风险盘亲历共同风险并调整船队，或在质检房抽检一艘船，看看未检查部位后来发生了什么吧。</div>'
].join('\n'));

/* ---------- index.html（CRLF；版本号锚点均为行内子串，不跨换行） ---------- */
apply('index.html', 'learning-adapter version bump', 'learning-adapter.js?v=20260902-1', 'learning-adapter.js?v=20260903-2');
apply('index.html', 'sampling-learning version bump', 'sampling-learning.js?v=20260903-1', 'sampling-learning.js?v=20260903-2');
apply('index.html', 'fleet-learning version bump', 'fleet-learning.js?v=20260903-2', 'fleet-learning.js?v=20260903-3');
apply('index.html', 'harbor-notes version bump', 'harbor-notes.js?v=20260903-1', 'harbor-notes.js?v=20260903-2');

/* ---------- REFINE：G1/G2 门槛前移到 ensureConcept 之前，干净报告/无亲历应用不产生任何概念 ---------- */
apply('sampling-learning.js', 'REFINE G1 guard before concept', [
  '  function recordInspectionEncounter(report) {',
  '    if (!report || !report.reportId || !report.shipId) return null;',
  '    var l = readLearning() || { version: 1, concepts: {} };',
  '    var c = ensureConcept(l);',
  '    for (var i = 0; i < c.encounters.length; i++) {',
  '      if (c.encounters[i] && c.encounters[i].reportId === report.reportId) return c.encounters[i];',
  '    }',
  '    var outcome = report.actualOutcome || {};',
  '    /* G1 亲历门槛：必须存在真实未检查风险（缺陷落在未检查部位）才算"样本≠整体"；仅完成一次质检不自动记录。 */',
  '    if (!Array.isArray(outcome.missedDefects) || outcome.missedDefects.length === 0) return null;',
  '    var sampled = Array.isArray(report.sampledParts) ? report.sampledParts : [];'
].join('\n'), [
  '  function recordInspectionEncounter(report) {',
  '    if (!report || !report.reportId || !report.shipId) return null;',
  '    /* G1 亲历门槛：必须存在真实未检查风险（缺陷落在未检查部位）才算"样本≠整体"；仅完成一次质检不自动记录。 */',
  '    var outcome = report.actualOutcome || {};',
  '    if (!Array.isArray(outcome.missedDefects) || outcome.missedDefects.length === 0) return null;',
  '    var l = readLearning() || { version: 1, concepts: {} };',
  '    var c = ensureConcept(l);',
  '    for (var i = 0; i < c.encounters.length; i++) {',
  '      if (c.encounters[i] && c.encounters[i].reportId === report.reportId) return c.encounters[i];',
  '    }',
  '    var sampled = Array.isArray(report.sampledParts) ? report.sampledParts : [];'
].join('\n'));

apply('sampling-learning.js', 'REFINE G2 guard before concept', [
  '    if (!campaign || !campaign.campaignId || !changes || changes.length === 0 || !sourceReportId) return null;',
  '    var l = readLearning() || { version: 1, concepts: {} };',
  '    var c = ensureConcept(l);',
  '    var round = campaign.currentRound;',
  '    for (var i = 0; i < c.applications.length; i++) {',
  '      var a = c.applications[i];',
  '      if (a && a.campaignId === campaign.campaignId && a.round === round && a.sourceReportId === sourceReportId) return a;',
  '    }',
  '    /* G2 应用门槛：必须先亲历过同一份报告的未检查风险，应用证据才有依据（无对应亲历则不记）。 */',
  '    var encSeen = false;',
  '    var encs = c.encounters || [];',
  '    for (var e2 = 0; e2 < encs.length; e2++) {',
  '      if (encs[e2] && encs[e2].reportId === sourceReportId) { encSeen = true; break; }',
  '    }',
  '    if (!encSeen) return null;'
].join('\n'), [
  '    if (!campaign || !campaign.campaignId || !changes || changes.length === 0 || !sourceReportId) return null;',
  '    /* G2 应用门槛：必须先亲历过同一份报告的未检查风险，应用证据才有依据（无对应亲历则不建概念、不记录）。 */',
  '    var prior = readLearning();',
  '    var priorC = (prior && prior.concepts) ? prior.concepts[CONCEPT_ID] : null;',
  '    var priorEncs = (priorC && Array.isArray(priorC.encounters)) ? priorC.encounters : [];',
  '    var encSeen = false;',
  '    for (var j0 = 0; j0 < priorEncs.length; j0++) {',
  '      if (priorEncs[j0] && priorEncs[j0].reportId === sourceReportId) { encSeen = true; break; }',
  '    }',
  '    if (!encSeen) return null;',
  '    var l = prior || { version: 1, concepts: {} };',
  '    var c = ensureConcept(l);',
  '    var round = campaign.currentRound;',
  '    for (var i = 0; i < c.applications.length; i++) {',
  '      var a = c.applications[i];',
  '      if (a && a.campaignId === campaign.campaignId && a.round === round && a.sourceReportId === sourceReportId) return a;',
  '    }'
].join('\n'));

/* ---------- 同步 Step-2 回归套件到收口语义 ---------- */
apply('scripts/test-qa-migration.js', 'section 3 new semantics', [
  '/* 3. sampling-learning: encounter record, dedupe, merge with correlated_risk */',
  '{',
  '  set(\'world.learning\', { version: 1, concepts: { correlated_risk: { conceptId: \'correlated_risk\', encounteredAt: \'kept\', encounterRefs: [], focusedOn: [], appliedAt: [] } } });',
  '  const rep = report(\'r-enc\', \'2026-09-03T08:00:00Z\', \'repair_full\', \'full\', 6, 5, 5, 0);',
  '  const first = SL.recordInspectionEncounter(rep);',
  '  const again = SL.recordInspectionEncounter(rep);',
  '  const concept = SL.getConcept();',
  '  ok(\'encounter dedupes by reportId\', first === again && concept.encounters.length === 1);',
  '  ok(\'encounter shape (sampled/uninspected/actual/decision)\', concept.encounters[0].reportId === \'r-enc\'',
  '    && concept.encounters[0].uninspectedParts.length === 18',
  '    && concept.encounters[0].sampledParts.length === 6',
  '    && concept.encounters[0].actualDefects.length === 5',
  '    && concept.encounters[0].decision === \'repair_full\');',
  '  const l = get(\'world.learning\');',
  '  ok(\'correlated_risk concept preserved (merge)\', l.concepts.correlated_risk && l.concepts.correlated_risk.encounteredAt === \'kept\' && !!l.concepts.sampling_representativeness);',
  '  const forbidden = [\'mastered\', \'correct\', \'wrong\', \'score\'].some(k => Object.keys(concept).includes(k) || JSON.stringify(concept).includes(\'"\' + k + \'"\'));',
  '  ok(\'no mastered/correct/wrong/score anywhere\', forbidden === false);',
  '  /* application dedupe */',
  '  const campD = { campaignId: \'dedupe-1\', currentRound: 7 };',
  '  const ch = [{ change: \'ship-set-sailing\', shipId: DAWN, fromRoute: null, toRoute: \'route.north\' }];',
  '  const a1 = SL.recordFleetApplication(campD, ch, \'r-enc\');',
  '  const a2 = SL.recordFleetApplication(campD, ch, \'r-enc\');',
  '  ok(\'application dedupes per campaign+round+source\', a1 === a2 && SL.getConcept().applications.length === 1);',
  '  ok(\'empty changes rejected\', SL.recordFleetApplication({ campaignId: \'x\', currentRound: 1 }, [], \'r-enc\') === null);',
  '}'
].join('\n'), [
  '/* 3. sampling-learning: G1 亲历门槛（仅完成质检不记录）、去重、merge、G2 应用门槛 */',
  '{',
  '  set(\'world.learning\', { version: 1, concepts: { correlated_risk: { conceptId: \'correlated_risk\', encounteredAt: \'kept\', encounterRefs: [], focusedOn: [], appliedAt: [] } } });',
  '  const clean = report(\'r-clean\', \'2026-09-03T08:00:00Z\', \'repair_full\', \'full\', 8, 5, 5, 0);',
  '  ok(\'clean full-coverage QA 不构成亲历（missed=0）\', SL.recordInspectionEncounter(clean) === null && SL.getConcept() === null);',
  '  const rep = report(\'r-enc\', \'2026-09-03T08:00:00Z\', \'repair_partial\', \'partial\', 6, 3, 5, 2);',
  '  const first = SL.recordInspectionEncounter(rep);',
  '  const again = SL.recordInspectionEncounter(rep);',
  '  const concept = SL.getConcept();',
  '  ok(\'encounter dedupes by reportId\', first === again && concept.encounters.length === 1);',
  '  ok(\'encounter shape (sampled/uninspected/missed/decision)\', concept.encounters[0].reportId === \'r-enc\'',
  '    && concept.encounters[0].uninspectedParts.length === 18',
  '    && concept.encounters[0].sampledParts.length === 6',
  '    && concept.encounters[0].actualDefects.length === 5',
  '    && concept.encounters[0].outcome.missedDefects.length === 2',
  '    && concept.encounters[0].decision === \'repair_partial\');',
  '  const l = get(\'world.learning\');',
  '  ok(\'correlated_risk concept preserved (merge)\', l.concepts.correlated_risk && l.concepts.correlated_risk.encounteredAt === \'kept\' && !!l.concepts.sampling_representativeness);',
  '  const forbidden = [\'mastered\', \'correct\', \'wrong\', \'score\', \'learningLevel\', \'examResult\', \'level\']',
  '    .some(k => Object.keys(concept).includes(k) || JSON.stringify(concept).includes(\'"\' + k + \'"\'));',
  '  ok(\'no mastered/correct/wrong/score/learningLevel/examResult anywhere\', forbidden === false);',
  '  /* G2: 无同报告亲历的应用被拒绝；有亲历后才记录 */',
  '  const campD = { campaignId: \'dedupe-1\', currentRound: 7 };',
  '  const ch = [{ change: \'ship-set-sailing\', shipId: DAWN, fromRoute: null, toRoute: \'route.north\' }];',
  '  ok(\'application w/o prior encounter rejected\', SL.recordFleetApplication(campD, ch, \'r-clean\') === null);',
  '  const a1 = SL.recordFleetApplication(campD, ch, \'r-enc\');',
  '  const a2 = SL.recordFleetApplication(campD, ch, \'r-enc\');',
  '  ok(\'application dedupes per campaign+round+source\', a1 === a2 && SL.getConcept().applications.length === 1);',
  '  ok(\'empty changes rejected\', SL.recordFleetApplication({ campaignId: \'x\', currentRound: 1 }, [], \'r-enc\') === null);',
  '}'
].join('\n'));

apply('scripts/test-qa-migration.js', 'section 4 seed sampling encounter', [
  '  set(\'world.learning\', { version: 1, concepts: { correlated_risk: { conceptId: \'correlated_risk\', encounteredAt: \'kept2\', encounterRefs: [], focusedOn: [], appliedAt: [] } } });'
].join('\n'), [
  '  set(\'world.learning\', { version: 1, concepts: {',
  '    correlated_risk: { conceptId: \'correlated_risk\', encounteredAt: \'kept2\', encounterRefs: [], focusedOn: [], appliedAt: [] },',
  '    sampling_representativeness: { conceptId: \'sampling_representativeness\', encounters: [{ reportId: \'r-hold\', shipId: \'dawn-01\' }], applications: [] }',
  '  } });'
].join('\n'));

/* ---------- 汇总 ---------- */
let applied = 0, skipped = 0, failed = 0;
for (const r of results) {
  if (r.status === 'APPLY') applied++;
  else if (r.status.indexOf('SKIP') === 0) skipped++;
  else failed++;
  console.log(r.status.padEnd(18) + r.label);
}
console.log('applied=' + applied + ' skipped=' + skipped + ' failed=' + failed);
process.exit(failed > 0 ? 1 : 0);
