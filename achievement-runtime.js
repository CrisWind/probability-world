/* Probability World: definition-driven achievement unlock runtime. */
(function attachAchievementRuntime(global) {
  'use strict';
  var store = global.__gameStore;
  var bus = global.GameEventBus;
  var data = global.AchievementData;
  if (!store || !bus || !data) {
    console.error('[AchievementRuntime] GameStore, GameEventBus, and AchievementData are required.');
    return;
  }
  var definitions = Object.assign({}, data.DEFINITIONS || {});
  var unsubscribers = [];
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };

  function payloadMatches(expected, actual) {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return false;
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.keys(expected).every(function (key) {
      if (!Object.prototype.hasOwnProperty.call(actual, key)) return false;
      if (Array.isArray(expected[key])) return expected[key].indexOf(actual[key]) !== -1;
      return actual[key] === expected[key];
    });
  }

  function matchesCondition(condition, event) {
    if (!condition || condition.type !== 'event_match' || !event) return false;
    if (condition.eventType !== event.type) return false;
    return payloadMatches(condition.payload, event.payload);
  }

  function getInstance(achievementId) {
    var achievements = store.get('achievements', {});
    var instances = achievements && achievements.instances;
    return instances && typeof instances === 'object' ? instances[achievementId] || null : null;
  }

  function putUnlock(definition, unlockedAt, emitEvent) {
    var existing = getInstance(definition.id);
    if (existing && existing.unlockedAt !== null && existing.unlockedAt !== undefined) return false;
    var achievements = store.get('achievements', {}) || {};
    var instances = Object.assign({}, achievements.instances || {});
    var previous = existing || (data.createInstance ? data.createInstance(definition.id) : { progress: null, revealedAt: null, isNew: false });
    instances[definition.id] = Object.assign({}, previous, {
      achievementId: definition.id,
      unlockedAt: unlockedAt,
      progress: previous.progress === undefined ? null : previous.progress,
      revealedAt: previous.revealedAt === undefined ? null : previous.revealedAt,
      isNew: true
    });
    store.setState({ achievements: Object.assign({}, achievements, { version: achievements.version || 1, instances: instances }) });
    store.scheduleSave && store.scheduleSave();
    if (emitEvent) {
      bus.emit({ type: 'achievement_unlocked', payload: { achievementId: definition.id, unlockedAt: unlockedAt }, at: unlockedAt });
    }
    return true;
  }

  function unlock(definition, event) {
    return putUnlock(definition, (event && event.at) || new Date().toISOString(), true);
  }

  function persistedFactAt(definition) {
    var condition = definition && definition.condition;
    if (!condition || condition.type !== 'event_match') return null;
    var fallbackAt = store.get('meta.savedAt', null) || new Date().toISOString();
    if (condition.eventType === 'choice_made' && condition.payload && condition.payload.choiceGroup === 'ship_news_decision') {
      var choiceId = condition.payload.choiceId;
      var keyByChoice = {
        publish_with_risk: 'publish_with_risk',
        hold_for_review: 'hold_for_review',
        follow_shipowner: 'follow_shipowner'
      };
      var suffix = keyByChoice[choiceId];
      if (!suffix) return null;
      var count = Number(store.get('stats.counters.decisions.ship_news.' + suffix, 0));
      return count > 0 ? fallbackAt : null;
    }
    if (condition.eventType === 'quest_completed' && condition.payload && condition.payload.questId) {
      var quests = store.get('quests', {}) || {};
      var instance = quests.instances && quests.instances[condition.payload.questId];
      if (instance && instance.status === 'completed') return instance.completedAt || fallbackAt;
    }
    return null;
  }

  function backfill() {
    var achievements = store.get('achievements', {}) || {};
    var instances = Object.assign({}, achievements.instances || {});
    var changed = false;
    Object.keys(definitions).forEach(function (achievementId) {
      var definition = definitions[achievementId];
      if (!definition || definition.id !== achievementId) return;
      var existing = getInstance(achievementId);
      if (existing && existing.unlockedAt !== null && existing.unlockedAt !== undefined) return;
      var factAt = persistedFactAt(definition);
      if (factAt) {
        var previous = existing || (data.createInstance ? data.createInstance(achievementId) : { progress: null, revealedAt: null, isNew: false });
        instances[achievementId] = Object.assign({}, previous, {
          achievementId: achievementId,
          unlockedAt: factAt,
          isNew: true
        });
        changed = true;
      }
    });
    if (changed) {
      store.setState({ achievements: Object.assign({}, achievements, { version: achievements.version || 1, instances: instances }) });
      store.scheduleSave && store.scheduleSave();
    }
    return changed;
  }

  function handleEvent(event) {
    if (!event) return;
    Object.keys(definitions).forEach(function (achievementId) {
      var definition = definitions[achievementId];
      try {
        if (definition && definition.id === achievementId && matchesCondition(definition.condition, event)) unlock(definition, event);
      } catch (error) {
        console.error('[AchievementRuntime] Failed to process ' + achievementId, error);
      }
    });
  }

  function init() {
    if (unsubscribers.length) return false;
    unsubscribers = [bus.on('choice_made', handleEvent), bus.on('quest_completed', handleEvent), bus.on('inspection_completed', handleEvent)];
    backfill();
    return true;
  }

  function dispose() {
    if (!unsubscribers.length) return false;
    unsubscribers.splice(0).forEach(function (unsubscribe) { unsubscribe(); });
    return true;
  }

  function register(definition) {
    if (!definition || typeof definition.id !== 'string' || !definition.condition) return false;
    definitions[definition.id] = definition;
    return true;
  }

  global.AchievementRuntime = Object.freeze({
    init: init,
    dispose: dispose,
    destroy: dispose,
    register: register,
    backfill: backfill,
    getDefinition: function (id) { return definitions[id] || null; },
    matchesCondition: matchesCondition,
    handleEvent: handleEvent
  });
  init();
})(window);
