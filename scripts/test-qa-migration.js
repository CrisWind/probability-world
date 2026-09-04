/* Smoke tests for QA sampling-representativeness loop + QA->fleet migration (Node only, no DOM).
 * Order: configs -> model -> sampling-learning -> adapter -> runtime, with fake __gameStore. */
'use strict';
const path = require('path');
const DIR = path.join(__dirname, '..');
function load(rel) { require(path.join(DIR, rel)); }

const state = { world: { fleet: { version: 1, activeCampaign: null, archivedCampaigns: [] } } };
const parts = p => String(p).split('.');
function get(p) { let v = state; for (const k of parts(p)) { if (v == null) return undefined; v = v[k]; } return v; }
function set(p, value) {
  const ps = parts(p);
  let o = state;
  ps.slice(0, -1).forEach(k => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  o[ps[ps.length - 1]] = value;
  return state;
}
global.__gameStore = { get, set, save() {}, scheduleSave() {} };

load('shipyard-config.js');
load('shipyard-model.js');
load('fleet-config.js');
load('fleet-model.js');
load('fleet-learning.js');
load('sampling-learning.js');
load('fleet-input-adapter.js');
load('fleet-runtime.js');

const CFG = global.FLEET_CONFIG;
const A = global.FleetInputAdapter;
const M = global.FleetModel;
const SL = global.SamplingLearning;
const R = global.FleetRuntime;
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } }

const DAWN = 'vessel.dawn';
function report(id, at, decision, repairLevel, sampledN, foundN, allN, remainingN) {
  const sampledParts = [];
  for (let i = 1; i <= sampledN; i++) sampledParts.push('hull-' + i);
  const defectsFound = [];
  for (let i = 1; i <= foundN; i++) defectsFound.push('hull-' + i);
  const allDefectIds = [];
  for (let i = 1; i <= allN; i++) allDefectIds.push('hull-' + i);
  const remainingDefects = [];
  for (let i = 1; i <= remainingN; i++) remainingDefects.push('hull-' + i);
  return {
    reportId: id, shipId: 'dawn-01', shipName: '曙光号', decision, repairLevel,
    sampledParts, defectsFound, completedAt: at,
    actualOutcome: {
      sailed: decision !== 'hold', accident: foundN < allN && remainingN > 0,
      allDefectIds, remainingDefects,
      missedDefects: remainingN > 0 ? allDefectIds.slice(0, remainingN) : []
    }
  };
}

/* 1. adapter: per-decision effect derivation */
{
  const ships = [{ name: '曙光号', shipId: DAWN }];
  const e1 = A.deriveShipyardEffects(ships, [report('r-release', '2026-09-01T08:00:00Z', 'release', 'none', 6, 2, 5, 3)]);
  ok('release w/ remaining => qaMod 1.54, no hold', e1.length === 1 && e1[0].qaMod === 1.54 && e1[0].holdRound1 === false && e1[0].shipId === DAWN);
  const e2 = A.deriveShipyardEffects(ships, [report('r-partial', '2026-09-01T08:00:00Z', 'repair_partial', 'partial', 6, 3, 5, 2)]);
  ok('partial w/ remaining => qaMod 1.24', e2.length === 1 && e2[0].qaMod === 1.24);
  const e3 = A.deriveShipyardEffects(ships, [report('r-partial-clean', '2026-09-01T08:00:00Z', 'repair_partial', 'partial', 8, 5, 5, 0)]);
  ok('partial clean => qaMod 0.8', e3.length === 1 && e3[0].qaMod === 0.8);
  const e4 = A.deriveShipyardEffects(ships, [report('r-full', '2026-09-01T08:00:00Z', 'repair_full', 'full', 6, 5, 5, 0)]);
  ok('full repair => qaMod 0.6', e4.length === 1 && e4[0].qaMod === 0.6);
  const e5 = A.deriveShipyardEffects(ships, [report('r-hold', '2026-09-01T08:00:00Z', 'hold', 'hold', 0, 0, 5, 5)]);
  ok('hold => holdRound1 + qaMod 1.9', e5.length === 1 && e5[0].holdRound1 === true && e5[0].qaMod === 1.9 && e5[0].repairLevel === 'hold');
  const e6 = A.deriveShipyardEffects(ships, [report('r-release-clean', '2026-09-01T08:00:00Z', 'release', 'none', 10, 0, 5, 5)]);
  ok('release clean-sample w/ hidden defects => qaMod 1.9 (never absolute-safe)', e6.length === 1 && e6[0].qaMod === 1.9);
  const e7 = A.deriveShipyardEffects([{ name: '别的船', shipId: 'other' }], [report('r-x', '2026-09-01T08:00:00Z', 'release', 'none', 1, 0, 5, 5)]);
  ok('unmatched ship report ignored', e7.length === 0);
}
/* 1b. latest completed report wins per vessel */
{
  const older = report('r-old', '2026-09-01T08:00:00Z', 'release', 'none', 6, 2, 5, 3);
  const newer = report('r-new', '2026-09-02T08:00:00Z', 'repair_partial', 'partial', 8, 4, 5, 1);
  const es = A.deriveShipyardEffects(CFG.vessels, [older, newer]);
  ok('latest report wins', es.length === 1 && es[0].sourceReportId === 'r-new' && es[0].repairLevel === 'partial' && es[0].qaMod === 1.12);
}

