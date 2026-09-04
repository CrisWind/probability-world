/* Smoke tests for Step-1 correlated-risk learning evidence (Node only, no DOM). */
const path = require('path');
const DIR = path.join(__dirname, '..');
function load(rel) { require(path.join(DIR, rel)); }

/* fake store: deep-ish set/get, path support like __gameStore */
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

load('fleet-config.js');
load('fleet-model.js');
load('fleet-learning.js');
load('fleet-runtime.js');

const M = global.FleetModel;
const L = global.FleetLearning;
const R = global.FleetRuntime;
let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } }

function vr(shipId, name, routeId, batchId, loss) {
  return { shipId, name, routeId, batchId, cargoValue: 80, sailing: routeId !== null,
    accidentProbability: 0.2, modifiers: { storm: false, batchDefect: false }, accident: loss > 0,
    severity: loss > 0 ? 'partial' : null, cargoLoss: loss, voyageIncome: loss > 0 ? 0 : 8,
    reinsuranceRecovery: 0, playerBorneLoss: loss };
}

/* 1. analyzeRound: storm group */
const stormRound = {
  round: 4, storms: [{ routeId: 'route.north', severity: 0.8 }], batchDefects: [],
  vesselResults: [
    vr('vessel.dawn', '曙光号', 'route.north', 'batch.rope_a', 40),
    vr('vessel.skiff', '沿岸小船', 'route.north', 'batch.rope_b', 30),
    vr('vessel.gull', '白鸥号', 'route.coastal', 'batch.rope_a', 0)
  ],
  cargoLoss: 70
};
let ev = L.analyzeRound(stormRound);
ok('storm event detected (2 ships same route + loss)', ev.length === 1 && ev[0].type === 'storm' && ev[0].vesselIds.length === 2 && ev[0].sourceId === 'route.north');
ok('storm totalLoss summed', ev[0].totalLoss === 70);

/* 2. single loss / no shared source => no event */
const singleRound = {
  round: 4, storms: [{ routeId: 'route.north', severity: 0.8 }], batchDefects: [],
  vesselResults: [
    vr('vessel.dawn', '曙光号', 'route.north', 'batch.rope_a', 40),
    vr('vessel.gull', '白鸥号', 'route.coastal', 'batch.rope_a', 0)
  ], cargoLoss: 40
};
ok('no event for single loss', L.analyzeRound(singleRound).length === 0);

/* 3. batch event + coLossSummary dedupe when ship in both groups */
const bothRound = {
  round: 4,
  storms: [{ routeId: 'route.north', severity: 0.8 }],
  batchDefects: ['batch.rope_a'],
  vesselResults: [
    vr('vessel.dawn', '曙光号', 'route.north', 'batch.rope_a', 40),
    vr('vessel.gull', '白鸥号', 'route.north', 'batch.rope_a', 25),
    vr('vessel.ocean', '远洋号', 'route.coastal', 'batch.rope_c', 0)
  ], cargoLoss: 65
};
ev = L.analyzeRound(bothRound);
ok('storm+batch events both detected', ev.length === 2);
const co = L.coLossSummary(bothRound, ev);
ok('coLossSummary dedupes dawn across events', co.names.length === 2 && co.totalLoss === 65);

/* 4. focus + encounter + applied records, dedupe, structure */
const campLike = { campaignId: 'test-1', currentRound: 2 };
L.recordFocus(campLike, 'route');
L.recordFocus(campLike, 'batch');
let concept = L.getConcept();
ok('focusedOn single entry per round, updated', concept && concept.focusedOn.length === 1 && concept.focusedOn[0].focus === 'batch');

const evRef = L.recordEncounter(campLike, stormRound, L.analyzeRound(stormRound));
const evRef2 = L.recordEncounter(campLike, stormRound, L.analyzeRound(stormRound));
ok('encounterRef dedupes per campaign+round', concept.encounterRefs.length === 1 && evRef === evRef2);
ok('encounteredAt set', !!concept.encounteredAt);
ok('evidence shape matches spec', concept.conceptId === 'correlated_risk'
  && evRef.round === 4 && evRef.commonRiskEvents[0].type === 'storm' && Array.isArray(evRef.vesselIds));

