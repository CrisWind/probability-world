/* 概率世界 · 港口笔记 —— 学习证据的最小查看入口（只读）。
 * 内容全部由 world.learning 的真实证据派生：不写教材、不显示掌握度/分数/对错，
 * 无经历不生成条目，不奖励、不改成就。样式复用现有纸色账本风格。
 * 数据契约：world.learning.concepts.correlated_risk
 *   { encounterRefs, appliedAt, migrations } 与
 *           .sampling_representativeness { encounters, applications }。 */
(function attachHarborNotes(global) {
  'use strict';

  var store = global.__gameStore;
  var locks = global.GameInputLocks;
  if (!store || !locks) { console.error('[HarborNotes] required runtime is missing.'); return; }

  var noteOpen = false;
  var noteLock = 'port-notes';
  var noteList = true;   /* UI-only：true=主题列表，false=某主题详情 */
  var noteTopic = null;  /* UI-only：详情中的主题 id（correlated_risk / sampling_representativeness） */

  var style = document.createElement('style');
  style.textContent = '#port-notes-button{position:absolute;left:58px;top:150px;z-index:29;width:44px;height:44px;padding:0;border:1px solid #3E2A1B;background:#6B4A2F;color:#E8D7B0;font:18px NotoPixelCN,sans-serif;box-shadow:2px 2px 0 #14100C;cursor:pointer;pointer-events:auto}#port-notes-button:hover{background:#7D5A3A;border-color:#E8C87A}#port-notes-button:active{transform:translate(2px,2px)}#port-notes-overlay{position:fixed;inset:0;z-index:100090;display:none;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(8,12,18,.76);pointer-events:none}#port-notes-overlay.is-open{display:flex;pointer-events:auto}#port-notes-panel{position:relative;width:min(680px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 48px));overflow:hidden;box-sizing:border-box;padding:26px;background:#E8D7B0;color:#211B17;border:4px solid #3E2A1B;box-shadow:0 0 0 2px #C89B3C,5px 5px 0 #14100C}#port-notes-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:2px solid #B18A45}#port-notes-title{margin:0;color:#6D3028;font-size:26px}#port-notes-subtitle{margin:5px 0 0;color:#6B4A2F;font-size:13px}#port-notes-close{min-width:48px;min-height:48px;border:2px solid #3E2A1B;background:#8C3A2E;color:#E8D7B0;font:20px NotoPixelCN,sans-serif;cursor:pointer}#port-notes-content{max-height:calc(100vh - 190px);overflow-y:auto;padding:18px 4px 4px}.pn-concept{margin:0 0 20px;padding:14px 16px;background:#F2E5C8;border:2px solid #B18A45;box-shadow:2px 2px 0 rgba(33,22,15,.22)}.pn-concept-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.pn-concept-title{margin:0;color:#17324A;font-size:17px}.pn-stage{flex:none;padding:2px 8px;border:1px solid #B18A45;background:#E8D7B0;color:#6B4A2F;font-size:11px}.pn-stage.has{color:#8C3A2E;border-color:#C89B3C}.pn-entry{margin:0 0 10px;padding:10px 12px;background:#FFF4D7;border:1px solid #C89B3C}.pn-entry:last-child{margin-bottom:0}.pn-entry-label{margin:0 0 4px;color:#8D6B32;font-size:11px}.pn-entry-copy{margin:0;line-height:1.7;font-size:13px}.pn-entry-ref{margin:4px 0 0;color:#8D6B32;font-size:11px}.pn-empty{padding:22px;text-align:center;color:#6B4A2F;line-height:1.8;font-size:13px}\n.pn-row{display:block;width:100%;margin:0 0 12px;padding:12px 14px;text-align:left;background:#F2E5C8;border:2px solid #B18A45;box-shadow:2px 2px 0 rgba(33,22,15,.22);cursor:pointer;font:13px NotoPixelCN,sans-serif;color:#211B17}\n.pn-row:hover{border-color:#C89B3C}\n.pn-row-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}\n.pn-row-title{margin:0;color:#17324A;font-size:15px}\n.pn-row-snippet{margin:0;color:#3E2A1B;line-height:1.6;font-size:12px}\n.pn-row-hint{margin:6px 0 0;color:#8D6B32;font-size:11px}\n.pn-back{display:block;width:100%;margin:6px 0 0;padding:10px;background:#C9B283;border:1px solid #6B4A2F;color:#3E2A1B;font:12px NotoPixelCN,sans-serif;cursor:pointer;text-align:center}\n.pn-back:hover{border-color:#C89B3C}';
  document.head.appendChild(style);

  var entry = document.createElement('button');
  entry.id = 'port-notes-button';
  entry.type = 'button';
  entry.setAttribute('aria-label', '打开港口笔记');
  entry.title = '港口笔记';
  entry.textContent = '✧';
  var overlay = document.createElement('div');
  overlay.id = 'port-notes-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  var panel = document.createElement('section');
  panel.id = 'port-notes-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'port-notes-title');
  panel.innerHTML = '<div id="port-notes-header"><div><h2 id="port-notes-title">港口笔记</h2><p id="port-notes-subtitle">从真实档案抄录——只记录发生过的行为。</p></div><button id="port-notes-close" type="button" aria-label="关闭港口笔记">×</button></div><div id="port-notes-content"></div>';
  overlay.appendChild(panel);
  document.body.appendChild(entry);
  document.body.appendChild(overlay);

  /* ── 读取与命名 ── */
  function learning() { return store.get('world.learning'); }
  function concept(id) {
    var l = learning();
    return (l && l.concepts && l.concepts[id]) || null;
  }
  function cfg() { return global.FLEET_CONFIG || null; }
  function vessels() { var c = cfg(); return (c && Array.isArray(c.vessels)) ? c.vessels : []; }
  function routes() { var c = cfg(); return (c && Array.isArray(c.routes)) ? c.routes : []; }
  function shipNameOf(shipId) {
    var list = vessels();
    for (var i = 0; i < list.length; i++) { if (list[i].shipId === shipId) return list[i].name; }
    return '未知船只';
  }
  function routeNameOf(routeId) {
    var list = routes();
    for (var i = 0; i < list.length; i++) { if (list[i].routeId === routeId) return list[i].name; }
    if (!routeId) return '留港';
    return '未知航线';
  }
  function batchLabelOf(batchId) {
    if (!batchId) return '未知船材批次';
    var c = cfg();
    var list = (c && Array.isArray(c.batches)) ? c.batches : [];
    for (var i = 0; i < list.length; i++) { if (list[i].batchId === batchId) return list[i].name; }
    return '未知船材批次';
  }
  function shortId(id) { return String(id || '').length > 18 ? String(id).slice(0, 18) + '…' : String(id); }
  function namesOf(ids) {
    var list = Array.isArray(ids) ? ids : [];
    var names = [];
    for (var i = 0; i < list.length; i++) names.push(shipNameOf(list[i]));
    return names;
  }
  function refLine(ref) {
    return ref && ref.round ? '（第 ' + ref.round + ' 回合）' : '';
  }

  /* ── correlated_risk 叙述 ── */
  function stageOf(c) {
    if (!c) return 'unseen';
    if (Array.isArray(c.migrations) && c.migrations.length) return 'migrated';
    if (Array.isArray(c.appliedAt) && c.appliedAt.length) return 'applied';
    if (Array.isArray(c.encounterRefs) && c.encounterRefs.length) return 'encountered';
    return 'unseen';
  }
  var STAGE_LABEL = { unseen: '未遇见', encountered: '已亲历', applied: '已应用', migrated: '已迁移' };

  function encounterCopy(ref) {
    if (!ref || !Array.isArray(ref.commonRiskEvents) || !ref.commonRiskEvents.length) return '';
    var parts = [];
    for (var i = 0; i < ref.commonRiskEvents.length; i++) {
      var ev = ref.commonRiskEvents[i];
      var names = namesOf(ev.vesselIds).join('、');
      if (ev.type === 'storm') {
        parts.push(names + ' 在同一回合同受「' + routeNameOf(ev.sourceId) + '」风暴影响');
      } else {
        parts.push(names + ' 使用同一船材批次（' + batchLabelOf(ev.sourceId) + '）并同时受损');
      }
    }
    return '你亲历过：' + parts.join('；') + '。';
  }

  function changeText(ch) {
    if (!ch) return '';
    switch (ch.change) {
      case 'route-thinned': return routeNameOf(ch.routeId) + ' 减少到 ' + ch.to + ' 艘';
      case 'ship-kept-in-port': return shipNameOf(ch.shipId) + ' 留港';
      case 'route-changed': return shipNameOf(ch.shipId) + ' 改走「' + routeNameOf(ch.toRoute) + '」';
      case 'reserve-increased': return '准备金从 ' + ch.from + ' 提高到 ' + ch.to;
      case 'ship-set-sailing': return shipNameOf(ch.shipId) + ' 重新出航（' + routeNameOf(ch.toRoute) + '）';
      default: return ch.change || '';
    }
  }

  function applicationCopy(applied) {
    if (!applied || !Array.isArray(applied.changes) || !applied.changes.length) return '';
    var parts = [];
    for (var i = 0; i < applied.changes.length; i++) {
      var t = changeText(applied.changes[i]);
      if (t) parts.push(t);
    }
    return '之后的行动：你在第 ' + applied.toRound + ' 回合前调整了方案——' + parts.join('；') + '。';
  }

  function aggregationText(entry) {
    var aggs = Array.isArray(entry.aggregations) ? entry.aggregations : [];
    if (!aggs.length) return '当日委托未显示可识别的聚集';
    var parts = [];
    for (var i = 0; i < aggs.length; i++) {
      var a = aggs[i];
      if (a.type === 'route-shared') parts.push('有 ' + a.count + ' 份委托涉及「' + a.route + '」');
      else if (a.type === 'value-concentration') parts.push('「' + a.ship + '」一单货值占当日总额约 ' + a.share + '%');
    }
    return parts.join('；');
  }

  function migrationCopy(m) {
    if (!m) return '';
    if (m.context === 'underwriting_cafe') {
      var act = m.decision === 'pass' ? '放弃了一份委托' : '签下了一份报价';
      return '再次使用：你在承保咖啡馆展开过「共同风险观察」——' + aggregationText(m) + '；随后完成了一次承保决策（' + act + '）。';
    }
    if (m.context === 'inspection_desk') {
      var actions = [];
      if (m.extendedSamples) actions.push('追加了抽样');
      if (m.managed) {
        if (m.decision === 'repair_partial') actions.push('选择局部返修');
        else if (m.decision === 'repair_full') actions.push('选择全面返修');
        else if (m.decision === 'hold') actions.push('选择暂停放行');
        else actions.push('选择了与批次相关的处置');
      }
      if (!actions.length) actions.push('完成了质检');
      return '再次使用：你在质检房展开过「船队同批次观察」，并在其后' + actions.join('、') + '，完成了质检。';
    }
    return '';
  }

  function correlatedHtml(c) {
    var html = '<section class="pn-concept"><div class="pn-concept-head"><h3 class="pn-concept-title">共同风险</h3><span class="pn-stage has">' + STAGE_LABEL[stageOf(c)] + '</span></div>';
    var refs = Array.isArray(c.encounterRefs) ? c.encounterRefs : [];
    if (refs.length) {
      var ref = refs[refs.length - 1];
      html += '<div class="pn-entry"><p class="pn-entry-label">你亲历过</p><p class="pn-entry-copy">' + encounterCopy(ref) + '</p><p class="pn-entry-ref">' + refLine({ campaignId: ref.campaignId, round: ref.round }) + '</p></div>';
    }
    var apps = Array.isArray(c.appliedAt) ? c.appliedAt : [];
    if (apps.length) {
      var ap = apps[apps.length - 1];
      html += '<div class="pn-entry"><p class="pn-entry-label">之后的行动</p><p class="pn-entry-copy">' + applicationCopy(ap) + '</p><p class="pn-entry-ref">风险盘记录（本局）</p></div>';
    }
    var migs = Array.isArray(c.migrations) ? c.migrations : [];
    for (var i = 0; i < migs.length; i++) {
      var copy = migrationCopy(migs[i]);
      if (copy) html += '<div class="pn-entry"><p class="pn-entry-label">再次使用</p><p class="pn-entry-copy">' + copy + '</p>' + (migs[i].refs && migs[i].refs.campaignId ? '<p class="pn-entry-ref">源自风险盘记录：第 ' + migs[i].refs.fromRound + '→' + migs[i].refs.toRound + ' 回合</p>' : '') + '</div>';
    }
    html += '</section>';
    return html;
  }

  /* ── sampling_representativeness 叙述 ── */
  function decisionLabel(decision) {
    var sy = global.SHIPYARD_CONFIG;
    var d = sy && sy.decisions && decision && sy.decisions[decision];
    return d && d.label ? d.label : String(decision || '');
  }
  function inspectionEncounterCopy(e) {
    if (!e) return '';
    var sampled = Array.isArray(e.sampledParts) ? e.sampledParts.length : 0;
    var uninsp = Array.isArray(e.uninspectedParts) ? e.uninspectedParts.length : 0;
    var found = Array.isArray(e.defectsFound) ? e.defectsFound.length : 0;
    var missed = (e.outcome && Array.isArray(e.outcome.missedDefects)) ? e.outcome.missedDefects.length : 0;
    var parts = ['质检报告 ' + shortId(e.reportId) + '：抽检 ' + sampled + ' 个部位，另有 ' + uninsp + ' 个部位未检查'];
    if (found > 0) parts.push('发现 ' + found + ' 处缺陷');
    else parts.push('没有发现缺陷');
    if (missed > 0) parts.push('出航后暴露 ' + missed + ' 处未查缺陷');
    var copy = '你亲历过：' + parts.join('，') + '；决定：' + (decisionLabel(e.decision) || '（记录缺失）') + '。';
    return copy;
  }
  function fleetApplicationCopy(a) {
    if (!a || !Array.isArray(a.changes) || !a.changes.length) return '';
    var parts = [];
    for (var i = 0; i < a.changes.length; i++) {
      var t = changeText(a.changes[i]);
      if (t) parts.push(t);
    }
    if (!parts.length) return '';
    return '之后的行动：你在风险盘第 ' + a.round + ' 回合参考质检报告调整了方案——' + parts.join('；') + '。';
  }
  function samplingHtml(c) {
    if (!c) return '';
    var encs = Array.isArray(c.encounters) ? c.encounters : [];
    var apps = Array.isArray(c.applications) ? c.applications : [];
    if (!encs.length && !apps.length) return '';
    var html = '<section class="pn-concept"><div class="pn-concept-head"><h3 class="pn-concept-title">抽样代表性</h3><span class="pn-stage has">已亲历' + (encs.length ? ' ' + encs.length + ' 次' : '') + (apps.length ? ' · 已应用' : '') + '</span></div>';
    if (encs.length) {
      var e = encs[encs.length - 1];
      html += '<div class="pn-entry"><p class="pn-entry-label">你亲历过</p><p class="pn-entry-copy">' + inspectionEncounterCopy(e) + '</p><p class="pn-entry-ref">报告 ' + shortId(e.reportId) + '</p></div>';
    }
    if (apps.length) {
      var a = apps[apps.length - 1];
      html += '<div class="pn-entry"><p class="pn-entry-label">之后的行动</p><p class="pn-entry-copy">' + fleetApplicationCopy(a) + '</p><p class="pn-entry-ref">风险盘记录 · 报告 ' + shortId(a.sourceReportId) + '</p></div>';
    }
    html += '</section>';
    return html;
  }

  /* MARK-NOTE-LIST-DETAIL-20260904 —— 港口笔记：先列表（名称/阶段/最近摘要），点击进入详情 */
  function clipSnippet(s) { return s.length > 48 ? s.slice(0, 48) + '…' : s; }

  /* 最近一条事实的截断摘要：迁移 → 应用 → 亲历 优先取最新 */
  function crSnippet(c) {
    var migs = Array.isArray(c.migrations) ? c.migrations : [];
    for (var m = migs.length - 1; m >= 0; m--) {
      var mc = migrationCopy(migs[m]);
      if (mc) return clipSnippet(mc);
    }
    var apps = Array.isArray(c.appliedAt) ? c.appliedAt : [];
    for (var a = apps.length - 1; a >= 0; a--) {
      var ac = applicationCopy(apps[a]);
      if (ac) return clipSnippet(ac);
    }
    var refs = Array.isArray(c.encounterRefs) ? c.encounterRefs : [];
    for (var r = refs.length - 1; r >= 0; r--) {
      var rc = encounterCopy(refs[r]);
      if (rc) return clipSnippet(rc);
    }
    return '';
  }

  function srSnippet(c) {
    var apls = Array.isArray(c.applications) ? c.applications : [];
    for (var p = apls.length - 1; p >= 0; p--) {
      var pc = fleetApplicationCopy(apls[p]);
      if (pc) return clipSnippet(pc);
    }
    var encs = Array.isArray(c.encounters) ? c.encounters : [];
    for (var e = encs.length - 1; e >= 0; e--) {
      var ec = inspectionEncounterCopy(encs[e]);
      if (ec) return clipSnippet(ec);
    }
    return '';
  }

  function rowHtml(id, title, stageText, snippet) {
    return '<button class="pn-row" data-pn="open-' + id + '">'
      + '<span class="pn-row-head"><b class="pn-row-title">' + title + '</b><span class="pn-stage has">' + stageText + '</span></span>'
      + '<span class="pn-row-snippet">' + snippet + '</span>'
      + '<span class="pn-row-hint">点击查看完整抄录 ›</span>'
      + '</button>';
  }

  function listHtml() {
    var html = '';
    var cr = concept('correlated_risk');
    if (cr) html += rowHtml('correlated_risk', '共同风险', STAGE_LABEL[stageOf(cr)], crSnippet(cr));
    var sr = concept('sampling_representativeness');
    if (sr) {
      var encs = Array.isArray(sr.encounters) ? sr.encounters : [];
      var apls = Array.isArray(sr.applications) ? sr.applications : [];
      var stageText = '已亲历 ' + encs.length + ' 次' + (apls.length ? ' · 已应用' : '');
      html += rowHtml('sampling_representativeness', '抽样代表性', stageText, srSnippet(sr));
    }
    return html;
  }

  function detailHtml(id) {
    var c = concept(id);
    if (!c) return '';
    var body = id === 'correlated_risk' ? correlatedHtml(c) : samplingHtml(c);
    return body + '<button class="pn-back" data-pn="back">返回笔记列表</button>';
  }

  function renderNotes() {
    var content = document.getElementById('port-notes-content');
    if (!content) return;
    var html;
    if (noteList) {
      html = listHtml();
      content.innerHTML = html || '<div class="pn-empty">港口笔记还没有抄录下经历。<br>它只记录发生过的行为——先去风险盘亲历共同风险并调整船队，或在质检房抽检一艘船，看看未检查部位后来发生了什么吧。</div>';
    } else {
      html = detailHtml(noteTopic);
      content.innerHTML = html || '<div class="pn-empty">这条经历已经不在档案里了。</div><button class="pn-back" data-pn="back">返回笔记列表</button>';
    }
  }

  function openNotes() {
    if (noteOpen) return;
    noteOpen = true;
    noteList = true;   /* 每次打开都从列表开始 */
    noteTopic = null;
    renderNotes();
    locks.acquire(noteLock);
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    panel.querySelector('#port-notes-close').focus();
  }
  function closeNotes() {
    if (!noteOpen) return;
    noteOpen = false;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    locks.release(noteLock);
    entry.focus();
  }

  entry.addEventListener('click', openNotes);
  panel.querySelector('#port-notes-close').addEventListener('click', closeNotes);
  overlay.addEventListener('click', function (event) { if (event.target === overlay) closeNotes(); });
  document.addEventListener('keydown', function (event) { if (noteOpen && event.key === 'Escape') { event.preventDefault(); closeNotes(); } });
  document.getElementById('port-notes-content').addEventListener('click', function (event) {
    var rowBtn = event.target.closest('[data-pn]');
    if (!rowBtn || rowBtn.disabled) return;
    var pn = rowBtn.getAttribute('data-pn');
    if (pn === 'back') { noteList = true; noteTopic = null; renderNotes(); }
    else if (pn.indexOf('open-') === 0) { noteTopic = pn.slice(5); noteList = false; renderNotes(); }
  });
  store.subscribe(function () { if (noteOpen) renderNotes(); });

  global.HarborNotes = Object.freeze({ open: openNotes, close: closeNotes, render: renderNotes });
})(window);
