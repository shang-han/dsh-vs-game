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
  sfxVolume: Schema.number().min(0).max(100).default(100),
  bgmVolume: Schema.number().min(0).max(100).default(100),
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
  storyIntroDone: false,   // 新档：先播虚无开局剧情
  /** 强化台暂存区：{ baseId, materialId, lucky } | null —— 装填后物品离开背包（防重复使用/刷新保留） */
  enchantStage: null,
  /** 锻造台：进行中的任务（到点自动结算进成品仓）+ 成品仓（点击取出才进背包） */
  forgeJobs: [],
  forgeStore: {},
  /** 家/实验室布局版本：1=旧（木屋+黑白房分开），2=大房间（客厅+实验室） */
  layoutVersion: 2,
  /** 实验室（集成工业）：电力 / 修复阶段 / 网格 / 成品仓 / 已解锁蓝图 / 统计 */
  lab: {
    stage: 0,
    power: { stored: 100, cap: 100, brownout: false },
    grid: [],
    store: {},
    blueprints: ['smelter', 'assembler'],
    stats: { produced: {} },
  },
};

/** 矿场产出表（按等级抽原矿）：1 级只出铁 */
const MINE_TABLE = {
  1: [{ item: 'ore-iron', w: 100 }],
  2: [{ item: 'ore-iron', w: 80 }, { item: 'ore-diamond', w: 20 }],
  3: [{ item: 'ore-iron', w: 60 }, { item: 'ore-diamond', w: 30 }, { item: 'ore-amethyst', w: 10 }],
};
export function rollMineOre(level = 1) {
  const table = MINE_TABLE[Math.min(3, Math.max(1, Math.floor(Number(level) || 1)))] ?? MINE_TABLE[1];
  const total = table.reduce((s, o) => s + o.w, 0);
  let r = Math.random() * total;
  for (const o of table) { r -= o.w; if (r < 0) return o.item; }
  return table[table.length - 1].item;
}
/** 矿场升级：等级 → 材料 */
const MINE_UPGRADE = {
  2: { 'mat-ingot-silver': 15, gear: 4 },
  3: { 'mat-ingot-silver': 25, gear: 8, part: 2 },
};
const MINE_LEVEL_STAGE = { 2: 2, 3: 3 };
/** 钻机（装在矿场上） */
const DRILL_COST = { 'mat-ingot-silver': 5, gear: 2, part: 1 };
/** 实验室修复：下一阶段 → 材料 */
const LAB_STAGE_COST = {
  1: { 'mat-ingot-silver': 5 },
  2: { 'mat-ingot-silver': 15, 'mat-wood': 20 },
  3: { gear: 6, 'mat-ingot-silver': 20, 'ore-diamond': 10 },
  4: { 'token-ticket': 1, gear: 20 },
};
/** 工业网格件：造价与容量（服务端权威；客户端展示同一份数据） */
export const LAB_CATALOG = {
  belt: { cost: { 'mat-ingot-silver': 1 } },
  'belt-fast': { cost: { 'mat-ingot-silver': 2, gear: 2 } },
  arm: { cost: { 'mat-ingot-silver': 2, gear: 1 } },
  'arm-long': { cost: { 'mat-ingot-silver': 3, gear: 2, part: 1 } },
  'arm-fast': { cost: { 'mat-ingot-silver': 2, gear: 3, circuit: 1 } },
  splitter: { cost: { 'mat-ingot-silver': 3, gear: 1 } },
  merger: { cost: { 'mat-ingot-silver': 3, gear: 1 } },
  'crate-wood': { cost: { 'mat-wood': 8, 'mat-ingot-silver': 2 }, slots: 16 },
  'crate-iron': { cost: { 'mat-ingot-silver': 12, gear: 2 }, slots: 32 },
  rack: { cost: { 'mat-ingot-silver': 20, gear: 6, part: 2 }, slots: 48 },
  'crate-filter': { cost: { 'mat-wood': 10, 'mat-ingot-silver': 4 }, slots: 16 },
  smelter: { cost: { 'mat-ingot-silver': 8, 'mat-wood': 15 } },
  assembler: { cost: { 'mat-ingot-silver': 12, 'mat-wood': 20 } },
  crank: { cost: { 'mat-ingot-silver': 4, 'mat-wood': 4 } },
  burner: { cost: { 'mat-ingot-silver': 10, gear: 2 } },
  capacitor: { cost: { 'mat-ingot-purple': 2, circuit: 1 } },
};
const LAB_CELL_KINDS = new Set([...Object.keys(LAB_CATALOG), 'refinery']);
/** 熔炉 → 精炼炉 的升级费用（精炼炉不可直接打造） */
const LAB_UPGRADE = { refinery: { cost: { 'mat-ingot-silver': 20, gear: 6, 'mat-ingot-purple': 1 }, stage: 3 } };
const LAB_GRID_W = 12;
const LAB_GRID_H = 6;
/** 实验室网格净化：未知件丢弃、坐标夹取、缓冲/格子夹取 */
function sanitizeLab(g) {
  if (!g.lab || typeof g.lab !== 'object') g.lab = {};
  const lab = g.lab;
  lab.stage = Math.max(0, Math.min(4, Math.floor(Number(lab.stage) || 0)));
  const p = lab.power ?? {};
  lab.power = {
    stored: Math.max(0, Math.min(999, Number(p.stored) || 0)),
    cap: Math.max(60, Math.min(999, Math.floor(Number(p.cap) || 100))),
    brownout: !!p.brownout,
  };
  lab.store = {};
  for (const [k, v] of Object.entries(lab.store ?? {})) {
    const n = Math.floor(Number(v) || 0);
    if (n > 0) lab.store[k] = Math.min(999, n);
  }
  lab.grid = (Array.isArray(lab.grid) ? lab.grid : []).filter((c) => c && LAB_CELL_KINDS.has(c.kind)).slice(0, 80).map((c, i) => {
    const kind = c.kind;
    const isCrate = /^crate|^rack/.test(kind);
    const cap = LAB_CATALOG[kind]?.slots ?? 0;
    const cells = Array.isArray(c.slots) ? c.slots : [];
    return {
      id: typeof c.id === 'string' ? c.id : 'lc' + i,
      kind,
      x: Math.max(0, Math.min(LAB_GRID_W - 1, Math.floor(Number(c.x) || 0))),
      y: Math.max(0, Math.min(LAB_GRID_H - 1, Math.floor(Number(c.y) || 0))),
      dir: ((Math.floor(Number(c.dir) || 0) % 4) + 4) % 4,
      item: typeof c.item === 'string' ? c.item : null,
      prog: Math.max(0, Math.min(1, Number(c.prog) || 0)),
      sides: Array.isArray(c.sides) && c.sides.length === 4 ? c.sides.map((v) => [0, 1, 2].includes(Number(v)) ? Number(v) : 0) : [1, 2, 1, 1],
      filter: Array.isArray(c.filter) ? c.filter.filter((x) => typeof x === 'string').slice(0, 8) : [],
      mode: c.mode === 'filter' ? 'filter' : 'alt',
      recipe: typeof c.recipe === 'string' ? c.recipe : null,
      slots: isCrate ? Array.from({ length: cap }, (_, j) => {
        const s = cells[j];
        if (!s || typeof s.item !== 'string') return null;
        return { item: s.item, n: Math.max(1, Math.min(99, Math.floor(Number(s.n) || 1))) };
      }) : [],
      in: Array.isArray(c.in) ? c.in.filter((b) => b && typeof b.item === 'string').slice(0, 8).map((b) => ({ item: b.item, n: Math.max(1, Math.min(99, Math.floor(Number(b.n) || 1))) })) : [],
      out: Array.isArray(c.out) ? c.out.filter((b) => b && typeof b.item === 'string').slice(0, 8).map((b) => ({ item: b.item, n: Math.max(1, Math.min(99, Math.floor(Number(b.n) || 1))) })) : [],
      fuel: Math.max(0, Math.min(99, Math.floor(Number(c.fuel) || 0))),
    };
  });
  // 同格去重（后放覆盖前放）
  const seen = new Map();
  for (const c of lab.grid) seen.set(c.x + ',' + c.y, c);
  lab.grid = [...seen.values()];
  lab.blueprints = Array.isArray(lab.blueprints) ? lab.blueprints.filter((x) => typeof x === 'string') : [];
  lab.stats = lab.stats && typeof lab.stats === 'object' ? lab.stats : { produced: {} };
  if (!lab.stats.produced || typeof lab.stats.produced !== 'object') lab.stats.produced = {};
  return lab;
}
/** 容器容量：末影箱 30 / 智能唱片机 12 / 钻石宝箱 25 / 其余 5 */
export function chestCap(kind) {
  return kind === 'ender-chest' ? 30 : kind === 'smart-record' ? 12 : kind === 'diamond-chest' ? 25 : 5;
}
const CHEST_KINDS = new Set(['chest', 'record-player', 'diamond-chest', 'ender-chest', 'smart-record']);
/** 子代理可执行的任务（必须与 client.js 的 AGENT_TASKS 一致；v0.7 新加实验室供料/加速） */
const AGENT_TASKS = new Set(['tree-farm', 'mine', 'lab-feed', 'lab-boost']);
/** 锻造耗时（毫秒）：按品质 白1s / 绿3s / 蓝5s / 紫10s / 橙30s（红色不走锻造） */
const FORGE_DURATION = { white: 1000, green: 3000, blue: 5000, purple: 10000, orange: 30000 };
const FORGE_QUALITY = { 'acc-knife': 'white', 'acc-knife-diamond': 'green', 'acc-fish-ring': 'blue', 'acc-chip': 'blue', 'acc-sword': 'blue', 'acc-sword-long': 'white', 'acc-sword-diamond': 'green', 'acc-sword-amethyst': 'blue', 'acc-armor-wood': 'white', 'acc-armor-iron': 'white', 'acc-armor-diamond': 'green', 'acc-armor-amethyst': 'blue' };
function forgeDuration(product) {
  const q = FORGE_QUALITY[product] ?? 'white';
  return FORGE_DURATION[q] ?? 1000;
}
/** 把到点的锻造任务结算进成品仓（就地修改；每次读档/写入前跑一遍，幂等） */
function sweepForge(g) {
  const now = Date.now();
  if (!Array.isArray(g.forgeJobs)) g.forgeJobs = [];
  if (!g.forgeStore || typeof g.forgeStore !== 'object' || Array.isArray(g.forgeStore)) g.forgeStore = {};
  const keep = [];
  for (const j of g.forgeJobs) {
    if (!j || typeof j.product !== 'string') continue;
    if (Number(j.readyAt) <= now) {
      g.forgeStore[j.product] = Math.max(0, Math.floor(Number(g.forgeStore[j.product]) || 0)) + 1;
    } else {
      keep.push({ id: typeof j.id === 'string' ? j.id : 'fj' + Math.random().toString(36).slice(2), product: j.product, readyAt: Number(j.readyAt) || now });
    }
  }
  g.forgeJobs = keep.slice(0, 20);
  return g;
}
/** 饰品锻造台配方（服务端权威）：成品 → 材料。fish-* 按基底 id 计数（鱼带词条后缀） */
const FORGE_RECIPES = {
  'acc-knife': { 'mat-wood': 1, 'mat-ingot-silver': 1 },
  'acc-sword-long': { 'mat-wood': 3, 'mat-ingot-silver': 5 },
  'acc-armor-wood': { 'mat-wood': 8 },
  'acc-armor-iron': { 'mat-ingot-silver': 8 },
  'acc-knife-diamond': { 'mat-diamond': 2, 'mat-ingot-silver': 3, 'mat-wood': 2 },
  'acc-sword-diamond': { 'mat-wood': 3, 'mat-ingot-silver': 5, 'mat-diamond': 5, gear: 2 },
  'acc-armor-diamond': { 'mat-diamond': 8, gear: 3 },
  'acc-fish-ring': { 'fish-salmon': 1, 'fish-clown': 1, 'fish-cod': 1, 'fish-plain': 1, 'mat-ingot-silver': 4 },
  'acc-chip': { 'mat-ingot-silver': 10, 'mat-diamond': 10, 'mat-ingot-purple': 10, circuit: 3 },
  'acc-sword': { 'mat-diamond': 4, 'mat-ingot-purple': 1, 'mat-ingot-silver': 8, 'mat-wood': 6, part: 4, circuit: 2 },
  'acc-sword-amethyst': { 'mat-wood': 3, 'mat-ingot-silver': 5, 'mat-ingot-purple': 5, part: 2 },
  'acc-armor-amethyst': { 'mat-ingot-purple': 8, part: 2, circuit: 1 },
};
/** 打造配方（服务端权威）：id → { name, cost, max } */
export const BUILD_RECIPES = {
  'tree-farm': { name: '树场', cost: { 'mat-wood': 10, 'mat-ingot-silver': 5 }, max: 1 },
  'basic-mine': { name: '矿场', cost: { 'mat-wood': 20, 'mat-ingot-silver': 10 }, max: 1 },
  'enchant-table': { name: '饰品强化台', cost: { 'mat-ingot-silver': 20, 'mat-diamond': 10 }, max: 1 },
  'forge-table': { name: '饰品锻造台', cost: { 'mat-wood': 10, 'mat-ingot-silver': 5 }, max: 1 },
  'agent-hub': { name: '子代理管理台', cost: { 'mat-ingot-purple': 3, 'mat-diamond': 5, 'mat-ingot-silver': 10 }, max: 1 },
  'training-dummy': { name: '训练假人', cost: { 'mat-wood': 10 }, max: 3 },
};
const RES_NAMES = { 'mat-wood': '木材', 'mat-ingot-silver': '铁锭', 'mat-diamond': '钻石', 'mat-ingot-purple': '紫晶锭', 'ore-iron': '铁矿石', 'ore-diamond': '钻石原石', 'ore-amethyst': '紫晶原石', gear: '齿轮', part: '机械零件', circuit: '电路板', 'token-ticket': 'token 券' };


