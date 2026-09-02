/* HarborLife NPC 日程"场景维度"回归测试。
 * 切片 index.html 中真实 HarborLife 代码（Node 桩环境），验证：
 * - NPC 状态/日程的 mapId 只在与当前场景精确匹配时才生效（移动/可见/交互点）；
 * - street=港口街道、interior=承保咖啡馆室内（sceneId/texture 双信号）；
 * - 模拟未来室内场景（shipyard）不继承咖啡馆坐标，也不泄漏 cafe 坐标进自身场景；
 * - generic 匹配分支（mapId===location）供未来场景自注册 NPC。 */
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
  global.document = { getElementById: () => null }; // toast/render 空引用安全
  return store;
}
function bootStore() {
  eval(fs.readFileSync(path.join(ROOT, 'game-store.js'), 'utf8'));
  return global.window.__gameStore;
}
function sliceHarborLife() {
  const raw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const html = raw.replace(/\r\n/g, '\n');
  const startIdx = html.indexOf('const HarborLife=(()=>{');
  const loadAnchor = html.indexOf('\n    HarborLife.load();', startIdx);
  const closeIdx = html.lastIndexOf('\n    })();', loadAnchor);
  if (startIdx < 0 || loadAnchor < 0 || closeIdx < 0) throw new Error('切片锚点异常');
  return html.slice(startIdx, closeIdx + '\n    })();'.length).replace('const HarborLife=', 'globalThis.HarborLife=');
}
function bootHarborLife() {
  (0, eval)(sliceHarborLife()); // 间接 eval：全局作用域，闭包常驻
  globalThis.HarborLife.load();
  return globalThis.HarborLife;
}
/* 纯函数单测：直接切片两个场景匹配助手（无闭包依赖） */
function bootMatchers() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const a = html.indexOf('function isCafeInteriorScene(');
  const b = html.indexOf('\n', html.indexOf('function npcMapMatches(')) + 1;
  (0, eval)(html.slice(a, b));
  return { isCafe: globalThis.isCafeInteriorScene, match: globalThis.npcMapMatches };
}

/* ---------- 场景桩 ---------- */
function spriteSpy() {
  const log = [];
  return {
    setVisible(v) { log.push(['visible', v]); return this; },
    setPosition(x, y) { log.push(['pos', x, y]); return this; },
    setDepth() { return this; },
    log,
  };
}
function mkTask(key) {
  return { key, x: 0, y: 0, approach: { x: 0, y: 0 }, reach: 32, interactionRadius: 32, enabled: true };
}
function mkScene({ location, sceneId, texture, streetRefs, ownRefs }) {
  const s = {
    location,
    sceneId,
    map: { texture: { key: texture } },
    npcSpriteRefs: ownRefs ? { lloyd: spriteSpy(), xiaolei: spriteSpy() } : null,
    lifeNpcSprites: streetRefs ? { lloyd: spriteSpy(), xiaolei: spriteSpy() } : null,
    interactables: [mkTask('lloyd'), mkTask('xiaolei')],
    gridPath() { return []; },
    isBlocked() { return false; },
  };
  return s;
}

freshEnv();
bootStore();
const H = bootHarborLife();

const street = mkScene({ location: 'street', sceneId: 'street', texture: 'map0', streetRefs: true });
const cafe = mkScene({ location: 'interior', sceneId: 'castle_cafe', texture: 'cafe-interior', ownRefs: true });
const shipyard = mkScene({ location: 'interior', sceneId: 'shipyard', texture: 'shipyard-floor', ownRefs: true });
const shipyardNoId = mkScene({ location: 'interior', sceneId: null, texture: 'shipyard-floor-2', ownRefs: true }); // 无 sceneId 的旧式未来室内
const yardLoc = mkScene({ location: 'shipyard', sceneId: 'shipyard', texture: 'shipyard-floor', ownRefs: true }); // 独立 location 的未来场景

/* 按时段把 NPC 状态重置到日程目标（与真实状态机一致），再测场景门 */
function resetNpcs(period) {
  H.state.time.period = period;
  const pos = {
    morning: { lloyd: ['interior', 120, 172], xiaolei: ['interior', 190, 135] },
    afternoon: { lloyd: ['street', 790, 145], xiaolei: ['street', 678, 160] },
    dusk: { lloyd: ['street', 920, 176], xiaolei: ['street', 1000, 182] },
    night: { lloyd: ['interior', 120, 172], xiaolei: ['interior', 190, 135] },
  }[period];
  for (const id of ['lloyd', 'xiaolei']) {
    const [mapId, x, y] = pos[id];
    const st = H.state.npcStates[id];
    st.mapId = mapId; st.targetMapId = mapId; st.x = x; st.y = y; st.targetX = x; st.targetY = y;
    st.route = []; st.routeIndex = 0;
  }
}

