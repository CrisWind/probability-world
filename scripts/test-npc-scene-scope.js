/* NPC 场景污染修复回归测试。
 * 装载真实 unposted-ship-news.js（间接 eval 到全局），验证：
 * lloyd/xiaolei 的钉死逻辑只在承保咖啡馆室内生效；其他场景（街道/未来室内）不覆盖。
 * 判定依据：location==='interior' && map.texture.key==='cafe-interior'。 */
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

function freshGlobals() {
  const saveCalls = { n: 0 };
  const npcStates = {
    lloyd: { mapId: 'street', targetMapId: 'street', x: 500, y: 100, targetX: 500, targetY: 100, route: [], routeIndex: 0, facing: 'right' },
    xiaolei: { mapId: 'street', targetMapId: 'street', x: 400, y: 90, targetX: 400, targetY: 90, route: [], routeIndex: 0, facing: 'right' },
  };
  global.window = global;
  global.document = {
    getElementById: id => ({ id, classList: { add() {}, remove() {}, contains: () => false, toggle() {} } }),
    createElement: () => ({ textContent: '' }),
    head: { append() {} },
  };
  global.HarborLife = {
    state: { npcStates, worldFlags: {} },
    updateNpcSchedule(s, retarget) {},      // 框架基版（测试中为空操作）
    updateNpcs(s, delta) {},
    syncScene() {},
    save() { saveCalls.n++; },
  };
  global.PixelHarborScene = class PixelHarborScene {};
  PixelHarborScene.prototype.enterCafe = function () {};
  PixelHarborScene.prototype.setInteriorScene = function () { this.location = 'interior'; };
  return { saveCalls, npcStates };
}

function mkScene(location, textureKey) {
  const visibleLog = [];
  const lloydSprite = {
    setVisible(v) { visibleLog.push(['lloyd', v]); return this; },
    setPosition(x, y) { visibleLog.push(['pos', x, y]); return this; },
    setDepth() { return this; },
  };
  return {
    location,
    map: { texture: { key: textureKey } },
    npcSpriteRefs: { lloyd: lloydSprite },
    lifeNpcSprites: { lloyd: { setVisible(v) { visibleLog.push(['street-lloyd', v]); } } },
    interactables: [
      { key: 'lloyd', x: 0, y: 0, approach: { x: 0, y: 0 }, reach: 0, interactionRadius: 0, enabled: false },
      { key: 'xiaolei', x: 0, y: 0, approach: { x: 0, y: 0 }, reach: 0, interactionRadius: 0, enabled: false },
    ],
    _visibleLog: visibleLog,
  };
}

/* 装载模块（间接 eval：绑定常驻全局，闭包可用） */
function bootModule() {
  const src = fs.readFileSync(path.join(ROOT, 'unposted-ship-news.js'), 'utf8');
  (0, eval)(src);
}

const g = freshGlobals();
bootModule();

const cafe = mkScene('interior', 'cafe-interior');       // 承保咖啡馆
const street = mkScene('street', 'map0');                // 港口街道
const shipyard = mkScene('interior', 'shipyard-floor');  // 模拟未来室内场景

/* ---------- updateNpcSchedule：场景门 ---------- */
{
  const st = g.npcStates.lloyd;
  st.mapId = 'street'; st.x = 500; st.targetMapId = 'street';
  HarborLife.updateNpcSchedule(cafe, false);
  check('T1 咖啡馆: lloyd 被钉回 interior@120,172', st.mapId === 'interior' && st.x === 120 && st.targetX === 120, JSON.stringify(st));

  st.mapId = 'interior'; st.x = 333; st.targetMapId = 'street';
  HarborLife.updateNpcSchedule(street, false);
  check('T2 街道: 不覆盖 lloyd 状态', st.mapId === 'interior' && st.x === 333, JSON.stringify(st));

  st.mapId = 'street'; st.x = 444;
  HarborLife.updateNpcSchedule(shipyard, false);
  check('T3 未来室内: 不覆盖 lloyd 状态', st.mapId === 'street' && st.x === 444, JSON.stringify(st));

  HarborLife.updateNpcSchedule(undefined, false);
  check('T4 无场景引用: 不抛错', true);
}