/** 饰品品质 → 可嵌孔数；acc-knife 为白，acc-knife-<color> 依次 2~6 孔 */
const ACC_SOCKETS = { white: 1, green: 2, blue: 3, purple: 4, orange: 5, red: 6 };
const ACC_COLORS = { green: 'green', blue: 'blue', purple: 'purple', orange: 'orange', red: 'red' };
/** 品质覆盖表：id 不以颜色结尾的饰品（如钻石小刀）在这里显式指定品质 */
const ACC_QUALITY = { 'acc-knife': 'white', 'acc-knife-diamond': 'green', 'acc-sword': 'blue', 'acc-fish-ring': 'blue', 'acc-chip': 'blue', 'acc-sword-long': 'white', 'acc-sword-diamond': 'green', 'acc-sword-amethyst': 'blue', 'acc-armor-wood': 'white', 'acc-armor-iron': 'white', 'acc-armor-diamond': 'green', 'acc-armor-amethyst': 'blue' };
/** 专属词条（蓝色及以上）：组内全局唯一，强化时只能作为基底不能作为耗材 */
const ACC_EXCLUSIVE = { 'acc-sword': 'normal-attack', 'acc-fish-ring': 'special', 'acc-chip': 'special' };
/** 虚拟海边解锁碎片 */
const ROOM3_FRAGMENT = 'frag-room3';
const ROOM3_NEED = 5;
const EXCLUSIVE_NAMES = { 'normal-attack': '普通攻击替换为剑技', 'special': '特殊效果（鱼跃 / 心流）' };
/**
 * 饰品基底 → 自身第一条词条的区间（强化时「按耗材自己的第一条词条」写入，而不是写死 5-10）。
 * 不在表里的按 5-10 兜底。
 */
