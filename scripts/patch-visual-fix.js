/* Visual fix patch: shipyard building exterior + interior exit door
 * Run: node scripts/patch-visual-fix.js */
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

patch('index.html', [

  /* ═══════════════════════════════════════════════════════════
   * FIX 1: Redraw shipyard building texture with pixel art style
   * matching office/archive/cafe buildings on the street.
   * Building area: x=394..478, y=42..138 (84×96px)
   * Texture origin (.5, 1) at (436, 140) → texture coords: center-bottom
   * Texture size: 84 wide × 98 tall (extra height for roof peak above wall top)
   * Wall occupies y=28..98 in texture (70px), roof peak at y=0
   * Door at bottom-center of wall
   * ═══════════════════════════════════════════════════════════ */
  [
    'redraw ensureShipyardBuildingTexture',
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
    };`,
    `PixelHarborScene.prototype.ensureShipyardBuildingTexture=function(){
      if(this.textures.exists('shipyard-building'))return;
      const g=this.make.graphics({x:0,y:0,add:false});
      /* ── 墙体：木质工坊基调，与事务所红砖/档案馆石墙形成材质区分 ── */
      const wallTop=30,wallBot=98,wallH=wallBot-wallTop;
      g.fillStyle(0x5a3b2a,1).fillRect(0,wallTop,84,wallH);
      /* 木纹水平线（模拟横板拼接，与档案馆水平砌缝同手法） */
      g.lineStyle(1,0x4a2e1e,.55);
      [40,50,60,70,80,90].forEach(function(y){g.lineBetween(1,y,83,y)});
      /* 竖向支撑柱（船坞骨架感） */
      g.lineStyle(1,0x3e2a1b,.7);
      [0,28,56,84].forEach(function(x){g.lineBetween(x,wallTop,x,wallBot)});
      /* 墙体轮廓 */
      g.lineStyle(2,0x3e2a1b,.95).strokeRect(0,wallTop,84,wallH);
      /* ── 屋顶：双层斜面，明暗分层（参考事务所/咖啡馆屋檐线条） ── */
      /* 深色底檐 */
      g.fillStyle(0x3e2a1b,1).fillTriangle(-6,wallTop+2,90,wallTop+2,42,-2);
      /* 亮色主面 */
      g.fillStyle(0x6b4a2f,1).fillTriangle(-4,wallTop,88,wallTop,42,2);
      /* 屋脊高光 */
      g.lineStyle(1,0x8a6744,.7).lineBetween(42,2,42,wallTop);
      /* 屋顶轮廓 */
      g.lineStyle(2,0x2e2117,1).strokeTriangle(-4,wallTop,88,wallTop,42,2);
      /* ── 窗户：两扇带窗框+十字窗棂（与咖啡馆窗框同手法） ── */
      g.fillStyle(0x17324a,.85).fillRect(6,42,16,14);
      g.lineStyle(1,0x3e2a1b,1).strokeRect(6,42,16,14);
      g.lineStyle(1,0xe8c87a,.6).lineBetween(14,42,14,56).lineBetween(6,49,22,49);
      g.fillStyle(0x17324a,.85).fillRect(62,42,16,14);
      g.lineStyle(1,0x3e2a1b,1).strokeRect(62,42,16,14);
      g.lineStyle(1,0xe8c87a,.6).lineBetween(70,42,70,56).lineBetween(62,49,78,49);
      /* ── 门洞：真正的开口（与咖啡馆门洞同手法） ── */
      g.fillStyle(0x1a120a,1).fillRect(32,66,20,32);
      g.lineStyle(2,0x3e2a1b,1).strokeRect(32,66,20,32);
      /* 门楣横梁 */
      g.fillStyle(0x6b4a2f,1).fillRect(30,63,24,4);
      g.lineStyle(1,0x3e2a1b,1).strokeRect(30,63,24,4);
      /* 门把手 */
      g.fillStyle(0xc89b3c,1).fillCircle(48,82,2);
      /* ── 点题细节：右侧桅杆+旗帜（船坞标识） ── */
      g.lineStyle(3,0x6b4a2f,1).lineBetween(74,2,74,30);
      g.lineStyle(2,0x6b4a2f,1).lineBetween(66,8,82,8);
      g.fillStyle(0xc89b3c,.85).fillTriangle(74,4,74,14,82,9);
      /* ── 木牌招牌：挂在门楣上方（融入建筑，非悬浮标签） ── */
      g.fillStyle(0x8a6744,1).fillRect(24,56,36,8);
      g.lineStyle(1,0x3e2a1b,1).strokeRect(24,56,36,8);
      g.lineStyle(1,0x3e2a1b,.6).lineBetween(30,56,30,53).lineBetween(54,56,54,53);
      /* ── 左侧脚手架/木料堆（工坊氛围） ── */
      g.fillStyle(0x6b4a2f,.8).fillRect(-4,78,6,20);
      g.fillStyle(0x8a6744,.7).fillRect(-2,82,4,16);
      g.lineStyle(1,0x3e2a1b,.5).lineBetween(-4,78,2,78);
      g.generateTexture('shipyard-building',84,98);g.destroy();
    };`
  ],

  /* ═══════════════════════════════════════════════════════════
   * FIX 1b: Replace floating sign sprite with integrated detail lines
   * Remove the old syd graphics that drew a simple line under the sign.
   * The wooden sign is now baked into the building texture.
   * ═══════════════════════════════════════════════════════════ */
  [
    'update createStreetDecor shipyard section',
    `this.ensureShipyardBuildingTexture();
        const shipyardBld=this.add.image(436,140,'shipyard-building').setOrigin(.5,1).setDepth(1);
        const syd=this.add.graphics().setDepth(3);
        syd.fillStyle(0x3e2a1b,.22).fillEllipse(436,145,96,12);
        syd.lineStyle(1,0xc89b3c,.5).lineBetween(416,100,456,100);
        this.streetDecor=[gull,lamp,detail,shipyardBld,syd];`,
    `this.ensureShipyardBuildingTexture();
        const shipyardBld=this.add.image(436,140,'shipyard-building').setOrigin(.5,1).setDepth(1);
        const syd=this.add.graphics().setDepth(3);
        syd.fillStyle(0x3e2a1b,.22).fillEllipse(436,145,96,12);
        /* 建筑像素细节补充：屋檐下阴影线、门口台阶 */
        syd.lineStyle(1,0x2e2117,.5).lineBetween(396,138,476,138);
        syd.fillStyle(0x6e6050,.6).fillRect(428,136,16,4);
        this.streetDecor=[gull,lamp,detail,shipyardBld,syd];`
  ],

  /* ═══════════════════════════════════════════════════════════
   * FIX 2: Draw visible exit door in shipyard interior (shipyard-floor)
   * Add a door graphic at the bottom-center of the floor texture,
   * matching the cafe interior exit door style.
   * Current exit-door interactable: x=240, y=250, approach y=236
   * Player spawn: x=240, y=228
   * ═══════════════════════════════════════════════════════════ */
  [
    'add exit door to shipyard-floor texture',
    `g.fillStyle(0xf0c070,.16).fillCircle(120,90,26);g.fillStyle(0xf0c070,.16).fillCircle(360,90,26);
      g.generateTexture('shipyard-floor',W,H);g.destroy();`,
    `g.fillStyle(0xf0c070,.16).fillCircle(120,90,26);g.fillStyle(0xf0c070,.16).fillCircle(360,90,26);
      /* ── 出口门：画面下方中央，与咖啡馆室内出口门风格一致 ── */
      g.fillStyle(0x1a120a,1).fillRect(218,248,44,22);
      g.lineStyle(2,0x3e2a1b,1).strokeRect(218,248,44,22);
      g.fillStyle(0x6b4a2f,1).fillRect(216,244,48,6);
      g.lineStyle(1,0x3e2a1b,1).strokeRect(216,244,48,6);
      g.fillStyle(0xc89b3c,1).fillCircle(254,258,2);
      g.lineStyle(1,0xe8c87a,.5).lineBetween(240,248,240,270);
      g.generateTexture('shipyard-floor',W,H);g.destroy();`
  ],

  /* ═══════════════════════════════════════════════════════════
   * FIX 2b: Adjust player spawn and exit-door position
   * Spawn inside near the door (y=236 instead of 228)
   * Exit door interactable at y=256 (visible door center)
   * Approach point at y=240 so player walks toward the door
   * ═══════════════════════════════════════════════════════════ */
  [
    'adjust shipyard player spawn and exit door position',
    "this.player.setPosition(240,228);this.player.setFrame(7);",
    "this.player.setPosition(240,236);this.player.setFrame(7);"
  ],
  [
    'adjust exit-door interactable coordinates',
    "{kind:'exit-door',x:240,y:250,approach:{x:240,y:236},reach:26,label:'返回港口'}",
    "{kind:'exit-door',x:240,y:256,approach:{x:240,y:240},reach:28,label:'离开造船厂'}"
  ]
]);

console.log('\n' + (failures === 0 ? 'All visual fixes applied.' : failures + ' FAILED.'));
process.exit(failures === 0 ? 0 : 1);
