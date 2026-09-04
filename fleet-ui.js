/* 概率世界 · 商会船队风险盘 V0.2 —— UI（覆盖层 + 4 视图）
 * 4 视图：campaign-start（开局）、planning（方案规划）、result（单轮结算）、summary（campaign 总结）。
 * 只显示客观信息，不显示推荐。 */
(function attachFleetUI(global) {
  'use strict';

  var doc = function() { return global.document; };
  var runtime = function() { return global.FleetRuntime; };
  var config = function() { return global.FLEET_CONFIG; };
  var model = function() { return global.FleetModel; };

  var overlay = null;
  var panelBody = null;
  var currentView = 'campaign-start';
  /* 分步/分页展示状态（仅 UI 层临时变量；已提交的回合不会回到 planning 修改） */
  var plStep = 1;
  var resPage = 1;
  var summaryTab = 'overview';

  /* ── 样式 ── */
  function injectStyle() {
    if (doc().getElementById('fleet-ui-style')) return;
    var st = doc().createElement('style');
    st.id = 'fleet-ui-style';
    st.textContent = [
      '#fleet-overlay{position:fixed;inset:0;z-index:99995;display:none;align-items:flex-start;justify-content:center;padding:40px 12px 12px;background:rgba(20,16,12,.52);box-sizing:border-box;overflow-y:auto}',
      '#fleet-overlay.show{display:flex}',
      '#fleet-panel{position:relative;width:min(820px,94vw);max-height:calc(100vh - 56px);overflow-y:auto;padding:18px 20px 20px;background:#E8D7B0;color:#211B17;border:3px solid #3E2A1B;box-shadow:4px 4px 0 #14100C,inset 0 0 0 1px #C89B3C;box-sizing:border-box;font-family:NotoPixelCN,sans-serif}',
      '#fleet-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;margin-bottom:12px;border-bottom:2px solid #B18A45}',
      '#fleet-title{margin:0;color:#17324A;font-size:18px;line-height:1.3}',
      '#fleet-close{flex:none;width:40px;height:40px;background:#8C3A2E;color:#E8D7B0;border:2px solid #3E2A1B;font:18px NotoPixelCN,sans-serif;cursor:pointer;box-shadow:2px 2px 0 #14100C;display:flex;align-items:center;justify-content:center}',
      '#fleet-close:hover{background:#A64B3D;border-color:#E8C87A}',
      '.fleet-bar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;padding:8px 10px;background:#F2E5C8;border:1px solid #B18A45;font-size:12px;color:#3E2A1B}',
      '.fleet-bar b{color:#8C3A2E}',
      '.fleet-section{margin:0 0 12px;padding:12px;background:#F2E5C8;border:2px solid #B18A45;box-shadow:2px 2px 0 rgba(33,22,15,.22)}',
      '.fleet-section-title{margin:0 0 8px;padding-bottom:6px;color:#17324A;font-size:14px;border-bottom:1px solid #B18A45}',
      '.fleet-vessel{margin:8px 0;padding:10px;background:#C9B283;border:1px solid #B18A45;box-shadow:2px 2px 0 #211B17;font-size:13px;line-height:1.6}',
      '.fleet-vessel b{color:#3E2A1B}',
      '.fleet-vessel .fleet-route-btns{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
      '.fleet-route-card{margin:8px 0;padding:10px;background:#C9B283;border:1px solid #B18A45;box-shadow:2px 2px 0 #211B17;font-size:13px;line-height:1.6}',
      '.fleet-route-card b{color:#3E2A1B}',
      '.fleet-btn{min-height:36px;padding:6px 10px;background:#6B4A2F;color:#E8D7B0;border:2px solid #3E2A1B;box-shadow:2px 2px 0 #14100C;font:12px NotoPixelCN,sans-serif;cursor:pointer;text-align:center;white-space:normal;line-height:1.3}',
      '.fleet-btn:hover:not(:disabled){background:#7D5A3A;border-color:#E8C87A}',
      '.fleet-btn:disabled{opacity:.4;cursor:not-allowed}',
      '.fleet-btn.selected{background:#8C3A2E;border-color:#E8C87A}',
      '.fleet-btn.secondary{background:#C9B283;color:#3E2A1B;border-color:#6B4A2F}',
      '.fleet-btn.secondary:hover:not(:disabled){background:#D4C4A0}',
      '.fleet-btn.primary{background:#17324A;color:#E8D7B0;border-color:#0D1F2E}',
      '.fleet-btn.primary:hover:not(:disabled){background:#1E4060}',
      '.fleet-btn.danger{background:#8C3A2E;color:#E8D7B0}',
      '.fleet-btn.danger:hover:not(:disabled){background:#A64B3D}',
      '.fleet-btn.stay{background:#5A6B4A;color:#E8D7B0;border-color:#3E4A2F}',
      '.fleet-btn.stay.selected{background:#4A5A3A;border-color:#E8C87A}',
      '.fleet-reserve-row{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px}',
      '.fleet-reserve-row label{min-width:80px;color:#3E2A1B}',
      '.fleet-warning{margin:8px 0;padding:8px 10px;background:#F2E5C8;border-left:3px solid #8C3A2E;font-size:12px;color:#3E2A1B;line-height:1.5}',
      '.fleet-info{margin:8px 0;padding:8px 10px;background:#E8D7B0;border:1px solid #B18A45;font-size:12px;color:#3E2A1B;line-height:1.5}',
      '.fleet-result-table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12px}',
      '.fleet-result-table td,.fleet-result-table th{padding:4px 6px;border-bottom:1px solid #B18A45;text-align:left}',
      '.fleet-result-table th{color:#17324A;font-size:11px}',
      '.fleet-result-table .total{font-weight:bold;color:#8C3A2E;border-top:2px solid #B18A45}',
      '.fleet-result-table .accident{background:#F2D0C8}',
      '.fleet-result-table .safe{background:#D8E8C8}',
      '.fleet-result-table .stayed{background:#E8E0D0}',
      '.fleet-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
      '.fleet-summary-stat{display:inline-block;margin:4px 8px 4px 0;padding:4px 8px;background:#E8D7B0;border:1px solid #B18A45;font-size:12px}',
      '.fleet-summary-stat b{color:#8C3A2E}',
      '.fleet-stepbar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}',
      '.fleet-step{flex:1 1 auto;min-width:104px;padding:6px 8px;background:#C9B283;border:2px solid #B18A45;color:#6B4A2F;font:12px NotoPixelCN,sans-serif;text-align:center;box-shadow:2px 2px 0 #211B17}',
      '.fleet-step.active{background:#6B4A2F;color:#E8D7B0;border-color:#3E2A1B}',
      '.fleet-step.done{background:#D8E8C8;border-color:#5A6B4A;color:#3E4A2F}',
      '.fleet-step.done b{display:block;font-size:11px;font-weight:normal;opacity:.8}',
      '.fleet-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}',
      '.fleet-tab{flex:1 1 auto;min-width:92px;padding:7px 12px;background:#C9B283;border:2px solid #B18A45;color:#6B4A2F;font:12px NotoPixelCN,sans-serif;cursor:pointer;text-align:center;box-shadow:2px 2px 0 #211B17}',
      '.fleet-tab:hover:not(.active){background:#D4C4A0;border-color:#C89B3C}',
      '.fleet-tab.active{background:#17324A;color:#E8D7B0;border-color:#0D1F2E}',
      '.fleet-stat-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}',
      '.fleet-step-note{margin:0 0 10px;font-size:12px;color:#6B4A2F;line-height:1.6}',
      '.fleet-step-note b{color:#8C3A2E}',
      '.fleet-dialog-overlay{position:fixed;inset:0;z-index:99996;display:flex;align-items:center;justify-content:center;background:rgba(20,16,12,.6)}',
      '.fleet-dialog{padding:20px;background:#E8D7B0;border:3px solid #3E2A1B;box-shadow:4px 4px 0 #14100C;max-width:400px;font-family:NotoPixelCN,sans-serif}',
      '.fleet-dialog h3{margin:0 0 12px;color:#17324A;font-size:16px}',
      '.fleet-dialog p{margin:0 0 16px;font-size:13px;color:#3E2A1B;line-height:1.5}',
      '.fleet-dialog-actions{display:flex;gap:8px;justify-content:flex-end}',
      '.fleet-start-center{text-align:center;padding:20px 0}',
      '.fleet-start-center h2{margin:0 0 16px;color:#17324A;font-size:20px}',
      '.fleet-start-center p{margin:0 0 20px;font-size:13px;color:#3E2A1B;line-height:1.6}',
      '.fleet-learn{margin:8px 0;padding:8px 10px;background:#E8D7B0;border:1px dashed #8C6A4F;font-size:12px;color:#3E2A1B;line-height:1.6}',
      '.fleet-learn b{color:#17324A}',
      '.fleet-learn-options{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}',
      '.fleet-learn-options .fleet-btn{min-height:30px;padding:4px 8px;font-size:11px;text-align:left}',
      '.fleet-learn-note{margin:4px 0 0;font-size:11px;color:#6B4A2F}',
      '.fleet-replay-line{margin:4px 0 0;padding-left:10px;border-left:2px solid #C89B3C;font-size:12px;line-height:1.6}',
      '.fleet-section details.fleet-learn{margin-top:6px}',
      '.fleet-section details.fleet-learn summary{cursor:pointer;color:#17324A}',
      '.fleet-section details.fleet-learn div{font-size:12px;color:#3E2A1B;line-height:1.6}'
    ].join('\n');
    doc().head.appendChild(st);
  }

  /* ── DOM 构建 ── */
  function ensureOverlay() {
    if (overlay) return;
    injectStyle();
    overlay = doc().createElement('div');
    overlay.id = 'fleet-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<div id="fleet-panel">'
      + '<div id="fleet-header"><h2 id="fleet-title">商会船队风险盘</h2><button id="fleet-close" type="button" aria-label="关闭风险盘">\u00d7</button></div>'
      + '<div id="fleet-body"></div>'
      + '</div>';
    doc().body.appendChild(overlay);
    panelBody = overlay.querySelector('#fleet-body');
    overlay.querySelector('#fleet-close').addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  }

  /* ── 公开 API ── */
  function open() {
    ensureOverlay();
    if (global.GameInputLocks && global.GameInputLocks.acquire) {
      global.GameInputLocks.acquire('fleet-panel');
    }
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');

    var camp = runtime().getCampaign();
    if (!camp) {
      currentView = 'campaign-start';
    } else if (camp.phase === 'completed' || camp.phase === 'insolvent') {
      currentView = 'summary';
      summaryTab = 'overview';
    } else {
      currentView = 'planning';
      plStep = 1;
    }
    render();
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    if (global.GameInputLocks && global.GameInputLocks.release) {
      global.GameInputLocks.release('fleet-panel');
    }
  }

  /* ── 渲染分发 ── */
  function render() {
    if (!panelBody) return;
    var camp = runtime().getCampaign();

    if (currentView === 'campaign-start') renderCampaignStart(camp);
    else if (currentView === 'planning') renderPlanning(camp);
    else if (currentView === 'result') renderResult(camp);
    else if (currentView === 'summary') renderSummary(camp);
  }

  /* ── 辅助函数 ── */
  function routeName(routeId) {
    if (!routeId) return '留港';
    var r = model().findRoute(routeId);
    return r ? r.name : '未知航线';
  }

  function shipName(shipId) {
    var v = model().findVessel(shipId);
    return v ? v.name : '未知船只';
  }

  function batchNameOf(batchId) {
    if (!batchId) return '未知船材批次';
    var list = config().batches || [];
    for (var i = 0; i < list.length; i++) if (list[i].batchId === batchId) return list[i].name;
    return '未知船材批次';
  }

  function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  /* ── Campaign Start 视图 ── */
  function renderCampaignStart(camp) {
    var html = '<div class="fleet-start-center">';
    html += '<h2>商会船队风险盘</h2>';
    html += '<p>你将经营一支由 6 艘船组成的商队，在 5 个回合内往返于三条航线。<br>';
    html += '风暴、批次缺陷、事故风险——分散航线、预留准备金、购买再保险以应对不确定性。</p>';

    if (camp && (camp.phase === 'completed' || camp.phase === 'insolvent')) {
      html += '<p>上一局已结束。</p>';
      html += '<div class="fleet-actions" style="justify-content:center">';
      html += '<button class="fleet-btn primary" data-action="new-campaign">开始新一局</button>';
      html += '<button class="fleet-btn secondary" data-action="view-summary">查看总结</button>';
      html += '</div>';
    } else if (camp && camp.phase === 'planning') {
      html += '<p>有一局正在经营中（第 ' + camp.currentRound + '/' + camp.totalRounds + ' 回合）。</p>';
      html += '<div class="fleet-actions" style="justify-content:center">';
      html += '<button class="fleet-btn primary" data-action="continue-campaign">继续经营</button>';
      html += '<button class="fleet-btn danger" data-action="abandon-start">放弃并重新开始</button>';
      html += '</div>';
    } else {
      html += '<div class="fleet-actions" style="justify-content:center">';
      html += '<button class="fleet-btn primary" data-action="new-campaign">开始新一局</button>';
      html += '</div>';
    }
    html += '</div>';

    panelBody.innerHTML = html;
    bindCampaignStartEvents();
  }

  function bindCampaignStartEvents() {
    var newBtn = panelBody.querySelector('[data-action="new-campaign"]');
    if (newBtn) newBtn.addEventListener('click', function() {
      var r = runtime().startCampaign();
      if (r.ok) {
        currentView = 'planning';
        render();
      }
    });

    var contBtn = panelBody.querySelector('[data-action="continue-campaign"]');
    if (contBtn) contBtn.addEventListener('click', function() {
      currentView = 'planning';
      render();
    });

    var sumBtn = panelBody.querySelector('[data-action="view-summary"]');
    if (sumBtn) sumBtn.addEventListener('click', function() {
      currentView = 'summary';
      render();
    });

    var abBtn = panelBody.querySelector('[data-action="abandon-start"]');
    if (abBtn) abBtn.addEventListener('click', function() {
      var r = runtime().abandonCampaign();
      if (r.ok) {
        var r2 = runtime().startCampaign();
        if (r2.ok) {
          currentView = 'planning';
          render();
        }
      }
    });
  }

  /* patch-fleet-steps A1 planning-step UI 20260904 */
  /* ── Planning 视图：4 步（安排船队 → 检查共同风险 → 资金防护 → 确认方案） ── */
  var STEP_TITLES = ['安排船队', '检查共同风险', '资金防护', '确认方案'];

  function stepBar(camp, step) {
    var html = '<div class="fleet-stepbar">';
    for (var i = 0; i < STEP_TITLES.length; i++) {
      var n = i + 1;
      html += '<div class="fleet-step' + (n === step ? ' active' : (n < step ? ' done' : '')) + '">' + STEP_TITLES[i] + (n < step ? '<b>✓</b>' : '') + '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderPlanning(camp) {
    var html = '<div class="fleet-bar">'
      + '<span>回合 <b>' + camp.currentRound + '</b>/' + camp.totalRounds + '</span>'
      + '<span>经营资金 <b>' + fmt(camp.operatingCash) + '</b></span>'
      + '<span>准备金 <b>' + fmt(camp.reserve) + '</b></span>'
      + '<span>总资金 <b>' + fmt(camp.operatingCash + camp.reserve) + '</b></span>'
      + '</div>';
    html += stepBar(camp, plStep);
    if (plStep === 1) html += stepVesselsHtml(camp);
    else if (plStep === 2) html += stepRiskHtml(camp);
    else if (plStep === 3) html += stepFundsHtml(camp);
    else html += stepConfirmHtml(camp);
    panelBody.innerHTML = html;
    bindStepEvents(camp);
  }

  /* QA 暂停出航的船：第 1 回合全部选择禁用（含留港，方案已固定） */
  function qaHeldVessel(camp, shipId) {
    var e = qaEffectFor(camp, shipId);
    return !!(e && e.holdRound1 && camp.currentRound === 1);
  }

  function stepVesselsHtml(camp) {
    var cfg = config();
    var vessels = cfg.vessels;
    var routes = cfg.routes;
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">' + STEP_TITLES[0] + '</h3>'
      + '<p class="fleet-step-note">先决定每艘船走哪条航线，还是留港。选择立即生效、随时可改，提交后才不可改。</p>';
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var assigned = camp.assignments[v.shipId];
      var held = qaHeldVessel(camp, v.shipId);
      var qaE = qaEffectFor(camp, v.shipId);
      html += '<div class="fleet-vessel">';
      html += '<b>' + v.name + '</b> · 货值 ' + v.cargoValue + ' · 基础风险 ' + Math.round(v.baseRisk * 100) + '% · 船体 ' + v.hull + ' · 船材 ' + batchNameOf(v.batchId);
      if (qaE) html += '<div class="fleet-info" style="margin:6px 0 0">' + qaCardText(qaE, camp) + '</div>';
      html += '<div class="fleet-route-btns">';
      for (var j = 0; j < routes.length; j++) {
        var r = routes[j];
        var sel = assigned === r.routeId ? ' selected' : '';
        html += '<button class="fleet-btn' + sel + (held ? ' disabled' : '') + '" data-ship="' + v.shipId + '" data-route="' + r.routeId + '">'
          + r.name + '<br><span style="font-size:10px">收益' + Math.round(r.yieldRate * 100) + '% 风险' + Math.round(r.baseRisk * 100) + '%</span></button>';
      }
      var staySel = assigned === null ? ' selected' : '';
      html += '<button class="fleet-btn stay' + staySel + (held ? ' disabled' : '') + '" data-ship="' + v.shipId + '" data-route="null">留港</button>';
      html += '</div></div>';
    }
    var stayCount = 0;
    var bestYield = 0;
    for (var b = 0; b < routes.length; b++) if (routes[b].yieldRate > bestYield) bestYield = routes[b].yieldRate;
    var stayCost = 0;
    for (var c = 0; c < vessels.length; c++) {
      if (camp.assignments[vessels[c].shipId] === null) {
        stayCount++;
        stayCost += vessels[c].cargoValue * bestYield;
      }
    }
    if (stayCount > 0) html += '<div class="fleet-info">' + stayCount + ' 艘船留港，放弃约 <b>' + fmt(stayCost) + '</b> 最高预期收入。</div>';
    html += '</div>';
    html += '<div class="fleet-actions">'
      + '<button class="fleet-btn primary" data-goto="2">下一步：检查共同风险</button>'
      + '<button class="fleet-btn danger" data-abandon-step>放弃这一局</button>'
      + '</div>';
    return html;
  }

  /* 风暴季客观状态：不在季 / 季内（各航线暴露折叠）/ 已结束 */
  function stormWindowBlock(camp) {
    var cr = config().commonRisk;
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">风暴季</h3>';
    if (camp.currentRound < cr.stormWindowStart) {
      html += '<div class="fleet-info">当前不在风暴季。风暴季从第 ' + cr.stormWindowStart + ' 回合开始。</div>';
    } else if (camp.currentRound <= cr.stormWindowEnd) {
      var stormParts = [];
      var routes = config().routes;
      for (var si = 0; si < routes.length; si++) {
        stormParts.push(routes[si].name + ' ' + Math.round(routes[si].stormExposure * 100) + '%');
      }
      html += '<div class="fleet-warning"><b>风暴季</b>：第 ' + cr.stormWindowStart + '~' + cr.stormWindowEnd + ' 回合。风暴是否出现，结算前无法预知。'
        + '<details class="fleet-learn" style="margin:6px 0 0"><summary>查看含义：各航线风暴暴露度</summary><div>'
        + stormParts.join('、') + '。同一条航线上的船会共同面对同一场风暴；分散航线可以减少共同暴露，但不能消除风暴本身。</div></details></div>';
    } else {
      html += '<div class="fleet-info">风暴季已结束。</div>';
    }
    html += '</div>';
    return html;
  }

  function stepRiskHtml(camp) {
    var cfg = config();
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">' + STEP_TITLES[1] + '</h3>'
      + '<p class="fleet-step-note">只看事实：当前方案里，哪些船共享同一航线、同一船材批次。不做评价，也不替你决定。</p>';
    var prevRound = camp.rounds.length > 0 ? camp.rounds[camp.rounds.length - 1] : null;
    if (prevRound && prevRound.round === camp.currentRound - 1) {
      var prevEvents = roundEvents(prevRound);
      if (prevEvents.length > 0) {
        html += '<details class="fleet-learn"><summary>上一轮观察：' + prevEvents.length + ' 起多船同损</summary><div>';
        for (var le = 0; le < prevEvents.length; le++) html += '<div class="fleet-replay-line">' + shortEventText(prevEvents[le]) + '</div>';
        html += '<div class="fleet-learn-note">风险盘只记录你的实际安排，不做评价，不自动降低风险。</div></div></details>';
      }
    }
    html += '</div>';

    html += stormWindowBlock(camp);

    html += '<div class="fleet-section"><h3 class="fleet-section-title">当前方案里的共享来源</h3>';
    var vessels = cfg.vessels;
    var routeCounts = {};
    var anyRoute = false;
    for (var ri = 0; ri < vessels.length; ri++) {
      var rid = camp.assignments[vessels[ri].shipId];
      if (rid) routeCounts[rid] = (routeCounts[rid] || 0) + 1;
    }
    var rkeys = Object.keys(routeCounts);
    for (var rk = 0; rk < rkeys.length; rk++) {
      if (routeCounts[rkeys[rk]] > 1) {
        anyRoute = true;
        html += '<div class="fleet-warning"><b>' + routeName(rkeys[rk]) + '</b>：' + routeCounts[rkeys[rk]] + ' 艘船同时出航'
          + '<details class="fleet-learn" style="margin:6px 0 0"><summary>查看含义</summary><div>同一条航线上的船共同面对同一场风暴：如果风暴出现，它们会一起暴露。结算前无法预知风暴是否出现。</div></details></div>';
      }
    }
    html += batchShareBlocks(camp);
    var qaEs = qaEffects(camp);
    for (var qp = 0; qp < qaEs.length; qp++) {
      var peerWarn = qaPeerWarning(camp, qaEs[qp]);
      if (peerWarn) html += peerWarn;
    }
    if (!anyRoute && sharedBatchGroups().length === 0) {
      html += '<div class="fleet-info">当前方案没有多艘船共享同一航线或同一船材批次。</div>';
    }
    html += '</div>';

    if (camp.learningFocus && camp.learningFocus.choice && camp.learningFocus.round === camp.currentRound) {
      html += '<div class="fleet-learn">本轮风险关注已记录：<b>' + focusLabel(camp.learningFocus.choice) + '</b>（不做评价，不影响结算）。</div>';
    }
    if (focusAskVisible(camp)) {
      html += '<div class="fleet-section"><h3 class="fleet-section-title">本轮风险关注</h3>';
      html += '<div class="fleet-learn">只问一次、不做评价、不影响结算。当前方案已出现航线或批次集中，你比较担心哪一种共同风险？';
      html += '<div class="fleet-learn-options">';
      for (var fo = 0; fo < FOCUS_ORDER.length; fo++) {
        html += '<button class="fleet-btn secondary" data-learning="' + FOCUS_ORDER[fo][0] + '">' + FOCUS_ORDER[fo][1] + '</button>';
      }
      html += '<button class="fleet-btn" data-learning="skip">暂时不选，直接提交</button>';
      html += '</div></div></div>';
    }

    html += '<div class="fleet-actions">'
      + '<button class="fleet-btn secondary" data-goto="1">返回修改船队</button>'
      + '<button class="fleet-btn primary" data-goto="3">继续：设置资金防护</button>'
      + '</div>';
    return html;
  }

  function stepFundsHtml(camp) {
    var cfg = config();
    var vessels = cfg.vessels;
    var sailingCargoTotal = 0;
    for (var s = 0; s < vessels.length; s++) {
      if (camp.assignments[vessels[s].shipId]) sailingCargoTotal += vessels[s].cargoValue;
    }
    var riCost = sailingCargoTotal * cfg.reinsurance.premiumRate;
    var expected = runtime().getExpected();
    var pressure = expected ? expected.expectedCargoLoss : 0;
    var totalFunds = camp.operatingCash + camp.reserve;
    var reserveRatio = totalFunds > 0 ? (camp.reserve / totalFunds * 100) : 0;

    var html = '<div class="fleet-section"><h3 class="fleet-section-title">' + STEP_TITLES[2] + '</h3>'
      + '<p class="fleet-step-note">把能用来扛损失的资源摆在一起：准备金多少、再保险分担多少、预期的主要损失要多少钱扛。</p>';
    html += '<div class="fleet-stat-chips">'
      + '<span class="fleet-summary-stat">经营资金 <b>' + fmt(camp.operatingCash) + '</b></span>'
      + '<span class="fleet-summary-stat">准备金 <b>' + fmt(camp.reserve) + '</b></span>'
      + '<span class="fleet-summary-stat">本轮再保险费用 <b>' + fmt(riCost) + '</b></span>'
      + '<span class="fleet-summary-stat">预期货损压力 <b>' + fmt(pressure) + '</b></span>'
      + '</div>';
    html += '<div class="fleet-reserve-row"><label>准备金</label><b>' + fmt(camp.reserve) + '</b>';
    html += '<button class="fleet-btn secondary" data-reserve-down' + (camp.reserve <= 0 ? ' disabled' : '') + '>-' + cfg.capital.reserveStep + '</button>';
    html += '<button class="fleet-btn secondary" data-reserve-up' + (camp.reserve >= cfg.capital.maxReserve ? ' disabled' : '') + '>+' + cfg.capital.reserveStep + '</button>';
    html += '</div>';
    html += '<div class="fleet-info">准备金上限 ' + cfg.capital.maxReserve + '。准备金越多，抗损失能力越强，但可用于经营的资金越少。准备金占比 <b>' + fmt(reserveRatio) + '%</b>';
    if (reserveRatio < 20) html += ' · <span style="color:#8C3A2E">抗风险能力较弱</span>';
    else if (reserveRatio > 50) html += ' · <span style="color:#5A6B4A">抗风险能力较强</span>';
    html += '</div>';
    html += '<details class="fleet-learn" style="margin-top:8px"><summary>查看含义：再保险规则</summary><div>再保险自动购买：费率 ' + Math.round(cfg.reinsurance.premiumRate * 100) + '% · 单次事故自留额 ' + cfg.reinsurance.perClaimThreshold + ' · 超出部分再保险承担 ' + Math.round(cfg.reinsurance.coverRate * 100) + '%。本轮费用 ' + fmt(riCost) + '（按出航船只货值计）。</div></details>';
    if (expected) {
      html += '<details class="fleet-learn" style="margin-top:8px"><summary>查看含义：本轮事前预期</summary><div>预期收入 ' + fmt(expected.expectedVoyageIncome) + ' · 预期货损 ' + fmt(expected.expectedCargoLoss) + ' · 再保险费 ' + fmt(expected.expectedReinsuranceCost) + ' · 预期净利润 ' + fmt(expected.expectedNetResult) + '</div></details>';
    }
    html += '</div>';
    html += '<div class="fleet-actions">'
      + '<button class="fleet-btn secondary" data-goto="2">上一步：检查共同风险</button>'
      + '<button class="fleet-btn primary" data-goto="4">下一步：确认方案</button>'
      + '</div>';
    return html;
  }

  /* 航线集中与已确认批次缺陷（提交前重申；不含评价与建议） */
  function riskWarningRows(camp) {
    var cfg = config();
    var html = '';
    var vessels = cfg.vessels;
    var routeCounts = {};
    for (var i = 0; i < vessels.length; i++) {
      var rid = camp.assignments[vessels[i].shipId];
      if (rid) routeCounts[rid] = (routeCounts[rid] || 0) + 1;
    }
    var rkeys = Object.keys(routeCounts);
    for (var rk = 0; rk < rkeys.length; rk++) {
      if (routeCounts[rkeys[rk]] > 1) {
        html += '<div class="fleet-warning"><b>' + routeName(rkeys[rk]) + '</b>：' + routeCounts[rkeys[rk]] + ' 艘船同航。</div>';
      }
    }
    var groups = sharedBatchGroups();
    for (var g = 0; g < groups.length; g++) {
      if (batchDefectSeen(camp, groups[g].batchId)) {
        html += '<div class="fleet-warning"><b>' + batchNameOf(groups[g].batchId) + '</b>：' + groupShipNames(groups[g].ships) + ' 使用这批船材，本局已确认它存在问题。</div>';
      }
    }
    if (!html) html = '<div class="fleet-info">当前方案没有航线集中，也没有本局已确认有问题的船材批次。</div>';
    return html;
  }

  function stepConfirmHtml(camp) {
    var cfg = config();
    var vessels = cfg.vessels;
    var expected = runtime().getExpected();
    var sailing = [];
    var staying = [];
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var rid = camp.assignments[v.shipId];
      if (rid) sailing.push(v.name + '→' + routeName(rid));
      else staying.push(v.name);
    }
    var sailingCargoTotal = 0;
    for (var j = 0; j < vessels.length; j++) {
      if (camp.assignments[vessels[j].shipId]) sailingCargoTotal += vessels[j].cargoValue;
    }
    var riCost = sailingCargoTotal * cfg.reinsurance.premiumRate;
    var totalFunds = camp.operatingCash + camp.reserve;
    var reserveRatio = totalFunds > 0 ? (camp.reserve / totalFunds * 100) : 0;

    var html = '<div class="fleet-section"><h3 class="fleet-section-title">' + STEP_TITLES[3] + '</h3>'
      + '<p class="fleet-step-note">下面是你即将提交的全部内容。提交后立即结算本轮，不能返回修改。</p>';
    html += '<div class="fleet-info"><b>船队安排</b>：出航 ' + sailing.length + ' 艘——' + (sailing.length ? sailing.join('；') : '无');
    if (staying.length > 0) html += '；留港 ' + staying.length + ' 艘——' + staying.join('、');
    html += '。</div>';
    html += '<div class="fleet-info"><b>资金账目</b>：经营资金 ' + fmt(camp.operatingCash) + ' · 准备金 ' + fmt(camp.reserve) + '（占 ' + fmt(reserveRatio) + '%）· 本轮再保险费用 ' + fmt(riCost) + '。</div>';
    html += '<div class="fleet-section" style="margin-top:10px"><h3 class="fleet-section-title">提交前再看一眼</h3>';
    html += riskWarningRows(camp);
    if (expected) {
      html += '<details class="fleet-learn"><summary>查看含义：本轮事前预期</summary><div>预期收入 ' + fmt(expected.expectedVoyageIncome) + ' · 预期货损 ' + fmt(expected.expectedCargoLoss) + ' · 再保险费 ' + fmt(expected.expectedReinsuranceCost) + ' · 预期净利润 ' + fmt(expected.expectedNetResult) + '</div></details>';
    }
    html += '</div>';
    html += '<div class="fleet-actions">'
      + '<button class="fleet-btn secondary" data-goto="1">返回修改</button>'
      + '<button class="fleet-btn primary" data-step-submit>提交本轮方案</button>'
      + '</div>';
    return html;
  }

  function bindStepEvents(camp) {
    function q(sel) { return panelBody.querySelector(sel); }
    var routeButtons = panelBody.querySelectorAll('[data-ship][data-route]');
    for (var i = 0; i < routeButtons.length; i++) {
      routeButtons[i].addEventListener('click', function() {
        var shipId = this.getAttribute('data-ship');
        var routeId = this.getAttribute('data-route');
        runtime().setAssignment(shipId, routeId === 'null' ? null : routeId);
        render();
      });
    }
    var upBtn = q('[data-reserve-up]');
    if (upBtn) upBtn.addEventListener('click', function() {
      runtime().setReserve(camp.reserve + config().capital.reserveStep);
      render();
    });
    var downBtn = q('[data-reserve-down]');
    if (downBtn) downBtn.addEventListener('click', function() {
      runtime().setReserve(camp.reserve - config().capital.reserveStep);
      render();
    });
    var gotoBtns = panelBody.querySelectorAll('[data-goto]');
    for (var gi = 0; gi < gotoBtns.length; gi++) {
      gotoBtns[gi].addEventListener('click', function() {
        var target = Number(this.getAttribute('data-goto')) || 1;
        plStep = target < 1 ? 1 : (target > 4 ? 4 : target);
        render();
      });
    }
    var submitBtn = q('[data-step-submit]');
    if (submitBtn) submitBtn.addEventListener('click', function() {
      showConfirmDialog('提交本轮方案', '提交后立即结算本轮，不能返回修改。确认提交？', function() {
        var r = runtime().submitPlan();
        if (r.ok) {
          plStep = 1;
          resPage = 1;
          currentView = 'result';
          render();
        } else {
          showToast(r.reason || '结算失败');
        }
      });
    });
    var abandonBtn = q('[data-abandon-step]');
    if (abandonBtn) abandonBtn.addEventListener('click', function() {
      showConfirmDialog('放弃这一局', '确认放弃当前这一局？将归档并结束。', function() {
        var r = runtime().abandonCampaign();
        if (r.ok) {
          plStep = 1;
          currentView = 'campaign-start';
          render();
        }
      });
    });
    var learnButtons = panelBody.querySelectorAll('[data-learning]');
    for (var lb = 0; lb < learnButtons.length; lb++) {
      learnButtons[lb].addEventListener('click', function() {
        var key = this.getAttribute('data-learning');
        runtime().setLearningFocus(key === 'skip' ? null : key);
        render();
      });
    }
  }
  function showConfirmDialog(title, message, onConfirm) {
    var dlg = doc().createElement('div');
    dlg.className = 'fleet-dialog-overlay';
    dlg.innerHTML = '<div class="fleet-dialog">'
      + '<h3>' + title + '</h3>'
      + '<p>' + message + '</p>'
      + '<div class="fleet-dialog-actions">'
      + '<button class="fleet-btn secondary" data-dialog="cancel">取消</button>'
      + '<button class="fleet-btn primary" data-dialog="confirm">确认</button>'
      + '</div></div>';
    doc().body.appendChild(dlg);

    dlg.querySelector('[data-dialog="cancel"]').addEventListener('click', function() {
      doc().body.removeChild(dlg);
    });
    dlg.querySelector('[data-dialog="confirm"]').addEventListener('click', function() {
      doc().body.removeChild(dlg);
      onConfirm();
    });
  }

  function showToast(message) {
    var toast = doc().createElement('div');
    toast.className = 'fleet-dialog-overlay';
    toast.innerHTML = '<div class="fleet-dialog">' +
      '<h3>提示</h3>' +
      '<p>' + message + '</p>' +
      '<div class="fleet-dialog-actions">' +
      '<button class="fleet-btn primary" data-dialog="ok">确定</button>' +
      '</div></div>';
    doc().body.appendChild(toast);
    toast.querySelector('[data-dialog="ok"]').addEventListener('click', function() {
      doc().body.removeChild(toast);
    });
  }

  /* ── 共同风险学习反馈（只读渲染；写入只经 FleetRuntime / FleetLearning） ── */
  var FOCUS_LABELS = { route: '多艘船同时走同一条航线', departure: '多艘船在相近时间出航', batch: '多艘船使用同一船材批次', none: '暂时没有特别关注的风险' };
  var FOCUS_ORDER = [['route', '多艘船同时走同一条航线'], ['departure', '多艘船在相近时间出航'], ['batch', '多艘船使用同一船材批次'], ['none', '暂时没有特别关注的风险']];

  /* ── 质检关联（shipyard→fleet）：只读客观信息，不自动改方案 ── */
  var QA_DECISION_LABELS = { release: '直接放行', repair_partial: '局部返修', repair_full: '全面返修', hold: '暂停出航' };

  function qaEffects(camp) {
    return (camp && Array.isArray(camp.shipyardEffects)) ? camp.shipyardEffects : [];
  }

  function qaEffectFor(camp, shipId) {
    var es = qaEffects(camp);
    for (var i = 0; i < es.length; i++) if (es[i].shipId === shipId) return es[i];
    return null;
  }

  function qaModsOfCampaign(camp, round) {
    var map = null;
    var es = qaEffects(camp);
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      var mod = null;
      if (!(e.holdRound1 && round === 1)) mod = e.qaMod;
      if (typeof mod === 'number' && mod !== 1) {
        if (!map) map = {};
        map[e.shipId] = mod;
      }
    }
    return map;
  }

  function qaCardText(e, camp) {
    var total = (e.sampledCount || 0) + (e.uninspectedCount || 0);
    var html = '<span style="color:#3E2A1B">曾在造船厂接受抽样检查：已检查 <b>' + e.sampledCount + '</b>/' + total + ' 个部位 · 仍有 <b>' + e.uninspectedCount + '</b> 个部位未检查 · 发现 <b>' + e.foundCount + '</b> 处缺陷 · 处置：' + (QA_DECISION_LABELS[e.decision] || e.decision) + '。</span>';
    if (e.holdRound1 && camp.currentRound === 1) {
      html += '<br><span style="color:#8C3A2E">质检：暂停出航——本回合自动留港，不承担风险也不产生收入；第 2 回合起可重新安排。</span>';
    } else if (typeof e.qaMod === 'number') {
      if (e.repairLevel === 'full') {
        html += '<br>已处理（全面返修）：整体风险下降，本次出航事故概率修正 \u00d7' + e.qaMod.toFixed(2) + '。';
      } else if (e.repairLevel === 'partial') {
        html += '<br>' + (e.remainingCount > 0
          ? '样本中的缺陷已返修，仍有 ' + e.remainingCount + ' 处实际缺陷未处理（未检查部位），修正 \u00d7' + e.qaMod.toFixed(2)
          : '样本发现的缺陷已全部返修，修正 \u00d7' + e.qaMod.toFixed(2)) + '。';
      } else if (e.repairLevel === 'none') {
        html += '<br>' + (e.remainingCount > 0
          ? '有 ' + e.remainingCount + ' 处实际缺陷在未检查部位随船出航，修正 \u00d7' + e.qaMod.toFixed(2)
          : '样本没有发现问题——未检查部位仍是未知状态，不标记为绝对安全') + '。';
      } else if (e.repairLevel === 'hold') {
        html += '<br>船在船台错过这一潮；第 2 回合起出航时修正 \u00d7' + e.qaMod.toFixed(2) + '（实际缺陷仍未处理）。';
      }
    }
    return html;
  }

  function qaPeerWarning(camp, e) {
    var cfg = config();
    var vessels = cfg.vessels;
    var batchOf = null;
    var peers = [];
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      if (v.shipId === e.shipId) { batchOf = v.batchId; continue; }
      if (v.shipId !== e.shipId && v.batchId && batchOf === null) continue;
    }
    if (batchOf === null) return '';
    for (var j = 0; j < vessels.length; j++) {
      var w = vessels[j];
      if (w.shipId !== e.shipId && w.batchId === batchOf) peers.push(w.name);
    }
    if (peers.length === 0 || e.remainingCount <= 0) return '';
    var shipLabel = e.shipName || shipName(e.shipId);
    return '<div class="fleet-warning">质检关联：' + shipLabel + ' 的船材批次（' + batchNameOf(batchOf) + '）已被实际检查：发现 ' + e.actualDefectCount + ' 处真实缺陷（未处理 ' + e.remainingCount + ' 处）。' + peers.join('、') + ' 与 ' + shipLabel + ' 共用这批船材——如果批次确实存在问题，它们共享同一来源。</div>';
  }

  function fleetLearning() { return global.FleetLearning; }

  function focusLabel(choice) { return FOCUS_LABELS[choice] || null; }

  function roundEvents(roundResult) {
    var fl = fleetLearning();
    return (fl && fl.analyzeRound && roundResult) ? (fl.analyzeRound(roundResult) || []) : [];
  }

  function hasConcentration(camp) {
    if (!camp || !camp.assignments) return false;
    var cfg = config();
    var vessels = cfg.vessels;
    var routeCounts = {};
    var batchCounts = {};
    for (var i = 0; i < vessels.length; i++) {
      var rid = camp.assignments[vessels[i].shipId];
      if (rid) {
        routeCounts[rid] = (routeCounts[rid] || 0) + 1;
        batchCounts[vessels[i].batchId] = (batchCounts[vessels[i].batchId] || 0) + 1;
      }
    }
    var rks = Object.keys(routeCounts);
    for (var j = 0; j < rks.length; j++) { if (routeCounts[rks[j]] >= 2) return true; }
    var bks = Object.keys(batchCounts);
    for (var k = 0; k < bks.length; k++) { if (batchCounts[bks[k]] >= 2) return true; }
    return false;
  }

  function focusAskVisible(camp) {
    if (!camp || camp.phase !== 'planning') return false;
    if (camp.learningFocus && camp.learningFocus.shown) return false;
    var fl = fleetLearning();
    if (fl && fl.hasEncounterForCampaign && fl.hasEncounterForCampaign(camp.campaignId)) return false;
    return hasConcentration(camp);
  }

  function eventHitText(ev) {
    if (ev.type === 'storm') {
      return ev.names.join('、') + ' 在同一回合同受' + routeName(ev.sourceId) + '风暴影响';
    }
    return ev.names.join('、') + ' 使用同一批船材（' + batchNameOf(ev.sourceId) + '）并同时受损';
  }

  function eventShareSourceText(ev) {
    if (ev.type === 'storm') {
      return routeName(ev.sourceId) + ' 上的风暴';
    }
    return '同一批船材（' + batchNameOf(ev.sourceId) + '）存在缺陷';
  }

  function eventCardHtml(ev) {
    var html = '<div class="fleet-info"><b>发生了什么：</b>' + eventHitText(ev) + '。<br>';
    html += '<div class="fleet-replay-line">共享风险来源：' + eventShareSourceText(ev) + '。</div>';
    if (ev.type === 'storm') {
      html += '<div class="fleet-replay-line">它们在同一回合暴露于同一条航线，因此损失同时发生——这不是几次互不相关的事故。</div>';
    } else {
      html += '<div class="fleet-replay-line">本轮该批次的问题同时影响这些船；增加船只数量没有消除这个共同来源。</div>';
    }
    html += '<div class="fleet-replay-line">共同损失：' + fmt(ev.totalLoss) + '。</div></div>';
    return html;
  }

  function shortEventText(ev) {
    return eventHitText(ev) + '（共享来源：' + eventShareSourceText(ev) + '）。';
  }

  function actualOutcomeText(events) {
    var parts = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type === 'storm') {
        parts.push(ev.names.join('、') + ' 同时受' + routeName(ev.sourceId) + '风暴影响');
      } else {
        parts.push(ev.names.join('、') + ' 同时受同一批船材（' + batchNameOf(ev.sourceId) + '）缺陷影响');
      }
    }
    return parts.join('；');
  }

  /* 船材批次风险的解释文案（折叠区共用；不含内部 id，不预告隐藏缺陷） */
  var BATCH_RISK_EXPLAIN = '商队的船分批使用船体材料。同一批船材若有缺陷，几艘同批船就共享同一来源——同批船在同一回合出航，可能一起受损。某批船材是否真的有问题，结算之前无法预知，只能从结算结果中确认。让同批船错开回合出航或留港，可以避免多艘船同时受损，但船材本身的问题不会因此消失；不同批次之间互不影响。';

  function batchInDefects(roundResult, batchId) {
    var defs = (roundResult && Array.isArray(roundResult.batchDefects)) ? roundResult.batchDefects : [];
    for (var i = 0; i < defs.length; i++) if (defs[i] === batchId) return true;
    return false;
  }

  /* 配置中 >=2 艘船共用的船材批次组（只读分组；不改任何内部 id） */
  function sharedBatchGroups() {
    var byBatch = {};
    var list = config().vessels;
    for (var i = 0; i < list.length; i++) {
      var bid = list[i].batchId;
      if (!bid) continue;
      if (!byBatch[bid]) byBatch[bid] = [];
      byBatch[bid].push(list[i]);
    }
    var keys = Object.keys(byBatch);
    var groups = [];
    for (var k = 0; k < keys.length; k++) {
      if (byBatch[keys[k]].length >= 2) groups.push({ batchId: keys[k], ships: byBatch[keys[k]] });
    }
    return groups;
  }

  /* 该批次是否已在已结算回合中被确认存在问题（批次结论按局确定，一经确认后续回合都会列出） */
  function batchDefectSeen(camp, batchId) {
    if (!camp || !Array.isArray(camp.rounds)) return false;
    for (var i = 0; i < camp.rounds.length; i++) {
      if (batchInDefects(camp.rounds[i], batchId)) return true;
    }
    return false;
  }

  function groupShipNames(ships) {
    var names = [];
    for (var i = 0; i < ships.length; i++) names.push(ships[i].name);
    return names.join('、');
  }

  /* 规划页共同风险区：按“本局已确认问题 / 仅共享来源”解释；不预告隐藏缺陷，不给分散建议 */
  function batchShareBlocks(camp) {
    var html = '';
    var groups = sharedBatchGroups();
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var bname = batchNameOf(g.batchId);
      if (batchDefectSeen(camp, g.batchId)) {
        html += '<div class="fleet-warning"><b>' + bname + '</b>：' + groupShipNames(g.ships) + ' 使用这批船材，本局已确认它存在问题——同一缺陷可能让同批船同时受损。</div>';
      } else {
        html += '<div class="fleet-info"><b>' + bname + '</b>：' + groupShipNames(g.ships) + ' 使用这批船材，共享同一来源——如果它有问题，会影响所有同批船；本局目前还没有确认它有问题。</div>';
      }
    }
    if (groups.length > 0) {
      html += '<details class="fleet-learn"><summary>船材批次风险是什么？</summary><div>' + BATCH_RISK_EXPLAIN + '</div></details>';
    }
    return html;
  }

  /* 结算页：客观状态补充——同批同时出航 / 共享但未共同受损 / 留港未暴露 */
  function batchExposureBlocks(lastRound) {
    if (!lastRound || !Array.isArray(lastRound.vesselResults)) return '';
    var html = '';
    var groups = sharedBatchGroups();
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var sailors = [], stayers = [], lost = [];
      for (var j = 0; j < lastRound.vesselResults.length; j++) {
        var vr = lastRound.vesselResults[j];
        if (vr.batchId !== g.batchId) continue;
        if (!vr.sailing) stayers.push(vr);
        else {
          sailors.push(vr);
          if (vr.cargoLoss > 0) lost.push(vr);
        }
      }
      var bname = batchNameOf(g.batchId);
      if (sailors.length === 0 && stayers.length >= 2 && batchInDefects(lastRound, g.batchId)) {
        html += '<div class="fleet-warning"><b>' + bname + '</b>本回合已确认存在问题，但同批两船都留港——它们没有暴露在这一来源下。</div>';
        continue;
      }
      if (sailors.length === 1 && stayers.length === 1 && batchInDefects(lastRound, g.batchId)) {
        html += '<div class="fleet-warning"><b>' + bname + '</b>本回合已确认存在问题：' + sailors[0].name + ' 出航' + (lost.length > 0 ? '并受损' : '，本轮未受损') + '；' + stayers[0].name + ' 留港，没有与同批船同时暴露。</div>';
        continue;
      }
      if (sailors.length >= 2) {
        if (batchInDefects(lastRound, g.batchId)) {
          if (lost.length >= 2) continue;
          html += '<div class="fleet-warning"><b>' + bname + '</b>本回合已确认存在问题，同批两船都出航（' + sailors[0].name + '、' + sailors[1].name + '）——它们共享这一来源，本轮' + (lost.length === 1 ? '只有 ' + lost[0].name + ' 受损。' : '两船都未受损。') + '</div>';
        } else {
          html += '<div class="fleet-info"><b>' + bname + '</b>：' + sailors[0].name + '、' + sailors[1].name + ' 本回合同时出航，共享同一船材来源；本局还没有确认这批船材有问题。</div>';
        }
      }
    }
    return html;
  }

  function renderRoundLearning(lastRound, camp) {
    var events = roundEvents(lastRound);
    var focusChoice = null;
    if (camp && camp.learningFocus && camp.learningFocus.round === lastRound.round && camp.learningFocus.choice && camp.learningFocus.choice !== 'none') {
      focusChoice = camp.learningFocus.choice;
    }
    var exposure = batchExposureBlocks(lastRound);
    if (events.length === 0 && !focusChoice && !exposure) return '';
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">共同风险回放</h3>';
    if (focusChoice) {
      html += '<div class="fleet-learn">你本轮关注：<b>' + focusLabel(focusChoice) + '</b><br>';
      html += '实际发生：' + (events.length > 0 ? actualOutcomeText(events) : '本轮没有出现多艘船因同一来源同时受损的情况。') + '</div>';
    }
    for (var i = 0; i < events.length; i++) html += eventCardHtml(events[i]);
    if (events.length > 0) {
      var fl = fleetLearning();
      var co = fl && fl.coLossSummary ? fl.coLossSummary(lastRound, events) : { names: [], totalLoss: 0 };
      var independent = Math.round((lastRound.cargoLoss - co.totalLoss) * 100) / 100;
      html += '<div class="fleet-info"><b>组合影响：</b>共同风险损失合计 ' + fmt(co.totalLoss) + (co.names.length ? '（' + co.names.join('、') + '）' : '');
      html += ' ｜ 单船独立损失 ' + fmt(independent);
      html += ' ｜ 准备金：' + (lastRound.reserveUsed > 0 ? '动用 ' + fmt(lastRound.reserveUsed) : '未动用') + '。</div>';
    }
    html += exposure;
    html += '</div>';
    return html;
  }
  /* patch-fleet-steps A2 result pages 20260904 */
  /* ── Result 视图：3 页（本轮发生了什么 → 为什么会这样 → 资金账本） ── */
  var RES_PAGE_TITLES = ['本轮发生了什么', '为什么会这样', '资金账本'];

  function severityLabel(s) {
    if (s === 'total') return '全损';
    if (s === 'partial') return '部分受损';
    return String(s);
  }

  function resultPageChips() {
    var html = '<div class="fleet-stepbar">';
    for (var i = 0; i < RES_PAGE_TITLES.length; i++) {
      var n = i + 1;
      html += '<div class="fleet-step' + (n === resPage ? ' active' : (n < resPage ? ' done' : '')) + '">' + RES_PAGE_TITLES[i] + (n < resPage ? '<b>✓</b>' : '') + '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderResult(camp) {
    var lastRound = camp.rounds[camp.rounds.length - 1];
    if (!lastRound) { plStep = 1; currentView = 'planning'; render(); return; }
    if (resPage < 1) resPage = 1;
    else if (resPage > 3) resPage = 3;
    var html = '<div class="fleet-bar">'
      + '<span>第 <b>' + lastRound.round + '</b>/' + camp.totalRounds + ' 回合 · 结算</span>'
      + '<span>经营资金 <b>' + fmt(camp.operatingCash) + '</b></span>'
      + '<span>总资金 <b>' + fmt(camp.operatingCash + camp.reserve) + '</b></span>'
      + '</div>';
    html += resultPageChips();
    if (resPage === 1) html += resultPage1Html(lastRound, camp);
    else if (resPage === 2) html += resultPage2Html(lastRound, camp);
    else html += resultPage3Html(lastRound, camp);
    panelBody.innerHTML = html;
    bindResultEvents(camp);
  }

  function resultPage1Html(lastRound, camp) {
    var html = '';
    if (lastRound.storms.length > 0) {
      html += '<div class="fleet-warning"><b>风暴</b>：';
      var stormParts = [];
      for (var s = 0; s < lastRound.storms.length; s++) {
        stormParts.push(routeName(lastRound.storms[s].routeId) + '（强度 ' + fmt(lastRound.storms[s].severity) + '）');
      }
      html += stormParts.join('、') + '</div>';
    }
    if (lastRound.batchDefects.length > 0) {
      html += '<div class="fleet-warning"><b>批次缺陷</b>：';
      var defParts = [];
      for (var d = 0; d < lastRound.batchDefects.length; d++) {
        defParts.push(batchNameOf(lastRound.batchDefects[d]));
      }
      html += defParts.join('、') + ' 存在缺陷——使用这批船材的船，本轮事故风险已经上升。</div>';
    }
    if (lastRound.insolvent) {
      html += '<div class="fleet-warning"><b>资金缺口！</b>经营资金和准备金均不足以覆盖损失，本局到此终止。</div>';
    }
    html += '<div class="fleet-section"><h3 class="fleet-section-title">本轮账目</h3>';
    html += '<table class="fleet-result-table">';
    html += '<tr><td>航运收入</td><td><b>' + fmt(lastRound.voyageIncome) + '</b></td></tr>';
    html += '<tr><td>货损总额</td><td><b>' + fmt(lastRound.cargoLoss) + '</b></td></tr>';
    html += '<tr class="total"><td>资金净变化</td><td>' + fmt((lastRound.voyageIncome || 0) - (lastRound.reinsuranceCost || 0) - (lastRound.playerLoss || 0)) + '</td></tr>';
    html += '</table>';
    var expected = model().expectedRound(lastRound.assignments, camp.commonRiskState, camp.seed, lastRound.round, qaModsOfCampaign(camp, lastRound.round));
    if (expected) {
      html += '<details class="fleet-learn"><summary>对照事前预期</summary><div>';
      html += '<table class="fleet-result-table">';
      html += '<tr><th></th><th>预期</th><th>实际</th><th>差异</th></tr>';
      html += '<tr><td>航运收入</td><td>' + fmt(expected.expectedVoyageIncome) + '</td><td>' + fmt(lastRound.voyageIncome) + '</td><td>' + fmt(lastRound.voyageIncome - expected.expectedVoyageIncome) + '</td></tr>';
      html += '<tr><td>货损</td><td>' + fmt(expected.expectedCargoLoss) + '</td><td>' + fmt(lastRound.cargoLoss) + '</td><td>' + fmt(lastRound.cargoLoss - expected.expectedCargoLoss) + '</td></tr>';
      html += '<tr><td>再保险费</td><td>' + fmt(expected.expectedReinsuranceCost) + '</td><td>' + fmt(lastRound.reinsuranceCost) + '</td><td>' + fmt(lastRound.reinsuranceCost - expected.expectedReinsuranceCost) + '</td></tr>';
      html += '<tr><td>再保险回收</td><td>' + fmt(expected.expectedReinsuranceRecovery) + '</td><td>' + fmt(lastRound.reinsuranceRecovery) + '</td><td>' + fmt(lastRound.reinsuranceRecovery - expected.expectedReinsuranceRecovery) + '</td></tr>';
      html += '<tr class="total"><td>资金净变化</td><td>' + fmt(expected.expectedNetResult) + '</td><td>' + fmt((lastRound.voyageIncome || 0) - (lastRound.reinsuranceCost || 0) - (lastRound.playerLoss || 0)) + '</td><td>' + fmt(((lastRound.voyageIncome || 0) - (lastRound.reinsuranceCost || 0) - (lastRound.playerLoss || 0)) - expected.expectedNetResult) + '</td></tr>';
      html += '</table></div></details>';
    }
    html += '</div>';
    html += '<div class="fleet-section"><h3 class="fleet-section-title">逐船情况</h3>';
    html += '<table class="fleet-result-table">';
    html += '<tr><th>船名</th><th>航线</th><th>结果</th><th>收入</th><th>货损</th></tr>';
    for (var i = 0; i < lastRound.vesselResults.length; i++) {
      var vr = lastRound.vesselResults[i];
      var rowClass = !vr.sailing ? 'stayed' : (vr.accident ? 'accident' : 'safe');
      html += '<tr class="' + rowClass + '">';
      html += '<td>' + vr.name + '</td>';
      html += '<td>' + routeName(vr.routeId) + '</td>';
      html += '<td>' + (!vr.sailing ? '留港' : (vr.accident ? '事故：' + severityLabel(vr.severity) : '安全')) + '</td>';
      html += '<td>' + fmt(vr.voyageIncome) + '</td>';
      html += '<td>' + fmt(vr.cargoLoss) + '</td>';
      html += '</tr>';
    }
    html += '</table></div>';
    html += '<div class="fleet-actions">'
      + '<button class="fleet-btn primary" data-result-next>为什么会这样：查看原因</button>'
      + '</div>';
    return html;
  }

  function soloAccidents(lastRound, events) {
    var list = [];
    if (!lastRound || !Array.isArray(lastRound.vesselResults)) return list;
    var coNames = {};
    for (var i = 0; i < events.length; i++) {
      for (var j = 0; j < events[i].names.length; j++) coNames[events[i].names[j]] = true;
    }
    for (var v = 0; v < lastRound.vesselResults.length; v++) {
      var vr = lastRound.vesselResults[v];
      if (vr.sailing && vr.accident && !coNames[vr.name]) list.push(vr);
    }
    return list;
  }

  function soloAccidentHtml(vr) {
    var mods = [];
    if (vr.modifiers && vr.modifiers.storm) mods.push('风暴');
    if (vr.modifiers && vr.modifiers.batchDefect) mods.push('批次缺陷');
    if (typeof (vr.modifiers && vr.modifiers.qa) === 'number') mods.push('质检×' + vr.modifiers.qa.toFixed(2));
    var prob = (typeof vr.accidentProbability === 'number') ? Math.round(vr.accidentProbability * 1000) / 10 : null;
    var html = '<div class="fleet-info"><b>' + vr.name + '</b>（' + routeName(vr.routeId) + '）：本轮单船独立受损';
    if (vr.cargoLoss > 0) html += '，货损 ' + fmt(vr.cargoLoss);
    if (mods.length > 0) html += '；修正：' + mods.join('、');
    if (prob !== null) html += '；事前事故概率 ' + prob + '%';
    html += '。</div>';
    return html;
  }

  function resultPage2Html(lastRound, camp) {
    var html = '';
    var learningHtml = renderRoundLearning(lastRound, camp);
    if (learningHtml) {
      html += learningHtml;
    } else {
      html += '<div class="fleet-section"><h3 class="fleet-section-title">共同风险回放</h3>'
        + '<div class="fleet-info">本轮没有发生多艘船共同损失。</div></div>';
    }
    var events = roundEvents(lastRound);
    var solo = soloAccidents(lastRound, events);
    if (solo.length > 0) {
      html += '<div class="fleet-section"><h3 class="fleet-section-title">单船独立事故</h3>';
      for (var i = 0; i < solo.length; i++) html += soloAccidentHtml(solo[i]);
      html += '</div>';
    }
    html += '<div class="fleet-actions">'
      + '<button class="fleet-btn secondary" data-result-prev>上一步：本轮发生了什么</button>'
      + '<button class="fleet-btn primary" data-result-next>查看资金账本</button>'
      + '</div>';
    return html;
  }

  function resultPage3Html(lastRound, camp) {
    var ended = camp.phase === 'completed' || camp.phase === 'insolvent';
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">资金账本</h3>';
    html += '<table class="fleet-result-table">';
    html += '<tr><td>航运收入</td><td><b>' + fmt(lastRound.voyageIncome) + '</b></td></tr>';
    html += '<tr><td>货损总额</td><td><b>' + fmt(lastRound.cargoLoss) + '</b></td></tr>';
    html += '<tr><td>再保险费用</td><td><b>' + fmt(lastRound.reinsuranceCost) + '</b></td></tr>';
    html += '<tr><td>再保险分担（回收）</td><td><b>' + fmt(lastRound.reinsuranceRecovery) + '</b></td></tr>';
    html += '<tr><td>准备金动用</td><td><b>' + fmt(lastRound.reserveUsed || 0) + '</b></td></tr>';
    html += '<tr class="total"><td>资金净变化</td><td>' + fmt((lastRound.voyageIncome || 0) - (lastRound.reinsuranceCost || 0) - (lastRound.playerLoss || 0)) + '</td></tr>';
    html += '</table>';
    html += '<div class="fleet-reserve-row"><label>经营资金</label><span>' + fmt(lastRound.operatingCashBefore) + ' → <b>' + fmt(lastRound.operatingCashAfter) + '</b></span></div>';
    html += '<div class="fleet-reserve-row"><label>准备金</label><span>' + fmt(lastRound.reserveBefore) + ' → <b>' + fmt(lastRound.reserveAfter) + '</b></span></div>';
    html += '<div class="fleet-reserve-row"><label>总资金</label><span>' + fmt(lastRound.operatingCashBefore + lastRound.reserveBefore) + ' → <b>' + fmt(lastRound.totalFundsAfter) + '</b></span></div>';
    if (lastRound.insolvent) {
      html += '<div class="fleet-warning"><b>资金缺口！</b>经营资金和准备金均不足以覆盖损失，本局到此终止。</div>';
    }
    html += '</div>';
    html += '<div class="fleet-actions">';
    html += '<button class="fleet-btn secondary" data-result-prev>上一步：为什么会这样</button>';
    if (ended) {
      html += '<button class="fleet-btn primary" data-show-summary>查看本局总结</button>';
    } else {
      html += '<button class="fleet-btn primary" data-next-round>进入下一回合</button>';
    }
    html += '<button class="fleet-btn danger" data-abandon-result>放弃这一局</button>';
    html += '</div>';
    return html;
  }

  function bindResultEvents(camp) {
    function q(sel) { return panelBody.querySelector(sel); }
    var prevBtn = q('[data-result-prev]');
    if (prevBtn) prevBtn.addEventListener('click', function() { resPage--; render(); });
    var nextBtn = q('[data-result-next]');
    if (nextBtn) nextBtn.addEventListener('click', function() { resPage++; render(); });
    var summaryBtn = q('[data-show-summary]');
    if (summaryBtn) summaryBtn.addEventListener('click', function() {
      summaryTab = 'overview';
      resPage = 1;
      currentView = 'summary';
      render();
    });
    var roundBtn = q('[data-next-round]');
    if (roundBtn) roundBtn.addEventListener('click', function() {
      plStep = 1;
      resPage = 1;
      currentView = 'planning';
      render();
    });
    var abBtn = q('[data-abandon-result]');
    if (abBtn) abBtn.addEventListener('click', function() {
      showConfirmDialog('放弃这一局', '确认放弃当前这一局？将归档并结束。', function() {
        var r = runtime().abandonCampaign();
        if (r.ok) {
          plStep = 1;
          resPage = 1;
          currentView = 'campaign-start';
          render();
        }
      });
    });
  }
  /* patch-fleet-steps A3 summary tabs 20260904 */
  /* ── Summary 视图：经营总览 / 共同风险 / 回合账本 ── */
  var SUMMARY_TAB_ORDER = ['overview', 'risk', 'rounds'];
  var SUMMARY_TAB_LABELS = { overview: '经营总览', risk: '共同风险', rounds: '回合账本' };

  function summaryTabBar() {
    var html = '<div class="fleet-tabs">';
    for (var i = 0; i < SUMMARY_TAB_ORDER.length; i++) {
      var key = SUMMARY_TAB_ORDER[i];
      html += '<button class="fleet-tab' + (summaryTab === key ? ' active' : '') + '" data-summary-tab="' + key + '">' + SUMMARY_TAB_LABELS[key] + '</button>';
    }
    html += '</div>';
    return html;
  }

  function overviewSummaryHtml(camp) {
    var cfg = config();
    var startTotal = cfg.capital.startingOperatingCash + cfg.capital.startingReserve;
    var finalTotal = camp.operatingCash + camp.reserve;
    var totalIncome = 0, totalLoss = 0, totalRiCost = 0, totalRiRecovery = 0, totalReserveUsed = 0;
    var rounds = Array.isArray(camp.rounds) ? camp.rounds : [];
    for (var i = 0; i < rounds.length; i++) {
      var r = rounds[i];
      totalIncome += r.voyageIncome || 0;
      totalLoss += r.cargoLoss || 0;
      totalRiCost += r.reinsuranceCost || 0;
      totalRiRecovery += r.reinsuranceRecovery || 0;
      totalReserveUsed += r.reserveUsed || 0;
    }
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">' + SUMMARY_TAB_LABELS.overview + '</h3>';
    if (camp.phase === 'completed') html += '<div class="fleet-info"><b>本局已完成</b> · 共运行 ' + rounds.length + ' 个回合</div>';
    else if (camp.phase === 'insolvent') html += '<div class="fleet-warning"><b>资金缺口</b> · 这一局在第 ' + rounds.length + ' 个回合因资金不足终止</div>';
    else html += '<div class="fleet-info">当前状态：<b>未结束</b></div>';
    html += '<table class="fleet-result-table">';
    html += '<tr><td>初始总资金</td><td><b>' + fmt(startTotal) + '</b></td></tr>';
    html += '<tr><td>最终总资金</td><td><b>' + fmt(finalTotal) + '</b></td></tr>';
    html += '<tr><td>累计航运收入</td><td><b>' + fmt(totalIncome) + '</b></td></tr>';
    html += '<tr><td>累计货损</td><td><b>' + fmt(totalLoss) + '</b></td></tr>';
    html += '<tr><td>再保险费用合计</td><td><b>' + fmt(totalRiCost) + '</b></td></tr>';
    html += '<tr><td>再保险分担合计</td><td><b>' + fmt(totalRiRecovery) + '</b></td></tr>';
    html += '<tr><td>准备金动用合计</td><td><b>' + fmt(totalReserveUsed) + '</b></td></tr>';
    html += '<tr class="total"><td>累计净变化</td><td>' + fmt(finalTotal - startTotal) + '</td></tr>';
    html += '</table></div>';
    return html;
  }

  function riskOverviewHtml(camp) {
    var fl = fleetLearning();
    var rounds = Array.isArray(camp.rounds) ? camp.rounds : [];
    var totalLoss = 0;
    var coTotal = 0;
    var coNameMap = {};
    var coNames = [];
    var stormLines = [];
    var batchHit = {};
    for (var r = 0; r < rounds.length; r++) {
      var rr = rounds[r];
      totalLoss += rr.cargoLoss || 0;
      var storms = Array.isArray(rr.storms) ? rr.storms : [];
      for (var s = 0; s < storms.length; s++) {
        var hit = [], hitLoss = 0;
        var vrs = Array.isArray(rr.vesselResults) ? rr.vesselResults : [];
        for (var h = 0; h < vrs.length; h++) {
          if (vrs[h].routeId === storms[s].routeId && vrs[h].sailing && vrs[h].cargoLoss > 0) {
            hit.push(vrs[h].name);
            hitLoss += vrs[h].cargoLoss;
          }
        }
        stormLines.push('第 ' + rr.round + ' 回合：' + routeName(storms[s].routeId) + ' 出现风暴（强度 ' + fmt(storms[s].severity) + '）——' + (hit.length > 0 ? hit.join('、') + ' 受损，合计 ' + fmt(hitLoss) + '。' : '该航线没有船只受损。'));
      }
      var evs = (fl && fl.analyzeRound) ? fl.analyzeRound(rr) : [];
      for (var e = 0; e < evs.length; e++) {
        var ev = evs[e];
        coTotal += ev.totalLoss || 0;
        for (var n = 0; n < ev.names.length; n++) {
          if (!coNameMap[ev.names[n]]) {
            coNameMap[ev.names[n]] = true;
            coNames.push(ev.names[n]);
          }
        }
        if (ev.type === 'batch') {
          if (!batchHit[ev.sourceId]) batchHit[ev.sourceId] = { rounds: [], loss: 0 };
          batchHit[ev.sourceId].rounds.push(rr.round);
          batchHit[ev.sourceId].loss += ev.totalLoss || 0;
        }
      }
    }
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">' + SUMMARY_TAB_LABELS.risk + '</h3>';
    var groups = sharedBatchGroups();
    var anyConfirmed = false;
    var anyStorm = stormLines.length > 0;
    var openNames = [];
    for (var g = 0; g < groups.length; g++) {
      var gid = groups[g].batchId;
      var gname = batchNameOf(gid);
      if (!batchDefectSeen(camp, gid)) { openNames.push(gname); continue; }
      anyConfirmed = true;
      var rec = batchHit[gid];
      html += '<details class="fleet-learn"><summary><b>' + gname + '</b>（' + groupShipNames(groups[g].ships) + ' 使用）——本局已确认存在问题</summary><div>';
      if (rec && rec.rounds.length > 0) {
        html += '同批两船同时受损的回合：第 ' + rec.rounds.join('、') + ' 回合（共同损失合计 ' + fmt(rec.loss) + '）。';
      } else {
        html += '本局没有任何回合出现同批两船同时受损——问题虽被确认，但没有造成共同损失。';
      }
      html += '</div></details>';
    }
    if (!anyConfirmed && !anyStorm) {
      html += '<div class="fleet-info">本局没有确认的批次缺陷或风暴——共同风险没有实际触发。</div>';
    } else {
      if (!anyConfirmed) {
        html += '<div class="fleet-info">本局使用的船材批次都没有被确认存在问题——同批船只是共享同一来源。</div>';
      } else if (openNames.length > 0) {
        html += '<div class="fleet-info">其余批次（' + openNames.join('、') + '）没有被确认存在问题。</div>';
      }
      for (var sl = 0; sl < stormLines.length; sl++) html += '<div class="fleet-warning">' + stormLines[sl] + '</div>';
      if (!anyStorm) html += '<div class="fleet-info">本局没有出现风暴。</div>';
    }
    if (totalLoss > 0) {
      var solo = Math.round((totalLoss - coTotal) * 100) / 100;
      html += '<div class="fleet-info"><b>损失拆分：</b>本局累计货损 ' + fmt(totalLoss) + '，其中共同风险（多艘船同时受同一来源影响）合计 ' + fmt(coTotal) + (coNames.length > 0 ? '（' + coNames.join('、') + '）' : '') + '，其余 ' + fmt(solo) + ' 为单船独立损失。';
      if (coTotal <= 0) html += '本局货损全部来自单船独立事故。';
      html += '</div>';
    }
    html += strategyFactsHtml(camp);
    html += '<details class="fleet-learn"><summary>什么是船材批次风险？</summary><div>' + BATCH_RISK_EXPLAIN + '</div></details>';
    html += '</div>';
    return html;
  }

  /* 该回合是否有共享同一来源（同批船材或同一条航线）的船同时出航 */
  function roundHasSharedSailing(roundResult) {
    if (!roundResult || !roundResult.assignments) return false;
    var groups = sharedBatchGroups();
    for (var i = 0; i < groups.length; i++) {
      var cnt = 0;
      for (var j = 0; j < groups[i].ships.length; j++) {
        if (roundResult.assignments[groups[i].ships[j].shipId]) cnt++;
      }
      if (cnt >= 2) return true;
    }
    var routeCounts = {};
    for (var rid in roundResult.assignments) {
      var rv = roundResult.assignments[rid];
      if (rv) routeCounts[rv] = (routeCounts[rv] || 0) + 1;
    }
    for (var rk in routeCounts) if (routeCounts[rk] >= 2) return true;
    return false;
  }

  /* 你的方案调整：每回合相对上一回合的事实差异（无评价；仅观看不改写学习证据） */
  function strategyFactsHtml(camp) {
    var fl = fleetLearning();
    var rounds = Array.isArray(camp.rounds) ? camp.rounds : [];
    var html = '<details class="fleet-learn"><summary>你的方案调整</summary><div>';
    if (rounds.length < 2) {
      html += '本局只结算了 ' + rounds.length + ' 个回合，没有回合之间的方案变化可比较。';
      html += '</div></details>';
      return html;
    }
    var anyChange = false;
    for (var k = 1; k < rounds.length; k++) {
      var prevR = rounds[k - 1];
      var curR = rounds[k];
      var changes = (fl && fl.planChanges) ? fl.planChanges(prevR.assignments || {}, curR.assignments || {}, prevR.reserveAfter, curR.reserveBefore) : [];
      var parts = [];
      for (var c = 0; c < changes.length; c++) {
        var ch = changes[c];
        if (ch.change === 'route-thinned') parts.push(routeName(ch.routeId) + ' 上的船从 ' + ch.from + ' 艘减为 ' + ch.to + ' 艘');
        else if (ch.change === 'ship-kept-in-port') parts.push(shipName(ch.shipId) + ' 留港（上一回合走 ' + routeName(ch.fromRoute) + '）');
        else if (ch.change === 'route-changed') parts.push(shipName(ch.shipId) + ' 从 ' + routeName(ch.fromRoute) + ' 改走 ' + routeName(ch.toRoute));
        else if (ch.change === 'reserve-increased') parts.push('准备金从 ' + fmt(ch.from) + ' 提高到 ' + fmt(ch.to));
        else if (ch.change === 'ship-set-sailing') parts.push(shipName(ch.shipId) + ' 恢复出航（' + routeName(ch.toRoute) + '）');
      }
      if (parts.length > 0) {
        anyChange = true;
        html += '<div class="fleet-replay-line"><b>第 ' + curR.round + ' 回合</b>：' + parts.join('；') + '。</div>';
      }
    }
    if (!anyChange) {
      html += '本局你没有在回合之间调整过方案。';
      var sharedRounds = 0;
      for (var q = 0; q < rounds.length; q++) if (roundHasSharedSailing(rounds[q])) sharedRounds++;
      if (sharedRounds >= 2) html += '<br>本局你多次让共享同一风险来源（同批船材或同一条航线）的船只同时出航。';
    }
    html += '</div></details>';
    return html;
  }

  function roundsLedgerHtml(camp) {
    var rounds = Array.isArray(camp.rounds) ? camp.rounds : [];
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">' + SUMMARY_TAB_LABELS.rounds + '</h3>';
    if (!rounds.length) {
      html += '<div class="fleet-info">本局还没有结算过回合。</div>';
    }
    for (var i = 0; i < rounds.length; i++) {
      var rr = rounds[i];
      html += '<details class="fleet-learn"><summary><b>第 ' + rr.round + ' 回合</b> · 收入 ' + fmt(rr.voyageIncome) + ' · 货损 ' + fmt(rr.cargoLoss) + ' · 结算后总资金 ' + fmt(rr.totalFundsAfter) + '</summary><div>';
      var assignedShips = [];
      for (var shipId in rr.assignments) {
        if (rr.assignments[shipId]) assignedShips.push(shipName(shipId) + '→' + routeName(rr.assignments[shipId]));
        else assignedShips.push(shipName(shipId) + '→留港');
      }
      html += '<div class="fleet-replay-line">方案：' + assignedShips.join('，') + '。</div>';
      var vrs = Array.isArray(rr.vesselResults) ? rr.vesselResults : [];
      var vlines = [];
      for (var v = 0; v < vrs.length; v++) {
        var vr = vrs[v];
        if (!vr.sailing) vlines.push(vr.name + ' 留港');
        else if (vr.accident) vlines.push(vr.name + ' ' + severityLabel(vr.severity) + '，货损 ' + fmt(vr.cargoLoss));
        else vlines.push(vr.name + ' 安全，收入 ' + fmt(vr.voyageIncome));
      }
      html += '<div class="fleet-replay-line">逐船：' + vlines.join('；') + '。</div>';
      if (rr.storms && rr.storms.length > 0) {
        var sp = [];
        for (var st = 0; st < rr.storms.length; st++) sp.push(routeName(rr.storms[st].routeId) + '（强度 ' + fmt(rr.storms[st].severity) + '）');
        html += '<div class="fleet-replay-line">风暴：' + sp.join('、') + '。</div>';
      }
      if (rr.batchDefects && rr.batchDefects.length > 0) {
        var dp = [];
        for (var db = 0; db < rr.batchDefects.length; db++) dp.push(batchNameOf(rr.batchDefects[db]));
        html += '<div class="fleet-replay-line">批次缺陷：' + dp.join('、') + '。</div>';
      }
      html += '</div></details>';
    }
    html += '</div>';
    return html;
  }

  function renderSummary(camp) {
    var html = summaryTabBar();
    if (summaryTab === 'risk') html += riskOverviewHtml(camp);
    else if (summaryTab === 'rounds') html += roundsLedgerHtml(camp);
    else html += overviewSummaryHtml(camp);
    html += '<div class="fleet-actions">';
    html += '<button class="fleet-btn primary" data-action="new-campaign">开始新一局</button>';
    html += '<button class="fleet-btn secondary" data-action="return-harbor">关闭面板</button>';
    html += '</div>';
    html += '<details class="fleet-learn"><summary>调试信息（用于复现本局，正常游玩可忽略）</summary><div style="font-size:11px;color:#6B4A2F;line-height:1.6">本局记录编号：' + camp.campaignId + '<br>复现种子：' + camp.seed + '</div></details>';
    panelBody.innerHTML = html;
    bindSummaryEvents();
  }

  function bindSummaryEvents() {
    var tabs = panelBody.querySelectorAll('[data-summary-tab]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function() {
        summaryTab = this.getAttribute('data-summary-tab');
        render();
      });
    }
    var newBtn = panelBody.querySelector('[data-action="new-campaign"]');
    if (newBtn) newBtn.addEventListener('click', function() {
      var r = runtime().startCampaign();
      if (r.ok) {
        plStep = 1;
        currentView = 'planning';
        render();
      }
    });
    var harborBtn = panelBody.querySelector('[data-action="return-harbor"]');
    if (harborBtn) harborBtn.addEventListener('click', close);
  }
  /* ── 导出 ── */
  global.FleetUI = Object.freeze({
    open: open,
    close: close
  });
})(typeof window !== 'undefined' ? window : globalThis);
