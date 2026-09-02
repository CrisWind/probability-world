/* Stable future platform boundary. This build never performs network I/O. */
(function (global) {
  function onQuestCompleted(input) {
    if (!input || !input.questId || !input.completedAt) return { success: false, reason: 'invalid_completion' };
    console.info('[LearningAdapter] quest completed', { questId: input.questId, outcomeId: input.outcomeId || null, completedAt: input.completedAt });
    return { success: true, deferred: true };
  }
  global.LearningAdapter = Object.freeze({ onQuestCompleted: onQuestCompleted });
})(window);
