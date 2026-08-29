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
import { stat, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, normalize, sep, dirname, basename } from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import Schema from '@deepseek-ai/schemastery';
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { encodeMsg, decodeFrame, HostMsg, ClientMsg } from './protocol.js';
import { GameReducer } from './game-reducer.js';
import { LEVELS } from './levels/index.js';

// ─── 插件元数据 ────────────────────────────────────────────────────────────
const name = 'vs-game';
const inject = ['webServer'];

// ─── Config schema（cordis 加载时校验 patch 配置） ────────────────────────
export const Config = Schema.object({
  idleSpawnRate: Schema.number().min(1).max(60).default(3),
  autoPause: Schema.boolean().default(true),
  difficulty: Schema.union([
    Schema.const('easy'), Schema.const('normal'), Schema.const('hard'),
  ]).default('normal'),
});

// ─── 持久化 domain（最高分 / 累计统计 / 敌人图鉴 / 角色数据 / 历史成绩） ──
const WEAPON_TYPES = ['whip', 'bolt', 'orb', 'laser', 'mine', 'zap'];
const PASSIVE_TYPES = ['armor', 'regen', 'speed', 'might', 'haste', 'magnet'];
const DEFAULT_PASSIVES = Object.fromEntries(PASSIVE_TYPES.map((t) => [t, 0]));
export const DEFAULT_GLOBAL = {
  bestScore: 0,
  totalKills: 0,
  totalRuns: 0,
  discovered: [],
  gold: 0,
  initialWeapon: 'whip',
  passives: { ...DEFAULT_PASSIVES },
  inventory: ['newbie-gift', 'skill-book'],
  accessories: [null, null, null, null],
  activeSkill: null,
  giftOpened: false,
  skillBookUsed: false,
  initialDataReset: false,
  clearedLevels: [],
};
export function toCharacter(g) {
  return {
    gold: g.gold,
    initialWeapon: g.initialWeapon,
    passives: g.passives,
    inventory: g.inventory,
    accessories: g.accessories,
    activeSkill: g.activeSkill,
    clearedLevels: g.clearedLevels ?? [],
  };
}
export function passiveUpgradeCost(level) {
  return 100 * (Number(level) + 1);
}

// ── P3 翻卡计费规则（纯函数，可测试）：第 1 张免费，第 2 张付 FLIP_EXTRA_COST，之后拒 ──
export const FLIP_EXTRA_COST = 300;
export function flipCharge(pickedCount, cost = FLIP_EXTRA_COST) {
  if (pickedCount <= 0) return { gold: 0 };
  if (pickedCount === 1) return { gold: cost };
  return null;
}

/** 存档净化（纯函数，可测试）：清理演示残留、保证礼包/技能书状态自洽 */
export function sanitizeGlobal(g) {
  const unused = new Set(['potion-red', 'potion-blue', 'gem-ruby', 'gem-emerald']);
  g.inventory = g.inventory.filter((x) => !unused.has(x));
  if (!g.skillBookUsed && !g.inventory.includes('skill-book')) {
    g.inventory.push('skill-book');
  }
  if (!g.skillBookUsed) g.activeSkill = null;
  if (!g.giftOpened && !g.inventory.includes('newbie-gift')) {
    g.inventory.unshift('newbie-gift');
  }
  if (g.skillBookUsed) g.inventory = g.inventory.filter((x) => x !== 'skill-book');
  return g;
}

// ── P3 关底翻卡：奖池与发牌（服务端权威） ──
export const FLIP_ACC_POOL = ['acc-ring', 'acc-boots', 'acc-shield', 'acc-grail', 'acc-lute', 'acc-flute',
  'acc-horn', 'acc-unicorn-horn', 'acc-conch', 'acc-uni-head', 'acc-medal-red', 'acc-medal-blue', 'acc-medal-green'];
