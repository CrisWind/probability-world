/* Smoke tests for Step-3 cross-gameplay transfer (Node only, no DOM).
 * Covers: evidence stage derivation (unseen→encountered→applied→migrated),
 * cafe/inspection migration record semantics (dedupe by key, once-only, shape/refs),
 * shipyard runtime batch-aid flow (markBatchAidViewed → extended/managed → migration),
 * refresh persistence, merged concepts preserved, no forbidden fields. */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const failures = [];
function check(name, cond, detail) {
  const ok = !!cond;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ' | ' + (detail || '')}`);
  if (!ok) failures.push(name);
}

function freshEnv() {
  const store = new Map();
  global.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  global.window = global;
  return store;
}

function boot(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  (0, eval)(src);
}

function bootWorld(coins = 120) {
  const ls = freshEnv();
  const events = [];
  boot('game-store.js');
  global.__gameStore.set('player.coins', coins);
  boot('game-event-bus.js');
  boot('shipyard-config.js');
  boot('shipyard-model.js');
  boot('fleet-config.js');
  boot('fleet-learning.js');
  boot('sampling-learning.js');
  boot('shipyard-runtime.js');
  ['inspection_started', 'inspection_sampled', 'inspection_decision_submitted', 'inspection_completed']
    .forEach(t => global.GameEventBus.on(t, e => events.push(e)));
  return { ls, events, gs: global.__gameStore, R: global.ShipyardRuntime, FL: global.FleetLearning, SL: global.SamplingLearning };
}

function learningState() {
  const raw = JSON.parse(global.localStorage.getItem('probability-world-save-v1'));
  return raw.world.learning;
}

/* ============ A. 统一证据语义 + 迁移记录（fleet-learning 模块） ============ */
{
  const { FL, gs } = bootWorld();
  check('A1 无任何经历时 evidenceStage=unseen', FL.evidenceStage() === 'unseen');

  const campA = { campaignId: 'camp-a', currentRound: 2 };
  const rr1 = { round: 2, vesselResults: [] };
  const events = [{ type: 'storm', sourceId: 'route.north', vesselIds: ['vessel.dawn', 'vessel.gull'] }];
  const ref = FL.recordEncounter(campA, rr1, events);
  check('A2 亲历记录：2 船同受风暴影响 → encountered',
    !!ref && ref.campaignId === 'camp-a' && ref.round === 2 && ref.vesselIds.length === 2 && FL.evidenceStage() === 'encountered');
  const ref2 = FL.recordEncounter(campA, rr1, events);
  const cA = FL.getConcept();
  check('A3 亲历按 campaignId+round 去重', ref2 === ref && cA.encounterRefs.length === 1);

  const campB = { campaignId: 'camp-a', currentRound: 3 };
  const changes = [{ change: 'ship-kept-in-port', shipId: 'vessel.dawn', fromRoute: 'route.north' }];
  const app = FL.recordApplied(campB, 2, changes);
  check('A4 已应用：下一回合留港调整 → applied',
    !!app && app.fromRound === 2 && app.toRound === 3 && FL.evidenceStage() === 'applied');
  check('A5 空调整不记录', FL.recordApplied(campB, 2, []) === null && FL.recordApplied(campB, 2, null) === null);
  const app2 = FL.recordApplied(campB, 2, changes);
  check('A6 应用按 campaign+fromRound+toRound 去重', app2 === app && cA.appliedAt.length === 1);

  const mig = FL.recordCafeMigration({ runId: 'run-1', aggregations: [{ kind: 'value-concentration', ship: '黑珍珠号', share: 0.62 }], decision: 'pass' });
  check('A7 承保咖啡馆迁移：已应用后使用观察工具并完成决策 → migrated',
    !!mig && mig.context === 'underwriting_cafe' && mig.contextKey === 'run-1' && mig.aggregations.length === 1
    && mig.aggregations[0].kind === 'value-concentration' && mig.decision === 'pass'
    && !!mig.recordedAt && FL.evidenceStage() === 'migrated');
  check('A8 迁移 refs 引用最近一次已应用经历',
    mig.refs && mig.refs.campaignId === 'camp-a' && mig.refs.fromRound === 2 && mig.refs.toRound === 3);
  const mig2 = FL.recordCafeMigration({ runId: 'run-1', aggregations: [{ kind: 'route-shared' }], decision: 'bid' });
  check('A9 同一 runId 重复记录返回原记录且不追加', mig2 === mig && FL.getConcept().migrations.length === 1);
  const mig3 = FL.recordCafeMigration({ runId: 'run-2', aggregations: [{ kind: 'route-shared' }], decision: 'bid' });
  check('A10 迁移达成一次后新 runId 不再追加（once-only）', mig3 === null && FL.getConcept().migrations.length === 1);
  const l1 = gs.get('world.learning');
  check('A11 概念树无 forbidden 字段',
    ['mastered', 'correct', 'wrong', 'score', 'level'].every(k => JSON.stringify(l1.concepts.correlated_risk).indexOf(k) === -1));
}

/* ============ B. 质检房批次观察闭环（shipyard runtime 真实流程） ============ */
{
  const w = bootWorld(120);
  const { R, FL } = w;

  /* B1 基线：未展开批次观察 → 无迁移记录 */
  const s0 = R.start();
  R.sample('random', 'small');
  const d0 = R.submitDecision('release');
  check('B1 未看批次观察即完成质检 → 无 correlated 迁移', d0.ok === true
    && (!FL.getConcept() || !FL.getConcept().migrations || FL.getConcept().migrations.length === 0));

  /* B2 展开批次观察 → 追加抽样 + 局部返修 → 迁移记录 */
  const st = R.start();
  R.sample('random', 'small');
  const aid1 = R.markBatchAidViewed();
  const insp1 = R.getActive();
  check('B2 markBatchAidViewed 落盘事实（时间戳+轮次）', aid1.ok === true
    && !!insp1.batchAidViewedAt && insp1.batchAidViewedRound === 1);
  const aid2 = R.markBatchAidViewed();
  const insp2 = R.getActive();
  check('B3 重复展开不覆盖时间戳', aid2.ok === true && insp2.batchAidViewedAt === insp1.batchAidViewedAt);
  R.sample('random', 'small');
  const d2 = R.submitDecision('repair_partial');
  const migIn = FL.getConcept().migrations;
  check('B4 看后追加抽样+返修 → inspection_desk 迁移记录', d2.ok === true
    && migIn.length === 1 && migIn[0].context === 'inspection_desk' && migIn[0].contextKey === d2.report.reportId
    && migIn[0].decision === 'repair_partial' && migIn[0].extendedSamples === true && migIn[0].managed === true
    && !!migIn[0].recordedAt && FL.evidenceStage() === 'migrated');

  /* B3' 展开批次观察但随后未追加抽样也未返修/停港 → 不构成迁移 */
  const st3 = R.start();
  R.sample('random', 'small');
  R.markBatchAidViewed();
  const d3 = R.submitDecision('release');
  check('B5 仅查看未行动 → 不追加迁移记录', d3.ok === true && FL.getConcept().migrations.length === 1);

  /* B4 迁移后的新质检：就算再看+行动也不追加（once-only 由模块保证） */
  const st4 = R.start();
  R.sample('random', 'small');
  R.markBatchAidViewed();
  R.sample('random', 'small');
  const d4 = R.submitDecision('repair_full');
  check('B6 已迁移后再触发 → 仍只有一条迁移', d4.ok === true && FL.getConcept().migrations.length === 1);

  /* B5 落盘可恢复：localStorage 里 learning 含迁移，且两个概念合并保留 */
  const lsLearn = learningState();
  const corr = lsLearn.concepts.correlated_risk;
  check('B7 迁移写入 localStorage 且结构可恢复', corr && corr.migrations.length === 1
    && corr.migrations[0].contextKey === d2.report.reportId);
  check('B8 sampling_representativeness 与 correlated_risk 共存（merge 保留）',
    !!lsLearn.concepts.sampling_representativeness && corr.appliedAt.length === 0 && corr.encounterRefs.length === 0);
  check('B9 全局无 forbidden 字段（mastered/correct/wrong/score/level）',
    ['mastered', 'correct', 'wrong', 'score', 'level'].every(k => JSON.stringify(lsLearn).indexOf(k) === -1));

  /* B6 事件白名单不受影响：仍只有既有 4 个质检事件 */
  check('B10 质检事件流未新增类型', w.events.every(e => ['inspection_started', 'inspection_sampled', 'inspection_decision_submitted', 'inspection_completed'].indexOf(e.type) !== -1)
    && w.events.filter(e => e.type === 'inspection_completed').length === 4);
}

console.log('\n' + (failures.length === 0 ? 'ALL PASS' : failures.length + ' FAILURES'));
process.exit(failures.length > 0 ? 1 : 0);
