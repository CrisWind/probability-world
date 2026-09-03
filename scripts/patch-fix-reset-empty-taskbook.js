/* Bug 修复：点「重置测试存档」后再进造船厂，任务簿空空如也。
 *
 * 根因（两处，都在 index.html）：
 *  1. HarborLife.reset() 只把 HarborLife 自己的 state 换回 defaults() 再 save()。
 *     save() 只写 player / world.location,time,flags,collectedItems / npcs.states / world.storyState，
 *     永远碰不到 __gameStore.quests 与 .achievements。于是上一次通关留下的
 *     quest.cant_tear_down_all = {status:'completed'} 原封不动地活了下来；
 *     而 QuestRuntime.unlockQuest() 第一行就是 `if (quests.instances[id]) return false;`，
 *     scene_entered{shipyard} 再也不会把它重新解锁成 available。
 *     同时 task-ui.js open() 的默认页是 active/available，completed 只在「已完成」页里，
 *     玩家看到的就是「任务簿里什么都没有」。
 *     另一个重置入口 #reset-button（↻）走的是 __gameStore.reset() + location.reload()，
 *     两个「重置」语义不一致是这个 bug 的根源。
 *  2. 本轮改过的 17 个模块 <script> 标签仍是 ?v=1，↻ 之后的 location.reload()
 *     可能继续命中磁盘缓存里的旧 JS（旧档里没有 quest.cant_tear_down_all 定义），
 *     表现同样是任务簿空。按项目既有约定（embedded-assets.js?v=20260828-1）加日期戳。
 *
 * 只改 index.html。不改 quest-runtime / task-ui / shipyard 任何逻辑。
 * 每个补丁带 marker，重复执行 SKIP 而不是重复插入。
 * Run: node scripts/patch-fix-reset-empty-taskbook.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = 'index.html';
const CACHE_VER = '20260902-1';

const PATCHES = [
  {
    label: 'HarborLife.reset(): 清整份 GameStore 而不是只清 HarborLife 切片',
    marker: '重置口径与 ↻ 按钮对齐',
    kind: 'string',
    anchor: "      function reset(){\n        state=defaults();\n        save();\n        toast('测试存档已重置。');\n        if(scene){scene.setStreetScene(true);syncScene(scene)}\n      }",
    replacement: "      function reset(){\n        /* 重置口径与 ↻ 按钮对齐：整份 GameStore 归零。\n         * 只换 HarborLife 的 state 会漏掉 quests/achievements，一次性的 completed 实例\n         * 会让 unlockQuest 永久 return false，任务再也不会回到任务簿。 */\n        window.__gameStore?.reset?.();\n        load();\n        save();\n        toast('测试存档已重置。');\n        if(scene){scene.setStreetScene(true);syncScene(scene)}\n      }"
  },
  {
    label: '#life-save-reset: 补确认弹窗 + 重载，行为与 ↻ 一致',
    marker: '确定重置全部测试存档吗？任务、成就与质检报告也会一起清空。',
    kind: 'string',
    anchor: "document.getElementById('life-save-reset').addEventListener('click',HarborLife.reset);",
    replacement: "document.getElementById('life-save-reset').addEventListener('click',()=>{if(!window.confirm('确定重置全部测试存档吗？任务、成就与质检报告也会一起清空。'))return;HarborLife.reset();window.location.reload()});"
  },
  {
    label: 'bump 模块 ?v=1 -> ?v=' + CACHE_VER + '（强制重载拿到最新 JS）',
    marker: '?v=' + CACHE_VER + '"',
    kind: 'regex',
    anchor: /\.js\?v=1"/g,
    replacement: '.js?v=' + CACHE_VER + '"'
  }
];

const abs = path.join(ROOT, TARGET);
const rawOriginal = fs.readFileSync(abs, 'utf8');
const wasCRLF = rawOriginal.includes('\r\n');
const normalize = t => t.replace(/\r\n/g, '\n');
const original = normalize(rawOriginal);

let content = original;
let failures = 0, changed = 0, skipped = 0;

for (const p of PATCHES) {
  if (content.includes(p.marker)) {
    console.log('SKIP [' + TARGET + '] already applied: ' + p.label);
    skipped++;
    continue;
  }
  if (p.kind === 'regex') {
    const hits = content.match(p.anchor);
    if (!hits || !hits.length) {
      console.error('FAIL [' + TARGET + '] regex matched nothing: ' + p.label);
      failures++;
      continue;
    }
    content = content.replace(p.anchor, p.replacement);
    console.log('OK   [' + TARGET + '] ' + p.label + '  (' + hits.length + ' tags)');
    changed++;
    continue;
  }
  if (!content.includes(p.anchor)) {
    console.error('FAIL [' + TARGET + '] anchor not found: ' + p.label);
    failures++;
    continue;
  }
  if (content.split(p.anchor).length > 2) {
    console.error('FAIL [' + TARGET + '] anchor is ambiguous: ' + p.label);
    failures++;
    continue;
  }
  content = content.replace(p.anchor, p.replacement);
  console.log('OK   [' + TARGET + '] ' + p.label);
  changed++;
}

if (content !== original) {
  fs.writeFileSync(abs, wasCRLF ? content.replace(/\n/g, '\r\n') : content, 'utf8');
}

/* ── 回读 ─────────────────────────────────────────────────────────────── */
const after = normalize(fs.readFileSync(abs, 'utf8'));
const lines = after.split('\n');
function show(needle, before, span) {
  const i = lines.findIndex(l => l.includes(needle));
  if (i < 0) { console.log('MISSING: ' + needle); return; }
  for (let k = Math.max(0, i - before); k <= i + span && k < lines.length; k++) {
    console.log((k === i ? '>> ' : '   ') + (k + 1) + ': ' + lines[k].trim().slice(0, 240));
  }
  console.log('');
}
console.log('\n--- readback: HarborLife.reset ---');
show('function reset(){', 0, 10);
console.log('--- readback: #life-save-reset wiring ---');
show("getElementById('life-save-reset')", 0, 0);
console.log('--- readback: script tags ---');
lines.filter(l => l.includes('<script src=')).forEach(l => console.log('   ' + l.trim().slice(0, 130)));
console.log('   leftover ?v=1 tags: ' + (after.match(/\.js\?v=1"/g) || []).length);

/* ── 语法检查：抽出 index.html 内联脚本逐块编译 ───────────────────────── */
console.log('\n--- syntax ---');
const blocks = [...after.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let inlineFail = 0;
blocks.forEach((code, n) => {
  try { new Function(code); console.log('inline script #' + (n + 1) + ' (' + code.split('\n').length + ' lines): OK'); }
  catch (e) { console.error('inline script #' + (n + 1) + ': ' + e.message); inlineFail++; }
});
failures += inlineFail;

console.log('\n' + changed + ' applied, ' + skipped + ' skipped, ' + failures + ' failed.');
process.exit(failures ? 1 : 0);