export const FLIP_MAT_POOL = ['mat-ingot-silver', 'mat-ingot-aqua', 'mat-ingot-blue', 'mat-ingot-purple', 'mat-ingot-rose', 'mat-ingot-green'];
export function rollFlipCards() {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const r = Math.random();
    if (r < 0.35) out.push({ kind: 'acc', item: FLIP_ACC_POOL[Math.floor(Math.random() * FLIP_ACC_POOL.length)] });
    else if (r < 0.65) out.push({ kind: 'mat', item: FLIP_MAT_POOL[Math.floor(Math.random() * FLIP_MAT_POOL.length)] });
    else out.push({ kind: 'gold', amount: 120 + Math.floor(Math.random() * 181) });
  }
  return out;
}
const vsGameDomain = defineDomain({
  name: 'vs_game',
  version: 1,
  tables: {
    scores: domainTable(z.object({
      score: z.number(),
      kills: z.number(),
      duration: z.number(),
      level: z.number(),
      at: z.string(),
    })),
  },
  global: {
    schema: z.object({
      bestScore: z.number(),
      totalKills: z.number(),
      totalRuns: z.number(),
      discovered: z.array(z.string()),
      gold: z.number().default(0),
      initialWeapon: z.string().default('whip'),
      passives: z.object({
        armor: z.number().default(0),
        regen: z.number().default(0),
        speed: z.number().default(0),
        might: z.number().default(0),
        haste: z.number().default(0),
        magnet: z.number().default(0),
      }).default({ ...DEFAULT_PASSIVES }),
      inventory: z.array(z.string()).default(['newbie-gift', 'skill-book']),
      accessories: z.array(z.union([z.string(), z.null()])).default([null, null, null, null]),
      activeSkill: z.union([z.string(), z.null()]).default(null),
      giftOpened: z.boolean().default(false),
      skillBookUsed: z.boolean().default(false),
      initialDataReset: z.boolean().default(false),
      clearedLevels: z.array(z.string()).default([]),
    }),
    initial: { ...DEFAULT_GLOBAL },
  },
});

// ─── 常量 ──────────────────────────────────────────────────────────────────
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// 从安装路径推导当前 profile：.../profiles/<profile>/node_modules/dsh-vs-game
const PROFILE_DIR = dirname(dirname(PACKAGE_ROOT));
const PROFILE_NAME = basename(PROFILE_DIR);
const ASSETS_ROOT = join(PACKAGE_ROOT, 'assets');
const ROUTE_PREFIX = '/vs-game';

