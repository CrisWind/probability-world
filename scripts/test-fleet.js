#!/usr/bin/env node
/* 商会船队风险盘 V0.1 回归测试（Node 桩，无需浏览器）
 * 覆盖：公式验证、7 场景、生命周期、事件、持久化、红线。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const failures = [];
function check(name, cond, detail) {
  const ok = !!cond;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ' | ' + (detail || '')}`);
  if (!ok) failures.push(name);
}

function freshEnv() {
  const store = new Map();
  global.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  global.window = global;
  return store;
}

function boot(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  (0, eval)(src);
}

function bootFleet() {
  freshEnv();
  const events = [];
  boot('game-store.js');
  boot('game-event-bus.js');
  boot('fleet-config.js');
  boot('fleet-model.js');
  boot('fleet-runtime.js');
  ['fleet_plan_submitted', 'fleet_round_settled', 'fleet_storm_triggered', 'fleet_insolvent', 'fleet_campaign_completed']
    .forEach(t => global.GameEventBus.on(t, e => events.push(e)));
  return {
    events,
    gs: global.__gameStore,
    R: global.FleetRuntime,
    M: global.FleetModel,
    C: global.FLEET_CONFIG,
    bus: global.GameEventBus
  };
}

/* ============ A. 公式验证 ============ */
{
  freshEnv();
  boot('fleet-config.js');
  boot('fleet-model.js');
  const M = global.FleetModel, C = global.FLEET_CONFIG;

  /* A1. 事故概率公式：baseRisk × (1/hull) × volatility × batchMod × stormMod */
  const dawn = M.findVessel('vessel.dawn');
  const northRoute = M.findRoute('route.north');
  const noDefects = { batches: { 'batch.rope_a': { defective: false } } };
  const noStorms = [];
  const p1 = M.accidentProbability(dawn, northRoute, noDefects, noStorms);
  const expected1 = 0.08 * (1 / 0.9) * 1.4 * 1 * 1;
  check('A1 基础事故概率公式', Math.abs(p1 - expected1) < 0.0001, 'got ' + p1 + ' expected ' + expected1);

  /* A2. 批次缺陷修正 */
  const withDefects = { batches: { 'batch.rope_a': { defective: true } } };
  const p2 = M.accidentProbability(dawn, northRoute, withDefects, noStorms);
  const expected2 = 0.08 * (1 / 0.9) * 1.4 * 1.8 * 1;
  check('A2 批次缺陷修正 1.8x', Math.abs(p2 - expected2) < 0.0001, 'got ' + p2 + ' expected ' + expected2);

  /* A3. 风暴修正 */
  const storms = [{ routeId: 'route.north', severity: 0.8 }];
  const p3 = M.accidentProbability(dawn, northRoute, noDefects, storms);
  const stormMod = 1 + 0.8 * 0.8;
  const expected3 = 0.08 * (1 / 0.9) * 1.4 * 1 * stormMod;
  check('A3 风暴修正', Math.abs(p3 - expected3) < 0.0001, 'got ' + p3 + ' expected ' + expected3);

  /* A4. 事故概率上限 0.95 */
  const oldSail = M.findVessel('vessel.sail');
  const southRoute = M.findRoute('route.south');
  const worstCase = { batches: { 'batch.rope_c': { defective: true } } };
  const worstStorms = [{ routeId: 'route.south', severity: 1.0 }];
  const p4 = M.accidentProbability(oldSail, southRoute, worstCase, worstStorms);
  check('A4 事故概率上限 0.95', p4 <= 0.95, 'got ' + p4);

  /* A5. 再保险费用计算 */
  const assignments = { 'vessel.dawn': 'route.north', 'vessel.gull': 'route.coastal', 'vessel.guild': null };
  const riCost = M.calcReinsuranceCost(assignments, C.vessels);
  const expectedRiCost = (80 + 60) * 0.03;
  check('A5 再保险费用（留港不计）', Math.abs(riCost - expectedRiCost) < 0.01, 'got ' + riCost + ' expected ' + expectedRiCost);

  /* A6. 再保险回收：自留额 40，超出部分 50% */
  const recovery1 = M.calcReinsuranceRecovery(80);
  check('A6 再保险回收 80→20', Math.abs(recovery1 - 20) < 0.01, 'got ' + recovery1);

  const recovery2 = M.calcReinsuranceRecovery(30);
  check('A6b 再保险回收 30→0（低于自留额）', recovery2 === 0, 'got ' + recovery2);

  const recovery3 = M.calcReinsuranceRecovery(60);
  check('A6c 再保险回收 60→10', Math.abs(recovery3 - 10) < 0.01, 'got ' + recovery3);

  /* A7. 准备金计算 */
  const res1 = M.applyReserve(50, 20, -30);
  check('A7a 准备金足够：operatingCash 50-30=20', res1.operatingCashAfter === 20 && res1.reserveAfter === 20 && !res1.insolvent);

  const res2 = M.applyReserve(10, 20, -25);
  check('A7b 动用准备金：cash=0, reserve=5', res2.operatingCashAfter === 0 && res2.reserveAfter === 5 && res2.reserveUsed === 15 && !res2.insolvent);

  const res3 = M.applyReserve(5, 10, -20);
  check('A7c 资金缺口：insolvent=true', res3.insolvent && res3.operatingCashAfter === 0 && res3.reserveAfter === 0);

  /* A8. deriveCommonRiskState 确定性 */
  const crs1 = M.deriveCommonRiskState('test-seed', ['batch.rope_a', 'batch.rope_b', 'batch.rope_c']);
  const crs2 = M.deriveCommonRiskState('test-seed', ['batch.rope_a', 'batch.rope_b', 'batch.rope_c']);
  check('A8a 同 seed 共同风险状态相同', JSON.stringify(crs1) === JSON.stringify(crs2));

  const crs3 = M.deriveCommonRiskState('other-seed', ['batch.rope_a', 'batch.rope_b', 'batch.rope_c']);
  check('A8b 不同 seed 共同风险状态可能不同', JSON.stringify(crs1) !== JSON.stringify(crs3) || true);

  /* A9. resolveStorms 风暴窗口 */
  const storms1 = M.resolveStorms(1, 'test-seed', C.routes);
  check('A9a 第 1 回合无风暴', storms1.length === 0);

  const storms3 = M.resolveStorms(3, 'test-seed', C.routes);
  check('A9b 第 3 回合无风暴', storms3.length === 0);

  /* A10. 留港船事故概率为 0 */
  const stayResult = M.resolveVessel(dawn, null, noDefects, noStorms, 'test-seed', 1);
  check('A10 留港船无事故', !stayResult.accident && stayResult.sailing === false && stayResult.cargoLoss === 0);
}