const ACC_AFFIX = { 'acc-knife': [5, 10], 'acc-knife-diamond': [10, 15], 'acc-sword': [5, 10], 'acc-fish-ring': [5, 10], 'acc-chip': [5, 10], 'acc-sword-long': [8, 15], 'acc-sword-diamond': [20, 30], 'acc-sword-amethyst': [30, 50] };
/** 关卡内商店（服务端权威价格） */
const LEVEL_SHOP = {
  [ROOM3_FRAGMENT]: { price: 10000, label: '海边模板', repeatable: true },   // 第 5 关海边商店：宝剑已下架，改卖海边模板
  'bait-pixel': { price: 2000, label: '像素鱼饵', repeatable: true },   // 虚拟海边的鱼饵铺
};
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
/** 饰品品质 → 卖价（必须与客户端 ACC_SELL_BY_QUALITY / accSellPrice 一致，否则「显示价」和「到账」会不一致） */
const ACC_SELL_BY_QUALITY = { white: 100, green: 250, blue: 600, purple: 1200, orange: 2500, red: 5000 };
export function accSellPriceOf(item) {
  const base = accBaseOf(item);
  if (!base.startsWith('acc-')) return 0;
  const tail = base.split('-').pop();
  const q = ACC_QUALITY[base] || ACC_COLORS[tail] || 'white';
  const basePrice = ACC_SELL_BY_QUALITY[q] ?? 150;
  const enhanced = /~|#/.test(String(item));   // 带词条/强化序号的独立个体 → ×1.5
  return Math.round(basePrice * (enhanced ? 1.5 : 1));
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
  // 钓鱼房（room 2）不允许摆家具：历史误放的直接拆掉，东西原样退回背包
  {
    const stray = [];
    const keptChests = [];
    for (const c of (g.chests ?? [])) {
      if (Math.floor(Number(c.room) || 0) !== 2 || c.kind === 'ender-chest') { keptChests.push(c); continue; }
      stray.push(c.kind === 'record-player' ? 'record-player' : 'wooden-chest');
      for (const sl of (c.slots ?? [])) if (sl && typeof sl.item === 'string') for (let i = 0; i < Math.max(1, Math.floor(Number(sl.count) || 1)); i++) stray.push(sl.item);
    }
    const keptDevices = [];
    for (const d of (g.devices ?? [])) {
      if (Math.floor(Number(d.room) || 0) !== 2) { keptDevices.push(d); continue; }
      stray.push(d.kind);
    }
    if (stray.length) { g.chests = keptChests; g.devices = keptDevices; g.inventory = [...(g.inventory ?? []), ...stray]; }
  }
  return {
    gold: g.gold,
    initialWeapon: g.initialWeapon,
    passives: g.passives,
    inventory: g.inventory,
    accessories: g.accessories,
    activeSkill: g.activeSkill,
    unlockedSkills: g.unlockedSkills ?? [],
    clearedLevels: g.clearedLevels ?? [],
    storyIntroDone: g.storyIntroDone ?? true,
    rooms: g.rooms ?? [0, 1],
    chests: (g.chests ?? []).map((c) => {
      const kind = CHEST_KINDS.has(c.kind) ? c.kind : 'chest';
      const cap = chestCap(kind);
      return { id: c.id, kind, mode: c.mode === 'single' || c.mode === 'loop' ? c.mode : 'seq', room: Number(c.room) || 0, x: Number(c.x) || 300, y: Number(c.y) || 340, slots: Array.from({ length: cap }, (_, i) => { const s2 = c.slots?.[i]; return s2 && typeof s2 === 'object' && typeof s2.item === 'string' ? { item: s2.item, count: Math.max(1, Math.floor(Number(s2.count) || 1)) } : null; }) };
    }),
    /** 强化台暂存区（客户端用它恢复台面显示；装填那刻物品已从背包扣除） */
    enchantStage: (() => {
      const st = g.enchantStage;
      if (!st || typeof st.baseId !== 'string' || typeof st.materialId !== 'string') return null;
      return { baseId: st.baseId, materialId: st.materialId, lucky: Math.max(0, Math.floor(Number(st.lucky) || 0)) };
    })(),
    /** 锻造：进行中的任务（客户端本地算进度）+ 成品仓（点击取出才进背包） */
    forgeJobs: (g.forgeJobs ?? []).map((j) => ({ id: String(j.id ?? ''), product: String(j.product ?? ''), readyAt: Number(j.readyAt) || 0 })),
    forgeStore: Object.entries(g.forgeStore ?? {}).map(([product, n]) => ({ product, count: Math.max(0, Math.floor(Number(n) || 0)) })).filter((x) => x.count > 0),
    craftingStorage: g.craftingStorage ?? [],
    groundItems: (g.groundItems ?? []).map((x) => ({ ...x, room: Number(x.room) || 0 })),
    devices: (g.devices ?? []).map((d) => ({ id: d.id, kind: d.kind, room: Number(d.room) || 0, x: Number(d.x) || 300, y: Number(d.y) || 340, built: d.built !== false, level: d.level, auto: d.auto, buf: d.buf })),
    /** 实验室（集成工业）：客户端跑 tick，服务端只存快照 */
    lab: (() => {
      const lab = g.lab ?? {};
      return {
        stage: Math.max(0, Math.min(4, Math.floor(Number(lab.stage) || 0))),
        power: { stored: Math.max(0, Number(lab.power?.stored) || 0), cap: Math.max(60, Number(lab.power?.cap) || 100), brownout: !!lab.power?.brownout },
        grid: (lab.grid ?? []).map((c) => ({
          id: c.id, kind: c.kind, x: c.x, y: c.y, dir: c.dir, item: c.item ?? null, prog: Number(c.prog) || 0,
          sides: Array.isArray(c.sides) && c.sides.length === 4 ? c.sides : [1, 2, 1, 1],   // 六面 IO：漏了它客户端就永远显示默认值
          filter: c.filter ?? [], mode: c.mode ?? 'alt', recipe: c.recipe ?? null,
          slots: c.slots ?? [], in: c.in ?? [], out: c.out ?? [], fuel: Number(c.fuel) || 0,
        })),
        store: Object.entries(lab.store ?? {}).map(([item, n]) => ({ item, count: Math.max(0, Math.floor(Number(n) || 0)) })).filter((x) => x.count > 0),
        blueprints: lab.blueprints ?? [],
      };
    })(),
    // 子代理：数量 + 每个的任务（不加进去的话客户端拿不到，面板会一直显示 0/5）
    agents: Math.max(0, Math.min(5, Math.floor(Number(g.agents) || 0))),
    agentTasks: Array.from({ length: Math.max(0, Math.min(5, Math.floor(Number(g.agents) || 0))) }, (_, i) => {
      const t = (g.agentTasks ?? [])[i];
      return AGENT_TASKS.has(t) ? t : 'idle';
    }),
  };
}
export function passiveUpgradeCost(level) {
  return 100 * (Number(level) + 1);
}

/** 背包材料校验/扣除：不足返回 null，够则返回扣完的新数组 */
function takeMaterials(inv, need) {
  const arr = [...(inv ?? [])];
  for (const [k, n] of Object.entries(need ?? {})) {
    let left = Math.floor(Number(n) || 0);
    for (let i = arr.length - 1; i >= 0 && left > 0; i--) { if (arr[i] === k) { arr.splice(i, 1); left--; } }
    if (left > 0) return null;
  }
  return arr;
}
/** 拆除返还（默认 50%，向下取整） */
function refundMaterials(inv, need, ratio = 1) {
  const arr = [...(inv ?? [])];
  for (const [k, n] of Object.entries(need ?? {})) {
    const c = Math.max(0, Math.floor((Number(n) || 0) * ratio));
    for (let i = 0; i < c; i++) arr.push(k);
  }
  return arr;
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
  sweepForge(g);   // 锻造：到点的任务结算进成品仓
  // 技能书通过碎片合成获取；unlockedSkills 永久保留已学技能
  g.unlockedSkills = Array.isArray(g.unlockedSkills) ? g.unlockedSkills.filter((x) => ACTIVE_SKILL_IDS.includes(x)) : [];
  if (g.activeSkill && !ACTIVE_SKILL_IDS.includes(g.activeSkill)) g.activeSkill = null;
  if (g.activeSkill && !g.unlockedSkills.includes(g.activeSkill)) g.unlockedSkills.push(g.activeSkill);
  if (!g.activeSkill && g.unlockedSkills.length > 0) g.activeSkill = g.unlockedSkills[0];
  if (!Array.isArray(g.chests)) g.chests = [];
  if (!Array.isArray(g.craftingStorage)) g.craftingStorage = [];
  if (!Array.isArray(g.groundItems)) g.groundItems = [];
  // ── 布局迁移 v1 → v2：木屋(0)+黑白房(1) 合并成一个大房间（客厅 y>600 / 实验室 y<520） ──
  if ((g.layoutVersion ?? 1) < 2) {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || a));
    const mapItem = (o) => {
      const r = Number(o.room) || 0;
      if (r === 2) return o;                                   // 虚拟海边不动
      if (r === 1) return { ...o, room: 0, x: clamp(o.x, 40, 800), y: clamp((Number(o.y) || 0) + 520, 540, 1020) };   // 黑白房 → 客厅（左）
      return { ...o, room: 0, x: clamp((Number(o.x) || 0) + 840, 880, 1650), y: clamp((Number(o.y) || 0) + 520, 540, 1020) };   // 木屋 → 卧室（右）
    };
    g.chests = (g.chests ?? []).map(mapItem);
    g.devices = (g.devices ?? []).map((d) => {
      const m = mapItem(d);
      if (m.kind === 'basic-mine') return { ...m, level: clamp(Number(m.level) || 1, 1, 3), x: clamp(m.x, 80, 1600), y: clamp(m.y, 120, 440), buf: m.buf ?? {} };
      if (m.kind === 'tree-farm') return { ...m, y: clamp(m.y, 700, 1080) };
      return m;
    });
    g.groundItems = (g.groundItems ?? []).map(mapItem);
    g.rooms = (g.rooms ?? [0, 1]).filter((r) => Number(r) !== 1);
    g.layoutVersion = 2;
  }
  g.layoutVersion = 2;
  sanitizeLab(g);
  // 家房间：0（大房间）恒开放，2（虚拟海边）需解锁；房间 1 已并入 0
  g.rooms = Array.isArray(g.rooms)
    ? [...new Set(g.rooms.map((x) => Math.floor(Number(x) || 0)).filter((x) => x === 0 || x === 2))]
    : [0];
  if (!g.rooms.includes(0)) g.rooms.unshift(0);
  // 子代理：数量 0~5，任务数组长度对齐，非法任务名回落到「随意」
  g.agents = Math.max(0, Math.min(5, Math.floor(Number(g.agents) || 0)));
  if (!Array.isArray(g.agentTasks)) g.agentTasks = [];
  g.agentTasks = Array.from({ length: g.agents }, (_, i) => {
    const t = g.agentTasks[i];
    return AGENT_TASKS.has(t) ? t : 'idle';
  });
  g.chests = g.chests.map((c, i) => {
    const kind = CHEST_KINDS.has(c?.kind) ? c.kind : 'chest';
    const cap = chestCap(kind);
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
      mode: c?.mode === 'single' || c?.mode === 'loop' ? c.mode : 'seq',
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
      // 矿场：等级 / 钻机 / 产出缓冲（其它器械也原样保留这几项，不影响）
      level: x.kind === 'basic-mine' ? Math.max(1, Math.min(3, Math.floor(Number(x.level) || 1))) : undefined,
      auto: x.kind === 'basic-mine' ? !!x.auto : undefined,
      buf: x.kind === 'basic-mine' && x.buf && typeof x.buf === 'object' ? x.buf : undefined,
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
    'skill-book-purge': 'purge',
  };
  if (item !== 'newbie-gift' && item !== 'token-ticket' && !books[item]) return g;
  const inv = Array.isArray(g.inventory) ? [...g.inventory] : [];
  const idx = inv.indexOf(item);
  if (idx < 0) return g;
  inv.splice(idx, 1);
  if (item === 'token-ticket') {
    return { ...g, gold: (Number(g.gold) || 0) + 5000, inventory: inv };
  }
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
export const ACTIVE_SKILL_IDS = ['strike', 'teleport-laser', 'damage-laser', 'railgun', 'purge'];

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
    // 第 5 关（Boss 翻卡）：固定 1 张「海边模板」+ 钻石 / 紫晶锭
    out.push({ kind: 'fragment', item: ROOM3_FRAGMENT, label: '海边模板' });
    while (out.length < 3) out.push({ kind: 'mat', item: Math.random() < 0.5 ? 'mat-diamond' : 'mat-ingot-purple' });
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
      storyIntroDone: z.boolean().default(true),   // 老档没这字段 → 视为已过开局剧情
      clearedLevels: z.array(z.string()).default([]),
      rooms: z.array(z.number()).default([0, 1]),   // 已解锁的家房间（0=主房间, 1=房间1, 2=虚拟海边）
      chests: z.array(z.object({ id: z.string(), kind: z.string().default('chest'), room: z.number().default(0), x: z.number().default(300), y: z.number().default(340), slots: z.array(z.union([z.object({ item: z.string(), count: z.number().default(1) }), z.null()])).max(30), mode: z.union([z.string(), z.null()]).optional() })).default([]),
      craftingStorage: z.array(z.union([z.string(), z.null()])).max(11).default([]),
      groundItems: z.array(z.object({ id: z.string(), item: z.string(), room: z.number().default(0), x: z.number(), y: z.number() })).default([]),
      devices: z.array(z.object({ id: z.string(), kind: z.string(), room: z.number().default(0), x: z.number().default(300), y: z.number().default(340), built: z.boolean().default(true), level: z.number().optional(), auto: z.boolean().optional(), buf: z.record(z.string(), z.number()).optional() })).default([]),
      /** 家/实验室布局版本：1=旧（木屋+黑白房分开），2=大房间（客厅+实验室） */
      layoutVersion: z.number().default(2),
      /**
       * 实验室（集成工业）：整体 passthrough —— 网格里的件字段会随版本增加（sides/slots/in/out/fuel/prog…），
       * 逐个声明很容易漏，漏了就会被 z.object 剥掉（表现：IO 配置/箱子内容一读就回默认）。
       * 内容合法性由 sanitizeLab 负责，这里只保证「是个对象、不会丢字段」。
       */
      lab: z.object({}).passthrough().default({
        stage: 0,
        power: { stored: 100, cap: 100, brownout: false },
        grid: [],
        store: {},
        blueprints: ['smelter', 'assembler'],
        stats: { produced: {} },
      }),
      agents: z.number().default(0),
      agentTasks: z.array(z.string()).default([]),
      containerMigrated: z.boolean().default(false),
      // ⚠ 这三个必须留在 schema 里：z.object 会把未声明的字段剥掉（当年 devices 丢树场同一个坑），
      // 表现是「强化到一半的材料不见了 / 锻造队列和成品仓一读就空」
      enchantStage: z.union([z.object({ baseId: z.string(), materialId: z.string(), lucky: z.number().default(0) }), z.null()]).default(null),
      forgeJobs: z.array(z.object({ id: z.string(), product: z.string(), readyAt: z.number() })).max(20).default([]),
      forgeStore: z.record(z.string(), z.number()).default({}),
    }),
    initial: { ...DEFAULT_GLOBAL },
  },
});