/* ---------- M. 匹配助手纯函数单测 ---------- */
{
  const M = bootMatchers();
  const cafeLike = { location: 'interior', sceneId: 'castle_cafe', map: { texture: { key: 'cafe-interior' } } };
  const cafeByTexture = { location: 'interior', map: { texture: { key: 'cafe-interior' } } }; // sceneId 缺失→底图兜底
  const shipyardLike = { location: 'interior', sceneId: 'shipyard', map: { texture: { key: 'shipyard-floor' } } };
  const streetLike = { location: 'street' };
  check('M1 isCafe: sceneId=castle_cafe 判定承保咖啡馆', M.isCafe(cafeLike) === true);
  check('M2 isCafe: 底图 cafe-interior 兜底判定', M.isCafe(cafeByTexture) === true);
  check('M3 isCafe: 未来室内(shipyard)非咖啡馆', M.isCafe(shipyardLike) === false);
  check('M4 match: interior 状态只匹配承保咖啡馆', M.match('interior', cafeLike) === true && M.match('interior', shipyardLike) === false && M.match('interior', streetLike) === false);
  check('M5 match: street 状态只匹配街道', M.match('street', streetLike) === true && M.match('street', cafeLike) === false);
  check('M6 match: generic mapId===location（未来场景自注册 NPC）', M.match('shipyard', { location: 'shipyard' }) === true && M.match('shipyard', cafeLike) === false);
  check('M7 match: 无场景对象/空值安全', M.match('interior', null) === false && M.match('interior', undefined) === false);
}

/* ---------- 1. 街道·上午：日程属咖啡馆，街道不应出现 ---------- */
{
  resetNpcs('morning');
  const ll = H.state.npcStates.lloyd;
  street.lifeNpcSprites.lloyd.log.length = 0;
  H.updateNpcSchedule(street, false);
  check('S1 街道·上午: lloyd 交互点禁用(-999)', street.interactables[0].x === -999, JSON.stringify(street.interactables[0]));
  check('S2 街道·上午: 街道精灵不显示', !street.lifeNpcSprites.lloyd.log.some(x => x[0] === 'visible' && x[1] === true));
  H.updateNpcs(street, 16);
  const llAfter = H.state.npcStates.lloyd; // 重建后对象，勿用旧引用
  check('S3 街道·上午: 状态不被移动（保持在咖啡馆时段目标）', llAfter.x === 120 && llAfter.y === 172, JSON.stringify({ x: llAfter.x, y: llAfter.y }));
}

/* ---------- 2. 街道·下午：按原始日程出现（teleport→walk→可见→交互） ---------- */
{
  resetNpcs('morning'); // 从上午跨到下午，验证 retarget 迁移
  H.state.time.period = 'afternoon';
  street.lifeNpcSprites.lloyd.log.length = 0;
  H.updateNpcSchedule(street, true);
  const ll = H.state.npcStates.lloyd;
  check('S4 街道·下午: lloyd 迁到街道并走向 (790,145)', ll.mapId === 'street' && ll.x >= 756 && ll.targetX === 790, JSON.stringify(ll));
  check('S5 街道·下午: 街道精灵可见', street.lifeNpcSprites.lloyd.log.some(x => x[0] === 'visible' && x[1] === true));
  check('S6 街道·下午: 交互点跟随 lloyd', street.interactables[0].x === ll.x && street.interactables[0].y === ll.y, JSON.stringify(street.interactables[0]));
  H.updateNpcs(street, 16);
  check('S7 街道·下午: updateNpcs 沿路径推进', ll.x > 756, 'x=' + ll.x);
}

/* ---------- 3. 承保咖啡馆·上午：精灵可见、交互点在场 ---------- */
{
  resetNpcs('morning');
  H.updateNpcSchedule(cafe, false);
  const ll = H.state.npcStates.lloyd, xl = H.state.npcStates.xiaolei;
  check('S8 咖啡馆·上午: lloyd 目标 (120,172)', ll.targetX === 120 && ll.targetY === 172 && ll.mapId === 'interior', JSON.stringify(ll));
  check('S9 咖啡馆·上午: 咖啡馆精灵可见', cafe.npcSpriteRefs.lloyd.log.some(x => x[0] === 'visible' && x[1] === true));
  check('S10 咖啡馆·上午: lloyd 交互点在场', cafe.interactables[0].x === ll.x && cafe.interactables[0].x !== -999, JSON.stringify(cafe.interactables[0]));
  check('S11 咖啡馆·上午: xiaolei 交互点在场', cafe.interactables[1].x === xl.x, JSON.stringify(cafe.interactables[1]));
  cafe.npcSpriteRefs.lloyd.log.length = 0;
  H.updateNpcs(cafe, 16);
  check('S12 咖啡馆·上午: updateNpcs 定位 lloyd 精灵', cafe.npcSpriteRefs.lloyd.log.some(x => x[0] === 'pos'));
}

