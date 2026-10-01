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
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { encodeMsg, decodeFrame, HostMsg, ClientMsg } from './protocol.js';
import { LUCKY_STONE, luckyNeeded, enchantRate } from './enchant.js';
import { GameReducer } from './game-reducer.js';
import { LEVELS } from './levels/index.js';

// ─── 插件元数据 ────────────────────────────────────────────────────────────
const name = 'vs-game';
const inject = ['webServer'];

// ─── Config schema（cordis 加载时校验 patch 配置） ────────────────────────
export const Config = Schema.object({
  idleSpawnRate: Schema.number().min(1).max(60).default(3),
  autoPause: Schema.boolean().default(true),
  autoSelect: Schema.boolean().default(false),
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
  inventory: ['newbie-gift'],
  accessories: [null, null, null, null],
  activeSkill: null,
  unlockedSkills: [],
  giftOpened: false,
  skillBookUsed: false,
  initialDataReset: false,
  clearedLevels: [],
  chests: [],
  craftingStorage: [],
  groundItems: [],
  containerMigrated: false,
};
/** 打造配方（服务端权威）：id → { name, cost, max } */
export const BUILD_RECIPES = {
  'tree-farm': { name: '树场', cost: { 'mat-wood': 10, 'mat-ingot-silver': 5 }, max: 1 },
  'basic-mine': { name: '基础矿场', cost: { 'mat-wood': 20, 'mat-ingot-silver': 10, 'mat-diamond': 1 }, max: 1 },
  'enchant-table': { name: '饰品强化台', cost: { 'mat-ingot-silver': 20, 'mat-diamond': 10 }, max: 1 },
  'agent-hub': { name: '子代理管理台', cost: { 'mat-ingot-purple': 3, 'mat-diamond': 5, 'mat-ingot-silver': 10 }, max: 1 },
};
const RES_NAMES = { 'mat-wood': '木材', 'mat-ingot-silver': '铁锭', 'mat-diamond': '钻石' };

/** 矿场出矿表：越贵越稀有（铁锭权重 10、钻石权重 2 → 铁 83.3% / 钻 16.7%） */
const MINE_ORES = [
  { item: 'mat-ingot-silver', weight: 10 },
  { item: 'mat-diamond', weight: 2 },
];
export function rollMineOre() {
  const total = MINE_ORES.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of MINE_ORES) { r -= o.weight; if (r < 0) return o.item; }
  return MINE_ORES[MINE_ORES.length - 1].item;
}

/** 饰品品质 → 可嵌孔数；acc-knife 为白，acc-knife-<color> 依次 2~6 孔 */
const ACC_SOCKETS = { white: 1, green: 2, blue: 3, purple: 4, orange: 5, red: 6 };
const ACC_COLORS = { green: 'green', blue: 'blue', purple: 'purple', orange: 'orange', red: 'red' };
/** 品质覆盖表：id 不以颜色结尾的饰品（如钻石小刀）在这里显式指定品质 */
const ACC_QUALITY = { 'acc-knife': 'white', 'acc-knife-diamond': 'green', 'acc-sword': 'blue' };
/** 专属词条（蓝色及以上）：组内全局唯一，强化时只能作为基底不能作为耗材 */
const ACC_EXCLUSIVE = { 'acc-sword': 'normal-attack' };
const EXCLUSIVE_NAMES = { 'normal-attack': '普通攻击替换为剑技' };
/**
 * 饰品基底 → 自身第一条词条的区间（强化时「按耗材自己的第一条词条」写入，而不是写死 5-10）。
 * 不在表里的按 5-10 兜底。
 */
