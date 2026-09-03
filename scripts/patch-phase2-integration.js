/* Phase 2 integration patch: quest + achievement integration for shipyard inspection.
 * Patches 4 files: quest-definitions.js, quest-runtime.js,
 * achievement-definitions.js, achievement-runtime.js.
 * Run: node scripts/patch-phase2-integration.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function patchFile(relPath, patches) {
  const abs = path.join(ROOT, relPath);
  const original = fs.readFileSync(abs, 'utf8');
  let content = original;
  for (const [label, anchor, replacement, marker] of patches) {
    if (marker && content.includes(marker)) {
      console.log('SKIP [' + relPath + '] already applied: ' + label);
      continue;
    }
    if (!content.includes(anchor)) {
      console.error('FAIL [' + relPath + '] anchor not found: ' + label);
      failures++;
      return false;
    }
    content = content.replace(anchor, replacement);
    console.log('OK   [' + relPath + '] ' + label);
  }
  if (content !== original) fs.writeFileSync(abs, content, 'utf8');
  return true;
}

function verifyFile(relPath) {
  const abs = path.join(ROOT, relPath);
  const content = fs.readFileSync(abs, 'utf8');
  const back = path.join(ROOT, relPath);
  // Read back and print the relevant region
  return content;
}

// ── 1. quest-definitions.js ────────────────────────────────────────────
patchFile('quest-definitions.js', [
  [
    'add quest cant_tear_down_all',
    "worldEffects:Object.freeze({ref:'quest_world_effects.unposted_ship_news'})\n    })\n  });",
    "worldEffects:Object.freeze({ref:'quest_world_effects.unposted_ship_news'})\n    }),\n    'quest.cant_tear_down_all':Object.freeze({\n      id:'quest.cant_tear_down_all',\n      type:'side',\n      title:'\u4e0d\u80fd\u5168\u62c6\u7684\u8239',\n      summary:'\u9020\u8239\u5382\u7684\u8d28\u68c0\u623f\u91cc\uff0c\u4e00\u6279\u65b0\u8239\u6b63\u7b49\u7740\u51fa\u822a\u3002\u4e5f\u8bb8\u8be5\u770b\u770b\u62bd\u6837\u5230\u5e95\u80fd\u53d1\u73b0\u4ec0\u4e48\u3002',\n      giverNpcId:null,\n      locationHint:'shipyard',\n      unlockWhen:Object.freeze({event:'scene_entered',sceneId:'shipyard'}),\n      activateWhen:Object.freeze({event:'inspection_started'}),\n      steps:Object.freeze([\n        Object.freeze({id:'inspect_a_ship',text:'\u5728\u8d28\u68c0\u623f\u5b8c\u6210\u4e00\u6b21\u8239\u8236\u68c0\u9a8c\u3002',completeWhen:Object.freeze({event:'inspection_completed'}),outcomeId:null})\n      ]),\n      rewards:Object.freeze([\n        Object.freeze({id:'coins_15',type:'coins',amount:15})\n      ]),\n      worldEffects:null\n    })\n  });",
    "'quest.cant_tear_down_all'"
  ]
]);

// ── 2. quest-runtime.js ────────────────────────────────────────────────
patchFile('quest-runtime.js', [
  [
    'add activateByEvent function',
    "  function activateAvailableQuest(definition, event) {",
    "  function activateByEvent(definition, event) {\n    var quests = getQuestState();\n    var instance = quests.instances[definition.id];\n    if (!instance || instance.status !== 'available') return false;\n    if (definition.type === 'main' && hasActiveMainQuest(quests.instances, definition.id)) return false;\n    instance.status = 'active';\n    instance.currentStepId = definition.steps[0] ? definition.steps[0].id : null;\n    instance.acceptedAt = event.at;\n    quests.trackedQuestId = definition.id;\n    commitQuestState(quests);\n    return true;\n  }\n\n  function activateAvailableQuest(definition, event) {",
    "function activateByEvent("
  ],
  [
    'add activateWhen support in handleEvent',
    "        if (instance.status === 'available' && event.type === 'npc_talked') {\n          activateAvailableQuest(definition, event);\n          return;\n        }",
    "        if (instance.status === 'available') {\n          if (definition.activateWhen && matchesCondition(definition.activateWhen, event)) {\n            activateByEvent(definition, event);\n            return;\n          }\n          if (event.type === 'npc_talked') {\n            activateAvailableQuest(definition, event);\n            return;\n          }\n        }",
    "definition.activateWhen && matchesCondition"
  ]
]);

// ── 3. achievement-definitions.js ──────────────────────────────────────
patchFile('achievement-definitions.js', [
  [
    'add achievement luck_not_quality',
    "groupId:null})\n});",
    "groupId:null}),\n  'achievement.luck_not_quality':freeze({id:'achievement.luck_not_quality',category:'restraint',title:'\u6ca1\u6709\u628a\u597d\u8fd0\u5f53\u8d28\u91cf',description:'\u62bd\u6837\u6ca1\u6709\u53d1\u73b0\u4efb\u4f55\u7f3a\u9677\uff0c\u5374\u4ecd\u7136\u9009\u62e9\u4e0d\u76f4\u63a5\u653e\u884c\u3002',visibility:'named_hidden',progressMode:'none',condition:freeze({type:'event_match',eventType:'inspection_completed',payload:freeze({defectsFound:0,decision:['repair_partial','repair_full','hold']})}),groupId:null})\n});",
    "achievement.luck_not_quality"
  ]
]);

// ── 4. achievement-runtime.js ──────────────────────────────────────────
patchFile('achievement-runtime.js', [
  [
    'extend payloadMatches for array values',
    "    return Object.keys(expected).every(function (key) {\n      return Object.prototype.hasOwnProperty.call(actual, key) && actual[key] === expected[key];\n    });",
    "    return Object.keys(expected).every(function (key) {\n      if (!Object.prototype.hasOwnProperty.call(actual, key)) return false;\n      if (Array.isArray(expected[key])) return expected[key].indexOf(actual[key]) !== -1;\n      return actual[key] === expected[key];\n    });",
    "Array.isArray(expected[key])"
  ],
  [
    'add inspection_completed subscription',
    "unsubscribers = [bus.on('choice_made', handleEvent), bus.on('quest_completed', handleEvent)];",
    "unsubscribers = [bus.on('choice_made', handleEvent), bus.on('quest_completed', handleEvent), bus.on('inspection_completed', handleEvent)];",
    "bus.on('inspection_completed', handleEvent)"
  ]
]);

// ── Summary ────────────────────────────────────────────────────────────
console.log('\n' + (failures === 0 ? 'All patches applied successfully.' : failures + ' patch(es) FAILED.'));
process.exit(failures === 0 ? 0 : 1);
