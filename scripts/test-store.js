/* game-store.js 迁移/重置逻辑的 Node 桩测试（本地模拟 localStorage） */
'use strict';
const fs = require('fs');
const path = require('path');

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
  return store;
}

function boot() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'game-store.js'), 'utf8');
  eval(src);
  return global.window.__gameStore;
}

/* ---------- 场景 A：全新玩家（无任何键） ---------- */
{
  const store = freshEnv();
  const gs = boot();
  const s = gs.getState();
  check('A1 全新玩家: 默认金币 120', s.player.coins === 120, JSON.stringify(s.player));
  check('A2 全新玩家: 无 marketProfile', s.player.marketProfile === undefined);
  check('A3 全新玩家: meta.migratedFrom 为空', Array.isArray(s.meta.migratedFrom) && s.meta.migratedFrom.length === 0);
  gs.save();
  check('A4 全新玩家: save 后无残留旧键', !store.has('probability-world-visitedFlags') && !store.has('probability-world-market-profile'));
}

/* ---------- 场景 B：老玩家（主档 + 3 个旧键并存） ---------- */
{
  const store = freshEnv();
  // 主档：HarborLife 已 store-first 的进度（金币 77、时间 夜晚、一些 worldFlags）
  store.set('probability-world-save-v1', JSON.stringify({
    version: 1,
    player: { scene: 'street', position: { x: 630, y: 169 }, coins: 77, actionPoints: 3, attributes: {}, inventory: [{ id: 'coffee', qty: 1 }], quickSlots: ['coffee', null, null, null, null, null], profile: {} },
    world: { location: 'street', time: { period: 'night', elapsed: 1320 }, flags: { talkedTo: ['lloyd'], collectedItems: ['chart'] }, collectedItems: ['chart'] },
    npcs: { states: {} }, dialogue: {}, cards: {}, achievements: { version: 1, instances: {} }, stats: {}, quests: {}, meta: { version: 1, savedAt: '2026-09-01T00:00:00.000Z' }
  }));
  // 旧键：仍在读写分叉期存活的数据（读旧写新造成的"真相在旧键"）
  store.set('probability-world-visitedFlags', JSON.stringify({ lloyd: true, xiaolei: true, marketOpened: true }));
  store.set('probability-world-market-profile', JSON.stringify({ attributes: { sight: 3, calculation: 2, courage: 0, voice: 1 }, badges: { firstPrice: true }, handbook: { survivor: { unlocked: true } }, ledger: [{ ship: '晨潮号', profit: 12, quote: 18, accident: false }], games: 2, qualityEvents: [] }));
  store.set('probability-world-rumor-profile-v1', JSON.stringify({ games: 4, handbook: { herd: 'seen', cascade: 'unseen', source: 'unseen', independence: 'unseen', outcome: 'unseen' }, history: [{ seed: 'r1' }], lastSeed: 'r1', rulesSeen: true }));

  const gs = boot();
  let s = gs.getState();
  check('B1 迁移: 主档金币保留 77', s.player.coins === 77, 'got ' + s.player.coins);
  check('B2 迁移: visitedFlags 并入 world.flags', s.world.flags.visitedFlags && s.world.flags.visitedFlags.lloyd === true, JSON.stringify(s.world.flags));
  check('B3 迁移: marketProfile 并入 player.marketProfile', s.player.marketProfile && s.player.marketProfile.attributes.sight === 3, JSON.stringify(s.player.marketProfile));
  check('B4 迁移: marketProfile.ledger 保留', s.player.marketProfile.ledger && s.player.marketProfile.ledger.length === 1);
  check('B5 迁移: rumorProfile 并入 world.rumorProfile', s.world.rumorProfile && s.world.rumorProfile.games === 4, JSON.stringify(s.world.rumorProfile));
  check('B6 迁移: meta.migratedFrom 记录 3 键', s.meta.migratedFrom.length === 3, JSON.stringify(s.meta.migratedFrom));
  check('B7 迁移: 主档 HarborLife 键未被覆盖', s.world.time.period === 'night' && s.player.inventory[0].id === 'coffee');

  gs.save(); // 首次保存：旧键应被删除
  check('B8 保存后: visitedFlags 旧键已删', !store.has('probability-world-visitedFlags'));
  check('B9 保存后: market-profile 旧键已删', !store.has('probability-world-market-profile'));
  check('B10 保存后: rumor-profile 旧键已删', !store.has('probability-world-rumor-profile-v1'));
  check('B11 保存后: 主档仍在且含迁移数据', store.has('probability-world-save-v1') && JSON.parse(store.get('probability-world-save-v1')).player.marketProfile);

  // 模拟刷新：重新 load()
  gs.load();
  s = gs.getState();
  check('B12 刷新后: marketProfile 不丢', s.player.marketProfile && s.player.marketProfile.attributes.sight === 3);
  check('B13 刷新后: rumor games 不丢', s.world.rumorProfile && s.world.rumorProfile.games === 4);
  check('B14 刷新后: visitedFlags 不丢', s.world.flags.visitedFlags && s.world.flags.visitedFlags.xiaolei === true);

  // 未保存就关闭（迁移标记在内存、旧键还在）→ 幂等：再 load 一次结果不变
  gs.load();
  s = gs.getState();
  check('B15 幂等: 未保存重载后数据仍一致', s.player.marketProfile.attributes.sight === 3 && s.player.coins === 77);
}

