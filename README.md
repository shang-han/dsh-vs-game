# dsh-vs-game —— 工作中的大肥鱼

DeepSeek Harness (DSH) 的工作驱动解压小游戏插件。

> 文件是敌人，token 是经验，Agent 干活就是你变强的方式。

## 玩法

- 主角：大肥鱼，WASD / 方向键移动，武器全自动攻击
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
# 安装方式
dsh plugin --profile web add github:shang-han/dsh-vs-game

# 桌面版安装
dsh plugin --profile web-desktop add github:shang-han/dsh-vs-game
```

重启 DSH 后，界面右下角出现 🐟 按钮，或在会话里输入 `/vs` 切换面板。


## 兼容性 / Compatibility

- Node.js：`>=18`
- DSH：`>=0.2.1-rc.1`（已实测 `0.2.1-rc.3`；插件自动安装的 `@deepseek-ai/dsh-storage-domain` 用 `>=0.2.1-rc.1`，与 DSH 版本保持同一条线即可）
- 平台：DSH `web` / `web-desktop`，通过 `shell.overlay` 槽位渲染

## 权限 / Permissions

插件运行时会使用以下能力，均在 DSH 宿主进程内：

- 文件（files）
  - 只读读取插件包内 `assets/`，用于 tileset 与角色精灵图。
  - 通过 DSH storage domain 读写 `vs_game` 存档；不直接扫描用户文件系统。
- 网络（network）
  - 在 DSH 本地 web server 注册 `/vs-game/assets/*` 静态资源路由。
  - 注册 `/vs-game/ws` WebSocket，用于 host↔client 游戏消息。
  - 不主动访问外部网络服务。

## 依赖 / Dependencies

宿主（peerDependencies，由 DSH 进程提供）：

- `@deepseek-ai/cordis`
- `@deepseek-ai/dsh-home-paths`
- `@deepseek-ai/dsh-host-webserver`
- `@deepseek-ai/dsh-client-runtime`
- `@deepseek-ai/dsh-client-ui-slots`
- `react`

插件自己的运行时依赖（写在 `dependencies`，装插件时由 pnpm 自动安装）：

- `@deepseek-ai/dsh-storage-domain`（版本需与 DSH 对齐，当前 `0.2.1-rc.3`）
- `@deepseek-ai/schemastery`
- `zod`
- `ws`

> ⚠️ 如果你是**手动下载 ZIP 解压**后直接把目录指给 DSH，必须先在该目录执行一次 `pnpm install`（或改用插件管理器安装）。
> 否则 `lib/index.js` 里的 `@deepseek-ai/schemastery` / `@deepseek-ai/dsh-storage-domain` 会找不到，表现为「启用失败：Cannot find package '@deepseek-ai/schemastery'」或存档读不出来。

失败边界：WebSocket 或游戏渲染异常不会影响 DSH 宿主页面；客户端引擎渲染与逻辑异常会被捕获并降级。

## 安装 / 启动 / 卸载

安装：

```powershell
dsh plugin --profile web add github:shang-han/dsh-vs-game
dsh plugin --profile web-desktop add github:shang-han/dsh-vs-game
```

启动：重启 DSH 后，界面右下角出现 🐟 按钮，点击打开游戏；或在会话输入 `/vs`。

卸载：

```powershell
dsh plugin --profile web remove dsh-vs-game
dsh plugin --profile web-desktop remove dsh-vs-game
```

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
