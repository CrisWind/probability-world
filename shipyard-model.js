/* 概率世界 · 造船厂质检房 V0.1 —— 质检模型（纯逻辑，无 DOM、无存档、无事件）
 * 所有随机都来自调用方传入的 seed：同一 seed 必定复现同一批次与同一次抽样，
 * 但缺陷位置与结果不随剧情写死。 */
(function attachShipyardModel(global) {
  'use strict';

  const CONFIG = () => global.SHIPYARD_CONFIG;

  /* --- seeded RNG（与风闻局同款 FNV-1a + mulberry 变体，互不共享状态） --- */
  function hashSeed(str) {
    let h = 2166136261;
    for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rngFrom(seed) {
    let t = hashSeed(seed);
    return function next() {
      t += 0x6D2B79F5;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weightedZone(rng, weights) {
    const entries = Object.entries(weights);
    const total = entries.reduce((n, [, w]) => n + w, 0);
    let roll = rng() * total;
    for (const [zone, w] of entries) { roll -= w; if (roll <= 0) return zone; }
    return entries[entries.length - 1][0];
  }

  /* 生成一个检查批次：totalParts 个部位， defectCount 处隐藏缺陷。
   * 缺陷区域按 zoneWeights 加权抽取（可重复区域，部位不重复），严重程度按 severityMix 分配。 */
  function createBatch(seed) {
    const cfg = CONFIG().batch;
    const rng = rngFrom('batch:' + seed);
    const parts = [];
    for (const zone of cfg.zones) {
      for (let i = 1; i <= cfg.partsPerZone; i++) {
        parts.push({ id: zone + '-' + i, zone, defect: null });
      }
    }
    const severities = [];
    for (let i = 0; i < cfg.severityMix.major; i++) severities.push('major');
    for (let i = 0; i < cfg.severityMix.minor; i++) severities.push('minor');
    const used = new Set();
    for (const severity of severities.slice(0, cfg.defectCount)) {
      let part = null;
      for (let guard = 0; guard < 200 && !part; guard++) {
        const zone = weightedZone(rng, cfg.zoneWeights);
        const idx = 1 + Math.floor(rng() * cfg.partsPerZone);
        const id = zone + '-' + idx;
        if (!used.has(id)) { used.add(id); part = parts.find(p => p.id === id); }
      }
      if (part) part.defect = severity;
    }
    return parts;
  }

  /* 抽样：从批次中按方式选 size.n 个部位（excludeIds 之外，用于追加抽样）。
   * random=全区域均匀；convenient=只碰容易够到的区域；targeted=线索区域优先、溢出后再全区域补。 */
  function sampleParts(batch, method, sizeKey, seed, excludeIds) {
    const cfg = CONFIG();
    const methodCfg = cfg.samplingMethods[method];
    const sizeCfg = cfg.sampleSizes[sizeKey];
    if (!methodCfg) throw new Error('[ShipyardModel] unknown sampling method: ' + method);
    if (!sizeCfg) throw new Error('[ShipyardModel] unknown sample size: ' + sizeKey);
    const excluded = new Set(excludeIds || []);
    const rng = rngFrom('sample:' + seed + ':' + method + ':' + sizeKey + ':' + excluded.size);
    const pool = batch.filter(p => !excluded.has(p.id));
    const shuffled = [...pool].sort(() => rng() - 0.5);
    let ordered;
    if (!methodCfg.zones) {
      ordered = shuffled;
    } else {
      const inZones = shuffled.filter(p => methodCfg.zones.includes(p.zone));
      const rest = method === 'targeted' ? shuffled.filter(p => !methodCfg.zones.includes(p.zone)) : [];
      ordered = [...inZones, ...rest]; // convenient 没有 rest：够不到的地方永远进不了样本
    }
    return ordered.slice(0, Math.min(sizeCfg.n, ordered.length));
  }

  /* 样本结论（估计量，不等于真相）：覆盖率 + 样本缺陷率。 */
  function estimateReliability(batch, sampledIds) {
    const sampled = batch.filter(p => sampledIds.includes(p.id));
    const found = sampled.filter(p => p.defect);
    return {
      coverage: sampled.length / batch.length,
      sampledCount: sampled.length,
      foundCount: found.length,
      sampleDefectRate: sampled.length ? found.length / sampled.length : 0
    };
  }

  /* 结算：给定决策，揭示真实质量。
   * repairLevel: none=原样出航；partial=只修样本发现的；full=全清；hold=不出航。
   * 返回实际遗留缺陷、事故判定（per-defect 独立 roll，seed 可复现）与事实标签。 */
  function resolveOutcome(batch, sampledIds, foundIds, decision, seed) {
    const repairLevel = CONFIG().decisions[decision].repairLevel;
    const foundSet = new Set(foundIds);
    let remaining;
    if (repairLevel === 'full' || repairLevel === 'hold') remaining = [];
    else if (repairLevel === 'partial') remaining = batch.filter(p => p.defect && !foundSet.has(p.id));
    else remaining = batch.filter(p => p.defect);

    const sailed = repairLevel !== 'hold';
    let accident = false;
    let accidentCause = null;
    if (sailed && remaining.length) {
      const risk = CONFIG().risk;
      const rng = rngFrom('voyage:' + seed + ':' + decision + ':' + foundIds.length);
      for (const part of remaining) {
        const p = part.defect === 'major' ? risk.majorAccident : risk.minorAccident;
        if (rng() < p) { accident = true; accidentCause = part.id; break; }
      }
    }

    const allDefectIds = batch.filter(p => p.defect).map(p => p.id);
    const missedDefects = allDefectIds.filter(id => !foundSet.has(id));
    return {
      sailed,
      accident,
      accidentCause,
      remainingDefects: remaining.map(p => p.id),
      allDefectIds,
      missedDefects,
      /* 事实标签（不评判对错，只记录发生了什么）：
       * wrongRelease = 放行时仍有未被样本发现的缺陷留在船上；
       * overReject   = 全面返修/暂停出航时，样本其实已经发现了全部真实缺陷。 */
      wrongRelease: sailed && repairLevel !== 'full' && missedDefects.length > 0,
      overReject: (repairLevel === 'full' || repairLevel === 'hold') && missedDefects.length === 0 && allDefectIds.length > 0
    };
  }

  global.ShipyardModel = Object.freeze({
    hashSeed, rngFrom, createBatch, sampleParts, estimateReliability, resolveOutcome
  });
})(typeof window !== 'undefined' ? window : globalThis);
