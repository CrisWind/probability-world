(function (global) {
  var store = global.__gameStore;
  function grantQuestRewards(input) {
    var rewards = input && input.rewards;
    if (!Array.isArray(rewards) || !rewards.length) return { success: false, reason: '任务奖励配置无效', grantedRewardIds: [] };
    var state = store.getState(); var player = JSON.parse(JSON.stringify(state.player)); var cards = JSON.parse(JSON.stringify(state.cards)); var ids = [];
    for (var i = 0; i < rewards.length; i++) {
      var reward = rewards[i];
      if (!reward || !reward.id) return { success: false, reason: '奖励配置不完整', grantedRewardIds: [] };
      if (reward.type === 'coins' && Number.isFinite(reward.amount) && reward.amount >= 0) player.coins = (player.coins || 0) + reward.amount;
      else if (reward.type === 'lore_card' && reward.cardId) { cards.seen = cards.seen || {}; cards.library = Array.isArray(cards.library) ? cards.library : []; cards.seen[reward.cardId] = true; if (!cards.library.includes(reward.cardId)) cards.library.push(reward.cardId); }
      else return { success: false, reason: '暂不支持该任务奖励', grantedRewardIds: [] };
      ids.push(reward.id);
    }
    return { success: true, grantedRewardIds: ids, state: { player: player, cards: cards } };
  }
  global.RewardService = Object.freeze({ grantQuestRewards: grantQuestRewards });
})(window);
