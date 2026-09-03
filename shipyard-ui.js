/* 概率世界 · 造船厂质检房 V0.2 —— 质检 UI（只渲染 + 调 ShipyardRuntime，不直接改系统状态）
 * 交互流程：船的呈现 → 公开信息 → 逐部位抽样 → 决策幕 → 航程揭晓 → 报告页
 * 复盘只陈述事实，不出现"答对/答错/掌握度"类评价。 */
(function attachShipyardUI(global) {
  'use strict';

  const doc = () => global.document;
  const runtime = () => global.ShipyardRuntime;
  const config = () => global.SHIPYARD_CONFIG;
  const model = () => global.ShipyardModel;
  const scene = () => global.pixelHarborScene;

  const ZONE_LABEL = zone => (config().batch.zoneLabels[zone]) || zone;
  const partLabel = id => { const [zone, n] = id.split('-'); return ZONE_LABEL(zone) + ' ' + n + ' 号位'; };
  const SEVERITY_LABEL = { major: '严重缺陷', minor: '轻微缺陷' };

  let overlay = null, body = null;
  let view = 'home';
  let currentMethod = null;
  let voyageTimer = null;

  /* ── 样式 ── */
  function injectStyle() {
    if (doc().getElementById('shipyard-ui-style')) return;
    const st = doc().createElement('style');
    st.id = 'shipyard-ui-style';
    st.textContent = `
#shipyard-overlay{position:fixed;inset:0;z-index:99994;display:none;align-items:flex-start;justify-content:center;padding:56px 16px 16px;background:rgba(20,16,12,.48);box-sizing:border-box;overflow-y:auto}
#shipyard-overlay.show{display:flex}
#shipyard-panel{position:relative;width:min(760px,92vw);max-height:calc(100vh - 72px);overflow-y:auto;padding:22px 24px 24px;background:#E8D7B0;color:#211B17;border:3px solid #3E2A1B;box-shadow:4px 4px 0 #14100C,inset 0 0 0 1px #C89B3C;box-sizing:border-box;font-family:NotoPixelCN,sans-serif}
#shipyard-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;margin-bottom:14px;border-bottom:2px solid #B18A45}
#shipyard-title{margin:0;color:#17324A;font-size:20px;line-height:1.3}
#shipyard-close{flex:none;width:44px;height:44px;background:#8C3A2E;color:#E8D7B0;border:2px solid #3E2A1B;font:20px NotoPixelCN,sans-serif;cursor:pointer;box-shadow:2px 2px 0 #14100C;display:flex;align-items:center;justify-content:center}
#shipyard-close:hover{background:#A64B3D;border-color:#E8C87A}
#shipyard-coins{color:#6B4A2F;font-size:12px;margin-bottom:10px}
.shipyard-section{margin:0 0 14px;padding:14px;background:#F2E5C8;border:2px solid #B18A45;box-shadow:2px 2px 0 rgba(33,22,15,.22)}
.shipyard-section-title{display:flex;align-items:center;gap:8px;margin:0 0 8px;padding-bottom:6px;color:#17324A;font-size:15px;border-bottom:1px solid #B18A45}
.shipyard-section-title .count{color:#8D6B32;font-size:11px;margin-left:auto}
.shipyard-card{margin:10px 0;padding:12px;background:#C9B283;border:1px solid #B18A45;box-shadow:2px 2px 0 #211B17;line-height:1.6;font-size:13px}
.shipyard-card b{color:#3E2A1B}
.shipyard-quote{margin:8px 0;padding:10px 12px;background:#E8D7B0;border-left:3px solid #8C3A2E;font-style:italic;line-height:1.6;font-size:13px;color:#3E2A1B}
.shipyard-ledger{margin:8px 0;padding:10px 12px;background:#F2E5C8;border:1px solid #B18A45;font-size:13px;line-height:1.7;color:#211B17}
.shipyard-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}
.shipyard-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.shipyard-action{min-height:44px;padding:8px 10px;background:#6B4A2F;color:#E8D7B0;border:2px solid #3E2A1B;box-shadow:2px 2px 0 #14100C;font:13px NotoPixelCN,sans-serif;cursor:pointer;text-align:left;white-space:normal;line-height:1.4}
.shipyard-action small{display:block;margin-top:2px;color:#E8C87A;font-size:11px}
.shipyard-action:hover:not(:disabled){background:#7D5A3A;border-color:#E8C87A}
.shipyard-action:active:not(:disabled){transform:translate(2px,2px)}
.shipyard-action:disabled{opacity:.45;cursor:not-allowed}
.shipyard-action.selected{background:#8C3A2E;border-color:#E8C87A}
.shipyard-action.secondary{background:#C9B283;color:#3E2A1B}
.shipyard-action.secondary small{color:#6B4A2F}
.shipyard-muted{color:#6B4A2F;font-size:12px}
.shipyard-stats{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0;padding:8px 10px;background:#E8D7B0;border:1px solid #B18A45;font-size:12px;color:#3E2A1B}
.shipyard-stats b{color:#8C3A2E}
.sy-ship{position:relative;width:100%;height:170px;margin:10px 0;background:#D4C4A0;border:2px solid #6B4A2F;overflow:hidden}
.sy-zone{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#C9B283;border:2px solid #6B4A2F;cursor:pointer;transition:background .12s,border-color .12s;box-sizing:border-box;text-align:center;padding:2px}
.sy-zone:hover:not(.disabled){background:#E8D7B0;border-color:#C89B3C}
.sy-zone.disabled{opacity:.35;cursor:not-allowed}
.sy-zone.sampled{background:#A89060;border-color:#3E2A1B}
.sy-zone.defect-found{background:#8C3A2E;border-color:#3E2A1B;color:#E8D7B0}
.sy-zone-label{font:12px NotoPixelCN,sans-serif;color:#3E2A1B;pointer-events:none}
.sy-zone.disabled .sy-zone-label{color:#6B4A2F}
.sy-zone.defect-found .sy-zone-label{color:#E8D7B0}
.sy-zone-count{font:10px NotoPixelCN,sans-serif;color:#6B4A2F;pointer-events:none}
.sy-zone.defect-found .sy-zone-count{color:#C9B283}
.sy-hull{left:4%;top:52%;width:92%;height:44%;border-radius:0 0 12px 12px}
.sy-deck{left:8%;top:32%;width:84%;height:20%}
.sy-cargo{left:20%;top:62%;width:56%;height:26%}
.sy-rigging{left:30%;top:2%;width:40%;height:28%}
.shipyard-parts{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
.shipyard-part{padding:2px 6px;background:#E8D7B0;border:1px solid #6B4A2F;font-size:11px}
.shipyard-part.defect{background:#8C3A2E;color:#E8D7B0;border-color:#3E2A1B}
.shipyard-part.missed{background:#F2E5C8;border:1px dashed #8C3A2E;color:#8C3A2E}
.shipyard-part.unknown{background:#C9B283;border:1px dashed #6B4A2F;color:#6B4A2F}
.shipyard-cost-table{width:100%;border-collapse:collapse;margin:8px 0;font-size:13px}
.shipyard-cost-table td,.shipyard-cost-table th{padding:5px 8px;border-bottom:1px solid #B18A45;text-align:left}
.shipyard-cost-table th{color:#17324A;font-size:12px}
.shipyard-cost-table .total{font-weight:bold;color:#8C3A2E;border-top:2px solid #B18A45}
.shipyard-voyage{text-align:center;padding:20px 16px}
.shipyard-voyage-result{font-size:18px;color:#17324A;margin:12px 0}
.shipyard-voyage-detail{font-size:13px;color:#6B4A2F;line-height:1.6}
.shipyard-history-item{display:block;width:100%;margin:6px 0;padding:10px;background:#F2E5C8;border:1px solid #B18A45;color:#211B17;font:12px NotoPixelCN,sans-serif;cursor:pointer;text-align:left;box-shadow:2px 2px 0 #211B17}
.shipyard-history-item:hover{border-color:#C89B3C}
.shipyard-fact{margin:4px 0;padding-left:12px;border-left:2px solid #B18A45;font-size:13px;line-height:1.6;color:#3E2A1B}
@media(max-width:560px){#shipyard-overlay{padding:48px 8px 8px}#shipyard-panel{padding:16px}.shipyard-grid,.shipyard-grid.three{grid-template-columns:1fr}#shipyard-title{font-size:17px}.sy-ship{height:140px}}`;
    doc().head.appendChild(st);
  }

  /* ── DOM ── */
  function ensureDom() {
    if (overlay) return;
    injectStyle();
    overlay = doc().createElement('div');
    overlay.id = 'shipyard-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<section id="shipyard-panel" role="dialog" aria-modal="true" aria-labelledby="shipyard-title">'
      + '<div id="shipyard-header"><h2 id="shipyard-title">造船厂 · 质检房</h2>'
      + '<button id="shipyard-close" type="button" aria-label="离开质检房">×</button></div>'
      + '<div id="shipyard-coins"></div>'
      + '<div id="shipyard-body"></div></section>';
    doc().body.appendChild(overlay);
    body = overlay.querySelector('#shipyard-body');
    overlay.querySelector('#shipyard-close').addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    doc().addEventListener('keydown', function(e) { if (e.key === 'Escape' && overlay.classList.contains('show')) close(); });
  }

  function btn(action, label, opts) {
    const o = opts || {};
    return '<button class="shipyard-action' + (o.selected ? ' selected' : '') + (o.secondary ? ' secondary' : '') + '" data-sy="' + action + '"' + (o.disabled ? ' disabled' : '') + '>' + label + (o.small ? '<small>' + o.small + '</small>' : '') + '</button>';
  }

  function coinsLine() {
    const el = overlay && overlay.querySelector('#shipyard-coins');
    if (el) el.textContent = '◉ 潮汐币：' + runtime().coins();
  }

  /* ── 船舶可视化 ── */
  function zoneStats(insp, batch) {
    const zones = config().batch.zones;
    const stats = {};
    zones.forEach(function(z) {
      const total = config().batch.partsPerZone;
      const sampled = (insp.sampledParts || []).filter(function(id) { return id.split('-')[0] === z; });
      const defects = sampled.filter(function(id) { return (insp.defectsFound || []).indexOf(id) !== -1; });
      stats[z] = { total: total, sampled: sampled.length, defects: defects.length };
    });
    return stats;
  }

  function shipHtml(insp, batch) {
    const stats = zoneStats(insp, batch);
    const methodCfg = currentMethod ? config().samplingMethods[currentMethod] : null;
    const allowedZones = methodCfg ? (methodCfg.zones || config().batch.zones) : config().batch.zones;
    const zones = [
      { id: 'rigging', css: 'sy-rigging', label: '索具' },
      { id: 'deck', css: 'sy-deck', label: '甲板' },
      { id: 'hull', css: 'sy-hull', label: '船体' },
      { id: 'cargo', css: 'sy-cargo', label: '货舱' }
    ];
    return '<div class="sy-ship">' + zones.map(function(z) {
      const s = stats[z.id] || { total: 6, sampled: 0, defects: 0 };
      const allowed = allowedZones.indexOf(z.id) !== -1;
      const allSampled = s.sampled >= s.total;
      const cls = ['sy-zone', z.css];
      if (!allowed || allSampled) cls.push('disabled');
      if (s.sampled > 0 && !s.defects) cls.push('sampled');
      if (s.defects > 0) cls.push('defect-found');
      return '<div class="' + cls.join(' ') + '" data-zone="' + z.id + '" title="' + z.label + '：已查 ' + s.sampled + '/' + s.total + (s.defects ? '，发现 ' + s.defects + ' 处缺陷' : '') + '">'
        + '<span class="sy-zone-label">' + z.label + '</span>'
        + '<span class="sy-zone-count">' + s.sampled + '/' + s.total + (s.defects ? ' ✕' + s.defects : '') + '</span>'
        + '</div>';
    }).join('') + '</div>';
  }

  /* ── 视图 ── */

  function renderHome() {
    view = 'home';
    const ship = config().testShip;
    const active = runtime().getActive();
    const info = ship.publicInfo;
    body.innerHTML =
      '<div class="shipyard-section"><div class="shipyard-section-title">船东的话</div>'
      + '<div class="shipyard-quote">"' + info.schedulePressure + '"</div>'
      + '<div class="shipyard-quote">"' + info.inspectionBudget + '"</div></div>'
      + '<div class="shipyard-section"><div class="shipyard-section-title">账册 · ' + ship.shipName + '</div>'
      + '<div class="shipyard-ledger">航线：' + ship.route
      + '<br>船材批次：' + info.materialBatch
      + '<br>公开维修说明：' + info.repairNotes + '</div></div>'
      + '<div class="shipyard-grid">'
      + btn('start', active ? '继续进行中的质检' : '开始质检', { small: active ? '恢复上次未完成的流程' : '登记一张新的质检单' })
      + btn('history', '查看历史质检报告', { secondary: true, small: '已完成的报告会留在这里' })
      + '</div>'
      + (active ? '<p class="shipyard-muted">' + btn('abandon', '搁置当前质检', { secondary: true, small: '不生成报告，已花的检查费不退' }) + '</p>' : '');
  }

  function renderSampling() {
    view = 'sampling';
    const insp = runtime().getActive();
    if (!insp) return renderHome();
    const batch = model().createBatch(insp.seed);
    const coins = runtime().coins();
    const methods = config().samplingMethods;
    const cost = config().perPartCost || 1;
    const delay = config().perPartDelay || 0;
    const clue = config().testShip.clue;

    body.innerHTML =
      '<div class="shipyard-section"><div class="shipyard-section-title">质检单 ' + insp.reportId.slice(-6) + '<span class="count">已查 ' + insp.sampledParts.length + '/' + config().batch.totalParts + '</span></div>'
      + '<div class="shipyard-stats">'
      + '<span>已查部位 <b>' + insp.sampledParts.length + '</b>/' + config().batch.totalParts + '</span>'
      + '<span>已发现缺陷 <b>' + insp.defectsFound.length + '</b></span>'
      + '<span>已花 <b>' + insp.inspectionCost + '</b> 潮汐币</span>'
      + (insp.samplingDelay ? '<span>耽误 <b>' + insp.samplingDelay + '</b> 分钟</span>' : '')
      + '</div></div>'

      + '<div class="shipyard-section"><div class="shipyard-section-title">检查方式</div>'
      + '<div class="shipyard-grid three">'
      + Object.entries(methods).map(function(entry) {
        const k = entry[0], m = entry[1];
        return btn('method-' + k, m.label, { small: m.desc, selected: currentMethod === k });
      }).join('')
      + '</div>'
      + (currentMethod === 'targeted' && clue ? '<div class="shipyard-muted" style="margin-top:6px">线索：' + clue.text + '（' + ZONE_LABEL(clue.zone) + '区域）</div>' : '')
      + (currentMethod ? '<div class="shipyard-muted" style="margin-top:4px">点击船上高亮区域检查一个部位（每次 ' + cost + ' 潮汐币' + (delay ? '，' + delay + ' 分钟' : '') + '）</div>' : '<div class="shipyard-muted" style="margin-top:4px">先选择一种检查方式，再点击船体部位。</div>')
      + '</div>'

      + '<div class="shipyard-section"><div class="shipyard-section-title">' + config().testShip.shipName + '</div>'
      + shipHtml(insp, batch)
      + '</div>'

      + '<div class="shipyard-grid">'
      + btn('to-decide', '停止抽样，做出决定', { small: '不再检查，直接进处置决定', disabled: coins < 0 })
      + '</div>';
  }

  function renderDecide() {
    view = 'decide';
    const insp = runtime().getActive();
    if (!insp) return renderHome();
    const batch = model().createBatch(insp.seed);
    const coins = runtime().coins();
    const dec = config().decisions;
    const finalKeys = ['release', 'repair_partial', 'repair_full', 'hold'];

    const sampledHtml = insp.sampledParts.length
      ? '<div class="shipyard-parts">' + insp.sampledParts.map(function(id) {
        const isDefect = insp.defectsFound.indexOf(id) !== -1;
        return '<span class="shipyard-part' + (isDefect ? ' defect' : '') + '">' + partLabel(id) + (isDefect ? ' ✕' : ' ✓') + '</span>';
      }).join('') + '</div>'
      : '<p class="shipyard-muted">没有检查过任何部位。</p>';

    const unsampledCount = config().batch.totalParts - insp.sampledParts.length;

    body.innerHTML =
      '<div class="shipyard-section"><div class="shipyard-section-title">你查到了什么</div>'
      + sampledHtml
      + '<div class="shipyard-muted">还有 ' + unsampledCount + ' 个部位未检查，状态未知。</div></div>'

      + '<div class="shipyard-section"><div class="shipyard-section-title">处置决定</div>'
      + '<div class="shipyard-grid">'
      + finalKeys.map(function(k) {
        const d = dec[k];
        return btn('decide-' + k, d.label, {
          small: d.desc + '（' + d.cost + ' 潮汐币' + (d.delay ? '，误 ' + d.delay + ' 分钟' : '') + '）',
          disabled: coins < d.cost
        });
      }).join('')
      + '</div>'
      + btn('to-sampling', dec.sample_more.label, { secondary: true, small: dec.sample_more.desc })
      + '</div>';
  }

  function renderVoyage(report, batch) {
    view = 'voyage';
    const outcome = report.actualOutcome;
    let resultText, detailText;
    if (!outcome.sailed) {
      resultText = '曙光号没有出航';
      detailText = '船留在船台，错过这一潮。';
    } else if (outcome.accident) {
      resultText = '曙光号出航后发生事故';
      detailText = '起因部位：' + partLabel(outcome.accidentCause);
    } else {
      resultText = '曙光号平安抵达北岬';
      detailText = '航程顺利，没有发生事故。';
    }
    body.innerHTML =
      '<div class="shipyard-section"><div class="shipyard-section-title">航程揭晓</div>'
      + '<div class="shipyard-voyage">'
      + '<div class="shipyard-voyage-result">' + resultText + '</div>'
      + '<div class="shipyard-voyage-detail">' + detailText + '</div>'
      + '</div>'
      + '<div class="shipyard-grid">' + btn('to-report', '查看完整报告', {}) + '</div>'
      + '</div>';
  }

  function reportSections(report, batch) {
    const outcome = report.actualOutcome;
    const foundSet = new Set(report.defectsFound);
    const missedSet = new Set(outcome.missedDefects);
    const defectOf = function(id) { const p = (batch || []).find(function(x) { return x.id === id; }); return p ? p.defect : null; };
    const sevTag = function(id) { const d = defectOf(id); return d ? '（' + SEVERITY_LABEL[d] + '）' : ''; };

    const sampledHtml = report.sampledParts.length
      ? '<div class="shipyard-parts">' + report.sampledParts.map(function(id) {
        return '<span class="shipyard-part' + (foundSet.has(id) ? ' defect' : '') + '">' + partLabel(id) + (foundSet.has(id) ? ' ✕' : ' ✓') + '</span>';
      }).join('') + '</div>'
      : '<p class="shipyard-muted">没有抽过样。</p>';

    const actualHtml = '<div class="shipyard-parts">' + outcome.allDefectIds.map(function(id) {
      return '<span class="shipyard-part' + (missedSet.has(id) ? ' missed' : ' defect') + '">' + partLabel(id) + sevTag(id) + (missedSet.has(id) ? ' · 未发现' : '') + '</span>';
    }).join('') + '</div>';

    const facts = [];
    if (outcome.wrongRelease) facts.push('有 ' + outcome.missedDefects.length + ' 处缺陷没被样本发现，随船出航。');
    if (outcome.overReject) facts.push('样本其实已经发现了全部缺陷，这次的' + (report.repairLevel === 'hold' ? '暂停出航' : '全面返修') + '多花了' + (report.repairLevel === 'hold' ? '船期' : '费用与船期') + '。');
    if (!outcome.wrongRelease && !outcome.overReject && report.decision !== 'hold') facts.push('样本结论与实际质量基本一致。');
    if (report.decision === 'hold' && !outcome.overReject) facts.push('船没有出航，缺陷留在船台等下一潮。');

    const totalCost = report.inspectionCost + report.repairCost;

    return '<div class="shipyard-section"><div class="shipyard-section-title">你抽到了什么<span class="count">覆盖 ' + Math.round(report.estimatedReliability.coverage * 100) + '%</span></div>'
      + sampledHtml + '</div>'

      + '<div class="shipyard-section"><div class="shipyard-section-title">实际存在什么<span class="count">共 ' + outcome.allDefectIds.length + ' 处</span></div>'
      + actualHtml + '</div>'

      + '<div class="shipyard-section"><div class="shipyard-section-title">这次航程</div>'
      + '<div class="shipyard-card">'
      + (outcome.sailed
        ? (outcome.accident ? '曙光号出航后发生事故，起因部位：' + partLabel(outcome.accidentCause) + '。' : '曙光号平安抵达北岬。')
        : '曙光号没有出航。')
      + '</div></div>'

      + '<div class="shipyard-section"><div class="shipyard-section-title">成本账</div>'
      + '<table class="shipyard-cost-table">'
      + '<tr><th>项目</th><th>数额</th></tr>'
      + '<tr><td>检查费用</td><td>' + report.inspectionCost + ' 潮汐币</td></tr>'
      + '<tr><td>返修 / 处置</td><td>' + report.repairCost + ' 潮汐币</td></tr>'
      + '<tr><td>船期延误</td><td>' + report.departureDelay + ' 分钟</td></tr>'
      + '<tr class="total"><td>总计</td><td>' + totalCost + ' 潮汐币</td></tr>'
      + '</table></div>'

      + '<div class="shipyard-section"><div class="shipyard-section-title">事实记录</div>'
      + (facts.length ? facts.map(function(f) { return '<div class="shipyard-fact">' + f + '</div>'; }).join('') : '<div class="shipyard-fact">没有需要特别记录的事实。</div>')
      + '</div>';
  }

  function renderReport(report, batch, fromHistory) {
    view = 'report';
    body.innerHTML =
      '<div class="shipyard-section"><div class="shipyard-section-title">质检报告 ' + report.reportId.slice(-6) + '<span class="count">' + report.shipName + '</span></div>'
      + '<div class="shipyard-muted">' + (report.completedAt || report.createdAt || '').slice(0, 16).replace('T', ' ') + '</div></div>'
      + reportSections(report, batch)
      + '<div class="shipyard-grid">'
      + (fromHistory ? btn('history', '返回报告列表', { secondary: true }) : btn('home', '收下这份报告', {}))
      + btn('close', '返回街道', { secondary: true })
      + '</div>';
  }

  function renderHistory() {
    view = 'history';
    const reports = runtime().listReports();
    body.innerHTML =
      '<div class="shipyard-section"><div class="shipyard-section-title">历史质检报告<span class="count">共 ' + reports.length + ' 份</span></div></div>'
      + (reports.length
        ? reports.slice().reverse().map(function(r) {
          return '<button class="shipyard-history-item" data-sy="detail-' + r.reportId + '">'
            + '<b>' + r.shipName + '</b>｜' + (config().decisions[r.decision] ? config().decisions[r.decision].label : r.decision)
            + '｜查 ' + r.sampledParts.length + ' 部位 / 发现 ' + r.defectsFound.length
            + '｜' + (r.actualOutcome.sailed ? (r.actualOutcome.accident ? '出航·事故' : '出航·平安') : '未出航')
            + '<br><span class="shipyard-muted">' + (r.completedAt || '').slice(0, 16).replace('T', ' ') + '｜花费 ' + (r.inspectionCost + r.repairCost) + ' 潮汐币｜误 ' + r.departureDelay + ' 分钟</span>'
            + '</button>';
        }).join('')
        : '<p class="shipyard-muted">还没有完成的质检。</p>')
      + '<div class="shipyard-grid">' + btn('home', '返回质检台', { secondary: true }) + '</div>';
  }

  function render() {
    coinsLine();
    if (view === 'home') renderHome();
    else if (view === 'sampling') renderSampling();
    else if (view === 'decide') renderDecide();
    else if (view === 'history') renderHistory();
  }

  /* ── 交互分发 ── */
  function onAction(action) {
    const R = runtime();
    if (action === 'start') {
      R.start();
      currentMethod = null;
      renderSampling(); coinsLine(); return;
    }
    if (action === 'abandon') { R.abandon(); currentMethod = null; renderHome(); coinsLine(); return; }
    if (action === 'home') { renderHome(); coinsLine(); return; }
    if (action === 'history') { renderHistory(); coinsLine(); return; }
    if (action === 'close') { close(); return; }
    if (action === 'to-sampling') { renderSampling(); coinsLine(); return; }
    if (action === 'to-decide') { renderDecide(); coinsLine(); return; }
    if (action === 'to-report') {
      const insp = lastReport;
      if (insp) renderReport(insp.report, insp.batch, false);
      coinsLine(); return;
    }
    if (action.indexOf('method-') === 0) { currentMethod = action.slice(7); renderSampling(); coinsLine(); return; }
    if (action.indexOf('decide-') === 0) {
      const res = R.submitDecision(action.slice(7));
      if (!res.ok) { renderDecide(); coinsLine(); return; }
      lastReport = res;
      renderVoyage(res.report, res.batch); coinsLine(); return;
    }
    if (action.indexOf('detail-') === 0) {
      const report = R.getReport(action.slice(7));
      if (!report) { renderHistory(); coinsLine(); return; }
      const batch = report.seed ? model().createBatch(report.seed) : null;
      renderReport(report, batch, true); coinsLine(); return;
    }
  }

  let lastReport = null;

  function onZoneClick(zone) {
    if (!currentMethod) return;
    const R = runtime();
    const insp = R.getActive();
    if (!insp) return;
    const methodCfg = config().samplingMethods[currentMethod];
    if (methodCfg && methodCfg.zones && methodCfg.zones.indexOf(zone) === -1) return;
    const batch = model().createBatch(insp.seed);
    const available = batch.filter(function(p) { return p.zone === zone && insp.sampledParts.indexOf(p.id) === -1; });
    if (!available.length) return;
    const partId = available[0].id;
    const res = R.sampleSinglePart(currentMethod, partId);
    if (!res.ok) { renderSampling(); coinsLine(); return; }
    renderSampling(); coinsLine();
  }

  /* ── 开关 ── */
  function open() {
    ensureDom();
    const s = scene();
    if (s) { s.clearDialogue && s.clearDialogue(); s.panelOpen = true; }
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    if (runtime().getActive()) { renderSampling(); }
    else { renderHome(); }
    coinsLine();
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    const s = scene();
    if (s) s.panelOpen = false;
    if (voyageTimer) { clearTimeout(voyageTimer); voyageTimer = null; }
  }

  function isOpen() { return !!(overlay && overlay.classList.contains('show')); }

  function bindOnce() {
    ensureDom();
    overlay.addEventListener('click', function(e) {
      const zoneEl = e.target.closest('[data-zone]');
      if (zoneEl && !zoneEl.classList.contains('disabled')) {
        onZoneClick(zoneEl.dataset.zone);
        return;
      }
      const b = e.target.closest('[data-sy]');
      if (!b || b.disabled) return;
      onAction(b.dataset.sy);
    });
  }

  if (typeof document !== 'undefined' && document.readyState !== 'loading') bindOnce();
  else if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', bindOnce);

  global.ShipyardUI = Object.freeze({ open: open, close: close, isOpen: isOpen });
})(typeof window !== 'undefined' ? window : globalThis);
