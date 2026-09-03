/* Probability World: process-local, synchronous game event bus.
 * It deliberately owns no game state and does not persist event history. */
(function attachGameEventBus(global) {
  'use strict';

  var TYPES = Object.freeze([
    'scene_entered',
    'npc_talked',
    'dialogue_ended',
    'choice_made',
    'item_obtained',
    'card_viewed',
    'location_reached',
    'decision_submitted',
    'achievement_unlocked',
    'quest_completed',
    'inspection_started',
    'inspection_sampled',
    'inspection_decision_submitted',
    'inspection_completed',
    'fleet_plan_submitted',
    'fleet_round_settled',
    'fleet_storm_triggered',
    'fleet_insolvent',
    'fleet_campaign_completed'
  ]);
  var allowedTypes = new Set(TYPES);
  var listenersByType = new Map();

  function requireSupportedType(type) {
    if (!allowedTypes.has(type)) {
      throw new Error('[GameEventBus] Unsupported event type: ' + String(type));
    }
  }

  function on(type, handler) {
    requireSupportedType(type);
    if (typeof handler !== 'function') {
      throw new TypeError('[GameEventBus] Event handler must be a function.');
    }

    var listeners = listenersByType.get(type);
    if (!listeners) {
      listeners = [];
      listenersByType.set(type, listeners);
    }
    // Duplicate subscriptions are intentional: each registration is independent.
    listeners.push(handler);

    var active = true;
    return function unsubscribeRegisteredHandler() {
      if (!active) return false;
      active = false;
      return off(type, handler);
    };
  }

  function off(type, handler) {
    var listeners = listenersByType.get(type);
    if (!listeners) return false;

    var index = listeners.indexOf(handler);
    if (index === -1) return false;
    listeners.splice(index, 1);
    if (listeners.length === 0) listenersByType.delete(type);
    return true;
  }

  function normalizeEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('[GameEventBus] emit expects an event object.');
    }
    requireSupportedType(input.type);

    var payload = input.payload === undefined ? {} : input.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('[GameEventBus] Event payload must be an object.');
    }

    var at = input.at === undefined ? new Date().toISOString() : input.at;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
      throw new TypeError('[GameEventBus] Event timestamp must be an ISO string.');
    }

    return { type: input.type, payload: payload, at: at };
  }

  function emit(input) {
    var event = normalizeEvent(input);
    // Snapshot makes subscription changes during a dispatch deterministic.
    var snapshot = (listenersByType.get(event.type) || []).slice();

    snapshot.forEach(function notify(handler) {
      try {
        handler(event);
      } catch (error) {
        console.error('[GameEventBus] Listener failed for event ' + event.type, error);
      }
    });
    return event;
  }

  global.GameEventBus = Object.freeze({
    TYPES: TYPES,
    on: on,
    off: off,
    subscribe: on,
    unsubscribe: off,
    emit: emit
  });
})(window);