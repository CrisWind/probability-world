/* Step-3 transfer patch: correlated_risk/sampling_representativeness evidence semantics,
 * underwriting-cafe risk-observation tool, shipyard batch-aid, version bumps.
 * Idempotent via markers. Run: node scripts/patch-step3-transfer.js */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const NL = '\r\n'; // index.html is CRLF

let applied = 0, skipped = 0;
function edit(rel, label, oldStr, newStr, marker) {
  const file = path.join(DIR, rel);
  const src = fs.readFileSync(file, 'utf8');
  if (marker && src.includes(marker)) { skipped++; console.log('SKIP', rel, label); return; }
  const idx = src.indexOf(oldStr);
  if (idx === -1) { console.error('ANCHOR FAIL [' + rel + '] ' + label); process.exit(1); }
  fs.writeFileSync(file, src.slice(0, idx) + newStr + src.slice(idx + oldStr.length), 'utf8');
  applied++;
  console.log('APPLY', rel, label);
}

/* ═══ 1. fleet-learning.js: migrations array + stage + migration records ═══ */
edit('fleet-learning.js', 'ensureConcept migrations field', 
  `      c = { conceptId: CONCEPT_ID, encounteredAt: null, encounterRefs: [], focusedOn: [], appliedAt: [] };`,
  `      c = { conceptId: CONCEPT_ID, encounteredAt: null, encounterRefs: [], focusedOn: [], appliedAt: [], migrations: [] };`,
  'migrations: []');
edit('fleet-learning.js', 'ensureConcept migrations array',
  `    if (!Array.isArray(c.appliedAt)) c.appliedAt = [];`,
  `    if (!Array.isArray(c.appliedAt)) c.appliedAt = [];
    if (!Array.isArray(c.migrations)) c.migrations = [];`,
  'if (!Array.isArray(c.migrations))');

const MIGRATION_FUNCS = `  /* ---- migrations：跨场景"再次使用"（已迁移）。只由真实行为链达成一次，不重复追加 ----
   * underwriting_cafe：风险盘已应用共同风险理解 → 承保咖啡馆展开共同风险观察、
   *   当日委托存在可识别聚集、且本局完成过承保决策后记录。
   * inspection_desk：质检房展开批次关联（同批船队）后追加抽样或选择返修/停港并完成质检后记录。
   * 阶段由行为证据推导：unseen → encountered(encounterRefs) → applied(appliedAt) → migrated(migrations)。 */
  function lastAppliedRef(c) {
    var list = c && Array.isArray(c.appliedAt) ? c.appliedAt : [];
    var last = list[list.length - 1];
    return last ? { campaignId: last.campaignId, fromRound: last.fromRound, toRound: last.toRound } : null;
  }

  function findMigration(c, context, contextKey) {
    var list = Array.isArray(c.migrations) ? c.migrations : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].context === context && list[i].contextKey === contextKey) return list[i];
    }
    return null;
  }

  function recordMigration(context, contextKey, entry) {
    if (!context || !contextKey) return null;
    var l = readLearning() || { version: 1, concepts: {} };
    var c = ensureConcept(l);
    var existing = findMigration(c, context, contextKey);
    if (existing) return existing;
    if (Array.isArray(c.migrations) && c.migrations.length > 0) return null; /* 已迁移达成，不再追加 */
    var rec = Object.assign({ context: context, contextKey: contextKey, recordedAt: new Date().toISOString() }, entry);
    if (!Array.isArray(c.migrations)) c.migrations = [];
    c.migrations.push(rec);
    writeLearning(l);
    return rec;
  }

  function recordCafeMigration(input) {
    if (!input || !input.runId) return null;
    return recordMigration('underwriting_cafe', input.runId, {
      runId: input.runId,
      aggregations: Array.isArray(input.aggregations) ? input.aggregations : [],
      decision: input.decision === 'pass' ? 'pass' : 'bid',
      refs: lastAppliedRef(getConcept())
    });
  }

  function recordInspectionMigration(input) {
    if (!input || !input.reportId) return null;
    return recordMigration('inspection_desk', input.reportId, {
      reportId: input.reportId,
      decision: input.decision || null,
      extendedSamples: input.extendedSamples === true,
      managed: input.managed === true
    });
  }

  function evidenceStage() {
    var c = getConcept();
    if (!c) return 'unseen';
    if (Array.isArray(c.migrations) && c.migrations.length > 0) return 'migrated';
    if (Array.isArray(c.appliedAt) && c.appliedAt.length > 0) return 'applied';
    if (Array.isArray(c.encounterRefs) && c.encounterRefs.length > 0) return 'encountered';
    return 'unseen';
  }

`;
edit('fleet-learning.js', 'insert migration helpers', 
  `  global.FleetLearning = Object.freeze({`,
  MIGRATION_FUNCS + `  global.FleetLearning = Object.freeze({`,
  'function recordCafeMigration(input)');
