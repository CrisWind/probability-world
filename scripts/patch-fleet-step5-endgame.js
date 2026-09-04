/* Step 5: endgame flow + summary UI fixes
 * Idempotent: checks markers before each change. */
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
function checkHtmlScripts(relPath) {
  const full = path.join(BASE, relPath);
  const html = fs.readFileSync(full, 'utf8');
  let count = 0;
  const re = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  while (re.exec(html)) count++;
  console.log('Checked', count, 'script blocks in', relPath);
  return count;
}

/* ============================================================
 * 1. fleet-runtime.js
 * ============================================================ */
const RT_FILE = 'fleet-runtime.js';
let rtContent = readFile(RT_FILE);

/* 1a. Guard against ended campaigns in submitPlan */
const rtAnchor1 = [
  "  function submitPlan() {",
  "    var ns = readNamespace();",
  "    var camp = ns.activeCampaign;",
  "    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };",
  "",
  "    /* 校验 assignments 合法 */"
].join('\n');
const rtNew1 = [
  "  function submitPlan() {",
  "    var ns = readNamespace();",
  "    var camp = ns.activeCampaign;",
  "    if (!camp || camp.phase !== 'planning') return { ok: false, reason: 'no-planning-phase' };",
  "    if (camp.phase === 'completed' || camp.phase === 'insolvent' || camp.phase === 'abandoned') {",
  "      return { ok: false, reason: 'campaign-ended', phase: camp.phase };",
  "    }",
  "",
  "    /* 校验 assignments 合法 */"
].join('\n');

if (rtContent.indexOf("reason: 'campaign-ended'") !== -1) {
  console.log('SKIP', RT_FILE, '— campaign-ended guard already present');
} else if (rtContent.indexOf(rtAnchor1) === -1) {
  console.error('ANCHOR 1 NOT FOUND in', RT_FILE);
  process.exit(1);
} else {
  rtContent = rtContent.replace(rtAnchor1, rtNew1);
  console.log('PATCH', RT_FILE, '— added campaign-ended guard');
}

/* 1b. Enhanced submitPlan return value */
const rtAnchor2 = [
  "    emit('fleet_round_settled', {",
  "      round: roundResult.round,",
  "      campaignId: camp.campaignId,",
  "      assignments: Object.assign({}, camp.assignments),",
  "      voyageIncome: roundResult.voyageIncome,",
  "      cargoLoss: roundResult.cargoLoss,",
  "      reserveUsed: roundResult.reserveUsed,",
  "      operatingCashAfter: roundResult.operatingCashAfter,",
  "      reserveAfter: roundResult.reserveAfter,",
  "      insolvent: roundResult.insolvent",
  "    });",
  "",
  "    return { ok: true, roundResult: roundResult, campaign: camp };"
].join('\n');
const rtNew2 = [
  "    emit('fleet_round_settled', {",
  "      round: roundResult.round,",
  "      campaignId: camp.campaignId,",
  "      assignments: Object.assign({}, camp.assignments),",
  "      voyageIncome: roundResult.voyageIncome,",
  "      cargoLoss: roundResult.cargoLoss,",
  "      reserveUsed: roundResult.reserveUsed,",
  "      operatingCashAfter: roundResult.operatingCashAfter,",
  "      reserveAfter: roundResult.reserveAfter,",
  "      insolvent: roundResult.insolvent",
  "    });",
  "",
  "    return {",
  "      ok: true,",
  "      isFinal: camp.phase === 'completed' || camp.phase === 'insolvent',",
  "      phase: camp.phase,",
  "      round: roundResult.round,",
  "      result: roundResult,",
  "      campaign: camp",
  "    };"
].join('\n');

if (rtContent.indexOf('isFinal:') !== -1) {
  console.log('SKIP', RT_FILE, '— enhanced return already present');
} else if (rtContent.indexOf(rtAnchor2) === -1) {
  console.error('ANCHOR 2 NOT FOUND in', RT_FILE);
  process.exit(1);
} else {
  rtContent = rtContent.replace(rtAnchor2, rtNew2);
  console.log('PATCH', RT_FILE, '— enhanced submitPlan return');
}

