#!/usr/bin/env node
/* Patch: fix fleet-ui.js references after model V0.2 flattened round results.
 * Usage: node scripts/patch-fleet-ui-totals.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function editFile(relPath, replacements) {
  const abs = path.join(ROOT, relPath);
  let text = fs.readFileSync(abs, 'utf8');
  for (const [label, old, newStr] of replacements) {
    if (!text.includes(old)) {
      console.error('[patch] FAIL: "' + label + '" — target string not found in ' + relPath);
      process.exit(1);
    }
    text = text.replace(old, newStr);
    console.log('[patch] applied: ' + label);
  }
  fs.writeFileSync(abs, text, 'utf8');
  console.log('[patch] edited ' + relPath);
}

editFile('fleet-ui.js', [
  /* 1. expected fields — no longer stored on round result */
  [
    'expectedVoyageIncome',
    "fmt(lastRound.totals.expectedVoyageIncome)",
    "'—'"
  ],
  [
    'expectedNetProfit',
    "fmt(lastRound.totals.expectedNetProfit)",
    "'—'"
  ],

  /* 2. netProfit → computed from flat fields */
  [
    'lastRound netProfit',
    'fmt(lastRound.totals.netProfit)',
    'fmt(lastRound.voyageIncome - lastRound.reinsuranceCost - lastRound.playerLoss)'
  ],
  [
    'rr netProfit',
    'fmt(rr.totals.netProfit)',
    'fmt(rr.voyageIncome - rr.reinsuranceCost - rr.playerLoss)'
  ],

  /* 3. totalFundsBefore → computed */
  [
    'totalFundsBefore',
    'fmt(lastRound.totalFundsBefore)',
    'fmt(lastRound.operatingCashBefore + lastRound.reserveBefore)'
  ],

  /* 4. r.totals.* → r.* (summary loop) */
  [
    'r.totals.voyageIncome',
    'r.totals.voyageIncome',
    'r.voyageIncome'
  ],
  [
    'r.totals.cargoLoss',
    'r.totals.cargoLoss',
    'r.cargoLoss'
  ],
  [
    'r.totals.reinsuranceCost',
    'r.totals.reinsuranceCost',
    'r.reinsuranceCost'
  ],
  [
    'r.totals.reinsuranceRecovery',
    'r.totals.reinsuranceRecovery',
    'r.reinsuranceRecovery'
  ],

  /* 5. lastRound.totals.* → lastRound.* (remaining) */
  [
    'lastRound.totals.voyageIncome',
    'lastRound.totals.voyageIncome',
    'lastRound.voyageIncome'
  ],
  [
    'lastRound.totals.cargoLoss',
    'lastRound.totals.cargoLoss',
    'lastRound.cargoLoss'
  ],
  [
    'lastRound.totals.reinsuranceCost',
    'lastRound.totals.reinsuranceCost',
    'lastRound.reinsuranceCost'
  ],
  [
    'lastRound.totals.reinsuranceRecovery',
    'lastRound.totals.reinsuranceRecovery',
    'lastRound.reinsuranceRecovery'
  ]
]);

/* Syntax check */
var abs = path.join(ROOT, 'fleet-ui.js');
try {
  new Function(fs.readFileSync(abs, 'utf8'));
  console.log('[patch] syntax OK: fleet-ui.js');
} catch (e) {
  console.error('[patch] SYNTAX ERROR in fleet-ui.js: ' + e.message);
  process.exit(1);
}

/* Verify no remaining .totals. references */
var text = fs.readFileSync(abs, 'utf8');
var remaining = [];
var lines = text.split('\n');
for (var i = 0; i < lines.length; i++) {
  if (lines[i].includes('.totals.')) remaining.push('  L' + (i + 1) + ': ' + lines[i].trim());
}
if (remaining.length > 0) {
  console.error('[patch] WARNING: remaining .totals. references:\n' + remaining.join('\n'));
  process.exit(1);
} else {
  console.log('[patch] No remaining .totals. references — clean.');
}
