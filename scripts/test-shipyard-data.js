/* 第二步验证：质检输出的字段完整性、船只稳定标识、存档边界与刷新后可读性。
 * 全部在 vm 沙箱中加载真实模块，document 恒为 undefined —— 天然证明数据链不依赖 DOM 与质检 UI。
 * Run: node scripts/test-shipyard-data.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SAVE_KEY = 'probability-world-save-v1';
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const FILES = ['game-event-bus.js', 'game-store.js', 'reward-service.js',
  'quest-definitions.js', 'quest-runtime.js', 'achievement-definitions.js',
  'achievement-runtime.js', 'shipyard-config.js', 'shipyard-model.js', 'shipyard-runtime.js'];

/* 每次启动一个干净的沙箱；initial 可预置 localStorage 内容以模拟旧存档。 */
function boot(initial) {
  const storage = new Map();
  if (initial) storage.set(SAVE_KEY, JSON.stringify(initial));
  const sb = {};
  sb.window = sb; sb.globalThis = sb; sb.console = console;
  sb.localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
    clear: () => storage.clear()
  };
  sb.setTimeout = setTimeout; sb.clearTimeout = clearTimeout;
  sb.document = undefined;
  const ctx = vm.createContext(sb);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  sb.__storage = storage;
  return sb;
}

const REQUIRED = ['reportId', 'shipId', 'shipName', 'route', 'materialBatch', 'samplingMethod',
  'sampleSize', 'sampledParts', 'defectsFound', 'decision', 'repairLevel', 'departureDelay',
  'inspectionCost', 'repairCost', 'estimatedReliability', 'actualOutcome', 'createdAt'];

function runOneInspection(sb, decision) {
  const SY = sb.ShipyardRuntime;
  sb.__gameStore.set('player.coins', 500);
  SY.start();
  const insp = SY.getActive();
  const batch = sb.ShipyardModel.createBatch(insp.seed);
  SY.sampleSinglePart('random', batch[0].id);
  SY.sampleSinglePart('random', batch[1].id);
  SY.sampleSinglePart('random', batch[2].id);
  return SY.submitDecision(decision || 'repair_partial');
}

/* ============================================================ */
console.log('\n[1] 报告字段完整性');
let sb = boot();
const res = runOneInspection(sb, 'repair_partial');
ok('submitDecision 返回 ok', res.ok === true, res);
const report = sb.ShipyardRuntime.getReport(res.report.reportId);
const missing = REQUIRED.filter(k => !(k in report));
ok('17 个必需字段全部存在', missing.length === 0, missing);
ok('route 已快照', report.route === '灰湾—北岬', report.route);
ok('materialBatch 已快照', report.materialBatch === sb.SHIPYARD_CONFIG.testShip.publicInfo.materialBatch, report.materialBatch);
ok('decision 与 repairLevel 对应', report.decision === 'repair_partial' && report.repairLevel === 'partial');
ok('actualOutcome 结构完整', ['sailed', 'accident', 'accidentCause', 'remainingDefects', 'allDefectIds', 'missedDefects', 'wrongRelease', 'overReject'].every(k => k in report.actualOutcome), Object.keys(report.actualOutcome));
ok('estimatedReliability 结构完整', ['coverage', 'sampledCount', 'foundCount', 'sampleDefectRate'].every(k => k in report.estimatedReliability));
ok('可复现：报告带 seed', typeof report.seed === 'string' && report.seed.length > 0);

console.log('\n[2] 完成语义');
ok('activeInspection 已清空', sb.ShipyardRuntime.getActive() === null);
const before = sb.ShipyardRuntime.listReports().length;
const again = sb.ShipyardRuntime.submitDecision('release');
ok('同一次质检不能重复提交', again.ok === false && again.reason === 'no-active-inspection', again);
ok('报告未重复写入', sb.ShipyardRuntime.listReports().length === before, sb.ShipyardRuntime.listReports().length);

