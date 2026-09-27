# 精灵图生产管线（qwen-image → 游戏可用横向精灵图）

给 dsh-vs-game 造角色/道具素材的固定流程。两个脚本 + 一套参数约定，避免每次重新踩坑。

## 0. 依赖

- Node 18+（用全局 `fetch`）
- Python 3 + `pillow` / `numpy` / `scipy`
- DashScope API Key：放环境变量 `DASHSCOPE_API_KEY`（推荐），或放在仓库外的文件里（脚本默认读 `E:/DSH/1.txt` 里以 `sk-` 开头的那一行）。
  **任何情况下都不要把 key 写进仓库。**

## 1. 出图

```bash
node scripts/qwen-sprite.mjs \
  --ref 参考图.png \
  --prompt 提示词.txt \
  --out 出图.png \
  --size 2048*512        # 4 格 512，默认值
```

- 接口：`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`（**同步**，
  一张 25~55 秒）。`model=qwen-image-3.0`（`QWEN_MODEL` 可覆盖）。
- 图生图：`--ref` 传参考图（base64），提示词里描述要画什么。
- 注意：异步接口（`X-DashScope-Async: enable`）当前账号**不支持**（403），别走那条路。
- `--bg green`（默认）会自动给提示词追加「纯霓虹绿背景（chroma key green）」的要求。

### 提示词模板（角色动作条）

```
参考图中的<角色描述>，画<要什么：迷你分身 / 攻击动作 …>：<外形要点>。
输出横向精灵图：同一个角色排成 N 个等距的<动作>关键帧，<朝向要求，例如"全部侧身朝右，不要背面和正面">。
N 个角色大小完全一致、脚底对齐在同一条水平线上、左右间距均匀；每个角色居中在自己那一格里，
上下左右都留出空白，不要贴到画面边缘。
背景必须是纯正的霓虹绿色（chroma key green，接近 #00B140）……
角色高度约占格子高度的 55%（在游戏画布里就会显得比主角小一圈）。
```

## 2. 抠图 + 切分

```bash
python scripts/sprite-build.py 出图.png assets/xxx/walk.png --frames 4 --mode green
python scripts/sprite-build.py 出图.png assets/xxx/carry.png --frames 1 --mode none --index 0
```

| 参数 | 说明 |
|---|---|
| `--frames N` | 源图横排几格（等分） |
| `--index i` | 只导出第 i 格（单帧状态用） |
| `--mode green` | 色度键抠霓虹绿（推荐）：G 明显高于 R/B 判为背景，边缘软过渡 + 去绿溢 |
| `--mode white` | 只去掉与四边连通的纯白 —— 白底图用，能保住角色内部的白（围裙/头饰） |
| `--mode none` | 图里已经有 alpha（手工抠好的），只做切分与对齐 |
| `--height 155` | 角色在单帧画布里的高度 |
| `--baseline 232` | 脚底对齐到画布第几行 |
| `--canvas 256` | 单帧画布尺寸（游戏里 `drawSprite` 按正方形缩放） |

**同一个角色的所有状态必须用同一组 `--height / --baseline / --canvas`**，否则动起来会忽大忽小、脚底跳。

## 3. 踩坑清单

1. 模型返回的是 **JPEG**（没有 alpha 通道），不管什么背景都必须抠一遍。
2. 白底抠图会误伤围裙/头饰的白 → 所以**优先绿底**（用户 2026 建议，已设为默认）。
3. 输出最大边 **2048** → 一条横向精灵图最多 4 格 512。想要更多动作得分成多张，但**每次生成都会重画角色**
   （细节、配色会漂移），所以同一角色的多个动作尽量塞进同一张图（例如 3 帧走路 + 1 帧抱东西 = 正好 4 格）。
4. 提示词里要写死**朝向**（"全部侧身朝左"）；不写就会混进正面/背面帧。
5. 游戏侧 `whale-girl` 素材默认朝左，`drawSprite` 按 `flip` 镜像；新角色沿用"朝左"最省事。
6. 素材放 `assets/<角色>/`，经 `/vs-game/assets/*` 路由直接访问（支持子目录），改完记得同步安装副本。
