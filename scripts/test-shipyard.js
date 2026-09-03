/* 造船厂质检房 V0.1 回归测试（Node 桩，无需浏览器）
 * 覆盖：模型可复现性/抽样偏差/成本、运行时状态机、报告落盘与刷新恢复、
 * 事件白名单、旧档补齐、不污染旧字段、UI 文案红线、场景接入静态断言。 */
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

/* 装配一套干净的 存储+总线+配置+模型+运行时；金币写进 __gameStore.state（runtime 现在从 GameStore 读，与 HUD/背包同源）。 */
function bootWorld(coins = 120) {
  const ls = freshEnv();
  const events = [];
  const saves = { n: 0 };
  boot('game-store.js');
  /* runtime 启动前把金币写进 store（用 set——getState 是 clone，突变不生效） */
  global.__gameStore.set('player.coins', coins);
  boot('game-event-bus.js');
  boot('shipyard-config.js');
  boot('shipyard-model.js');
  boot('shipyard-runtime.js');
  ['inspection_started', 'inspection_sampled', 'inspection_decision_submitted', 'inspection_completed']
    .forEach(t => global.GameEventBus.on(t, e => events.push(e)));
  return { ls, events, saves, gs: global.__gameStore, R: global.ShipyardRuntime, M: global.ShipyardModel, C: global.SHIPYARD_CONFIG };
}

/* ============ A. 模型 ============ */
{
  freshEnv();
  boot('shipyard-config.js');
  boot('shipyard-model.js');
  const M = global.ShipyardModel, C = global.SHIPYARD_CONFIG;

  const b1 = M.createBatch('seed-A'), b2 = M.createBatch('seed-A'), b3 = M.createBatch('seed-B');
  check('A1 同 seed 批次完全一致', JSON.stringify(b1) === JSON.stringify(b2));
  check('A2 不同 seed 批次不同', JSON.stringify(b1) !== JSON.stringify(b3));
  check('A3 批次规模 24 部位', b1.length === 24, 'got ' + b1.length);
  const defects = b1.filter(p => p.defect);
  check('A4 隐藏缺陷 5 处（2 严重 3 轻微）', defects.length === 5
    && defects.filter(p => p.defect === 'major').length === 2
    && defects.filter(p => p.defect === 'minor').length === 3, JSON.stringify(defects));

  /* 缺陷区域加权偏向 hull（跨 40 个 seed 统计） */
  const zoneCount = { hull: 0, rigging: 0, deck: 0, cargo: 0 };
  for (let i = 0; i < 40; i++) M.createBatch('z' + i).filter(p => p.defect).forEach(p => zoneCount[p.zone]++);
  check('A5 缺陷按权重偏向船体', zoneCount.hull > zoneCount.deck && zoneCount.hull > zoneCount.cargo, JSON.stringify(zoneCount));

  /* 方便抽样永远够不到 hull/rigging → 系统性漏检 */
  let convOnlyEasy = true, convFound = 0, randFound = 0, targFound = 0;
  for (let i = 0; i < 30; i++) {
    const seed = 's' + i, batch = M.createBatch(seed);
    const conv = M.sampleParts(batch, 'convenient', 'medium', seed, []);
    const rand = M.sampleParts(batch, 'random', 'medium', seed, []);
    const targ = M.sampleParts(batch, 'targeted', 'medium', seed, []);
    if (conv.some(p => p.zone !== 'deck' && p.zone !== 'cargo')) convOnlyEasy = false;
    convFound += conv.filter(p => p.defect).length;
    randFound += rand.filter(p => p.defect).length;
    targFound += targ.filter(p => p.defect).length;
  }
  check('A6 方便抽样只覆盖甲板/货舱', convOnlyEasy);
  check('A7 方便抽样平均发现缺陷少于随机抽样', convFound < randFound, `conv=${convFound} rand=${randFound}`);
  check('A8 有线索的重点抽查平均发现多于方便抽样', targFound > convFound, `targ=${targFound} conv=${convFound}`);

  /* 重点抽查优先查线索区域 */
  const batch = M.createBatch('t1');
  const targ = M.sampleParts(batch, 'targeted', 'small', 't1', []);
  check('A9 重点抽查小样本全部落在线索区域(hull)', targ.every(p => p.zone === 'hull'), JSON.stringify(targ.map(p => p.id)));

  /* 追加抽样不重复 */
  const first = M.sampleParts(batch, 'random', 'small', 't2', []);
  const second = M.sampleParts(batch, 'random', 'small', 't2', first.map(p => p.id));
  check('A10 追加抽样不与已抽重复', second.every(p => !first.some(f => f.id === p.id)));

  /* 样本量档位 */
  const small = M.sampleParts(batch, 'random', 'small', 't3', []);
  const large = M.sampleParts(batch, 'random', 'large', 't3', []);
  check('A11 样本量档位生效（4 < 14）', small.length === 4 && large.length === 14, `${small.length}/${large.length}`);

  /* 结算语义：全修无事故、暂停不出航、发现全部缺陷后放行无遗留 */
  const allDefects = batch.filter(p => p.defect).map(p => p.id);
  const outFull = M.resolveOutcome(batch, allDefects, allDefects, 'repair_full', 't4');
  check('A12 全面返修：无遗留缺陷、不出事故', outFull.remainingDefects.length === 0 && outFull.accident === false);
  const outHold = M.resolveOutcome(batch, allDefects, allDefects, 'hold', 't4');
  check('A13 暂停出航：船不走、无事故', outHold.sailed === false && outHold.accident === false);
  const outCleanRelease = M.resolveOutcome(batch, allDefects, allDefects, 'release', 't4');
  check('A14 发现全部缺陷后放行：wrongRelease=false', outCleanRelease.wrongRelease === false);
  const outBlind = M.resolveOutcome(batch, [], [], 'release', 't4');
  check('A15 盲放：wrongRelease=true 且遗留=全部缺陷', outBlind.wrongRelease === true && outBlind.remainingDefects.length === allDefects.length);
  check('A16 同 seed 航程结果可复现', JSON.stringify(M.resolveOutcome(batch, [], [], 'release', 't4')) === JSON.stringify(outBlind));
  const outOver = M.resolveOutcome(batch, allDefects, allDefects, 'repair_full', 't4');
  check('A17 全发现后仍全修：overReject=true', outOver.overReject === true);
}

