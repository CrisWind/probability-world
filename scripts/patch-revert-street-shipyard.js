/*
 * Revert street shipyard exterior to the committed original (runtime 'shipyard-building'
 * texture at 436,140, original shadow/door/obstacle/sign geometry).
 * Interior (shipyard-interior.png, shipyard-embedded.js) is intentionally untouched.
 * Idempotent: each entry is skipped when its replacement marker is already present.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index.html');

let content = fs.readFileSync(FILE, 'utf8');
const orig = content;
const applied = [];

/* A. Remove shipyard-exterior preload (keep shipyard-interior) */
{
  const old = `;this.load.image('shipyard-exterior',asset('shipyard-exterior.png'))`;
  const marker = `this.load.image('shipyard-exterior'`;
  if (content.includes(old) && content.includes(marker)) {
    content = content.replace(old, '');
    applied.push('A.preload: removed shipyard-exterior image load');
  } else if (content.includes(marker)) {
    throw new Error('[A] anchor mismatch: marker still present but old text not found');
  } else {
    console.log('SKIP A: shipyard-exterior preload already removed');
  }
}

/* B. Restore runtime building sprite + original shadow ellipse (file is CRLF) */
const NL = '\r\n';
{
  const old =
    `        const shipyardBld=(this.textures.exists('shipyard-exterior')?${NL}` +
    `          this.add.image(436,170,'shipyard-exterior').setOrigin(.5,1).setScale(.15).setCrop(0,0,1024,980).setDepth(1):${NL}` +
    `          this.add.image(436,140,'shipyard-building').setOrigin(.5,1).setDepth(1));${NL}` +
    `        const syd=this.add.graphics().setDepth(3);${NL}` +
    `        syd.fillStyle(0x3e2a1b,.22).fillEllipse(436,175,140,14);`;
  const repl =
    `        const shipyardBld=this.add.image(436,140,'shipyard-building').setOrigin(.5,1).setDepth(1);${NL}` +
    `        const syd=this.add.graphics().setDepth(3);${NL}` +
    `        syd.fillStyle(0x3e2a1b,.22).fillEllipse(436,145,96,12);`;
  if (content.includes(old)) {
    content = content.replace(old, repl);
    applied.push('B: restored runtime shipyard-building sprite + shadow ellipse(436,145,96,12)');
  } else if (!content.includes(repl)) {
    throw new Error('[B] anchor not found and replacement not present');
  } else {
    console.log('SKIP B: runtime building already restored');
  }
}

/* C1. Restore obstacle rect for the shipyard footprint */
{
  const old = `this.obstacles=[...STREET_MAP.buildings,{x:360,y:60,w:154,h:110},`;
  const repl = `this.obstacles=[...STREET_MAP.buildings,{x:394,y:42,w:84,h:96},`;
  if (content.includes(old)) {
    content = content.replace(old, repl);
    applied.push('C1: obstacle restored to {394,42,84,96}');
  } else if (!content.includes(repl)) {
    throw new Error('[C1] anchor not found and replacement not present');
  } else {
    console.log('SKIP C1: obstacle already restored');
  }
}

/* C2. Restore shipyard door interactable geometry */
{
  const old = `{kind:'shipyard-door',x:436,y:152,approach:{x:436,y:180},reach:34},`;
  const repl = `{kind:'shipyard-door',x:430,y:136,approach:{x:430,y:170},reach:30},`;
  if (content.includes(old)) {
    content = content.replace(old, repl);
    applied.push('C2: door interactable restored to (430,136)/(430,170), reach 30');
  } else if (!content.includes(repl)) {
    throw new Error('[C2] anchor not found and replacement not present');
  } else {
    console.log('SKIP C2: door already restored');
  }
}

/* D. Restore shipyard world-sign anchor to building top (68) */
{
  const old = `shipyard:[436,14]`;
  const repl = `shipyard:[436,68]`;
  if (content.includes(old)) {
    content = content.replace(old, repl);
    applied.push('D: shipyard sign restored to y=68');
  } else if (!content.includes(repl)) {
    throw new Error('[D] anchor not found and replacement not present');
  } else {
    console.log('SKIP D: sign already restored');
  }
}

if (applied.length === 0) {
  console.log('No changes needed.');
} else {
  fs.writeFileSync(FILE, content, 'utf8');
  console.log('APPLIED:\n - ' + applied.join('\n - '));
}
console.log('changed:', orig !== content);
