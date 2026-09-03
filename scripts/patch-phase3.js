/* Phase 3 systematic improvement patch:
 * 1. Shipyard building on street (index.html)
 * 2. Per-part sampling config + runtime (shipyard-config.js, shipyard-runtime.js)
 * Run: node scripts/patch-phase3.js */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function patch(relPath, patches) {
  const abs = path.join(ROOT, relPath);
  let c = fs.readFileSync(abs, 'utf8');
  for (const [label, anchor, replacement] of patches) {
    if (!c.includes(anchor)) { console.error('FAIL [' + relPath + '] ' + label); failures++; continue; }
    c = c.replace(anchor, replacement);
    console.log('OK   [' + relPath + '] ' + label);
  }
  fs.writeFileSync(abs, c, 'utf8');
}

/* ══════════════════════════════════════════════════════════════
 * 1. index.html — shipyard building on street
 * ══════════════════════════════════════════════════════════════ */
patch('index.html', [
  /* 1a. HTML sign element */
  [
    'add shipyard-sign HTML',
    '<div id="board-sign" class="sign">公告栏</div>',
    '<div id="board-sign" class="sign">公告栏</div><div id="shipyard-sign" class="sign">造船厂</div>'
  ],

  /* 1b. ensureShipyardBuildingTexture function — insert before ensureShipyardTexture */
  [
    'add ensureShipyardBuildingTexture',
    'PixelHarborScene.prototype.ensureShipyardTexture=function(){',
    `PixelHarborScene.prototype.ensureShipyardBuildingTexture=function(){
      if(this.textures.exists('shipyard-building'))return;
      const g=this.make.graphics({x:0,y:0,add:false});
      g.fillStyle(0x5a3b2a,1).fillRect(0,26,84,72);
      g.lineStyle(2,0x3e2a1b,1).strokeRect(0,26,84,72);
      g.fillStyle(0x3e2a1b,1).fillTriangle(-4,28,88,28,42,0);
      g.lineStyle(2,0x2e2117,1).strokeTriangle(-4,28,88,28,42,0);
      g.fillStyle(0x6b4a2f,1).fillRect(33,64,18,34);
      g.lineStyle(1,0x2e2117,1).strokeRect(33,64,18,34);
      g.fillStyle(0xc89b3c,1).fillCircle(48,82,2);
      g.fillStyle(0x17324a,.85).fillRect(8,36,14,12);
      g.lineStyle(1,0x3e2a1b,1).strokeRect(8,36,14,12);
      g.lineBetween(15,36,15,48);
      g.fillStyle(0x17324a,.85).fillRect(62,36,14,12);
      g.lineStyle(1,0x3e2a1b,1).strokeRect(62,36,14,12);
      g.lineBetween(69,36,69,48);
      g.lineStyle(2,0x2e2117,.6);
      [44,62,80].forEach(function(y){g.lineBetween(2,y,82,y)});
      g.lineStyle(3,0x6b4a2f,1).lineBetween(72,0,72,28);
      g.lineStyle(2,0x6b4a2f,1).lineBetween(64,6,80,6);
      g.lineStyle(1,0xc89b3c,.7).lineBetween(66,4,78,4);
      g.generateTexture('shipyard-building',84,98);g.destroy();
    };
    PixelHarborScene.prototype.ensureShipyardTexture=function(){`
  ],

  /* 1c. createStreetDecor — add shipyard building sprite + details */
  [
    'add shipyard building to createStreetDecor',
    'this.streetDecor=[gull,lamp,detail];',
    `this.ensureShipyardBuildingTexture();
        const shipyardBld=this.add.image(436,140,'shipyard-building').setOrigin(.5,1).setDepth(1);
        const syd=this.add.graphics().setDepth(3);
        syd.fillStyle(0x3e2a1b,.22).fillEllipse(436,145,96,12);
        syd.lineStyle(1,0xc89b3c,.5).lineBetween(416,100,456,100);
        this.streetDecor=[gull,lamp,detail,shipyardBld,syd];`
  ],

  /* 1d. setStreetScene obstacles — add shipyard building collision */
  [
    'add shipyard obstacle to street',
    'this.obstacles=[...STREET_MAP.buildings,{x:0,y:232',
    'this.obstacles=[...STREET_MAP.buildings,{x:394,y:42,w:84,h:96},{x:0,y:232'
  ],

  /* 1e. updateWorldSigns — add shipyard sign position */
  [
    'add shipyard sign position',
    "const positions={cafe:[1000,78],office:[250,68],archive:[612,68],board:[1110,120]};",
    "const positions={cafe:[1000,78],office:[250,68],archive:[612,68],board:[1110,120],shipyard:[436,68]};"
  ],

  /* 1f. updateLifeLighting — add shipyard window glow */
  [
    'add lifeShipyardGlow creation',
    "if(!s.lifeStreetLampGlow)s.lifeStreetLampGlow=s.add.ellipse(815,145,58,34,0xf0c070,.0).setDepth(5);",
    "if(!s.lifeStreetLampGlow)s.lifeStreetLampGlow=s.add.ellipse(815,145,58,34,0xf0c070,.0).setDepth(5);\n      if(!s.lifeShipyardGlow)s.lifeShipyardGlow=s.add.ellipse(436,110,52,30,0xf0c070,.0).setDepth(5);"
  ],
  [
    'add lifeShipyardGlow update',
    "s.lifeStreetLampGlow.setFillStyle(0xf0c070,state.windowLights?glow*.85:0);",
    "s.lifeStreetLampGlow.setFillStyle(0xf0c070,state.windowLights?glow*.85:0);\n      s.lifeShipyardGlow.setFillStyle(0xf0c070,state.windowLights?glow*.6:0);"
  ],
  [
    'add lifeShipyardGlow visibility',
    "if(s.location!=='street'){s.lifeCafeGlow.setVisible(false);s.lifeBoardGlow.setVisible(false);s.lifeStreetLampGlow.setVisible(false)}else{s.lifeCafeGlow.setVisible(true);s.lifeBoardGlow.setVisible(true);s.lifeStreetLampGlow.setVisible(true)}",
    "if(s.location!=='street'){s.lifeCafeGlow.setVisible(false);s.lifeBoardGlow.setVisible(false);s.lifeStreetLampGlow.setVisible(false);s.lifeShipyardGlow.setVisible(false)}else{s.lifeCafeGlow.setVisible(true);s.lifeBoardGlow.setVisible(true);s.lifeStreetLampGlow.setVisible(true);s.lifeShipyardGlow.setVisible(true)}"
  ]
]);