/* 1c. Add archiveActiveCampaign function and wire startCampaign */
const rtAnchor3 = [
  "  function countStorms(rounds) {",
  "    var count = 0;"
].join('\n');
const rtNew3 = [
  "  function archiveActiveCampaign() {",
  "    var ns = readNamespace();",
  "    var camp = ns.activeCampaign;",
  "    if (!camp) return { ok: false, reason: 'no-active-campaign' };",
  "    if (camp.phase !== 'completed' \u0026\u0026 camp.phase !== 'insolvent' \u0026\u0026 camp.phase !== 'abandoned') {",
  "      return { ok: false, reason: 'campaign-not-ended', phase: camp.phase };",
  "    }",
  "    var archived = {",
  "      campaignId: camp.campaignId,",
  "      seed: camp.seed,",
  "      outcome: camp.phase,",
  "      totalRounds: camp.totalRounds,",
  "      roundsSettled: camp.rounds.length,",
  "      finalOperatingCash: camp.operatingCash,",
  "      finalReserve: camp.reserve,",
  "      finalTotalFunds: Math.round((camp.operatingCash + camp.reserve) * 100) / 100,",
  "      stormsEncountered: countStorms(camp.rounds),",
  "      totalCargoLoss: sumCargoLoss(camp.rounds),",
  "      completedAt: nowISO()",
  "    };",
  "    ns.archivedCampaigns.push(archived);",
  "    ns.activeCampaign = null;",
  "    writeNamespace(ns);",
  "    return { ok: true, archived: archived };",
  "  }",
  "",
  "  function countStorms(rounds) {",
  "    var count = 0;"
].join('\n');

if (rtContent.indexOf('function archiveActiveCampaign') !== -1) {
  console.log('SKIP', RT_FILE, '— archiveActiveCampaign already present');
} else if (rtContent.indexOf(rtAnchor3) === -1) {
  console.error('ANCHOR 3 NOT FOUND in', RT_FILE);
  process.exit(1);
} else {
  rtContent = rtContent.replace(rtAnchor3, rtNew3);
  console.log('PATCH', RT_FILE, '— added archiveActiveCampaign');
}

/* 1d. Modify startCampaign to archive completed/insolvent before starting new */
const rtAnchor4 = [
  "    /* 有非 completed/insolvent/abandoned 的 campaign 时拒绝 */",
  "    if (camp && camp.phase !== 'completed' && camp.phase !== 'insolvent') {",
  "      return { ok: false, reason: 'campaign-in-progress', campaign: camp };",
  "    }"
].join('\n');
const rtNew4 = [
  "    /* 有 completed/insolvent campaign 时先归档 */",
  "    if (camp && (camp.phase === 'completed' || camp.phase === 'insolvent')) {",
  "      archiveActiveCampaign();",
  "    }",
  "",
  "    /* 有非 completed/insolvent/abandoned 的 campaign 时拒绝 */",
  "    if (camp && camp.phase !== 'completed' && camp.phase !== 'insolvent') {",
  "      return { ok: false, reason: 'campaign-in-progress', campaign: camp };",
  "    }"
].join('\n');

if (rtContent.indexOf('/* 有 completed/insolvent campaign 时先归档 */') !== -1) {
  console.log('SKIP', RT_FILE, '— startCampaign archive already present');
} else if (rtContent.indexOf(rtAnchor4) === -1) {
  console.error('ANCHOR 4 NOT FOUND in', RT_FILE);
  process.exit(1);
} else {
  rtContent = rtContent.replace(rtAnchor4, rtNew4);
  console.log('PATCH', RT_FILE, '— wired startCampaign archive');
}

/* 1e. Export archiveActiveCampaign */
const rtAnchor5 = [
  "  global.FleetRuntime = Object.freeze({",
  "    startCampaign: startCampaign,",
  "    getCampaign: getCampaign,",
  "    setAssignment: setAssignment,",
  "    setReserve: setReserve,",
  "    setReinsurance: setReinsurance,",
  "    getExpected: getExpected,",
  "    submitPlan: submitPlan,",
  "    abandonCampaign: abandonCampaign,",
  "    listArchived: listArchived",
  "  });"
].join('\n');
const rtNew5 = [
  "  global.FleetRuntime = Object.freeze({",
  "    startCampaign: startCampaign,",
  "    getCampaign: getCampaign,",
  "    setAssignment: setAssignment,",
  "    setReserve: setReserve,",
  "    setReinsurance: setReinsurance,",
  "    getExpected: getExpected,",
  "    submitPlan: submitPlan,",
  "    abandonCampaign: abandonCampaign,",
  "    archiveActiveCampaign: archiveActiveCampaign,",
  "    listArchived: listArchived",
  "  });"
].join('\n');