// ─── 多存档（S1+S2）：元数据 domain ─────────────────────────────────────────
// 设计：vsGameDomain.global 永远持有「当前活跃档」的工作副本（30+ 个现有消息
// 处理器零改动）；槽位全量数据 + 活跃槽指针 + introSeen 存在这个独立 domain 里。
// 切档 = 把当前 global 写回 meta 槽位，再把目标槽数据装载进 global。
export const SAVE_SLOT_IDS = ['slot1', 'slot2', 'slot3'];
export const DEFAULT_META = {
  activeSlot: 'slot1',
  introSeen: false,
  migrated: false,
  slots: SAVE_SLOT_IDS.map((id) => ({ id, savedAt: 0, data: null })),
};
const vsGameMetaDomain = defineDomain({
  name: 'vs_game_meta',
  version: 1,
  tables: {},
  global: {
    schema: z.object({
      activeSlot: z.string().default('slot1'),
      introSeen: z.boolean().default(false),
      migrated: z.boolean().default(false),
      slots: z.array(z.object({
        id: z.string(),
        savedAt: z.number().default(0),
        data: z.any().default(null),
      })).default([]),
    }),
    initial: { ...DEFAULT_META },
  },
});
/** 设置兜底 domain：运行环境没提供 settings 服务时，用户设置存这里（否则 PATCH 会 503） */
const VS_CFG_DEFAULT = { idleSpawnRate: 3, sfxVolume: 100, bgmVolume: 100, autoPause: true, autoSelect: false, difficulty: 'normal' };
const vsGameCfgDomain = defineDomain({
  name: 'vs_game_config',
  version: 1,
  tables: {},
  global: {
    schema: z.object({
      idleSpawnRate: z.number().default(3),
      sfxVolume: z.number().default(100),
      bgmVolume: z.number().default(100),
      autoPause: z.boolean().default(true),
      autoSelect: z.boolean().default(false),
      difficulty: z.string().default('normal'),
    }),
    initial: { ...VS_CFG_DEFAULT },
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
  const persist = { domain: null, settingsScope: null, cfgDomain: null, meta: null };
  const readGlobal = () => sanitizeGlobal({
    ...DEFAULT_GLOBAL,
    ...(persist.domain ? persist.domain.global.get() ?? {} : {}),
  });
  /** 用户设置读取：有 settings 服务就用它（桌面端设置面板能同步），否则用兜底 domain，再不行退回静态 cfg */
  const readSettings = () => {
    if (persist.settingsScope) return { ...cfg, ...persist.settingsScope.get() };
    if (persist.cfgDomain) return { ...cfg, ...(persist.cfgDomain.global.get() ?? {}) };
    return { ...cfg };
  };
  // ── 多存档：meta 读写（与 mutateGlobal 相互独立的串行链） ──
  const readMeta = () => {
    const m = { ...DEFAULT_META, ...(persist.meta ? persist.meta.global.get() ?? {} : {}) };
    m.slots = SAVE_SLOT_IDS.map((id) => {
      const found = (Array.isArray(m.slots) ? m.slots : []).find((s) => s && s.id === id);
      return found ? { id, savedAt: Number(found.savedAt) || 0, data: found.data ?? null } : { id, savedAt: 0, data: null };
    });
    if (!SAVE_SLOT_IDS.includes(m.activeSlot)) m.activeSlot = 'slot1';
    return m;
  };
  let metaChain = Promise.resolve();
  async function mutateMeta(fn) {
    const run = metaChain.then(async () => {
      if (!persist.meta) return readMeta();
      const m = readMeta();
      const next = fn({ ...m, slots: m.slots.map((s) => ({ ...s })) });
      await persist.meta.global.set(next);
      return next;
    });
    metaChain = run.catch(() => {});
    return run;
  }
  /** 槽位摘要（发给标题画面的存档槽 UI） */
  function savesSummary(m = null) {
    const meta = m ?? readMeta();
    return {
      activeSlot: meta.activeSlot,
      introSeen: !!meta.introSeen,
      slots: meta.slots.map((s) => ({
        id: s.id,
        exists: !!s.data,
        gold: Math.max(0, Math.floor(Number(s.data?.gold) || 0)),
        kills: Math.max(0, Math.floor(Number(s.data?.totalKills) || 0)),
        rooms: Array.isArray(s.data?.rooms) ? s.data.rooms.length : 0,
        cleared: Array.isArray(s.data?.clearedLevels) ? s.data.clearedLevels.length : 0,
        savedAt: Number(s.savedAt) || 0,
      })),
    };
  }
  /** 把活跃档工作副本快照进 meta 的当前槽（每次改档后写穿，切档/重启不丢） */
  async function snapshotActiveSlot(g) {
    if (!persist.meta) return;
    await mutateMeta((m) => ({
      ...m,
      slots: m.slots.map((s) => (s.id === m.activeSlot ? { ...s, data: g, savedAt: Date.now() } : s)),
    }));
  }
  /** 切换活跃槽：当前档写回 → 目标槽数据装载进 global → 回全量 HELLO + SAVE_SLOTS */
  async function switchToSlot(ws, slotId, freshData = null) {
    if (!persist.domain || !persist.meta) return;
    if (!SAVE_SLOT_IDS.includes(slotId)) return;
    const g = readGlobal();
    await mutateMeta((m) => {
      let slots = m.slots.map((s) => (s.id === m.activeSlot ? { ...s, data: g, savedAt: Date.now() } : s));
      slots = slots.map((s) => (s.id === slotId
        ? (freshData ? { id: s.id, savedAt: Date.now(), data: freshData } : s)
        : s));
      return { ...m, slots, activeSlot: slotId };
    });
    const m2 = readMeta();
    const data = m2.slots.find((s) => s.id === slotId)?.data ?? null;
    await persist.domain.global.set(data ? { ...data } : { ...DEFAULT_GLOBAL, initialDataReset: true });
    ws.send(encodeMsg({
      kind: HostMsg.HELLO,
      snapshot: snapshot(),
      config: publicConfig(),
      best: readGlobal().bestScore,
      discovered: readGlobal().discovered,
      character: toCharacter(readGlobal()),
      levels: LEVELS,
      saves: savesSummary(m2),
    }));
    ws.send(encodeMsg({ kind: HostMsg.SAVE_SLOTS, saves: savesSummary(m2) }));
  }
  const publicConfig = () => {
    const st = readSettings();
    return {
      idleSpawnRate: st.idleSpawnRate,
      autoPause: st.autoPause,
      autoSelect: st.autoSelect,
      difficulty: st.difficulty,
      sfxVolume: st.sfxVolume,
      bgmVolume: st.bgmVolume,
    };
  };
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
      // 连接建立只发「标题流程」需要的东西：配置 + 关卡表 + 各档位摘要。
      // 存档本体（character / best / discovered）要等玩家在标题里选完档位、走 switchToSlot 才下发，
      // 否则开场动画期间旧存档就已经被载进客户端了（会漏进无障碍树/焦点，也会让旧档先跑起来）。
      ws.send(encodeMsg({
        kind: HostMsg.HELLO,
        snapshot: snapshot(),
        config: publicConfig(),
        levels: LEVELS,
        saves: savesSummary(),
        awaitSlot: true,
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
      snapshotActiveSlot(next).catch(() => {});   // 写穿到 meta 槽位（失败不影响主档）
      return next;
    });
    mutateChain = run.catch(() => {});
    return run;
  }

  function handleClientMsg(ws, msg) {
    switch (msg.kind) {
      case ClientMsg.SAVE_LIST:
        ws.send(encodeMsg({ kind: HostMsg.SAVE_SLOTS, saves: savesSummary() }));
        break;
      case ClientMsg.INTRO_SEEN:
        mutateMeta((m) => ({ ...m, introSeen: true })).catch((e) => logger.warn('intro seen failed:', e));
        break;
      case ClientMsg.SAVE_SELECT: {
        const slotId = typeof msg.slot === 'string' ? msg.slot : '';
        const target = readMeta().slots.find((s) => s.id === slotId);
        if (!target || !target.data) {
          ws.send(encodeMsg({ kind: HostMsg.SAVE_SLOTS, saves: savesSummary(), error: 'slot-empty' }));
          break;
        }
        switchToSlot(ws, slotId).catch((e) => logger.warn('save select failed:', e));
        break;
      }
      case ClientMsg.SAVE_NEW: {
        const slotId2 = typeof msg.slot === 'string' ? msg.slot : '';
        if (!SAVE_SLOT_IDS.includes(slotId2)) break;
        // 新档开荒：目标槽清成初始状态并切过去（覆盖已有档 = 覆盖确认由客户端 UI 负责）
        switchToSlot(ws, slotId2, { ...DEFAULT_GLOBAL, initialDataReset: true })
          .catch((e) => logger.warn('save new failed:', e));
        break;
      }
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
          else if (typeof card.item === 'string' && /^(acc-|mat-|tool-|skill-fragment|frag-)/.test(card.item)) next.inventory = [...next.inventory, card.item];
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
          const drop = { id: 'g' + Date.now().toString(36), item: product, room: 0, x: (Number(msg.x) || 1070) + (Math.random() * 12 - 6), y: (Number(msg.y) || 960) + (Math.random() * 12 - 6) };
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
          : /^fish-/.test(item) ? 500          // 钓上来的鱼：500/条
          : item === 'record-billie-jean' ? 500
          : item === 'record-letmego' ? 500
          : item === 'record-bad-apple' ? 500
          : item === 'record-world-execute-me' ? 500
          : item.startsWith('acc-') ? accSellPriceOf(item)
          : item.startsWith('mat-') ? 80
          : item === 'skill-fragment' ? 500
          : item === 'skill-fragment-teleport' || item === 'skill-fragment-damage' || item === 'skill-fragment-railgun' ? 500
          : item === 'skill-fragment-purge' ? 5000
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
      case ClientMsg.USE_BAIT: {
        // 投放鱼饵：扣 1 个（服务端权威），客户端负责显示浮标与钓鱼流程
        const gB = readGlobal();
        const bi = (gB.inventory ?? []).indexOf('bait-pixel');
        if (bi < 0) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '没有鱼饵了，去海边商店买' })); break; }
        mutateGlobal((g) => { const inv = [...(g.inventory ?? [])]; const k = inv.indexOf('bait-pixel'); if (k >= 0) inv.splice(k, 1); return { ...g, inventory: inv }; })
          .then((g) => sendCharacter(ws, g))
          .catch((e) => logger.warn('use bait failed:', e));
        break;
      }
      case ClientMsg.DROP_GROUND: {
        // 虚拟海边钓上的鱼丢在地上（家里地面物由服务端持有，客户端按 PICKUP_GROUND 捡）
        const dItem = typeof msg.item === 'string' && /^(fish-|acc-|mat-|tool-|skill-)/.test(msg.item) ? msg.item : null;   // skill-：河豚 BOSS 掉的技能碎片
        if (!dItem) break;
        const dRoom = Math.max(0, Math.min(2, Math.floor(Number(msg.room) || 0)));
        const dx = Math.max(0, Math.min(4000, Number(msg.x) || 300));
        const dy = Math.max(0, Math.min(4000, Number(msg.y) || 340));
        mutateGlobal((g) => {
          const list = Array.isArray(g.groundItems) ? g.groundItems : [];
          const id = 'g' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
          return { ...g, groundItems: [...list, { id, item: dItem, x: dx, y: dy, room: dRoom }] };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('drop ground failed:', e));
        break;
      }
      case ClientMsg.UNLOCK_ROOM: {
        // 开启虚拟海边：需要 ROOM3_NEED 个海边模板，服务端权威扣除
        const wantRoom = Math.floor(Number(msg.room) || 0);
        if (wantRoom !== 2) break;
        const gU = readGlobal();
        const roomsU = Array.isArray(gU.rooms) ? gU.rooms : [0, 1];
        if (roomsU.includes(2)) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '虚拟海边已经开启了' })); break; }
        const have = (gU.inventory ?? []).filter((x) => x === ROOM3_FRAGMENT).length;
        if (have < ROOM3_NEED) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '海边模板不足：' + have + '/' + ROOM3_NEED })); break; }
        mutateGlobal((g) => {
          const inv = [...(g.inventory ?? [])];
          for (let i = 0; i < ROOM3_NEED; i++) { const k = inv.indexOf(ROOM3_FRAGMENT); if (k >= 0) inv.splice(k, 1); }
          return { ...g, inventory: inv, rooms: [...new Set([...(g.rooms ?? [0, 1]), 2])] };
        })
          .then((g) => { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '🚪 虚拟海边开启了！' })); sendCharacter(ws, g); })
          .catch((e) => logger.warn('unlock room failed:', e));
        break;
      }
      case ClientMsg.LEVEL_SHOP_BUY: {
        // 关卡内商店：价格以服务端表为准；同一件只卖一次（拥有任意同基底强化形态也算）
        const shopItem = typeof msg.item === 'string' ? msg.item : null;
        const shopEntry = shopItem ? LEVEL_SHOP[shopItem] : null;
        if (!shopEntry) break;
        const reply2 = (text) => ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text }));
        const g0s = readGlobal();
        const ownsBase = !shopEntry.repeatable && ((g0s.inventory ?? []).some((x) => accBaseOf(x) === shopItem)
          || (Array.isArray(g0s.accessories) ? g0s.accessories : []).some((x) => x && accBaseOf(x) === shopItem));
        if (ownsBase) { reply2('已经买过「' + shopEntry.label + '」了'); break; }
        if ((g0s.gold ?? 0) < shopEntry.price) { reply2('token 不够（需要 ' + shopEntry.price + '）'); break; }
        mutateGlobal((g) => ({ ...g, gold: g.gold - shopEntry.price, inventory: [...(g.inventory ?? []), shopItem] }))
          .then((g) => { reply2('购买成功：获得 ' + shopEntry.label); sendCharacter(ws, g); })
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
          : item === 'skill-fragment-purge' ? 10000
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
        const item = typeof msg.item === 'string' && /^(acc-|mat-|tool-|ore-|gear$|part$|circuit$|token-ticket$)/.test(msg.item) ? msg.item : null;
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
        // 服务型容器：末影箱（鱼饵铺提供，不消耗物品、不进房间展示）
        if (msg.service === 'ender-chest' || msg.service === 'record-service') {
          const kind = msg.service === 'ender-chest' ? 'ender-chest' : 'smart-record';
          mutateGlobal((g) => {
            const chests = [...(g.chests ?? [])];
            if (chests.some((c) => c.kind === kind && (Number(c.room) === -1))) return g;
            chests.push({ id: 'chest-' + kind + '-' + Date.now().toString(36), kind, room: -1, x: 24, y: 24, slots: Array.from({ length: chestCap(kind) }, () => null) });
            return { ...g, chests };
          }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('service chest failed:', e));
          break;
        }
        if (Number(msg.room) === 2) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '虚拟海边不能摆家具' })); break; }
        const placeItem = typeof msg.placeItem === 'string' ? msg.placeItem : 'wooden-chest';
        const kind = msg.containerKind === 'record-player' ? 'record-player' : 'chest';
        const g0 = readGlobal();
        if (!(g0.inventory ?? []).includes(placeItem)) {
          ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '放置失败：背包没有该物品' }));
          break;
        }
        // v0.7 家是 1680×1040 的大房间（L 形：工作区 y<500 / 客厅卧室 y>520），别再按旧的 840×520 夹
        const x = Math.max(30, Math.min(1650, Number(msg.x) || 300));
        const y = Math.max(130, Math.min(1020, Number(msg.y) || 340));
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
          const cap = chestCap(chest.kind);
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
        // 拖动同理：按 v0.7 大房间 1680×1040 的边界，旧值会把东西吸回左上角
        const x = Math.max(30, Math.min(1650, Number(msg.x) || 300));
        const y = Math.max(130, Math.min(1020, Number(msg.y) || 340));
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
        if (Number(msg.room) === 2) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '虚拟海边不能摆器械' })); break; }
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
        // v0.7 大房间 1680×1040：旧值 810×490 会把所有器械压到左上角
        const x = Math.max(30, Math.min(1650, Number(msg.x) || 300));
        const y = Math.max(160, Math.min(1020, Number(msg.y) || 340));
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
      case ClientMsg.ENCHANT_STAGE: {
        // 强化台装填/取回：装填那刻就把物品移出背包（防重复使用，刷新后仍在台面上）
        mutateGlobal((g) => {
          const inv = [...(g.inventory ?? [])];
          const old = g.enchantStage;
          if (old && typeof old.baseId === 'string') {   // 上一份暂存原样退回
            inv.push(old.baseId);
            if (typeof old.materialId === 'string') inv.push(old.materialId);
            for (let i = 0; i < Math.max(0, Math.floor(Number(old.lucky) || 0)); i++) inv.push(LUCKY_STONE);
          }
          const cleared = { ...g, inventory: inv, enchantStage: null };
          if (msg.clear === true) return cleared;
          const baseId = typeof msg.baseId === 'string' ? msg.baseId : null;
          const materialId = typeof msg.materialId === 'string' ? msg.materialId : null;
          if (!baseId || !materialId) return cleared;
          const take = (it) => { const i = inv.indexOf(it); if (i < 0) return false; inv.splice(i, 1); return true; };
          if (!take(baseId)) return cleared;
          if (!take(materialId)) { inv.push(baseId); return { ...g, inventory: inv, enchantStage: null }; }
          let lucky = 0;
          const want = Math.max(0, Math.min(9, Math.floor(Number(msg.lucky) || 0)));
          for (let i = 0; i < want; i++) if (take(LUCKY_STONE)) lucky++;
          return { ...g, inventory: inv, enchantStage: { baseId, materialId, lucky } };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('enchant stage failed:', e));
        break;
      }
      case ClientMsg.ENCHANT: {
        const reply = (text) => ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text }));
        const g0 = readGlobal();
        const stage = g0.enchantStage && typeof g0.enchantStage === 'object' ? g0.enchantStage : null;
        const baseId = stage?.baseId ?? (typeof msg.baseId === 'string' ? msg.baseId : null);
        const materialId = stage?.materialId ?? (typeof msg.materialId === 'string' ? msg.materialId : null);
        if (!baseId || !materialId) { reply('强化失败：台面没有装填'); break; }
        const inv0 = Array.isArray(g0.inventory) ? g0.inventory : [];
        if (!stage) {   // 旧路径兜底：没有暂存区时按背包校验
          const bN = inv0.filter((x) => x === baseId).length;
          const mN = inv0.filter((x) => x === materialId).length;
          if (bN < 1 || mN < 1 || (baseId === materialId && bN < 2)) { reply('强化失败：基底或材料不足'); break; }
        }
        const sockets = accSockets(baseId);
        const idx = accAffixesOf(baseId).length;
        if (!sockets || idx >= sockets) { reply('强化失败：没有空孔了'); break; }
        // 幸运石：每颗 +10% 成功率，总上限 100%；多于「拉满所需」的部分不消耗
        const wantStones = Math.max(0, Math.floor(Number(msg.lucky) || 0));
        const ownedStones = stage ? Math.max(0, Math.floor(Number(stage.lucky) || 0)) : inv0.filter((x) => x === LUCKY_STONE).length;
        const useStones = Math.min(wantStones, ownedStones, luckyNeeded(idx));
        const rate = enchantRate(idx, useStones);
        const ok = Math.random() < rate;
        // 新词条 = 耗材自身的第一条词条（区间写进 token：atk:10-15）
        const matBase = accBaseOf(materialId);
        if (ACC_EXCLUSIVE[matBase]) { reply('强化失败：专属词条饰品只能作为基底，不能当耗材'); break; }
        // 耗材词条：钓上来的鱼带 1 条随机属性 → 直接写进孔；其它饰品按基底区间
        let affixToken = null;
        if (/^fish-/.test(matBase)) {
          const own = accAffixesOf(materialId)[0] ?? '';
          const m2 = /^([a-z_]+):(-?[0-9.]+)(?:-(-?[0-9.]+))?$/.exec(own);
          if (!m2) { reply('强化失败：这条鱼没有可用属性'); break; }
          affixToken = m2[1] + ':' + m2[2] + '-' + (m2[3] ?? m2[2]);
        } else {
          const matRange = ACC_AFFIX[matBase] ?? [5, 10];
          affixToken = 'atk:' + matRange[0] + '-' + matRange[1];
        }
        const newId = ok ? (accBaseOf(baseId) + '~' + accAffixesOf(baseId).concat([affixToken]).join(',') + '#' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36)) : null;
        mutateGlobal((g) => {
          const inv = [...(g.inventory ?? [])];
          const st2 = g.enchantStage && typeof g.enchantStage === 'object' ? g.enchantStage : null;
          if (st2) {
            // 装填模式下：基底/材料/幸运石在装填时已离开背包，这里只结算消耗与返品
            const back = Math.max(0, (Number(st2.lucky) || 0) - useStones);   // 没用掉的幸运石退回
            for (let i = 0; i < back; i++) inv.push(LUCKY_STONE);
            inv.push(ok ? newId : baseId);   // 成功→带新词条的实例入包；失败→原基底退回
            return { ...g, inventory: inv, enchantStage: null };
          }
          for (let i = 0; i < useStones; i++) {        // 旧路径：幸运石必消耗
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
      case ClientMsg.UPGRADE_RECORD: {
        // 唱片机 → 智能唱片机（3 个紫晶锭）：12 个唱片槽，保留原有唱片，默认顺序播放
        const chestId = typeof msg.chestId === 'string' ? msg.chestId : null;
        const reply = (text) => ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text }));
        if (!chestId) break;
        const NEED = 3, ITEM = 'mat-ingot-purple';
        const g0 = readGlobal();
        if ((g0.inventory ?? []).filter((x) => x === ITEM).length < NEED) { reply('升级失败：需要 ' + NEED + ' 个紫晶锭'); break; }
        mutateGlobal((g) => {
          const chests = (g.chests ?? []).map((c) => ({ ...c, slots: [...(c.slots ?? [])] }));
          const chest = chests.find((c) => c.id === chestId);
          if (!chest || chest.kind !== 'record-player') return g;
          const inv = [...(g.inventory ?? [])];
          let n = 0;
          for (let i = 0; i < inv.length && n < NEED; i++) { if (inv[i] === ITEM) { n++; } }
          if (n < NEED) return g;
          let left = NEED;
          for (let i = inv.length - 1; i >= 0 && left > 0; i--) if (inv[i] === ITEM) { inv.splice(i, 1); left--; }
          chest.kind = 'smart-record';
          chest.mode = 'seq';
          while (chest.slots.length < 12) chest.slots.push(null);
          return { ...g, inventory: inv, chests };
        }).then((g) => { sendCharacter(ws, g); reply('🎛 已升级为智能唱片机（12 槽，可设播放模式）'); })
          .catch((e) => logger.warn('upgrade record failed:', e));
        break;
      }
      case ClientMsg.RECORD_MODE: {
        const chestId = typeof msg.chestId === 'string' ? msg.chestId : null;
        const mode = msg.mode === 'single' || msg.mode === 'loop' ? msg.mode : 'seq';
        if (!chestId) break;
        mutateGlobal((g) => {
          const chests = (g.chests ?? []).map((c) => ({ ...c }));
          const chest = chests.find((c) => c.id === chestId);
          if (!chest || chest.kind !== 'smart-record') return g;
          chest.mode = mode;
          return { ...g, chests };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('record mode failed:', e));
        break;
      }
      case ClientMsg.FORGE_CRAFT: {
        // 饰品锻造台：服务端按配方扣材料（fish 按基底计数），成品直接进背包
        const product = typeof msg.item === 'string' ? msg.item : null;
        const reply = (text) => ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text }));
        const need = product ? FORGE_RECIPES[product] : null;
        if (!need) break;
        const baseOf = (x) => String(x).split('~')[0].split('#')[0];
        const countOf = (inv, k) => (/^fish-/.test(k) ? inv.filter((x) => baseOf(x) === k).length : inv.filter((x) => x === k).length);
        const g0 = readGlobal();
        const inv0 = Array.isArray(g0.inventory) ? g0.inventory : [];
        if (!Object.entries(need).every(([k, n]) => countOf(inv0, k) >= n)) { reply('⚒ 锻造失败：材料不足'); break; }
        mutateGlobal((g) => {
          const inv = [...(g.inventory ?? [])];
          for (const [k, n] of Object.entries(need)) {
            let left = n;
            for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
              const match = /^fish-/.test(k) ? baseOf(inv[i]) === k : inv[i] === k;
              if (match) { inv.splice(i, 1); left--; }
            }
          }
          sweepForge(g);   // 先结算已到点的旧任务，再排新任务（成品仓不被覆盖）
          const jobs = Array.isArray(g.forgeJobs) ? [...g.forgeJobs] : [];
          jobs.push({ id: 'fj' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), product, readyAt: Date.now() + forgeDuration(product) });
          return { ...g, inventory: inv, forgeJobs: jobs.slice(-20) };
        }).then((g) => { sendCharacter(ws, g); reply('⚒ 开始锻造'); }).catch((e) => logger.warn('forge craft failed:', e));
        break;
      }
      case ClientMsg.FORGE_SYNC: {
        // 客户端进度条走满：让服务端把到点任务结算进成品仓并回传
        mutateGlobal((g) => sweepForge(g)).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('forge sync failed:', e));
        break;
      }
      case ClientMsg.FORGE_TAKE: {
        // 点成品格取出：整堆进背包
        const product = typeof msg.item === 'string' ? msg.item : null;
        if (!product) break;
        mutateGlobal((g) => {
          sweepForge(g);
          const store = { ...(g.forgeStore ?? {}) };
          const n = Math.max(0, Math.floor(Number(store[product]) || 0));
          if (n <= 0) return g;
          delete store[product];
          return { ...g, inventory: [...(g.inventory ?? []), ...Array(n).fill(product)], forgeStore: store };
        }).then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('forge take failed:', e));
        break;
      }
      case ClientMsg.HIRE_AGENT: {
        const reply = (text) => ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text }));
        const g0 = readGlobal();
        const cur = Math.max(0, Math.min(5, Math.floor(Number(g0.agents) || 0)));
        if (cur >= 5) { reply('子代理已满 5 个'); break; }
        const price = (cur + 1) * 10000;
        if ((Number(g0.gold) || 0) < price) { reply('token 不够（需要 ' + price + '）'); break; }
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
        const task = AGENT_TASKS.has(msg.task) ? msg.task : 'idle';
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
      // ── 实验室 / 集成工业 ──
      case ClientMsg.UPGRADE_MINE: {
        const id = typeof msg.deviceId === 'string' ? msg.deviceId : null;
        if (!id) break;
        const g0 = readGlobal();
        const dev = (g0.devices ?? []).find((d) => d.id === id && d.kind === 'basic-mine' && d.built !== false);
        if (!dev) break;
        const level = Math.max(1, Math.min(3, Number(dev.level) || 1));
        const next = level + 1;
        if (next > 3) break;
        const stageNeed = MINE_LEVEL_STAGE[next] ?? 9;
        if ((Number(g0.lab?.stage) || 0) < stageNeed) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '需要实验室修复到阶段 ' + stageNeed })); break; }
        const inv = takeMaterials(g0.inventory, MINE_UPGRADE[next] ?? {});
        if (!inv) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '升级失败：材料不足' })); break; }
        mutateGlobal((g) => ({ ...g, inventory: inv, devices: (g.devices ?? []).map((d) => (d.id === id ? { ...d, level: next } : d)) }))
          .then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '⛏ 矿场升级到 Lv' + next })); })
          .catch((e) => logger.warn('mine upgrade failed:', e));
        break;
      }
      case ClientMsg.TOGGLE_DRILL: {
        const id = typeof msg.deviceId === 'string' ? msg.deviceId : null;
        if (!id) break;
        const g0 = readGlobal();
        const dev = (g0.devices ?? []).find((d) => d.id === id && d.kind === 'basic-mine' && d.built !== false);
        if (!dev) break;
        if (dev.auto) {
          mutateGlobal((g) => ({ ...g, devices: (g.devices ?? []).map((d) => (d.id === id ? { ...d, auto: false } : d)) }))
            .then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '钻机已拆下' })); }).catch(() => {});
          break;
        }
        const inv = takeMaterials(g0.inventory, DRILL_COST);
        if (!inv) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '装钻机材料不足（铁5 + 齿轮2 + 零件1）' })); break; }
        mutateGlobal((g) => ({ ...g, inventory: inv, devices: (g.devices ?? []).map((d) => (d.id === id ? { ...d, auto: true, buf: d.buf ?? {} } : d)) }))
          .then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '🔧 已装上钻机' })); })
          .catch((e) => logger.warn('drill toggle failed:', e));
        break;
      }
      case ClientMsg.LAB_REPAIR: {
        const g0 = readGlobal();
        const stage = Math.max(0, Math.min(4, Number(g0.lab?.stage) || 0));
        const next = Math.min(4, stage + 1);
        const cost = LAB_STAGE_COST[next];
        if (!cost) break;
        const inv = takeMaterials(g0.inventory, cost);
        if (!inv) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '修复失败：材料不足' })); break; }
        mutateGlobal((g) => ({ ...g, inventory: inv, lab: { ...(g.lab ?? {}), stage: next } }))
          .then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '🔧 工作区已修复（阶段 ' + next + '）' })); })
          .catch((e) => logger.warn('lab repair failed:', e));
        break;
      }
      case ClientMsg.LAB_PLACE: {
        const kindId = typeof msg.kindId === 'string' ? msg.kindId : null;
        const cat = kindId ? LAB_CATALOG[kindId] : null;
        if (!cat) break;
        const g0 = readGlobal();
        if (!(Number(g0.lab?.stage) >= 1)) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '先修复工作区（电闸）' })); break; }
        const x = Math.max(0, Math.min(LAB_GRID_W - 1, Math.floor(Number(msg.x) || 0)));
        const y = Math.max(0, Math.min(LAB_GRID_H - 1, Math.floor(Number(msg.y) || 0)));
        const dir = ((Math.floor(Number(msg.dir) || 0) % 4) + 4) % 4;
        const lab = g0.lab ?? {};
        if ((lab.grid ?? []).length >= 80) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '网格已满（80 台）' })); break; }
        if ((lab.grid ?? []).some((c) => c.x === x && c.y === y)) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '这一格被占了' })); break; }
        const inv = takeMaterials(g0.inventory, cat.cost);
        if (!inv) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '材料不足' })); break; }
        const cell = {
          id: 'lc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          kind: kindId, x, y, dir, item: null, prog: 0, filter: [], mode: 'alt', recipe: null,
          slots: cat.slots ? Array.from({ length: cat.slots }, () => null) : [],
          in: [], out: [], fuel: 0,
        };
        mutateGlobal((g) => ({ ...g, inventory: inv, lab: { ...(g.lab ?? {}), grid: [...((g.lab?.grid) ?? []), cell] } }))
          .then((g) => sendCharacter(ws, g)).catch((e) => logger.warn('lab place failed:', e));
        break;
      }
      case ClientMsg.LAB_ROTATE: {
        const id = typeof msg.id === 'string' ? msg.id : null;
        if (!id) break;
        mutateGlobal((g) => ({ ...g, lab: { ...(g.lab ?? {}), grid: (g.lab?.grid ?? []).map((c) => (c.id === id ? { ...c, dir: (c.dir + 1) % 4 } : c)) } }))
          .then((g) => sendCharacter(ws, g)).catch(() => {});
        break;
      }
      case ClientMsg.LAB_REMOVE: {
        const id = typeof msg.id === 'string' ? msg.id : null;
        if (!id) break;
        const g0 = readGlobal();
        const cell = (g0.lab?.grid ?? []).find((c) => c.id === id);
        if (!cell) break;
        if ((cell.slots ?? []).some((s) => s && s.item)) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '先清空箱子里的东西' })); break; }
        const cat = LAB_CATALOG[cell.kind];
        const inv = refundMaterials(g0.inventory, cat?.cost ?? {}, 1);
        mutateGlobal((g) => ({ ...g, inventory: inv, lab: { ...(g.lab ?? {}), grid: (g.lab?.grid ?? []).filter((c) => c.id !== id) } }))
          .then((g) => sendCharacter(ws, g)).catch(() => {});
        break;
      }
      case ClientMsg.LAB_SET: {
        const id = typeof msg.id === 'string' ? msg.id : null;
        if (!id) break;
        const filter = Array.isArray(msg.filter) ? msg.filter.filter((x) => typeof x === 'string').slice(0, 8) : null;
        const sides = Array.isArray(msg.sides) && msg.sides.length === 4 ? msg.sides.map((v) => [0, 1, 2].includes(Number(v)) ? Number(v) : 0) : null;
        const mode = msg.mode === 'filter' ? 'filter' : msg.mode === 'alt' ? 'alt' : null;
        mutateGlobal((g) => ({
          ...g,
          lab: {
            ...(g.lab ?? {}),
            grid: (g.lab?.grid ?? []).map((c) => (c.id === id ? { ...c, filter: filter ?? c.filter, mode: mode ?? c.mode, sides: sides ?? c.sides } : c)),
          },
        })).then((g) => sendCharacter(ws, g)).catch(() => {});
        break;
      }
      case ClientMsg.LAB_TRANSFER: {
        const id = typeof msg.id === 'string' ? msg.id : null;
        const dir = msg.dir === 'out' ? 'out' : 'in';
        const slot = Math.max(0, Math.floor(Number(msg.slot) || 0));
        const item = typeof msg.item === 'string' ? msg.item : null;
        const count = Math.max(1, Math.min(99, Math.floor(Number(msg.count) || 1)));
        if (!id) break;
        mutateGlobal((g) => {
          const grid = (g.lab?.grid ?? []).map((c) => ({ ...c, slots: [...(c.slots ?? [])] }));
          const cell = grid.find((c) => c.id === id);
          if (!cell || !cell.slots?.length) return g;
          const inv = [...(g.inventory ?? [])];
          if (dir === 'out') {
            const s = cell.slots[slot];
            if (!s || !s.item) return g;
            const n = Math.min(count, s.n);
            for (let i = 0; i < n; i++) inv.push(s.item);
            cell.slots[slot] = s.n - n > 0 ? { item: s.item, n: s.n - n } : null;
          } else {
            if (!item) return g;
            const idx = inv.indexOf(item);
            if (idx < 0) return g;
            let si = cell.slots.findIndex((s) => s && s.item === item && s.n < 99);
            if (si < 0) si = cell.slots.findIndex((s) => !s);
            if (si < 0) return g;
            inv.splice(idx, 1);
            cell.slots[si] = { item, n: Math.min(99, (cell.slots[si]?.n ?? 0) + 1) };
          }
          return { ...g, inventory: inv, lab: { ...(g.lab ?? {}), grid } };
        }).then((g) => sendCharacter(ws, g)).catch(() => {});
        break;
      }
      case ClientMsg.LAB_SYNC: {
        // 客户端刚进家那一帧还没拿到服务端快照，会把 power=0 / store={} 传上来；这种过期同步直接丢
        const stageSent = Number(msg.stage);
        const stageSaved = Number(readGlobal().lab?.stage) || 0;
        if (Number.isFinite(stageSent) && stageSent !== stageSaved) break;
        const cells = Array.isArray(msg.cells) ? msg.cells : [];
        const power = msg.power ?? {};
        const store = msg.store && typeof msg.store === 'object' ? msg.store : null;
        mutateGlobal((g) => {
          const grid = (g.lab?.grid ?? []).map((c) => {
            const u = cells.find((x) => x && x.id === c.id);
            if (!u) return c;
            return {
              ...c,
              item: typeof u.item === 'string' ? u.item : null,
              prog: Math.max(0, Math.min(1, Number(u.prog) || 0)),
              fuel: Math.max(0, Math.min(99, Math.floor(Number(u.fuel) || 0))),
              slots: Array.isArray(u.slots) ? c.slots.map((s2, j) => {
                const s = u.slots[j];
                return s && typeof s.item === 'string' ? { item: s.item, n: Math.max(1, Math.min(99, Math.floor(Number(s.n) || 1))) } : null;
              }) : c.slots,
              in: Array.isArray(u.in) ? u.in.filter((b) => b && typeof b.item === 'string').map((b) => ({ item: b.item, n: Math.max(1, Math.min(99, Math.floor(Number(b.n) || 1))) })).slice(0, 8) : c.in,
              out: Array.isArray(u.out) ? u.out.filter((b) => b && typeof b.item === 'string').map((b) => ({ item: b.item, n: Math.max(1, Math.min(99, Math.floor(Number(b.n) || 1))) })).slice(0, 8) : c.out,
              filter: Array.isArray(u.filter) ? u.filter.filter((x) => typeof x === 'string').slice(0, 8) : c.filter,
              mode: u.mode === 'filter' ? 'filter' : 'alt',
              recipe: typeof u.recipe === 'string' ? u.recipe : c.recipe,
            };
          });
          const lab = {
            ...(g.lab ?? {}),
            grid,
            power: { stored: Math.max(0, Math.min(999, Number(power.stored) || 0)), cap: Math.max(60, Number(g.lab?.power?.cap) || 100), brownout: !!power.brownout },
          };
          if (store) {
            const st = {};
            for (const [k, v] of Object.entries(store)) { const n = Math.floor(Number(v) || 0); if (n > 0) st[k] = Math.min(999, n); }
            lab.store = st;
          }
          return { ...g, lab };
        }).then((g) => sendCharacter(ws, g)).catch(() => {});
        break;
      }
      case ClientMsg.LAB_POWER: {
        const add = Math.max(0, Math.min(50, Math.floor(Number(msg.amount) || 10)));
        mutateGlobal((g) => {
          const lab = g.lab ?? {};
          const cap = Math.max(60, Number(lab.power?.cap) || 100);
          return { ...g, lab: { ...lab, power: { ...(lab.power ?? {}), cap, stored: Math.min(cap, (Number(lab.power?.stored) || 0) + add), brownout: false } } };
        }).then((g) => sendCharacter(ws, g)).catch(() => {});
        break;
      }
      case ClientMsg.LAB_TAKE: {
        const item = typeof msg.item === 'string' ? msg.item : null;
        const count = Math.max(1, Math.min(99, Math.floor(Number(msg.count) || 1)));
        if (!item) break;
        mutateGlobal((g) => {
          const store = { ...(g.lab?.store ?? {}) };
          const have = Math.max(0, Math.floor(Number(store[item]) || 0));
          const n = Math.min(have, count);
          if (n <= 0) return g;
          store[item] = have - n;
          if (store[item] <= 0) delete store[item];
          const inv = [...(g.inventory ?? [])];
          for (let i = 0; i < n; i++) inv.push(item);
          return { ...g, inventory: inv, lab: { ...(g.lab ?? {}), store } };
        }).then((g) => sendCharacter(ws, g)).catch(() => {});
        break;
      }
      case ClientMsg.LAB_INSERT: {
        const id = typeof msg.id === 'string' ? msg.id : null;
        const item = typeof msg.item === 'string' ? msg.item : null;
        if (!id || !item) break;
        mutateGlobal((g) => {
          const grid = (g.lab?.grid ?? []).map((c) => ({ ...c, in: [...(c.in ?? [])] }));
          const cell = grid.find((c) => c.id === id);
          if (!cell) return g;
          // 只有真正吃料的设备能收物品：手摇发电机 / 电容 / 传送带 / 机械臂不该被塞东西
          if (!cell.slots?.length && !['smelter', 'refinery', 'assembler', 'burner'].includes(cell.kind)) return g;
          const inv = [...(g.inventory ?? [])];
          const idx = inv.indexOf(item);
          if (idx < 0) return g;
          if (cell.slots?.length) {
            let si = cell.slots.findIndex((s) => s && s.item === item && s.n < 99);
            if (si < 0) si = cell.slots.findIndex((s) => !s);
            if (si < 0) return g;
            inv.splice(idx, 1);
            cell.slots[si] = { item, n: Math.min(99, (cell.slots[si]?.n ?? 0) + 1) };
          } else {
            let bi = cell.in.findIndex((b) => b.item === item && b.n < 99);
            if (bi < 0) bi = cell.in.length < 4 ? cell.in.length : -1;
            if (bi < 0) return g;
            inv.splice(idx, 1);
            if (cell.in[bi]) cell.in[bi] = { item, n: cell.in[bi].n + 1 }; else cell.in[bi] = { item, n: 1 };
          }
          return { ...g, inventory: inv, lab: { ...(g.lab ?? {}), grid } };
        }).then((g) => sendCharacter(ws, g)).catch(() => {});
        break;
      }
      case ClientMsg.LAB_RECIPE: {
        const id = typeof msg.id === 'string' ? msg.id : null;
        const recipe = typeof msg.recipe === 'string' ? msg.recipe : null;
        if (!id) break;
        mutateGlobal((g) => ({ ...g, lab: { ...(g.lab ?? {}), grid: (g.lab?.grid ?? []).map((c) => (c.id === id ? { ...c, recipe } : c)) } }))
          .then((g) => sendCharacter(ws, g)).catch(() => {});
        break;
      }
      case ClientMsg.LAB_UPGRADE: {
        // 熔炉 → 精炼炉（不能直接打造精炼炉）
        const id = typeof msg.id === 'string' ? msg.id : null;
        if (!id) break;
        const g0 = readGlobal();
        const cell = (g0.lab?.grid ?? []).find((c) => c.id === id);
        if (!cell || cell.kind !== 'smelter') break;
        if ((Number(g0.lab?.stage) || 0) < 3) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '需要实验室修复到阶段 3' })); break; }
        const inv = takeMaterials(g0.inventory, LAB_UPGRADE.refinery.cost);
        if (!inv) { ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '升级失败：材料不足（铁锭×20 + 齿轮×6 + 紫晶锭×1）' })); break; }
        mutateGlobal((g) => ({
          ...g,
          inventory: inv,
          lab: { ...(g.lab ?? {}), grid: (g.lab?.grid ?? []).map((c) => (c.id === id ? { ...c, kind: 'refinery', prog: 0 } : c)) },
        })).then((g) => { sendCharacter(ws, g); ws.send(encodeMsg({ kind: HostMsg.HOME_MESSAGE, text: '🏭 熔炉已升级为精炼炉' })); })
          .catch((e) => logger.warn('lab upgrade failed:', e));
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
        const mineLevel = Math.max(1, Math.min(3, Number(dev.level) || 1));
        for (let i = 0; i < count; i++) {
          const item = dev.kind === 'tree-farm' ? 'mat-wood' : dev.kind === 'basic-mine' ? rollMineOre(mineLevel) : null;
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
          const cap = chestCap(chest.kind);
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
      storyIntroDone: msg.storyDone ? true : (g.storyIntroDone ?? true),   // 开局剧情走完（进乱流）后置 true
    };
    await persist.domain.global.set(persisted);
    snapshotActiveSlot(persisted).catch(() => {});   // 结算同样写穿到 meta 槽位
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
      // ── 多存档：元数据 domain + v1→v2 一次性迁移（旧单档存档整体进 slot1） ──
      const metaDomain = await sctx.storageDomain.open(vsGameMetaDomain);
      persist.meta = metaDomain;
      const m0 = readMeta();
      if (!m0.migrated) {
        const gCur = readGlobal();
        await metaDomain.global.set({
          ...m0,
          migrated: true,
          activeSlot: 'slot1',
          slots: SAVE_SLOT_IDS.map((id) => (id === 'slot1'
            ? { id, savedAt: Date.now(), data: { ...gCur } }
            : { id, savedAt: 0, data: null })),
        });
        logger.info('vs_game_meta: migrated legacy single save into slot1');
      }
      const cfgDomain = await sctx.storageDomain.open(vsGameCfgDomain);
      persist.cfgDomain = cfgDomain;
      yield () => { persist.meta = null; metaDomain.close(); persist.domain = null; domain.close(); persist.cfgDomain = null; cfgDomain.close(); };
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
          sfxVolume: cfg.sfxVolume,
          bgmVolume: cfg.bgmVolume,
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
          (async () => {
            try {
              const patch = JSON.parse(raw || '{}');
              if (persist.settingsScope) {
                persist.settingsScope.update(patch);
                sendJson({ ok: true, config: publicConfig() });
              } else if (persist.cfgDomain) {
                // 兜底通道：运行环境没提供 settings 服务时，设置存进独立 domain 并广播
                const cur = { ...VS_CFG_DEFAULT, ...(persist.cfgDomain.global.get() ?? {}), ...patch };
                await persist.cfgDomain.global.set(cur);
                const next = publicConfig();
                broadcast({ kind: HostMsg.CONFIG, config: next });
                sendJson({ ok: true, config: next });
              } else {
                sendJson({ ok: false, error: 'settings not ready' }, 503);
              }
            } catch (e) {
              sendJson({ ok: false, error: String(e?.message ?? e) }, 400);
            }
          })();
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
