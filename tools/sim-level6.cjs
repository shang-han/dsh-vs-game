/**
 * 第 6 关流程仿真（Node，无浏览器）：
 *   node tools/sim-level6.cjs
 *
 * 做法：用最小 DOM/Canvas/WebAudio 桩把 client.js 当普通脚本跑起来，
 * 取出 window.__vsGameDebug.GameEngine，然后不渲染，只推进逻辑 tick：
 *   进 Boss 房 → 三阶段 → 二阶段弹幕/轮盘/白饭 → 剧情杀 → 回到开头 → 门口认出你 → 通关宝箱
 * 任何一步不符合预期都会打印 FAIL 并以非 0 退出。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// ── 最小浏览器桩 ─────────────────────────────────────────────
const noop = () => {};
function fakeCtx() {
  const g = { addColorStop: noop };
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return () => ({ width: 10 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => g;
      if (key === 'canvas') return { width: 840, height: 520 };
      if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return noop;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  return ctx;
}
function fakeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    innerHTML: '', textContent: '', width: 840, height: 520, tabIndex: 0,
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    insertBefore(c) { this.children.push(c); return c; },
    replaceChildren() { this.children = []; },
    remove() {},
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, contains: () => false,
    focus: noop, blur: noop, setPointerCapture: noop, releasePointerCapture: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 840, bottom: 520, width: 840, height: 520 }),
    getBBox: () => ({ x: 0, y: 0, width: 200, height: 260 }),
    getContext: () => fakeCtx(),
  };
  return el;
}

const documentStub = {
  createElement: (t) => fakeEl(t),
  createElementNS: (ns, t) => fakeEl(t),
  getElementById: () => fakeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop, removeEventListener: noop,
  head: fakeEl('head'), body: fakeEl('body'), documentElement: fakeEl('html'),
};

class FakeAudio {
  constructor(src) { this.src = src; this.volume = 1; this.loop = false; this.paused = true; this.currentTime = 0; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener() {}
}
class FakeImage {
  constructor() { this.naturalWidth = 100; this.naturalHeight = 100; this.complete = true; }
  addEventListener() {}
  set src(v) { this._src = v; }
  get src() { return this._src; }
}

const win = {
  __ModuleLoader__: { load: (cfg) => { win.__cfg = cfg; } },
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
  setTimeout: (fn) => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  devicePixelRatio: 1,
  location: { href: 'http://localhost/', hash: '' },
  localStorage: { getItem: () => null, setItem: noop },
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  Audio: FakeAudio, Image: FakeImage,
  performance: { now: () => Date.now() },
  innerWidth: 1440, innerHeight: 900,
  fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
};
global.window = win;
global.document = documentStub;
global.Audio = FakeAudio;
global.Image = FakeImage;
global.fetch = win.fetch;
global.requestAnimationFrame = win.requestAnimationFrame;
global.cancelAnimationFrame = noop;
global.performance = win.performance;
global.navigator = { userAgent: 'node-sim' };
global.HTMLCanvasElement = class {};
global.ResizeObserver = class { observe() {} disconnect() {} };
global.WebSocket = class { constructor() { this.sent = []; } send() {} close() {} addEventListener() {} };

// ── 加载 client.js 工厂 ─────────────────────────────────────
const clientPath = path.join(__dirname, '..', 'lib', 'client.js');
const code = fs.readFileSync(clientPath, 'utf8');
vm.runInThisContext(code, { filename: 'client.js' });

if (!win.__cfg) throw new Error('客户端模块没有注册');
const reactStub = {
  useCallback: (f) => f,
  useContext: () => ({}),
  useEffect: noop,
  useRef: (v) => ({ current: v ?? null }),
  useState: (v) => [typeof v === 'function' ? v() : v, noop],
  useMemo: (f) => f(),
  createElement: (t, p) => ({ t, p }),
  createContext: (v) => ({ Provider: (p) => p && p.children, Consumer: () => null, _value: v }),
  memo: (f) => f,
  forwardRef: (f) => f,
  useLayoutEffect: noop,
  useReducer: (r, i) => [i, noop],
  useId: () => 'id',
  createRef: () => ({ current: null }),
  Fragment: 'fragment',
  Component: class Component { constructor(props) { this.props = props; this.state = {}; } setState() {} render() { return null; } },
  PureComponent: class PureComponent { constructor(props) { this.props = props; } render() { return null; } },
};
const fakeRequire = (id) => {
  if (id === 'react') return reactStub;
  if (id === 'react/jsx-runtime') return { jsx: (t, p) => ({ t, p }), jsxs: (t, p) => ({ t, p }) };
  if (id === 'react-dom/client') return { createRoot: () => ({ render: noop, unmount: noop }) };
  return {};
};
const mod = win.__cfg.factory(fakeRequire);
const GameEngine = win.__vsGameDebug?.GameEngine;
if (!GameEngine) throw new Error('window.__vsGameDebug.GameEngine 不可用');

// ── 关卡流程仿真 ───────────────────────────────────────────
const level = require('../lib/levels/truth-gate.js').default;

const sent = [];
function makeEngine() {
  const canvas = fakeEl('canvas');
  canvas.parentElement = fakeEl('div');
  canvas.parentElement.querySelector = () => null;   // 不初始化 SVG 覆盖层（Node 没有动态 import 回调）
  return new GameEngine(canvas, { sendWs: (m) => sent.push(m), onHomeAction: noop });
}

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : ''));
}

const e = makeEngine();
e.clearedLevels = new Set(['busy-server', 'furious-user', 'workspace-tidy', 'too-many-files', 'seaside']);
e.level = level;
e.world = { ...level.world };
e.reset();
e.seedLevel();
e.phase = 'playing';
check('关卡载入：5 个宝箱', e.chests.length === 5, 'chests=' + e.chests.length);

// 开完 5 个箱子（直接标记）
for (const c of e.chests) c.opened = true;
e.enterBossRoom();
check('进入 Boss 房：对话中', e.phase === 'bossintro' && !!e.bossIntro, e.phase);

// 推进开场白
for (let i = 0; i < 50 && e.phase === 'bossintro'; i++) e.advanceBossIntro();
const boss = e.dragonBoss();
check('Boss 已生成：正义', !!boss && boss.bossName === '正义', boss?.bossName ?? 'none');
check('第一段 10 万血', boss && boss.phase === 0 && boss.maxHp === 100000, boss ? boss.maxHp : 'none');

// 一阶段：打空第一段
for (let i = 0; i < 40 && boss.phase === 0; i++) e.hurtEnemy(boss, 20000);
check('第一段打完：过场对话', e.phase === 'bossintro' && e.bossIntro?.kind === 'dragon-phase-1', e.bossIntro?.kind ?? e.phase);
for (let i = 0; i < 50 && e.phase === 'bossintro'; i++) e.advanceBossIntro();
check('第二段开始：重置 10 万 + 封锁', boss.phase === 1 && boss.hp === 100000 && e.dragonLock?.weapon === true && e.dragonLock?.skill === true,
  'phase=' + boss.phase + ' hp=' + boss.hp);
check('二阶段：轮盘存在', !!e.dragonReel && e.dragonReel.items.length >= 4, e.dragonReel ? e.dragonReel.items.length : 0);
check('二阶段：BGM 已开始', !!e.dragonBgm && e.dragonBgm.paused === false, e.dragonBgm ? e.dragonBgm.src : 'none');
check('二阶段：自动武器被封锁', e.autoWeaponsEnabled() === false, String(e.autoWeaponsEnabled()));
const skillBefore = e.skillTimer ?? 0;
e.activateActiveSkill();
check('二阶段：技能被封锁（放不出来）', (e.skillTimer ?? 0) === skillBefore && !e.purge && !e.railCharge, 'timer=' + e.skillTimer + ' purge=' + !!e.purge);

// 推进 6 秒逻辑：弹幕 + 白饭（仿真里让玩家无敌，避免随机中弹干扰流程检查）
e.player.maxHp = 99999; e.player.hp = 99999; e.player.invuln = 999;
for (let i = 0; i < 360; i++) e.tick(1 / 60);
const snap2 = e.snapshot();
check('快照：Boss 三段/第二段/轮盘/锁定', snap2.boss && snap2.boss.dragon === true && snap2.boss.phaseCount === 3 && snap2.boss.phase === 2 && !!snap2.boss.reel && snap2.boss.lock?.weapon === true,
  JSON.stringify({ phase: snap2.boss?.phase, count: snap2.boss?.phaseCount, reel: !!snap2.boss?.reel, lock: snap2.boss?.lock }));
check('二阶段：产生弹幕', e.enemyBullets.length > 0, 'bullets=' + e.enemyBullets.length);
check('二阶段：刷出白饭', e.dragonRice.length > 0, 'rice=' + e.dragonRice.length);

// 吃白饭 → 轮盘停 → 解锁
if (!e.dragonRice.length) e.dragonSpawnRice();
{
  const r = e.dragonRice[e.dragonRice.length - 1];
  e.player.x = r.x; e.player.y = r.y;
  e.player.maxHp = 99999; e.player.hp = 99999; e.player.invuln = 999;   // 仿真里别被弹幕打断轮盘
  e.tick(1 / 60);
  check('白饭：吃到后轮盘开始减速', !!e.dragonReel && e.dragonReel.spinT > 0, 'spinT=' + e.dragonReel?.spinT);
  for (let i = 0; i < 120 && e.dragonReel?.spinning; i++) e.tick(1 / 60);
  check('白饭：轮盘停下并解锁武器', e.dragonReel && e.dragonReel.spinning === false && e.dragonLock.weapon === false,
    'spinning=' + e.dragonReel?.spinning + ' lock=' + JSON.stringify(e.dragonLock) + ' result=' + JSON.stringify(e.dragonReel?.result));
  check('解锁后：自动武器恢复', e.autoWeaponsEnabled() === true, String(e.autoWeaponsEnabled()));
  e.player.x = 60; e.player.y = 60;   // 挪开，别自动吃掉后面的白饭
}

// 第二碗白饭：必出技能（手动刷，避免随机位置/自动吃掉）
e.dragonSpawnRice();
if (e.dragonRice.length) {
  const r2 = e.dragonRice[e.dragonRice.length - 1];
  e.player.x = r2.x; e.player.y = r2.y;
  e.player.maxHp = 99999; e.player.hp = 99999; e.player.invuln = 999;
  e.tick(1 / 60);
  for (let i = 0; i < 120 && e.dragonReel?.spinning; i++) e.tick(1 / 60);
  check('第二碗白饭：解锁技能', e.dragonLock.skill === false && e.dragonReel?.result?.kind === 'skill',
    'result=' + JSON.stringify(e.dragonReel?.result) + ' lock=' + JSON.stringify(e.dragonLock));
  e.player.x = 60; e.player.y = 60;
} else {
  check('第二碗白饭：能刷出第二碗', false, 'rice=' + e.dragonRice.length);
}

// 二阶段打空
for (let i = 0; i < 60 && boss.phase === 1; i++) e.hurtEnemy(boss, 30000);
check('第二段打完：坐下 + 逆位对话', e.phase === 'bossintro' && e.bossIntro?.kind === 'dragon-phase-2' && boss.pose === 'sit',
  'kind=' + e.bossIntro?.kind + ' pose=' + boss.pose);
for (let i = 0; i < 60 && e.phase === 'bossintro'; i++) e.advanceBossIntro();
check('第三段：无敌剧情杀', boss.phase === 2 && boss.invuln === true && e.dragonScriptedDeath === true, 'phase=' + boss.phase);

// 处决计时：先无敌顶住弹幕，6.5s 前不该死，之后被处决
e.player.maxHp = 99999; e.player.hp = 99999; e.player.invuln = 999;
for (let i = 0; i < 60 * 5; i++) e.tick(1 / 60);
check('三阶段：5 秒时还活着（处决未到）', e.player.hp > 0 && e.phase === 'playing', 'hp=' + e.player.hp + ' phase=' + e.phase);
for (let i = 0; i < 60 * 4; i++) e.tick(1 / 60);
check('三阶段：6.5 秒后被处决', e.player.hp <= 0 || e.phase === 'dying' || e.phase === 'bossintro', 'hp=' + e.player.hp + ' phase=' + e.phase);
for (let i = 0; i < 60 * 3; i++) e.tick(1 / 60);
check('死亡后：回到开头（龙娘收走/世界复位）', e.dragonLoopMode === true && !e.dragonBoss() && e.world.w === level.world.w,
  'loop=' + e.dragonLoopMode + ' world=' + e.world.w);

// 循环对话
for (let i = 0; i < 30 && e.phase === 'bossintro'; i++) e.advanceBossIntro();
e.phase = 'playing';
// 走到门前
e.player.x = level.bossZone.xf * e.world.w;
e.player.y = level.bossZone.yf * e.world.h;
e.checkBossZone();
check('第二次到门前：认出你的对话', e.phase === 'bossintro' && e.bossIntro?.kind === 'dragon-loop-meet', e.bossIntro?.kind ?? e.phase);
for (let i = 0; i < 40 && e.phase === 'bossintro'; i++) e.advanceBossIntro();
check('留下白饭 + 通关宝箱', !!e.dragonBowl && e.chests.some((c) => c.bossChest), 'bowl=' + !!e.dragonBowl);
check('循环结束：BGM 已停', !e.dragonBgm, String(e.dragonBgm));
const bossChest = e.chests.find((c) => c.bossChest);
if (bossChest) {
  e.openChest(bossChest);
  check('通关宝箱：上报 BOSS_KILL', sent.some((m) => m && m.kind === 'boss-kill' && m.levelId === 'truth-gate'),
    JSON.stringify(sent.filter((m) => m && m.kind === 'boss-kill').slice(-1)));
} else check('通关宝箱：存在', false);

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(' / ')); process.exit(1); }