/* ---------- updateNpcs：场景门 ---------- */
{
  const st = g.npcStates.lloyd;
  st.mapId = 'street'; st.x = 600; st.targetMapId = 'street';
  window.pixelHarborScene = cafe;
  HarborLife.updateNpcs(cafe, 16);
  check('T5 咖啡馆: lloyd 钉 interior@120,172 且精灵可见', st.mapId === 'interior' && st.x === 120 && cafe._visibleLog.some(x => x[0] === 'lloyd' && x[1] === true), JSON.stringify({ st, log: cafe._visibleLog }));

  st.mapId = 'interior'; st.x = 777; st.targetMapId = 'interior';
  window.pixelHarborScene = street;
  cafe._visibleLog.length = 0;
  HarborLife.updateNpcs(street, 16);
  check('T6 街道: lloyd 状态不被改写、不显示咖啡馆精灵', st.mapId === 'interior' && st.x === 777 && !street._visibleLog.some(x => x[0] === 'lloyd' && x[1] === true), JSON.stringify(st));

  st.mapId = 'street'; st.x = 888;
  window.pixelHarborScene = shipyard;
  shipyard._visibleLog.length = 0;
  HarborLife.updateNpcs(shipyard, 16);
  check('T7 未来室内: lloyd 状态不被改写、不显示咖啡馆精灵', st.mapId === 'street' && st.x === 888 && shipyard._visibleLog.length === 0, JSON.stringify(st));
}

/* ---------- setInteriorScene 末层包装（lloyd 钉死 + exitSafety） ---------- */
{
  const setter = PixelHarborScene.prototype.setInteriorScene;
  // 咖啡馆场景
  const cafeSelf = Object.assign(cafe, { npcStates: g.npcStates });
  window.pixelHarborScene = cafeSelf;
  g.npcStates.lloyd.mapId = 'street'; g.npcStates.lloyd.x = 900;
  g.npcStates.xiaolei.mapId = 'street'; g.npcStates.xiaolei.x = 700;
  const savesBefore = g.saveCalls.n;
  setter.call(cafeSelf);
  check('T8 咖啡馆进场: lloyd 钉 interior@120,172', g.npcStates.lloyd.mapId === 'interior' && g.npcStates.lloyd.x === 120, JSON.stringify(g.npcStates.lloyd));
  check('T9 咖啡馆进场: xiaolei 钉 interior@190,120', g.npcStates.xiaolei.mapId === 'interior' && g.npcStates.xiaolei.x === 190, JSON.stringify(g.npcStates.xiaolei));
  check('T10 咖啡馆进场: 触发存档', g.saveCalls.n > savesBefore);
  // 未来室内场景
  const yardSelf = Object.assign(mkScene('interior', 'yard-map'), { npcStates: g.npcStates });
  window.pixelHarborScene = yardSelf;
  g.npcStates.lloyd.mapId = 'street'; g.npcStates.lloyd.x = 950;
  g.npcStates.xiaolei.mapId = 'street'; g.npcStates.xiaolei.x = 750;
  const savesBefore2 = g.saveCalls.n;
  setter.call(yardSelf);
  check('T11 未来室内进场: lloyd 不被钉死', g.npcStates.lloyd.mapId === 'street' && g.npcStates.lloyd.x === 950, JSON.stringify(g.npcStates.lloyd));
  check('T12 未来室内进场: xiaolei 不被钉死', g.npcStates.xiaolei.mapId === 'street' && g.npcStates.xiaolei.x === 750, JSON.stringify(g.npcStates.xiaolei));
  check('T13 未来室内进场: 不触发存档', g.saveCalls.n === savesBefore2, 'saves=' + g.saveCalls.n);
}

console.log(failures.length ? `\n${failures.length} 项失败: ${failures.join(' | ')}` : '\n全部通过 ✅');
process.exit(failures.length ? 1 : 0);
