# 《概率世界》交接文档（2026-09-02）

> 给接手的 agent：先读本文件，再跑下方"基线验证"。文档是真相来源——不要重做已完成工作、不要重新嗅探已确认接口、不要重新架构。

## 项目一句话

「概率世界｜承保咖啡馆港口探索」：1687 年灰湾港的像素风概率教学游戏。Phaser 3（vendor/phaser.js）+ 原生 JS/DOM + localStorage。内部画布 480×270，约 1100 行单文件主线 `index.html` + 12 个小 JS 模块。`file://` 双击 index.html 即可玩（`打开浏览器.bat` 起 server.cjs:4173）。

现有玩法：**承保咖啡馆**（逆向选择/赢家诅咒教学）+ **风闻局**（羊群/信息瀑布教学）+ 任务/成就/称号/背包/时间·AP/存档。
规划中（**未开始**）：造船厂质检房、商会船队风险盘。近期所有工作 = 为这两个新玩法清路。

## 关键文件

- `index.html` — 主线单文件：PixelHarborScene class（场景/精灵/NPC 注册/承保桌/风闻 UI）、HarborLife（NPC 日程/时间/背包/存档渲染）、内联全部游戏 CSS
- `game-store.js` — 存档单一事实来源（重写版，147 行，键 `probability-world-save-v1`）
- `captain-dialogue-linear.js` — 船长对话**实际生效版**（v2 已删）
- `unposted-ship-news.js` — 船讯对话流；NPC 钉死逻辑已限制在承保咖啡馆
- `eve-lore.js` / `player-profile.js` / `achievement-*.js` / `quest-*.js` / `reward-service.js` / `task-ui.js` / `game-event-bus.js` 等小模块
- `scripts/test-*.js` — 5 套回归测试（共 127 项，见下；2026-09-02 实测复核）
- `docs/reference/` — 像素参考图（勿删）

## Commit 链（master，工作区干净）

| commit | 内容 |
|---|---|
| `84253be` | baseline：清理前快照 |
| `6e29e6a` | phase1 删死代码/调试残留（captain-dialogue-v2.js、测试按钮、旧 CSS） |
| `095b2e8` | phase3 存档读写对齐单一来源（旧键一次性迁移后删除） |
| `249188b` | 剧情/对话进度持久化（world.storyState） |
| `bbb4b51` | phase2 风闻局状态机收敛（每方法一份定义，删 v1/v1.1/v2 鬼层） |
| `82de22a` | phase4 interact 四层包装收敛为 NpcFlowRegistry 表单点分发 |
| `868b00b` | NPC 场景钉死限定在承保咖啡馆室内（unposted 加 isCafeScene gate） |
| `c68be06` | **HEAD** HarborLife NPC 日程加场景维度（interior 日程仅作用于承保咖啡馆） |

## 刚完成（c68be06）的机制要点——勿破坏

- NPC 状态/日程的 `mapId` 只有与**当前场景精确匹配**才生效（移动/可见/交互点），匹配函数 `npcMapMatches(mapId, s)`：
  `street`→街道；`interior`→仅承保咖啡馆（`sceneId==='castle_cafe'` 或底图 `cafe-interior` 兜底）；其他 mapId→同名 location（未来场景自注册路径）
- 场景对象现带 `sceneId`：街道='street'，承保咖啡馆='castle_cafe'（在各自 setter 内设置，**别再给 setInteriorScene 叠包装**）
- NPC 目标仍由 HarborLife `schedules` 表驱动（lloyd/xiaolei × 上午/下午/黄昏/夜晚，interior=咖啡馆、street=街道）；`ensureNpcState` 每次调用重建 npcStates 对象（测试别持有旧引用）
- 咖啡馆 lloyd/xiaolei 的"始终在场"由 unposted-ship-news.js 的 pin 保证（仅咖啡馆生效）

## 测试（全部在 Node 跑，无需浏览器）

```bash
node scripts/test-store.js            # 存档 27 项
node scripts/test-story-state.js      # 剧情持久化 17 项
node scripts/test-rumor-flow.js       # 风闻局 38 项
node scripts/test-npc-scene-scope.js  # unposted 咖啡馆门 13 项
node scripts/test-npc-schedule-scene.js # 日程场景维度 32 项（最新）

> 2026-09-02 复核：5 套共 127 项全绿（0 FAIL）。原文档写 37/28 系笔误，已按实测校准。
```

改 index.html 内联脚本后：提取 `<script>` 块逐一 `node --check`。写代码改动要求：**只写 Node.js 精确补丁脚本**（次数断言 + 写入后立即回读），不用 apply_patch/PowerShell 大段替换。

## 硬约束（红线）

1. **不改 GameStore schema、存档字段、GameEventBus 白名单、任务/成就/称号、承保玩法、风闻局**——除非用户明确批准
2. **不读取/恢复 `worldFlags.captain*`；不处理剧情完成事实分裂**（captainEvent.completed vs captainDialogueLinear.done 分裂已知，被用户搁置）
3. 不建立船只注册表、不开新玩法开发（质检房/风险盘 UI 未获批前不做）
4. 场景 NPC 注册/渲染是场景自己的职责（`createIndoorSprites`/`lifeNpcSprites`）；HarborLife 不创建精灵实例
5. 新室内场景**不要复用 `setInteriorScene`**（它整体重建咖啡馆专属 interactables + 精灵），需独立 setter
6. 本机 git 身份：`git -c user.name="Cris" -c user.email="cris@local" commit ...`；bash 是 git-bash/MSYS（路径用 C:/ 风格）；HTTP 冒烟用端口 4173

## 已知遗留（仅记录，未处理——按用户指示）

1. `spawnPoint(mapId)` 非 street 一律 {240,220}（咖啡馆出生点）——未来室内需扩展
2. `schedules` 表 = 每 NPC 每时段单一归属场景；如需同时段多场景需改结构
3. interact 的室内 door 目前只有 `kind:'cafe-door'`；新室内入口需加自己的 door 类型
4. 承保局完整合同/赔付明细不落盘（仅摘要 ledger）；船长完成度三处分裂——均待产品决策

## 待用户真人验收（c68be06，我没跑真浏览器）

A. 港口街道四时段进出 → 老板/小蕾按日程出现（下午/黄昏在街）；B. 承保咖啡馆 → 老板原位、小蕾在、承保桌可开可结、往返街道 ≥3 次无重复/漂移；C. 刷新后复查 + 任务/成就/背包/货币/存档无变化。若你在真实浏览器做改动后回归，按 A/B/C 执行即可。

## 下一步候选（等用户指令，勿自作主张）

- 用户提到过：质检房（`player.shipyard`）、风险盘（`player.fleet`）、档案馆、商店——都要先过产品决策
- 任何新玩法前：给 GameEventBus 白名单加事件（如 `inspection_recorded`/`fleet_assessed`）需用户批准 schema 变更
