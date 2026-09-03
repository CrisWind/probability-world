/* 概率世界 · 造船厂质检房 V0.1 —— 集中参数配置
 * 所有数值只允许在这里调整；UI 点击逻辑与运行时不得散落硬编码参数。
 * 本阶段只注册固定测试船「曙光号」，不接入承保/风闻的随机船名生成。 */
(function attachShipyardConfig(global) {
  'use strict';

  const SHIPYARD_CONFIG = Object.freeze({
    version: 1,

    /* 固定测试船。shipId 为未来船只注册表预留，本阶段只有这一条。 */
    testShip: Object.freeze({
      shipId: 'dawn-01',
      shipName: '曙光号',
      route: '灰湾—北岬',
      publicInfo: Object.freeze({
        materialBatch: '橡木 1686 年冬批，右舷中段曾临时更换旧板',
        schedulePressure: '明早第一潮必须出港，货主与船员都在等',
        inspectionBudget: '船东只愿意承担有限的检查开销',
        repairNotes: '公开维修说明：右舷中段木板昨夜临时更换，尚未做水密测试。'
      }),
      /* 重点抽查的线索：公开维修说明指向的部位区域。 */
      clue: Object.freeze({ zone: 'hull', text: '右舷船板' })
    }),

    /* 测试批次：缺陷落在哪些部位由 seeded RNG 按权重决定，位置不写死。 */
    batch: Object.freeze({
      totalParts: 24,
      zones: Object.freeze(['hull', 'rigging', 'deck', 'cargo']),
      zoneLabels: Object.freeze({ hull: '船体', rigging: '索具', deck: '甲板', cargo: '货舱' }),
      partsPerZone: 6,
      defectCount: 5,
      severityMix: Object.freeze({ major: 2, minor: 3 }),
      /* 隐藏缺陷偏向不易够到的船体——方便抽样只查甲板/货舱，存在系统性漏检。 */
      zoneWeights: Object.freeze({ hull: 0.4, rigging: 0.2, deck: 0.2, cargo: 0.2 })
    }),

    samplingMethods: Object.freeze({
      random: Object.freeze({
        label: '随机抽样',
        desc: '抽签决定检查哪些部位，每个部位机会均等。',
        zones: null // null = 全部区域
      }),
      convenient: Object.freeze({
        label: '方便抽样',
        desc: '只检查容易够到的甲板与货舱，省时省力——但够不到的地方不在样本里。',
        zones: Object.freeze(['deck', 'cargo'])
      }),
      targeted: Object.freeze({
        label: '重点抽查',
        desc: '顺着公开维修说明的线索，先查右舷船板；线索不对就会浪费检查机会。',
        zones: Object.freeze(['hull']),
        clueRequired: true
      })
    }),

    sampleSizes: Object.freeze({
      small: Object.freeze({ label: '小样本', n: 4, cost: 3, delay: 0, desc: '便宜，但结论很不稳定。' }),
      medium: Object.freeze({ label: '中样本', n: 8, cost: 6, delay: 30, desc: '多花些钱和船期，结论更稳。' }),
      large: Object.freeze({ label: '大样本', n: 14, cost: 12, delay: 60, desc: '最接近全检，但费钱也费船期。' })
    }),

    /* 逐部位抽样的单位成本与时间 */
    perPartCost: 1,
    perPartDelay: 5,

    /* 决策与代价。repairLevel: none/partial/full；hold 单独成行。 */
    decisions: Object.freeze({
      release: Object.freeze({ label: '直接放行', repairLevel: 'none', cost: 0, delay: 0, desc: '不再修理，按现状出航。' }),
      sample_more: Object.freeze({ label: '追加抽样', repairLevel: null, cost: 0, delay: 0, desc: '回到抽样台，再查一批部位。' }),
      repair_partial: Object.freeze({ label: '局部返修', repairLevel: 'partial', cost: 10, delay: 60, desc: '只修理样本中发现的缺陷；没抽到的部位原样出航。' }),
      repair_full: Object.freeze({ label: '全面返修', repairLevel: 'full', cost: 24, delay: 180, desc: '无论样本是否发现，整批翻新——钱花到位，缺陷清零。' }),
      hold: Object.freeze({ label: '暂停出航', repairLevel: 'hold', cost: 2, delay: 240, desc: '错过这一潮。船不会出事，船期代价最大。' })
    }),

    /* 错误放行后的事故风险：每处遗留缺陷独立判定。 */
    risk: Object.freeze({
      majorAccident: 0.35,
      minorAccident: 0.08
    }),

    /* 复盘展示用的币种与单位 */
    currency: '潮汐币'
  });

  global.SHIPYARD_CONFIG = SHIPYARD_CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
