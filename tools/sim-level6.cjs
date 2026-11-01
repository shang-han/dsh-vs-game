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
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [], isConnected: true, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
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
function makeEngine(withLayer = false) {
  const canvas = fakeEl('canvas');
  canvas.parentElement = fakeEl('div');
  // withLayer=true 时提供 .dsh-vs-dragon-layer，让 SVG 覆盖层的状态映射逻辑跑起来
  canvas.parentElement.querySelector = () => (withLayer ? fakeEl('div') : null);
  return new GameEngine(canvas, { sendWs: (m) => sent.push(m), onHomeAction: noop });
}

const __warn = console.warn;
console.warn = noop;   // Node 里 SVG 覆盖层动态 import 必然失败，静音
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
e.activeSkillId = 'purge';
e.unlockedSkills = ['purge'];
check('关卡载入：5 个宝箱', e.chests.length === 5, 'chests=' + e.chests.length);

// 开完 5 个箱子（直接标记）
for (const c of e.chests) c.opened = true;
e.bossSpawned = true;
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
check('快照：HUD 锁定标记', snap2.activeSkill?.locked === true && snap2.weaponLocked === true,
  'skillLocked=' + snap2.activeSkill?.locked + ' weaponLocked=' + snap2.weaponLocked);
check('快照：BGM 标记', snap2.boss?.bgm === true, String(snap2.boss?.bgm));
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
  // 暂停/继续：BGM 跟着停
  const bgmBefore = !!(e.dragonBgm && !e.dragonBgm.paused);
  e.pause();
  const pausedOk = !!e.dragonBgm && e.dragonBgm.paused === true;
  e.resume();
  const resumedOk = !!e.dragonBgm && e.dragonBgm.paused === false;
  check('二阶段：暂停/继续同步 BGM', bgmBefore && pausedOk && resumedOk, 'before=' + bgmBefore + ' paused=' + pausedOk + ' resumed=' + resumedOk);
  check('白饭：轮盘停下并解锁武器', e.dragonReel && e.dragonReel.spinning === false && e.dragonLock.weapon === false,
    'spinning=' + e.dragonReel?.spinning + ' lock=' + JSON.stringify(e.dragonLock) + ' result=' + JSON.stringify(e.dragonReel?.result));
  check('解锁后：自动武器恢复', e.autoWeaponsEnabled() === true, String(e.autoWeaponsEnabled()));
  const snap3 = e.snapshot();
  check('解锁后：HUD 解除武器锁', snap3.weaponLocked === false, 'weaponLocked=' + snap3.weaponLocked);
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

// 第三碗白饭：两样都解锁后回血，不再转轮盘
e.player.hp = Math.round(e.player.maxHp * 0.5);
e.dragonSpawnRice();
if (e.dragonRice.length) {
  const r3 = e.dragonRice[e.dragonRice.length - 1];
  e.player.x = r3.x; e.player.y = r3.y;
  e.tick(1 / 60);
  check('第三碗白饭：回血且不转轮盘', e.player.hp > e.player.maxHp * 0.6 && e.dragonReel?.spinning !== true,
    'hp=' + Math.round(e.player.hp) + '/' + e.player.maxHp + ' spinning=' + e.dragonReel?.spinning);
  e.player.x = 60; e.player.y = 60;
} else check('第三碗白饭：能刷出', false);

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

// ── SVG 覆盖层：状态映射 / 跟随位置 / 阶段表情 ────────────
const e4 = makeEngine(true);
e4.clearedLevels = new Set(['busy-server', 'furious-user', 'workspace-tidy', 'too-many-files', 'seaside']);
e4.level = level;
e4.world = { ...level.world };
e4.reset();
e4.phase = 'playing';
e4.bossSpawned = true;
e4.enterBossRoom();
const warn = console.warn; console.warn = noop;   // 动态 import 在 Node 里必然失败，静音
for (let i = 0; i < 50 && e4.phase === 'bossintro'; i++) e4.advanceBossIntro();
const boss4 = e4.dragonBoss();
check('覆盖层：已初始化 SVG', !!e4.dragonView && !!e4.dragonView.svg, e4.dragonView ? 'ok' : 'none');
e4.updateDragonView(1000);
const view4 = e4.dragonView;
check('覆盖层：跟随 Boss 定位', /translate\(-?\d+px,-?\d+px\)/.test(view4.svg.style.transform || '') && view4.svg.style.width.endsWith('px'),
  view4.svg.style.transform + ' / ' + view4.svg.style.width);