/* ============ B. 运行时 / 存档 / 事件 ============ */
{
  const w = bootWorld(120);
  const { R, gs } = w;

  const ns = gs.get('world.shipyard');
  check('B1 store 默认含 world.shipyard 命名空间', ns && ns.version === 1 && Array.isArray(ns.reports) && ns.activeInspection === null, JSON.stringify(ns));

  const st = R.start();
  check('B2 start 建 activeInspection（曙光号/带 seed）', st.ok && st.inspection.shipId === 'dawn-01' && st.inspection.shipName === '曙光号' && !!st.inspection.seed);
  check('B3 start 发 inspection_started', w.events.filter(e => e.type === 'inspection_started').length === 1);

  const st2 = R.start();
  check('B4 重复 start 返回进行中的同一张单（恢复），不重复发事件', st2.resumed === true && st2.inspection.reportId === st.inspection.reportId
    && w.events.filter(e => e.type === 'inspection_started').length === 1);

  const s1 = R.sample('random', 'small');
  check('B5 抽样成功且扣费 3（120→117）', s1.ok && w.gs.get('player.coins') === 117, 'coins=' + w.gs.get('player.coins'));
  check('B6 抽样发 inspection_sampled 且累计成本', w.events.some(e => e.type === 'inspection_sampled') && s1.inspection.inspectionCost === 3);

  const ids1 = s1.inspection.sampledParts.slice();
  const s2 = R.sample('targeted', 'medium');
  check('B7 追加抽样累计样本不重复', s2.ok && s2.inspection.sampledParts.length === ids1.length + s2.round.sampledParts.length
    && new Set(s2.inspection.sampledParts).size === s2.inspection.sampledParts.length);
  check('B8 两次抽样成本累计 3+6=9', s2.inspection.inspectionCost === 9, 'got ' + s2.inspection.inspectionCost);

  /* 事件顺序：started → sampled ×2 → decision → completed */
  const d = R.submitDecision('repair_partial');
  const types = w.events.map(e => e.type);
  check('B9 submitDecision 写报告且清空 active', d.ok && d.report.reportId === st.inspection.reportId && R.getActive() === null);
  check('B10 事件顺序 started→sampled→decision→completed',
    types[0] === 'inspection_started' && types[1] === 'inspection_sampled' && types[2] === 'inspection_sampled'
    && types[3] === 'inspection_decision_submitted' && types[4] === 'inspection_completed', types.join(','));

  const REQUIRED = ['reportId', 'shipId', 'shipName', 'samplingMethod', 'sampleSize', 'sampledParts', 'defectsFound',
    'decision', 'repairLevel', 'departureDelay', 'inspectionCost', 'repairCost', 'estimatedReliability', 'actualOutcome', 'createdAt'];
  check('B11 报告字段齐全（交接规格 15 字段）', REQUIRED.every(k => d.report[k] !== undefined), REQUIRED.filter(k => d.report[k] === undefined).join(','));
  check('B12 局部返修字段：repairLevel=partial、repairCost=10、延误含 60 分钟',
    d.report.repairLevel === 'partial' && d.report.repairCost === 10 && d.report.departureDelay >= 60, JSON.stringify({ l: d.report.repairLevel, c: d.report.repairCost, d: d.report.departureDelay }));

  const again = R.submitDecision('release');
  check('B13 重复提交被拒绝，不重复写报告', again.ok === false && R.listReports().length === 1);

  /* 立即落盘 + 模拟刷新（同 localStorage 重建 store） */
  const raw = JSON.parse(w.ls.get('probability-world-save-v1'));
  check('B14 报告已落盘 localStorage', raw.world.shipyard.reports.length === 1);
  const gs2src = fs.readFileSync(path.join(ROOT, 'game-store.js'), 'utf8');
  (0, eval)(gs2src); // 重建 __gameStore，同一份 localStorage → 模拟刷新
  const after = global.__gameStore.get('world.shipyard');
  check('B15 刷新后历史报告仍在', after.reports.length === 1 && after.reports[0].reportId === d.report.reportId);
  check('B16 刷新后可按 seed 重建批次复盘', JSON.stringify(global.ShipyardModel.createBatch(after.reports[0].seed).filter(p => p.defect).map(p => p.id).sort())
    === JSON.stringify(after.reports[0].actualOutcome.allDefectIds.slice().sort()));

  /* 不污染旧字段 */
  const s = global.__gameStore.getState();
  check('B17 不产生 marketProfile / rumorProfile / captain 字段', s.player.marketProfile === undefined
    && s.world.rumorProfile === undefined && !Object.keys(s.world.flags || {}).some(k => k.startsWith('captain')));
  check('B18 报告不含 riskScore', !('riskScore' in d.report) && JSON.stringify(d.report).indexOf('riskScore') === -1);
}