const applied = L.recordApplied(campLike, 4, [{ change: 'ship-kept-in-port', shipId: 'vessel.skiff' }]);
L.recordApplied(campLike, 4, [{ change: 'ship-kept-in-port', shipId: 'vessel.skiff' }]);
ok('appliedAt dedupes per campaign+from+to', concept.appliedAt.length === 1 && applied.changes.length === 1);
ok('no applied when changes empty', L.recordApplied(campLike, 4, []) === null);

/* 5. planChanges diffing */
const prev = { 'vessel.dawn': 'route.north', 'vessel.gull': 'route.coastal', 'vessel.guild': 'route.south', 'vessel.skiff': 'route.north', 'vessel.ocean': 'route.coastal', 'vessel.sail': 'route.south' };
const cur = { 'vessel.dawn': 'route.north', 'vessel.gull': 'route.coastal', 'vessel.guild': 'route.south', 'vessel.skiff': null, 'vessel.ocean': 'route.south', 'vessel.sail': 'route.south' };
const changes = L.planChanges(prev, cur, 20, 30);
ok('planChanges sees port-stay', changes.some(c => c.change === 'ship-kept-in-port' && c.shipId === 'vessel.skiff'));
ok('planChanges sees route-thinned north', changes.some(c => c.change === 'route-thinned' && c.routeId === 'route.north' && c.from === 2 && c.to === 1));
ok('planChanges sees route-changed ocean', changes.some(c => c.change === 'route-changed' && c.shipId === 'vessel.ocean'));
ok('planChanges sees reserve increase', changes.some(c => c.change === 'reserve-increased' && c.from === 20 && c.to === 30));
ok('planChanges empty when identical', L.planChanges(prev, { ...prev }, 20, 20).length === 0);

/* 6. runtime: submitPlan records applied when previous round had events */
let campaign;
{
  const r = R.startCampaign();
  ok('campaign started', r.ok === true);
  campaign = r.campaign;
}
const prevRoundFake = {
  round: 1,
  assignments: prev,
  storms: [{ routeId: 'route.north', severity: 0.9 }],
  batchDefects: [],
  vesselResults: [
    vr('vessel.dawn', '曙光号', 'route.north', 'batch.rope_a', 80),
    vr('vessel.skiff', '沿岸小船', 'route.north', 'batch.rope_b', 30)
  ],
  cargoLoss: 110, voyageIncome: 40, reinsuranceCost: 12, reinsuranceRecovery: 0, playerLoss: 110,
  reserveUsed: 0, operatingCashBefore: 80, reserveBefore: 20, operatingCashAfter: 98, reserveAfter: 20,
  insolvent: false
};
const ns = get('world.fleet');
ns.activeCampaign.rounds.push(prevRoundFake);
ns.activeCampaign.currentRound = 2;
ns.activeCampaign.assignments = cur;
set('world.fleet', ns);
/* fund the campaign so round-2 settlement can never cause insolvency (random seed may otherwise flip the phase) */
ns.activeCampaign.operatingCash = 99999;
ns.activeCampaign.reserve = 0;
set('world.fleet', ns);

const submit = R.submitPlan();
ok('submitPlan ok', submit.ok === true);
const stored = get('world.learning');
const appliedEntry = stored.concepts.correlated_risk.appliedAt.find(a => a.campaignId === campaign.campaignId && a.fromRound === 1 && a.toRound === 2);
ok('runtime recorded applied for round 2', !!appliedEntry && appliedEntry.changes.length > 0);

/* 7. focus round recorded via campaign flag is respected by runtime API */
const lf = R.setLearningFocus('batch');
ok('setLearningFocus works in planning', lf.ok === true && lf.learningFocus.round === 3 && lf.learningFocus.choice === 'batch');
ok('invalid focus rejected', R.setLearningFocus('bogus').ok === false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