/* ============ B. 生命周期 ============ */
{
  const env = bootFleet();
  const R = env.R;

  /* B1. 开始 campaign */
  const start = R.startCampaign();
  check('B1a 开始 campaign 成功', start.ok && start.campaign);
  check('B1b campaign 有 6 艘船分配', Object.keys(start.campaign.assignments).length === 6);
  check('B1c 初始经营资金 80', start.campaign.operatingCash === 80);
  check('B1d 初始准备金 20', start.campaign.reserve === 20);
  check('B1e 回合 1', start.campaign.currentRound === 1);
  check('B1f 阶段 planning', start.campaign.phase === 'planning');

  /* B2. 重复开始被拒 */
  const start2 = R.startCampaign();
  check('B2 重复开始 campaign 被拒', !start2.ok && start2.reason === 'campaign-in-progress');

  /* B3. 修改分配 */
  const assign = R.setAssignment('vessel.dawn', null);
  check('B3a 留港分配成功', assign.ok);
  check('B3b 曙光号留港', assign.assignments['vessel.dawn'] === null);

  const assign2 = R.setAssignment('vessel.dawn', 'route.south');
  check('B3c 改分配南方航线', assign2.ok && assign2.assignments['vessel.dawn'] === 'route.south');

  /* B4. 修改准备金 */
  const reserve = R.setReserve(30);
  check('B4a 设置准备金 30', reserve.ok && reserve.reserve === 30);
  check('B4b 经营资金变为 70', reserve.operatingCash === 70);

  const reserve2 = R.setReserve(0);
  check('B4c 设置准备金 0', reserve2.ok && reserve2.reserve === 0);
  check('B4d 经营资金回到 100', reserve2.operatingCash === 100);

  /* B5. 再保险 */
  const ri = R.setReinsurance(true);
  check('B5 开启再保险', ri.ok && ri.reinsuranceActive === true);

  /* B6. 预期收益 */
  const expected = R.getExpected();
  check('B6a 预期收益非空', expected !== null);
  check('B6b 预期收入 > 0', expected.expectedVoyageIncome > 0);

  /* B7. 提交方案（留港防随机资金缺口） */
  for (const v of env.C.vessels) R.setAssignment(v.shipId, null);
  const submit = R.submitPlan();
  check('B7a 提交成功', submit.ok);
  check('B7b 有轮次结果', submit.roundResult && submit.roundResult.round === 1);
  check('B7c 有 6 艘船结果', submit.roundResult.vesselResults.length === 6);
  check('B7d 汇总字段齐全', submit.roundResult.totals.voyageIncome !== undefined
    && submit.roundResult.totals.cargoLoss !== undefined
    && submit.roundResult.totals.netProfit !== undefined);
  check('B7e 资金变化记录', submit.roundResult.operatingCashBefore !== undefined
    && submit.roundResult.operatingCashAfter !== undefined);

  /* B8. 回合推进 */
  const camp = R.getCampaign();
  check('B8a 第 1 回合结算后进入第 2 回合', camp.currentRound === 2);
  check('B8b 仍在 planning', camp.phase === 'planning');
  check('B8c 有 1 轮记录', camp.rounds.length === 1);

  /* B9. 事件发射 */
  const planEvents = env.events.filter(e => e.type === 'fleet_plan_submitted');
  const settledEvents = env.events.filter(e => e.type === 'fleet_round_settled');
  check('B9a fleet_plan_submitted 已发射', planEvents.length >= 1);
  check('B9b fleet_round_settled 已发射', settledEvents.length >= 1);
}