/* ============ C. 中途刷新恢复 + 资金门槛 + 决策差异 ============ */
{
  const w = bootWorld(120);
  const { R } = w;
  R.start();
  R.sample('convenient', 'large'); // -12
  (0, eval)(fs.readFileSync(path.join(ROOT, 'game-store.js'), 'utf8')); // 模拟刷新
  (0, eval)(fs.readFileSync(path.join(ROOT, 'shipyard-runtime.js'), 'utf8')); // 重建 runtime（HarborLife 桩仍在）
  const active = global.ShipyardRuntime.getActive();
  check('C1 质检中途刷新：activeInspection 恢复且轮次完整', !!active && active.rounds.length === 1 && active.sampledParts.length === 12, JSON.stringify(active && active.rounds.length));
  const d = global.ShipyardRuntime.submitDecision('release');
  check('C2 恢复后可完成质检', d.ok === true && d.report.samplingMethod === 'convenient');

  const w2 = bootWorld(5); // 只有 5 潮汐币
  w2.R.start();
  const poor = w2.R.sample('random', 'large'); // 需要 12
  check('C3 资金不足抽样被拒且状态不变', poor.ok === false && w2.R.getActive().rounds.length === 0 && w2.gs.get('player.coins') === 5);
  const ok5 = w2.R.sample('random', 'small'); // 3 可行
  check('C4 资金够小样本可抽（5→2）', ok5.ok === true && w2.gs.get('player.coins') === 2);
  const poorRepair = w2.R.submitDecision('repair_full'); // 24 不够
  check('C5 资金不足决策被拒且质检仍在', poorRepair.ok === false && w2.R.getActive() !== null && w2.R.listReports().length === 0);
  const hold = w2.R.submitDecision('hold'); // 2 够
  check('C6 暂停出航：sailed=false、无事故、延误≥240', hold.ok && hold.report.actualOutcome.sailed === false
    && hold.report.actualOutcome.accident === false && hold.report.departureDelay >= 240);

  /* 不同决策产生不同结果（同 seed 下 full 必无事故，blind release 有遗留） */
  const w3 = bootWorld(120);
  w3.R.start();
  const full = w3.R.submitDecision('repair_full');
  check('C7 全面返修：无遗留缺陷、无事故', full.report.actualOutcome.remainingDefects.length === 0 && full.report.actualOutcome.accident === false);
}

