/* HarborLife 剧情进度（world.storyState）持久化往返测试。
 * 把 index.html 内联脚本里的 HarborLife IIFE 切片出来，在 Node 桩环境跑真实代码。 */
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
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  global.window = global;
  global.document = { getElementById: () => null }; // 仅覆盖 toast/render 的空引用
  return store;
}

function bootStore() {
  eval(fs.readFileSync(path.join(ROOT, 'game-store.js'), 'utf8'));
  return global.window.__gameStore;
}

/* 用字符串锚点切片 HarborLife IIFE：从 const HarborLife= 到紧随其后的 \n    })();（即 HarborLife.load(); 之前）。 */
function sliceHarborLife() {
  const raw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const html = raw.replace(/\r\n/g, '\n'); // 归一化行尾，锚点才稳
  const startIdx = html.indexOf('const HarborLife=(()=>{');
  if (startIdx < 0) throw new Error('未找到 HarborLife 起点');
  const loadAnchor = html.indexOf('\n    HarborLife.load();', startIdx);
  if (loadAnchor < 0) throw new Error('未找到 HarborLife.load() 锚点: ' + html.slice(startIdx, startIdx + 400).slice(-200));
  const closeIdx = html.lastIndexOf('\n    })();', loadAnchor);
  if (closeIdx < 0) throw new Error('未找到 HarborLife IIFE 闭合: ' + html.slice(loadAnchor - 400, loadAnchor));
  return html.slice(startIdx, closeIdx + '\n    })();'.length)
    .replace('const HarborLife=', 'globalThis.HarborLife=');
}

function bootHarborLife() {
  eval(sliceHarborLife());
  globalThis.HarborLife.load();
  return globalThis.HarborLife;
}

/* ---------- 场景 1：对话进度写入 → 落盘 → 重载恢复（瞬态被剥离） ---------- */
{
  freshEnv();
  const gs = bootStore();
  const H = bootHarborLife();

  // 模拟三个模块的真实状态（含瞬态标志）
  H.state.captainDialogueLinear = { index: 2, mode: 'line', choice: 0, cards: { ship: true }, done: false, relation: 0, isDialoguePaused: true, isHumanCardOpen: true, currentHumanCardId: 'ship' };
  H.state.eveLoreConversation = { index: 1, done: false, seen: { 0: true, 1: false }, isDialoguePaused: true, isHumanCardOpen: true };
  H.state.unpostedShipNewsV3 = { started: true, done: false, seen: { entry: true }, trust: 1, publicity: 'pending', node: 0, inConversation: true };
  H.state.harborLore = { insurance: true, monsoon: true };
  H.state.captainEvent = { phase: 'voyage', asked: ['cargo'], purchased: [], riskEstimate: 20, premium: 80, outcome: { label: '平安返航' }, completed: false, relation: 1 };
  H.save();

  const stored = gs.get('world.storyState') || {};
  check('1.1 storyState 已写入 store', !!stored.captainDialogueLinear, JSON.stringify(Object.keys(stored)));
  check('1.2 进度字段保留 (index=2)', stored.captainDialogueLinear.index === 2, JSON.stringify(stored.captainDialogueLinear));
  check('1.3 瞬态 isDialoguePaused 被剥离', stored.captainDialogueLinear.isDialoguePaused === undefined, JSON.stringify(stored.captainDialogueLinear));
  check('1.4 瞬态 currentHumanCardId 被剥离', stored.captainDialogueLinear.currentHumanCardId === undefined);
  check('1.5 eve 瞬态被剥离、seen 保留', stored.eveLoreConversation.isHumanCardOpen === undefined && stored.eveLoreConversation.seen['0'] === true);
  check('1.6 unposted started/trust 保留', stored.unpostedShipNewsV3.started === true && stored.unpostedShipNewsV3.trust === 1);
  check('1.7 harborLore 保留', stored.harborLore && stored.harborLore.insurance === true);
  check('1.8 captainEvent outcome 保留', stored.captainEvent.outcome && stored.captainEvent.outcome.label === '平安返航');

  // 模拟刷新：同一 store 重新装载 HarborLife
  const H2 = bootHarborLife();
  check('1.9 重载后 captainDialogueLinear.index=2', H2.state.captainDialogueLinear && H2.state.captainDialogueLinear.index === 2, JSON.stringify(H2.state.captainDialogueLinear));
  check('1.10 重载后无瞬态锁死标志', H2.state.captainDialogueLinear.isDialoguePaused !== true && H2.state.eveLoreConversation.isHumanCardOpen !== true);
  check('1.11 重载后 eve seen 保留', H2.state.eveLoreConversation.seen['1'] === false && H2.state.eveLoreConversation.index === 1);
  check('1.12 重载后 unposted 进度保留', H2.state.unpostedShipNewsV3.started === true && H2.state.unpostedShipNewsV3.done === false);
  check('1.13 重载后 harborLore/captainEvent 保留', H2.state.harborLore.insurance === true && H2.state.captainEvent.phase === 'voyage');

  // 模块再写一次（增量保存）——不应破坏其他键
  H2.state.captainDialogueLinear.index = 5;
  H2.save();
  const stored2 = gs.get('world.storyState') || {};
  check('1.14 增量保存不丢其他键', stored2.eveLoreConversation.index === 1 && stored2.harborLore.insurance === true);
}

/* ---------- 场景 2：重置后剧情进度不留残留 ---------- */
{
  freshEnv();
  const gs = bootStore();
  const H = bootHarborLife();
  H.state.captainDialogueLinear = { index: 3, cards: {}, done: true };
  H.save();
  check('2.1 重置前 storyState 有数据', !!gs.get('world.storyState.captainDialogueLinear'));

  H.reset(); // 调试重置（含 storyState 清空 + toast 空引用安全）
  const cleared = gs.get('world.storyState') || {};
  check('2.2 重置后 storyState 为空对象', Object.keys(cleared).length === 0, JSON.stringify(cleared));

  const H2 = bootHarborLife();
  check('2.3 重载后无残留剧情', H2.state.captainDialogueLinear === undefined && H2.state.eveLoreConversation === undefined, JSON.stringify(Object.keys(H2.state).filter(k => k.startsWith('captain') || k.startsWith('eve'))));
}

console.log(failures.length ? `\n${failures.length} 项失败: ${failures.join(' | ')}` : '\n全部通过 ✅');
process.exit(failures.length ? 1 : 0);