/* 2. model: optional qaMod channel is inert unless provided */
{
  const seed = 'qa-model-channel-test';
  const state2 = M.deriveCommonRiskState(seed, ['batch.rope_a', 'batch.rope_b', 'batch.rope_c']);
  const assignments = {};
  CFG.vessels.forEach(v => { assignments[v.shipId] = v.defaultRouteId; });
  const funds = { operatingCash: 500, reserve: 0 };
  const r0 = M.resolveRound(assignments, state2, seed, 2, funds);
  const r1 = M.resolveRound(assignments, state2, seed, 2, funds, null);
  const r2 = M.resolveRound(assignments, state2, seed, 2, funds, {});
  const same = (a, b) => a.voyageIncome === b.voyageIncome && a.cargoLoss === b.cargoLoss
    && a.vesselResults.every((x, i) => x.accidentProbability === b.vesselResults[i].accidentProbability && x.accident === b.vesselResults[i].accident);
  ok('resolveRound identical w/o qaMods vs null vs {}', same(r0, r1) && same(r0, r2) && r1.vesselResults.every(x => x.modifiers.qa === null));
  const dawnBase = r0.vesselResults.find(x => x.shipId === DAWN);
  const r3 = M.resolveRound(assignments, state2, seed, 2, funds, { [DAWN]: 1.54 });
  const dawnQa = r3.vesselResults.find(x => x.shipId === DAWN);
  const expectP = Math.min(Math.round(dawnBase.accidentProbability * 1.54 * 10000) / 10000, 0.95);
  ok('qaMod scales dawn probability (min cap 0.95)', Math.abs(dawnQa.accidentProbability - expectP) <= 0.0002 && dawnQa.accidentProbability >= dawnBase.accidentProbability);
  ok('modifiers.qa recorded on dawn only', dawnQa.modifiers.qa === 1.54 && r3.vesselResults.filter(x => x.shipId !== DAWN).every(x => x.modifiers.qa === null));
  const e0 = M.expectedRound(assignments, state2, seed, 2);
  const e3 = M.expectedRound(assignments, state2, seed, 2, { [DAWN]: 1.54 });
  ok('expectedRound reflects qaMod (higher expected cargo loss)', e3.expectedCargoLoss >= e0.expectedCargoLoss);
}

