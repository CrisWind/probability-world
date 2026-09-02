/* 风闻局状态机收敛回归测试。
 * 从 index.html 切片风闻局真实代码（含 RUMOR_CONFIG），Node 桩环境走查
 * 教程局与普通局的完整状态机，验证收敛后行为与收敛前一致。
 * 注意：用间接 eval 在全局作用域装载一次（非 strict，声明常驻），每场景只换 store/文档桩。 */
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
  const els = {};
  global.document = {
    getElementById: id => els[id] || (els[id] = { innerHTML: '', textContent: '', hidden: false,
      classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, dataset: {}, style: {} }),
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild() {} }, head: { appendChild() {} },
  };
  return store;
}

function bootStore() {
  eval(fs.readFileSync(path.join(ROOT, 'game-store.js'), 'utf8')); // 直接 eval：副作用挂 window.__gameStore
  return global.window.__gameStore;
}

function sliceRumor() {
  const raw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const rc = lines.findIndex(l => l.includes('const RUMOR_CONFIG='));
  const rumorStart = lines.findIndex(l => l.includes('const rumorSeedNumber='));
  const comm = lines.findIndex(l => l.includes('HarborLife：可迁移的生活模拟地图框架层'));
  if (rc < 0 || rumorStart < 0 || comm < 0 || rumorStart >= comm) throw new Error('切片锚点异常');
  return [lines[rc], ...lines.slice(rumorStart, comm - 1)].join('\n'); // RUMOR_CONFIG 单行 + 风闻局段
}

let rumorProto = null;
function bootRumorOnce() {
  if (rumorProto) return;
  const src = sliceRumor();
  const wrapped = 'const PixelHarborScene = class PixelHarborScene {};\n' + src +
    '\nglobalThis.__RumorProto = PixelHarborScene.prototype;';
  (0, eval)(wrapped); // 间接 eval：全局作用域、非 strict，声明常驻
  rumorProto = globalThis.__RumorProto;
}

function freshScene() {
  bootRumorOnce();
  const s = Object.create(rumorProto);
  s.rumorProfile = null; s.rumor = null;
  s.setTopbar = () => {};
  return s;
}

/* ---------- 场景 A：教程局完整走查（games=0 → 固定剧本） ---------- */
{
  freshEnv(); bootStore();
  const s = freshScene();
  s.startRumorRun(); // profile.games===0 → tutorial
  const r = s.rumor;
  check('A1 教程局 phase=ships', r.phase === 'ships', r.phase);
  check('A2 教程局 tutorial=true', r.tutorial === true);
  check('A3 教程局三艘固定船', r.ships.length === 3 && r.ships[1].name === '灰隼号', JSON.stringify(r.ships.map(x => x.name)));
  check('A4 教程局 dangerIndexes=[1]（灰隼号危险）', JSON.stringify(r.dangerIndexes) === '[1]', JSON.stringify(r.dangerIndexes));
  check('A5 教程局四条消息', r.messages.length === 4 && r.messages[0].origin === 'dockhand', 'len=' + r.messages.length);

  s.rumorAction('advance');            // ships → listen1 → round1
  check('A6 round1', s.rumor.phase === 'round1', s.rumor.phase);
  s.rumorAction('advance');            // round1 → investigate1
  check('A7 investigate1', s.rumor.phase === 'investigate1', s.rumor.phase);
  s.rumorAction('skipInvestigation');
  check('A8 afterInvestigate1', s.rumor.phase === 'afterInvestigate1', s.rumor.phase);
  s.rumorAction('advance');
  check('A9 round2', s.rumor.phase === 'round2', s.rumor.phase);
  s.rumorAction('advance');
  check('A10 investigate2', s.rumor.phase === 'investigate2', s.rumor.phase);
  s.rumorAction('askCurrent');
  check('A11 追问后 chips=1', s.rumor.chips === 1, 'chips=' + s.rumor.chips);
  check('A12 追问记录入册', s.rumor.asked.length === 1 && s.rumor.confirmedClues.length === 1);
  check('A13 afterInvestigate2', s.rumor.phase === 'afterInvestigate2', s.rumor.phase);
  s.rumorAction('advance');
  check('A14 round3', s.rumor.phase === 'round3', s.rumor.phase);
  s.rumorAction('advance');
  check('A15 judgement + 众人判断', s.rumor.phase === 'judgement' && s.rumor.bets && Object.keys(s.rumor.bets).length === 4, JSON.stringify(s.rumor.bets));
  s.rumorAction('advance');
  check('A16 decision', s.rumor.phase === 'decision', s.rumor.phase);
  s.rumorChoose('ship-1');
  check('A17 confirm', s.rumor.phase === 'confirm' && s.rumor.pendingChoice === 'ship-1', s.rumor.phase);
  s.rumorAction('confirmChoice');
  check('A18 结算: settled + voyage', s.rumor.settled === true && s.rumor.phase === 'voyage', s.rumor.phase);
  check('A19 学习: games=1', s.rumorProfile.games === 1, 'games=' + s.rumorProfile.games);
  check('A20 教程局 herd=seen', s.rumorProfile.handbook.herd === 'seen', s.rumorProfile.handbook.herd);
  s.rumorAction('advance');
  check('A21 replay 渲染无异常', s.rumor.phase === 'replay', s.rumor.phase);
  s.rumorAction('handbook');
  check('A22 handbook', s.rumor.phase === 'handbook', s.rumor.phase);
  s.rumorAction('advance');
  check('A23 final', s.rumor.phase === 'final', s.rumor.phase);
  const saved = global.window.__gameStore.get('world.rumorProfile');
  check('A24 存档已写 store (games=1)', saved && saved.games === 1, JSON.stringify(saved));
}

