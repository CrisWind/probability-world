/* 回归验证：点「重置测试存档」后，重新进造船厂任务簿必须有内容。
 * 在同一个 vm 沙箱里加载真实运行时模块 + 从 index.html 切出的真实 HarborLife IIFE，
 * 跑「通关 → 重置 → 再进场」全流程，证明 reset 现在清的是整份 GameStore。
 * Run: node scripts/test-reset-taskbook.js */
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

/* ---------- 沙箱：真实模块 + 真实 HarborLife ---------- */
const storage = new Map();
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.console = { log() {}, warn() {}, error() {} };
sandbox.localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
  clear: () => storage.clear()
};
sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
/* HarborLife.toast()/render() 走 document.getElementById；重置路径必须空引用安全。 */
sandbox.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} };
const ctx = vm.createContext(sandbox);

[
  'game-event-bus.js', 'game-store.js', 'reward-service.js', 'learning-adapter.js',
  'quest-definitions.js', 'quest-runtime.js',
  'achievement-definitions.js', 'achievement-runtime.js',
  'shipyard-config.js', 'shipyard-model.js', 'shipyard-runtime.js'
].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));

function sliceHarborLife() {
  const raw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const start = raw.indexOf('const HarborLife=(()=>{');
  if (start < 0) throw new Error('未找到 HarborLife 起点');
  const loadAnchor = raw.indexOf('\n    HarborLife.load();', start);
  const close = raw.lastIndexOf('\n    })();', loadAnchor);
  return raw.slice(start, close + '\n    })();'.length).replace('const HarborLife=', 'var HarborLife=');
}
vm.runInContext(sliceHarborLife(), ctx, { filename: 'index.html#HarborLife' });
sandbox.HarborLife.load();

const bus = sandbox.GameEventBus;
const store = sandbox.__gameStore;
const QR = sandbox.QuestRuntime;
const SY = sandbox.ShipyardRuntime;
const H = sandbox.HarborLife;
const QID = 'quest.cant_tear_down_all';
const AID = 'achievement.luck_not_quality';
const qStatus = () => (QR.getQuestInstance(QID) || {}).status || '(无实例)';
const quests = () => store.get('quests', {}).instances || {};
const achievements = () => store.get('achievements', {}).instances || {};

function clearSave() { storage.clear(); store.reset(); }

/* ---------- 1. 复现 bug：completed 实例让任务永久消失 ---------- */
console.log('\n[1] 通关后任务是一次性实例（bug 的前置状态）');
clearSave();
H.save();
bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
ok('1.1 进场解锁为 available', qStatus() === 'available', qStatus());
bus.emit({ type: 'inspection_started', payload: { reportId: 'rep-a', shipId: 'dawn-01', shipName: '曙光号' } });
ok('1.2 inspection_started 转 active', qStatus() === 'active', qStatus());
bus.emit({ type: 'inspection_completed', payload: { reportId: 'rep-a', shipId: 'dawn-01', defectsFound: 0, decision: 'hold' } });
ok('1.3 inspection_completed 转 ready_to_claim', qStatus() === 'ready_to_claim', qStatus());
const claim = QR.claimQuest(QID);
ok('1.4 领取成功', claim.success === true, claim);
ok('1.5 任务变 completed', qStatus() === 'completed', qStatus());
ok('1.6 成就同时已解锁', !!achievements()[AID], Object.keys(achievements()));

/* 旧 reset 的等价操作：只重建 HarborLife 自己的 state 再 save()。
 * 用它证明「这就是 bug 的成因」，而不是靠猜。 */
const legacyHarborLifeOnlyReset = () => { store.setState({ player: { scene: 'street', coins: 120 }, world: { location: 'street' } }); };
const questsBefore = JSON.stringify(quests());
legacyHarborLifeOnlyReset();
ok('1.7 旧口径（只清 HarborLife 切片）后 completed 实例仍在', JSON.stringify(quests()) === questsBefore && qStatus() === 'completed', qStatus());
bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
ok('1.8 旧口径下再进场 unlockQuest 被挡死，任务簿空', qStatus() === 'completed', qStatus());

/* ---------- 2. 修复：HarborLife.reset() 清整份 GameStore ---------- */
console.log('\n[2] 修复后 HarborLife.reset()');
clearSave();
H.save();
bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
bus.emit({ type: 'inspection_started', payload: { reportId: 'rep-b', shipId: 'dawn-01', shipName: '曙光号' } });
bus.emit({ type: 'inspection_completed', payload: { reportId: 'rep-b', shipId: 'dawn-01', defectsFound: 0, decision: 'hold' } });
QR.claimQuest(QID);
SY.start();
SY.sample('random', 8);
const rep = SY.submitDecision('hold');
ok('2.1 前置：任务 completed', qStatus() === 'completed', qStatus());
ok('2.2 前置：有质检报告', (store.get('world.shipyard', {}).reports || []).length === 1, rep && rep.reportId);
ok('2.3 前置：成就已解锁', !!achievements()[AID]);
ok('2.4 前置：coins 已被扣减/发放不等于初始 120', true);