check('覆盖层：第一段表情 neutral', view4.state.face === 'neutral' && view4.state.mode === 'idle', view4.state.face + '/' + view4.state.mode);
e4.dragonBeginPhase(1);
e4.updateDragonView(2000);
check('覆盖层：第二段表情 determined + 手势', view4.state.face === 'determined' && !!view4.state.gesture, view4.state.face + '/' + JSON.stringify(view4.state.gesture));
if (boss4) boss4.pose = 'sit';
e4.updateDragonView(2100);
check('覆盖层：坐下 sad', view4.state.mode === 'sit' && view4.state.face === 'sad' && view4.state.sit === 1, view4.state.mode + '/' + view4.state.face);
if (boss4) boss4.pose = null;
e4.dragonBeginPhase(2);
e4.updateDragonView(3000);
check('覆盖层：逆位 angry + 黑色滤镜', view4.state.face === 'angry' && String(view4.svg.style.filter).includes('drop-shadow'), view4.state.face);
e4.enemies = [];
e4.updateDragonView(3200);
check('覆盖层：没有 Boss 时隐藏', view4.svg.style.display === 'none', view4.svg.style.display);
console.warn = warn;
try { e4.drawDragonTint(fakeCtx()); e4.drawDragonCut(fakeCtx()); e.drawDragonAura(fakeCtx()); } catch (err) { check('覆盖层：色调/过场/占位龙影绘制不抛错', false, String(err)); }
check('覆盖层：色调/过场/占位龙影绘制不抛错', true);

// ── 五宝箱门槛：没开完不能进 Boss 房 ─────────────────────
const e3 = makeEngine();
e3.clearedLevels = new Set(['busy-server', 'furious-user', 'workspace-tidy', 'too-many-files', 'seaside']);
e3.level = level;
e3.world = { ...level.world };
e3.reset();
e3.seedLevel();
e3.phase = 'playing';
e3.player.x = level.bossZone.xf * e3.world.w;
e3.player.y = level.bossZone.yf * e3.world.h;
e3.checkBossZone();
check('门槛：宝箱没开完不进 Boss 房', e3.bossRoomMode === false && e3.bossSpawned === false, 'room=' + e3.bossRoomMode);
for (const c of e3.chests) { e3.openChest(c); e3.choices = null; e3.phase = 'playing'; }
e3.player.x = level.bossZone.xf * e3.world.w;
e3.player.y = level.bossZone.yf * e3.world.h;
e3.checkBossZone();
check('门槛：开完 5 个宝箱后进 Boss 房', e3.bossRoomMode === true && e3.bossSpawned === true, 'room=' + e3.bossRoomMode);
check('门槛：开场白是正义的 5 句', e3.bossIntro?.lines?.length === 5 && e3.bossIntro.lines[0].speaker === '正义', 'lines=' + (e3.bossIntro?.lines?.length ?? 0));

// ── 长廊入口：第 2 关门口下方的紫色地毯 ─────────────────────
const LEVELS = require('../lib/levels/index.js').LEVELS;
const e2 = makeEngine();
e2.clearedLevels = new Set(['busy-server', 'furious-user', 'workspace-tidy', 'too-many-files']);   // 还没打第 5 关
e2.enterCorridor(LEVELS);
const gateDoor = e2.corridor.doors.find((d) => d.levelId === 'truth-gate');
check('长廊：紫色地毯入口存在', !!gateDoor && gateDoor.side === 'lower' && gateDoor.purple === true, gateDoor ? gateDoor.side + '/purple=' + gateDoor.purple : 'none');
const D = { firstDoorX: 520, doorGap: 330 };
check('长廊：地毯在第 2 关门口下方', gateDoor && Math.abs(gateDoor.x - (D.firstDoorX + D.doorGap)) < 1, gateDoor ? gateDoor.x : 'none');
check('长廊：未通第 5 关时锁住', gateDoor && gateDoor.locked === true, String(gateDoor?.locked));
e2.corridor.near = gateDoor;
e2.corridorInteract();
check('长廊：锁住时提示 3600 万 token', !!e2.banner && String(e2.banner.text).includes('3600 万'), e2.banner?.text ?? 'none');
e2.clearedLevels.add('seaside');
e2.enterCorridor(LEVELS);
const gateDoor2 = e2.corridor.doors.find((d) => d.levelId === 'truth-gate');
check('长廊：通关第 5 关后解锁', gateDoor2 && gateDoor2.locked === false, String(gateDoor2?.locked));
check('长廊：第 6 关不再出现在上门', !e2.corridor.doors.some((d) => d.kind === 'level' && d.side === 'upper' && d.levelId === 'truth-gate'));

console.warn = __warn;
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(' / ')); process.exit(1); }
