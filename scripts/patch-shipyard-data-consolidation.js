/* 第二步：固化质检输出，为商会船队风险盘建立稳定数据输入。
 * 只改 shipyard-runtime.js：报告补 route/materialBatch 快照 + 旧存档报告只读补齐。
 * 不新增 world.vessels（shipId 'dawn-01' 已是稳定 ID），不新增事件类型，不改 payload、UI、任务与成就。
 * 每个补丁带 marker，重复执行会 SKIP 而不是重复插入。
 * Run: node scripts/patch-shipyard-data-consolidation.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = 'shipyard-runtime.js';
let failures = 0;
let changed = 0, skipped = 0;

const PATCHES = [
  /* A. 报告对象补两个船只快照字段 */
  {
    label: 'report: add route + materialBatch snapshot',
    marker: 'materialBatch: config().testShip.publicInfo.materialBatch',
    anchor: "      shipName: insp.shipName,\n      seed: insp.seed,",
    replacement: "      shipName: insp.shipName,\n      route: config().testShip.route,\n      materialBatch: config().testShip.publicInfo.materialBatch,\n      seed: insp.seed,"
  },
  /* B. 新增只读补齐函数（不改存档、不覆盖已有值） */
  {
    label: 'add normalizeReports helper',
    marker: 'function normalizeReports(reports)',
    anchor: "  function writeNamespace(ns) {",
    replacement: "  /* 旧存档的报告可能没有 route/materialBatch 快照：读取时按稳定 shipId 补齐，\n   * 不改动已存在的值，也不为了补齐而回写存档。 */\n  function normalizeReports(reports) {\n    const ship = config().testShip;\n    return reports.map(function (r) {\n      if (!r || r.shipId !== ship.shipId) return r;\n      if (r.route && r.materialBatch) return r;\n      return Object.assign({}, r, {\n        route: r.route || ship.route,\n        materialBatch: r.materialBatch || ship.publicInfo.materialBatch\n      });\n    });\n  }\n\n  function writeNamespace(ns) {"
  },
  /* C. readNamespace 走补齐后的报告数组 */
  {
    label: 'readNamespace: normalize reports on read',
    marker: 'normalizeReports(Array.isArray(ns.reports)',
    anchor: "        reports: Array.isArray(ns.reports) ? ns.reports : [],",
    replacement: "        reports: normalizeReports(Array.isArray(ns.reports) ? ns.reports : []),"
  }
];

const abs = path.join(ROOT, TARGET);
const original = fs.readFileSync(abs, 'utf8');
let content = original;

for (const p of PATCHES) {
  if (content.includes(p.marker)) {
    console.log('SKIP [' + TARGET + '] already applied: ' + p.label);
    skipped++;
    continue;
  }
  if (!content.includes(p.anchor)) {
    console.error('FAIL [' + TARGET + '] anchor not found: ' + p.label);
    failures++;
    continue;
  }
  content = content.replace(p.anchor, p.replacement);
  console.log('OK   [' + TARGET + '] ' + p.label);
  changed++;
}

if (content !== original) fs.writeFileSync(abs, content, 'utf8');

/* 回读验证区域 */
console.log('\n--- readback ---');
const after = fs.readFileSync(abs, 'utf8');
const lines = after.split('\n');
function show(needle, span) {
  const i = lines.findIndex(l => l.includes(needle));
  if (i < 0) { console.log('MISSING: ' + needle); return; }
  console.log('[' + (i + 1) + '] ' + needle);
  for (let k = Math.max(0, i - 2); k <= i + span && k < lines.length; k++) console.log('   ' + (k + 1) + ': ' + lines[k].trim());
  console.log('');
}
show('materialBatch: config().testShip', 2);
show('function normalizeReports', 12);
show('reports: normalizeReports(', 1);

/* 语法检查 */
try {
  new Function(after);
  console.log('SYNTAX OK');
} catch (e) {
  console.error('SYNTAX ERROR: ' + e.message);
  failures++;
}

console.log('\n' + changed + ' applied, ' + skipped + ' skipped, ' + failures + ' failed.');
process.exit(failures ? 1 : 0);
