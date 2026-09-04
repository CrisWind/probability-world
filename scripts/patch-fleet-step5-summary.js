/* Step 5b: enhance summary view */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.resolve(__dirname, '..');

function writeFile(relPath, content) {
  const full = path.join(BASE, relPath);
  fs.writeFileSync(full, content, 'utf8');
  console.log('WRITE', relPath, '(' + content.length + ' bytes)');
}
function readFile(relPath) {
  return fs.readFileSync(path.join(BASE, relPath), 'utf8');
}
function syntaxCheck(relPath) {
  const full = path.join(BASE, relPath);
  try {
    execSync('node -c "' + full + '"', { stdio: 'pipe' });
    console.log('SYNTAX OK:', relPath);
    return true;
  } catch (e) {
    console.error('SYNTAX FAIL:', relPath, e.stderr ? e.stderr.toString().slice(0, 500) : e.message);
    return false;
  }
}

const UI_FILE = 'fleet-ui.js';
let uiContent = readFile(UI_FILE);

/* 1. Add shipName helper near routeName */
const helperAnchor = [
  "  function routeName(routeId) {",
  "    if (!routeId) return '留港';",
  "    var r = model().findRoute(routeId);",
  "    return r ? r.name : routeId;",
  "  }"
].join('\n');
const helperNew = [
  "  function routeName(routeId) {",
  "    if (!routeId) return '留港';",
  "    var r = model().findRoute(routeId);",
  "    return r ? r.name : routeId;",
  "  }",
  "",
  "  function shipName(shipId) {",
  "    var v = model().findVessel(shipId);",
  "    return v ? v.name : shipId;",
  "  }"
].join('\n');

if (uiContent.indexOf('function shipName(') !== -1) {
  console.log('SKIP', UI_FILE, '— shipName already present');
} else if (uiContent.indexOf(helperAnchor) === -1) {
  console.error('HELPER ANCHOR NOT FOUND in', UI_FILE);
  process.exit(1);
} else {
  uiContent = uiContent.replace(helperAnchor, helperNew);
  console.log('PATCH', UI_FILE, '— added shipName helper');
}

/* 2. Replace entire renderSummary function */
const summaryStart = '  /* ── Summary 视图 ── */';
const summaryEnd = '\n\n  /* ── 导出 ── */';
const startIdx = uiContent.indexOf(summaryStart);
const endIdx = uiContent.indexOf(summaryEnd);

if (startIdx === -1 || endIdx === -1) {
  console.error('SUMMARY BOUNDARIES NOT FOUND in', UI_FILE);
  process.exit(1);
}

