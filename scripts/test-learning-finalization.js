/* Final-step learning-layer smoke tests (Node only, no DOM).
 * 1) LearningAdapter 接线：五个真实记录点每次新证据恰好透传一次；去重不重复调用；
 *    无效直调被拒；focus 不产生证据；adapter 无任何网络痕迹。
 * 2) 职责分离：学习流程不触碰任务/成就/奖励/统计；world.learning 不含任务/成就/奖励
 *    与禁止字段；学习模块不发事件、不直接碰 localStorage。 */
'use strict';
const path = require('path');
const fs = require('fs');
const DIR = path.join(__dirname, '..');
function load(rel) { require(path.join(DIR, rel)); }

global.window = globalThis;
const state = {
  player: { coins: 120 },
  world: { location: 'street' },
  quests: { instances: {}, trackedQuestId: null },
  achievements: { version: 1, instances: {} },
  stats: { version: 1, counters: {}, flags: {}, sets: {} }
};
const parts = p => String(p).split('.');
function get(p) { let v = state; for (const k of parts(p)) { if (v == null) return undefined; v = v[k]; } return v; }
function set(p, value) {
  const ps = parts(p);
  let o = state;
  ps.slice(0, -1).forEach(k => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  o[ps[ps.length - 1]] = value;
  return state;
}
global.__gameStore = { get, set, save() {}, scheduleSave() {} };

load('shipyard-config.js');
load('fleet-config.js');
load('fleet-learning.js');
load('sampling-learning.js');
load('learning-adapter.js');

const CFG = global.FLEET_CONFIG;
const SH = global.SHIPYARD_CONFIG;
const FL = global.FleetLearning;
const SL = global.SamplingLearning;
const AD = global.LearningAdapter;
const DAWN = 'vessel.dawn';
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } }

function report(id, at, decision, repairLevel, sampledN, foundN, allN, remainingN) {
  const sampledParts = [];
  for (let i = 1; i <= sampledN; i++) sampledParts.push('hull-' + i);
  const defectsFound = [];
  for (let i = 1; i <= foundN; i++) defectsFound.push('hull-' + i);
  const allDefectIds = [];
  for (let i = 1; i <= allN; i++) allDefectIds.push('hull-' + i);
  const remainingDefects = [];
  for (let i = 1; i <= remainingN; i++) remainingDefects.push('hull-' + i);
  return {
    reportId: id, shipId: 'dawn-01', shipName: '曙光号', decision, repairLevel,
    sampledParts, defectsFound, completedAt: at,
    actualOutcome: {
      sailed: decision !== 'hold', accident: foundN < allN && remainingN > 0,
      allDefectIds, remainingDefects,
      missedDefects: remainingN > 0 ? allDefectIds.slice(0, remainingN) : []
    }
  };
}

/* ── 证据透传捕获（只收 [LearningAdapter] learning evidence 的 payload 对象） ── */
const lines = [];
const origInfo = console.info;
console.info = function (...a) {
  if (String(a[0] || '') === '[LearningAdapter] learning evidence') lines.push(a[1]);
  else if (String(a[0] || '') === '[LearningAdapter] quest completed') lines.push({ questCompleted: a[1] });
};
function delta() { return lines.length; }
function last() { return lines[lines.length - 1]; }

/* 1. LearningAdapter：结构与直调语义 */
{
  ok('adapter frozen with onLearningEvidence', Object.isFrozen(AD) && typeof AD.onLearningEvidence === 'function' && typeof AD.onQuestCompleted === 'function');
  ok('null evidence rejected', AD.onLearningEvidence(null).success === false && AD.onLearningEvidence(null).reason === 'invalid_evidence');
  ok('partial evidence rejected', AD.onLearningEvidence({ conceptId: 'x' }).success === false && AD.onLearningEvidence({ conceptId: 'x', state: 's' }).success === false);
  const d0 = delta();
  const direct = AD.onLearningEvidence({ conceptId: 'correlated_risk', state: 'encountered', context: 'cafe_decision', sourceRefs: [], actions: [], resultRefs: [] });
  ok('valid direct evidence accepted + logged once', direct.success === true && direct.deferred === true && delta() === d0 + 1 && last().conceptId === 'correlated_risk');
  ok('extra keys preserved on boundary', Array.isArray(last().sourceRefs) && Array.isArray(last().actions) && Array.isArray(last().resultRefs) && !!last().receivedAt);
}