edit('fleet-learning.js', 'export migration api',
  `    recordApplied: recordApplied,
    planChanges: planChanges,
    hasEncounterForCampaign: hasEncounterForCampaign,
    getConcept: getConcept
  });`,
  `    recordApplied: recordApplied,
    planChanges: planChanges,
    hasEncounterForCampaign: hasEncounterForCampaign,
    recordCafeMigration: recordCafeMigration,
    recordInspectionMigration: recordInspectionMigration,
    evidenceStage: evidenceStage,
    getConcept: getConcept
  });`,
  'recordCafeMigration: recordCafeMigration,');

/* ═══ 2. shipyard-runtime.js: batch-aid view flag + inspection migration hook ═══ */
edit('shipyard-runtime.js', 'markBatchAidViewed function',
  `  function getActive() { return readNamespace().activeInspection; }`,
  `  /* 批次观察辅助被玩家展开时调用：在 activeInspection 上记下事实（持久、可恢复），
   * 供 submitDecision 判断"查看后是否追加抽样"。不记录内容、不改变抽样。 */
  function markBatchAidViewed() {
    const ns = readNamespace();
    const insp = ns.activeInspection;
    if (!insp) return { ok: false, reason: 'no-active-inspection' };
    if (!insp.batchAidViewedAt) {
      insp.batchAidViewedAt = new Date().toISOString();
      insp.batchAidViewedRound = insp.rounds.length;
      writeNamespace(ns);
    }
    return { ok: true };
  }

  function getActive() { return readNamespace().activeInspection; }`,
  'function markBatchAidViewed()');
edit('shipyard-runtime.js', 'inspection migration hook in submitDecision',
  `    var sLearn = global.SamplingLearning;
    if (sLearn && sLearn.recordInspectionEncounter) {
      try { sLearn.recordInspectionEncounter(report); }
      catch (err) { console.error('[ShipyardRuntime] sampling learning record failed', err); }
    }`,
  `    var sLearn = global.SamplingLearning;
    if (sLearn && sLearn.recordInspectionEncounter) {
      try { sLearn.recordInspectionEncounter(report); }
      catch (err) { console.error('[ShipyardRuntime] sampling learning record failed', err); }
    }
    /* 学习证据（correlated_risk 迁移）：玩家展开过批次观察并在其后追加抽样/选择返修或停港，
     * 报告落盘后才记录（reportId 去重；达成一次后由模块侧不再追加） */
    var flLearn = global.FleetLearning;
    if (flLearn && flLearn.recordInspectionMigration && insp && insp.batchAidViewedAt) {
      try {
        var aidExtended = insp.rounds.length > (Number(insp.batchAidViewedRound) || 0);
        var aidManaged = decision === 'repair_partial' || decision === 'repair_full' || decision === 'hold';
        if (aidExtended || aidManaged) {
          flLearn.recordInspectionMigration({ reportId: report.reportId, decision: decision, extendedSamples: aidExtended, managed: aidManaged });
        }
      } catch (err) { console.error('[ShipyardRuntime] correlated learning record failed', err); }
    }`,
  'aidExtended = insp.rounds.length');
edit('shipyard-runtime.js', 'export markBatchAidViewed',
  `    start, abandon, sample, sampleSinglePart, submitDecision,
    getActive, listReports, getReport,`,
  `    start, abandon, sample, sampleSinglePart, submitDecision, markBatchAidViewed,
    getActive, listReports, getReport,`,
  'submitDecision, markBatchAidViewed,');

/* ═══ 3. shipyard-ui.js: batch-aid UI in sampling view ═══ */
edit('shipyard-ui.js', 'batchAidOpen state',
  `  let voyageTimer = null;`,
  `  let voyageTimer = null;
  let batchAidOpen = false;`,
  'let batchAidOpen = false;');