/* 3. sampling-learning: G1 亲历门槛（仅完成质检不记录）、去重、merge、G2 应用门槛 */
{
  set('world.learning', { version: 1, concepts: { correlated_risk: { conceptId: 'correlated_risk', encounteredAt: 'kept', encounterRefs: [], focusedOn: [], appliedAt: [] } } });
  const clean = report('r-clean', '2026-09-03T08:00:00Z', 'repair_full', 'full', 8, 5, 5, 0);
  ok('clean full-coverage QA 不构成亲历（missed=0）', SL.recordInspectionEncounter(clean) === null && SL.getConcept() === null);
  const rep = report('r-enc', '2026-09-03T08:00:00Z', 'repair_partial', 'partial', 6, 3, 5, 2);
  const first = SL.recordInspectionEncounter(rep);
  const again = SL.recordInspectionEncounter(rep);
  const concept = SL.getConcept();
  ok('encounter dedupes by reportId', first === again && concept.encounters.length === 1);
  ok('encounter shape (sampled/uninspected/missed/decision)', concept.encounters[0].reportId === 'r-enc'
    && concept.encounters[0].uninspectedParts.length === 18
    && concept.encounters[0].sampledParts.length === 6
    && concept.encounters[0].actualDefects.length === 5
    && concept.encounters[0].outcome.missedDefects.length === 2
    && concept.encounters[0].decision === 'repair_partial');
  const l = get('world.learning');
  ok('correlated_risk concept preserved (merge)', l.concepts.correlated_risk && l.concepts.correlated_risk.encounteredAt === 'kept' && !!l.concepts.sampling_representativeness);
  const forbidden = ['mastered', 'correct', 'wrong', 'score', 'learningLevel', 'examResult', 'level']
    .some(k => Object.keys(concept).includes(k) || JSON.stringify(concept).includes('"' + k + '"'));
  ok('no mastered/correct/wrong/score/learningLevel/examResult anywhere', forbidden === false);
  /* G2: 无同报告亲历的应用被拒绝；有亲历后才记录 */
  const campD = { campaignId: 'dedupe-1', currentRound: 7 };
  const ch = [{ change: 'ship-set-sailing', shipId: DAWN, fromRoute: null, toRoute: 'route.north' }];
  ok('application w/o prior encounter rejected', SL.recordFleetApplication(campD, ch, 'r-clean') === null);
  const a1 = SL.recordFleetApplication(campD, ch, 'r-enc');
  const a2 = SL.recordFleetApplication(campD, ch, 'r-enc');
  ok('application dedupes per campaign+round+source', a1 === a2 && SL.getConcept().applications.length === 1);
  ok('empty changes rejected', SL.recordFleetApplication({ campaignId: 'x', currentRound: 1 }, [], 'r-enc') === null);
}

/* 4. runtime: hold report freezes into campaign; round-1 forced port; round-2 reassignment + evidence */
{
  set('world.fleet', { version: 1, activeCampaign: null, archivedCampaigns: [] });
  set('world.shipyard.reports', [report('r-hold', '2026-09-03T08:00:00Z', 'hold', 'hold', 0, 0, 5, 5)]);
  set('world.learning', { version: 1, concepts: {
    correlated_risk: { conceptId: 'correlated_risk', encounteredAt: 'kept2', encounterRefs: [], focusedOn: [], appliedAt: [] },
    sampling_representativeness: { conceptId: 'sampling_representativeness', encounters: [{ reportId: 'r-hold', shipId: 'dawn-01' }], applications: [] }
  } });
  const started = R.startCampaign();
  ok('campaign started', started.ok === true);
  const camp = started.campaign;
  ok('shipyardEffects frozen on campaign', Array.isArray(camp.shipyardEffects) && camp.shipyardEffects.length === 1 && camp.shipyardEffects[0].sourceReportId === 'r-hold');
  ok('hold ship auto-kept in port round 1', camp.assignments[DAWN] === null);
  const blocked = R.setAssignment(DAWN, 'route.north');
  ok('round-1 sailing rejected qa-hold-round-1', blocked.ok === false && blocked.reason === 'qa-hold-round-1');
  const port = R.setAssignment(DAWN, null);
  ok('round-1 explicit port allowed', port.ok === true);
  const ns1 = get('world.fleet');
  ns1.activeCampaign.operatingCash = 99999;
  ns1.activeCampaign.reserve = 0;
  set('world.fleet', ns1);
  const s1 = R.submitPlan();
  ok('round-1 submit ok (hold respected)', s1.ok === true && s1.phase === 'planning' && s1.round === 1);
  const dawnRow1 = s1.result.vesselResults.find(x => x.shipId === DAWN);
  ok('held ship did not sail round 1', dawnRow1.sailing === false && dawnRow1.voyageIncome === 0 && dawnRow1.playerBorneLoss === 0);
  const r2a = R.setAssignment(DAWN, 'route.north');
  ok('round-2 assignment allowed again', r2a.ok === true);
  const r2b = R.setReserve(30);
  ok('reserve raised to 30', r2b.ok === true && r2b.reserve === 30);
  const s2 = R.submitPlan();
  ok('round-2 submit ok', s2.ok === true && s2.round === 2);
  const learn = get('world.learning');
  const c = learn.concepts.sampling_representativeness;
  const app = c.applications.find(x => x.campaignId === camp.campaignId && x.round === 2);
  ok('round-2 application evidence recorded', !!app && app.sourceReportId === 'r-hold');
  ok('evidence includes ship-set-sailing + reserve change', !!app && app.changes.some(x => x.change === 'ship-set-sailing' && x.shipId === DAWN) && app.changes.some(x => x.change === 'reserve-increased'));
  ok('correlated_risk still intact after runtime flow', !!learn.concepts.correlated_risk && learn.concepts.correlated_risk.encounteredAt === 'kept2');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
