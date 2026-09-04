/* 概率世界 · 商会船队风险盘 V0.2 —— UI 完整重写
 * 4 视图：campaign-start、planning、result、summary
 * 依赖：FleetRuntime、FleetModel、FLEET_CONFIG */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TARGET = path.join(__dirname, '..', 'fleet-ui.js');

const NEW_CONTENT = `/* 概率世界 · 商会船队风险盘 V0.2 —— UI（覆盖层 + 4 视图）
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
      '.fleet-dialog-overlay{position:fixed;inset:0;z-index:99996;display:flex;align-items:center;justify-content:center;background:rgba(20,16,12,.6)}',
      '.fleet-dialog{padding:20px;background:#E8D7B0;border:3px solid #3E2A1B;box-shadow:4px 4px 0 #14100C;max-width:400px;font-family:NotoPixelCN,sans-serif}',
      '.fleet-dialog h3{margin:0 0 12px;color:#17324A;font-size:16px}',
      '.fleet-dialog p{margin:0 0 16px;font-size:13px;color:#3E2A1B;line-height:1.5}',
      '.fleet-dialog-actions{display:flex;gap:8px;justify-content:flex-end}',
      '.fleet-start-center{text-align:center;padding:20px 0}',
      '.fleet-start-center h2{margin:0 0 16px;color:#17324A;font-size:20px}',
      '.fleet-start-center p{margin:0 0 20px;font-size:13px;color:#3E2A1B;line-height:1.6}'
    ].join('\\n');
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
      + '<div id="fleet-header"><h2 id="fleet-title">商会船队风险盘</h2><button id="fleet-close" type="button" aria-label="关闭风险盘">\\u00d7</button></div>'
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
    } else {
      currentView = 'planning';
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
    return r ? r.name : routeId;
  }

  function vesselBatchLabel(batchId) {
    return batchId.replace('batch.', '');
  }

  function fmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }

  function fleetBar(camp) {
    var totalFunds = camp.operatingCash + camp.reserve;
    return '<div class="fleet-bar">'
      + '<span>回合 <b>' + camp.currentRound + '</b>/' + camp.totalRounds + '</span>'
      + '<span>经营资金 <b>' + fmt(camp.operatingCash) + '</b></span>'
      + '<span>准备金 <b>' + fmt(camp.reserve) + '</b></span>'
      + '<span>总资金 <b>' + fmt(totalFunds) + '</b></span>'
      + '<span>再保险 <b>已购买</b></span>'
      + '</div>';
  }

  /* ── Campaign Start 视图 ── */
  function renderCampaignStart(camp) {
    var html = '<div class="fleet-start-center">';
    html += '<h2>商会船队风险盘</h2>';
    html += '<p>你将经营一支由 6 艘船组成的商队，在 5 个回合内往返于三条航线。<br>';
    html += '风暴、批次缺陷、事故风险——分散航线、预留准备金、购买再保险以应对不确定性。</p>';

    if (camp && (camp.phase === 'completed' || camp.phase === 'insolvent')) {
      html += '<p>上一个 campaign 已结束。</p>';
      html += '<div class="fleet-actions" style="justify-content:center">';
      html += '<button class="fleet-btn primary" data-action="new-campaign">开始新 campaign</button>';
      html += '<button class="fleet-btn secondary" data-action="view-summary">查看总结</button>';
      html += '</div>';
    } else if (camp && camp.phase === 'planning') {
      html += '<p>有一个进行中的 campaign（第 ' + camp.currentRound + '/' + camp.totalRounds + ' 回合）。</p>';
      html += '<div class="fleet-actions" style="justify-content:center">';
      html += '<button class="fleet-btn primary" data-action="continue-campaign">继续经营</button>';
      html += '<button class="fleet-btn danger" data-action="abandon-start">放弃并重新开始</button>';
      html += '</div>';
    } else {
      html += '<div class="fleet-actions" style="justify-content:center">';
      html += '<button class="fleet-btn primary" data-action="new-campaign">开始新 campaign</button>';
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

  /* ── Planning 视图 ── */
  function renderPlanning(camp) {
    var cfg = config();
    var vessels = cfg.vessels;
    var routes = cfg.routes;
    var expected = runtime().getExpected();

    var html = fleetBar(camp);

    /* 区域 1：船只分配 */
    html += '<div class="fleet-section"><h3 class="fleet-section-title">船只分配</h3>';
    for (var i = 0; i < vessels.length; i++) {
      var v = vessels[i];
      var assigned = camp.assignments[v.shipId];
      html += '<div class="fleet-vessel">';
      html += '<b>' + v.name + '</b> · 货值 ' + v.cargoValue + ' · 基础风险 ' + Math.round(v.baseRisk * 100) + '% · 船体 ' + v.hull + ' · 批次 ' + vesselBatchLabel(v.batchId);
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

    /* 区域 2：航线概览 */
    html += '<div class="fleet-section"><h3 class="fleet-section-title">航线概览</h3>';
    for (var k = 0; k < routes.length; k++) {
      var rt = routes[k];
      var count = 0;
      for (var c = 0; c < vessels.length; c++) {
        if (camp.assignments[vessels[c].shipId] === rt.routeId) count++;
      }
      html += '<div class="fleet-route-card">';
      html += '<b>' + rt.name + '</b> · 收益 ' + Math.round(rt.yieldRate * 100) + '% · 基础风险 ' + Math.round(rt.baseRisk * 100) + '% · 波动 ' + rt.volatility + ' · 风暴暴露 ' + Math.round(rt.stormExposure * 100) + '%';
      html += '<br>当前分配：<b>' + count + '</b> 艘船';
      html += '</div>';
    }
    html += '</div>';

    /* 区域 3：共同风险 */
    html += '<div class="fleet-section"><h3 class="fleet-section-title">共同风险</h3>';

    var cr = cfg.commonRisk;
    if (camp.currentRound < cr.stormWindowStart) {
      html += '<div class="fleet-info">当前不在风暴季。风暴季从第 ' + cr.stormWindowStart + ' 回合开始。</div>';
    } else if (camp.currentRound <= cr.stormWindowEnd) {
      html += '<div class="fleet-warning"><b>风暴季</b>（第 ' + cr.stormWindowStart + '~' + cr.stormWindowEnd + ' 回合）';
      var stormParts = [];
      for (var si = 0; si < routes.length; si++) {
        stormParts.push(routes[si].name + ' ' + Math.round(routes[si].stormExposure * 100) + '%');
      }
      html += '各航线风暴暴露度：' + stormParts.join('、');
      html += '。风暴是否实际发生由种子决定，分散航线可降低暴露。</div>';
    } else {
      html += '<div class="fleet-info">风暴季已结束。</div>';
    }

    var batches = {};
    for (var bi = 0; bi < vessels.length; bi++) {
      var b = vessels[bi].batchId;
      if (!batches[b]) batches[b] = [];
      batches[b].push(vessels[bi].name);
    }
    var bkeys = Object.keys(batches);
    for (var bk = 0; bk < bkeys.length; bk++) {
      if (batches[bkeys[bk]].length > 1) {
        html += '<div class="fleet-info">' + batches[bkeys[bk]].join('、') + ' 共享 <b>' + vesselBatchLabel(bkeys[bk]) + '</b> 船材批次（缺陷风险共享）</div>';
      }
    }

    var routeCounts = {};
    for (var ri = 0; ri < vessels.length; ri++) {
      var rid = camp.assignments[vessels[ri].shipId];
      if (rid) {
        routeCounts[rid] = (routeCounts[rid] || 0) + 1;
      }
    }
    var rkeys = Object.keys(routeCounts);
    for (var rk = 0; rk < rkeys.length; rk++) {
      if (routeCounts[rkeys[rk]] > 1) {
        html += '<div class="fleet-warning">' + routeCounts[rkeys[rk]] + ' 艘船暴露在同一航线（' + routeName(rkeys[rk]) + '），共同风险集中</div>';
      }
    }
    html += '</div>';

    /* 区域 4：资金与准备金 */
    var totalFunds = camp.operatingCash + camp.reserve;
    html += '<div class="fleet-section"><h3 class="fleet-section-title">资金与准备金</h3>';
    html += '<div class="fleet-reserve-row"><label>经营资金</label><b>' + fmt(camp.operatingCash) + '</b></div>';
    html += '<div class="fleet-reserve-row"><label>准备金</label><b>' + fmt(camp.reserve) + '</b>';
    html += '<button class="fleet-btn secondary" data-action="reserve-down">-' + cfg.capital.reserveStep + '</button>';
    html += '<button class="fleet-btn secondary" data-action="reserve-up">+' + cfg.capital.reserveStep + '</button>';
    html += '</div>';
    html += '<div class="fleet-reserve-row"><label>总资金</label><b>' + fmt(totalFunds) + '</b></div>';
    html += '<div class="fleet-info">准备金上限 ' + cfg.capital.maxReserve + '。准备金越多，抗损失能力越强，但可用于经营的资金越少。</div>';

    var reserveRatio = totalFunds > 0 ? (camp.reserve / totalFunds * 100) : 0;
    html += '<div class="fleet-info">准备金占比 <b>' + fmt(reserveRatio) + '%</b>';
    if (reserveRatio < 20) html += ' · <span style="color:#8C3A2E">抗风险能力较弱</span>';
    else if (reserveRatio > 50) html += ' · <span style="color:#5A6B4A">抗风险能力较强</span>';
    html += '</div>';

    if (expected) {
      html += '<div class="fleet-info"><b>预期预览（事前概率加权）：</b>';
      html += '预期收入 ' + fmt(expected.expectedVoyageIncome) + ' · ';
      html += '预期货损 ' + fmt(expected.expectedCargoLoss) + ' · ';
      html += '再保险费 ' + fmt(expected.expectedReinsuranceCost) + ' · ';
      html += '预期净利润 <b>' + fmt(expected.expectedNetResult) + '</b></div>';

      if (expected.routeConcentration && expected.routeConcentration.length > 0) {
        var concParts = [];
        for (var rc = 0; rc < expected.routeConcentration.length; rc++) {
          var rcItem = expected.routeConcentration[rc];
          if (rcItem.count > 1) {
            concParts.push(routeName(rcItem.routeId) + ' ' + rcItem.count + '艘');
          }
        }
        if (concParts.length > 0) {
          html += '<div class="fleet-warning">航线集中：' + concParts.join('、') + '</div>';
        }
      }
    }
    html += '</div>';

    /* 区域 5：再保险（只读展示） */
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
    html += '<div class="fleet-info">已购买（自动生效） · 费率 ' + Math.round(cfg.reinsurance.premiumRate * 100) + '% · 本轮费用 <b>' + fmt(riCost) + '</b> · 自留额 ' + cfg.reinsurance.perClaimThreshold + ' · 超出部分承担 ' + Math.round(cfg.reinsurance.coverRate * 100) + '%</div>';
    html += '</div>';

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
    bindPlanningEvents(camp);
  }

  function bindPlanningEvents(camp) {
    var routeButtons = panelBody.querySelectorAll('[data-ship][data-route]');
    for (var i = 0; i < routeButtons.length; i++) {
      routeButtons[i].addEventListener('click', function() {
        var shipId = this.getAttribute('data-ship');
        var routeId = this.getAttribute('data-route');
        runtime().setAssignment(shipId, routeId === 'null' ? null : routeId);
        render();
      });
    }

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

    var submitBtn = panelBody.querySelector('[data-action="submit"]');
    if (submitBtn) submitBtn.addEventListener('click', function() {
      showConfirmDialog('提交方案', '确认提交本轮方案并结算？提交后不可修改。', function() {
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
    });

    var abandonBtn = panelBody.querySelector('[data-action="abandon"]');
    if (abandonBtn) abandonBtn.addEventListener('click', function() {
      showConfirmDialog('放弃 campaign', '确认放弃当前 campaign？将归档并结束。', function() {
        var r = runtime().abandonCampaign();
        if (r.ok) {
          currentView = 'campaign-start';
          render();
        }
      });
    });
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

  /* ── Result 视图 ── */
  function renderResult(camp) {
    var lastRound = camp.rounds[camp.rounds.length - 1];
    if (!lastRound) { currentView = 'planning'; render(); return; }

    var html = fleetBar(camp);

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

    /* 预期 vs 实际 */
    var expected = model().expectedRound(lastRound.assignments, camp.commonRiskState, camp.seed, lastRound.round);
    if (expected) {
      var actualNet = lastRound.voyageIncome - lastRound.reinsuranceCost - lastRound.playerLoss;
      html += '<div class="fleet-section"><h3 class="fleet-section-title">预期 vs 实际</h3>';
      html += '<table class="fleet-result-table">';
      html += '<tr><th></th><th>预期（事前）</th><th>实际</th><th>差异</th></tr>';
      html += '<tr><td>航运收入</td><td>' + fmt(expected.expectedVoyageIncome) + '</td><td>' + fmt(lastRound.voyageIncome) + '</td><td>' + fmt(lastRound.voyageIncome - expected.expectedVoyageIncome) + '</td></tr>';
      html += '<tr><td>货损</td><td>' + fmt(expected.expectedCargoLoss) + '</td><td>' + fmt(lastRound.cargoLoss) + '</td><td>' + fmt(lastRound.cargoLoss - expected.expectedCargoLoss) + '</td></tr>';
      html += '<tr><td>再保险费</td><td>' + fmt(expected.expectedReinsuranceCost) + '</td><td>' + fmt(lastRound.reinsuranceCost) + '</td><td>' + fmt(lastRound.reinsuranceCost - expected.expectedReinsuranceCost) + '</td></tr>';
      html += '<tr><td>再保险回收</td><td>' + fmt(expected.expectedReinsuranceRecovery) + '</td><td>' + fmt(lastRound.reinsuranceRecovery) + '</td><td>' + fmt(lastRound.reinsuranceRecovery - expected.expectedReinsuranceRecovery) + '</td></tr>';
      html += '<tr class="total"><td>净利润</td><td>' + fmt(expected.expectedNetResult) + '</td><td>' + fmt(actualNet) + '</td><td>' + fmt(actualNet - expected.expectedNetResult) + '</td></tr>';
      html += '</table></div>';
    }

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

    html += '<div class="fleet-section"><h3 class="fleet-section-title">本轮汇总</h3>';
    html += '<table class="fleet-result-table">';
    html += '<tr><td>航运收入</td><td><b>' + fmt(lastRound.voyageIncome) + '</b></td></tr>';
    html += '<tr><td>货损总额</td><td><b>' + fmt(lastRound.cargoLoss) + '</b></td></tr>';
    html += '<tr><td>再保险费用</td><td><b>' + fmt(lastRound.reinsuranceCost) + '</b></td></tr>';
    html += '<tr><td>再保险回收</td><td><b>' + fmt(lastRound.reinsuranceRecovery) + '</b></td></tr>';
    html += '<tr class="total"><td>净利润</td><td>' + fmt(lastRound.voyageIncome - lastRound.reinsuranceCost - lastRound.playerLoss) + '</td></tr>';
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
    html += '<label>总资金</label><span>' + fmt(lastRound.operatingCashBefore + lastRound.reserveBefore) + ' → <b>' + fmt(lastRound.totalFundsAfter) + '</b></span>';
    html += '</div>';

    if (lastRound.insolvent) {
      html += '<div class="fleet-warning"><b>资金缺口！</b>经营资金和准备金均不足以覆盖损失。</div>';
    }
    html += '</div>';

    html += '<div class="fleet-actions">';
    if (camp.phase === 'planning') {
      html += '<button class="fleet-btn primary" data-action="next-round">进入下一回合</button>';
    }
    html += '<button class="fleet-btn danger" data-action="abandon-result">放弃 campaign</button>';
    html += '</div>';

    panelBody.innerHTML = html;

    var nextBtn = panelBody.querySelector('[data-action="next-round"]');
    if (nextBtn) nextBtn.addEventListener('click', function() {
      currentView = 'planning';
      render();
    });
    var abBtn = panelBody.querySelector('[data-action="abandon-result"]');
    if (abBtn) abBtn.addEventListener('click', function() {
      showConfirmDialog('放弃 campaign', '确认放弃当前 campaign？将归档并结束。', function() {
        var r = runtime().abandonCampaign();
        if (r.ok) {
          currentView = 'campaign-start';
          render();
        }
      });
    });
  }

  /* ── Summary 视图 ── */
  function renderSummary(camp) {
    var html = '<div class="fleet-section"><h3 class="fleet-section-title">Campaign 总结</h3>';

    var finalTotal = camp.operatingCash + camp.reserve;
    var cfg = config();
    var startTotal = cfg.capital.startingOperatingCash + cfg.capital.startingReserve;

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
      totalIncome += r.voyageIncome;
      totalLoss += r.cargoLoss;
      totalRiCost += r.reinsuranceCost;
      totalRiRecovery += r.reinsuranceRecovery;
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

    html += '<div class="fleet-section"><h3 class="fleet-section-title">逐轮回顾</h3>';
    for (var j = 0; j < camp.rounds.length; j++) {
      var rr = camp.rounds[j];
      var netProfit = rr.voyageIncome - rr.reinsuranceCost - rr.playerLoss;
      html += '<div class="fleet-info">第 ' + rr.round + ' 回合：净利润 <b>' + fmt(netProfit) + '</b>';
      if (rr.storms.length > 0) html += ' · 风暴 ' + rr.storms.length + ' 次';
      if (rr.batchDefects.length > 0) html += ' · 批次缺陷';
      html += ' · 收入 ' + fmt(rr.voyageIncome) + ' · 货损 ' + fmt(rr.cargoLoss);
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="fleet-actions">';
    html += '<button class="fleet-btn primary" data-action="new-campaign">开始新 campaign</button>';
    html += '<button class="fleet-btn secondary" data-action="close-summary">关闭</button>';
    html += '</div>';

    panelBody.innerHTML = html;

    var newBtn = panelBody.querySelector('[data-action="new-campaign"]');
    if (newBtn) newBtn.addEventListener('click', function() {
      var r = runtime().startCampaign();
      if (r.ok) {
        currentView = 'planning';
        render();
      }
    });
    var closeBtn = panelBody.querySelector('[data-action="close-summary"]');
    if (closeBtn) closeBtn.addEventListener('click', function() {
      close();
    });
  }

  /* ── 导出 ── */
  global.FleetUI = Object.freeze({
    open: open,
    close: close
  });
})(typeof window !== 'undefined' ? window : globalThis);
`;

console.log('Writing fleet-ui.js (Step 2 full rewrite)...');
fs.writeFileSync(TARGET, NEW_CONTENT, 'utf8');
console.log('✓ Written', NEW_CONTENT.length, 'bytes');

console.log('\nVerifying syntax...');
try {
  execSync('node -c "' + TARGET + '"', { stdio: 'inherit' });
  console.log('✓ Syntax OK');
} catch (e) {
  console.error('✗ Syntax check failed');
  process.exit(1);
}

console.log('\nReading back first 20 lines...');
const content = fs.readFileSync(TARGET, 'utf8');
const lines = content.split('\n');
for (var i = 0; i < 20 && i < lines.length; i++) {
  console.log((i + 1) + ': ' + lines[i]);
}

console.log('\n✓ Patch complete');