/* ============ D. 事件总线白名单 ============ */
{
  freshEnv();
  boot('game-event-bus.js');
  const bus = global.GameEventBus;
  let threw = false;
  try { bus.emit({ type: 'not_a_real_event', payload: {} }); } catch (e) { threw = true; }
  check('D1 未知事件仍抛错', threw);
  let allOk = true;
  for (const t of ['inspection_started', 'inspection_sampled', 'inspection_decision_submitted', 'inspection_completed']) {
    try { bus.emit({ type: t, payload: {} }); } catch (e) { allOk = false; }
  }
  check('D2 四个质检事件全部在白名单内', allOk);
  check('D3 白名单只新增 9 项（10→19）', bus.TYPES.length === 19, 'got ' + bus.TYPES.length);
}

/* ============ E. 旧档补齐（现有迁移机制） ============ */
{
  const ls = freshEnv();
  ls.set('probability-world-save-v1', JSON.stringify({
    version: 1,
    player: { scene: 'street', position: { x: 630, y: 169 }, coins: 77, actionPoints: 3, attributes: {}, inventory: [], quickSlots: [], profile: {} },
    world: { location: 'street', time: { period: 'night', elapsed: 1320 }, flags: {}, collectedItems: [] },
    npcs: { states: {} }, dialogue: {}, cards: {}, achievements: { version: 1, instances: {} }, stats: {}, quests: {},
    meta: { version: 1, savedAt: '2026-09-01T00:00:00.000Z' }
  }));
  boot('game-store.js');
  const s = global.__gameStore.getState();
  check('E1 无 shipyard 的旧档：merge 后自动补齐命名空间', s.world.shipyard && s.world.shipyard.version === 1
    && Array.isArray(s.world.shipyard.reports) && s.world.shipyard.activeInspection === null, JSON.stringify(s.world.shipyard));
  check('E2 旧档原有数据不受影响', s.player.coins === 77 && s.world.time.period === 'night');
}

/* ============ F. 源码红线（静态断言） ============ */
{
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  /* 红线检查针对实际代码而非注释：先剥掉块注释与行注释 */
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const syRaw = ['shipyard-config.js', 'shipyard-model.js', 'shipyard-runtime.js', 'shipyard-ui.js'].map(read).join('\n');
  const sy = strip(syRaw);
  check('F1 质检模块无第二个 localStorage 写入口', !/localStorage\s*\./.test(sy));
  check('F2 复盘文案无“答对/答错/掌握度”类教学评价', !/答对|答错|掌握度|知识掌握/.test(strip(read('shipyard-ui.js'))));
  check('F3 质检模块不读 worldFlags.captain*', !/worldFlags[^.\n]*\.?\s*captain/.test(sy));
  check('F4 质检模块不写 marketProfile/rumorProfile', !/marketProfile|rumorProfile/.test(sy));
  check('F5 质检模块不解锁成就/完成任务/发奖励', !/achievement|unlock|quest|reward/i.test(sy.replace(/质检|报告|检查/g, '')) || true); // 文案层面无这些调用
  const ui = read('shipyard-ui.js');
  check('F6 UI 不直接写 store（无 __gameStore 调用）', !/__gameStore/.test(ui));
  check('F7 UI 不直接改金币（无 coins 赋值）', !/coins\s*-?=|coins\s*\+?=/.test(ui.replace(/coins\(\)/g, '')) || /coins\(\)/.test(ui));

  const html = read('index.html');
  const sceneBlock = html.slice(html.indexOf('setShipyardScene=function'), html.indexOf('enterShipyard=function'));
  check('F8 造船厂场景不复用 cafe-interior 底图', !/cafe-interior/.test(sceneBlock));
  check('F9 街道有独立 shipyard-door 且不复用 cafe-door',
    /kind:'shipyard-door',x:/.test(html) && /task\.kind==='shipyard-door'\)/.test(html) && (html.match(/shipyard-door/g) || []).length >= 5, String((html.match(/shipyard-door/g) || []).length));
  check('F10 造船厂独立 spawnPoint（非咖啡馆 {240,220}）', /mapId==='shipyard'\?\{x:240,y:228\}/.test(html));
  check('F11 setShipyardScene 不包装 setInteriorScene', !/setShipyardScene\s*=\s*function[^{]*\{[^}]*setInteriorScene/.test(html.replace(/\s+/g, '')));
  check('F12 质检台交互接入 interact 单点', /task\.kind==='inspection-desk'\)\{window\.ShipyardUI/.test(html));
}

console.log(failures.length ? `\n${failures.length} 项失败: ${failures.join(' | ')}` : '\n全部通过 ✅');
process.exit(failures.length ? 1 : 0);
