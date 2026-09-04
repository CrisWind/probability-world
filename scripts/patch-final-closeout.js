/* Final close-out (freeze) fixes for probability-world demo.
 * 1) #life-task-panel markup+CSS 补齐并统一目标行刷新（任务优先→场景目标→地图兜底）
 * 2) 从造船厂/咖啡馆出口返回街道的落点修正（shipyard→436 / cafe→980）
 * 3) setTopbar 剥离「目标：」前缀，避免「当前目标：目标：…」双前缀
 * 4) 任务定义用户文本去英文 campaign；两处误导性按钮文案改「关闭面板」
 * 5) task-ui 不再移除 #life-task-panel；相关 cache-buster 升级
 * Idempotent：第二次运行全部 SKIP。*/
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');
/* 读取时把 CRLF 归一成 LF 便于锚点匹配；写回时按原文件换行风格还原（内容统一以 LF 计量）。 */
const EOL = {};
function readAny(rel) {
  const raw = fs.readFileSync(path.join(BASE, rel), 'utf8');
  EOL[rel] = raw.includes('\r\n');
  return EOL[rel] ? raw.replace(/\r\n/g, '\n') : raw;
}
function writeAny(rel, text) {
  const out = EOL[rel] ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(path.join(BASE, rel), out, 'utf8');
  console.log('WRITE', rel, '(' + text.length + ' chars, ' + (EOL[rel] ? 'CRLF' : 'LF') + ')');
}
function syntaxCheck(rel) {
  const full = path.join(BASE, rel);
  try {
    execSync('node -c "' + full + '"', { stdio: 'pipe' });
    console.log('SYNTAX OK:', rel);
    return true;
  } catch (e) {
    console.error('SYNTAX FAIL:', rel, e.stderr ? e.stderr.toString().slice(0, 800) : e.message);
    return false;
  }
}

/* 通用幂等操作：marker 已存在→SKIP；old 存在→APPLY；两者皆无→FAIL */
function makeOp(name, old, next, marker) {
  return function (content) {
    if (content.indexOf(marker) !== -1) {
      console.log('SKIP', name, '(marker already present)');
      return content;
    }
    const idx = content.indexOf(old);
    if (idx === -1) {
      console.error('FAIL', name, '(old anchor not found)');
      return null;
    }
    console.log('APPLY', name);
    return content.slice(0, idx) + next + content.slice(idx + old.length);
  };
}

/* ───────────────────────── index.html ───────────────────────── */
const HTML = 'index.html';
let html = readAny(HTML);
let failed = false;

/* A1: markup —— 在任务按钮后补上目标行元素 */
const a1 = makeOp(
  'html: markup #life-task-panel',
  '    <button id="life-task-button" title="查看当前目标" aria-label="查看当前目标">✎</button>',
  '    <button id="life-task-button" title="查看当前目标" aria-label="查看当前目标">✎</button>\n    <span id="life-task-panel" title="当前目标"></span>',
  '<span id="life-task-panel"'
);
/* A2: CSS —— 在任务按钮规则后追加目标行样式 */
const cssOld = '    #life-task-button{position:absolute;left:6px;top:96px;transform:none;z-index:29;width:44px;height:44px;border:1px solid #3E2A1B;background:#C89B3C;color:#211B17;font:20px NotoPixelCN,sans-serif;box-shadow:2px 2px 0 #14100C;pointer-events:auto;cursor:pointer}@media(max-width:600px){#life-task-button{left:6px;top:96px}}';
const cssNext = cssOld + '\n    #life-task-panel{position:absolute;left:6px;top:144px;z-index:29;max-width:248px;padding:6px 10px;background:#E8D7B0;border:1px solid #3E2A1B;box-shadow:2px 2px 0 #14100C;color:#211B17;font:12px/1.55 NotoPixelCN,sans-serif;pointer-events:none}@media(max-width:600px){#life-task-panel{left:6px;top:144px;max-width:calc(100vw - 100px)}}';
const a2 = makeOp('html: CSS #life-task-panel', cssOld, cssNext, '#life-task-panel{position:absolute;left:6px;top:144px');