/* 2. 五个真实记录点：每份新证据恰好透传一次，去重不再透传 */
{
  /* 2a. correlated_risk 亲历（风险盘结算共同风险） */
  const d0 = delta();
  const e1 = FL.recordEncounter({ campaignId: 'camp-a' }, { round: 2 }, [{ type: 'storm', sourceId: 'route.north', vesselIds: ['v1', 'v2'] }]);
  ok('2a fleet encounter evidence passed once', !!e1 && delta() === d0 + 1 && last().conceptId === 'correlated_risk' && last().state === 'encountered' && last().context === 'fleet_round_settled');
  ok('2a payload carries campaign ref + storm result', last().sourceRefs[0].campaignId === 'camp-a' && last().sourceRefs[0].round === 2 && last().resultRefs[0].type === 'storm' && last().resultRefs[0].vesselCount === 2);
  FL.recordEncounter({ campaignId: 'camp-a' }, { round: 2 }, [{ type: 'storm', sourceId: 'route.north', vesselIds: ['v1', 'v2'] }]);
  ok('2a dedupe stays silent', delta() === d0 + 1);

  /* 2b. correlated_risk 应用（下一回合方案调整） */
  const d1 = delta();
  const e2 = FL.recordApplied({ campaignId: 'camp-a', currentRound: 3 }, 2, [{ change: 'reserve-increased', from: 0, to: 20 }]);
  ok('2b fleet application evidence passed once', !!e2 && delta() === d1 + 1 && last().state === 'applied' && last().context === 'fleet_plan_submitted');
  ok('2b payload carries from/to round + changes', last().sourceRefs[0].fromRound === 2 && last().sourceRefs[0].toRound === 3 && last().actions[0].change === 'reserve-increased');
  FL.recordApplied({ campaignId: 'camp-a', currentRound: 3 }, 2, [{ change: 'reserve-increased', from: 0, to: 20 }]);
  ok('2b dedupe stays silent', delta() === d1 + 1);

  /* 2c. correlated_risk 迁移（承保咖啡馆复用） */
  const d2 = delta();
  const e3 = FL.recordCafeMigration({ runId: 'cafe-run-1', aggregations: [{ type: 'route-shared', route: 'route.north', count: 3 }], decision: 'pass' });
  ok('2c cafe migration evidence passed once', !!e3 && delta() === d2 + 1 && last().state === 'migrated' && last().context === 'underwriting_cafe');
  ok('2c payload carries run ref + decision + aggregations', last().sourceRefs[0].contextKey === 'cafe-run-1' && last().actions[0].decision === 'pass' && last().resultRefs[0].count === 3);
  FL.recordCafeMigration({ runId: 'cafe-run-1', aggregations: [], decision: 'pass' });
  const extra = FL.recordCafeMigration({ runId: 'cafe-run-2', aggregations: [], decision: 'bid' });
  ok('2c once-only migration: no more evidence, later run refused', delta() === d2 + 1 && extra === null);

  /* 2d. sampling_representativeness 亲历（质检未检查风险暴露） */
  const d3 = delta();
  const cleanRep = report('r-adp-clean', '2026-09-03T09:00:00Z', 'repair_full', 'full', 8, 5, 5, 0);
  ok('2d clean QA stays silent (G1)', SL.recordInspectionEncounter(cleanRep) === null && delta() === d3);
  const encRep = report('r-adp-enc', '2026-09-03T09:00:00Z', 'repair_partial', 'partial', 6, 3, 5, 2);
  const e4 = SL.recordInspectionEncounter(encRep);
  ok('2d sampling encounter evidence passed once', !!e4 && delta() === d3 + 1 && last().conceptId === 'sampling_representativeness' && last().state === 'encountered' && last().context === 'inspection_completed');
  ok('2d payload carries report ref + sample-vs-uninspected gap', last().sourceRefs[0].reportId === 'r-adp-enc' && last().resultRefs[0].missedDefects === 2 && last().resultRefs[0].uninspectedParts > 0);
  SL.recordInspectionEncounter(encRep);
  ok('2d dedupe stays silent', delta() === d3 + 1);

  /* 2e. sampling_representativeness 应用（风险盘使用该质检报告） */
  const d4 = delta();
  const e5 = SL.recordFleetApplication({ campaignId: 'camp-b', currentRound: 5 }, [{ change: 'ship-set-sailing', shipId: DAWN, fromRoute: null, toRoute: 'route.north' }], 'r-adp-enc');
  ok('2e sampling application evidence passed once', !!e5 && delta() === d4 + 1 && last().state === 'applied' && last().context === 'fleet_plan_submitted');
  ok('2e payload ties report to campaign round', last().sourceRefs[0].reportId === 'r-adp-enc' && last().sourceRefs[0].campaignId === 'camp-b' && last().sourceRefs[0].round === 5);
  SL.recordFleetApplication({ campaignId: 'camp-b', currentRound: 5 }, [{ change: 'ship-set-sailing', shipId: DAWN, fromRoute: null, toRoute: 'route.north' }], 'r-adp-enc');
  ok('2e dedupe stays silent', delta() === d4 + 1);
  ok('2e application w/o prior encounter stays silent (G2)', SL.recordFleetApplication({ campaignId: 'camp-c', currentRound: 1 }, [{ change: 'reserve-increased', from: 0, to: 10 }], 'r-adp-clean') === null && delta() === d4 + 1);

  /* 2f. 风险关注（focus）只存档不透传——adapter 只记录五类真实证据 */
  const d5 = delta();
  const f = FL.recordFocus({ campaignId: 'camp-a', currentRound: 1 }, 'option_a');
  ok('2f focus archived but no adapter evidence', !!f && delta() === d5);
}