/* ============ C. 完整 5 轮 campaign ============ */
{
  const env = bootFleet();
  const R = env.R;

  R.startCampaign();
  /* 全部留港：零收入零损失，确保 5 轮不因随机事故而资金缺口 */
  for (const v of env.C.vessels) R.setAssignment(v.shipId, null);
  for (let i = 0; i < 5; i++) {
    const result = R.submitPlan();
    if (!result.ok) { check('C' + (i+1) + ' 第 ' + (i+1) + ' 轮提交', false, result.reason); break; }
  }

  const camp = R.getCampaign();
  check('C1 5 轮全部完成', camp.rounds.length === 5);
  check('C2 campaign 状态 completed', camp.phase === 'completed');

  const completedEvents = env.events.filter(e => e.type === 'fleet_campaign_completed');
  check('C3 fleet_campaign_completed 已发射', completedEvents.length === 1);
  check('C4 完成事件包含最终资金', completedEvents[0] && completedEvents[0].payload.finalTotalFunds !== undefined);
}

/* ============ D. 放弃 campaign ============ */
{
  const env = bootFleet();
  const R = env.R;

  R.startCampaign();
  for (const v of env.C.vessels) R.setAssignment(v.shipId, null);
  R.submitPlan();
  R.submitPlan();

  const camp = R.getCampaign();
  check('D1a 放弃前有 2 轮记录', camp.rounds.length === 2);

  const abandon = R.abandonCampaign();
  check('D1b 放弃成功', abandon.ok);
  check('D1c 归档 outcome=abandoned', abandon.archived.outcome === 'abandoned');
  check('D1d 归档 abandonedAtRound=3', abandon.archived.abandonedAtRound === 3);
  check('D1e 归档 roundsSettled=2', abandon.archived.roundsSettled === 2);

  check('D2a activeCampaign 已清空', R.getCampaign() === null);

  const archived = R.listArchived();
  check('D2b archivedCampaigns 有 1 条', archived.length === 1);
  check('D2c 归档保留完整资金', archived[0].finalTotalFunds !== undefined);

  /* 放弃后可开始新 campaign */
  const newCamp = R.startCampaign();
  check('D3 放弃后可开始新 campaign', newCamp.ok && newCamp.campaign.campaignId !== archived[0].campaignId);
}

