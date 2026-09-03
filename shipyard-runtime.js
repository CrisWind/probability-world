/* 概率世界 · 造船厂质检房 V0.1 —— 质检运行时（状态机 + 存档 + 事件）
 * 职责边界：
 *  - 唯一的质检状态持有者（读写 store.world.shipyard，不新建 localStorage 入口）；
 *  - 唯一的完成函数 submitDecision()：写报告、清 activeInspection、发事件；
 *  - 不解锁成就、不完成任务、不发奖励、不碰承保/风闻结果（后续由各自 Runtime 订阅事件接入）；
 *  - 运行时动画/弹窗/骰子过程不落盘；riskScore 概念不存在于本模块。
 * UI（shipyard-ui.js）只调用这里的方法并渲染返回值，不直接改多个系统状态。 */
(function attachShipyardRuntime(global) {
  'use strict';

  const store = () => global.__gameStore;
  const bus = () => global.GameEventBus;
  /* 货币单一来源：GameStore.state.player.coins（与 HarborLife 同步）。
   * 早先读 window.HarborLife，但 HarborLife 是 index.html IIFE 内的 const，不在 window 上，
   * 导致 charge() 永远 insufficient-funds。改读 __gameStore 与 HUD 同源。 */
  const config = () => global.SHIPYARD_CONFIG;
  const model = () => global.ShipyardModel;

  const NAMESPACE_DEFAULT = () => ({ version: 1, reports: [], activeInspection: null });

  /* 只通过 GameStore 默认值/现有 merge 迁移补齐命名空间；这里兜底防旧档缺失。 */
  function readNamespace() {
    const gs = store();
    const ns = gs?.get?.('world.shipyard');
    if (ns && typeof ns === 'object') {
      return {
        version: Number(ns.version) || 1,
        reports: normalizeReports(Array.isArray(ns.reports) ? ns.reports : []),
        activeInspection: ns.activeInspection && typeof ns.activeInspection === 'object' ? ns.activeInspection : null
      };
    }
    return NAMESPACE_DEFAULT();
  }
  /* 旧存档的报告可能没有 route/materialBatch 快照：读取时按稳定 shipId 补齐，
   * 不改动已存在的值，也不为了补齐而回写存档。 */
  function normalizeReports(reports) {
    const ship = config().testShip;
    return reports.map(function (r) {
      if (!r || r.shipId !== ship.shipId) return r;
      if (r.route && r.materialBatch) return r;
      return Object.assign({}, r, {
        route: r.route || ship.route,
        materialBatch: r.materialBatch || ship.publicInfo.materialBatch
      });
    });
  }

  function writeNamespace(ns) {
    store()?.set?.('world.shipyard', ns);
    /* 质检状态是硬事实（中途刷新要恢复）：立即落盘，不走 250ms 防抖。 */
    store()?.save?.();
  }

  function emit(type, payload) {
    bus()?.emit?.({ type, payload });
  }

  /* 货币走 GameStore.state.player.coins（与 HUD/背包/咖啡馆同源；HarborLife.load() 也从这里读）。
   * getState() 返回 clone——必须用 set('player.coins', n) 走回写通道。测试中可通过 __gameStore.state 注入桩。 */
  function coins() {
    return Number(store()?.get?.('player.coins')) || 0;
  }
  function charge(amount) {
    if (amount <= 0) return true;
    const gs = store();
    if (!gs) return false;
    const cur = Number(gs.get?.('player.coins')) || 0;
    if (cur < amount) return false;
    gs.set?.('player.coins', cur - amount);
    gs.save?.();
    return true;
  }

  function newSeed() {
    return 'insp-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xffffff).toString(36);
  }

  /* 开始一次质检。已有进行中的质检时直接返回它（刷新恢复入口）。 */
  function start() {
    const ns = readNamespace();
    if (ns.activeInspection) return { ok: true, inspection: ns.activeInspection, resumed: true };
    const ship = config().testShip;
    const inspection = {
      reportId: 'rep-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xffff).toString(36),
      shipId: ship.shipId,
      shipName: ship.shipName,
      seed: newSeed(),
      phase: 'sampling',
      rounds: [],                 // [{method, size, sampledParts, defectsFound, cost, delay}]
      sampledParts: [],
      defectsFound: [],
      inspectionCost: 0,
      samplingDelay: 0,
      createdAt: new Date().toISOString()
    };
    ns.activeInspection = inspection;
    writeNamespace(ns);
    emit('inspection_started', { reportId: inspection.reportId, shipId: ship.shipId, shipName: ship.shipName });
    return { ok: true, inspection, resumed: false };
  }

  /* 放弃当前质检（不留报告）。仅供 UI 显式"搁置"使用。 */
  function abandon() {
    const ns = readNamespace();
    if (!ns.activeInspection) return { ok: false, reason: 'no-active-inspection' };
    ns.activeInspection = null;
    writeNamespace(ns);
    return { ok: true };
  }

  /* 执行一次抽样。可多次调用（追加抽样），成本与样本累计。 */
  function sample(method, size) {
    const ns = readNamespace();
    const insp = ns.activeInspection;
    if (!insp) return { ok: false, reason: 'no-active-inspection' };
    const sizeCfg = config().sampleSizes[size];
    const methodCfg = config().samplingMethods[method];
    if (!sizeCfg || !methodCfg) return { ok: false, reason: 'invalid-options' };
    if (!charge(sizeCfg.cost)) return { ok: false, reason: 'insufficient-funds', cost: sizeCfg.cost };

    const batch = model().createBatch(insp.seed);
    const picked = model().sampleParts(batch, method, size, insp.seed, insp.sampledParts);
    const found = picked.filter(p => p.defect).map(p => p.id);
    insp.rounds.push({
      method, size,
      sampledParts: picked.map(p => p.id),
      defectsFound: found,
      cost: sizeCfg.cost,
      delay: sizeCfg.delay
    });
    insp.sampledParts = insp.sampledParts.concat(picked.map(p => p.id));
    insp.defectsFound = [...new Set(insp.defectsFound.concat(found))];
    insp.inspectionCost += sizeCfg.cost;
    insp.samplingDelay += sizeCfg.delay;
    ns.activeInspection = insp;
    writeNamespace(ns);
    emit('inspection_sampled', {
      reportId: insp.reportId, shipId: insp.shipId,
      samplingMethod: method, sampleSize: size,
      roundSampled: picked.length, roundDefects: found.length,
      totalSampled: insp.sampledParts.length, totalDefectsFound: insp.defectsFound.length,
      cost: sizeCfg.cost
    });
    return { ok: true, inspection: insp, round: insp.rounds[insp.rounds.length - 1], batch };
  }

  /* 逐部位抽样：检查一个指定部位，消耗 perPartCost 和 perPartDelay。 */
  function sampleSinglePart(method, partId) {
    const ns = readNamespace();
    const insp = ns.activeInspection;
    if (!insp) return { ok: false, reason: 'no-active-inspection' };
    const cfg = config();
    const cost = cfg.perPartCost || 1;
    const delay = cfg.perPartDelay || 0;
    if (!charge(cost)) return { ok: false, reason: 'insufficient-funds', cost: cost };

    const batch = model().createBatch(insp.seed);
    const part = batch.find(function(p) { return p.id === partId; });
    if (!part) return { ok: false, reason: 'invalid-part' };
    if (insp.sampledParts.indexOf(partId) !== -1) return { ok: false, reason: 'already-sampled' };

    const methodCfg = cfg.samplingMethods[method];
    if (methodCfg && methodCfg.zones && methodCfg.zones.indexOf(part.zone) === -1) {
      return { ok: false, reason: 'zone-not-allowed' };
    }

    const found = part.defect ? [partId] : [];
    insp.rounds.push({
      method: method, size: 'single',
      sampledParts: [partId],
      defectsFound: found,
      cost: cost, delay: delay
    });
    insp.sampledParts.push(partId);
    insp.defectsFound = insp.defectsFound.concat(found);
    insp.inspectionCost += cost;
    insp.samplingDelay += delay;
    ns.activeInspection = insp;
    writeNamespace(ns);
    emit('inspection_sampled', {
      reportId: insp.reportId, shipId: insp.shipId,
      samplingMethod: method, sampleSize: 'single',
      roundSampled: 1, roundDefects: found.length,
      totalSampled: insp.sampledParts.length, totalDefectsFound: insp.defectsFound.length,
      cost: cost
    });
    return { ok: true, inspection: insp, part: part, round: insp.rounds[insp.rounds.length - 1], batch: batch };
  }

  /* 唯一完成函数：提交最终决策 → 结算 → 写报告 → 清 active → 发事件。
   * decision ∈ release / repair_partial / repair_full / hold（sample_more 不是最终决策，由 UI 回退到抽样）。 */
  function submitDecision(decision) {
    const ns = readNamespace();
    const insp = ns.activeInspection;
    if (!insp) return { ok: false, reason: 'no-active-inspection' };
    const decCfg = config().decisions[decision];
    if (!decCfg || decCfg.repairLevel === null) return { ok: false, reason: 'invalid-decision' };
    if (!charge(decCfg.cost)) return { ok: false, reason: 'insufficient-funds', cost: decCfg.cost };

    emit('inspection_decision_submitted', {
      reportId: insp.reportId, shipId: insp.shipId, shipName: insp.shipName,
      decision, repairLevel: decCfg.repairLevel
    });

    const batch = model().createBatch(insp.seed);
    const estimate = model().estimateReliability(batch, insp.sampledParts);
    const outcome = model().resolveOutcome(batch, insp.sampledParts, insp.defectsFound, decision, insp.seed);
    const lastRound = insp.rounds[insp.rounds.length - 1] || null;
    const report = {
      reportId: insp.reportId,
      shipId: insp.shipId,
      shipName: insp.shipName,
      route: config().testShip.route,
      materialBatch: config().testShip.publicInfo.materialBatch,
      seed: insp.seed, // 复盘可用 createBatch(seed) 重建真实批次，报告中不另存缺陷清单副本
      samplingMethod: lastRound ? lastRound.method : null,
      sampleSize: lastRound ? lastRound.size : null,
      rounds: insp.rounds,
      sampledParts: insp.sampledParts,
      defectsFound: insp.defectsFound,
      decision,
      repairLevel: decCfg.repairLevel,
      departureDelay: insp.samplingDelay + decCfg.delay,
      inspectionCost: insp.inspectionCost,
      repairCost: decCfg.cost,
      estimatedReliability: estimate,
      actualOutcome: outcome,
      createdAt: insp.createdAt,
      completedAt: new Date().toISOString()
    };
    ns.reports.push(report);
    ns.activeInspection = null;
    writeNamespace(ns);
    store()?.save?.(); // 报告是硬事实：立即落盘，不等 scheduleSave
    emit('inspection_completed', {
      reportId: report.reportId,
      shipId: report.shipId,
      shipName: report.shipName,
      samplingMethod: report.samplingMethod,
      sampleSize: report.sampleSize,
      defectsFound: report.defectsFound.length,
      decision: report.decision,
      repairLevel: report.repairLevel,
      departureDelay: report.departureDelay,
      actualOutcome: { sailed: outcome.sailed, accident: outcome.accident }
    });
    return { ok: true, report, batch };
  }

  function getActive() { return readNamespace().activeInspection; }
  function listReports() { return readNamespace().reports; }
  function getReport(reportId) { return readNamespace().reports.find(r => r.reportId === reportId) || null; }

  global.ShipyardRuntime = Object.freeze({
    start, abandon, sample, sampleSinglePart, submitDecision,
    getActive, listReports, getReport,
    /* 暴露给 UI 做按钮禁用判断，不暴露修改入口 */
    coins
  });
})(typeof window !== 'undefined' ? window : globalThis);
