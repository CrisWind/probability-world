/* 概率世界 · 商会船队风险盘 V0.1 —— UI（覆盖层 + 3 视图）
 * 只显示客观信息，不显示推荐。
 * 3 视图：plan（方案规划）、result（单轮结算）、summary（campaign 总结）。 */
(function attachFleetUI(global) {
  'use strict';

  var doc = function() { return global.document; };
  var runtime = function() { return global.FleetRuntime; };
  var config = function() { return global.FLEET_CONFIG; };
  var model = function() { return global.FleetModel; };

  var overlay = null;
  var panelBody = null;
  var currentView = 'plan';

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
      '.fleet-summary-stat b{color:#8C3A2E}'
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
      runtime().startCampaign();
      camp = runtime().getCampaign();
    }
    if (camp.phase === 'completed' || camp.phase === 'insolvent') {
      currentView = 'summary';
    } else {
      currentView = 'plan';
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
    if (!camp) { panelBody.innerHTML = '<p>无进行中的 campaign</p>'; return; }

    if (currentView === 'plan') renderPlan(camp);
    else if (currentView === 'result') renderResult(camp);
    else if (currentView === 'summary') renderSummary(camp);
  }

  /* ── 辅助函数 ── */
  function routeName(routeId) {
    if (!routeId) return '留港';
    var r = model().findRoute(routeId);
    return r ? r.name : routeId;
  }

  function vesselBatchLabel(batchId) {
    return batchId.replace('batch.', '');
  }

  function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  function fleetBar(camp) {
    var totalFunds = camp.operatingCash + camp.reserve;
    var riLabel = camp.reinsuranceActive ? '已购买' : '未购买';
    return '<div class="fleet-bar">'
      + '<span>回合 <b>' + camp.currentRound + '</b>/' + camp.totalRounds + '</span>'
      + '<span>经营资金 <b>' + fmt(camp.operatingCash) + '</b></span>'
      + '<span>准备金 <b>' + fmt(camp.reserve) + '</b></span>'
      + '<span>总资金 <b>' + fmt(totalFunds) + '</b></span>'
      + '<span>再保险 <b>' + riLabel + '</b></span>'
      + '</div>';
  }

  function stormWarning(camp) {
    var cr = config().commonRisk;
    if (camp.currentRound < cr.stormWindowStart) {
      return '<div class="fleet-info">当前不在风暴季。风暴季从第 ' + cr.stormWindowStart + ' 回合开始。</div>';
    }
    var routes = config().routes;
    var lines = ['<div class="fleet-warning"><b>风暴季</b>（第 ' + cr.stormWindowStart + '~' + cr.stormWindowEnd + ' 回合）'];
    lines.push('各航线暴露度：');
    var parts = [];
    for (var i = 0; i < routes.length; i++) {
      parts.push(routes[i].name + ' ' + Math.round(routes[i].stormExposure * 100) + '%');
    }
    lines.push(parts.join('、'));
    lines.push('风暴是否实际发生由种子决定，分散航线可降低暴露。</div>');
    return lines.join('');
  }

  function batchWarning(camp) {
    var batches = {};
    var vessels = config().vessels;
    for (var i = 0; i < vessels.length; i++) {
      var b = vessels[i].batchId;
      if (!batches[b]) batches[b] = [];
      batches[b].push(vessels[i].name);
    }
    var lines = [];
    var keys = Object.keys(batches);
    for (var k = 0; k < keys.length; k++) {
      if (batches[keys[k]].length > 1) {
        lines.push('<div class="fleet-info">' + batches[keys[k]].join('、') + ' 共享 <b>' + vesselBatchLabel(keys[k]) + '</b> 船材批次</div>');
      }
    }
    return lines.join('');
  }

  function commonRiskExposure(camp) {
    var routeCounts = {};
    var vessels = config().vessels;
    for (var i = 0; i < vessels.length; i++) {
      var rid = camp.assignments[vessels[i].shipId];
      if (rid) {
        routeCounts[rid] = (routeCounts[rid] || 0) + 1;
      }
    }
    var warnings = [];
    var rkeys = Object.keys(routeCounts);
    for (var k = 0; k < rkeys.length; k++) {
      if (routeCounts[rkeys[k]] > 1) {
        warnings.push('已有 <b>' + routeCounts[rkeys[k]] + '</b> 艘船暴露在同一航线（' + routeName(rkeys[k]) + '）');
      }
    }
    if (warnings.length === 0) return '';
    return '<div class="fleet-warning">' + warnings.join('；') + '</div>';
  }

  /* ── Plan 视图 ── */
  function renderPlan(camp) {
    var cfg = config();
    var vessels = cfg.vessels;
    var routes = cfg.routes;
    var expected = runtime().getExpected();

    var html = fleetBar(camp);
    html += stormWarning(camp);
    html += batchWarning(camp);
    html += commonRiskExposure(camp);

    /* 船只分配区 */
    html += '<div class="fleet-section"><h3 class="fleet-section-title">船只分配</h3>';
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var assigned = camp.assignments[v.shipId];
      html += '<div class="fleet-vessel">';
      html += '<b>' + v.name + '</b> · 货值 ' + v.cargoValue + ' · 批次 ' + vesselBatchLabel(v.batchId);
      html += '<div class="fleet-route-btns">';
      for (var j = 0; j < routes.length; j++) {
        var r = routes[j];
        var sel = assigned === r.routeId ? ' selected' : '';
        html += '<button class="fleet-btn' + sel + '" data-ship="' + v.shipId + '" data-route="' + r.routeId + '">'
          + r.name + '<br><span style="font-size:10px">收益' + Math.round(r.yieldRate * 100) + '% 风险' + Math.round(r.baseRisk * 100) + '%</span></button>';
      }
      var staySel = assigned === null ? ' selected' : '';
      html += '<button class="fleet-btn stay' + staySel + '" data-ship="' + v.shipId + '" data-route="null">留港</button>';
      html += '</div></div>';
    }
    html += '</div>';

    /* 准备金区 */
    html += '<div class="fleet-section"><h3 class="fleet-section-title">准备金</h3>';
    html += '<div class="fleet-reserve-row"><label>当前准备金</label><b>' + fmt(camp.reserve) + '</b>';
    html += '<button class="fleet-btn secondary" data-action="reserve-down">-' + cfg.capital.reserveStep + '</button>';
    html += '<button class="fleet-btn secondary" data-action="reserve-up">+' + cfg.capital.reserveStep + '</button>';
    html += '</div>';
    html += '<div class="fleet-info">准备金越多，抗损失能力越强，但可用于经营的资金越少。准备金上限 ' + cfg.capital.reserveMax + '。</div>';
    html += '</div>';

    /* 再保险区 */
    var sailingCount = 0;
    var sailingCargoTotal = 0;
    for (var s = 0; s < vessels.length; s++) {
      if (camp.assignments[vessels[s].shipId]) {
        sailingCount++;
        sailingCargoTotal += vessels[s].cargoValue;
      }
    }
    var riCost = sailingCargoTotal * cfg.reinsurance.premiumRate;
    html += '<div class="fleet-section"><h3 class="fleet-section-title">再保险</h3>';
    html += '<div class="fleet-reserve-row"><label>状态</label>';
    html += '<button class="fleet-btn' + (camp.reinsuranceActive ? ' selected' : '') + '" data-action="reinsurance">';
    html += camp.reinsuranceActive ? '已购买' : '未购买';
    html += '</button></div>';
    html += '<div class="fleet-info">费率 ' + Math.round(cfg.reinsurance.premiumRate * 100) + '%（按出航船总货值）';
    html += ' · 本轮费用 <b>' + fmt(riCost) + '</b>';
    html += ' · 自留额 ' + cfg.reinsurance.threshold + ' · 超出部分承担 ' + Math.round(cfg.reinsurance.coverRate * 100) + '%</div>';
    html += '</div>';

    /* 预期收益预览 */
    if (expected) {
      html += '<div class="fleet-section"><h3 class="fleet-section-title">预期收益预览（事前概率加权）</h3>';
      html += '<div class="fleet-info">';
      html += '预期收入 <b>' + fmt(expected.expectedVoyageIncome) + '</b> · ';
      html += '预期货损 <b>' + fmt(expected.expectedCargoLoss) + '</b> · ';
      html += '再保险费 <b>' + fmt(expected.reinsuranceCost) + '</b> · ';
      html += '预期净利润 <b>' + fmt(expected.expectedNetProfit) + '</b>';
      html += '</div></div>';
    }

    /* 留港机会成本 */
    var stayCount = 0;
    var stayOpportunityCost = 0;
    for (var st = 0; st < vessels.length; st++) {
      if (camp.assignments[vessels[st].shipId] === null) {
        stayCount++;
        var bestYield = 0;
        for (var ry = 0; ry < routes.length; ry++) {
          if (routes[ry].yieldRate > bestYield) bestYield = routes[ry].yieldRate;
        }
        stayOpportunityCost += vessels[st].cargoValue * bestYield;
      }
    }
    if (stayCount > 0) {
      html += '<div class="fleet-warning">' + stayCount + ' 艘船留港，放弃约 <b>' + fmt(stayOpportunityCost) + '</b> 最高预期收入</div>';
    }

    /* 操作按钮 */
    html += '<div class="fleet-actions">';
    html += '<button class="fleet-btn primary" data-action="submit">提交方案</button>';
    html += '<button class="fleet-btn danger" data-action="abandon">放弃 campaign</button>';
    html += '</div>';

    panelBody.innerHTML = html;
    bindPlanEvents(camp);
  }

  function bindPlanEvents(camp) {
    /* 航线按钮 */
    var routeButtons = panelBody.querySelectorAll('[data-ship][data-route]');
    for (var i = 0; i < routeButtons.length; i++) {
      routeButtons[i].addEventListener('click', function() {
        var shipId = this.getAttribute('data-ship');
        var routeId = this.getAttribute('data-route');
        runtime().setAssignment(shipId, routeId === 'null' ? null : routeId);
        render();
      });
    }

    /* 准备金按钮 */
    var capCfg = config().capital;
    var upBtn = panelBody.querySelector('[data-action="reserve-up"]');
    var downBtn = panelBody.querySelector('[data-action="reserve-down"]');
    if (upBtn) upBtn.addEventListener('click', function() {
      runtime().setReserve(camp.reserve + capCfg.reserveStep);
      render();
    });
    if (downBtn) downBtn.addEventListener('click', function() {
      runtime().setReserve(camp.reserve - capCfg.reserveStep);
      render();
    });

    /* 再保险按钮 */
    var riBtn = panelBody.querySelector('[data-action="reinsurance"]');
    if (riBtn) riBtn.addEventListener('click', function() {
      runtime().setReinsurance(!camp.reinsuranceActive);
      render();
    });

    /* 提交方案 */
    var submitBtn = panelBody.querySelector('[data-action="submit"]');
    if (submitBtn) submitBtn.addEventListener('click', function() {
      var result = runtime().submitPlan();
      if (result.ok) {
        var newCamp = runtime().getCampaign();
        if (newCamp.phase === 'completed' || newCamp.phase === 'insolvent') {
          currentView = 'summary';
        } else {
          currentView = 'result';
        }
        render();
      }
    });

    /* 放弃 */
    var abandonBtn = panelBody.querySelector('[data-action="abandon"]');
    if (abandonBtn) abandonBtn.addEventListener('click', function() {
      var r = runtime().abandonCampaign();
      if (r.ok) {
        runtime().startCampaign();
        currentView = 'plan';
        render();
      }
    });
  }

  /* ── Result 视图 ── */
  function renderResult(camp) {
    var lastRound = camp.rounds[camp.rounds.length - 1];
    if (!lastRound) { currentView = 'plan'; render(); return; }

    var html = fleetBar(camp);

    /* 共同风险事实 */
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
        defParts.push(vesselBatchLabel(lastRound.batchDefects[d]));
      }
      html += defParts.join('、') + ' 存在缺陷</div>';
    }

    /* 逐船结果表 */
    html += '<div class="fleet-section"><h3 class="fleet-section-title">逐船结算</h3>';
    html += '<table class="fleet-result-table"><tr><th>船名</th><th>航线</th><th>事故概率</th><th>修正</th><th>结果</th><th>收入</th><th>货损</th><th>再保险回收</th><th>实际损失</th></tr>';
    for (var i = 0; i < lastRound.vesselResults.length; i++) {
      var vr = lastRound.vesselResults[i];
      var rowClass = !vr.sailing ? 'stayed' : (vr.accident ? 'accident' : 'safe');
      html += '<tr class="' + rowClass + '">';
      html += '<td>' + vr.name + '</td>';
      html += '<td>' + routeName(vr.routeId) + '</td>';
      html += '<td>' + (vr.accidentProbability * 100).toFixed(1) + '%</td>';
      var mods = [];
      if (vr.modifiers.storm) mods.push('风暴');
      if (vr.modifiers.batchDefect) mods.push('批次缺陷');
      html += '<td>' + (mods.length > 0 ? mods.join(',') : '-') + '</td>';
      html += '<td>' + (!vr.sailing ? '留港' : (vr.accident ? '事故(' + vr.severity + ')' : '安全')) + '</td>';
      html += '<td>' + fmt(vr.voyageIncome) + '</td>';
      html += '<td>' + fmt(vr.cargoLoss) + '</td>';
      html += '<td>' + fmt(vr.reinsuranceRecovery) + '</td>';
      html += '<td>' + fmt(vr.playerBorneLoss) + '</td>';
      html += '</tr>';
    }
    html += '</table></div>';

    /* 汇总 */
    html += '<div class="fleet-section"><h3 class="fleet-section-title">本轮汇总</h3>';
    html += '<table class="fleet-result-table">';
    html += '<tr><td>航运收入</td><td><b>' + fmt(lastRound.totals.voyageIncome) + '</b></td></tr>';
    html += '<tr><td>货损总额</td><td><b>' + fmt(lastRound.totals.cargoLoss) + '</b></td></tr>';
    html += '<tr><td>再保险费用</td><td><b>' + fmt(lastRound.totals.reinsuranceCost) + '</b></td></tr>';
    html += '<tr><td>再保险回收</td><td><b>' + fmt(lastRound.totals.reinsuranceRecovery) + '</b></td></tr>';
    html += '<tr class="total"><td>净利润</td><td>' + fmt(lastRound.totals.netProfit) + '</td></tr>';
    html += '<tr><td>预期收入（事前）</td><td>' + fmt(lastRound.totals.expectedVoyageIncome) + '</td></tr>';
    html += '<tr><td>预期净利润（事前）</td><td>' + fmt(lastRound.totals.expectedNetProfit) + '</td></tr>';
    html += '</table>';

    html += '<div class="fleet-reserve-row">';
    html += '<label>经营资金</label><span>' + fmt(lastRound.operatingCashBefore) + ' → <b>' + fmt(lastRound.operatingCashAfter) + '</b></span>';
    html += '</div>';
    if (lastRound.reserveUsed > 0) {
      html += '<div class="fleet-warning">动用了准备金 <b>' + fmt(lastRound.reserveUsed) + '</b></div>';
    }
    html += '<div class="fleet-reserve-row">';
    html += '<label>准备金</label><span>' + fmt(lastRound.reserveBefore) + ' → <b>' + fmt(lastRound.reserveAfter) + '</b></span>';
    html += '</div>';
    html += '<div class="fleet-reserve-row">';
    html += '<label>总资金</label><span>' + fmt(lastRound.totalFundsBefore) + ' → <b>' + fmt(lastRound.totalFundsAfter) + '</b></span>';
    html += '</div>';

    if (lastRound.insolvent) {
      html += '<div class="fleet-warning"><b>资金缺口！</b>经营资金和准备金均不足以覆盖损失。</div>';
    }

    html += '</div>';

    /* 操作按钮 */
    html += '<div class="fleet-actions">';
    if (camp.phase === 'planning') {
      html += '<button class="fleet-btn primary" data-action="next-round">进入下一回合</button>';
    }
    html += '<button class="fleet-btn danger" data-action="abandon-result">放弃 campaign</button>';
    html += '</div>';

    panelBody.innerHTML = html;

    /* 绑定事件 */
    var nextBtn = panelBody.querySelector('[data-action="next-round"]');
    if (nextBtn) nextBtn.addEventListener('click', function() {
      currentView = 'plan';
      render();
    });
    var abBtn = panelBody.querySelector('[data-action="abandon-result"]');
    if (abBtn) abBtn.addEventListener('click', function() {
      var r = runtime().abandonCampaign();
      if (r.ok) {
        runtime().startCampaign();
        currentView = 'plan';
        render();
      }
    });
  }

  /* ── Summary 视图 ── */
  function renderSummary(camp) {
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">Campaign 总结</h3>';

    var finalTotal = camp.operatingCash + camp.reserve;
    var cfg = config();
    var startTotal = cfg.capital.startingCash + cfg.capital.startingReserve;

    html += '<div style="margin:8px 0">';
    html += '<span class="fleet-summary-stat">总回合 <b>' + camp.totalRounds + '</b></span>';
    html += '<span class="fleet-summary-stat">已结算 <b>' + camp.rounds.length + '</b></span>';
    html += '<span class="fleet-summary-stat">起始资金 <b>' + fmt(startTotal) + '</b></span>';
    html += '<span class="fleet-summary-stat">最终资金 <b>' + fmt(finalTotal) + '</b></span>';
    html += '<span class="fleet-summary-stat">净变化 <b>' + fmt(finalTotal - startTotal) + '</b></span>';
    html += '</div>';

    var totalIncome = 0, totalLoss = 0, totalRiCost = 0, totalRiRecovery = 0, stormCount = 0;
    for (var i = 0; i < camp.rounds.length; i++) {
      var r = camp.rounds[i];
      totalIncome += r.totals.voyageIncome;
      totalLoss += r.totals.cargoLoss;
      totalRiCost += r.totals.reinsuranceCost;
      totalRiRecovery += r.totals.reinsuranceRecovery;
      stormCount += r.storms.length;
    }

    html += '<table class="fleet-result-table">';
    html += '<tr><td>累计收入</td><td><b>' + fmt(totalIncome) + '</b></td></tr>';
    html += '<tr><td>累计货损</td><td><b>' + fmt(totalLoss) + '</b></td></tr>';
    html += '<tr><td>累计再保险费用</td><td><b>' + fmt(totalRiCost) + '</b></td></tr>';
    html += '<tr><td>累计再保险回收</td><td><b>' + fmt(totalRiRecovery) + '</b></td></tr>';
    html += '<tr><td>遭遇风暴次数</td><td><b>' + stormCount + '</b></td></tr>';
    html += '<tr class="total"><td>最终总资金</td><td>' + fmt(finalTotal) + '</td></tr>';
    html += '</table>';

    if (camp.phase === 'insolvent') {
      html += '<div class="fleet-warning"><b>campaign 因资金缺口终止</b></div>';
    } else {
      html += '<div class="fleet-info">campaign 正常完成。</div>';
    }
    html += '</div>';

    /* 逐轮回顾 */
    html += '<div class="fleet-section"><h3 class="fleet-section-title">逐轮回顾</h3>';
    for (var j = 0; j < camp.rounds.length; j++) {
      var rr = camp.rounds[j];
      html += '<div class="fleet-info">第 ' + rr.round + ' 回合：净利润 <b>' + fmt(rr.totals.netProfit) + '</b>';
      if (rr.storms.length > 0) html += ' · 风暴 ' + rr.storms.length + ' 次';
      if (rr.batchDefects.length > 0) html += ' · 批次缺陷';
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="fleet-actions">';
    html += '<button class="fleet-btn primary" data-action="new-campaign">开始新 campaign</button>';
    html += '</div>';

    panelBody.innerHTML = html;

    var newBtn = panelBody.querySelector('[data-action="new-campaign"]');
    if (newBtn) newBtn.addEventListener('click', function() {
      runtime().startCampaign();
      currentView = 'plan';
      render();
    });
  }

  /* ── 导出 ── */
  global.FleetUI = Object.freeze({
    open: open,
    close: close
  });
})(typeof window !== 'undefined' ? window : globalThis);