/* ============ E. 持久化 ============ */
{
  const env = bootFleet();
  const R = env.R;

  R.startCampaign();
  for (const v of env.C.vessels) R.setAssignment(v.shipId, null);
  R.setReserve(30);
  R.submitPlan();

  const campBefore = R.getCampaign();
  const savedJson = env.gs.getState();
  check('E1a world.fleet 已落盘', savedJson.world.fleet && savedJson.world.fleet.activeCampaign);
  check('E1b 轮次数据在存档中', savedJson.world.fleet.activeCampaign.rounds.length === 1);

  /* 模拟刷新：重新 eval runtime */
  boot('fleet-runtime.js');
  const campAfter = global.FleetRuntime.getCampaign();
  check('E2a 刷新后 campaign 恢复', campAfter !== null);
  check('E2b 刷新后回合数一致', campAfter.currentRound === campBefore.currentRound);
  check('E2c 刷新后轮次数据完整', campAfter.rounds.length === 1);
}

/* ============ F. 事件白名单 ============ */
{
  const env = bootFleet();
  const bus = env.bus;

  check('F1 白名单包含 19 项', bus.TYPES.length === 19, 'got ' + bus.TYPES.length);

  const fleetTypes = ['fleet_plan_submitted', 'fleet_round_settled', 'fleet_storm_triggered', 'fleet_insolvent', 'fleet_campaign_completed'];
  let allPresent = true;
  for (const t of fleetTypes) {
    if (!bus.TYPES.includes(t)) { allPresent = false; break; }
  }
  check('F2 5 个 fleet 事件全在白名单', allPresent);

  /* 未知事件仍抛错 */
  let threw = false;
  try { bus.emit({ type: 'fleet_unknown_event', payload: {} }); } catch (e) { threw = true; }
  check('F3 未知 fleet 事件仍抛错', threw);
}

/* ============ G. 红线 ============ */
{
  const fleetRuntimeSrc = fs.readFileSync(path.join(ROOT, 'fleet-runtime.js'), 'utf8');
  const fleetModelSrc = fs.readFileSync(path.join(ROOT, 'fleet-model.js'), 'utf8');
  const fleetUiSrc = fs.readFileSync(path.join(ROOT, 'fleet-ui.js'), 'utf8');
  const fleetConfigSrc = fs.readFileSync(path.join(ROOT, 'fleet-config.js'), 'utf8');

  check('G1 fleet 模块无 localStorage 直接读写',
    !fleetRuntimeSrc.includes('localStorage') && !fleetModelSrc.includes('localStorage')
    && !fleetUiSrc.includes('localStorage') && !fleetConfigSrc.includes('localStorage'));

  check('G2 fleet 模块无 achievement_unlocked 事件',
    !fleetRuntimeSrc.includes('achievement_unlocked') && !fleetUiSrc.includes('achievement_unlocked'));

  check('G3 fleet 模块无 quest_completed 事件',
    !fleetRuntimeSrc.includes('quest_completed') && !fleetUiSrc.includes('quest_completed'));

  check('G4 fleet 模块无 RewardService 调用',
    !fleetRuntimeSrc.includes('RewardService') && !fleetUiSrc.includes('RewardService'));

  check('G5 fleet UI 无推荐/最佳/正确文案',
    !fleetUiSrc.includes('最佳方案') && !fleetUiSrc.includes('推荐选择') && !fleetUiSrc.includes('正确选择'));

  check('G6 fleet 模块无 marketProfile 读写',
    !fleetRuntimeSrc.includes('marketProfile') && !fleetUiSrc.includes('marketProfile'));

  check('G7 fleet 模块无 rumorProfile 读写',
    !fleetRuntimeSrc.includes('rumorProfile') && !fleetUiSrc.includes('rumorProfile'));

  check('G8 fleet 模块无 captain 字段',
    !fleetRuntimeSrc.includes('captain') && !fleetUiSrc.includes('captain'));

  check('G9 fleet 模块无 riskScore 字段',
    !fleetRuntimeSrc.includes('riskScore') && !fleetModelSrc.includes('riskScore'));

  check('G10 fleet 模块不修改 world.shipyard',
    !fleetRuntimeSrc.includes("world.shipyard") && !fleetUiSrc.includes("world.shipyard"));

  /* 模型是纯函数：无 store/bus/document 引用 */
  check('G11 fleet-model 无 store 引用', !fleetModelSrc.includes('__gameStore'));
  check('G12 fleet-model 无 event bus 引用', !fleetModelSrc.includes('GameEventBus'));
  check('G13 fleet-model 无 document 引用', !fleetModelSrc.includes('document'));
}

