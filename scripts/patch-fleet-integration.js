#!/usr/bin/env node
/* Phase A: patch-fleet-integration.js
 * Patches 4 existing files for fleet module integration:
 *   1. game-event-bus.js  — add 5 fleet event types to TYPES
 *   2. game-store.js      — add world.fleet to defaults
 *   3. index.html         — script tags + version stamps + shipyard fleet desk
 *   4. test-shipyard.js   — D3 assertion 14→19
 * Idempotent: each entry checks for its own marker before applying.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let changed = 0;

function patch(relPath, entries) {
  const abs = path.join(ROOT, relPath);
  let src = fs.readFileSync(abs, 'utf8');
  const orig = src;
  for (const { marker, anchor, replacement, label } of entries) {
    if (src.includes(marker)) {
      console.log('  SKIP ' + relPath + ' — ' + label + ' (already applied)');
      continue;
    }
    if (!src.includes(anchor)) {
      console.error('  FAIL ' + relPath + ' — anchor not found for: ' + label);
      process.exit(1);
    }
    src = src.replace(anchor, replacement);
    console.log('  OK   ' + relPath + ' — ' + label);
    changed++;
  }
  if (src !== orig) fs.writeFileSync(abs, src, 'utf8');
}

function verifySyntax(relPath) {
  const abs = path.join(ROOT, relPath);
  try {
    execSync('node --check "' + abs + '"', { stdio: 'pipe' });
    console.log('  SYNT OK  ' + relPath);
  } catch (e) {
    console.error('  SYNT FAIL ' + relPath);
    console.error(e.stderr?.toString() || e.message);
    process.exit(1);
  }
}

function readback(relPath, lineStart, lineEnd) {
  const abs = path.join(ROOT, relPath);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  console.log('  --- ' + relPath + ' L' + lineStart + '-' + lineEnd + ' ---');
  for (let i = lineStart - 1; i < Math.min(lineEnd, lines.length); i++) {
    console.log('  ' + (i + 1) + ': ' + lines[i]);
  }
}

/* ========== 1. game-event-bus.js ========== */
console.log('\n[1/4] game-event-bus.js — add 5 fleet event types');
patch('game-event-bus.js', [
  {
    marker: "'fleet_campaign_completed'",
    anchor: "'inspection_completed'\n  ]);",
    replacement: "'inspection_completed',\n    'fleet_plan_submitted',\n    'fleet_round_settled',\n    'fleet_storm_triggered',\n    'fleet_insolvent',\n    'fleet_campaign_completed'\n  ]);",
    label: 'fleet event types'
  }
]);
verifySyntax('game-event-bus.js');
readback('game-event-bus.js', 6, 27);

/* ========== 2. game-store.js ========== */
console.log('\n[2/4] game-store.js — add world.fleet to defaults');
patch('game-store.js', [
  {
    marker: 'fleet:{version:1,activeCampaign:null,archivedCampaigns:[]}',
    anchor: 'shipyard:{version:1,reports:[],activeInspection:null}},',
    replacement: 'shipyard:{version:1,reports:[],activeInspection:null},fleet:{version:1,activeCampaign:null,archivedCampaigns:[]}},',
    label: 'world.fleet namespace'
  }
]);
verifySyntax('game-store.js');
readback('game-store.js', 18, 29);

