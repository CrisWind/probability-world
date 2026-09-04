/* Fix: U3 reminder block was inserted twice (marker string mismatch). Dedupe. */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'fleet-ui.js');
let content = fs.readFileSync(FILE, 'utf8');
const NL = content.indexOf('\r\n') !== -1 ? '\r\n' : '\n';

const block = [
  "    /* 学习反馈：上一轮共同风险 → 下一轮轻提示（无推荐，不自动改方案） */",
  "    var prevRound = camp.rounds.length > 0 ? camp.rounds[camp.rounds.length - 1] : null;",
  "    var prevEvents = prevRound ? roundEvents(prevRound) : [];",
  "    if (prevEvents.length > 0 && prevRound.round === camp.currentRound - 1) {",
  "      html += '<div class=\"fleet-section\"><h3 class=\"fleet-section-title\">上一轮观察</h3>';",
  "      for (var le = 0; le < prevEvents.length; le++) html += '<div class=\"fleet-info\">' + shortEventText(prevEvents[le]) + '</div>';",
  "      html += '<div class=\"fleet-learn\">上一轮你观察到：多艘船共享同一风险来源并同时受损。本轮可以重新安排：是否继续集中在同一航线；是否错开航线；是否让部分船留港；是否调整准备金。<br>';",
  "      html += '<span class=\"fleet-learn-note\">风险盘只记录你的实际安排，不做评价，不自动降低风险。</span></div>';",
  "      html += '</div>';",
  "    }"
].join(NL);

const dup = block + NL + block;
if (content.includes(dup)) {
  content = content.replace(dup, block);
  fs.writeFileSync(FILE, content, 'utf8');
  console.log('removed duplicate U3 block');
} else {
  console.log('no duplicate found (count check below)');
}
const count = content.split("fleet-section-title\">上一轮观察</h3>").length - 1;
console.log('occurrences of 上一轮观察 section:', count);
