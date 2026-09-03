/* Phase 2 接入验证：任务「不能全拆的船」+ 成就「没有把好运当质量」
 * 直接加载真实模块（GameStore / GameEventBus / QuestData / RewardService / QuestRuntime /
 * AchievementData / AchievementRuntime / ShipyardConfig+Model+Runtime），只桩掉 localStorage 与 window。
 * 验证事件链、状态流转、奖励发放位置、成就字段匹配，以及既有任务/成就未回归。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

/* ---------- 浏览器环境桩 ---------- */
const storage = new Map();
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.console = console;
sandbox.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear()
};
sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
sandbox.Date = Date; sandbox.JSON = JSON; sandbox.Math = Math; sandbox.Object = Object;
sandbox.Array = Array; sandbox.Set = Set; sandbox.Map = Map; sandbox.Number = Number;
sandbox.String = String; sandbox.Error = Error; sandbox.Boolean = Boolean;
sandbox.isNaN = isNaN; sandbox.parseInt = parseInt; sandbox.document = undefined;

const ctx = vm.createContext(sandbox);
const FILES = [
  'game-event-bus.js', 'game-store.js', 'reward-service.js',
  'quest-definitions.js', 'quest-runtime.js',
  'achievement-definitions.js', 'achievement-runtime.js',
  'shipyard-config.js', 'shipyard-model.js', 'shipyard-runtime.js'
];
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}

const bus = sandbox.GameEventBus;
const store = sandbox.__gameStore;
const QR = sandbox.QuestRuntime;
const AR = sandbox.AchievementRuntime;
const SY = sandbox.ShipyardRuntime;

const QID = 'quest.cant_tear_down_all';
const AID = 'achievement.luck_not_quality';
const qStatus = () => (QR.getQuestInstance(QID) || {}).status || '(无实例)';
const aUnlocked = () => {
  const inst = (store.get('achievements', {}).instances || {})[AID];
  return !!(inst && inst.unlockedAt);
};
const coins = () => Number(store.get('player.coins')) || 0;

/* 事件计数器：验证 inspection_completed / quest_completed 只发一次 */
const seen = {};
['scene_entered', 'inspection_started', 'inspection_completed', 'quest_completed', 'achievement_unlocked', 'inspection_sampled']
  .forEach(t => { seen[t] = []; bus.on(t, e => seen[t].push(e)); });

function resetWorld() {
  storage.clear();
  store.reset();
  Object.keys(seen).forEach(k => { seen[k].length = 0; });
}

/* ============================================================ */
console.log('\n[场景 A] 完整正向流程：进厂 → 开始质检 → 0 缺陷暂停出航 → 领取奖励');
resetWorld();
ok('初始无任务实例', QR.getQuestInstance(QID) === null);
ok('初始成就未解锁', aUnlocked() === false);

bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
ok('scene_entered(shipyard) → available', qStatus() === 'available', qStatus());

const started = SY.start();
ok('start() 返回 ok', started.ok === true);
ok('inspection_started 发出 1 次', seen.inspection_started.length === 1, seen.inspection_started.length);
ok('inspection_started → active', qStatus() === 'active', qStatus());

const beforeCoins = coins();
const decided = SY.submitDecision('hold');
ok('submitDecision(hold) 返回 ok', decided.ok === true, decided);
ok('inspection_completed 只发 1 次', seen.inspection_completed.length === 1, seen.inspection_completed.length);

const payload = seen.inspection_completed[0].payload;
ok('payload.defectsFound 是数字 0', payload.defectsFound === 0 && typeof payload.defectsFound === 'number', payload.defectsFound);
ok('payload.decision === "hold"', payload.decision === 'hold', payload.decision);
ok('报告已先落盘（reports 长度 1）', SY.listReports().length === 1, SY.listReports().length);
ok('activeInspection 已清空', SY.getActive() === null);

ok('inspection_completed → ready_to_claim', qStatus() === 'ready_to_claim', qStatus());
ok('奖励未自动发放（coins 只扣 hold 成本 2）', coins() === beforeCoins - 2, { before: beforeCoins, now: coins() });
ok('quest_completed 尚未发出', seen.quest_completed.length === 0, seen.quest_completed.length);
ok('成就已解锁（0 缺陷 + hold）', aUnlocked() === true);
ok('achievement_unlocked 发出 1 次', seen.achievement_unlocked.length === 1, seen.achievement_unlocked.length);

