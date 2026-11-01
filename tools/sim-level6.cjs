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

// 进关对话：只有一句
const e5 = makeEngine();
e5.clearedLevels = new Set(['seaside']);
e5.level = level;
e5.world = { ...level.world };
e5.start();
check('进关只播一句「终于集齐 3600 万 token」',
  e5.phase === 'bossintro' && e5.bossIntro?.kind === 'pre' && e5.bossIntro.lines.length === 1 && String(e5.bossIntro.lines[0].text).includes('3600 万'),
  JSON.stringify(e5.bossIntro?.lines));

// 一阶段：不吐弹幕、本体不伤人、会冲撞玩家
e.player.maxHp = 100; e.player.hp = 100; e.player.invuln = 0;
e.player.x = boss.x; e.player.y = boss.y;
for (let i = 0; i < 30; i++) e.tick(1 / 60);
check('一阶段：本体接触不造成伤害', e.player.hp === 100, 'hp=' + e.player.hp);
boss.dragonDashCd = 99; boss.dragonDash = null;
for (let i = 0; i < 60 * 2; i++) e.tick(1 / 60);
check('一阶段：不放弹幕', e.enemyBullets.length === 0, 'bullets=' + e.enemyBullets.length);
e.player.x = Math.min(e.world.w - 60, boss.x + 220); e.player.y = boss.y;
e.player.maxHp = 5000; e.player.hp = 5000; e.player.invuln = 0;
boss.dragonDashCd = 0;
for (let i = 0; i < 60 * 2; i++) e.tick(1 / 60);
check('一阶段：会冲撞玩家（有预警/落点）', !!e.dragonImpactFx || !!boss.dragonDash, 'dash=' + JSON.stringify(boss.dragonDash?.phase ?? null));
check('一阶段：冲撞落点造成伤害', e.player.hp < 5000, 'hp=' + e.player.hp);
e.player.maxHp = 99999; e.player.hp = 99999;

// 一阶段：灵活游走 / 残影 / 闪避 / 坐下-站起过渡
{
  boss.dragonDashCd = 99; boss.dragonLeap = null;
  const x0 = boss.x, y0 = boss.y;
  for (let i = 0; i < 40; i++) e.tick(1 / 60);
  const moved = Math.hypot(boss.x - x0, boss.y - y0);
  check('一阶段：不停游走（不是站桩）', moved > 25, 'moved=' + Math.round(moved));
  check('一阶段：移动有残影', (e.dragonGhosts?.length ?? 0) > 0, 'ghosts=' + (e.dragonGhosts?.length ?? 0));
  // 闪避：20 次攻击里应该出现若干次「闪避」
  let dodges = 0;
  const origDmgNum = e.spawnDmgNum.bind(e);
  e.spawnDmgNum = (...args) => { if (args[2] === '闪避') dodges++; return origDmgNum(...args); };
  boss.dragonMoving = true;
  boss.hp = boss.phaseHp = 1e9;
  for (let i = 0; i < 20; i++) e.hurtEnemy(boss, 500);
  e.spawnDmgNum = origDmgNum;
  check('一阶段：移动时大概率闪避伤害', dodges > 0 && dodges < 20, 'dodges=' + dodges + '/20');
  boss.hp = boss.phaseHp = 100000;
  boss.dragonMoving = false;
  // 坐下/站起平滑过渡
  boss.pose = 'sit';
  for (let i = 0; i < 20; i++) e.tick(1 / 60);
  const sitK1 = boss.sitK ?? 0;
  boss.pose = null;
  for (let i = 0; i < 20; i++) e.tick(1 / 60);
  const sitK2 = boss.sitK ?? 0;
  check('坐下/站起：有过渡动画', sitK1 > 0.8 && sitK2 < 0.2, 'sitK=' + sitK1.toFixed(2) + '→' + sitK2.toFixed(2));
}

