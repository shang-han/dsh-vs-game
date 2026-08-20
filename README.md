# dsh-vs-game —— 工作中的大肥鱼

DeepSeek Harness (DSH) 的工作驱动解压小游戏插件（吸血鬼幸存者式玩法，主角是 DeepSeek 娘）。

> 文件是敌人，token 是经验，Agent 干活就是你变强的方式。

## 玩法

- 主角：DeepSeek 娘（鲸鱼娘形态），WASD / 方向键移动，武器全自动攻击
- 敌人：各种文件怪（`.ts` / `.py` / `.json` … 各有各的血量速度），精英和 Boss 会发射报错弹幕
- 经验：token 宝石 —— DSH 真实消耗的 token
- 与真实工作联动：
  - Agent 读写文件 → 刷出对应扩展名的文件怪
  - 模型回复 → 按 token 用量掉经验宝石
  - 回合结束 → 大回合出 Boss，小回合清场奖励
  - 工具报错 → 精英怪；审批等待 → 全场减速；用户中止 → 全屏清怪
- 没有任务跑时自动切换低频待机刷怪，随时可玩

## 安装

```powershell
# 从 GitHub 安装（本插件零构建，git 安装即用）
dsh plugin --profile web-desktop add github:shang-han/dsh-vs-game

# 或本地目录安装
dsh plugin --profile web-desktop add <本目录>
```

重启 DSH 后，界面右下角出现 🐟 按钮，或在会话里输入 `/vs` 切换面板。

## 开发

双半插件结构（同 dsh-pet）：

```
lib/index.js     host 半：资源路由 /vs-game/assets/* + WebSocket /vs-game/ws + /vs 命令
lib/client.js    client 半：ModuleLoader 形态，shell.overlay 槽位，Canvas 游戏引擎
lib/protocol.js  host↔client WS 消息协议（client 内有内联副本，改动需同步）
assets/          鲸鱼娘精灵图（whale-girl，见下方署名）
```

修改代码后需**重启 DSH 桌面应用**（client bundle 有 rev 缓存）。

## 许可与署名

- 插件代码：MIT
- 角色素材来自 [vlln/whale-girl](https://github.com/vlln/whale-girl)（MIT 许可）
  **画师：ZipZipPipe** —— 使用本插件即表示你已知悉该署名。