const claim = QR.claimQuest(QID);
ok('claimQuest 成功', claim.success === true, claim);
ok('RewardService 发放 15 潮汐币', coins() === beforeCoins - 2 + 15, { expected: beforeCoins + 13, now: coins() });
ok('领取后 → completed', qStatus() === 'completed', qStatus());
ok('quest_completed 发出 1 次', seen.quest_completed.length === 1, seen.quest_completed.length);
ok('quest_completed 载荷带 questId', seen.quest_completed[0].payload.questId === QID);

/* ============================================================ */
console.log('\n[场景 B] 负向：0 缺陷但直接放行 → 成就不应解锁');
resetWorld();
bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
SY.start();
SY.submitDecision('release');
ok('release 的 defectsFound === 0', seen.inspection_completed[0].payload.defectsFound === 0);
ok('release 的 decision === "release"', seen.inspection_completed[0].payload.decision === 'release');
ok('成就不解锁', aUnlocked() === false);
ok('任务仍到 ready_to_claim（与成就解耦）', qStatus() === 'ready_to_claim', qStatus());

/* ============================================================ */
console.log('\n[场景 C] 负向：发现缺陷后暂停出航 → 成就不应解锁');
resetWorld();
store.set('player.coins', 500);
bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
SY.start();
const insp = SY.getActive();
const batch = sandbox.ShipyardModel.createBatch(insp.seed);
let found = 0;
for (const part of batch) {
  if (found > 0) break;
  const r = SY.sampleSinglePart('random', part.id);
  if (r.ok && r.round.defectsFound.length) found++;
}
ok('已成功抽到至少 1 处缺陷', found > 0, found);
SY.submitDecision('repair_partial');
ok('defectsFound > 0', seen.inspection_completed[0].payload.defectsFound > 0, seen.inspection_completed[0].payload.defectsFound);
ok('decision === "repair_partial"', seen.inspection_completed[0].payload.decision === 'repair_partial');
ok('成就不解锁', aUnlocked() === false);

/* ============================================================ */
console.log('\n[场景 D] 幂等：重复 inspection_completed 不重复解锁/不重复发奖');
resetWorld();
bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
SY.start();
SY.submitDecision('hold');
const firstUnlockAt = (store.get('achievements', {}).instances[AID] || {}).unlockedAt;
AR.handleEvent({ type: 'inspection_completed', payload: { defectsFound: 0, decision: 'hold' }, at: new Date().toISOString() });
ok('重复事件不产生第二次 achievement_unlocked', seen.achievement_unlocked.length === 1, seen.achievement_unlocked.length);
ok('unlockedAt 保持不变', (store.get('achievements', {}).instances[AID] || {}).unlockedAt === firstUnlockAt);
QR.claimQuest(QID);
const afterFirst = coins();
const second = QR.claimQuest(QID);
ok('重复领取被拒绝', second.success === false, second);
ok('coins 未二次增加', coins() === afterFirst, { afterFirst, now: coins() });

/* ============================================================ */
console.log('\n[场景 E] 回归：既有主线任务与既有成就不受影响');
resetWorld();
bus.emit({ type: 'scene_entered', payload: { sceneId: 'castle_cafe' } });
ok('主线任务解锁为 available', qStatusOf('quest.unposted_ship_news') === 'available', qStatusOf('quest.unposted_ship_news'));
bus.emit({ type: 'npc_talked', payload: { npcId: 'cafe_owner' } });
ok('npc_talked 仍激活主线任务', qStatusOf('quest.unposted_ship_news') === 'active', qStatusOf('quest.unposted_ship_news'));
ok('造船厂任务未被 castle_cafe 解锁', QR.getQuestInstance(QID) === null);

bus.emit({ type: 'choice_made', payload: { choiceGroup: 'ship_news_decision', choiceId: 'publish_with_risk' } });
const oldA = (store.get('achievements', {}).instances || {})['achievement.first_clear_quote'];
ok('choice_made 成就仍解锁', !!(oldA && oldA.unlockedAt));
ok('标量严格匹配未被数组逻辑破坏', AR.matchesCondition(
  { type: 'event_match', eventType: 'choice_made', payload: { choiceId: 'publish_with_risk' } },
  { type: 'choice_made', payload: { choiceId: 'publish_with_risk' } }
) === true);
ok('数组候选值不匹配错误标量', AR.matchesCondition(
  { type: 'event_match', eventType: 'inspection_completed', payload: { decision: ['hold'] } },
  { type: 'inspection_completed', payload: { decision: 'release', defectsFound: 0 } }
) === false);

function qStatusOf(id) { return (QR.getQuestInstance(id) || {}).status || '(无实例)'; }

console.log('\n================================');
console.log('PASS ' + pass + ' / FAIL ' + fail);
console.log('================================');
process.exit(fail ? 1 : 0);
