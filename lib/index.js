/**
 * ============================================================================
 * dsh-vs-game 宿主半侧（host half）
 * ============================================================================
 *
 * 职责：
 *   1. 静态资源路由 /vs-game/assets/*（鲸鱼娘精灵图 + manifest）
 *   2. WebSocket 端点 /vs-game/ws：把 DSH 工作事件归约成的"游戏燃料"
 *      广播给浏览器半侧（M3 接入 game-reducer；M1 先接通链路 + 空闲保底）
 *   3. /vs 人类命令：切换游戏面板显隐
 *   4. 追踪 lastActivity（最近一次真实工作事件的时间），用于空闲刷怪判定
 *
 * 生命周期：所有注册都包在 ctx.effect 里，卸载时自动清理。
 */
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import Schema from '@deepseek-ai/schemastery';
import { encodeMsg, decodeFrame, HostMsg, ClientMsg } from './protocol.js';
import { GameReducer } from './game-reducer.js';

// ─── 插件元数据 ────────────────────────────────────────────────────────────
const name = 'vs-game';
const inject = ['webServer'];

// ─── Config schema（cordis 加载时校验 patch 配置） ────────────────────────
export const Config = Schema.object({
  idleSpawnRate: Schema.number().min(1).max(60).default(3),
  autoPause: Schema.boolean().default(true),
});

// ─── 常量 ──────────────────────────────────────────────────────────────────
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ASSETS_ROOT = join(PACKAGE_ROOT, 'assets');
const ROUTE_PREFIX = '/vs-game';
const WS_PATH = '/vs-game/ws';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

/** 防路径穿越：规范化后必须仍在 root 内（同 dsh-pet 的 resolveAsset） */
function resolveAsset(root, rel) {
  if (rel.length === 0) return undefined;
  const candidate = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  return candidate;
}

// ─── 插件主体 ──────────────────────────────────────────────────────────────
function apply(ctx, config) {
  const logger = ctx.logger('vs-game');
  const reducer = new GameReducer();
  const cfg = { idleSpawnRate: 3, autoPause: true, ...config };
  const snapshot = () => ({
    lastActivity: reducer.lastActivity,
    totalTokens: Math.round(reducer.totalTokens),
    idle: reducer.isIdle(),
  });

  // WebSocket 服务（noServer：由 webServer 的 upgrade 路由喂连接）
  const wss = new WebSocketServer({ noServer: true });
  const broadcast = (msg) => {
    const text = encodeMsg(msg);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  };

  // ── 1. 静态资源路由 /vs-game/assets/* ──
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${ROUTE_PREFIX}/assets`,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const rest = decodeURIComponent(url.pathname.slice(`${ROUTE_PREFIX}/assets/`.length));
      const file = resolveAsset(ASSETS_ROOT, rest);
      if (file === undefined) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('dsh-vs-game: invalid path');
        return;
      }
      if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('dsh-vs-game: asset not found');
        return;
      }
      const dot = file.lastIndexOf('.');
      const contentType = MIME[dot >= 0 ? file.slice(dot).toLowerCase() : ''] ?? 'application/octet-stream';
      const { size } = await stat(file);
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': size,
        'cache-control': 'public, max-age=3600',
      });
      const stream = createReadStream(file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    },
  }), 'vs-game: asset route');

  // ── 2. WebSocket upgrade 路由 ──
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: WS_PATH,
    handler: (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    },
  }), 'vs-game: websocket route');

  // ── 3. 连接管理：hello 快照 + 客户端消息处理 ──
  ctx.effect(() => {
    const onConnection = (ws) => {
      ws.send(encodeMsg({
        kind: HostMsg.HELLO,
        snapshot: snapshot(),
        config: { idleSpawnRate: cfg.idleSpawnRate, autoPause: cfg.autoPause },
      }));
      ws.on('message', (data) => {
        for (const msg of decodeFrame(data.toString())) {
          handleClientMsg(ws, msg);
        }
      });
    };
    wss.on('connection', onConnection);
    return () => wss.off('connection', onConnection);
  }, 'vs-game: ws connection handling');

  function handleClientMsg(ws, msg) {
    switch (msg.kind) {
      case ClientMsg.GAME_START:
        logger.info('client started a game run');
        break;
      case ClientMsg.GAME_OVER:
        // M4：写入 storageDomain 持久化最高分/图鉴；M1 仅回执
        logger.info(`game over: score=${msg.score} kills=${msg.kills} duration=${Math.round(msg.duration ?? 0)}s level=${msg.level}`);
        ws.send(encodeMsg({ kind: HostMsg.SAVED, bestScore: msg.score ?? 0, totalKills: msg.kills ?? 0 }));
        break;
      case ClientMsg.HEARTBEAT:
        break;
      default:
        break;
    }
  }

  // ── 4. 监听 DSH 会话事件：追踪活动 + （M3）归约成游戏燃料 ──
  ctx.effect(() => {
    const off = ctx.on('session/event', (session, event) => {
      try {
        onSessionEvent(session, event);
      } catch (error) {
        // 事件解析永不炸：容错优先
        logger.warn('session/event handling error:', error);
      }
    });
    return () => { off?.(); };
  }, 'vs-game: session/event listener');

  function onSessionEvent(session, event) {
    // 纯 reducer 归约成燃料事件，直接广播给所有玩游戏的客户端
    for (const msg of reducer.handle(session, event)) {
      broadcast(msg);
    }
  }

  // 注：保底刷怪由 client 引擎自行管理（工作只是额外加怪，不让位），
  // host 不再广播 idle-spawn——该消息曾污染客户端的"工作活跃"判定。

  // ── 5. /vs 命令：切换面板 ──
  ctx.inject(['commands'], (cctx) => {
    cctx.effect(() => cctx.commands.register({
      name: 'vs',
      description: '打开/关闭「工作中的大肥鱼」游戏面板',
      recordInput: false,
      handler: () => {
        broadcast({ kind: HostMsg.TOGGLE_PANEL });
        return { kind: 'success', text: '🐟 游戏面板已切换（若未出现，请检查右下角入口按钮）' };
      },
    }), 'vs-game: /vs command');
  });
}

export { apply, inject, name };