/** 从 profile 的 pnpm-lock.yaml 读取当前已安装 dsh-vs-game 的 commit */
async function readCurrentCommit(profileDir) {
  try {
    const text = await readFile(join(profileDir, 'pnpm-lock.yaml'), 'utf8');
    const m = text.match(/dsh-vs-game@https:\/\/codeload\.github\.com\/shang-han\/dsh-vs-game\/tar\.gz\/([0-9a-f]{40})/);
    if (m) return m[1];
  } catch { /* 读取失败则视为未知 */ }
  return null;
}
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
  const cfg = { idleSpawnRate: 3, autoPause: true, difficulty: 'normal', ...config };
  // 异步就绪的持久化/设置句柄
  const persist = { domain: null, settingsScope: null };
  const readGlobal = () => sanitizeGlobal({
    ...DEFAULT_GLOBAL,
    ...(persist.domain ? persist.domain.global.get() ?? {} : {}),
  });
  const publicConfig = () => ({
    idleSpawnRate: persist.settingsScope ? persist.settingsScope.get().idleSpawnRate : cfg.idleSpawnRate,
    autoPause: persist.settingsScope ? persist.settingsScope.get().autoPause : cfg.autoPause,
    difficulty: persist.settingsScope ? persist.settingsScope.get().difficulty : cfg.difficulty,
  });
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
        config: publicConfig(),
        best: readGlobal().bestScore,
        discovered: readGlobal().discovered,
        character: toCharacter(readGlobal()),
        levels: LEVELS,
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

  function sendCharacter(ws, g) {
    ws.send(encodeMsg({ kind: HostMsg.CHARACTER, character: toCharacter(g) }));
  }

  async function mutateGlobal(fn) {
    if (!persist.domain) return readGlobal();
    const g = readGlobal();
    const next = fn({ ...g });
    await persist.domain.global.set(next);
    return next;
  }

  function handleClientMsg(ws, msg) {
    switch (msg.kind) {
      case ClientMsg.GAME_START:
        logger.info('client started a game run');
        break;
      case ClientMsg.GAME_OVER: {
        logger.info(`game over: score=${msg.score} kills=${msg.kills} duration=${Math.round(msg.duration ?? 0)}s level=${msg.level}`);
        saveRun(msg).then((g) => {
          ws.send(encodeMsg({
            kind: HostMsg.SAVED,
            bestScore: g.bestScore,
            totalKills: g.totalKills,
            discovered: g.discovered,
            character: toCharacter(g),
            goldEarned: g.goldEarned ?? 0,
          }));
        }).catch((e) => logger.warn('save run failed:', e));
        break;
      }
      case ClientMsg.SET_INITIAL_WEAPON: {
        if (!WEAPON_TYPES.includes(msg.weapon)) break;
        mutateGlobal((g) => ({ ...g, initialWeapon: msg.weapon }))
          .then((g) => sendCharacter(ws, g))
          .catch((e) => logger.warn('set initial weapon failed:', e));
        break;
      }
      case ClientMsg.UPGRADE_PASSIVE: {
        if (!PASSIVE_TYPES.includes(msg.passive)) break;
        mutateGlobal((g) => {
          const level = Number(g.passives[msg.passive]) || 0;
          const cost = passiveUpgradeCost(level);
          if (g.gold < cost || level >= 5) return g;
          return {
            ...g,
            gold: g.gold - cost,
            passives: { ...g.passives, [msg.passive]: level + 1 },
          };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('upgrade passive failed:', e));
        break;
      }
      case ClientMsg.OPEN_ITEM: {
        mutateGlobal((g) => {
          if (msg.item === 'newbie-gift' && g.inventory.includes('newbie-gift')) {
            return {
              ...g,
              gold: g.gold + 1000,
              inventory: g.inventory.filter((x) => x !== 'newbie-gift'),
              giftOpened: true,
            };
          }
          if (msg.item === 'skill-book' && g.inventory.includes('skill-book')) {
            return {
              ...g,
              activeSkill: 'strike',
              inventory: g.inventory.filter((x) => x !== 'skill-book'),
              skillBookUsed: true,
            };
          }
          return g;
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('open item failed:', e));
        break;
      }
      case ClientMsg.BOSS_KILL: {
        const levelId = typeof msg.levelId === 'string' ? msg.levelId : null;
        const lv = levelId ? LEVELS.find((x) => x.id === levelId) : null;
        if (!lv) break;
        const g0 = readGlobal();
        const firstClear = !(Array.isArray(g0.clearedLevels) && g0.clearedLevels.includes(levelId));
        const cards = rollFlipCards();
        ws._flip = { levelId, cards, picked: [], extraCost: FLIP_EXTRA_COST };
        const respond = () => ws.send(encodeMsg({
          kind: HostMsg.CARDS, cards, freeFlips: 1, extraCost: FLIP_EXTRA_COST, maxPicks: 2,
          firstClear, firstClearGold: firstClear ? (lv.firstClearGold ?? 200) : 0,
        }));
        if (firstClear) {
          mutateGlobal((g) => ({
            ...g,
            clearedLevels: [...new Set([...(g.clearedLevels ?? []), levelId])],
            gold: g.gold + (lv.firstClearGold ?? 200),
          }))
            .then((g) => { sendCharacter(ws, g); respond(); })
            .catch((e) => { logger.warn('first clear failed:', e); respond(); });
        } else {
          respond();
        }
        break;
      }
      case ClientMsg.FLIP_PICK: {
        const f = ws._flip;
        const i = Number(msg.index);
        if (!f || !Number.isInteger(i) || i < 0 || i >= f.cards.length) break;
        if (f.picked.includes(i)) break;
        const charge = flipCharge(f.picked.length, f.extraCost ?? FLIP_EXTRA_COST);
        if (!charge) break; // 超过 2 张上限
        if (charge.gold > 0 && readGlobal().gold < charge.gold) {
          ws.send(encodeMsg({ kind: HostMsg.CARD_RESULT, rejected: 'gold', index: i }));
          break;
        }
        f.picked.push(i);
        const card = f.cards[i];
        mutateGlobal((g) => {
          const next = { ...g };
          if (charge.gold > 0) next.gold = Math.max(0, next.gold - charge.gold);
          if (card.kind === 'gold') next.gold = next.gold + Math.min(500, Math.max(0, Number(card.amount) || 0));
          else if (typeof card.item === 'string' && /^(acc-|mat-|tool-)/.test(card.item)) next.inventory = [...next.inventory, card.item];
          return next;
        })
          .then((g) => ws.send(encodeMsg({ kind: HostMsg.CARD_RESULT, index: i, card, character: toCharacter(g) })))
          .catch((e) => logger.warn('flip pick failed:', e));
        break;
      }
      case ClientMsg.CHEST_LOOT: {
        // 宝箱开箱入账：金额钳制防异常，物品按 MV 前缀白名单进背包
        const gold = Math.max(0, Math.min(500, Number(msg.gold) || 0));
        const item = typeof msg.item === 'string' && /^(acc-|mat-|tool-)/.test(msg.item) ? msg.item : null;
        mutateGlobal((g) => ({
          ...g,
          gold: g.gold + gold,
          inventory: item ? [...g.inventory, item] : g.inventory,
        })).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('chest loot failed:', e));
        break;
      }
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

  // ── 5. 结算持久化：最高分 / 累计 / 图鉴 / 历史 ──
  async function saveRun(msg) {
    const score = Number(msg.score) || 0;
    const kills = Number(msg.kills) || 0;
    const duration = Number(msg.duration) || 0;
    const level = Number(msg.level) || 1;
    const discovered = Array.isArray(msg.discovered) ? msg.discovered.filter((x) => typeof x === 'string') : [];
    const goldEarned = Math.max(5, Math.floor(score / 10) + kills * 2 + Math.floor(duration / 10));
    if (!persist.domain) {
      const base = readGlobal();
      return {
        ...base,
        bestScore: Math.max(base.bestScore, score),
        gold: base.gold + goldEarned,
        goldEarned,
      };
    }
    const g = readGlobal();
    const persisted = {
      ...g,
      bestScore: Math.max(g.bestScore, score),
      totalKills: g.totalKills + kills,
      totalRuns: g.totalRuns + 1,
      discovered: [...new Set([...g.discovered, ...discovered])],
      gold: g.gold + goldEarned,
    };
    await persist.domain.global.set(persisted);
    const next = { ...persisted, goldEarned };
    // 历史成绩保留最近 50 局
    const key = 'run-' + Date.now().toString(36);
    await persist.domain.table('scores').put(key, {
      score, kills,
      duration,
      level,
      at: new Date().toISOString(),
    });
    const all = [...persist.domain.table('scores').keys()].sort();
    for (const old of all.slice(0, Math.max(0, all.length - 50))) {
      await persist.domain.table('scores').delete(old);
    }
    return next;
  }

  // ── 6. storageDomain 打开 ──
  ctx.inject(['storageDomain'], (sctx) => {
    sctx.effect(async function* () {
      const domain = await sctx.storageDomain.open(vsGameDomain);
      persist.domain = domain;
      // 一次性重置初始物品数据：新手礼包 + 技能书
      const g = readGlobal();
      if (!g.initialDataReset) {
        await domain.global.set({
          ...g,
          initialDataReset: true,
          inventory: ['newbie-gift', 'skill-book'],
          giftOpened: false,
          skillBookUsed: false,
          activeSkill: null,
        });
      }
      yield () => { persist.domain = null; domain.close(); };
    }, 'vs-game: storage domain');
  });

  // ── 7. 用户设置（settings namespace，实时下发客户端） ──
  ctx.inject(['settings'], (setctx) => {
    setctx.effect(() => {
      const scope = setctx.settings.register('dsh-vs-game', Config, {
        base: {
          idleSpawnRate: cfg.idleSpawnRate,
          autoPause: cfg.autoPause,
          difficulty: cfg.difficulty,
        },
      });
      persist.settingsScope = scope;
      const off = scope.watch((next) => {
        broadcast({ kind: HostMsg.CONFIG, config: next });
      });
      return () => { off?.(); persist.settingsScope = null; };
    }, 'vs-game: settings namespace');
  });

  // ── 8. 配置 HTTP 端点（client 读写设置的通道） ──
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/config`,
    handler: async (req, res) => {
      const sendJson = (obj, code = 200) => {
        const body = JSON.stringify(obj);
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
      };
      if (req.method === 'GET') {
        sendJson({ config: publicConfig(), best: readGlobal().bestScore, global: readGlobal() });
        return;
      }
      if (req.method === 'PATCH') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          try {
            const patch = JSON.parse(raw || '{}');
            if (persist.settingsScope) {
              persist.settingsScope.update(patch);
              sendJson({ ok: true, config: publicConfig() });
            } else {
              sendJson({ ok: false, error: 'settings not ready' }, 503);
            }
          } catch (e) {
            sendJson({ ok: false, error: String(e?.message ?? e) }, 400);
          }
        });
        return;
      }
      res.writeHead(405);
      res.end();
    },
  }), 'vs-game: config endpoint');

  // ── 8.5 更新检查与拉取 ├── 从 GitHub 拉最新 dsh-vs-game ──
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/update`,
    handler: async (req, res) => {
      const sendJson = (obj, code = 200) => {
        const body = JSON.stringify(obj);
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
      };
      if (req.method === 'GET') {
        try {
          const r = await fetch('https://api.github.com/repos/shang-han/dsh-vs-game/commits/main', {
            headers: { 'user-agent': 'dsh-vs-game' },
          });
          if (!r.ok) throw new Error('GitHub API ' + r.status);
          const data = await r.json();
          const latest = data?.sha ?? null;
          const current = await readCurrentCommit(PROFILE_DIR);
          sendJson({
            ok: true,
            latest,
            current,
            isLatest: !!(latest && current && latest === current),
            profile: PROFILE_NAME,
          });
        } catch (e) {
          sendJson({ ok: false, error: String(e?.message ?? e) });
        }
        return;
      }
      if (req.method === 'POST') {
        const bin = process.platform === 'win32' ? 'dsh.cmd' : 'dsh';
        const child = spawn(bin, ['plugin', '--profile', PROFILE_NAME, 'add', 'github:shang-han/dsh-vs-game'], {
          cwd: join(PROFILE_DIR, 'node_modules', 'dsh-vs-game'),
          env: process.env,
          shell: process.platform === 'win32',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (d) => { output += d.toString(); });
        child.stderr.on('data', (d) => { output += d.toString(); });
        child.on('close', (code) => {
          if (code === 0) {
            sendJson({ ok: true, profile: PROFILE_NAME, output: output.slice(-4000) });
          } else {
            sendJson({ ok: false, error: 'dsh 更新失败（exit ' + code + '）', output: output.slice(-4000) }, 500);
          }
        });
        child.on('error', (e) => {
          sendJson({ ok: false, error: String(e?.message ?? e) }, 500);
        });
        return;
      }
      res.writeHead(405);
      res.end();
    },
  }), 'vs-game: update endpoint');

  // ── 9. /vs 命令：切换面板 ──
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
