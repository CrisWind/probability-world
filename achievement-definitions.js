/* Probability World - static achievement definitions only. */
(()=>{const freeze=Object.freeze;
const CATEGORIES=freeze(['milestone','judgement','investigation','exploration','relationship','restraint','hidden']);
const VISIBILITY=freeze(['visible','named_hidden','hidden']);
const PROGRESS_MODES=freeze(['none','count','checklist']);
const GROUPS=freeze(['group.clear_ledger','group.harbor_observer']);
const DEFINITIONS=freeze({
  'achievement.first_clear_quote':freeze({id:'achievement.first_clear_quote',category:'judgement',title:'\u5148\u628a\u8bdd\u8bf4\u6e05\u695a',description:'\u5728\u8239\u8baf\u4e89\u6267\u4e2d\uff0c\u9009\u62e9\u5148\u8bf4\u660e\u98ce\u9669\u3002',visibility:'visible',progressMode:'none',condition:freeze({type:'event_match',eventType:'choice_made',payload:freeze({choiceGroup:'ship_news_decision',choiceId:'publish_with_risk'})}),groupId:'group.clear_ledger'}),
  'achievement.wait_for_evidence':freeze({id:'achievement.wait_for_evidence',category:'judgement',title:'\u7b49\u8bc1\u636e\u5f00\u53e3',description:'\u5728\u8239\u8baf\u4e89\u6267\u4e2d\uff0c\u9009\u62e9\u6682\u7f13\u53d1\u5e03\u5e76\u7ee7\u7eed\u6838\u5bf9\u8bb0\u5f55\u3002',visibility:'named_hidden',progressMode:'none',condition:freeze({type:'event_match',eventType:'choice_made',payload:freeze({choiceGroup:'ship_news_decision',choiceId:'hold_for_review'})}),groupId:'group.clear_ledger'}),
  'achievement.first_harbor_note':freeze({id:'achievement.first_harbor_note',category:'milestone',title:'港口的第一笔记',description:'完成港口中的第一条正式事件。',visibility:'visible',progressMode:'none',condition:freeze({type:'event_match',eventType:'quest_completed',payload:freeze({questId:'quest.unposted_ship_news'})}),groupId:null})
});
const GROUP_DEFINITIONS=freeze({'group.clear_ledger':freeze({id:'group.clear_ledger',title:'清楚的账本',requiredAchievementIds:freeze(['achievement.first_clear_quote','achievement.wait_for_evidence']),unlockMode:'all'}),'group.harbor_observer':freeze({id:'group.harbor_observer',title:'港口见闻',requiredAchievementIds:freeze([]),unlockMode:'all'})});
const TITLE_DEFINITIONS=freeze({'title.new_recorder':freeze({id:'title.new_recorder',name:'初到港口的记录员',description:'从第一笔记录开始认识这座港口。',groupId:null}),'title.careful_recorder':freeze({id:'title.careful_recorder',name:'谨慎的记录员',description:'在信息与风险之间保持清醒。',groupId:'group.clear_ledger'}),'title.harbor_observer':freeze({id:'title.harbor_observer',name:'港口见闻者',description:'在不同场所留下自己的观察。',groupId:'group.harbor_observer'})});
const createInstance=id=>{if(!DEFINITIONS[id])throw new Error('[AchievementData] unknown achievement id: '+id);return {unlockedAt:null,progress:null,revealedAt:null,isNew:false}};
const createInstances=()=>Object.fromEntries(Object.keys(DEFINITIONS).map(id=>[id,createInstance(id)]));
window.AchievementData=freeze({CATEGORIES,VISIBILITY,PROGRESS_MODES,GROUPS,DEFINITIONS,GROUP_DEFINITIONS,TITLE_DEFINITIONS,getDefinition:id=>DEFINITIONS[id]||null,createInstance,createInstances});
})();