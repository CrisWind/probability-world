/* 概率世界 · 商会船队风险盘 —— 行为统计
 * 监听风险盘事件，将行为模式写入 stats.flags.fleet，供成就系统 stat_check 使用。
 * 不修改任务、成就、资金或风险模型。 */
(function attachFleetStats(global) {
  'use strict';
  var store = global.__gameStore;
  var bus = global.GameEventBus;
  var config = function() { return global.FLEET_CONFIG; };
  if (!store || !bus) return;

  var unsubscribers = [];

  function setFlag(key, value) {
    var flags = store.get('stats.flags') || {};
    if (!flags.fleet) flags.fleet = {};
    flags.fleet[key] = value;
    store.set('stats.flags', flags);
    store.scheduleSave && store.scheduleSave();
  }

  function handlePlanSubmitted(event) {
    var p = event.payload || {};
    var assignments = p.assignments || {};
    var cfg = config();
    if (!cfg) return;
    var vessels = cfg.vessels;
    var assigned = [];
    for (var i = 0; i < vessels.length; i++) {
      if (assignments[vessels[i].shipId] !== null && assignments[vessels[i].shipId] !== undefined) {
        assigned.push({ shipId: vessels[i].shipId, routeId: assignments[vessels[i].shipId], batchId: vessels[i].batchId });
      }
    }
    if (assigned.length < 2) return;
    var routeSet = {};
    var batchSet = {};
    for (var j = 0; j < assigned.length; j++) {
      routeSet[assigned[j].routeId] = true;
      batchSet[assigned[j].batchId] = true;
    }
    var diversified = Object.keys(routeSet).length > 1 || Object.keys(batchSet).length > 1;
    setFlag('diversified_assignments', diversified);
  }

  function handleCampaignCompleted(event) {
    var p = event.payload || {};
    var rounds = p.rounds || [];
    var finalReserve = typeof p.reserve === 'number' ? p.reserve : (typeof p.finalReserve === 'number' ? p.finalReserve : 0);
    var stormsOccurred = false;
    for (var i = 0; i < rounds.length; i++) {
      if (rounds[i].storms && rounds[i].storms.length > 0) { stormsOccurred = true; break; }
    }
    if (!stormsOccurred) return;
    var cfg = config();
    if (!cfg) return;
    var camp = store.get('world.fleet.activeCampaign');
    if (!camp) {
      var archived = store.get('world.fleet.archivedCampaigns') || [];
      for (var k = archived.length - 1; k >= 0; k--) {
        if (archived[k].campaignId === p.campaignId) { camp = archived[k]; break; }
      }
    }
    if (!camp || !camp.assignments) return;
    var vessels = cfg.vessels;
    var totalCargoValue = 0;
    for (var j = 0; j < vessels.length; j++) {
      if (camp.assignments[vessels[j].shipId] !== null && camp.assignments[vessels[j].shipId] !== undefined) {
        totalCargoValue += vessels[j].cargoValue;
      }
    }
    if (totalCargoValue <= 0) return;
    var reservesAdequate = finalReserve >= totalCargoValue * 0.15;
    setFlag('storm_reserves_held', reservesAdequate);
  }

  function handleEvent(event) {
    if (!event || !event.type) return;
    if (event.type === 'fleet_plan_submitted') handlePlanSubmitted(event);
    if (event.type === 'fleet_campaign_completed') handleCampaignCompleted(event);
  }

  function init() {
    if (unsubscribers.length) return;
    unsubscribers.push(bus.on('fleet_plan_submitted', handleEvent));
    unsubscribers.push(bus.on('fleet_campaign_completed', handleEvent));
  }

  function dispose() {
    unsubscribers.splice(0).forEach(function(fn) { fn(); });
  }

  init();
  global.FleetStats = Object.freeze({ init: init, dispose: dispose, handleEvent: handleEvent });
})(typeof window !== 'undefined' ? window : globalThis);