// 一阶段：打空第一段
for (let i = 0; i < 40 && boss.phase === 0; i++) e.hurtEnemy(boss, 20000);
check('第一段打完：过场对话', e.phase === 'bossintro' && e.bossIntro?.kind === 'dragon-phase-1', e.bossIntro?.kind ?? e.phase);
check('进剧情前清掉受击高亮', (boss.hitFlash ?? 0) === 0, 'hitFlash=' + boss.hitFlash);
e.activeSkillId = 'purge'; e.unlockedSkills = ['purge'];
e.laserSkillOn = true; e.purge = { phase: 'hunt', t: 0 }; e.skillTimer = 3; e.teleportsLeft = 3;   // 模拟开打前挂着的技能
for (let i = 0; i < 50 && e.phase === 'bossintro'; i++) e.advanceBossIntro();
check('第二段开始：重置 10 万 + 封锁', boss.phase === 1 && boss.hp === 100000 && e.dragonLock?.weapon === true && e.dragonLock?.skill === true,
  'phase=' + boss.phase + ' hp=' + boss.hp);
{
  e.player.x = 60; e.player.y = 60;
  const homeDist = Math.hypot(boss.x - (boss.home?.x ?? boss.x), boss.y - (boss.home?.y ?? boss.y));
  for (let i = 0; i < 60 * 2; i++) e.tick(1 / 60);
  check('二阶段：守在门口放弹幕（不靠近）', homeDist < 8 && e.enemyBullets.length > 0, 'homeDist=' + Math.round(homeDist) + ' bullets=' + e.enemyBullets.length);
}
check('二阶段：轮盘先不显示（等吃白饭）', e.dragonReel == null, String(e.dragonReel));
check('二阶段：已挂着的技能被掐掉', e.laserSkillOn === false && !e.purge && (e.skillTimer ?? 0) === 0 && (e.teleportsLeft ?? 0) === 0,
  'laser=' + e.laserSkillOn + ' purge=' + !!e.purge + ' timer=' + e.skillTimer + ' tp=' + e.teleportsLeft);
check('二阶段：BGM 已开始', !!e.dragonBgm && e.dragonBgm.paused === false, e.dragonBgm ? e.dragonBgm.src : 'none');
check('二阶段：自动武器被封锁', e.autoWeaponsEnabled() === false, String(e.autoWeaponsEnabled()));
const skillBefore = e.skillTimer ?? 0;
e.activateActiveSkill();
check('二阶段：技能被封锁（放不出来）', (e.skillTimer ?? 0) === skillBefore && !e.purge && !e.railCharge, 'timer=' + e.skillTimer + ' purge=' + !!e.purge);