const summaryFunction = [
  "  /* ── Summary 视图 ── */",
  "  function renderSummary(camp) {",
  "    var html = '';",
  "    var cfg = config();",
  "    var startOp = cfg.capital.startingOperatingCash;",
  "    var startRes = cfg.capital.startingReserve;",
  "",
  "    html += '<div class=\"fleet-section\"><h3 class=\"fleet-section-title\">本局结果</h3>';",
  "    if (camp.phase === 'completed') {",
  "      html += '<div class=\"fleet-info\"><b>正常完成</b> · 全部 ' + camp.totalRounds + ' 回合已结算</div>';",
  "    } else if (camp.phase === 'insolvent') {",
  "      html += '<div class=\"fleet-warning\"><b>资金缺口</b> · campaign 在第 ' + camp.currentRound + ' 回合因资金不足终止</div>';",
  "    } else {",
  "      html += '<div class=\"fleet-info\">当前状态：<b>' + camp.phase + '</b></div>';",
  "    }",
  "    html += '<div style=\"margin:8px 0\">';",
  "    html += '<span class=\"fleet-summary-stat\">运行回合 <b>' + camp.rounds.length + '/' + camp.totalRounds + '</b></span>';",
  "    html += '<span class=\"fleet-summary-stat\">seed <b>' + camp.seed + '</b></span>';",
  "    html += '</div></div>';",
  "",
  "    var finalTotal = camp.operatingCash + camp.reserve;",
  "    var totalIncome = 0, totalLoss = 0, totalRiCost = 0, totalRiRecovery = 0, totalReserveUsed = 0;",
  "    for (var i = 0; i < camp.rounds.length; i++) {",
  "      var r = camp.rounds[i];",
  "      totalIncome += r.voyageIncome;",
  "      totalLoss += r.cargoLoss;",
  "      totalRiCost += r.reinsuranceCost;",
  "      totalRiRecovery += r.reinsuranceRecovery;",
  "      totalReserveUsed += r.reserveUsed || 0;",
  "    }",
  "",
  "    html += '<div class=\"fleet-section\"><h3 class=\"fleet-section-title\">资金总结</h3>';",
  "    html += '<table class=\"fleet-result-table\">';",
  "    html += '<tr><td>初始经营现金</td><td><b>' + fmt(startOp) + '</b></td></tr>';",
  "    html += '<tr><td>初始准备金</td><td><b>' + fmt(startRes) + '</b></td></tr>';",
  "    html += '<tr><td>最终经营现金</td><td><b>' + fmt(camp.operatingCash) + '</b></td></tr>';",
  "    html += '<tr><td>最终准备金</td><td><b>' + fmt(camp.reserve) + '</b></td></tr>';",
  "    html += '<tr><td>最终总资金</td><td><b>' + fmt(finalTotal) + '</b></td></tr>';",
  "    html += '<tr><td>累计航运收入</td><td><b>' + fmt(totalIncome) + '</b></td></tr>';",
  "    html += '<tr><td>累计货损</td><td><b>' + fmt(totalLoss) + '</b></td></tr>';",
  "    html += '<tr><td>再保险费用</td><td><b>' + fmt(totalRiCost) + '</b></td></tr>';",
  "    html += '<tr><td>再保险恢复</td><td><b>' + fmt(totalRiRecovery) + '</b></td></tr>';",
  "    html += '<tr><td>准备金动用</td><td><b>' + fmt(totalReserveUsed) + '</b></td></tr>';",
  "    html += '<tr class=\"total\"><td>累计净变化</td><td>' + fmt(finalTotal - (startOp + startRes)) + '</td></tr>';",
  "    html += '</table></div>';",
  "",
  "    html += '<div class=\"fleet-section\"><h3 class=\"fleet-section-title\">风险总结</h3>';",
  "    var stormRounds = [];",
  "    for (var si = 0; si < camp.rounds.length; si++) {",
  "      if (camp.rounds[si].storms && camp.rounds[si].storms.length > 0) stormRounds.push(camp.rounds[si].round);",
  "    }",
  "    if (stormRounds.length > 0) {",
  "      html += '<div class=\"fleet-warning\">风暴回合：第 ' + stormRounds.join('、') + ' 回合</div>';",
  "    } else {",
  "      html += '<div class=\"fleet-info\">本局无风暴。</div>';",
  "    }",
  "",
  "    var batchDefectRounds = [];",
  "    for (var bi = 0; bi < camp.rounds.length; bi++) {",
  "      if (camp.rounds[bi].batchDefects && camp.rounds[bi].batchDefects.length > 0) batchDefectRounds.push(camp.rounds[bi].round);",
  "    }",
  "    if (batchDefectRounds.length > 0) {",
  "      html += '<div class=\"fleet-warning\">批次缺陷回合：第 ' + batchDefectRounds.join('、') + ' 回合</div>';",
  "    } else {",
  "      html += '<div class=\"fleet-info\">本局无批次缺陷。</div>';",
  "    }",
  "",
  "    if (totalReserveUsed > 0) {",
  "      html += '<div class=\"fleet-info\">本局动用了准备金，共计 <b>' + fmt(totalReserveUsed) + '</b></div>';",
  "    } else {",
  "      html += '<div class=\"fleet-info\">本局未动用准备金。</div>';",
  "    }",
  "    html += '</div>';",
  "",
  "    html += '<div class=\"fleet-section\"><h3 class=\"fleet-section-title\">回合账本</h3>';",
  "    for (var ri = 0; ri < camp.rounds.length; ri++) {",
  "      var rr = camp.rounds[ri];",
  "      html += '<div class=\"fleet-info\">';",
  "      html += '<b>第 ' + rr.round + ' 回合</b><br>';",
  "      html += '方案：';",
  "      var assignedShips = [];",
  "      for (var shipId in rr.assignments) {",
  "        if (rr.assignments[shipId]) {",
  "          assignedShips.push(shipName(shipId) + '→' + routeName(rr.assignments[shipId]));",
  "        } else {",
  "          assignedShips.push(shipName(shipId) + '→留港');",
  "        }",
  "      }",
  "      html += assignedShips.join('，') + '<br>';",
  "      html += '收入 ' + fmt(rr.voyageIncome) + ' · 货损 ' + fmt(rr.cargoLoss) + ' · 净利润 ' + fmt(rr.voyageIncome - rr.reinsuranceCost - rr.playerLoss);",
  "      if (rr.storms.length > 0) html += ' · 风暴 ' + rr.storms.length + ' 次';",
  "      if (rr.batchDefects.length > 0) html += ' · 批次缺陷';",
  "      html += '</div>';",
  "    }",
  "    html += '</div>';",
  "",
  "    html += '<div class=\"fleet-actions\">';",
  "    html += '<button class=\"fleet-btn primary\" data-action=\"new-campaign\">开始新一局</button>';",
  "    html += '<button class=\"fleet-btn secondary\" data-action=\"return-harbor\">返回港口</button>';",
  "    html += '</div>';",
  "",
  "    panelBody.innerHTML = html;",
  "",
  "    var newBtn = panelBody.querySelector('[data-action=\"new-campaign\"]');",
  "    if (newBtn) newBtn.addEventListener('click', function() {",
  "      var r = runtime().startCampaign();",
  "      if (r.ok) {",
  "        currentView = 'planning';",
  "        render();",
  "      }",
  "    });",
  "    var harborBtn = panelBody.querySelector('[data-action=\"return-harbor\"]');",
  "    if (harborBtn) harborBtn.addEventListener('click', function() {",
  "      close();",
  "    });",
  "  }"
].join('\n');

const oldSummary = uiContent.substring(startIdx, endIdx);
if (oldSummary.indexOf('本局结果') !== -1) {
  console.log('SKIP', UI_FILE, '— summary view already enhanced');
} else {
  uiContent = uiContent.substring(0, startIdx) + summaryFunction + uiContent.substring(endIdx);
  console.log('PATCH', UI_FILE, '— enhanced summary view');
}

writeFile(UI_FILE, uiContent);

console.log('\n--- Syntax Verification ---');
if (!syntaxCheck(UI_FILE)) {
  process.exit(1);
}
console.log('\n✓ Syntax OK');