if (rtContent.indexOf('archiveActiveCampaign: archiveActiveCampaign') !== -1) {
  console.log('SKIP', RT_FILE, '— archiveActiveCampaign export already present');
} else if (rtContent.indexOf(rtAnchor5) === -1) {
  console.error('ANCHOR 5 NOT FOUND in', RT_FILE);
  process.exit(1);
} else {
  rtContent = rtContent.replace(rtAnchor5, rtNew5);
  console.log('PATCH', RT_FILE, '— exported archiveActiveCampaign');
}

writeFile(RT_FILE, rtContent);

/* ============================================================
 * 2. fleet-ui.js
 * ============================================================ */
const UI_FILE = 'fleet-ui.js';
let uiContent = readFile(UI_FILE);

/* 2a. Always show result view after submit (not summary directly) */
const uiAnchor1 = [
  "    var submitBtn = panelBody.querySelector('[data-action=\"submit\"]');",
  "    if (submitBtn) submitBtn.addEventListener('click', function() {",
  "      showConfirmDialog('提交方案', '确认提交本轮方案并结算？提交后不可修改。', function() {",
  "        var result = runtime().submitPlan();",
  "        if (result.ok) {",
  "          var newCamp = runtime().getCampaign();",
  "          if (newCamp.phase === 'completed' || newCamp.phase === 'insolvent') {",
  "            currentView = 'summary';",
  "          } else {",
  "            currentView = 'result';",
  "          }",
  "          render();",
  "        }",
  "      });",
  "    });"
].join('\n');
const uiNew1 = [
  "    var submitBtn = panelBody.querySelector('[data-action=\"submit\"]');",
  "    if (submitBtn) submitBtn.addEventListener('click', function() {",
  "      showConfirmDialog('提交方案', '确认提交本轮方案并结算？提交后不可修改。', function() {",
  "        var result = runtime().submitPlan();",
  "        if (result.ok) {",
  "          currentView = 'result';",
  "          render();",
  "        } else {",
  "          showToast(result.reason || '结算失败');",
  "        }",
  "      });",
  "    });"
].join('\n');

if (uiContent.indexOf("currentView = 'result';\n          render();") !== -1 &&
    uiContent.indexOf("showToast(result.reason") !== -1) {
  console.log('SKIP', UI_FILE, '— submit handler already patched');
} else if (uiContent.indexOf(uiAnchor1) === -1) {
  console.error('ANCHOR 1 NOT FOUND in', UI_FILE);
  process.exit(1);
} else {
  uiContent = uiContent.replace(uiAnchor1, uiNew1);
  console.log('PATCH', UI_FILE, '— submit handler routes to result view');
}

/* 2b. Result view buttons: show summary button when final */
const uiAnchor2 = [
  "    html += '<div class=\"fleet-actions\">';",
  "    if (camp.phase === 'planning') {",
  "      html += '<button class=\"fleet-btn primary\" data-action=\"next-round\">进入下一回合</button>';",
  "    }",
  "    html += '<button class=\"fleet-btn danger\" data-action=\"abandon-result\">放弃 campaign</button>';",
  "    html += '</div>';"
].join('\n');
const uiNew2 = [
  "    html += '<div class=\"fleet-actions\">';",
  "    if (camp.phase === 'completed' || camp.phase === 'insolvent') {",
  "      html += '<button class=\"fleet-btn primary\" data-action=\"show-summary\">查看终局总结</button>';",
  "    } else if (camp.phase === 'planning') {",
  "      html += '<button class=\"fleet-btn primary\" data-action=\"next-round\">进入下一回合</button>';",
  "    }",
  "    html += '<button class=\"fleet-btn danger\" data-action=\"abandon-result\">放弃 campaign</button>';",
  "    html += '</div>';"
].join('\n');

if (uiContent.indexOf("data-action=\"show-summary\"") !== -1) {
  console.log('SKIP', UI_FILE, '— result view final button already present');
} else if (uiContent.indexOf(uiAnchor2) === -1) {
  console.error('ANCHOR 2 NOT FOUND in', UI_FILE);
  process.exit(1);
} else {
  uiContent = uiContent.replace(uiAnchor2, uiNew2);
  console.log('PATCH', UI_FILE, '— result view shows summary button on final');
}