/* ========== 3. index.html ========== */
console.log('\n[3/4] index.html — script tags + version stamps + shipyard fleet desk');
patch('index.html', [
  // 3a. Script tags: add 4 fleet scripts after shipyard-ui
  {
    marker: 'fleet-config.js?v=20260903-1',
    anchor: '<script src="./shipyard-runtime.js?v=20260902-1"></script><script src="./shipyard-ui.js?v=20260902-1"></script>',
    replacement: '<script src="./shipyard-runtime.js?v=20260903-1"></script><script src="./shipyard-ui.js?v=20260903-1"></script>\n  <script src="./fleet-config.js?v=20260903-1"></script><script src="./fleet-model.js?v=20260903-1"></script>\n  <script src="./fleet-runtime.js?v=20260903-1"></script><script src="./fleet-ui.js?v=20260903-1"></script>',
    label: 'fleet script tags + version bump'
  },
  // 3b. Version bump for game-event-bus and game-store (these files changed)
  {
    marker: 'game-event-bus.js?v=20260903-1',
    anchor: 'game-event-bus.js?v=20260902-1',
    replacement: 'game-event-bus.js?v=20260903-1',
    label: 'version bump game-event-bus'
  },
  {
    marker: 'game-store.js?v=20260903-1',
    anchor: 'game-store.js?v=20260902-1',
    replacement: 'game-store.js?v=20260903-1',
    label: 'version bump game-store'
  },
  // 3c. Interact hook: fleet-desk before AP economy block
  {
    marker: "if(task.kind==='fleet-desk'){window.FleetUI?.open?.();return}",
    anchor: "if(task.kind==='inspection-desk'){window.ShipyardUI?.open?.();return}",
    replacement: "if(task.kind==='inspection-desk'){window.ShipyardUI?.open?.();return}\n        if(task.kind==='fleet-desk'){window.FleetUI?.open?.();return}",
    label: 'fleet-desk interact hook'
  },
  // 3d. Texture: add right-side fleet desk drawing
  {
    marker: '0x8b6b4a,1).fillRect(338,150,84,34)',
    anchor: 'g.fillStyle(0xf0c070,.16).fillCircle(120,90,26);g.fillStyle(0xf0c070,.16).fillCircle(360,90,26);',
    replacement: 'g.fillStyle(0x8b6b4a,1).fillRect(338,150,84,34);g.lineStyle(2,0x211b17,1).strokeRect(338,150,84,34);g.fillStyle(0xd4b896,1).fillRect(350,142,34,10);g.fillStyle(0x4a3520,1).fillRect(356,156,14,8);g.fillStyle(0xc89b3c,1).fillCircle(392,170,3);g.lineStyle(1,0x6b4a2f,.6).lineBetween(338,168,422,168);g.fillStyle(0xf0c070,.12).fillCircle(380,90,22);g.fillStyle(0xf0c070,.16).fillCircle(120,90,26);g.fillStyle(0xf0c070,.16).fillCircle(360,90,26);',
    label: 'fleet desk texture pixels'
  },
  // 3e. Obstacles: add fleet desk obstacle
  {
    marker: '{x:332,y:138,w:96,h:50}',
    anchor: 'this.obstacles=[{x:0,y:0,w:W,h:66},{x:150,y:56,w:160,h:50},{x:52,y:138,w:96,h:50}];',
    replacement: 'this.obstacles=[{x:0,y:0,w:W,h:66},{x:150,y:56,w:160,h:50},{x:52,y:138,w:96,h:50},{x:332,y:138,w:96,h:50}];',
    label: 'fleet desk obstacle'
  },
  // 3f. Interactables: add fleet-desk entry
  {
    marker: "{kind:'fleet-desk'",
    anchor: "{kind:'shipyard-hull',key:'shipyard-hull',label:'查看曙光号船体',x:240,y:96,approach:{x:240,y:150},reach:40,type:'building',action:{type:'inspect'}}",
    replacement: "{kind:'shipyard-hull',key:'shipyard-hull',label:'查看曙光号船体',x:240,y:96,approach:{x:240,y:150},reach:40,type:'building',action:{type:'inspect'}},\n        {kind:'fleet-desk',key:'fleet-desk',label:'商会风险盘',x:380,y:158,approach:{x:380,y:190},reach:36,type:'building',action:{type:'fleet'}}",
    label: 'fleet-desk interactable'
  }
]);

// Verify index.html script blocks
console.log('  --- index.html script tag verification ---');
const idxContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scriptBlockRe = /<script[^>]*src="\.\/fleet-[^"]*"[^>]*><\/script>/g;
const fleetScripts = idxContent.match(scriptBlockRe) || [];
console.log('  Fleet scripts found: ' + fleetScripts.length);
fleetScripts.forEach(s => console.log('    ' + s));

// Verify no remaining old version stamps on changed files
const oldStamps = [
  'game-event-bus.js?v=20260902-1',
  'game-store.js?v=20260902-1',
  'shipyard-runtime.js?v=20260902-1',
  'shipyard-ui.js?v=20260902-1'
];
for (const stamp of oldStamps) {
  if (idxContent.includes(stamp)) {
    console.error('  WARN: old version stamp still present: ' + stamp);
  }
}

/* ========== 4. test-shipyard.js ========== */
console.log('\n[4/4] test-shipyard.js — D3 assertion 14→19');
patch('scripts/test-shipyard.js', [
  {
    marker: "D3 白名单只新增 9 项（10→19）",
    anchor: "check('D3 白名单只新增 4 项（10→14）', bus.TYPES.length === 14, 'got ' + bus.TYPES.length);",
    replacement: "check('D3 白名单只新增 9 项（10→19）', bus.TYPES.length === 19, 'got ' + bus.TYPES.length);",
    label: 'D3 assertion update'
  }
]);
verifySyntax('scripts/test-shipyard.js');
readback('scripts/test-shipyard.js', 219, 224);

/* ========== Summary ========== */
console.log('\n=== Phase A complete: ' + changed + ' entries applied ===');
console.log('Run: node scripts/test-shipyard.js  (regression check)');