/* ---------- 场景 B：普通局 + 调查/独立陈述路径 ---------- */
{
  freshEnv(); bootStore();
  const s = freshScene();
  s.rumorProfile = { games: 1, handbook: { herd: 'seen', cascade: 'unseen', source: 'unseen', independence: 'unseen', outcome: 'unseen' }, history: [], lastSeed: null, rulesSeen: true };
  s.startRumorRun();
  const r = s.rumor;
  check('B1 普通局 tutorial=false', r.tutorial === false);
  check('B2 普通局三艘随机船', r.ships.length === 3 && r.ships[0].name !== '灰隼号', r.ships.map(x => x.name).join(','));
  const dlen = r.dangerIndexes.length;
  check('B3 danger 与场景一致', (r.scenario.danger === 0 && dlen === 0) || (r.scenario.danger === 2 && dlen === 2) || (r.scenario.danger === 1 && dlen === 1), JSON.stringify({ key: r.scenario.key, danger: r.scenario.danger, dlen }));
  check('B4 消息 4-5 条', r.messages.length === 4 || r.messages.length === 5, 'len=' + r.messages.length);

  s.rumorAction('advance'); s.rumorAction('advance'); // →round1→investigate1
  check('B5 investigate1', s.rumor.phase === 'investigate1', s.rumor.phase);
  s.rumorChoose('investigate-ship-1');
  check('B6 选择调查对象', s.rumor.investigateShipId === 'ship-1', s.rumor.investigateShipId);
  s.rumorAction('investigateDirection', 'body');
  check('B7 核验后 afterInvestigate1 + chips=1', s.rumor.phase === 'afterInvestigate1' && s.rumor.chips === 1, s.rumor.phase + ' chips=' + s.rumor.chips);
  check('B8 线索入册', s.rumor.confirmedClues.length === 1);
  s.rumorAction('advance'); s.rumorAction('advance'); // →round2→investigate2
  s.rumorAction('independent');
  check('B9 独立陈述: afterInvestigate2 + independent', s.rumor.phase === 'afterInvestigate2' && s.rumor.independent === true, s.rumor.phase);
  s.rumorAction('advance'); s.rumorAction('advance'); // →round3→judgement
  s.rumorAction('advance');                           // →decision
  const target = s.rumor.ships[0].id;
  s.rumorChoose(target); s.rumorAction('confirmChoice');
  check('B10 结算完成', s.rumor.settled === true && s.rumor.phase === 'voyage', s.rumor.phase);
  check('B11 games=2', s.rumorProfile.games === 2, 'games=' + s.rumorProfile.games);
  check('B12 herd 不为 unseen', s.rumorProfile.handbook.herd !== 'unseen', s.rumorProfile.handbook.herd);
}

/* ---------- 场景 C：种子确定性（rng 调用顺序收敛后不变） ---------- */
{
  freshEnv(); bootStore();
  const s = freshScene();
  s.rumorProfile = { games: 9, handbook: { herd: 'seen', cascade: 'seen', source: 'seen', independence: 'seen', outcome: 'seen' }, history: [], lastSeed: null, rulesSeen: true };
  const a = s.createRumorRun('fixed-seed-test');
  const b = s.createRumorRun('fixed-seed-test');
  const norm = x => JSON.stringify({ ships: x.ships.map(s2 => [s2.name, s2.danger, s2.result]), messages: x.messages.map(m => m.id), dangerIndexes: x.dangerIndexes });
  check('C1 同种子两次生成完全一致', norm(a) === norm(b));
  const c = s.createRumorRun('another-seed');
  const sig = x => x.ships.map(s2 => s2.name).join(',');
  const seen = new Set([sig(a), sig(c)]);
  // 最多尝试 5 个种子，只要出现两组不同船名即证明 rng 链随种子变化
  for (let i = 0; i < 5 && seen.size < 2; i++) seen.add(sig(s.createRumorRun('seed-' + i)));
  check('C2 不同种子生成不同船名', seen.size >= 2, [...seen].join(' | '));
}

console.log(failures.length ? `\n${failures.length} 项失败: ${failures.join(' | ')}` : '\n全部通过 ✅');
process.exit(failures.length ? 1 : 0);
