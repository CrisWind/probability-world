/* Stable future platform boundary. This build never performs network I/O. */
(function (global) {
  function onQuestCompleted(input) {
    if (!input || !input.questId || !input.completedAt) return { success: false, reason: 'invalid_completion' };
    console.info('[LearningAdapter] quest completed', { questId: input.questId, outcomeId: input.outcomeId || null, completedAt: input.completedAt });
    return { success: true, deferred: true };
  }
  /* G3 learning-evidence pass-through boundary：只校验结构并本地记录，永不发起网络 IO；deferred 留给未来平台层。 */
  var EXTRA_KEYS = ['sourceRefs', 'actions', 'resultRefs'];
  function onLearningEvidence(input) {
    if (!input || !input.conceptId || !input.state || !input.context) return { success: false, reason: 'invalid_evidence' };
    var payload = { conceptId: input.conceptId, state: input.state, context: input.context };
    for (var i = 0; i < EXTRA_KEYS.length; i++) {
      var k = EXTRA_KEYS[i];
      if (input[k] !== undefined) payload[k] = input[k];
    }
    console.info('[LearningAdapter] learning evidence', Object.assign({ receivedAt: new Date().toISOString() }, payload));
    return { success: true, deferred: true };
  }
  global.LearningAdapter = Object.freeze({ onQuestCompleted: onQuestCompleted, onLearningEvidence: onLearningEvidence });
})(window);