/* 2c. Bind show-summary button */
const uiAnchor3 = [
  "    var nextBtn = panelBody.querySelector('[data-action=\"next-round\"]');",
  "    if (nextBtn) nextBtn.addEventListener('click', function() {",
  "      currentView = 'planning';",
  "      render();",
  "    });",
  "    var abBtn = panelBody.querySelector('[data-action=\"abandon-result\"]');"
].join('\n');
const uiNew3 = [
  "    var nextBtn = panelBody.querySelector('[data-action=\"next-round\"]');",
  "    if (nextBtn) nextBtn.addEventListener('click', function() {",
  "      currentView = 'planning';",
  "      render();",
  "    });",
  "    var summaryBtn = panelBody.querySelector('[data-action=\"show-summary\"]');",
  "    if (summaryBtn) summaryBtn.addEventListener('click', function() {",
  "      currentView = 'summary';",
  "      render();",
  "    });",
  "    var abBtn = panelBody.querySelector('[data-action=\"abandon-result\"]');"
].join('\n');

if (uiContent.indexOf("var summaryBtn = panelBody.querySelector('[data-action=\"show-summary\"]');") !== -1) {
  console.log('SKIP', UI_FILE, '— show-summary binding already present');
} else if (uiContent.indexOf(uiAnchor3) === -1) {
  console.error('ANCHOR 3 NOT FOUND in', UI_FILE);
  process.exit(1);
} else {
  uiContent = uiContent.replace(uiAnchor3, uiNew3);
  console.log('PATCH', UI_FILE, '— bound show-summary button');
}

/* 2d. Add showToast helper after showConfirmDialog */
const uiAnchor4 = [
  "    dlg.querySelector('[data-dialog=\"cancel\"]').addEventListener('click', function() {",
  "      doc().body.removeChild(dlg);",
  "    });",
  "    dlg.querySelector('[data-dialog=\"confirm\"]').addEventListener('click', function() {",
  "      doc().body.removeChild(dlg);",
  "      onConfirm();",
  "    });",
  "  }"
].join('\n');
const uiNew4 = [
  "    dlg.querySelector('[data-dialog=\"cancel\"]').addEventListener('click', function() {",
  "      doc().body.removeChild(dlg);",
  "    });",
  "    dlg.querySelector('[data-dialog=\"confirm\"]').addEventListener('click', function() {",
  "      doc().body.removeChild(dlg);",
  "      onConfirm();",
  "    });",
  "  }",
  "",
  "  function showToast(message) {",
  "    var toast = doc().createElement('div');",
  "    toast.className = 'fleet-dialog-overlay';",
  "    toast.innerHTML = '<div class=\"fleet-dialog\">' +",
  "      '<h3>提示</h3>' +",
  "      '<p>' + message + '</p>' +",
  "      '<div class=\"fleet-dialog-actions\">' +",
  "      '<button class=\"fleet-btn primary\" data-dialog=\"ok\">确定</button>' +",
  "      '</div></div>';",
  "    doc().body.appendChild(toast);",
  "    toast.querySelector('[data-dialog=\"ok\"]').addEventListener('click', function() {",
  "      doc().body.removeChild(toast);",
  "    });",
  "  }"
].join('\n');

if (uiContent.indexOf('function showToast') !== -1) {
  console.log('SKIP', UI_FILE, '— showToast already present');
} else if (uiContent.indexOf(uiAnchor4) === -1) {
  console.error('ANCHOR 4 NOT FOUND in', UI_FILE);
  process.exit(1);
} else {
  uiContent = uiContent.replace(uiAnchor4, uiNew4);
  console.log('PATCH', UI_FILE, '— added showToast helper');
}

writeFile(UI_FILE, uiContent);

/* ============================================================
 * Syntax verification
 * ============================================================ */
console.log('\n--- Syntax Verification ---');
let ok = true;
ok = syntaxCheck(RT_FILE) && ok;
ok = syntaxCheck(UI_FILE) && ok;

if (!ok) {
  console.error('\n✗ Syntax errors detected');
  process.exit(1);
}

console.log('\n✓ All syntax checks passed');