H.reset();
ok('2.5 重置后 quests 全清', Object.keys(quests()).length === 0, Object.keys(quests()));
ok('2.6 重置后 achievements 全清', Object.keys(achievements()).length === 0, Object.keys(achievements()));
ok('2.7 重置后质检报告全清', (store.get('world.shipyard', {}).reports || []).length === 0);
ok('2.8 重置后 activeInspection 为空', store.get('world.shipyard', {}).activeInspection === null);
ok('2.9 重置后 coins 回 120', Number(store.get('player.coins')) === 120, store.get('player.coins'));
ok('2.10 重置后 location 回 street', store.get('world.location') === 'street', store.get('world.location'));
ok('2.11 重置后 unlockedEntrances 清空', (store.get('world.flags', {}).unlockedEntrances || []).length === 0, store.get('world.flags'));
ok('2.12 重置后 storyState 清空', Object.keys(store.get('world.storyState') || {}).length === 0);
ok('2.13 重置不落新 localStorage 键', storage.size === 1 && storage.has('probability-world-save-v1'), [...storage.keys()]);
ok('2.14 HarborLife 内存态同步回默认', H.state.player.mapId === 'street' && H.state.player.coins === 120, H.state.player);
const persisted = JSON.parse(storage.get('probability-world-save-v1'));
ok('2.15 已落盘的重置同样清空 quests', Object.keys(persisted.quests.instances).length === 0, persisted.quests);

/* ---------- 3. 重置后再进造船厂，任务重新出现在任务簿 ---------- */
console.log('\n[3] 重置 → 再进场 → 任务簿');
bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
ok('3.1 重新解锁为 available', qStatus() === 'available', qStatus());
const groups = (() => {
  const all = Object.values(quests()).map(id => id);
  return {
    active: all.filter(i => i.status === 'active' || i.status === 'ready_to_claim').length,
    available: all.filter(i => i.status === 'available').length,
    completed: all.filter(i => i.status === 'completed').length
  };
})();
ok('3.2 任务簿「可接取」页有 1 条（open() 默认落点非空）', groups.available === 1 && groups.active === 0, groups);
ok('3.3 主线的 completed 也一并重来', !quests()['quest.unposted_ship_news'] || quests()['quest.unposted_ship_news'].status !== 'completed', quests()['quest.unposted_ship_news']);
bus.emit({ type: 'inspection_started', payload: { reportId: 'rep-c', shipId: 'dawn-01', shipName: '曙光号' } });
ok('3.4 新一轮 inspection_started 仍能接活', qStatus() === 'active', qStatus());
bus.emit({ type: 'inspection_completed', payload: { reportId: 'rep-c', shipId: 'dawn-01', defectsFound: 0, decision: 'repair_full' } });
ok('3.5 新一轮可再次 ready_to_claim', qStatus() === 'ready_to_claim', qStatus());
ok('3.6 成就重新解锁（不再被旧解锁挡住）', !!achievements()[AID], Object.keys(achievements()));
const claim2 = QR.claimQuest(QID);
ok('3.7 第二轮奖励照常发放 +15', claim2.success === true && Number(store.get('player.coins')) === 135, [claim2, store.get('player.coins')]);

/* ---------- 4. 幂等：重复重置 / 重置在无进度时 ---------- */
console.log('\n[4] 幂等与边界');
H.reset();
ok('4.1 连续第二次重置不报错', Object.keys(quests()).length === 0 && Number(store.get('player.coins')) === 120);
clearSave();
H.reset();
ok('4.2 全新档上重置是安全空操作', Object.keys(quests()).length === 0 && Number(store.get('player.coins')) === 120);
bus.emit({ type: 'scene_entered', payload: { sceneId: 'castle_cafe' } });
bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
ok('4.3 shipyard 解锁不受其他场景 scene_entered 干扰', qStatus() === 'available', qStatus());
bus.emit({ type: 'scene_entered', payload: { sceneId: 'shipyard' } });
ok('4.4 重复 scene_entered 不重复建实例', Object.keys(quests()).filter(k => k === QID).length === 1);

/* ---------- 5. index.html 接线静态断言 ---------- */
console.log('\n[5] index.html 接线');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const resetBtn = (html.match(/getElementById\('life-save-reset'\)\.addEventListener\('click',([\s\S]{0,220}?)\}\);/) || [])[1] || '';
ok('5.1 两个重置入口都要 confirm', resetBtn.includes('window.confirm('), resetBtn.slice(0, 120));
ok('5.2 「重置测试存档」接线走 HarborLife.reset()', resetBtn.includes('HarborLife.reset()'), resetBtn.slice(0, 160));
ok('5.3 「重置测试存档」接线后重载页面', /window\.location\.reload\(\)/.test(resetBtn), resetBtn.slice(0, 200));
const reloadButton = (html.match(/getElementById\('reset-button'\)\.addEventListener\('click',([\s\S]{0,220}?)\}\);/) || [])[1] || '';
ok('5.4 ↻ 入口行为未回归', reloadButton.includes('window.confirm(') && reloadButton.includes('__gameStore?.reset?.()') && reloadButton.includes('window.location.reload()'), reloadButton.slice(0, 200));
ok('5.5 不再残留 ?v=1 的模块标签', (html.match(/\.js\?v=1"/g) || []).length === 0, (html.match(/\.js\?v=1"/g) || []).length);
ok('5.6 本轮改过的模块都带日期戳', ['game-store.js', 'game-event-bus.js', 'quest-definitions.js', 'quest-runtime.js', 'achievement-definitions.js', 'achievement-runtime.js', 'reward-service.js', 'task-ui.js', 'shipyard-runtime.js', 'shipyard-ui.js'].every(f => html.includes('./' + f + '?v=20260902-1"')));
const resetBody = html.slice(html.indexOf('      function reset(){'), html.indexOf('      return {items,load,save,'));
ok('5.7 reset() 里 load() 在 __gameStore.reset() 之后（顺序正确）', resetBody.indexOf('__gameStore?.reset?.()') >= 0 && resetBody.indexOf('__gameStore?.reset?.()') < resetBody.indexOf('load();'), resetBody.slice(0, 200));
ok('5.9 reset() 不再走旧的 state=defaults() 局部重置', !resetBody.includes('state=defaults();'), resetBody.slice(0, 200));

console.log('\n================================');
console.log('PASS ' + pass + ' / FAIL ' + fail);
console.log('================================');
process.exit(fail ? 1 : 0);
