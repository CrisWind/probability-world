/* Probability World - objective behavior statistics only. */
(()=>{const store=window.__gameStore,bus=window.GameEventBus;if(!store||!bus)return;
const MAP=Object.freeze({publish_with_risk:'decisions.ship_news.publish_with_risk',hold_for_review:'decisions.ship_news.hold_for_review',follow_shipowner:'decisions.ship_news.follow_shipowner'});
const ensure=()=>{const current=store.get('stats');if(!current||typeof current!=='object')store.set('stats',{version:1,counters:{},flags:{},sets:{}});else if(!current.counters||typeof current.counters!=='object'||Array.isArray(current.counters))store.set('stats.counters',{});};
let unsubscribe=null;
const handle=event=>{if(!event||event.type!=='choice_made')return;const p=event.payload;if(!p||p.choiceGroup!=='ship_news_decision')return;const key=MAP[p.choiceId];if(!key)return;ensure();const value=Number(store.get('stats.counters.'+key,0));store.set('stats.counters.'+key,(Number.isFinite(value)?value:0)+1);store.scheduleSave?.();};
const init=()=>{if(unsubscribe)return false;ensure();unsubscribe=bus.on('choice_made',handle);return true};
const dispose=()=>{if(!unsubscribe)return false;unsubscribe();unsubscribe=null;return true};
init();
window.StatsRuntime=Object.freeze({init,dispose,destroy:dispose,handleEvent:handle,COUNTER_KEYS:Object.freeze({...MAP})});
})();