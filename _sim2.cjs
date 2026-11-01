const fs = require('fs');

// A) 轮盘：第一碗白饭必出武器，第二碗必出技能（之后随机）
let p = 'lib/client.js';
let s = fs.readFileSync(p, 'utf8');
const hadCRLF = s.includes('\r\n');
let t = s.replace(/\r\n/g, '\n');
const old = `					if (r.spinT <= 0) {
						r.spinning = false;
						const W = 96;
						const idx = Math.floor(Math.random() * r.items.length);
						r.offset = idx * W;
						r.result = r.items[idx];
						this.dragonApplyReel(r.result);
					}`;
const next = `					if (r.spinT <= 0) {
						r.spinning = false;
						const W = 96;
						// 第一碗白饭必出自动武器，第二碗必出技能；两个都解锁后随机
						let pool = r.items;
						if (this.dragonLock?.weapon) pool = r.items.filter((it) => it.kind === 'weapon');
						else if (this.dragonLock?.skill) pool = r.items.filter((it) => it.kind === 'skill');
						const pickOne = pool.length ? pool[Math.floor(Math.random() * pool.length)] : r.items[0];
						const idx = Math.max(0, r.items.indexOf(pickOne));
						r.offset = idx * W;
						r.result = pickOne;
						this.dragonApplyReel(pickOne);
					}`;
if (!t.includes(old)) throw new Error('reel anchor');
t = t.replace(old, next);
fs.writeFileSync(p, hadCRLF ? t.replace(/\n/g, '\r\n') : t);

// B) 仿真：不初始化 SVG 覆盖层（Node 里没有动态 import），并补第二碗白饭检查
p = 'tools/sim-level6.cjs';
let sim = fs.readFileSync(p, 'utf8');
sim = sim.replace("canvas.parentElement.querySelector = () => fakeEl('div');", "canvas.parentElement.querySelector = () => null;   // 不初始化 SVG 覆盖层（Node 没有动态 import 回调）");
const marker = "// 二阶段打空";
const extra = `// 第二碗白饭：必出技能
for (let i = 0; i < 60 * 10 && e.dragonRice.length === 0; i++) e.tick(1 / 60);
if (e.dragonRice.length) {
  const r2 = e.dragonRice[0];
  e.player.x = r2.x; e.player.y = r2.y;
  e.player.hp = 99999; e.player.invuln = 999;
  e.tick(1 / 60);
  for (let i = 0; i < 120 && e.dragonReel?.spinning; i++) e.tick(1 / 60);
  check('第二碗白饭：解锁技能', e.dragonLock.skill === false && e.dragonReel?.result?.kind === 'skill',
    'result=' + JSON.stringify(e.dragonReel?.result) + ' lock=' + JSON.stringify(e.dragonLock));
} else {
  check('第二碗白饭：能刷出第二碗', false, 'rice=' + e.dragonRice.length);
}

// 二阶段打空`;
if (!sim.includes(marker)) throw new Error('sim marker');
sim = sim.replace(marker, extra);
fs.writeFileSync(p, sim);
console.log('reel pool + sim updated');