// 推进 6 秒逻辑：弹幕 + 白饭（仿真里让玩家无敌，避免随机中弹干扰流程检查）
e.player.maxHp = 99999; e.player.hp = 99999; e.player.invuln = 999;
for (let i = 0; i < 360; i++) e.tick(1 / 60);
const snap2 = e.snapshot();
check('快照：Boss 三段/第二段/轮盘未显示/锁定', snap2.boss && snap2.boss.dragon === true && snap2.boss.phaseCount === 3 && snap2.boss.phase === 2 && snap2.boss.reel == null && snap2.boss.lock?.weapon === true,
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
  e.player.maxHp = 99999; e.player.hp = 1; e.player.invuln = 999;   // 血打低，验证白饭回满
  e.tick(1 / 60);
  check('白饭：回满体力', e.player.hp === e.player.maxHp, 'hp=' + e.player.hp);
  check('白饭：吃完轮盘才出现并开始转', !!e.dragonReel && e.dragonReel.spinT > 0, 'spinT=' + e.dragonReel?.spinT);
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
e.player.hp = Math.round(e.player.maxHp * 0.3);
e.dragonSpawnRice();
if (e.dragonRice.length) {
  const r3 = e.dragonRice[e.dragonRice.length - 1];
  e.player.x = r3.x; e.player.y = r3.y;
  e.tick(1 / 60);
  check('第三碗白饭：回满体力且不转轮盘', e.player.hp === e.player.maxHp && e.dragonReel?.spinning !== true,
    'hp=' + Math.round(e.player.hp) + '/' + e.player.maxHp + ' spinning=' + e.dragonReel?.spinning);
  e.player.x = 60; e.player.y = 60;
} else check('第三碗白饭：能刷出', false);

// 二阶段打空
for (let i = 0; i < 60 && boss.phase === 1; i++) e.hurtEnemy(boss, 30000);
check('第二段打完：坐下 + 逆位对话', e.phase === 'bossintro' && e.bossIntro?.kind === 'dragon-phase-2' && boss.pose === 'sit',
  'kind=' + e.bossIntro?.kind + ' pose=' + boss.pose);
for (let i = 0; i < 30; i++) e.tick(1 / 60);
check('逆位对话：黑紫粒子提前出现', (e.dragonAuraParticles?.length ?? 0) > 0, 'particles=' + (e.dragonAuraParticles?.length ?? 0));
for (let i = 0; i < 60 && e.phase === 'bossintro'; i++) e.advanceBossIntro();
{
  e.player.x = 60; e.player.y = 60;
  const before3 = Math.hypot(e.player.x - boss.x, e.player.y - boss.y);
  for (let i = 0; i < 60; i++) e.tick(1 / 60);
  const after3 = Math.hypot(e.player.x - boss.x, e.player.y - boss.y);
  check('第三段：贴上玩家放弹幕', after3 < before3 + 1, 'before=' + Math.round(before3) + ' after=' + Math.round(after3));
}
check('第三段：无敌剧情杀', boss.phase === 2 && boss.invuln === true && e.dragonScriptedDeath === true, 'phase=' + boss.phase);

// 处决计时：先无敌顶住弹幕，6.5s 前不该死，之后被处决
e.player.maxHp = 99999; e.player.hp = 99999; e.player.invuln = 999;
for (let i = 0; i < 60 * 5; i++) e.tick(1 / 60);
check('三阶段：5 秒时还活着（处决未到）', e.player.hp > 0 && e.phase === 'playing', 'hp=' + e.player.hp + ' phase=' + e.phase);
for (let i = 0; i < 60 * 4; i++) e.tick(1 / 60);
check('三阶段：6.5 秒后被处决', e.player.hp <= 0 || e.phase === 'dying' || e.phase === 'bossintro', 'hp=' + e.player.hp + ' phase=' + e.phase);
for (let i = 0; i < 60 * 3; i++) e.tick(1 / 60);
check('死亡后：回到开局场景 + 醒来独白（闭环）',
  e.storyMode === true && !!e.story && !e.dragonBoss() && e.phase === 'bossintro' && e.bossIntro?.kind === 'story-loopmono',
  'storyMode=' + e.storyMode + ' kind=' + e.bossIntro?.kind + ' boss=' + !!e.dragonBoss());
check('死亡后：醒来独白非空且没有「系统」说话',
  (e.bossIntro?.lines?.length ?? 0) >= 3 && !(e.bossIntro?.lines ?? []).some((l) => l.speaker === '系统') && (e.bossIntro?.lines ?? []).some((l) => String(l.text).includes('新建文件夹')),
  JSON.stringify((e.bossIntro?.lines ?? []).map((l) => l.speaker)));
check('死亡后：BGM 已停 / 阶段状态清空', !e.dragonBgm && !e.dragonLock && !e.dragonReel, 'bgm=' + !!e.dragonBgm + ' lock=' + JSON.stringify(e.dragonLock));
check('死亡后：世界回到程序化虚无（不是关卡 6 地图）', !e.level && !!e.procmap, 'level=' + (e.level?.id ?? 'null') + ' procmap=' + !!e.procmap);

// 和开局一样：先走到 ？？？ 面前按 F
for (let i = 0; i < 40 && e.phase === 'bossintro'; i++) e.advanceBossIntro();
check('开局重演：进入 walk（？？？在前面）', e.phase === 'playing' && e.story?.step === 'walk', 'phase=' + e.phase + ' step=' + e.story?.step);
e.player.x = e.story.npc.x - 20; e.player.y = e.story.npc.y;
e.focused = true;
e.keys.add('f');
e.tick(1 / 60);
e.keys.delete('f');
check('开局重演：按 F 触发新对话', e.phase === 'bossintro' && e.bossIntro?.kind === 'story-looptalk', 'kind=' + e.bossIntro?.kind);
for (let i = 0; i < 40 && e.phase === 'bossintro'; i++) e.advanceBossIntro();
check('开局重演：进入 swarm（文件怪包围）', e.phase === 'playing' && e.story?.step === 'swarm', 'phase=' + e.phase + ' step=' + e.story?.step);
// swarm 0.4s 后：刷 16 只文件怪 + 留白饭 + 龙娘起飞 + 吐槽对白
e.player.maxHp = 99999; e.player.hp = 99999; e.player.invuln = 999;
for (let i = 0; i < 60; i++) e.tick(1 / 60);
check('开局重演：文件怪包围（16 只）', e.enemies.length >= 12, 'enemies=' + e.enemies.length);
check('开局重演：白饭落地', !!e.story?.bowl, 'bowl=' + JSON.stringify(e.story?.bowl));
check('开局重演：带着记忆回来，不再有暴乱吐槽', e.phase === 'playing' && !e.bossIntro,
  'phase=' + e.phase + ' intro=' + JSON.stringify(e.bossIntro?.kind ?? null));
// 走过去按 F 抢饭
if (e.story?.bowl) { e.player.x = e.story.bowl.x; e.player.y = e.story.bowl.y; }
e.focused = true;
e.keys.add('f');
e.tick(1 / 60);
e.keys.delete('f');
check('开局重演：抢到白饭拿代码鞭', e.player.weapons.some((w) => w.type === 'whip') && e.story?.step === 'eating', 'step=' + e.story?.step + ' weapons=' + JSON.stringify(e.player.weapons));
for (let i = 0; i < 60 * 3; i++) e.tick(1 / 60);
check('开局重演：吃完进入战斗', e.story?.step === 'fight', 'step=' + e.story?.step);
// 等逆位时刻：把表拨到逆位（开局也是等 30/30/30 循环）
e.cycleStartAt = e.elapsed - 61;
e.tick(1 / 60);
check('开局重演：逆位时刻开门（乱流）', !!e.story?.rift, 'rift=' + !!e.story?.rift);
if (e.story?.rift) { e.player.x = e.story.rift.x; e.player.y = e.story.rift.y; }
e.tick(1 / 60);
check('开局重演：走进乱流 → ending', e.story?.step === 'ending', 'step=' + e.story?.step);
for (let i = 0; i < 60 * 3; i++) e.tick(1 / 60);
check('闭环结束：回到家里（不播小狼）', (e.phase === 'home' || e.inHomeScene() === true) && !e.homeScene, 'phase=' + e.phase + ' homeScene=' + !!e.homeScene);

// ── 龙娘帧素材：预渲染帧齐全 / 绘制不抛错 / Boss 头像存在 ──
const FRAME_DIR = require('path').join(__dirname, '..', 'assets', 'dragon', 'frames');
const frameSpec = { idle: 24, determined: 18, angry: 18, sit: 12, hurt: 6 };
let frameOk = true, frameTotal = 0;
for (const [state, n] of Object.entries(frameSpec)) {
  for (let i = 0; i < n; i++) {
    const f = require('path').join(FRAME_DIR, state + '-' + i + '.png');
    if (!fs.existsSync(f) || fs.statSync(f).size < 1000) { frameOk = false; console.log('  missing frame', state + '-' + i); }
    frameTotal++;
  }
}
check('龙娘帧：' + frameTotal + ' 张预渲染帧齐全', frameOk, 'checked=' + frameTotal);
try {
  for (const phase of [0, 1, 2]) {
    e.drawDragonFrames(fakeCtx(), { x: 450, y: 168, phase, pose: null, hitFlash: 0 });
    e.drawDragonFrames(fakeCtx(), { x: 450, y: 168, phase, pose: 'sit', hitFlash: 0 });
  }
  e.drawDragonRice(fakeCtx());
  check('龙娘帧：绘制不抛错', true);
} catch (err) {
  check('龙娘帧：绘制不抛错', false, String(err));
}
check('Boss 头像：assets/npc/codex-girl.png 存在', fs.existsSync(require('path').join(__dirname, '..', 'assets', 'npc', 'codex-girl.png')));

// ── 五宝箱门槛：没开完不能进 Boss 房 ─────────────────────// ── 五宝箱门槛：没开完不能进 Boss 房 ─────────────────────
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
check('门槛：开场白直接「你终于来了呢」', e3.bossIntro?.lines?.length === 1 && e3.bossIntro.lines[0].speaker === '正义' && String(e3.bossIntro.lines[0].text).includes('你终于来了呢'), 'lines=' + JSON.stringify(e3.bossIntro?.lines));

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