const AID_HELPERS = `  /* 批次观察辅助：correlated_risk 已亲历后显示；只读船队登记的同批船，不泄露缺陷、不改抽样 */
  function correlatedStage() {
    const fl = global.FleetLearning;
    return (fl && fl.evidenceStage) ? fl.evidenceStage() : 'unseen';
  }
  function batchAidData() {
    const ship = config().testShip;
    const stage = correlatedStage();
    if (!stage || stage === 'unseen') return null;
    const vessels = (global.FLEET_CONFIG && Array.isArray(global.FLEET_CONFIG.vessels)) ? global.FLEET_CONFIG.vessels : [];
    const own = vessels.find(function(v) { return v.name === ship.shipName; });
    if (!own) return null;
    const peers = vessels.filter(function(v) { return v.shipId !== own.shipId && v.batchId === own.batchId; });
    if (!peers.length) return null;
    return { batchId: own.batchId, batchLabel: own.batchId.replace('batch.', ''), peers: peers.map(function(v) { return v.name; }) };
  }
  function batchAidHtml(insp) {
    const data = batchAidData();
    if (!data) return '';
    const line = config().testShip.shipName + ' 在商会船队中登记船材批次 ' + data.batchLabel + '；同批船队成员还有 ' + data.peers.join('、') + '。';
    let html = '<div class="shipyard-ledger" style="margin-top:2px">';
    if (batchAidOpen) {
      html += '<b>船队同批次观察</b><br>' + line
        + '<br>同一批次的风险来源在船队中共享；是否因此追加抽样、返修或暂停放行，由你决定——这里不暗示本批一定有缺陷，也不替你选部位。';
    }
    html += '<button class="shipyard-action secondary" data-sy="aid-batch" style="margin-top:6px">'
      + (batchAidOpen ? '收起批次观察' : '查看船队同批次关联') + '</button></div>';
    return html;
  }

`;
edit('shipyard-ui.js', 'batch aid helpers',
  `  function samplingCoverageHtml(insp) {`,
  AID_HELPERS + `  function samplingCoverageHtml(insp) {`,
  'function batchAidData()');
edit('shipyard-ui.js', 'render batch aid in sampling',
  `      + samplingCoverageHtml(insp)
      + '</div>'`,
  `      + samplingCoverageHtml(insp)
      + batchAidHtml(insp)
      + '</div>'`,
  'samplingCoverageHtml(insp)\n      + batchAidHtml(insp)');
edit('shipyard-ui.js', 'aid-batch action',
  `    if (action === 'home') { renderHome(); coinsLine(); return; }`,
  `    if (action === 'home') { renderHome(); coinsLine(); return; }
    if (action === 'aid-batch') {
      batchAidOpen = !batchAidOpen;
      if (batchAidOpen) {
        const aidRes = runtime().markBatchAidViewed();
        if (!aidRes || !aidRes.ok) batchAidOpen = false;
      }
      renderSampling(); coinsLine(); return;
    }`,
  `if (action === 'aid-batch') {`);

/* ═══ 4. index.html (CRLF): risk tool DOM/style, scene methods, hooks, script bumps ═══ */
const TOOL_CSS = '<style id="step3-risk-tool-style">.market-risk-tool{margin:6px 8px 0;padding:8px 10px;background:#F2E5C8;border:1px solid #B18A45;color:#211B17;font-size:13px;line-height:1.7;box-sizing:border-box}.market-risk-tool .mrt-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.market-risk-tool button{font:12px NotoPixelCN,sans-serif;color:#E8D7B0;background:#6B4A2F;border:1px solid #3E2A1B;padding:4px 10px;cursor:pointer;box-shadow:2px 2px 0 #14100C}.market-risk-tool button:hover{border-color:#E8C87A}.market-risk-tool .mrt-has{color:#8C3A2E;font-size:12px}.market-risk-tool .mrt-detail{margin-top:6px;padding-top:6px;border-top:1px dashed #B18A45}.market-risk-tool .mrt-note{margin-top:4px;color:#6B4A2F;font-size:12px}</style>';
edit('index.html', 'risk tool DOM + style',
  `<section id="market-play">`,
  TOOL_CSS + `<div id="market-risk-tool" class="market-risk-tool" hidden></div>` + `<section id="market-play">`,
  'id="market-risk-tool"');