/* ---------- 场景 C：首启迁移（无主档，只有旧键，含 map-save-v3） ---------- */
{
  const store = freshEnv();
  store.set('probability-world-map-save-v3', JSON.stringify({ version: 3, player: { mapId: 'street', position: { x: 500, y: 160 }, facing: 'down', actionPoints: 4, coins: 88 }, location: 'street', time: { period: 'afternoon', elapsed: 840 } }));
  store.set('probability-world-visitedFlags', JSON.stringify({ clerk: true }));
  const gs = boot();
  const s = gs.getState();
  check('C1 首启: 位置从 map-save-v3 迁出', s.player.position && s.player.position.x === 500, JSON.stringify(s.player.position));
  check('C2 首启: 金币 88 迁出', s.player.coins === 88, 'got ' + s.player.coins);
  check('C3 首启: visitedFlags 迁入', s.world.flags.visitedFlags && s.world.flags.visitedFlags.clerk === true);
  check('C4 首启: migratedFrom 含 map 键', s.meta.migratedFrom.includes('probability-world-map-save-v3'));
  gs.save();
  check('C5 首启: save 后 map 旧键已删', !store.has('probability-world-map-save-v3'));
}

/* ---------- 场景 D：重置必须真正清空（含旧键） ---------- */
{
  const store = freshEnv();
  store.set('probability-world-save-v1', JSON.stringify({ version: 1, player: { scene: 'interior', position: { x: 240, y: 245 }, coins: 500, actionPoints: 0 }, world: { location: 'interior' }, npcs: {}, dialogue: {}, cards: {}, achievements: {}, stats: {}, quests: {}, meta: { version: 1 } }));
  store.set('probability-world-visitedFlags', JSON.stringify({ lloyd: true }));
  store.set('probability-world-market-profile', JSON.stringify({ attributes: { sight: 9 }, badges: {}, handbook: {}, ledger: [], games: 9, qualityEvents: [] }));
  store.set('probability-world-rumor-profile-v1', JSON.stringify({ games: 1, handbook: {}, history: [], lastSeed: null }));

  const gs = boot();
  gs.reset();
  let s = gs.getState();
  check('D1 重置: 主档回默认', s.player.coins === 120 && s.player.scene === 'street', JSON.stringify(s.player));
  check('D2 重置: 旧键全清', !store.has('probability-world-visitedFlags') && !store.has('probability-world-market-profile') && !store.has('probability-world-rumor-profile-v1') && !store.has('probability-world-map-save-v3'));
  gs.load(); // 刷新
  s = gs.getState();
  check('D3 重置后刷新: 不复活', s.player.coins === 120 && s.player.marketProfile === undefined, JSON.stringify(s.player));
}

console.log(failures.length ? `\n${failures.length} 项失败: ${failures.join(' | ')}` : '\n全部通过 ✅');
process.exit(failures.length ? 1 : 0);
