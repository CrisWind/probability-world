/* 概率世界 · 抽样代表性学习证据层（sampling_representativeness）
 * 概念：抽样代表性——样本覆盖之外的部位仍是未知，检查过的部分不代表未检查部分。
 * 只把最小跨玩法证据写入 world.learning.concepts.sampling_representativeness：
 *   encounters   = 玩家真实完成一次质检（报告已落盘）后记录一次（“已亲历”）；
 *   applications = 风险盘中相对上一回合的实际方案调整涉及质检船/同批次船或准备金（“已使用/已迁移”）。
 * 无 mastered/correct/wrong/score 字段；不建等级、不改成就/奖励、不操作 DOM、不发事件。
 * 写入入口：shipyard-runtime.submitDecision（质检侧）+ fleet-runtime.submitPlan（风险盘侧）。 */
(function attachSamplingLearning(global) {
  'use strict';

  var CONCEPT_ID = 'sampling_representativeness';

  function store() { return global.__gameStore; }
  function shipyardConfig() { return global.SHIPYARD_CONFIG; }
  function fleetLearning() { return global.FleetLearning; }

  function readLearning() {
    var gs = store();
    if (!gs || !gs.get) return null;
    var l = gs.get('world.learning');
    return l && typeof l === 'object' ? l : null;
  }

  function writeLearning(learning) {
    var gs = store();
    if (!gs || !gs.set) return;
    gs.set('world.learning', learning);
    gs.save();
  }

  function ensureConcept(learning) {
    var l = learning && typeof learning === 'object' ? learning : { version: 1, concepts: {} };
    if (!l.concepts || typeof l.concepts !== 'object') l.concepts = {};
    var c = l.concepts[CONCEPT_ID];
    if (!c) {
      c = { conceptId: CONCEPT_ID, encounters: [], applications: [] };
      l.concepts[CONCEPT_ID] = c;
    }
    if (!Array.isArray(c.encounters)) c.encounters = [];
    if (!Array.isArray(c.applications)) c.applications = [];
    return c;
  }

  /* 质检批次 24 个部位 id 是确定性的（zone 1..6），只用于推导“未检查部位”清单，不重算缺陷。 */
  function allPartIds() {
    var cfg = shipyardConfig();
    if (!cfg || !cfg.batch) return [];
    var zones = cfg.batch.zones || [];
    var per = cfg.batch.partsPerZone || 6;
    var ids = [];
    for (var z = 0; z < zones.length; z++) {
      for (var i = 1; i <= per; i++) ids.push(zones[z] + '-' + i);
    }
    return ids;
  }

  function difference(all, sampled) {
    var result = [];
    for (var i = 0; i < all.length; i++) {
      if (sampled.indexOf(all[i]) === -1) result.push(all[i]);
    }
    return result;
  }

  /* ---- 亲历：质检报告落盘后记录（同 reportId 只记一次） ---- */
  function recordInspectionEncounter(report) {
    if (!report || !report.reportId || !report.shipId) return null;
    /* G1 亲历门槛：必须存在真实未检查风险（缺陷落在未检查部位）才算"样本≠整体"；仅完成一次质检不自动记录。 */
    var outcome = report.actualOutcome || {};
    if (!Array.isArray(outcome.missedDefects) || outcome.missedDefects.length === 0) return null;
    var l = readLearning() || { version: 1, concepts: {} };
    var c = ensureConcept(l);
    for (var i = 0; i < c.encounters.length; i++) {
      if (c.encounters[i] && c.encounters[i].reportId === report.reportId) return c.encounters[i];
    }
    var sampled = Array.isArray(report.sampledParts) ? report.sampledParts : [];
    var entry = {
      reportId: report.reportId,
      shipId: report.shipId,
      sampledParts: sampled.slice(),
      uninspectedParts: difference(allPartIds(), sampled),
      defectsFound: Array.isArray(report.defectsFound) ? report.defectsFound.slice() : [],
      actualDefects: Array.isArray(outcome.allDefectIds) ? outcome.allDefectIds.slice() : [],
      decision: report.decision,
      outcome: {
        sailed: outcome.sailed === true,
        accident: outcome.accident === true,
        accidentCause: outcome.accidentCause || null,
        remainingDefects: Array.isArray(outcome.remainingDefects) ? outcome.remainingDefects.slice() : [],
        missedDefects: Array.isArray(outcome.missedDefects) ? outcome.missedDefects.slice() : []
      }
    };
    c.encounters.push(entry);
    writeLearning(l);
    reportEvidence({ conceptId: 'sampling_representativeness', state: 'encountered', context: 'inspection_completed',
      sourceRefs: [{ reportId: report.reportId, shipId: report.shipId }],
      actions: [{ decision: report.decision }],
      resultRefs: [{ sailed: outcome.sailed === true, accident: outcome.accident === true,
        missedDefects: entry.outcome.missedDefects.length, uninspectedParts: entry.uninspectedParts.length }] });
    return entry;
  }

  /* ---- 风险盘应用：仅当快照带质检效果、且调整涉及质检船或其同批次船/准备金 ----
   * 复用 FleetLearning.planChanges（事实差异），再补“被强制留港后恢复出航”这一项；
   * 只记录实际发生的安排，不做因果断言。 ---- */
  function fleetAdjustmentChanges(campaign, prevRoundRes, curAssignments, curReserve) {
    if (!campaign || !prevRoundRes) return [];
    var effects = Array.isArray(campaign.shipyardEffects) ? campaign.shipyardEffects : [];
    if (effects.length === 0) return [];
    var cfg = global.FLEET_CONFIG || null;
    var vessels = cfg && Array.isArray(cfg.vessels) ? cfg.vessels : [];
    var batchOf = {}, membersOf = {};
    for (var i = 0; i < vessels.length; i++) {
      batchOf[vessels[i].shipId] = vessels[i].batchId;
      if (!membersOf[vessels[i].batchId]) membersOf[vessels[i].batchId] = [];
      membersOf[vessels[i].batchId].push(vessels[i].shipId);
    }
    var relevant = {};
    for (var e = 0; e < effects.length; e++) {
      var sid = effects[e].shipId;
      relevant[sid] = true;
      var bid = batchOf[sid];
      var members = membersOf[bid] || [];
      for (var m = 0; m < members.length; m++) relevant[members[m]] = true;
    }
    var fl = fleetLearning();
    var base = (fl && fl.planChanges) ? fl.planChanges(
      prevRoundRes.assignments || {}, curAssignments || {},
      typeof prevRoundRes.reserveAfter === 'number' ? prevRoundRes.reserveAfter : 0,
      typeof curReserve === 'number' ? curReserve : 0
    ) : [];
    var changes = [];
    for (var b = 0; b < base.length; b++) {
      var ch = base[b];
      if (ch.change === 'reserve-increased') { changes.push(ch); continue; }
      if (ch.shipId && relevant[ch.shipId]) changes.push(ch);
    }
    var prev = prevRoundRes.assignments || {};
    var cur = curAssignments || {};
    for (var s = 0; s < vessels.length; s++) {
      var v = vessels[s];
      if (!relevant[v.shipId]) continue;
      var wasSailing = prev[v.shipId] !== null && prev[v.shipId] !== undefined;
      var nowSailing = cur[v.shipId] !== null && cur[v.shipId] !== undefined;
      if (!wasSailing && nowSailing) {
        changes.push({ change: 'ship-set-sailing', shipId: v.shipId, fromRoute: null, toRoute: cur[v.shipId] });
      }
    }
    return changes;
  }

  /* ---- 风险盘应用证据（同 campaignId+round+sourceReportId 只记一次） ---- */
  function recordFleetApplication(campaign, changes, sourceReportId) {
    if (!campaign || !campaign.campaignId || !changes || changes.length === 0 || !sourceReportId) return null;
    /* G2 应用门槛：必须先亲历过同一份报告的未检查风险，应用证据才有依据（无对应亲历则不建概念、不记录）。 */
    var prior = readLearning();
    var priorC = (prior && prior.concepts) ? prior.concepts[CONCEPT_ID] : null;
    var priorEncs = (priorC && Array.isArray(priorC.encounters)) ? priorC.encounters : [];
    var encSeen = false;
    for (var j0 = 0; j0 < priorEncs.length; j0++) {
      if (priorEncs[j0] && priorEncs[j0].reportId === sourceReportId) { encSeen = true; break; }
    }
    if (!encSeen) return null;
    var l = prior || { version: 1, concepts: {} };
    var c = ensureConcept(l);
    var round = campaign.currentRound;
    for (var i = 0; i < c.applications.length; i++) {
      var a = c.applications[i];
      if (a && a.campaignId === campaign.campaignId && a.round === round && a.sourceReportId === sourceReportId) return a;
    }
    var entry = { campaignId: campaign.campaignId, round: round, changes: changes, sourceReportId: sourceReportId };
    c.applications.push(entry);
    writeLearning(l);
    reportEvidence({ conceptId: 'sampling_representativeness', state: 'applied', context: 'fleet_plan_submitted',
      sourceRefs: [{ campaignId: campaign.campaignId, round: round, reportId: sourceReportId }],
      actions: changes, resultRefs: [] });
    return entry;
  }

  /* G3 证据透传 LearningAdapter（本地校验+日志边界；调用失败不影响存档） */
  function reportEvidence(ev) {
    var adapter = global.LearningAdapter;
    if (!adapter || typeof adapter.onLearningEvidence !== 'function') return;
    try { adapter.onLearningEvidence(ev); }
    catch (err) { console.error('[SamplingLearning] adapter report failed', err); }
  }

  function getConcept() {
    var l = readLearning();
    if (!l || !l.concepts || !l.concepts[CONCEPT_ID]) return null;
    return l.concepts[CONCEPT_ID];
  }

  global.SamplingLearning = Object.freeze({
    recordInspectionEncounter: recordInspectionEncounter,
    fleetAdjustmentChanges: fleetAdjustmentChanges,
    recordFleetApplication: recordFleetApplication,
    getConcept: getConcept
  });
})(typeof window !== 'undefined' ? window : globalThis);
