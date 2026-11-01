# 第 6 章 · 真相之门（设计 / 实现说明）

> 关卡数据：`lib/levels/truth-gate.js`；引擎逻辑：`lib/client.js` 中「第 6 关 · 真相之门」段落（搜索 `dragonCfg`）。

## 流程

1. **入口**：列车长廊里第 2 关门口正下方的**紫色地毯**（未通关第 5 关会提示「等有 3600 万 token 的时候再过来吧」）。
2. **前段**：2600×1500 的「新建文件夹（2）」，8 组守门文件 + **5 个宝箱**（3 蓝 2 金）。
   - 5 个宝箱必须**全部打开**，走到最右侧门前的 `bossZone` 才会触发 Boss 房（`checkBossZone`）。
2. **门前厅**：900×560 的虚空大厅，无门框的门 / 裂纹 / 漂浮 token；进入后先播 `story.bossIntro`。
3. **正义 · 三段血**（每段 100,000）。

## 三段

| 阶段 | 行为 |
| --- | --- |
| phase 0 · 随便玩玩 | 站桩守门，每 2.2s 吐 5 发慢速扇形弹；玩家伤害 ×3 |
| phase 1 · 认真 | 封技能 + 封自动武器；播 `world.execute(me)`；弹幕跟音频 `currentTime` 的拍子（126 BPM，每 2 拍一波：环带缺口/扇形/螺旋/纵墙留缝/十字）+ 每 0.24s 四发背景流（玩家附近 64px 留缝）；底部横向轮盘常转；吃白饭停轮盘，滚到的武器/技能替换当前配置（武器 Lv5）；玩家伤害 ×6 |
| phase 2 · 逆位 | 龙娘坐下 → 9 句对话 → 起身、黑气（SVG 黑阴影 + 世界层黑烟 + 暗红色调）、无敌、6.5s 后处决玩家（必败） |

- 每段打完：血条清零 → **无敌 + 过场**（黑边/白闪/冲击环/标题「正义·认真 / 正义·逆位」）→ 对应对话 → 下一段。
- 背景色调：`dragonGate.tint` 三档，切换后 2.4s 交叉淡入。
- 三阶段玩家打不出伤害（`hurtEnemy` 直接显示「无敌」）。

## 死亡与循环

1. 被处决 → 0.9s 慢动作死亡 → **回到关卡开头**（世界/出生点复位，龙娘收走，血回满）。
2. 开头对话「……我刚刚 / 这里是—— / 新建文件夹（2）？」。
3. 再走到门前：不打了，`loopMeet` 对话（「这里是新建文件夹（2）。哦？看你的眼睛……」），龙娘留一碗白饭飞走。
4. 通关宝箱出现在门前厅，捡起 → 翻卡 + 首通奖励（`firstClearGold: 12000`）。

## 龙娘形象

- Coopanion 形象包（`assets/dragon/`，21.8 MB）由 `web` 侧动态 `import()`，挂在 `.dsh-vs-dragon-layer` 的 SVG 覆盖层上。
- `figure.draw()` 每 33ms 驱动一次；状态映射：phase0 neutral / phase1 determined / phase2 angry / 坐下 sad；`pose='sit'` 时 mode=sit；受击 `hitFlash` → brightness；逆位额外黑阴影。
- canvas 不再画 Boss 本体（`drawEnemies` 跳过 `e.dragon`），只画地面影子与阶段光效。

## 调参入口

| 想要的效果 | 改哪里 |
| --- | --- |
| 弹幕密度 | `dragonGate.bulletWaves` / 背景流间隔（`updateDragonBoss` 里 `0.24`） |
| 音乐节拍 | `dragonGate.bpm`（实测 126）；换歌时改 `bgm` |
| 打得太慢/太快 | `hurtEnemy` 里 `roll.dmg *= 3 / 6`；或 `boss.phaseHp` |
| 轮盘池 | `dragonGate.reelWeapons` / `reelSkills` |
| 白饭频率 | `updateDragonBoss` 里 `dragonRiceT >= 8.5` |
| 处决时间 | `dragonGate.executeAfter`（默认 6.5s） |
| 龙娘大小/位置 | `updateDragonView` 里 `290 * cssScale` 与 `sy - s*0.86` |

## 已知待办

- 精确到歌词段落的弹幕编排（目前只对齐拍子）。
- 门前厅/章节插画（`artPost` 暂无）。
- 实际游玩手感的数值确认（伤害倍率、弹速、血量）。
- 龙娘在不同窗口缩放下的位置需要实机确认。
