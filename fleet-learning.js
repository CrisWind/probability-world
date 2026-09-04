/* 概率世界 · 商会船队风险盘 —— 学习证据层 V0.1
 * 概念：correlated_risk（共同风险：亲历—解释—调整）。
 * 只把跨回合最小证据写入 world.learning；不建“掌握度”、不改成就/奖励，
 * 不改风险模型与结算，不发网络请求，不操作 DOM，不发事件。
 * fleet-ui 只读本模块的纯函数输出；写入入口只有 fleet-runtime。 */
(function attachFleetLearning(global) {
  'use strict';

  var CONCEPT_ID = 'correlated_risk';

  function store() { return global.__gameStore; }

  /* ---- world.learning 最小命名空间 ---- */
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
      c = { conceptId: CONCEPT_ID, encounteredAt: null, encounterRefs: [], focusedOn: [], appliedAt: [], migrations: [] };
      l.concepts[CONCEPT_ID] = c;
    }
    if (!Array.isArray(c.encounterRefs)) c.encounterRefs = [];
    if (!Array.isArray(c.focusedOn)) c.focusedOn = [];
    if (!Array.isArray(c.appliedAt)) c.appliedAt = [];
    if (!Array.isArray(c.migrations)) c.migrations = [];
    return c;
  }

  /* ---- 共同风险事件推导（纯函数；只读单回合结算结果） ---- */
  /* 事件条件：>=2 艘船因同一来源（同一航线上的风暴 / 同一缺陷批次）在本轮同时受损。 */
  function analyzeRound(roundResult) {
    var events = [];
    if (!roundResult || !Array.isArray(roundResult.vesselResults)) return events;
    var results = roundResult.vesselResults;
    var storms = Array.isArray(roundResult.storms) ? roundResult.storms : [];
    var defects = Array.isArray(roundResult.batchDefects) ? roundResult.batchDefects : [];
    function groupWithLoss(match) {
      var vesselIds = [], names = [], totalLoss = 0;
      for (var i = 0; i < results.length; i++) {
        var vr = results[i];
        if (!vr.sailing || !(vr.cargoLoss > 0) || !match(vr)) continue;
        vesselIds.push(vr.shipId);
        names.push(vr.name);
        totalLoss += vr.cargoLoss;
      }
      return { vesselIds: vesselIds, names: names, totalLoss: Math.round(totalLoss * 100) / 100 };
    }
    for (var s = 0; s < storms.length; s++) {
      var storm = storms[s];
      var stormGroup = groupWithLoss(function(vr) { return vr.routeId === storm.routeId; });
      if (stormGroup.vesselIds.length >= 2) {
        events.push({ type: 'storm', sourceId: storm.routeId, vesselIds: stormGroup.vesselIds, names: stormGroup.names, totalLoss: stormGroup.totalLoss });
      }
    }
    for (var d = 0; d < defects.length; d++) {
      var batchId = defects[d];
      var batchGroup = groupWithLoss(function(vr) { return vr.batchId === batchId; });
      if (batchGroup.vesselIds.length >= 2) {
        events.push({ type: 'batch', sourceId: batchId, vesselIds: batchGroup.vesselIds, names: batchGroup.names, totalLoss: batchGroup.totalLoss });
      }
    }
    return events;
  }

  /* 共同风险涉及的组合损失（按船去重；供“组合损失 vs 独立损失”对比） */
  function coLossSummary(roundResult, events) {
    var vesselIds = [], names = [], totalLoss = 0;
    if (roundResult && Array.isArray(roundResult.vesselResults) && events && events.length) {
      var byId = {};
      for (var i = 0; i < roundResult.vesselResults.length; i++) {
        byId[roundResult.vesselResults[i].shipId] = roundResult.vesselResults[i];
      }
      var seen = {};
      for (var e = 0; e < events.length; e++) {
        var ev = events[e];
        for (var v = 0; v < ev.vesselIds.length; v++) {
          var id = ev.vesselIds[v];
          if (seen[id]) continue;
          seen[id] = true;
          var ship = byId[id];
          if (!ship) continue;
          vesselIds.push(id);
          names.push(ship.name);
          totalLoss += ship.cargoLoss || 0;
        }
      }
    }
    return { vesselIds: vesselIds, names: names, totalLoss: Math.round(totalLoss * 100) / 100 };
  }

  /* ---- encountered：结算事实落档后，确有共同风险才记录 ---- */
  function recordEncounter(campaign, roundResult, events) {
    if (!campaign || !campaign.campaignId || !roundResult || !events || events.length === 0) return null;
    var l = readLearning() || { version: 1, concepts: {} };
    var c = ensureConcept(l);
    for (var i = 0; i < c.encounterRefs.length; i++) {
      if (c.encounterRefs[i] && c.encounterRefs[i].campaignId === campaign.campaignId && c.encounterRefs[i].round === roundResult.round) {
        return c.encounterRefs[i];
      }
    }
    var vesselIds = [];
    var commonRiskEvents = [];
    for (var e = 0; e < events.length; e++) {
      commonRiskEvents.push({ type: events[e].type, sourceId: events[e].sourceId, vesselIds: events[e].vesselIds.slice() });
      for (var v = 0; v < events[e].vesselIds.length; v++) {
        if (vesselIds.indexOf(events[e].vesselIds[v]) === -1) vesselIds.push(events[e].vesselIds[v]);
      }
    }
    var ref = { campaignId: campaign.campaignId, round: roundResult.round, commonRiskEvents: commonRiskEvents, vesselIds: vesselIds };
    c.encounterRefs.push(ref);
    if (!c.encounteredAt) c.encounteredAt = new Date().toISOString();
    writeLearning(l);
    adapterReport({ conceptId: 'correlated_risk', state: 'encountered', context: 'fleet_round_settled',
      sourceRefs: [{ campaignId: campaign.campaignId, round: roundResult.round }], actions: [],
      resultRefs: events.map(function (e) { return { type: e.type, sourceId: e.sourceId, vesselCount: (e.vesselIds || []).length }; }) });
    return ref;
  }

  function hasEncounterForCampaign(campaignId) {
    var c = getConcept();
    if (!c) return false;
    for (var i = 0; i < c.encounterRefs.length; i++) {
      if (c.encounterRefs[i] && c.encounterRefs[i].campaignId === campaignId) return true;
    }
    return false;
  }

  function getConcept() {
    var l = readLearning();
    if (!l || !l.concepts || !l.concepts[CONCEPT_ID]) return null;
    return l.concepts[CONCEPT_ID];
  }

  /* ---- focusedOn：提交前的一次性“风险关注”（选项见 fleet-ui；无对错） ---- */
  function recordFocus(campaign, focus) {
    if (!campaign || !campaign.campaignId) return null;
    var l = readLearning() || { version: 1, concepts: {} };
    var c = ensureConcept(l);
    var found = null;
    for (var i = 0; i < c.focusedOn.length; i++) {
      var f = c.focusedOn[i];
      if (f && f.campaignId === campaign.campaignId && f.round === campaign.currentRound) { found = f; break; }
    }
    if (found) { found.focus = focus; }
    else { found = { campaignId: campaign.campaignId, round: campaign.currentRound, focus: focus }; c.focusedOn.push(found); }
    writeLearning(l);
    return found;
  }

  /* ---- applied：玩家在下一回合真实改变方案才算（只看事实差异，不看对错） ---- */
  function isSailing(a) { return a !== null && a !== undefined; }

  function planChanges(prevAssignments, curAssignments, prevReserve, curReserve) {
    var changes = [];
    var prev = prevAssignments || {};
    var cur = curAssignments || {};
    var cfg = global.FLEET_CONFIG || null;
    var vessels = cfg && Array.isArray(cfg.vessels) ? cfg.vessels : [];
    var prevCounts = {}, curCounts = {};
    for (var i = 0; i < vessels.length; i++) {
      var pv = prev[vessels[i].shipId];
      var cv = cur[vessels[i].shipId];
      if (isSailing(pv)) prevCounts[pv] = (prevCounts[pv] || 0) + 1;
      if (isSailing(cv)) curCounts[cv] = (curCounts[cv] || 0) + 1;
    }
    var routeKeys = {};
    for (var r in prevCounts) routeKeys[r] = true;
    for (var r2 in curCounts) routeKeys[r2] = true;
    for (var rk in routeKeys) {
      var fromN = prevCounts[rk] || 0;
      var toN = curCounts[rk] || 0;
      if (toN < fromN) changes.push({ change: 'route-thinned', routeId: rk, from: fromN, to: toN });
    }
    for (var m = 0; m < vessels.length; m++) {
      var shipId = vessels[m].shipId;
      var pv2 = prev[shipId];
      var cv2 = cur[shipId];
      if (isSailing(pv2) && !isSailing(cv2)) changes.push({ change: 'ship-kept-in-port', shipId: shipId, fromRoute: pv2 });
      else if (isSailing(pv2) && isSailing(cv2) && cv2 !== pv2) changes.push({ change: 'route-changed', shipId: shipId, fromRoute: pv2, toRoute: cv2 });
    }
    if (typeof prevReserve === 'number' && typeof curReserve === 'number' && curReserve > prevReserve) {
      changes.push({ change: 'reserve-increased', from: prevReserve, to: curReserve });
    }
    return changes;
  }

  function recordApplied(campaign, fromRound, changes) {
    if (!campaign || !campaign.campaignId || !fromRound || !changes || changes.length === 0) return null;
    var toRound = campaign.currentRound;
    var l = readLearning() || { version: 1, concepts: {} };
    var c = ensureConcept(l);
    for (var i = 0; i < c.appliedAt.length; i++) {
      var a = c.appliedAt[i];
      if (a && a.campaignId === campaign.campaignId && a.fromRound === fromRound && a.toRound === toRound) return a;
    }
    var entry = { campaignId: campaign.campaignId, fromRound: fromRound, toRound: toRound, changes: changes };
    c.appliedAt.push(entry);
    writeLearning(l);
    adapterReport({ conceptId: 'correlated_risk', state: 'applied', context: 'fleet_plan_submitted',
      sourceRefs: [{ campaignId: campaign.campaignId, fromRound: fromRound, toRound: toRound }],
      actions: changes, resultRefs: [] });
    return entry;
  }

  /* G3 证据透传 LearningAdapter（本地校验+日志边界；调用失败不影响存档） */
  function adapterReport(ev) {
    var adapter = global.LearningAdapter;
    if (!adapter || typeof adapter.onLearningEvidence !== 'function') return;
    try { adapter.onLearningEvidence(ev); }
    catch (err) { console.error('[FleetLearning] adapter report failed', err); }
  }

  /* ---- migrations：跨场景"再次使用"（已迁移）。只由真实行为链达成一次，不重复追加 ----
   * underwriting_cafe：风险盘已应用共同风险理解 → 承保咖啡馆展开共同风险观察、
   *   当日委托存在可识别聚集、且本局完成过承保决策后记录。
   * inspection_desk：质检房展开批次关联（同批船队）后追加抽样或选择返修/停港并完成质检后记录。
   * 阶段由行为证据推导：unseen → encountered(encounterRefs) → applied(appliedAt) → migrated(migrations)。 */
  function lastAppliedRef(c) {
    var list = c && Array.isArray(c.appliedAt) ? c.appliedAt : [];
    var last = list[list.length - 1];
    return last ? { campaignId: last.campaignId, fromRound: last.fromRound, toRound: last.toRound } : null;
  }

  function findMigration(c, context, contextKey) {
    var list = Array.isArray(c.migrations) ? c.migrations : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].context === context && list[i].contextKey === contextKey) return list[i];
    }
    return null;
  }

  function recordMigration(context, contextKey, entry) {
    if (!context || !contextKey) return null;
    var l = readLearning() || { version: 1, concepts: {} };
    var c = ensureConcept(l);
    var existing = findMigration(c, context, contextKey);
    if (existing) return existing;
    if (Array.isArray(c.migrations) && c.migrations.length > 0) return null; /* 已迁移达成，不再追加 */
    var rec = Object.assign({ context: context, contextKey: contextKey, recordedAt: new Date().toISOString() }, entry);
    if (!Array.isArray(c.migrations)) c.migrations = [];
    c.migrations.push(rec);
    writeLearning(l);
    adapterReport({ conceptId: 'correlated_risk', state: 'migrated', context: rec.context,
      sourceRefs: [{ contextKey: rec.contextKey, refs: rec.refs || null }],
      actions: [{ decision: rec.decision || null, extendedSamples: rec.extendedSamples === true, managed: rec.managed === true }],
      resultRefs: Array.isArray(rec.aggregations) ? rec.aggregations : [] });
    return rec;
  }

  function recordCafeMigration(input) {
    if (!input || !input.runId) return null;
    return recordMigration('underwriting_cafe', input.runId, {
      runId: input.runId,
      aggregations: Array.isArray(input.aggregations) ? input.aggregations : [],
      decision: input.decision === 'pass' ? 'pass' : 'bid',
      refs: lastAppliedRef(getConcept())
    });
  }

  function recordInspectionMigration(input) {
    if (!input || !input.reportId) return null;
    return recordMigration('inspection_desk', input.reportId, {
      reportId: input.reportId,
      decision: input.decision || null,
      extendedSamples: input.extendedSamples === true,
      managed: input.managed === true
    });
  }

  function evidenceStage() {
    var c = getConcept();
    if (!c) return 'unseen';
    if (Array.isArray(c.migrations) && c.migrations.length > 0) return 'migrated';
    if (Array.isArray(c.appliedAt) && c.appliedAt.length > 0) return 'applied';
    if (Array.isArray(c.encounterRefs) && c.encounterRefs.length > 0) return 'encountered';
    return 'unseen';
  }

  global.FleetLearning = Object.freeze({
    analyzeRound: analyzeRound,
    coLossSummary: coLossSummary,
    recordEncounter: recordEncounter,
    recordFocus: recordFocus,
    recordApplied: recordApplied,
    planChanges: planChanges,
    hasEncounterForCampaign: hasEncounterForCampaign,
    recordCafeMigration: recordCafeMigration,
    recordInspectionMigration: recordInspectionMigration,
    evidenceStage: evidenceStage,
    getConcept: getConcept
  });
})(typeof window !== 'undefined' ? window : globalThis);
