/* Read-only task HUD and task-book overlay. */
(function attachTaskUi(global) {
  'use strict';
  var store = global.__gameStore;
  var runtime = global.QuestRuntime;
  if (!store || !runtime) return;
  var typeNames = { main: '主线', side: '支线', commission: '人物委托', place: '场所玩法' };
  var statusNames = { active: '进行中', ready_to_claim: '可领取', available: '可接取', completed: '已完成', failed: '已失败' };

  function view(id) {
    var instance = runtime.getQuestInstance(id), definition = runtime.getQuestDefinition(id);
    if (!instance || !definition) return null;
    var step = definition.steps.find(function (item) { return item.id === instance.currentStepId; });
    return { id: id, title: definition.title, summary: definition.summary, typeText: typeNames[definition.type] || '任务', status: instance.status, statusText: statusNames[instance.status] || instance.status, stepText: step ? step.text : '', done: instance.completedStepIds.length, total: definition.steps.length, tracked: store.get('quests', {}).trackedQuestId === id };
  }
  function ids() { return Object.keys(store.get('quests', {}).instances || {}); }
  function groups() {
    var result = { active: [], available: [], completed: [] };
    ids().map(view).filter(Boolean).forEach(function (item) {
      if (item.status === 'active' || item.status === 'ready_to_claim') result.active.push(item);
      else if (item.status === 'available') result.available.push(item);
      else if (item.status === 'completed' || item.status === 'failed') result.completed.push(item);
    });
    return result;
  }
  function current() {
    var quests = store.get('quests', {}), tracked = quests.trackedQuestId && view(quests.trackedQuestId);
    if (tracked && (tracked.status === 'active' || tracked.status === 'ready_to_claim')) return tracked;
    return groups().active[0] || null;
  }
  function hud() { var item = current(); return !item ? '暂无进行中的任务' : item.status === 'ready_to_claim' ? '任务目标已完成 · 可领取奖励' : item.stepText || item.title; }
  function track(id) { return runtime.setTrackedQuest ? runtime.setTrackedQuest(id) : false; }
  global.TaskUiModel = Object.freeze({ groups: groups, hud: hud, track: track });

  if (!global.document) return;
  var button = document.getElementById('life-task-button');
  /* #life-task-panel 目标行由 index.html 的 refreshTaskGoal 驱动，任务簿不删除它。 */
  if (!button) return;
  button.setAttribute('aria-label', '打开任务簿'); button.title = '查看任务'; button.textContent = '✎';
  var overlay = document.createElement('div');
  overlay.id = 'quest-log-overlay'; overlay.innerHTML = '<section id="quest-log-panel" role="dialog" aria-modal="true" aria-labelledby="quest-log-title"><button id="quest-log-close" type="button" aria-label="关闭任务簿">×</button><h2 id="quest-log-title">航海任务簿</h2><div id="quest-log-tabs"><button data-tab="active" type="button">进行中</button><button data-tab="available" type="button">可接取</button><button data-tab="completed" type="button">已完成</button></div><div id="quest-log-list"></div></section>';
  document.body.appendChild(overlay);
  var style = document.createElement('style'); style.textContent = '#quest-log-overlay{position:fixed;inset:0;z-index:100010;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(20,16,12,.68)}#quest-log-overlay.is-open{display:flex}#quest-log-panel{position:relative;width:min(720px,94vw);max-height:88vh;overflow:auto;box-sizing:border-box;padding:22px;background:#E8D7B0;border:3px solid #3E2A1B;box-shadow:4px 4px 0 #14100C,inset 0 0 0 1px #C89B3C;color:#211B17}#quest-log-title{margin:0 48px 14px 0;color:#17324A;border-bottom:2px solid #B18A45;padding-bottom:8px}#quest-log-close,#quest-log-tabs button,.quest-track{min-width:44px;min-height:44px;border:2px solid #3E2A1B;background:#6B4A2F;color:#E8D7B0;font:14px NotoPixelCN,sans-serif;cursor:pointer}#quest-log-close{position:absolute;right:10px;top:10px;background:#8C3A2E;font-size:20px}#quest-log-tabs{display:flex;gap:6px;margin-bottom:12px}.quest-entry{margin:10px 0;padding:12px;border:1px solid #6B4A2F;background:#F2E5C8}.quest-entry h3{margin:4px 0}.quest-meta{font-size:13px;color:#6B4A2F}.quest-track{float:right;padding:6px 10px}.quest-empty{padding:18px;background:#C9B283;text-align:center}@media(max-width:520px){#quest-log-panel{padding:16px}#quest-log-tabs{flex-wrap:wrap}}'; document.head.appendChild(style);
  var tab = 'active', list = overlay.querySelector('#quest-log-list');
  function render() { button.title = hud(); var data = groups()[tab]; list.innerHTML = data.length ? data.map(function (item) { return '<article class="quest-entry"><button class="quest-track" data-track="' + item.id + '">' + (item.tracked ? '正在跟踪' : '跟踪') + '</button><div class="quest-meta">' + item.typeText + ' · ' + item.statusText + '</div><h3>' + item.title + '</h3><p>' + item.summary + '</p><p>' + (item.status === 'ready_to_claim' ? '任务目标已完成 · 可领取奖励<br><button class="quest-track" data-claim="' + item.id + '">领取奖励</button>' : item.stepText ? item.stepText + '（' + item.done + '/' + item.total + '）' : item.statusText) + '</p></article>'; }).join('') : '<div class="quest-empty">此分类暂无任务</div>'; }
  function open() { global.GameInputLocks && global.GameInputLocks.acquire('quest-log'); tab = groups().active.length ? 'active' : 'available'; overlay.classList.add('is-open'); overlay.setAttribute('aria-hidden','false'); render(); overlay.querySelector('#quest-log-close').focus(); }
  function close() { overlay.classList.remove('is-open'); overlay.setAttribute('aria-hidden','true'); global.GameInputLocks && global.GameInputLocks.release('quest-log'); button.focus(); }
  button.addEventListener('click', function (event) { event.stopPropagation(); open(); });
  overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); var target = event.target.closest('[data-track]'); if (target) { track(target.dataset.track); render(); } var claim = event.target.closest('[data-claim]'); if (claim) { var result = runtime.claimQuest(claim.dataset.claim); if (!result.success) alert(result.reason === 'already_completed' ? '奖励已经领取' : (result.reason || '暂时无法领取')); render(); } var tabButton = event.target.closest('[data-tab]'); if (tabButton) { tab = tabButton.dataset.tab; render(); } });
  overlay.querySelector('#quest-log-close').addEventListener('click', close);
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && overlay.classList.contains('is-open')) close(); });
  store.subscribe(render); render();
})(window);