/* ---------- 4. 模拟未来室内 shipyard（location interior + sceneId shipyard）：不继承咖啡馆 NPC ---------- */
{
  resetNpcs('morning'); // lloyd/xiaolei 日程此刻属于咖啡馆
  shipyard.npcSpriteRefs.lloyd.log.length = 0;
  shipyard.interactables[0].x = 50; shipyard.interactables[0].y = 60;
  H.updateNpcSchedule(shipyard, false);
  check('Y1 shipyard: 不套用咖啡馆精灵可见性', !shipyard.npcSpriteRefs.lloyd.log.some(x => x[0] === 'visible' && x[1] === true), JSON.stringify(shipyard.npcSpriteRefs.lloyd.log));
  check('Y2 shipyard: lloyd 交互点被禁用而非咖啡馆坐标', shipyard.interactables[0].x === -999, JSON.stringify(shipyard.interactables[0]));
  H.updateNpcs(shipyard, 16);
  const llAfter = H.state.npcStates.lloyd;
  check('Y3 shipyard: 不移动 lloyd 到咖啡馆坐标', llAfter.x === 120 && llAfter.y === 172, JSON.stringify({ x: llAfter.x, y: llAfter.y }));
  check('Y4 shipyard: 精灵不被定位/显示', !shipyard.npcSpriteRefs.lloyd.log.some(x => x[0] === 'pos') && !shipyard.npcSpriteRefs.lloyd.log.some(x => x[0] === 'visible' && x[1] === true), JSON.stringify(shipyard.npcSpriteRefs.lloyd.log));
  check('Y5 shipyard: xiaolei 同样被隔离', shipyard.interactables[1].x === -999);
}

/* ---------- 5. 无 sceneId 的未来室内（仅底图不同）：同样隔离 ---------- */
{
  resetNpcs('morning');
  H.updateNpcSchedule(shipyardNoId, false);
  check('Z1 无 sceneId 室内: lloyd 交互点禁用', shipyardNoId.interactables[0].x === -999, JSON.stringify(shipyardNoId.interactables[0]));
  H.updateNpcs(shipyardNoId, 16);
  check('Z2 无 sceneId 室内: 精灵不被显示/定位', !shipyardNoId.npcSpriteRefs.lloyd.log.some(x => x[0] === 'visible' && x[1] === true) && !shipyardNoId.npcSpriteRefs.lloyd.log.some(x => x[0] === 'pos'));
}

/* ---------- 6. 独立 location 的未来场景 + 场景漏网 mapId 隔离 ---------- */
{
  // 6a: lloyd 状态残留为未知 mapId('shipyard')，日程目标=咖啡馆(interior)——不得把 cafe 坐标泄漏进 shipyard 场景
  resetNpcs('morning');
  const stray = H.state.npcStates.lloyd;
  stray.mapId = 'shipyard'; stray.x = 100; stray.y = 50; // 残留错误归属
  yardLoc.npcSpriteRefs.lloyd.log.length = 0;
  H.updateNpcSchedule(yardLoc, false);
  H.updateNpcs(yardLoc, 16);
  const llFinal = H.state.npcStates.lloyd;
  check('F1 漏网 mapId: 状态被日程拉回咖啡馆而非停在 shipyard', llFinal.mapId === 'interior', JSON.stringify(llFinal));
  check('F2 漏网 mapId: shipyard 场景内无精灵定位/显示', !yardLoc.npcSpriteRefs.lloyd.log.some(x => x[0] === 'pos') && !yardLoc.npcSpriteRefs.lloyd.log.some(x => x[0] === 'visible' && x[1] === true), JSON.stringify(yardLoc.npcSpriteRefs.lloyd.log));
  check('F3 漏网 mapId: shipyard 交互点禁用(-999)', yardLoc.interactables[0].x === -999, JSON.stringify(yardLoc.interactables[0]));
}

/* ---------- 7. 三场景往返切换：无残留/无漂移 ---------- */
{
  resetNpcs('morning');
  for (let i = 0; i < 3; i++) {
    H.updateNpcSchedule(cafe, false); H.updateNpcs(cafe, 16);
    H.updateNpcSchedule(street, false); H.updateNpcs(street, 16);
    H.updateNpcSchedule(shipyard, false); H.updateNpcs(shipyard, 16);
  }
  const ll = H.state.npcStates.lloyd, xl = H.state.npcStates.xiaolei;
  check('R1 三场景往返×3: 状态结构完好', !!ll && !!xl && Array.isArray(ll.route) && Number.isFinite(ll.x) && Number.isFinite(xl.x));
  check('R2 三场景往返×3: 咖啡馆交互点仍可用', cafe.interactables[0].x === ll.x, JSON.stringify(cafe.interactables[0]));
  check('R3 三场景往返×3: shipyard 交互点仍禁用(其无咖啡馆 NPC)', shipyard.interactables[0].x === -999, JSON.stringify(shipyard.interactables[0]));
}

console.log(failures.length ? `\n${failures.length} 项失败: ${failures.join(' | ')}` : '\n全部通过 ✅');
process.exit(failures.length ? 1 : 0);