const SCAN_METHODS =
`      marketRiskScan(){
        const m=this.market;
        if(!m||!Array.isArray(m.commissions))return{hasAny:false,aggregations:[],facts:[]};
        const routeCounts={},order=[];
        let total=0,max=null;
        for(const c of m.commissions){if(!routeCounts[c.route]){routeCounts[c.route]=0;order.push(c.route)}routeCounts[c.route]++;total+=c.value;if(!max||c.value>max.value)max={ship:c.ship,value:c.value,route:c.route}}
        const aggs=[],facts=[];
        const shared=order.filter(r=>routeCounts[r]>=2);
        if(shared.length){for(const r of shared){aggs.push({type:'route-shared',route:r,count:routeCounts[r]});facts.push('今日有 '+routeCounts[r]+' 份委托涉及「'+r+'」。若同时承接，它们可能暴露于同一航线风险。')}}else{facts.push('航线分布：今日 '+m.commissions.length+' 份委托分属 '+order.length+' 条不同航线，没有同航线重复。')}
        const share=max&&total>0?max.value/total:0;
        if(share>=.4){const pct=Math.round(share*100);aggs.push({type:'value-concentration',ship:max.ship,value:max.value,share:pct});facts.push('货值集中：'+max.ship+' 一单货值 '+max.value+' 潮汐币，占今日委托总额约 '+pct+'%。若这一单出险，赔付会占掉本上午承保组合的大头。')}
        facts.push('今日委托没有提供统一出航时刻与船队编号：是否相近出航、是否同一船东多航次，无法可靠判断——信息不足，不做推测。');
        return{hasAny:aggs.length>0,aggregations:aggs,facts};
      }
      updateMarketRiskTool(){
        const el=document.getElementById('market-risk-tool');
        if(!el)return;
        const m=this.market;
        if(!m||m.phase!=='bidding'){el.hidden=true;return}
        const fl=window.FleetLearning;
        const stage=fl&&fl.evidenceStage?fl.evidenceStage():'unseen';
        if(stage!=='applied'&&stage!=='migrated'){el.hidden=true;return}
        el.hidden=false;
        const scan=this.marketRiskScan();
        const open=m.riskToolOpen===true;
        let html='<div class="mrt-head"><b>共同风险观察</b>'+(scan.hasAny?'<span class="mrt-has">今日委托存在可识别的风险聚集</span>':'<span class="mrt-has">今日未见可识别的聚集</span>')+'<button data-action="risk-tool" type="button">'+(open?'收起观察':'展开观察')+'</button></div>';
        if(open)html+='<div class="mrt-detail">'+scan.facts.map(x=>'<div>· '+x+'</div>').join('')+'<div class="mrt-note">这份观察来自你在风险盘的共同风险经历；它只陈述今日委托的客观分布，承接与否由你决定。</div></div>';
        el.innerHTML=html;
      }
`;
edit('index.html', 'risk scan + tool update methods',
  `clearMarketTimers(){if(this.market?.timers)this.market.timers.forEach(id=>clearTimeout(id));if(this.market)this.market.timers=[]}`,
  `clearMarketTimers(){if(this.market?.timers)this.market.timers.forEach(id=>clearTimeout(id));if(this.market)this.market.timers=[]}` + NL + SCAN_METHODS.replace(/\r?\n/g, NL),
  'marketRiskScan(){');
edit('index.html', 'call updateMarketRiskTool in renderMarket',
  `this.updateMarketBid(Number(slider.value));`,
  `this.updateMarketBid(Number(slider.value));` + NL + `      this.updateMarketRiskTool();`,
  'this.updateMarketRiskTool();');
edit('index.html', 'risk-tool action branch',
  `if(action==='mute'){marketMuted=!marketMuted;`,
  `if(action==='risk-tool'){const mt=this.market;if(!mt)return;mt.riskToolOpen=!mt.riskToolOpen;if(mt.riskToolOpen)mt.riskToolViewed=true;this.renderMarket();return}if(action==='mute'){marketMuted=!marketMuted;`,
  `if(action==='risk-tool'){`);
edit('index.html', 'cafe migration record at settlement point',
  `m.records.push({commission:c,winner,accident,revenue,payout,profit});`,
  `m.records.push({commission:c,winner,accident,revenue,payout,profit});if(m.riskToolViewed){const scan=this.marketRiskScan();if(scan.hasAny){const fl=window.FleetLearning;if(fl&&fl.recordCafeMigration)fl.recordCafeMigration({runId:m.runId,aggregations:scan.aggregations,decision:c.playerBid===null?'pass':'bid'})}}`,
  `recordCafeMigration({runId:m.runId`);
edit('index.html', 'bump shipyard-runtime version',
  `shipyard-runtime.js?v=20260903-2`,
  `shipyard-runtime.js?v=20260903-3`,
  `shipyard-runtime.js?v=20260903-3`);
edit('index.html', 'bump shipyard-ui version',
  `shipyard-ui.js?v=20260903-3`,
  `shipyard-ui.js?v=20260903-4`,
  `shipyard-ui.js?v=20260903-4`);
edit('index.html', 'bump fleet-learning version',
  `fleet-learning.js?v=20260903-1`,
  `fleet-learning.js?v=20260903-2`,
  `fleet-learning.js?v=20260903-2`);
edit('index.html', 'add harbor-notes script',
  `./fleet-ui.js?v=20260903-3"></script>`,
  `./fleet-ui.js?v=20260903-3"></script><script src="./harbor-notes.js?v=20260903-1"></script>`,
  `harbor-notes.js?v=20260903-1`);

console.log('\napplied=' + applied + ' skipped=' + skipped);