const ACC_AFFIX = { 'acc-knife': [5, 10], 'acc-knife-diamond': [10, 15], 'acc-sword': [5, 10] };
/** 关卡内商店（服务端权威价格） */
const LEVEL_SHOP = { 'acc-sword': { price: 10000 } };
export function accBaseOf(item) { return String(item ?? '').split('~')[0].split('#')[0]; }
export function accAffixesOf(item) {
  const m = /~([^#]*)/.exec(String(item ?? ''));
  const raw = m && m[1] ? m[1].trim() : '';
  if (!raw) return [];
  // 新格式用逗号分隔（数值可能是小数，点号不能当分隔符）；老存档的点号分隔仍然兼容
  if (raw.includes(',')) return raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (/^[a-z_]+$/.test(raw) || /^[a-z_]+:-?[0-9.]+(-[0-9.]+)?$/.test(raw)) return [raw];
  return raw.split('.').filter(Boolean);
}
export function accSockets(item) {
  const base = accBaseOf(item);
  if (!base.startsWith('acc-')) return 0;
  const tail = base.split('-').pop();
  const q = ACC_QUALITY[base] || ACC_COLORS[tail] || 'white';
  return ACC_SOCKETS[q] ?? 1;
}

/** 拆除返还：各物件的建造成本；返还 ceil(成本 × 50%)，未建成的虚影全额返还 */
const DEMOLISH_COST = {
  'chest': { 'mat-wood': 3 },
  'diamond-chest': { 'mat-wood': 3, 'mat-diamond': 5 },
  'record-player': { 'mat-wood': 8, 'mat-diamond': 1 },
  'tree-farm': { 'mat-wood': 10, 'mat-ingot-silver': 5 },
  'basic-mine': { 'mat-wood': 20, 'mat-ingot-silver': 10, 'mat-diamond': 1 },
  'enchant-table': { 'mat-ingot-silver': 20, 'mat-diamond': 10 },
  'agent-hub': { 'mat-ingot-purple': 3, 'mat-diamond': 5, 'mat-ingot-silver': 10 },
};
export function refundFor(kind, full = false) {
  const cost = DEMOLISH_COST[kind] ?? {};
  const out = {};
  for (const [k, v] of Object.entries(cost)) out[k] = full ? v : Math.ceil(v * 0.5);
  return out;
}

export function toCharacter(g) {
  return {
    gold: g.gold,
    initialWeapon: g.initialWeapon,
    passives: g.passives,
    inventory: g.inventory,
    accessories: g.accessories,
    activeSkill: g.activeSkill,
    unlockedSkills: g.unlockedSkills ?? [],
    clearedLevels: g.clearedLevels ?? [],
    chests: (g.chests ?? []).map((c) => {
      const kind = c.kind === 'record-player' || c.kind === 'diamond-chest' ? c.kind : 'chest';
      const cap = kind === 'diamond-chest' ? 25 : 5;
      return { id: c.id, kind, room: Number(c.room) || 0, x: Number(c.x) || 300, y: Number(c.y) || 340, slots: Array.from({ length: cap }, (_, i) => { const s2 = c.slots?.[i]; return s2 && typeof s2 === 'object' && typeof s2.item === 'string' ? { item: s2.item, count: Math.max(1, Math.floor(Number(s2.count) || 1)) } : null; }) };
    }),
    craftingStorage: g.craftingStorage ?? [],
    groundItems: (g.groundItems ?? []).map((x) => ({ ...x, room: Number(x.room) || 0 })),
    devices: (g.devices ?? []).map((d) => ({ id: d.id, kind: d.kind, room: Number(d.room) || 0, x: Number(d.x) || 300, y: Number(d.y) || 340, built: d.built !== false })),
    // 子代理：数量 + 每个的任务（不加进去的话客户端拿不到，面板会一直显示 0/5）
    agents: Math.max(0, Math.min(5, Math.floor(Number(g.agents) || 0))),
    agentTasks: Array.from({ length: Math.max(0, Math.min(5, Math.floor(Number(g.agents) || 0))) }, (_, i) => {
      const t = (g.agentTasks ?? [])[i];
      return t === 'tree-farm' || t === 'mine' ? t : 'idle';
    }),
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
  // 技能书通过碎片合成获取；unlockedSkills 永久保留已学技能
  g.unlockedSkills = Array.isArray(g.unlockedSkills) ? g.unlockedSkills.filter((x) => ACTIVE_SKILL_IDS.includes(x)) : [];
  if (g.activeSkill && !ACTIVE_SKILL_IDS.includes(g.activeSkill)) g.activeSkill = null;
  if (g.activeSkill && !g.unlockedSkills.includes(g.activeSkill)) g.unlockedSkills.push(g.activeSkill);
  if (!g.activeSkill && g.unlockedSkills.length > 0) g.activeSkill = g.unlockedSkills[0];
  if (!Array.isArray(g.chests)) g.chests = [];
  if (!Array.isArray(g.craftingStorage)) g.craftingStorage = [];
  if (!Array.isArray(g.groundItems)) g.groundItems = [];
  // 子代理：数量 0~5，任务数组长度对齐，非法任务名回落到「随意」
  g.agents = Math.max(0, Math.min(5, Math.floor(Number(g.agents) || 0)));
  if (!Array.isArray(g.agentTasks)) g.agentTasks = [];
  g.agentTasks = Array.from({ length: g.agents }, (_, i) => {
    const t = g.agentTasks[i];
    return t === 'tree-farm' || t === 'mine' ? t : 'idle';
  });
  g.chests = g.chests.map((c, i) => {
    const kind = c?.kind === 'record-player' || c?.kind === 'diamond-chest' ? c.kind : 'chest';
    const cap = kind === 'diamond-chest' ? 25 : 5;
    return {
      id: typeof c?.id === 'string' ? c.id : 'chest-' + i,
      kind,
      room: Number(c?.room) || 0,
      x: Number(c?.x) || (300 + (i % 3) * 80),
      y: Number(c?.y) || (340 + Math.floor(i / 3) * 70),
      slots: Array.from({ length: cap }, (_, j) => {
        const s2 = c?.slots?.[j];
        if (!s2) return null;
        if (typeof s2 === 'string') return { item: s2, count: 1 };
        if (typeof s2.item === 'string' && Number.isFinite(Number(s2.count))) return { item: s2.item, count: Math.max(1, Math.floor(Number(s2.count))) };
        return null;
      }),
    };
  });
  g.craftingStorage = g.craftingStorage.filter((x) => typeof x === 'string');
  g.groundItems = g.groundItems.filter((x) => x && typeof x.id === 'string' && typeof x.item === 'string' && Number.isFinite(Number(x.x)) && Number.isFinite(Number(x.y))).map((x) => ({ ...x, room: Number(x.room) || 0 }));
  // 打造的家居器械（树场等）：保证字段完整，未标 built 的按已建成处理
  if (!Array.isArray(g.devices)) g.devices = [];
  g.devices = g.devices
    .filter((x) => x && typeof x.kind === 'string')
    .map((x, i) => ({
      id: typeof x.id === 'string' ? x.id : 'dev-' + i,
      kind: x.kind,
      room: Number(x.room) || 0,
      x: Number(x.x) || 300,
      y: Number(x.y) || 340,
      built: x.built !== false,
    }));
  // 旧版本容器里放东西时没有从背包扣除，做一次性迁移去重
  if (!g.containerMigrated) {
    const inv = [...g.inventory];
    const removeOne = (item) => { const i = inv.indexOf(item); if (i >= 0) inv.splice(i, 1); };
    for (const item of g.craftingStorage) if (item) removeOne(item);
    for (const c of g.chests) for (const slot of c.slots) if (slot && slot.item) removeOne(slot.item);
    g.inventory = inv;
    g.containerMigrated = true;
  }
  return g;
}

/** 使用背包中的一个可打开物品（纯函数）：堆叠时一次只消耗一个。 */
export function openBagItem(g, item) {
  const books = {
    'skill-book': 'strike',
    'skill-book-teleport': 'teleport-laser',
    'skill-book-damage': 'damage-laser',
    'skill-book-railgun': 'railgun',
  };
  if (item !== 'newbie-gift' && !books[item]) return g;
  const inv = Array.isArray(g.inventory) ? [...g.inventory] : [];
  const idx = inv.indexOf(item);
  if (idx < 0) return g;
  inv.splice(idx, 1);
  if (item === 'newbie-gift') {
    return { ...g, gold: (Number(g.gold) || 0) + 1000, inventory: inv, giftOpened: true };
  }
  const skill = books[item];
  const unlocked = [...new Set([...(Array.isArray(g.unlockedSkills) ? g.unlockedSkills : []), skill])];
  const next = { ...g, unlockedSkills: unlocked, inventory: inv };
  if (!g.activeSkill) next.activeSkill = skill;
  if (item === 'skill-book') next.skillBookUsed = true;
  return next;
}

// ── P3 关底翻卡：奖池与发牌（服务端权威） ──
export const ACTIVE_SKILL_IDS = ['strike', 'teleport-laser', 'damage-laser', 'railgun'];

export const FLIP_ACC_POOL = ['acc-knife']; // 仅保留功能饰品，移除 AI 占位饰品
// 注意：mat-ingot-purple（紫晶锭）不在无尽翻卡池里——它卖 2000 金币，进无尽池会变成刷金币外挂；它只从第 4 关产出。
export const FLIP_MAT_POOL = ['mat-ingot-silver', 'mat-ingot-aqua', 'mat-ingot-blue', 'mat-ingot-rose', 'mat-ingot-green'];
function rollDropCard() {
  const r = Math.random() * 100;
  if (r < 50) return { kind: 'mat', item: 'mat-wood' };
  if (r < 60) return { kind: 'mat', item: 'mat-ingot-silver' };
  return { kind: 'gold', amount: 120 + Math.floor(Math.random() * 181) };
}
function rollSecondLevelDrop() {
  const r = Math.random() * 100;
  if (r < 30) return { kind: 'mat', item: 'mat-wood' };
  if (r < 70) return { kind: 'mat', item: 'mat-ingot-silver' };
  return { kind: 'gold', amount: 120 + Math.floor(Math.random() * 181) };
}
/** 第 3 关掉落池：钻石 / 铁锭（固定的那张给伤害激光碎片） */
function rollThirdLevelDrop() {
  return Math.random() < 0.5
    ? { kind: 'mat', item: 'mat-diamond' }
    : { kind: 'mat', item: 'mat-ingot-silver' };
}
/** 第 4 关掉落池：紫晶锭（稀有，12%）/ 铁锭 / 钻石 */
function rollFourthLevelDrop() {
  const r = Math.random() * 100;
  if (r < 12) return { kind: 'mat', item: 'mat-ingot-purple' };
  if (r < 60) return { kind: 'mat', item: 'mat-ingot-silver' };
  return { kind: 'mat', item: 'mat-diamond' };
}
export function rollFlipCards(levelId = null) {
  const out = [];
  if (levelId === 'busy-server') {
    out.push({ kind: 'fragment', item: 'skill-fragment' });
    while (out.length < 3) out.push(rollDropCard());
  } else if (levelId === 'furious-user') {
    out.push({ kind: 'fragment', item: 'skill-fragment-teleport' });
    while (out.length < 3) out.push(rollSecondLevelDrop());
  } else if (levelId === 'workspace-tidy') {
    // 第 3 关掉落：伤害激光碎片 + 钻石 / 铁锭
    out.push({ kind: 'fragment', item: 'skill-fragment-damage' });
    while (out.length < 3) out.push(rollThirdLevelDrop());
  } else if (levelId === 'seaside') {
    // 第 5 关掉落（Boss 翻卡）：钻石 + 紫晶锭
    out.push({ kind: 'mat', item: 'mat-diamond' });
    out.push({ kind: 'mat', item: 'mat-ingot-purple' });
    out.push({ kind: 'mat', item: Math.random() < 0.5 ? 'mat-diamond' : 'mat-ingot-purple' });
  } else if (levelId === 'too-many-files') {
    // 第 4 关掉落：超电磁炮碎片 + 紫晶锭 / 铁锭 / 钻石（紫晶锭的唯一来源）
    out.push({ kind: 'fragment', item: 'skill-fragment-railgun' });
    while (out.length < 3) out.push(rollFourthLevelDrop());
  } else {
    for (let i = 0; i < 3; i++) {
      const r = Math.random();
      if (r < 0.35) out.push({ kind: 'acc', item: FLIP_ACC_POOL[Math.floor(Math.random() * FLIP_ACC_POOL.length)] });
      else if (r < 0.65) out.push({ kind: 'mat', item: FLIP_MAT_POOL[Math.floor(Math.random() * FLIP_MAT_POOL.length)] });
      else out.push({ kind: 'gold', amount: 120 + Math.floor(Math.random() * 181) });
    }
  }
  return out.sort(() => Math.random() - 0.5);
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
      unlockedSkills: z.array(z.string()).default([]),
      giftOpened: z.boolean().default(false),
      skillBookUsed: z.boolean().default(false),
      initialDataReset: z.boolean().default(false),
      clearedLevels: z.array(z.string()).default([]),
      chests: z.array(z.object({ id: z.string(), kind: z.string().default('chest'), room: z.number().default(0), x: z.number().default(300), y: z.number().default(340), slots: z.array(z.union([z.object({ item: z.string(), count: z.number().default(1) }), z.null()])).max(25) })).default([]),
      craftingStorage: z.array(z.union([z.string(), z.null()])).max(11).default([]),
      groundItems: z.array(z.object({ id: z.string(), item: z.string(), room: z.number().default(0), x: z.number(), y: z.number() })).default([]),
      devices: z.array(z.object({ id: z.string(), kind: z.string(), room: z.number().default(0), x: z.number().default(300), y: z.number().default(340), built: z.boolean().default(true) })).default([]),
      agents: z.number().default(0),
      agentTasks: z.array(z.string()).default([]),
      containerMigrated: z.boolean().default(false),
    }),
    initial: { ...DEFAULT_GLOBAL },
  },
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
  const cfg = { idleSpawnRate: 3, autoPause: true, autoSelect: false, difficulty: 'normal', ...config };
  // 异步就绪的持久化/设置句柄
  const persist = { domain: null, settingsScope: null };
  const readGlobal = () => sanitizeGlobal({
    ...DEFAULT_GLOBAL,
    ...(persist.domain ? persist.domain.global.get() ?? {} : {}),
  });
  const publicConfig = () => ({
    idleSpawnRate: persist.settingsScope ? persist.settingsScope.get().idleSpawnRate : cfg.idleSpawnRate,
    autoPause: persist.settingsScope ? persist.settingsScope.get().autoPause : cfg.autoPause,
    autoSelect: persist.settingsScope ? persist.settingsScope.get().autoSelect : cfg.autoSelect,
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

  // 串行化所有改档：读-改-写进同一条互斥队列，两个并发 mutate 不再互相覆盖（旧快照把已删数据写回去=物品复活）
  let mutateChain = Promise.resolve();
  async function mutateGlobal(fn) {
    const run = mutateChain.then(async () => {
      if (!persist.domain) return readGlobal();
      const g = readGlobal();
      const next = fn({ ...g });
      await persist.domain.global.set(next);
      return next;
    });
    mutateChain = run.catch(() => {});
    return run;
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
        const item = typeof msg.item === 'string' ? msg.item : null;
        if (!item) break;
        mutateGlobal((g) => openBagItem(g, item))
          .then((g) => sendCharacter(ws, g))
          .catch((e) => logger.warn('open item failed:', e));
        break;
      }
      case ClientMsg.EQUIP_SKILL: {
        const skill = typeof msg.skill === 'string' ? msg.skill : null;
        if (!skill || !ACTIVE_SKILL_IDS.includes(skill)) break;
        const g0 = readGlobal();
        if (!(g0.unlockedSkills ?? []).includes(skill)) break;
        mutateGlobal((g) => ({ ...g, activeSkill: skill }))
          .then((g) => sendCharacter(ws, g))
          .catch((e) => logger.warn('equip skill failed:', e));
        break;
      }
      case ClientMsg.BOSS_KILL: {
        const levelId = typeof msg.levelId === 'string' ? msg.levelId : null;
        const lv = levelId ? LEVELS.find((x) => x.id === levelId) : null;
        if (!lv) break;
        const g0 = readGlobal();
        const firstClear = !(Array.isArray(g0.clearedLevels) && g0.clearedLevels.includes(levelId));
        const cards = rollFlipCards(levelId);
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
          else if (typeof card.item === 'string' && /^(acc-|mat-|tool-|skill-fragment)/.test(card.item)) next.inventory = [...next.inventory, card.item];
          return next;
        })
          .then((g) => ws.send(encodeMsg({ kind: HostMsg.CARD_RESULT, index: i, card, character: toCharacter(g) })))
          .catch((e) => logger.warn('flip pick failed:', e));
        break;
      }
      case ClientMsg.CRAFT_ITEM: {
        const product = typeof msg.item === 'string' ? msg.item : null;
        if (!product) break;
        const ingredients = Array.isArray(msg.ingredients) ? msg.ingredients.filter((x) => typeof x === 'string') : ['skill-fragment','skill-fragment','skill-fragment','skill-fragment','skill-fragment','skill-fragment','skill-fragment','skill-fragment','skill-fragment','skill-fragment'];
        const need = new Map();
        for (const x of ingredients) need.set(x, (need.get(x) ?? 0) + 1);
        const g0 = readGlobal();
        const has = (arr, k) => (arr ?? []).filter((x) => x === k).length;
        if (![...need.entries()].every(([k, n]) => has(g0.inventory, k) + has(g0.craftingStorage, k) >= n)) break;
        mutateGlobal((g) => {
          const remain = new Map(need);
          const storage = [...(g.craftingStorage ?? [])];
          const inv = [...g.inventory];
          for (const [k, n] of need.entries()) {
            let left = n;
            while (left > 0) {
              let i = storage.indexOf(k);
              if (i >= 0) { storage.splice(i, 1); left--; continue; }
              i = inv.indexOf(k);
              if (i >= 0) { inv.splice(i, 1); left--; continue; }
              return g;
            }
          }
          const drop = { id: 'g' + Date.now().toString(36), item: product, room: 0, x: 230 + (Math.random() * 40 - 20), y: 420 + (Math.random() * 40 - 20) };
          return { ...g, inventory: inv, craftingStorage: storage, groundItems: [...(g.groundItems ?? []), drop] };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('craft failed:', e));
        break;
      }
      case ClientMsg.SELL_ITEM: {
        const item = typeof msg.item === 'string' ? msg.item : null;
        if (!item || !readGlobal().inventory.includes(item)) break;
        if (['newbie-gift', 'skill-book'].includes(item)) break;
        const price = item === 'mat-wood' ? 100
          : item === 'mat-ingot-silver' ? 300
          : item === 'mat-diamond' ? 500
          : item === 'mat-ingot-purple' ? 1000
          : item === 'mat-lucky-stone' ? 2000
          : item === 'record-billie-jean' ? 500
          : item === 'record-letmego' ? 500
          : item === 'record-bad-apple' ? 500
          : item === 'record-world-execute-me' ? 500
          : item.startsWith('acc-') ? 150
          : item.startsWith('mat-') ? 80
          : item === 'skill-fragment' ? 500
          : item === 'skill-fragment-teleport' || item === 'skill-fragment-damage' || item === 'skill-fragment-railgun' ? 500
          : item.startsWith('skill-fragment') ? 500
          : item.startsWith('tool-') ? 120 : 10;
        const max = readGlobal().inventory.filter((x) => x === item).length;
        const qty = Math.max(1, Math.min(max, Number(msg.quantity) || 1));
        mutateGlobal((g) => {
          let removed = 0;
          const inv = g.inventory.filter((x) => {
            if (x === item && removed < qty) { removed++; return false; }
            return true;
          });
          return { ...g, gold: g.gold + price * qty, inventory: inv };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('sell failed:', e));
        break;
      }
      case ClientMsg.LEVEL_SHOP_BUY: {
        // 关卡内商店：价格以服务端表为准；同一件只卖一次（拥有任意同基底强化形态也算）
        const shopItem = typeof msg.item === 'string' ? msg.item : null;
        const shopEntry = shopItem ? LEVEL_SHOP[shopItem] : null;
        if (!shopEntry) break;
        const reply2 = (text) => ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text }));
        const g0s = readGlobal();
        const ownsBase = (g0s.inventory ?? []).some((x) => accBaseOf(x) === shopItem)
          || (Array.isArray(g0s.accessories) ? g0s.accessories : []).some((x) => x && accBaseOf(x) === shopItem);
        if (ownsBase) { reply2('已经买过「' + shopItem + '」了'); break; }
        if ((g0s.gold ?? 0) < shopEntry.price) { reply2('金币不够（需要 ' + shopEntry.price + '）'); break; }
        mutateGlobal((g) => ({ ...g, gold: g.gold - shopEntry.price, inventory: [...(g.inventory ?? []), shopItem] }))
          .then((g) => { reply2('购买成功：获得 宝剑（去角色页佩戴）'); sendCharacter(ws, g); })
          .catch((e) => logger.warn('level shop buy failed:', e));
        break;
      }
      case ClientMsg.BUY_ITEM: {
        const item = typeof msg.item === 'string' ? msg.item : null;
        if (!item) break;
        const buyPrice = item === 'mat-wood' ? 200
          : item === 'mat-ingot-silver' ? 600
          : item === 'mat-diamond' ? 1000
          : item === 'mat-ingot-purple' ? 2000
          : item === 'record-billie-jean' ? 1000
          : item === 'record-letmego' ? 1000
          : item === 'record-bad-apple' ? 1000
          : item === 'record-world-execute-me' ? 1000
          : item === 'skill-fragment' ? 1000
          : item === 'skill-fragment-teleport' || item === 'skill-fragment-damage' || item === 'skill-fragment-railgun' ? 1000
          : 0;
        if (!buyPrice) break;
        const qty = Math.max(1, Math.min(99, Number(msg.quantity) || 1));
        mutateGlobal((g) => {
          const total = buyPrice * qty;
          if (g.gold < total) return g;
          return { ...g, gold: g.gold - total, inventory: [...g.inventory, ...Array(qty).fill(item)] };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('buy failed:', e));
        break;
      }
      case ClientMsg.CHEST_LOOT: {
        // 宝箱开箱入账：金额钳制防异常，物品按 MV 前缀白名单进背包
        const gold = Math.max(0, Math.min(500, Number(msg.gold) || 0));
        const item = typeof msg.item === 'string' && /^(acc-|mat-|tool-)/.test(msg.item) ? msg.item : null;
        const count = Math.max(1, Math.min(3, Math.floor(Number(msg.count) || 1)));
        mutateGlobal((g) => ({
          ...g,
          gold: g.gold + gold,
          inventory: item ? [...g.inventory, ...Array(count).fill(item)] : g.inventory,
        })).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('chest loot failed:', e));
        break;
      }
      case ClientMsg.EQUIP_ACCESSORY: {
        const item = typeof msg.item === 'string' ? msg.item : null;
        if (!item || !item.startsWith('acc-')) break;
        const g0 = readGlobal();
        const inv0 = g0.inventory ?? [];
        const acc0 = Array.isArray(g0.accessories) ? g0.accessories : [null, null, null, null];
        if (!inv0.includes(item) || !acc0.some((x) => !x)) break;
        const exGroup = ACC_EXCLUSIVE[accBaseOf(item)];
        if (exGroup) {
          const equipped = Array.isArray(g0.accessories) ? g0.accessories.filter(Boolean) : [];
          const clash = equipped.some((x) => ACC_EXCLUSIVE[accBaseOf(x)] === exGroup);
          if (clash) {
            ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '「' + EXCLUSIVE_NAMES[exGroup] + '」类词条同时只能佩戴一件' }));
            break;
          }
        }
        mutateGlobal((g) => {
          const inv = [...g.inventory];
          const i = inv.indexOf(item);
          if (i >= 0) inv.splice(i, 1);
          const acc = [...(g.accessories ?? [null, null, null, null])];
          while (acc.length < 4) acc.push(null);
          const slot = acc.findIndex((x) => !x);
          if (slot >= 0) acc[slot] = item;
          return { ...g, inventory: inv, accessories: acc };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('equip failed:', e));
        break;
      }
      case ClientMsg.UNEQUIP_ACCESSORY: {
        const slot = Number(msg.slot);
        if (!Number.isInteger(slot) || slot < 0 || slot > 3) break;
        mutateGlobal((g) => {
          const acc = [...(g.accessories ?? [null, null, null, null])];
          const item = acc[slot];
          if (!item) return g;
          acc[slot] = null;
          return { ...g, accessories: acc, inventory: [...g.inventory, item] };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('unequip failed:', e));
        break;
      }
      case ClientMsg.SET_CRAFTING_STORAGE: {
        const rawDesired = Array.isArray(msg.items) ? msg.items.filter((x) => x === null || typeof x === 'string').slice(0, 11) : [];
        mutateGlobal((g) => {
          const old = Array.isArray(g.craftingStorage) ? g.craftingStorage.filter((x) => x === null || typeof x === 'string') : [];
          const inv = [...g.inventory];
          const count = (arr) => { const m = new Map(); for (const x of arr) if (x) m.set(x, (m.get(x) ?? 0) + 1); return m; };
          const oldC = count(old), invC = count(inv);
          const desired = [];
          const used = new Map();
          for (const item of rawDesired) {
            const max = (oldC.get(item) ?? 0) + (invC.get(item) ?? 0);
            const u = used.get(item) ?? 0;
            if (u < max) { desired.push(item); used.set(item, u + 1); }
          }
          const newC = count(desired);
          const keys = new Set([...oldC.keys(), ...newC.keys()]);
          for (const k of keys) {
            const delta = (newC.get(k) ?? 0) - (oldC.get(k) ?? 0);
            if (delta > 0) {
              for (let i = 0; i < delta; i++) {
                const idx = inv.indexOf(k);
                if (idx >= 0) inv.splice(idx, 1);
              }
            } else if (delta < 0) {
              for (let i = 0; i < -delta; i++) inv.push(k);
            }
          }
          return { ...g, inventory: inv, craftingStorage: desired };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('crafting storage failed:', e));
        break;
      }
      case ClientMsg.PLACE_CHEST: {
        const placeItem = typeof msg.placeItem === 'string' ? msg.placeItem : 'wooden-chest';
        const kind = msg.containerKind === 'record-player' ? 'record-player' : 'chest';
        const g0 = readGlobal();
        if (!(g0.inventory ?? []).includes(placeItem)) {
          ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '放置失败：背包没有该物品' }));
          break;
        }
        const x = Math.max(30, Math.min(810, Number(msg.x) || 300));
        const y = Math.max(130, Math.min(490, Number(msg.y) || 340));
        mutateGlobal((g) => {
          const inv = [...g.inventory];
          const i = inv.indexOf(placeItem);
          if (i >= 0) inv.splice(i, 1);
          const chests = [...(g.chests ?? []), { id: 'chest-' + Date.now().toString(36), kind, room: Number(msg.room) || 0, x, y, slots: [null, null, null, null, null] }];
          return { ...g, inventory: inv, chests };
        }).then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '已放置' })); })
          .catch((e) => { logger.warn('place container failed:', e); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '放置失败' })); });
        break;
      }
      case ClientMsg.EJECT_CONTAINER_ITEM: {
        const chestId = typeof msg.chestId === 'string' ? msg.chestId : null;
        const slot = Number(msg.slot);
        if (!chestId || !Number.isInteger(slot) || slot < 0) break;
        mutateGlobal((g) => {
          const chests = (g.chests ?? []).map((c) => ({ ...c, slots: [...(c.slots ?? [null, null, null, null, null])] }));
          const chest = chests.find((c) => c.id === chestId);
          if (!chest) return g;
          const cap = chest.kind === 'diamond-chest' ? 25 : 5;
          while (chest.slots.length < cap) chest.slots.push(null);
          if (slot >= cap) return g;
          const st = chest.slots[slot];
          if (!st || !st.item) return g;
          chest.slots[slot] = null;
          const drop = { id: 'g' + Date.now().toString(36), item: st.item, room: Number(chest.room) || 0, x: (Number(chest.x) || 300) + 80, y: (Number(chest.y) || 340) + 20 };
          return { ...g, chests, groundItems: [...(g.groundItems ?? []), drop] };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('eject failed:', e));
        break;
      }
      case ClientMsg.UPGRADE_CHEST: {
        const chestId = typeof msg.chestId === 'string' ? msg.chestId : null;
        if (!chestId) break;
        mutateGlobal((g) => {
          const chests = (g.chests ?? []).map((c) => ({ ...c, slots: [...(c.slots ?? [])] }));
          const chest = chests.find((c) => c.id === chestId);
          if (!chest || chest.kind !== 'chest') return g;
          const inv = [...g.inventory];
          let need = 5;
          const nextInv = [];
          for (const it of inv) {
            if (it === 'mat-diamond' && need > 0) { need--; continue; }
            nextInv.push(it);
          }
          if (need > 0) return g;
          while (chest.slots.length < 25) chest.slots.push(null);
          chest.slots = chest.slots.slice(0, 25);
          chest.kind = 'diamond-chest';
          return { ...g, inventory: nextInv, chests };
        }).then((g) => {
          sendCharacter(ws, g);
          ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '💎 木制宝箱已升级为钻石宝箱（25 格）' }));
        }).catch((e) => { logger.warn('upgrade chest failed:', e); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '升级失败' })); });
        break;
      }
      case ClientMsg.REMOVE_CHEST: {
        const chestId = typeof msg.chestId === 'string' ? msg.chestId : null;
        if (!chestId) break;
        mutateGlobal((g) => {
          const chest = (g.chests ?? []).find((c) => c.id === chestId);
          if (!chest) return g;
          const drops = [];
          const baseX = Number(chest.x) || 300, baseY = Number(chest.y) || 340;
          const addDrop = (item, i) => { drops.push({ id: 'g' + Date.now().toString(36) + i, item, room: Number(chest.room) || 0, x: baseX + (i % 3) * 24 - 24, y: baseY + Math.floor(i / 3) * 24 - 10 }); };
          let n = 0;
          for (const slot of chest.slots ?? []) {
            if (!slot || !slot.item) continue;
            const cnt = Math.max(1, Math.floor(Number(slot.count) || 1));
            for (let k = 0; k < cnt; k++) addDrop(slot.item, n++);
          }
          addDrop('mat-wood', n++);
          return { ...g, chests: (g.chests ?? []).filter((c) => c.id !== chestId), groundItems: [...(g.groundItems ?? []), ...drops] };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('remove chest failed:', e));
        break;
      }
      case ClientMsg.MOVE_HOME_ITEM: {
        const target = msg.target === 'device' ? 'device' : 'chest';
        const id = typeof msg.id === 'string' ? msg.id : null;
        if (!id) break;
        const x = Math.max(30, Math.min(810, Number(msg.x) || 300));
        const y = Math.max(130, Math.min(490, Number(msg.y) || 340));
        mutateGlobal((g) => {
          if (target === 'device') {
            if (!(g.devices ?? []).some((d) => d.id === id)) return g;
            return { ...g, devices: (g.devices ?? []).map((d) => (d.id === id ? { ...d, x, y } : d)) };
          }
          if (!(g.chests ?? []).some((c) => c.id === id)) return g;
          return { ...g, chests: (g.chests ?? []).map((c) => (c.id === id ? { ...c, x, y } : c)) };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('move home item failed:', e));
        break;
      }
      case ClientMsg.DEMOLISH_HOME_ITEM: {
        const target = msg.target === 'device' ? 'device' : 'chest';
        const id = typeof msg.id === 'string' ? msg.id : null;
        if (!id) break;
        mutateGlobal((g) => {
          const drops = [];
          const addDrop = (item, room, bx, by, n) => { drops.push({ id: 'g' + Date.now().toString(36) + n, item, room, x: bx + (n % 3) * 24 - 24, y: by + Math.floor(n / 3) * 24 - 10 }); };
          if (target === 'device') {
            const dv = (g.devices ?? []).find((d) => d.id === id);
            if (!dv) return g;
            const room = Number(dv.room) || 0, bx = Number(dv.x) || 300, by = Number(dv.y) || 340;
            const refund = refundFor(dv.kind, dv.built === false); // 未建成虚影全额返还
            let n = 0;
            for (const [k, cnt] of Object.entries(refund)) for (let i = 0; i < cnt; i++) addDrop(k, room, bx, by, n++);
            return { ...g, devices: (g.devices ?? []).filter((d) => d.id !== id), groundItems: [...(g.groundItems ?? []), ...drops] };
          }
          const chest = (g.chests ?? []).find((c) => c.id === id);
          if (!chest) return g;
          const kind = chest.kind === 'record-player' || chest.kind === 'diamond-chest' ? chest.kind : 'chest';
          const room = Number(chest.room) || 0, bx = Number(chest.x) || 300, by = Number(chest.y) || 340;
          let n = 0;
          for (const slot of chest.slots ?? []) {
            if (!slot || !slot.item) continue;
            const cnt = Math.max(1, Math.floor(Number(slot.count) || 1));
            for (let k = 0; k < cnt; k++) addDrop(slot.item, room, bx, by, n++);
          }
          for (const [k, cnt] of Object.entries(refundFor(kind))) for (let i = 0; i < cnt; i++) addDrop(k, room, bx, by, n++);
          return { ...g, chests: (g.chests ?? []).filter((c) => c.id !== id), groundItems: [...(g.groundItems ?? []), ...drops] };
        }).then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '🗑 已拆除，材料掉在地上' })); })
          .catch((e) => logger.warn('demolish failed:', e));
        break;
      }
      case ClientMsg.BUILD_PLACE: {
        const item = typeof msg.item === 'string' ? msg.item : null;
        const recipe = item ? BUILD_RECIPES[item] : null;
        if (!recipe) break;
        const g0 = readGlobal();
        const owned = (g0.devices ?? []).filter((d) => d.kind === item).length;
        if (owned >= (recipe.max ?? 1)) {
          ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '建造失败：' + recipe.name + ' 最多只能放 ' + (recipe.max ?? 1) + ' 个' }));
          break;
        }
        const inv0 = Array.isArray(g0.inventory) ? g0.inventory : [];
        const lack = Object.keys(recipe.cost).find((k) => inv0.filter((x) => x === k).length < recipe.cost[k]);
        if (lack) {
          ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '建造失败：材料不足（缺 ' + (RES_NAMES[lack] ?? lack) + '）' }));
          break;
        }
        const room = Number(msg.room) || 0;
        const x = Math.max(30, Math.min(810, Number(msg.x) || 300));
        const y = Math.max(160, Math.min(490, Number(msg.y) || 340));
        mutateGlobal((g) => {
          const inv = [...(g.inventory ?? [])];
          for (const [k, n] of Object.entries(recipe.cost)) {
            let left = n;
            for (let i = inv.length - 1; i >= 0 && left > 0; i--) { if (inv[i] === k) { inv.splice(i, 1); left--; } }
          }
          const dev = { id: 'dev-' + Date.now().toString(36), kind: item, room, x, y, built: false };
          return { ...g, inventory: inv, devices: [...(g.devices ?? []), dev] };
        }).then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '🔨 ' + recipe.name + ' 虚影已就位，走到旁边按住 F 施工' })); })
          .catch((e) => { logger.warn('build place failed:', e); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '建造失败' })); });
        break;
      }
      case ClientMsg.ENCHANT: {
        const baseId = typeof msg.baseId === 'string' ? msg.baseId : null;
        const materialId = typeof msg.materialId === 'string' ? msg.materialId : null;
        if (!baseId || !materialId) break;
        const reply = (text) => ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text }));
        const g0 = readGlobal();
        const inv0 = Array.isArray(g0.inventory) ? g0.inventory : [];
        const bN = inv0.filter((x) => x === baseId).length;
        const mN = inv0.filter((x) => x === materialId).length;
        if (bN < 1 || mN < 1 || (baseId === materialId && bN < 2)) { reply('强化失败：基底或材料不足'); break; }
        const sockets = accSockets(baseId);
        const idx = accAffixesOf(baseId).length;
        if (!sockets || idx >= sockets) { reply('强化失败：没有空孔了'); break; }
        // 幸运石：每颗 +10% 成功率，总上限 100%；多于「拉满所需」的部分不消耗
        const wantStones = Math.max(0, Math.floor(Number(msg.lucky) || 0));
        const ownedStones = inv0.filter((x) => x === LUCKY_STONE).length;
        const useStones = Math.min(wantStones, ownedStones, luckyNeeded(idx));
        const rate = enchantRate(idx, useStones);
        const ok = Math.random() < rate;
        // 新词条 = 耗材自身的第一条词条（区间写进 token：atk:10-15）
        const matBase = accBaseOf(materialId);
        if (ACC_EXCLUSIVE[matBase]) { reply('强化失败：专属词条饰品只能作为基底，不能当耗材'); break; }
        const matRange = ACC_AFFIX[matBase] ?? [5, 10];
        const affixToken = 'atk:' + matRange[0] + '-' + matRange[1];
        const newId = ok ? (accBaseOf(baseId) + '~' + accAffixesOf(baseId).concat([affixToken]).join(',') + '#' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36)) : null;
        mutateGlobal((g) => {
          const inv = [...(g.inventory ?? [])];
          for (let i = 0; i < useStones; i++) {        // 幸运石必消耗
            const si = inv.indexOf(LUCKY_STONE);
            if (si >= 0) inv.splice(si, 1);
          }
          const mi = inv.indexOf(materialId);          // 材料必消耗
          if (mi >= 0) inv.splice(mi, 1);
          if (ok) { const bi = inv.indexOf(baseId); if (bi >= 0) inv[bi] = newId; }  // 成功：基底原地换成新实例
          return { ...g, inventory: inv };
        }).then((g) => { sendCharacter(ws, g); reply((ok ? '✨ 强化成功（+1 词条，共 ' + (idx + 1) + ' 孔）' : '💥 强化失败（材料消失，孔保留）') + (useStones > 0 ? '（幸运石 ×' + useStones + ' +' + Math.round(useStones * 10) + '%，成功率 ' + Math.round(rate * 100) + '%）' : '')); })
          .catch((e) => logger.warn('enchant failed:', e));
        break;
      }
      case ClientMsg.HIRE_AGENT: {
        const reply = (text) => ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text }));
        const g0 = readGlobal();
        const cur = Math.max(0, Math.min(5, Math.floor(Number(g0.agents) || 0)));
        if (cur >= 5) { reply('子代理已满 5 个'); break; }
        const price = (cur + 1) * 10000;
        if ((Number(g0.gold) || 0) < price) { reply('金币不够（需要 ' + price + '）'); break; }
        mutateGlobal((g) => {
          const n2 = Math.max(0, Math.min(5, Math.floor(Number(g.agents) || 0))) + 1;
          const tasks = Array.isArray(g.agentTasks) ? [...g.agentTasks] : [];
          while (tasks.length < n2) tasks.push('idle');
          return { ...g, gold: (Number(g.gold) || 0) - price, agents: n2, agentTasks: tasks.slice(0, n2) };
        }).then((g) => { sendCharacter(ws, g); reply('招募成功！第 ' + (cur + 1) + ' 个子代理已就位'); })
          .catch((e) => logger.warn('hire agent failed:', e));
        break;
      }
      case ClientMsg.SET_AGENT_TASK: {
        const index = Math.max(0, Math.floor(Number(msg.index) || 0));
        const task = msg.task === 'tree-farm' || msg.task === 'mine' ? msg.task : 'idle';
        const g0 = readGlobal();
        const count = Math.max(0, Math.min(5, Math.floor(Number(g0.agents) || 0)));
        if (index >= count) break;
        mutateGlobal((g) => {
          const tasks = Array.isArray(g.agentTasks) ? [...g.agentTasks] : [];
          while (tasks.length < count) tasks.push('idle');
          tasks[index] = task;
          return { ...g, agentTasks: tasks.slice(0, count) };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('set agent task failed:', e));
        break;
      }
      case ClientMsg.GATHER: {
        const deviceId = typeof msg.deviceId === 'string' ? msg.deviceId : null;
        if (!deviceId) break;
        // 客户端把积攒到的工作量一次性换成 count 份，避免高效率时被防刷吞掉
        const count = Math.max(1, Math.min(20, Math.floor(Number(msg.count) || 1)));
        const now = Date.now();
        if (ws._lastGatherAt && now - ws._lastGatherAt < 150) break; // 防刷：最短 150ms 一次（正常不会触发）
        const g0 = readGlobal();
        const dev = (g0.devices ?? []).find((d) => d.id === deviceId && d.built !== false);
        if (!dev) break;
        const items = [];
        for (let i = 0; i < count; i++) {
          const item = dev.kind === 'tree-farm' ? 'mat-wood' : dev.kind === 'basic-mine' ? rollMineOre() : null;
          if (!item) break;
          items.push(item);
        }
        if (!items.length) break;
        ws._lastGatherAt = now;
        mutateGlobal((g) => ({ ...g, inventory: [...(g.inventory ?? []), ...items] }))
          .then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '+' + items.length + ' ' + (RES_NAMES[items[0]] ?? items[0]), item: items[0] })); })
          .catch((e) => logger.warn('gather failed:', e));
        break;
      }
      case ClientMsg.CHOP_TREE: {
        const deviceId = typeof msg.deviceId === 'string' ? msg.deviceId : null;
        if (!deviceId) break;
        const now = Date.now();
        if (ws._lastChopAt && now - ws._lastChopAt < 700) break; // 防刷：最短 700ms 一次
        const g0 = readGlobal();
        if (!(g0.devices ?? []).some((d) => d.id === deviceId && d.kind === 'tree-farm' && d.built !== false)) break;
        ws._lastChopAt = now;
        mutateGlobal((g) => ({ ...g, inventory: [...(g.inventory ?? []), 'mat-wood'] }))
          .then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '+1 木材', item: 'mat-wood' })); })
          .catch((e) => logger.warn('chop tree failed:', e));
        break;
      }
      case ClientMsg.BUILD_FINISH: {
        const deviceId = typeof msg.deviceId === 'string' ? msg.deviceId : null;
        if (!deviceId) break;
        const g0 = readGlobal();
        const target = (g0.devices ?? []).find((d) => d.id === deviceId && d.built === false);
        if (!target) break;
        mutateGlobal((g) => ({
          ...g,
          devices: (g.devices ?? []).map((d) => (d.id === deviceId ? { ...d, built: true } : d)),
        })).then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '✅ ' + (BUILD_RECIPES[target.kind]?.name ?? '设施') + ' 建造完成' })); })
          .catch((e) => logger.warn('build finish failed:', e));
        break;
      }
      case ClientMsg.PICKUP_GROUND: {
        const groundId = typeof msg.groundId === 'string' ? msg.groundId : null;
        if (!groundId) break;
        mutateGlobal((g) => {
          const it = (g.groundItems ?? []).find((x) => x.id === groundId);
          if (!it) return g;
          const unique = new Set(g.inventory ?? []);
          if (!unique.has(it.item) && unique.size >= 24) return g;
          return { ...g, inventory: [...g.inventory, it.item], groundItems: (g.groundItems ?? []).filter((x) => x.id !== groundId) };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('pickup ground failed:', e));
        break;
      }
      case ClientMsg.AGENT_PICKUP: {
        // 子代理捡起：地面物品立刻消失，记在该代理的「手上一格」（每代理一格，互不干扰）
        const groundId = typeof msg.groundId === 'string' ? msg.groundId : null;
        const slotP = Math.max(0, Math.min(9, Math.floor(Number(msg.slot) || 0)));
        if (!groundId) break;
        ws._agentHold = ws._agentHold || {};
        if (typeof ws._agentHold[slotP] === 'string') break;
        mutateGlobal((g) => {
          const it = (g.groundItems ?? []).find((x) => x.id === groundId);
          if (!it) return g;
          ws._agentHold[slotP] = it.item;   // 在串行改档队列里赋值，读改写原子
          return { ...g, groundItems: (g.groundItems ?? []).filter((x) => x.id !== groundId) };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('agent pickup failed:', e));
        break;
      }
      case ClientMsg.AGENT_DELIVER: {
        // 送达：该代理手上的东西进玩家背包（无 chestId）或指定箱子；放不下就按 x/y 掉回地上（不吞物品）
        const slotD = Math.max(0, Math.min(9, Math.floor(Number(msg.slot) || 0)));
        const chestId = typeof msg.chestId === 'string' ? msg.chestId : null;
        const x = Math.max(0, Math.min(9999, Number(msg.x) || 300));
        const y = Math.max(0, Math.min(9999, Number(msg.y) || 340));
        const room = Math.max(0, Math.min(9, Math.floor(Number(msg.room) || 0)));
        mutateGlobal((g) => {
          const item = ws._agentHold ? ws._agentHold[slotD] : undefined;
          if (typeof item !== 'string') return g;
          delete ws._agentHold[slotD];
          const dropBack = (gg) => ({ ...gg, groundItems: [...(gg.groundItems ?? []), { id: 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), item, room, x, y }] });
          if (!chestId) {
            const unique = new Set(g.inventory ?? []);
            if (!unique.has(item) && unique.size >= 24) return dropBack(g);
            return { ...g, inventory: [...g.inventory, item] };
          }
          const chests = (g.chests ?? []).map((c) => ({ ...c, slots: [...(c.slots ?? [null, null, null, null, null])] }));
          const chest = chests.find((c) => c.id === chestId);
          if (!chest) return dropBack(g);
          const cap = chest.kind === 'diamond-chest' ? 25 : 5;
          while (chest.slots.length < cap) chest.slots.push(null);
          if (chest.slots.length > cap) chest.slots = chest.slots.slice(0, cap);
          const same = chest.slots.findIndex((st) => st && st.item === item);
          const empty = chest.slots.findIndex((st) => !st);
          if (same >= 0) chest.slots[same].count = (Number(chest.slots[same].count) || 1) + 1;
          else if (empty >= 0) chest.slots[empty] = { item, count: 1 };
          else return dropBack(g);
          return { ...g, chests };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('agent deliver failed:', e));
        break;
      }
      case ClientMsg.CHEST_TRANSFER: {
        const chestId = typeof msg.chestId === 'string' ? msg.chestId : null;
        if (!chestId) break;
        mutateGlobal((g) => {
          const chests = (g.chests ?? []).map((c) => ({ ...c, slots: [...(c.slots ?? [null, null, null, null, null])] }));
          const chest = chests.find((c) => c.id === chestId);
          if (!chest) return g;
          const cap = chest.kind === 'diamond-chest' ? 25 : 5;
          while (chest.slots.length < cap) chest.slots.push(null);
          if (chest.slots.length > cap) chest.slots = chest.slots.slice(0, cap);
          const inv = [...g.inventory];
          const isPlayer = chest.kind === 'record-player';
          if (msg.direction === 'in') {
            const item = typeof msg.item === 'string' ? msg.item : null;
            if (!item) return g;
            const i = inv.indexOf(item);
            if (i < 0) return g;
            if (isPlayer) {
              // 唱片机只有一个播放槽，已有唱片时不能再放入
              if (chest.slots.some((x) => x && x.item)) return g;
              chest.slots[0] = { item, count: 1 };
            } else {
              const same = chest.slots.findIndex((x) => x && x.item === item);
              const empty = chest.slots.findIndex((x) => !x);
              if (same >= 0) chest.slots[same].count = (Number(chest.slots[same].count) || 1) + 1;
              else if (empty >= 0) chest.slots[empty] = { item, count: 1 };
              else return g;
            }
            inv.splice(i, 1);
          } else if (msg.direction === 'out') {
            const slot = isPlayer ? 0 : Number(msg.slot);
            if (!Number.isInteger(slot) || slot < 0 || slot >= cap || !chest.slots[slot]) return g;
            const st = chest.slots[slot];
            inv.push(st.item);
            st.count = (Number(st.count) || 1) - 1;
            if (st.count <= 0) chest.slots[slot] = null;
          } else return g;
          return { ...g, inventory: inv, chests };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('chest transfer failed:', e));
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
          inventory: ['newbie-gift'],
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
          autoSelect: cfg.autoSelect,
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