console.log('\n[3] 存档边界');
const saved = JSON.parse(sb.__storage.get(SAVE_KEY));
ok('world.shipyard 只有 version/reports/activeInspection', Object.keys(saved.world.shipyard).sort().join(',') === 'activeInspection,reports,version', Object.keys(saved.world.shipyard));
ok('报告已在存档里', saved.world.shipyard.reports.length === 1, saved.world.shipyard.reports.length);
ok('存档内报告也带 route', saved.world.shipyard.reports[0].route === '灰湾—北岬');
const raw = sb.__storage.get(SAVE_KEY);
ok('不保存 riskScore', raw.indexOf('riskScore') === -1);
ok('不保存 UI 临时状态（视图/弹窗/选中项）', !/\"(view|picked|panelOpen|overlay|isOpen|selected)\"/.test(raw));
ok('未新增 world.vessels', !('vessels' in saved.world));
ok('未把事实复制到其他命名空间（顶层键未增加）',
  Object.keys(saved).sort().join(',') === Object.keys(JSON.parse(JSON.stringify({ version: 1, player: {}, world: {}, npcs: {}, dialogue: {}, cards: {}, achievements: {}, stats: {}, quests: {}, meta: {} }))).sort().join(','),
  Object.keys(saved));

console.log('\n[4] 刷新后仍可读（新上下文从同一存档启动）');
sb = boot(saved);
const reloaded = sb.ShipyardRuntime.listReports();
ok('重启后报告数量保持', reloaded.length === 1, reloaded.length);
ok('重启后 route/materialBatch 仍在', reloaded[0].route === '灰湾—北岬' && !!reloaded[0].materialBatch);
ok('重启后 activeInspection 为 null', reloaded.length > 0 && sb.ShipyardRuntime.getActive() === null);
ok('不依赖质检 UI：本沙箱从未加载 shipyard-ui.js', !sb.ShipyardUI);

console.log('\n[5] 旧存档补齐（报告无 route/materialBatch）');
const legacy = JSON.parse(JSON.stringify(saved));
delete legacy.world.shipyard.reports[0].route;
delete legacy.world.shipyard.reports[0].materialBatch;
ok('构造的旧报告确实缺字段', !('route' in legacy.world.shipyard.reports[0]));
sb = boot(legacy);
const healed = sb.ShipyardRuntime.listReports()[0];
ok('读取时补齐 route', healed.route === '灰湾—北岬', healed.route);
ok('读取时补齐 materialBatch', healed.materialBatch === sb.SHIPYARD_CONFIG.testShip.publicInfo.materialBatch);
ok('补齐不覆盖已有值', healed.reportId === legacy.world.shipyard.reports[0].reportId);
ok('只读补齐未回写存档', JSON.parse(sb.__storage.get(SAVE_KEY)).world.shipyard.reports[0].route === undefined);

console.log('\n[6] 完全无 shipyard 命名空间的旧档');
const noNs = JSON.parse(JSON.stringify(saved));
delete noNs.world.shipyard;
sb = boot(noNs);
ok('缺命名空间时安全兜底为空报告', sb.ShipyardRuntime.listReports().length === 0, sb.ShipyardRuntime.listReports().length);
ok('缺命名空间时仍可开始新质检', sb.ShipyardRuntime.start().ok === true);
const fresh = sb.ShipyardRuntime.listReports();
ok('新质检完成后报告完整', fresh.length === 0 || REQUIRED.every(k => k in fresh[0]));

console.log('\n[7] inspection_completed payload（未改动，仍满足风险盘输入）');
sb = boot();
const emitted = [];
sb.GameEventBus.on('inspection_completed', e => emitted.push(e));
runOneInspection(sb, 'hold');
ok('事件只发 1 次', emitted.length === 1, emitted.length);
const pl = emitted[0].payload;
['reportId', 'shipId', 'shipName', 'defectsFound', 'decision', 'repairLevel', 'departureDelay', 'actualOutcome']
  .forEach(k => ok('payload 含 ' + k, k in pl, Object.keys(pl)));
ok('payload.defectsFound 为数字', typeof pl.defectsFound === 'number', pl.defectsFound);
ok('payload 不含 DOM/UI 引用', JSON.stringify(pl).indexOf('node') === -1 && !pl.element);
ok('payload 不含 riskScore', !('riskScore' in pl));

console.log('\n[8] 船只稳定标识');
sb = boot();
const r1 = runOneInspection(sb, 'release').report;
sb.__gameStore.set('world.shipyard.activeInspection', null);
const r2 = runOneInspection(sb, 'hold').report;
ok('两次质检 shipId 相同且固定', r1.shipId === r2.shipId && r1.shipId === 'dawn-01', [r1.shipId, r2.shipId]);
ok('shipId 不随随机船名变化', r1.shipName === '曙光号' && r2.shipName === '曙光号', [r1.shipName, r2.shipName]);
ok('reportId 每次不同', r1.reportId !== r2.reportId);

console.log('\n[9] 只读入口复用现有函数，不建第二份数据');
sb = boot();
runOneInspection(sb, 'hold');
const a = sb.ShipyardRuntime.listReports();
const b = sb.ShipyardRuntime.listReports();
ok('重复读取字段一致', JSON.stringify(a) === JSON.stringify(b));
ok('读取不改变存档', (function () {
  const s1 = sb.__storage.get(SAVE_KEY);
  sb.ShipyardRuntime.listReports(); sb.ShipyardRuntime.getActive();
  return sb.__storage.get(SAVE_KEY) === s1;
})());
ok('无 activeInspection 时仍可读报告', (function () {
  sb.__gameStore.set('world.shipyard.activeInspection', null);
  return sb.ShipyardRuntime.listReports().length === 1;
})());

console.log('\n================================');
console.log('PASS ' + pass + ' / FAIL ' + fail);
console.log('================================');
process.exit(fail ? 1 : 0);
