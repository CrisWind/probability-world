/* Probability World - canonical state and save layer
 * 单一事实来源：所有运行时读写只经 __gameStore，localStorage 只碰 probability-world-save-v1。
 * 旧版键（map-save-v3 / visitedFlags / market-profile / rumor-profile-v1）只在一次性迁移时读取，
 * 迁移结果首次成功保存后即被删除；reset() 会连同旧键一起清除，保证“重置=真正清空”。 */
(()=>{
  'use strict';
  const KEY='probability-world-save-v1';
  const CORRUPT='probability-world-save-corrupt';
  const LEGACY_KEYS=[
    'probability-world-map-save-v3',
    'probability-world-visitedFlags',
    'probability-world-market-profile',
    'probability-world-rumor-profile-v1'
  ];
  const VERSION=1;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const defaults=()=>({
    version:VERSION,
    player:{scene:'street',position:{x:630,y:169},coins:120,actionPoints:6,attributes:{sight:0,calculation:0,courage:0,voice:0},inventory:[],quickSlots:[],profile:{nickname:'未命名记录员',avatarId:'avatar_default',equippedTitleId:null,createdAt:null,updatedAt:null}},
    world:{location:'street',time:{period:'morning',elapsed:480},flags:{},collectedItems:[]},
    npcs:{states:{},relations:{},schedule:{}},
    dialogue:{currentNodeId:null,progress:{},seenNodes:[]},
    cards:{seen:{},library:[]},
    achievements:{version:1,instances:{}},
    stats:{version:1,counters:{},flags:{},sets:{}},
    quests:{instances:{},trackedQuestId:null},
    meta:{version:VERSION,savedAt:null,migratedFrom:[],legacyMigratedAt:null}
  });
  const merge=(a,b)=>{
    if(!isObj(b))return a;
    for(const k of Object.keys(b)){
      if(isObj(a[k])&&isObj(b[k]))merge(a[k],b[k]);
      else if(b[k]!==undefined)a[k]=b[k];
    }
    return a;
  };
  const valid=s=>isObj(s)&&Number(s.version)>=1&&isObj(s.player)&&isObj(s.world)&&isObj(s.npcs)&&isObj(s.dialogue)&&isObj(s.cards)&&isObj(s.meta);
  const readKey=k=>{try{const x=localStorage.getItem(k);return x?JSON.parse(x):null}catch(e){return null}};
  /* 一次性迁移：把仍在旧键里的运行时数据并入主档。
   * includeMap 只在完全没有主档的首启时启用，避免 map-save-v3 的陈旧 HarborLife
   * 快照覆盖已经 store-first 的进度（该键自 game-store 上线后已不再读写）。 */
  const applyLegacy=(s,includeMap)=>{
    const found=[];
    if(includeMap){
      const map=readKey('probability-world-map-save-v3');
      if(map){
        merge(s,{player:map.player||{}});
        if(map.location)merge(s,{world:{location:map.location}});
        found.push('probability-world-map-save-v3');
      }
    }
    const flags=readKey('probability-world-visitedFlags');
    if(flags){
      merge(s,{world:{flags:{visitedFlags:flags}}});
      found.push('probability-world-visitedFlags');
    }
    const profile=readKey('probability-world-market-profile');
    if(profile){
      merge(s,{player:{marketProfile:profile,attributes:profile.attributes||{}}});
      if(Number.isFinite(profile.capital)||Number.isFinite(profile.coins)){
        merge(s,{player:{coins:profile.capital??profile.coins}});
      }
      found.push('probability-world-market-profile');
    }
    const rumor=readKey('probability-world-rumor-profile-v1');
    if(rumor){
      merge(s,{world:{rumorProfile:rumor}});
      found.push('probability-world-rumor-profile-v1');
    }
    return found;
  };
  const migrations={};
  const migrate=raw=>{
    let s=merge(defaults(),raw||{}),v=Number(raw?.version)||0;
    while(v<VERSION){const fn=migrations[v];if(fn)s=fn(s);v++}
    s.version=VERSION;
    s.meta.version=VERSION;
    if(!Array.isArray(s.meta.migratedFrom))s.meta.migratedFrom=[];
    return s;
  };
  let state,timer=null;
  const listeners=new Set();
  const notify=()=>listeners.forEach(fn=>{try{fn(clone(state))}catch(e){console.error('[GameStore] subscriber',e)}});
  const parts=p=>Array.isArray(p)?p:String(p).split('.').filter(Boolean);
  const get=(p,fallback)=>{let v=state;for(const k of parts(p)){if(v==null)return fallback;v=v[k]}return v===undefined?fallback:v};
  const set=(p,value)=>{
    const ps=parts(p);
    if(!ps.length)return state;
    let o=state;
    ps.slice(0,-1).forEach(k=>{if(!isObj(o[k]))o[k]={};o=o[k]});
    o[ps.at(-1)]=value;
    notify();
    return state;
  };
  const setState=partial=>{merge(state,partial);notify();return state};
  const save=()=>{
    state.meta.savedAt=new Date().toISOString();
    try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){console.error('[GameStore] save failed',e);return false}
    /* 迁移结果已落盘，旧键使命完成：删除并留下审计标记（内存态，随下次 save 持久化）。 */
    if(state.meta.migratedFrom&&state.meta.migratedFrom.length){
      const done=state.meta.migratedFrom.slice();
      state.meta.migratedFrom=[];
      state.meta.legacyMigratedAt=new Date().toISOString();
      done.forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});
    }
    return true;
  };
  const scheduleSave=(delay=250)=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=null;save()},delay)};
  const load=()=>{
    let raw=null;
    try{
      const text=localStorage.getItem(KEY);
      raw=text?JSON.parse(text):null;
      if(raw&&!valid(raw))throw new Error('invalid schema');
    }catch(e){
      if(localStorage.getItem(KEY)){
        try{localStorage.setItem(CORRUPT+'-'+Date.now(),localStorage.getItem(KEY))}catch(e2){}
      }
      state=defaults();
      notify();
      return state;
    }
    if(raw){
      state=migrate(raw);
      /* 主档存在：只并入仍存活于旧键的运行数据，不碰陈旧的 map 快照。 */
      const found=applyLegacy(state,false);
      if(found.length)state.meta.migratedFrom=[...new Set([...(state.meta.migratedFrom||[]),...found])];
    }else{
      state=migrate(defaults());
      const found=applyLegacy(state,true);
      if(found.length)state.meta.migratedFrom=found;
    }
    notify();
    return state;
  };
  const reset=()=>{
    state=defaults();
    save();
    LEGACY_KEYS.forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});
    notify();
    return state;
  };
  state=load();
  window.__gameStore={KEY,VERSION,getState:()=>clone(state),setState,get,set,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},save,load,migrate,reset,scheduleSave};
})();
