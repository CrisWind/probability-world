/* Probability World: quest lifecycle runtime. It only writes GameStore.quests. */
(function attachQuestRuntime(global) {
  'use strict';

  var store = global.__gameStore;
  var bus = global.GameEventBus;
  var questData = global.QuestData;
  var rewardService = global.RewardService;
  var learningAdapter = global.LearningAdapter;
  var claimingQuestIds = new Set();
  if (!store || !bus || !questData) {
    console.error('[QuestRuntime] GameStore, GameEventBus, and QuestData are required.');
    return;
  }

  var statuses = new Set(questData.STATUS || []);
  var definitions = questData.DEFINITIONS || {};
  var unsubscribers = [];
  var initialized = false;
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };

  function logError(message, questId, error) {
    console.error('[QuestRuntime] ' + message + (questId ? ': ' + questId : ''), error || '');
  }

  function getQuestDefinition(questId) {
    var definition = questData.getDefinition ? questData.getDefinition(questId) : definitions[questId];
    if (!definition) logError('Unknown quest definition', questId);
    return definition || null;
  }

  function getQuestState() {
    var quests = store.get('quests', {});
    return {
      trackedQuestId: quests.trackedQuestId || null,
      instances: quests.instances && typeof quests.instances === 'object' ? clone(quests.instances) : {}
    };
  }

  function commitQuestState(quests) {
    store.setState({ quests: quests });
  }

  function getQuestInstance(questId) {
    return getQuestState().instances[questId] || null;
  }

  function allDefinitions() {
    return Object.keys(definitions).map(function (questId) { return definitions[questId]; });
  }

  function payloadMatches(expected, payload) {
    return Object.keys(expected).every(function (key) {
      return payload && payload[key] === expected[key];
    });
  }

  function matchesCondition(condition, event) {
    if (!condition || typeof condition !== 'object') return false;
    var type = condition.event || condition.type;
    if (type !== event.type) return false;

    var expected = {};
    Object.keys(condition).forEach(function (key) {
      if (key !== 'event' && key !== 'type' && key !== 'payload') expected[key] = condition[key];
    });
    if (condition.payload && typeof condition.payload === 'object') {
      Object.assign(expected, condition.payload);
    }
    return payloadMatches(expected, event.payload);
  }

  function unlocksForEvent(definition, event) {
    if (!definition.unlockWhen) return false;
    var conditions = Array.isArray(definition.unlockWhen) ? definition.unlockWhen : [definition.unlockWhen];
    return conditions.length > 0 && conditions.every(function (condition) {
      return matchesCondition(condition, event);
    });
  }

  function hasActiveMainQuest(instances, exceptQuestId) {
    return Object.keys(instances).some(function (questId) {
      var definition = definitions[questId];
      return questId !== exceptQuestId && definition && definition.type === 'main' && instances[questId].status === 'active';
    });
  }

  function createLockedInstance(definition) {
    return questData.createInstance(definition.id);
  }

  function unlockQuest(definition) {
    var quests = getQuestState();
    if (quests.instances[definition.id]) return false;
    var instance = createLockedInstance(definition);
    instance.status = 'available';
    quests.instances[definition.id] = instance;
    commitQuestState(quests);
    return true;
  }

  function activateAvailableQuest(definition, event) {
    var quests = getQuestState();
    var instance = quests.instances[definition.id];
    if (!instance || instance.status !== 'available') return false;
    if (definition.type === 'main' && hasActiveMainQuest(quests.instances, definition.id)) return false;
    if (!event.payload || event.payload.npcId !== definition.giverNpcId) return false;

    instance.status = 'active';
    instance.currentStepId = definition.steps[0] ? definition.steps[0].id : null;
    instance.acceptedAt = event.at;
    quests.trackedQuestId = definition.id;
    commitQuestState(quests);
    return true;
  }

  function advanceActiveQuest(definition, event) {
    var quests = getQuestState();
    var instance = quests.instances[definition.id];
    if (!instance || instance.status !== 'active') return false;
    if (!statuses.has(instance.status)) {
      logError('Invalid quest instance status', definition.id, instance.status);
      return false;
    }

    var stepIndex = definition.steps.findIndex(function (step) { return step.id === instance.currentStepId; });
    if (stepIndex < 0) {
      logError('Current quest step is missing from definition', definition.id, instance.currentStepId);
      return false;
    }
    var step = definition.steps[stepIndex];
    if (!matchesCondition(step.completeWhen, event)) return false;

    if (!instance.completedStepIds.includes(step.id)) instance.completedStepIds.push(step.id);
    var nextStep = definition.steps[stepIndex + 1];
    if (nextStep) {
      instance.currentStepId = nextStep.id;
    } else {
      instance.currentStepId = null;
      instance.status = 'ready_to_claim';
    }
    commitQuestState(quests);
    return true;
  }

  function handleEvent(event) {
    allDefinitions().forEach(function (definition) {
      try {
        var instance = getQuestInstance(definition.id);
        if (!instance) {
          if (unlocksForEvent(definition, event)) unlockQuest(definition);
          return;
        }
        if (!statuses.has(instance.status)) {
          logError('Invalid quest instance status', definition.id, instance.status);
          return;
        }
        if (instance.status === 'available' && event.type === 'npc_talked') {
          activateAvailableQuest(definition, event);
          return;
        }
        if (instance.status === 'active') advanceActiveQuest(definition, event);
      } catch (error) {
        logError('Failed to process game event', definition.id, error);
      }
    });
  }

  function init() {
    if (initialized) return false;
    unsubscribers = bus.TYPES.map(function (type) { return bus.on(type, handleEvent); });
    initialized = true;
    return true;
  }

  function dispose() {
    if (!initialized) return false;
    unsubscribers.splice(0).forEach(function (unsubscribe) { unsubscribe(); });
    initialized = false;
    return true;
  }

  function listByStatus(status) {
    return Object.keys(getQuestState().instances).filter(function (questId) {
      return getQuestInstance(questId).status === status;
    });
  }

  function setTrackedQuest(questId) {
    if (!getQuestDefinition(questId)) return false;
    var quests = getQuestState();
    if (!quests.instances[questId]) return false;
    quests.trackedQuestId = questId;
    commitQuestState(quests);
    return true;
  }
  function claimQuest(questId) {
    var definition = getQuestDefinition(questId), quests = getQuestState(), instance = quests.instances[questId];
    if (!definition || !instance) return {success:false,reason:'找不到任务'};
    if (instance.status === 'completed') return {success:false,reason:'already_completed'};
    if (instance.status !== 'ready_to_claim' || claimingQuestIds.has(questId)) return {success:false,reason:'当前任务不能领取奖励'};
    if (!rewardService) return {success:false,reason:'奖励服务暂不可用'};
    claimingQuestIds.add(questId);
    try {
      var result=rewardService.grantQuestRewards({questId:questId,outcomeId:instance.outcomeId,rewards:definition.rewards,context:{questId:questId,source:'quest_claim',currentTime:new Date().toISOString()}});
      if (!result.success || !result.state) return result;
      var now=new Date().toISOString(); instance.status='completed'; instance.claimedAt=now; instance.completedAt=now;
      if (quests.trackedQuestId===questId) quests.trackedQuestId=null;
      store.setState({player:result.state.player,cards:result.state.cards,quests:quests});
      if (store.save && !store.save()) return {success:false,reason:'存档失败'};
      bus.emit({ type: 'quest_completed', payload: { questId: questId, outcomeId: instance.outcomeId || null, completedAt: now }, at: now });
      try { learningAdapter?.onQuestCompleted?.({questId:questId,outcomeId:instance.outcomeId,evidence:{atomsTouched:[],behaviors:[],decisions:[],informationUsed:[],playerActions:[]},source:'quest_claim',completedAt:now}); } catch (error) { logError('LearningAdapter hook failed',questId,error); }
      return {success:true,grantedRewardIds:result.grantedRewardIds};
    } catch(error) { logError('Reward claim failed',questId,error); return {success:false,reason:'奖励暂时无法领取'}; }
    finally { claimingQuestIds.delete(questId); }
  }

  global.QuestRuntime = Object.freeze({
    init: init,
    dispose: dispose,
    getQuestDefinition: getQuestDefinition,
    getQuestInstance: getQuestInstance,
    getActiveQuests: function () { return listByStatus('active'); },
    getAvailableQuests: function () { return listByStatus('available'); },
    getReadyToClaimQuests: function () { return listByStatus('ready_to_claim'); },
    getCompletedQuests: function () { return listByStatus('completed'); },
    setTrackedQuest: setTrackedQuest,
    claimQuest: claimQuest
  });
  global.QuestRuntime.init();
})(window);