/* 3. 职责分离与一致性：学习流程不改任务/成就/奖励/统计，world.learning 只含学习字段 */
{
  const q = get('quests');
  const a = get('achievements');
  const s = get('stats');
  const st = get('player');
  const l = get('world.learning');
  ok('3a quests untouched (no instances, no tracking)', !!q && Object.keys(q.instances).length === 0 && q.trackedQuestId === null);
  ok('3b achievements untouched (no instances unlocked)', !!a && Object.keys(a.instances).length === 0);
  ok('3c stats untouched (no counters/flags/sets)', !!s && Object.keys(s.counters).length === 0 && Object.keys(s.flags).length === 0 && Object.keys(s.sets).length === 0);
  ok('3d player untouched', !!st && st.coins === 120);
  ok('3e single merged learning namespace, version 1', !!l && l.version === 1 && !!l.concepts.correlated_risk && !!l.concepts.sampling_representativeness);
  ok('3f correlated stage = migrated, sampling stops honestly at applied', FL.evidenceStage() === 'migrated' && l.concepts.sampling_representativeness.applications.length === 1);
  const json = JSON.stringify(l);
  const forbidden = ['mastered', 'correct', 'wrong', 'score', 'learningLevel', 'examResult', 'level'];
  ok('3g no forbidden mastery fields in learning ns', forbidden.every(k => json.indexOf(k) === -1));
  const foreign = ['quest', 'achievement', 'reward', 'unlock'];
  ok('3h no quest/achievement/reward/unlock keys in learning ns', foreign.every(k => json.indexOf(k) === -1));
  ok('3i learning ns stores summaries/refs only (no rounds/reports arrays)', json.indexOf('rounds') === -1 && json.indexOf('"reports"') === -1);

  const files = ['fleet-learning.js', 'sampling-learning.js', 'learning-adapter.js'].map(f => fs.readFileSync(path.join(DIR, f), 'utf8'));
  ok('3j learning modules never touch localStorage directly', files.every(src => src.indexOf('localStorage') === -1));
  ok('3k learning modules never emit bus events', files.every(src => src.indexOf('GameEventBus') === -1 && src.indexOf('.emit(') === -1));
  ok('3l adapter/learning modules have zero network surface', files.every(src => ['fetch', 'XMLHttpRequest', 'WebSocket', 'http://', 'https://'].every(tok => src.indexOf(tok) === -1)));
}

console.info = origInfo;
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
