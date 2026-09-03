/* Probability World - quest definitions and serializable quest instances. */
(()=>{
  const STATUS=Object.freeze(['locked','available','active','ready_to_claim','completed','failed']);
  const DEFINITIONS=Object.freeze({
    'quest.unposted_ship_news':Object.freeze({
      id:'quest.unposted_ship_news',
      type:'main',
      title:'一张没有贴出的船讯',
      summary:'港口咖啡馆里，一张尚未贴出的船讯正在引发争执。',
      giverNpcId:'cafe_owner',
      locationHint:'castle_cafe',
      unlockWhen:{event:'scene_entered',sceneId:'castle_cafe'},
      steps:Object.freeze([
        Object.freeze({id:'talk_owner',text:'与咖啡馆老板交谈。',completeWhen:Object.freeze({event:'dialogue_ended',dialogueId:'cafe_owner_intro'}),outcomeId:null}),
        Object.freeze({id:'choose_stance',text:'决定公告应如何发布。',completeWhen:Object.freeze({event:'choice_made',choiceGroup:'ship_news_decision'}),outcomeId:null})
      ]),
      rewards:Object.freeze([Object.freeze({id:'coins_8',type:'coins',amount:8}),Object.freeze({id:'lore_coffeehouse',type:'lore_card',cardId:'coffeehouse_age_of_sail'})]),
      worldEffects:Object.freeze({ref:'quest_world_effects.unposted_ship_news'})
    }),
    'quest.cant_tear_down_all':Object.freeze({
      id:'quest.cant_tear_down_all',
      type:'side',
      title:'不能全拆的船',
      summary:'造船厂的质检房里，一批新船正等着出航。也许该看看抽样到底能发现什么。',
      giverNpcId:null,
      locationHint:'shipyard',
      unlockWhen:Object.freeze({event:'scene_entered',sceneId:'shipyard'}),
      activateWhen:Object.freeze({event:'inspection_started'}),
      steps:Object.freeze([
        Object.freeze({id:'inspect_a_ship',text:'在质检房完成一次船舶检验。',completeWhen:Object.freeze({event:'inspection_completed'}),outcomeId:null})
      ]),
      rewards:Object.freeze([
        Object.freeze({id:'coins_15',type:'coins',amount:15})
      ]),
      worldEffects:null
    })
  });
  const clone=value=>JSON.parse(JSON.stringify(value));
  const getDefinition=id=>DEFINITIONS[id]||null;
  const createInstance=id=>{
    const definition=getDefinition(id);
    if(!definition)throw new Error('[QuestData] unknown quest id: '+id);
    return {status:'locked',currentStepId:definition.steps[0]?.id||null,completedStepIds:[],acceptedAt:null,completedAt:null,claimedAt:null,outcomeId:null};
  };
  const createInstances=ids=>Object.fromEntries((ids||[]).map(id=>[id,createInstance(id)]));
  window.QuestData=Object.freeze({STATUS,DEFINITIONS,getDefinition,createInstance,createInstances});
})();