/* ══════════════════════════════════════════════════════════════
 * 2. shipyard-config.js — per-part cost and delay
 * ══════════════════════════════════════════════════════════════ */
patch('shipyard-config.js', [
  [
    'add perPartCost and perPartDelay',
    "    /* 决策与代价。repairLevel: none/partial/full；hold 单独成行。 */",
    "    /* 逐部位抽样的单位成本与时间 */\n    perPartCost: 1.5,\n    perPartDelay: 5,\n\n    /* 决策与代价。repairLevel: none/partial/full；hold 单独成行。 */"
  ]
]);

/* ══════════════════════════════════════════════════════════════
 * 3. shipyard-runtime.js — sampleSinglePart function
 * ══════════════════════════════════════════════════════════════ */
patch('shipyard-runtime.js', [
  [
    'add sampleSinglePart function',
    "  /* 唯一完成函数：提交最终决策 → 结算 → 写报告 → 清 active → 发事件。",
    `  /* 逐部位抽样：检查一个指定部位，消耗 perPartCost 和 perPartDelay。 */
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

  /* 唯一完成函数：提交最终决策 → 结算 → 写报告 → 清 active → 发事件。`
  ],
  [
    'export sampleSinglePart',
    "    start, abandon, sample, submitDecision,",
    "    start, abandon, sample, sampleSinglePart, submitDecision,"
  ]
]);

/* ══════════════════════════════════════════════════════════════
 * Summary
 * ══════════════════════════════════════════════════════════════ */
console.log('\n' + (failures === 0 ? 'All patches applied.' : failures + ' FAILED.'));
process.exit(failures === 0 ? 0 : 1);