/* A3: 顶层 helper（任务优先目标文本 + 统一刷新）插到 class PixelHarborScene 之前 */
const helpers = `    /* ── HUD 目标行统一刷新（任务引导）：进行中任务优先，其次场景目标，最后按所在地图兜底。 ── */
    function questGoalText(){
      var qr=window.QuestRuntime,store=window.__gameStore;
      if(!qr||typeof qr.getQuestInstance!=='function'||!store||typeof store.get!=='function')return null;
      var quests=store.get('quests',{})||{};
      var instances=quests.instances||{};
      var pick=function(id){
        if(!id||!instances[id])return null;
        var inst=qr.getQuestInstance(id),def=qr.getQuestDefinition(id);
        if(!inst||!def)return null;
        if(inst.status==='ready_to_claim')return '任务目标已完成：去任务簿（✎）领取奖励';
        if(inst.status!=='active')return null;
        var steps=Array.isArray(def.steps)?def.steps:[],step=null;
        for(var i=0;i<steps.length;i++){if(steps[i].id===inst.currentStepId)step=steps[i]}
        return (step&&step.text)||def.summary||def.title||null;
      };
      var text=quests.trackedQuestId?pick(quests.trackedQuestId):null;
      if(text)return text;
      for(var id in instances){text=pick(id);if(text)return text}
      return null;
    }
    function refreshTaskGoal(sceneGoal){
      var el=document.getElementById('life-task-panel');
      if(!el)return;
      var text=questGoalText();
      if(!text){
        var scene=window.pixelHarborScene;
        if(typeof sceneGoal!=='string')sceneGoal=scene&&scene._sceneGoal?scene._sceneGoal:'';
        sceneGoal=String(sceneGoal||'').replace(/^目标：/,'');
        var mapId=(window.HarborLife&&window.HarborLife.state&&window.HarborLife.state.player)?window.HarborLife.state.player.mapId:'';
        var fallback=mapId==='interior'?'去承保桌，开始今天的接单':mapId==='shipyard'?'质检曙光号':mapId==='street'?'进入承保咖啡馆':'继续探索港口';
        text=sceneGoal||fallback;
      }
      var label='当前目标：'+text;
      if(el.textContent!==label)el.textContent=label;
    }
`;
const a3 = makeOp(
  'html: goal-line helpers',
  '    class PixelHarborScene extends Phaser.Scene{',
  helpers + '    class PixelHarborScene extends Phaser.Scene{',
  'function refreshTaskGoal('
);