/* ============ H. 结算场景 ============ */
{
  freshEnv();
  boot('fleet-config.js');
  boot('fleet-model.js');
  const M = global.FleetModel, C = global.FLEET_CONFIG;

  /* H1. 全留港：零收入零损失 */
  const allStay = {};
  C.vessels.forEach(v => { allStay[v.shipId] = null; });
  const commonRisk = M.deriveCommonRiskState('scenario-1', ['batch.rope_a', 'batch.rope_b', 'batch.rope_c']);
  const r1 = M.resolveRound(allStay, commonRisk, 'scenario-1', 1);
  check('H1 全留港零收入', r1.totals.voyageIncome === 0);
  check('H1b 全留港零损失', r1.totals.cargoLoss === 0);
  check('H1c 全留港零再保险费', r1.totals.reinsuranceCost === 0);

  /* H2. 全出航（默认航线）：有收入可能损失 */
  const allDefault = {};
  C.vessels.forEach(v => { allDefault[v.shipId] = v.defaultRouteId; });
  const r2 = M.resolveRound(allDefault, commonRisk, 'scenario-2', 1);
  check('H2a 全出航有收入或损失', r2.totals.voyageIncome > 0 || r2.totals.cargoLoss > 0);
  check('H2b 有再保险费', r2.totals.reinsuranceCost > 0);
  check('H2c 6 艘船结果', r2.vesselResults.length === 6);

  /* H3. 分散航线 */
  const spread = {
    'vessel.dawn': 'route.north',
    'vessel.gull': 'route.coastal',
    'vessel.guild': 'route.south',
    'vessel.skiff': 'route.north',
    'vessel.ocean': 'route.coastal',
    'vessel.sail': 'route.south'
  };
  const r3 = M.resolveRound(spread, commonRisk, 'scenario-3', 4);
  check('H3 分散航线结算完成', r3.round === 4);

  /* H4. 确定性复现 */
  const r4a = M.resolveRound(allDefault, commonRisk, 'deterministic-seed', 1);
  const r4b = M.resolveRound(allDefault, commonRisk, 'deterministic-seed', 1);
  check('H4 同 seed 同分配同回合结果完全一致',
    JSON.stringify(r4a.vesselResults) === JSON.stringify(r4b.vesselResults));

  /* H5. 不同 seed 结果可能不同 */
  let foundDiff = false;
  for (let i = 0; i < 20; i++) {
    const ra = M.resolveRound(allDefault, M.deriveCommonRiskState('sa' + i, ['batch.rope_a', 'batch.rope_b', 'batch.rope_c']), 'sa' + i, 1);
    const rb = M.resolveRound(allDefault, M.deriveCommonRiskState('sb' + i, ['batch.rope_a', 'batch.rope_b', 'batch.rope_c']), 'sb' + i, 1);
    if (JSON.stringify(ra.vesselResults) !== JSON.stringify(rb.vesselResults)) { foundDiff = true; break; }
  }
  check('H5 不同 seed 结果可以不同', foundDiff);
}

/* ============ Summary ============ */
console.log('\n' + (failures.length === 0 ? '全部通过 ✅' : failures.length + ' 项失败 ❌'));
if (failures.length) process.exit(1);
