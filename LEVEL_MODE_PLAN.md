# 关卡模式开发计划（共识已确认版）

> 定位：半公开解压爽游。可复刷、不限资源、无稀缺焦虑。
> 双模式并存：**无尽模式（保留）= 金币本**；**关卡模式（新增）= 剧情主线**。
> 剧情文本由作者后续提供，引擎只留槽位。第 1 关通关展示
> `assets/image/dafeiyu-1.png`（透明抠图已就绪）。

## 已确认的设计决策（宪法）

| 决策 | 结论 |
|---|---|
| 地图 | 大地图 + 镜头跟随；主干道 + 死路岔湾藏宝 |
| 宝箱 | 预置于地图点位，走近按 **F** 开启，内容物自动拾取入包 |
| 过关 | 走到尽头进 Boss 圈 → 击杀 Boss = 通关；顺序解锁；**复刷全掉落** |
| 结算 | 三张背面卡：免费翻 1 → 金币加翻 1（可跳过）→ 全部揭晓 |
| 翻卡池 | 饰品 / 技能书残页 / 稀有材料（第一期先上 金币大奖+饰品+临时强化 三类的原则作废，按用户素材：先放 饰品+材料条+法阵(残页载体)） |
| 经验 | 怪直接掉；DSH 工作事件 = 局内惊喜增益（怪潮/双倍经验/精英乱入），不再是结算触发器 |
| 饰品 | 宝箱+翻卡掉落；穿戴/属性/打造 = 后续期；面板 4 槽文案"副本掉落·敬请期待" |
| 金币 | 来源：无尽结算+关卡复刷+开箱；消耗：翻卡加翻+被动升级；独立抽奖界面挂起 |
| 剧情敌人 | 永远是"逼上班/查岗/否定劳动"的东西，用户本尊不登场 |

## 素材映射（assets/items/mv/manifest.json，30 块已裁切）

- 地图宝箱：`chest-gold`（关底大箱）/ `chest-blue`（岔湾普通箱）/ `tent`（木箱变体）
- 饰品底版：12 个 `acc-*`（奖章×3、戒指盒、圣杯、鲁特琴、长笛、号角、盾、靴、独角兽×2、海螺）
- 材料：`mat-ingot-*` 6 色金条、`mat-bundle`、`mat-coinpile`、`mat-scroll`（残页）
- 合成/法阵：`rune-purple/blue/red`
- 工具/礼包：`tool-pick`、`box-gift`
- 通关插画：`assets/image/dafeiyu-1.png`（第 1 章 post 卡）

## 阶段

### P0 · 相机与大地图（纯引擎，无尽回归不变）
- 世界坐标系统：世界尺寸每关定义（无尽=现状单屏 840×520 保持 1:1 行为）
- 相机：`cam = clamp(player - view/2)`，渲染时 `translate(-cam)`；震屏在相机之上
- 实体世界边界裁剪/回收改按"视口+边距"判定；边缘刷怪改为"屏幕外圈"生成
- HUD 小地图/罗盘：显示 Boss 圈与未开宝箱方向（岔湾防迷路）
- 验收：无尽模式手感与现在完全一致（回归）；把测试图临时撑到 2000×1500 能滚动

### P1 · 关卡数据表与选关 UI
- `lib/levels.js`（client 内联副本，同 protocol 双份模式）：
  `{ id, name, world:{w,h}, theme, monsterPool, chestSpawns:[{x,y,tier}], boss:{type,hp,x,y,radius}, story:{pre,bossQuip,post,art?}, unlockSeq }`
- host 持久化 global 新增 `clearedLevels: string[]`（首通记录，复刷不锁）
- 主菜单：`开始游戏` 拆成 `上班去（关卡）` + `随便打打（无尽）`；选关列表卡片
- 验收：能看到两关卡片、锁定态、点击进关

### P2 · 宝箱与 F 交互
- 宝箱实体：待机动画（微浮动）、靠近 60px 提示"按 F"、F 按住 1s 开启（进度圈）
- 开箱：掉金币/材料 → 自动飞入拾取（沿用磁吸）；`rune-*`/`acc-*` 进背包
- client→host `open-chest` 消息：贵重掉落（饰品/残页）服务端入账防作弊，金币材料客户端直接算
- 验收：岔湾藏箱可找到、F 可开、包里有货

### P3 · Boss 圈与翻卡结算
- Boss 圈：走进半径 → 封锁圈外刷怪、Boss 血条常驻、弹幕战
- 击杀 → `phase:'bosskill'`：三张背面卡 UI（`card-flip`）→ 免费翻 1 → 金币加翻（`flip-extra`，价 300）→ 全部翻开揭晓 → 通关卡（`story.post` + 第 1 章挂 dafeiyu-1.png）
- 首通记录 clearedLevels + 金币结算（沿用 saveRun）
- 验收：完整第 1 章通关流

### P4 · 经验模型与联动改造
- 文件怪死亡直接掉 token 宝石（现状部分已有，去掉对 usage 的依赖）
- game-reducer：`assistant/message` 的 usage 不再进 pendingXp 结算链，改为
  `drop-xp`（小额即时）+ `buff chaos`（工作高峰期双倍）；`turn/end` 保留 `screen-nuke`（下班清场彩蛋）
- 无尽模式完全沿用现状（它仍可以走 token 结算，作为金币本）
- 验收：不跑任何 DSH 任务，关卡内也能正常升级

### P5 · 剧情卡管线
- 进本卡：`story.pre` 文字 + 可选 `story.artPre` 图（槽位先给，文本作者补）
- Boss 战前：屏幕中央一行狠话（`story.bossQuip`，打字机效果 1.2s）
- 图规格：场景 16:9 `assets/story/<id>-pre.png`，资源路由已支持子目录

### P6 · 接驳与技术债
- 无尽入口文案改「金币本 · 随便打打」；金币用途提示
- fireBolt 进化连射 setTimeout → 改为 tick 内计时队列（修卸载泄漏）
- 元进度最小单测：UPGRADE_PASSIVE 扣款/封顶、OPEN_ITEM 幂等、翻卡加翻扣款

## 铁律（工程）
- client.js 仍是零构建 ModuleLoader 形态；React 从外壳 require；children 走 props.children
- 数据表双份（lib/*.js + client 内联）改动必须同步——改在 host 的数据走 WS 下发优先
- 每阶段结束：node --check + node --test + 模拟冒烟（stub 引擎跑帧）+ 提交推送，重启验收由用户执行