/* A4: setStreetScene 签名 + 落点变量 */
const a4 = makeOp(
  'html: setStreetScene landX param',
  '      setStreetScene(initial=false){\n        this.location=\'street\';',
  '      setStreetScene(initial=false,landX){\n        const lx=(typeof landX===\'number\')?landX:(initial?610:980);\n        this.location=\'street\';',
  'setStreetScene(initial=false,landX){'
);
/* A5: 出生点使用 lx */
const a5 = makeOp(
  'html: street spawn uses lx',
  'this.player.setPosition(initial?610:980,initial?174:174);',
  'this.player.setPosition(lx,174);',
  'this.player.setPosition(lx,174);'
);
/* A6: 街景 topbar 文案按落点区分 */
const a6 = makeOp(
  'html: street topbar per landing',
  "this.setTopbar('承保咖啡馆前 · 港口街道','目标：进入承保咖啡馆');this.updateWorldSigns()",
  "this.setTopbar(initial?'承保咖啡馆前 · 港口街道':'造船厂门前 · 港口街道',initial?'目标：进入承保咖啡馆':(lx<600?'继续探索港口，或回到造船厂':'目标：进入承保咖啡馆'));this.updateWorldSigns()",
  '造船厂门前 · 港口街道'
);
/* A7: setTopbar —— 存场景目标 + 统一刷新（剥离「目标：」前缀，不再直接写 DOM） */
const a7old = 'setTopbar(place,goal){const task=document.getElementById(\'life-task-panel\');if(task)task.textContent=`当前目标：${goal||\'继续探索港口\'}`}';
const a7 = makeOp(
  'html: setTopbar delegates to refreshTaskGoal',
  a7old,
  'setTopbar(place,goal){this._scenePlace=place||\'\';this._sceneGoal=String(goal||\'\').replace(/^目标：/,\'\');refreshTaskGoal()}',
  '_scenePlace=place||\'\''
);
/* A8: exitCafe —— 按当前室内落点传 landX */
const a8old = 'exitCafe(){this.transitioning=true;this.isMoving=false;this.target=null;this.pending=null;this.route=[];this.doorReady=null;marketGuide.classList.remove(\'show\');this.clearDialogue();this.cameras.main.fadeOut(180,0,0,0);this.time.delayedCall(200,()=>{this.setStreetScene(false);this.cameras.main.fadeIn(180);this.transitioning=false})}';
const a8 = makeOp(
  'html: exitCafe landing x',
  a8old,
  'exitCafe(){this.transitioning=true;this.isMoving=false;this.target=null;this.pending=null;this.route=[];this.doorReady=null;marketGuide.classList.remove(\'show\');const landX=this.location===\'shipyard\'?436:980;this.clearDialogue();this.cameras.main.fadeOut(180,0,0,0);this.time.delayedCall(200,()=>{this.setStreetScene(false,landX);this.cameras.main.fadeIn(180);this.transitioning=false})}',
  'const landX=this.location===\'shipyard\'?436:980'
);
/* A9: HarborLife.render 去掉本地 task 变量 */
const a9 = makeOp(
  'html: render drops local task var',
  ",task=document.getElementById('life-task-panel'),weather=document.getElementById('life-weather')",
  ',weather=document.getElementById(\'life-weather\')',
  'const coins=document.getElementById(\'life-coins\'),period=document.getElementById(\'life-period\'),weather=document.getElementById(\'life-weather\');'
);
/* A10: HarborLife.render 目标行写入改走统一刷新 */
const a10old = 'if(task)task.textContent=`当前目标：${state.player.mapId===\'interior\'?\'去承保桌，开始今天的接单\':state.player.mapId===\'shipyard\'?\'质检曙光号\':\'进入承保咖啡馆\'}`;';
const a10 = makeOp(
  'html: render delegates goal line',
  a10old,
  'refreshTaskGoal();',
  '        refreshTaskGoal();'
);
/* A11: store 变化时自动刷新目标行 */
const a11 = makeOp(
  'html: store-subscribe goal refresh',
  '    const baseCreateLife=PixelHarborScene.prototype.create;',
  '    if(window.__gameStore?.subscribe){window.__gameStore.subscribe(function(){refreshTaskGoal()})}\n    const baseCreateLife=PixelHarborScene.prototype.create;',
  'window.__gameStore.subscribe(function(){refreshTaskGoal()})'
);

const htmlOps = [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11];
htmlOps.forEach((op) => {
  if (failed) return;
  html = op(html);
  if (html === null) failed = true;
});
if (!failed) writeAny(HTML, html);

/* ───────────────────── quest-definitions.js ───────────────────── */
const QD = 'quest-definitions.js';
if (!failed) {
  let qd = readAny(QD);
  const qdOp = makeOp(
    'quest text: campaign → 中文',
    "text:'完成一次完整的船队风险 campaign。'",
    "text:'完整跑完一季商会船队风险盘（第 1 至 5 回合）。'",
    '完整跑完一季商会船队风险盘'
  );
  qd = qdOp(qd);
  if (qd === null) failed = true;
  else writeAny(QD, qd);
}

/* ──────────────────────── task-ui.js ──────────────────────── */
const TU = 'task-ui.js';
if (!failed) {
  let tu = readAny(TU);
  const tuOp = makeOp(
    'task-ui: keep #life-task-panel',
    "  var button = document.getElementById('life-task-button');\n  var oldPanel = document.getElementById('life-task-panel');\n  if (!button) return;\n  if (oldPanel) oldPanel.remove();",
    "  var button = document.getElementById('life-task-button');\n  /* #life-task-panel 目标行由 index.html 的 refreshTaskGoal 驱动，任务簿不删除它。 */\n  if (!button) return;",
    '任务簿不删除它'
  );
  tu = tuOp(tu);
  if (tu === null) failed = true;
  else writeAny(TU, tu);
}

/* ─────────────────────── shipyard-ui.js ─────────────────────── */
const SY = 'shipyard-ui.js';
if (!failed) {
  let sy = readAny(SY);
  const syOp = makeOp(
    'shipyard-ui: close label 关闭面板',
    "btn('close', '返回街道', { secondary: true })",
    "btn('close', '关闭面板', { secondary: true })",
    "btn('close', '关闭面板', { secondary: true })"
  );
  sy = syOp(sy);
  if (sy === null) failed = true;
  else writeAny(SY, sy);
}

/* ──────────────────────── fleet-ui.js ──────────────────────── */
const FU = 'fleet-ui.js';
if (!failed) {
  let fu = readAny(FU);
  const fuOp = makeOp(
    'fleet-ui: close label 关闭面板',
    'data-action="return-harbor">返回港口</button>',
    'data-action="return-harbor">关闭面板</button>',
    'data-action="return-harbor">关闭面板</button>'
  );
  fu = fuOp(fu);
  if (fu === null) failed = true;
  else writeAny(FU, fu);
}

/* ─────────────────── cache-busters in index.html ─────────────────── */
if (!failed) {
  const busters = [
    ['./quest-definitions.js?v=20260902-1', './quest-definitions.js?v=20260904-2'],
    ['./task-ui.js?v=20260902-1', './task-ui.js?v=20260904-2'],
    ['./shipyard-ui.js?v=20260904-1', './shipyard-ui.js?v=20260904-2'],
    ['./fleet-ui.js?v=20260904-1', './fleet-ui.js?v=20260904-2']
  ];
  busters.forEach(([oldV, newV]) => {
    if (failed) return;
    if (html.indexOf(newV) !== -1) {
      console.log('SKIP cache-buster', newV);
    } else if (html.indexOf(oldV) !== -1) {
      html = html.split(oldV).join(newV);
      console.log('APPLY cache-buster', newV);
    } else {
      console.error('FAIL cache-buster (anchor missing):', oldV);
      failed = true;
    }
  });
  if (!failed) writeAny(HTML, html);
}

if (failed) {
  console.error('PATCH FAILED — no further output.');
  process.exit(1);
}

/* ── 验证：JS 文件语法 + index.html 内联脚本抽检 ── */
let allOk = true;
[QD, TU, SY, FU].forEach((rel) => { if (!syntaxCheck(rel)) allOk = false; });

/* 抽取 index.html 内所有无 src 的 <script> 内容分别做语法检查 */
const scripts = [];
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html)) !== null) {
  const body = m[1].replace(/^\s*\n/, '');
  if (body.trim()) scripts.push(body);
}
scripts.forEach((body, i) => {
  const tmp = path.join(BASE, 'scripts', '.tmp-inline-check-' + i + '.js');
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    execSync('node -c "' + tmp + '"', { stdio: 'pipe' });
    console.log('SYNTAX OK: index.html inline script #' + i + ' (' + body.length + ' chars)');
  } catch (e) {
    allOk = false;
    console.error('SYNTAX FAIL: index.html inline script #' + i, e.stderr ? e.stderr.toString().slice(0, 800) : e.message);
  } finally {
    fs.unlinkSync(tmp);
  }
});

console.log(allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(allOk ? 0 : 1);
