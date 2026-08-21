/**
 * ============================================================================
 * dsh-vs-game 浏览器半侧（client half）—— 工作中的大肥鱼
 * ============================================================================
 *
 * DSH 客户端 bundle 强制形态：window.__ModuleLoader__.load({ id, factory })
 * React 从外壳 require（禁止自行打包）；CSS 内联注入；挂 shell.overlay 槽位。
 *
 * ⚠️ 关键约定：react/jsx-runtime 的 jsx/jsxs（下文 h/hs）子节点必须通过
 *    props.children 传递，不是可变参数！（M1 踩过的坑）
 *
 * 分区导览：
 *   [1] 协议常量（与 host lib/protocol.js 同步）
 *   [2] CSS
 *   [3] 精灵系统（whale-girl sprite sheets）
 *   [4] WebSocket Hook
 *   [5] 游戏数据表（敌人 / 武器 / 被动）
 *   [6] 空间哈希网格
 *   [7] GameEngine（纯 JS，Canvas 渲染）
 *   [8] React 组件（游戏窗口 / HUD / 菜单 / 升级弹窗）
 *   [9] cordis 插件三件套
 */
window.__ModuleLoader__.load({
	id: 'dsh-vs-game',

	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		let react = require('react');
		let { useCallback, useEffect, useRef, useState } = react;
		let { jsx: h, jsxs: hs } = require('react/jsx-runtime');

		// ════════════════════════════════════════════════════════════════════
		// [1] 协议常量（host lib/protocol.js 的内联副本，两处必须同步）
		// ════════════════════════════════════════════════════════════════════
		const HostMsg = {
			HELLO: 'hello', SPAWN: 'spawn', DROP_XP: 'drop-xp',
			WAVE_START: 'wave-start', WAVE_CLEAR: 'wave-clear',
			BOSS_SPAWN: 'boss-spawn', BUFF: 'buff', SCREEN_NUKE: 'screen-nuke',
			IDLE_SPAWN: 'idle-spawn', IDLE_BOSS: 'idle-boss',
			CONFIG: 'config', TOGGLE_PANEL: 'toggle-panel', SAVED: 'saved',
		};
		const ClientMsg = { GAME_START: 'game-start', GAME_OVER: 'game-over', HEARTBEAT: 'heartbeat' };

		function decodeFrame(text) {
			const out = [];
			for (const line of String(text).split('\n')) {
				const t = line.trim();
				if (!t) continue;
				try { out.push(JSON.parse(t)); } catch { /* 容错跳过 */ }
			}
			return out;
		}

		// ════════════════════════════════════════════════════════════════════
		// [2] CSS
		// ════════════════════════════════════════════════════════════════════
		const CSS_TAG = 'dsh-vs-game/style.css';
		const css = [
			'.dsh-vs-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}',
			// 入口按钮
			'.dsh-vs-toggle{position:absolute;right:24px;bottom:24px;width:48px;height:48px;border-radius:50%;',
			'  background:linear-gradient(135deg,#4f6ef7,#7c5cfc);color:#fff;font-size:24px;line-height:1;',
			'  display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;',
			'  border:none;box-shadow:0 4px 16px rgba(79,110,247,.45);transition:transform .15s ease;}',
			'.dsh-vs-toggle:hover{transform:scale(1.08)}',
			'.dsh-vs-toggle:active{transform:scale(.95)}',
			// 游戏窗口（居中 + 标题栏可拖拽移动）
			'.dsh-vs-win{position:absolute;left:50%;top:50%;',
			'  background:#0e1017;color:#e6e8f0;border:1px solid #2a2e3d;border-radius:14px;',
			'  box-shadow:0 16px 60px rgba(0,0,0,.6);pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;}',
			'.dsh-vs-head{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;',
			'  background:linear-gradient(90deg,#1a1e2c,#14161f);border-bottom:1px solid #2a2e3d;min-width:560px;',
			'  cursor:grab;user-select:none;touch-action:none;}',
			'.dsh-vs-head:active{cursor:grabbing}',
			'.dsh-vs-title{font-size:13px;font-weight:600;letter-spacing:.5px;}',
			'.dsh-vs-head-right{display:flex;align-items:center;gap:8px;}',
			'.dsh-vs-dot{width:8px;height:8px;border-radius:50%;display:inline-block;}',
			'.dsh-vs-dot.ok{background:#3ddc84;box-shadow:0 0 6px #3ddc84}',
			'.dsh-vs-dot.bad{background:#ff5f56}',
			'.dsh-vs-dot.wait{background:#f5c542}',
			'.dsh-vs-iconbtn{background:none;border:none;color:#8a8fa3;font-size:14px;cursor:pointer;padding:3px 8px;border-radius:6px;}',
			'.dsh-vs-iconbtn:hover{color:#fff;background:#2a2e3d}',
			// 战场区（canvas 已 display:block 消除底部空隙，不要在此设 line-height:0，
			// 否则覆盖层里的多行文字会叠成一行）
			'.dsh-vs-stage{position:relative;}',
			'.dsh-vs-stage canvas{outline:none;display:block;}',
			'.dsh-vs-stage canvas:focus{box-shadow:inset 0 0 0 2px rgba(79,110,247,.55);}',
			// HUD
			'.dsh-vs-hud{position:absolute;inset:0;pointer-events:none;font-size:12px;line-height:1.4;}',
			'.dsh-vs-hud-tl{position:absolute;left:10px;top:8px;display:flex;flex-direction:column;gap:4px;width:220px;}',
			'.dsh-vs-bar{height:10px;border-radius:5px;background:#1c1f2b;overflow:hidden;border:1px solid #2a2e3d;}',
			'.dsh-vs-bar>i{display:block;height:100%;border-radius:5px;}',
			'.dsh-vs-hp>i{background:linear-gradient(90deg,#ff5f56,#ff8a5c);}',
			'.dsh-vs-xp>i{background:linear-gradient(90deg,#4f6ef7,#9d6bff);}',
			'.dsh-vs-hud-tr{position:absolute;right:10px;top:8px;text-align:right;color:#aab0c4;font-variant-numeric:tabular-nums;}',
			'.dsh-vs-timer{font-size:18px;font-weight:700;color:#e6e8f0;}',
			'.dsh-vs-hud-bl{position:absolute;left:10px;bottom:8px;display:flex;gap:4px;}',
			'.dsh-vs-hud-br{position:absolute;right:10px;bottom:8px;display:flex;gap:4px;}',
			'.dsh-vs-chip{min-width:30px;padding:3px 5px;border-radius:6px;background:rgba(20,22,31,.85);',
			'  border:1px solid #2a2e3d;text-align:center;color:#cfd3e4;font-size:11px;line-height:1.25;}',
			'.dsh-vs-chip b{display:block;font-size:10px;color:#8a8fa3;font-weight:600;}',
			// 键盘提示
			'.dsh-vs-keys{position:absolute;right:10px;top:50px;pointer-events:auto;}',
			'.dsh-vs-keys button{background:rgba(20,22,31,.9);color:#cfd3e4;border:1px solid #2a2e3d;border-radius:8px;',
			'  padding:5px 10px;font-size:12px;cursor:pointer;}',
			'.dsh-vs-keys button:hover{border-color:#4f6ef7;color:#fff}',
			'.dsh-vs-focus-hint{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);',
			'  background:rgba(20,22,31,.9);border:1px solid #2a2e3d;color:#aab0c4;font-size:11px;padding:3px 10px;border-radius:8px;}',
			// 全屏覆盖层（菜单/暂停/结算/升级）
			'.dsh-vs-cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;',
			'  background:rgba(10,12,18,.82);pointer-events:auto;gap:14px;padding:20px;line-height:1.5;}',
			'.dsh-vs-cover h2{margin:0;font-size:22px;letter-spacing:1px;}',
			'.dsh-vs-cover .sub{color:#8a8fa3;font-size:12px;line-height:1.7;text-align:center;max-width:520px;}',
			'.dsh-vs-btn{background:linear-gradient(135deg,#4f6ef7,#7c5cfc);color:#fff;border:none;border-radius:10px;',
			'  padding:10px 28px;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:1px;}',
			'.dsh-vs-btn:hover{filter:brightness(1.12)}',
			'.dsh-vs-btn.ghost{background:#1c1f2b;border:1px solid #2a2e3d;color:#cfd3e4;font-weight:400;}',
			'.dsh-vs-stats{display:flex;gap:22px;color:#cfd3e4;font-size:13px;}',
			'.dsh-vs-stats b{display:block;font-size:20px;color:#fff;}',
			'.dsh-vs-credit{font-size:11px;color:#4d5164;}',
			// 升级三选一
			'.dsh-vs-cards{display:flex;gap:12px;}',
			'.dsh-vs-card{width:170px;background:#161926;border:1px solid #2a2e3d;border-radius:12px;padding:14px 12px;',
			'  cursor:pointer;text-align:center;transition:transform .1s ease,border-color .1s ease;}',
			'.dsh-vs-card:hover{transform:translateY(-4px);border-color:#7c5cfc;}',
			'.dsh-vs-card .icon{font-size:26px;}',
			'.dsh-vs-card .nm{font-weight:700;font-size:14px;margin-top:6px;}',
			'.dsh-vs-card .lv{color:#9d6bff;font-size:11px;margin-top:2px;}',
			'.dsh-vs-card .desc{color:#8a8fa3;font-size:11px;margin-top:8px;line-height:1.5;}',
			'.dsh-vs-card .key{display:inline-block;margin-top:8px;font-size:10px;color:#4d5164;border:1px solid #2a2e3d;border-radius:4px;padding:1px 6px;}',
		].join('\n');
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-vs-game';
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ════════════════════════════════════════════════════════════════════
		// [3] 精灵系统 —— whale-girl sprite sheets（host 资源路由提供）
		// ════════════════════════════════════════════════════════════════════
		const SPRITE_BASE = '/vs-game/assets/whale-girl/';
		const spriteCache = { manifest: null, states: new Map(), failed: false, error: null, loaded: 0, total: 0 };
		const spriteListeners = new Set();
		function notifySpriteStatus() { for (const fn of spriteListeners) { try { fn(); } catch { /* noop */ } } }

		async function ensureSprites() {
			if (spriteCache.manifest || spriteCache.failed) return spriteCache.manifest;
			try {
				const res = await fetch(SPRITE_BASE + 'manifest.json');
				if (!res.ok) throw new Error('manifest HTTP ' + res.status);
				spriteCache.manifest = await res.json();
				const states = spriteCache.manifest?.characters?.['whale-girl']?.states ?? {};
				spriteCache.total = Object.keys(states).length;
				notifySpriteStatus();
				for (const [stateName, info] of Object.entries(states)) {
					const img = new Image();
					img.src = SPRITE_BASE + info.sheet;
					spriteCache.states.set(stateName, { img, ...info, ready: false });
					img.onload = () => {
						const rec = spriteCache.states.get(stateName);
						if (rec) { rec.ready = true; rec.frameW = img.naturalWidth / info.frames; rec.frameH = img.naturalHeight; }
						spriteCache.loaded++;
						notifySpriteStatus();
					};
					img.onerror = () => { spriteCache.loaded++; notifySpriteStatus(); };
				}
				return spriteCache.manifest;
			} catch (e) {
				spriteCache.failed = true;
				spriteCache.error = String(e?.message ?? e);
				notifySpriteStatus();
				return null;
			}
		}

		function frameIndexAt(info, t) {
			const n = info.frames || 1;
			const fps = info.fps || 2;
			const phase = (t * fps) % (n * 2);
			switch (info.playback) {
				case 'pingpong': {
					const i = Math.floor(phase) % (n * 2);
					return i < n ? i : n * 2 - 1 - i;
				}
				case 'once':
					return Math.min(n - 1, Math.floor(t * fps));
				case 'blink': {
					const cycle = t % 4;
					if (cycle < 3.6 || n < 3) return 0;
					return Math.min(n - 1, 1 + Math.floor((cycle - 3.6) / 0.2));
				}
				case 'loop':
				default:
					return Math.floor(t * fps) % n;
			}
		}

		function drawSprite(ctx2d, stateName, t, cx, cy, size, flip) {
			const rec = spriteCache.states.get(stateName);
			if (!rec || !rec.ready) return false;
			const idx = frameIndexAt(rec, t);
			const fw = rec.frameW || rec.img.naturalWidth;
			const fh = rec.frameH || rec.img.naturalHeight;
			ctx2d.save();
			ctx2d.translate(cx, cy);
			if (flip) ctx2d.scale(-1, 1);
			ctx2d.drawImage(rec.img, idx * fw, 0, fw, fh, -size / 2, -size / 2, size, size);
			ctx2d.restore();
			return true;
		}

		// ════════════════════════════════════════════════════════════════════
		// [4] WebSocket Hook
		// ════════════════════════════════════════════════════════════════════
		function useGameWs(onMsgRef) {
			const [status, setStatus] = useState('connecting');
			const wsRef = useRef(null);
			const send = useCallback((obj) => {
				const ws = wsRef.current;
				if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ v: 1, ...obj }) + '\n');
			}, []);
			useEffect(() => {
				let disposed = false;
				let failures = 0;
				let timer = null;
				function connect() {
					if (disposed) return;
					const url = new URL('/vs-game/ws', location.origin);
					url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
					setStatus('connecting');
					const ws = new WebSocket(url.toString());
					wsRef.current = ws;
					ws.onopen = () => { failures = 0; setStatus('open'); };
					ws.onmessage = (evt) => {
						for (const msg of decodeFrame(evt.data)) {
							try { onMsgRef.current?.(msg); } catch { /* 单条消息容错 */ }
						}
					};
					ws.onclose = () => {
						wsRef.current = null;
						if (disposed) return;
						setStatus('closed');
						timer = setTimeout(connect, Math.min(1000 * Math.pow(2, failures++), 30000));
					};
					ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
				}
				connect();
				return () => {
					disposed = true;
					if (timer) clearTimeout(timer);
					try { wsRef.current?.close(); } catch { /* noop */ }
				};
			}, []);
			return { status, send };
		}

		// ════════════════════════════════════════════════════════════════════
		// [5] 游戏数据表
		// ════════════════════════════════════════════════════════════════════
		const GAME_W = 840;
		const GAME_H = 520;

		/** 敌人种类（M3 起由文件扩展名映射而来；tier 决定待机刷怪出现时段） */
		const ENEMY_TYPES = {
			misc:   { hp: 1,  speed: 55, size: 15, color: '#b9bfcc', label: '??',   xp: 0.5, tier: 0 },
			docs:   { hp: 1,  speed: 42, size: 15, color: '#9aa2b1', label: 'MD',   xp: 0.5, tier: 0 },
			config: { hp: 2,  speed: 46, size: 15, color: '#ffb74d', label: 'JSON', xp: 0.7, tier: 0 },
			js:     { hp: 2,  speed: 64, size: 17, color: '#f7df1e', label: 'JS',   xp: 1.0, tier: 1 },
			shell:  { hp: 2,  speed: 74, size: 15, color: '#4eaa25', label: 'SH',   xp: 1.0, tier: 1 },
			py:     { hp: 3,  speed: 52, size: 17, color: '#3776ab', label: 'PY',   xp: 1.2, tier: 1 },
			search: { hp: 1,  speed: 96, size: 12, color: '#8fe3f2', label: 'SRCH', xp: 0.4, tier: 1 },
			html:   { hp: 3,  speed: 60, size: 17, color: '#e44d26', label: 'HTML', xp: 1.2, tier: 2 },
			ts:     { hp: 4,  speed: 58, size: 17, color: '#3178c6', label: 'TS',   xp: 2.0, tier: 2 },
			go:     { hp: 4,  speed: 72, size: 17, color: '#00add8', label: 'GO',   xp: 2.0, tier: 2 },
			rs:     { hp: 6,  speed: 44, size: 19, color: '#dea584', label: 'RS',   xp: 3.0, tier: 3 },
			bin:    { hp: 8,  speed: 36, size: 21, color: '#c62828', label: 'EXE',  xp: 4.0, tier: 3 },
			term:   { hp: 10, speed: 30, size: 23, color: '#546e7a', label: 'TTY',  xp: 5.0, tier: 3 },
		};
		const TIERS_BY_TIME = [
			[0,   ['misc', 'docs', 'config']],
			[45,  ['js', 'shell', 'py', 'search', 'docs']],
			[110, ['ts', 'html', 'go', 'js', 'config']],
			[180, ['rs', 'bin', 'term', 'ts', 'go']],
		];

		const WEAPONS = {
			whip:  { icon: '🪢', name: '代码鞭',   desc: '环形鞭波扫荡周围一圈', lvDesc: ['一圈', '两圈', '三圈 + 范围', '三圈 + 伤害 & 击退'] },
			bolt:  { icon: '🔷', name: 'Token弹',  desc: '射击最近的敌人',     lvDesc: ['单发', '双发', '穿透+1', '穿透+2 加速'] },
			orb:   { icon: '🌀', name: '语法环绕', desc: '绕身旋转的接触球',   lvDesc: ['2 球', '3 球', '半径与转速+', '4 球 伤害+'] },
			laser: { icon: '✚', name: '编译激光', desc: '周期性十字激光',     lvDesc: ['四方向', '八方向', '伤害+', '持续时间+'] },
			mine:  { icon: '💣', name: '注释地雷', desc: '沿途布雷，近炸',     lvDesc: ['存 3 颗', '存 4 颗', '范围+ 伤害+', '爆炸减速'] },
			zap:   { icon: '⚡', name: 'Debug雷击', desc: '随机雷劈屏幕内敌人', lvDesc: ['单体', '双击', '连锁 2 个', '范围+ 伤害+'] },
		};
		const PASSIVES = {
			armor:  { icon: '🛡', name: '护甲', desc: '受伤 -1 / 级' },
			regen:  { icon: '💗', name: '回血', desc: '每秒 +0.6 HP / 级' },
			speed:  { icon: '👟', name: '加速', desc: '移速 +8% / 级' },
			might:  { icon: '💪', name: '力量', desc: '全伤害 +12% / 级' },
			haste:  { icon: '⏱', name: '冷却', desc: '武器冷却 -7% / 级' },
			magnet: { icon: '🧲', name: '磁铁', desc: '拾取范围 +28 / 级' },
		};
		const WEAPON_MAX = 4;
		const PASSIVE_MAX = 5;

		/** 精英/Boss 发射的"报错弹幕"文案 */
		const ERROR_TEXTS = ['TypeError', 'ERR!', '404', 'NaN', 'undefined is not a function', 'SegFault', 'EACCES', 'OOM', 'null ref'];

		function xpNext(level) { return Math.floor(6 * Math.pow(1.32, level - 1)) + 2; }
		function rand(a, b) { return a + Math.random() * (b - a); }
		function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
		function shuffle(arr) {
			for (let i = arr.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[arr[i], arr[j]] = [arr[j], arr[i]];
			}
			return arr;
		}

		// ════════════════════════════════════════════════════════════════════
		// [6] 空间哈希网格（碰撞加速：O(n²) → O(n)）
		// ════════════════════════════════════════════════════════════════════
		class SpatialGrid {
			constructor(cellSize) { this.cellSize = cellSize; this.cells = new Map(); }
			clear() { this.cells.clear(); }
			insert(e) {
				const key = Math.floor(e.x / this.cellSize) + ',' + Math.floor(e.y / this.cellSize);
				let cell = this.cells.get(key);
				if (!cell) { cell = []; this.cells.set(key, cell); }
				cell.push(e);
			}
			query(x, y, r) {
				const out = [];
				const cs = this.cellSize;
				const x0 = Math.floor((x - r) / cs), x1 = Math.floor((x + r) / cs);
				const y0 = Math.floor((y - r) / cs), y1 = Math.floor((y + r) / cs);
				for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
					const cell = this.cells.get(cx + ',' + cy);
					if (cell) out.push(...cell);
				}
				return out;
			}
		}

		// ════════════════════════════════════════════════════════════════════
		// [7] GameEngine
		// ════════════════════════════════════════════════════════════════════
		let nextId = 1;

		class GameEngine {
			constructor(canvas, opts) {
				this.canvas = canvas;
				this.ctx2d = canvas.getContext('2d');
				this.sendWs = opts.sendWs ?? (() => {});
				this.onSaved = opts.onSaved ?? (() => {});

				this.phase = 'menu'; // menu | playing | levelup | paused | gameover
				this.keys = new Set();
				this.focused = false;
				this.autoPause = true;

				this.reset();
				this.attachInput();
			}

			reset() {
				this.elapsed = 0;
				this.kills = 0;
				this.player = {
					x: GAME_W / 2, y: GAME_H / 2,
					hp: 100, maxHp: 100, speed: 160,
					level: 1, xp: 0, xpNeed: xpNext(1),
					invuln: 0, celebrate: 0, facing: 1, moving: false,
					weapons: [{ type: 'whip', level: 1 }],
					passives: { armor: 0, regen: 0, speed: 0, might: 0, haste: 0, magnet: 0 },
				};
				this.enemies = [];
				this.gems = [];
				this.projectiles = [];
				this.mines = [];
				this.beams = [];
				this.rings = [];
				this.enemyBullets = [];
				this.particles = [];
				this.dmgNums = [];
				this.grid = new SpatialGrid(64);
				this.spawnTimer = 1;
				this.weaponCd = {};
				this.orbAngle = 0;
				this.orbHitCd = new Map();
				this.shake = 0;
				this.choices = null;
				this.best = null;
				// ── M3 工作联动状态 ──
				this.lastFuelElapsed = -100;  // 上次收到工作燃料的局内时刻（控制待机刷怪让位）
				this.shieldTimer = 0;
				this.freezeTimer = 0;
				this.chaosTimer = 0;
				this.banner = null;           // { text, life }
			}

			// ── 输入：只挂 canvas，焦点不在 canvas 时绝不干扰 DSH 输入框 ──
			attachInput() {
				const c = this.canvas;
				c.tabIndex = 0;
				this._onKeyDown = (e) => {
					const k = e.key.toLowerCase();
					if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', '1', '2', '3', 'p', 'escape'].includes(k)) {
						e.preventDefault();
						e.stopPropagation();
					}
					if (k === 'escape') { c.blur(); return; }
					if (k === 'p' && this.phase === 'playing') { this.pause(); return; }
					if (this.phase === 'levelup' && ['1', '2', '3'].includes(k)) { this.applyChoice(Number(k) - 1); return; }
					this.keys.add(k);
				};
				this._onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
				this._onFocus = () => { this.focused = true; };
				this._onBlur = () => {
					this.focused = false;
					this.keys.clear();
					if (this.autoPause && this.phase === 'playing') this.pause();
				};
				c.addEventListener('keydown', this._onKeyDown);
				c.addEventListener('keyup', this._onKeyUp);
				c.addEventListener('focus', this._onFocus);
				c.addEventListener('blur', this._onBlur);
			}

			destroy() {
				const c = this.canvas;
				c.removeEventListener('keydown', this._onKeyDown);
				c.removeEventListener('keyup', this._onKeyUp);
				c.removeEventListener('focus', this._onFocus);
				c.removeEventListener('blur', this._onBlur);
			}

			focusCanvas() { this.canvas.focus(); }

			// ── 阶段切换 ──
			start() {
				this.reset();
				this.phase = 'playing';
				this.sendWs({ kind: ClientMsg.GAME_START });
				this.focusCanvas();
			}
			pause() { if (this.phase === 'playing') this.phase = 'paused'; }
			resume() { if (this.phase === 'paused') { this.phase = 'playing'; this.focusCanvas(); } }

			/** 是否处于"工作中"（近 10s 收到过真实工作燃料）→ 大额减伤 */
			isWorkActive() { return this.elapsed - this.lastFuelElapsed < 10; }

			// ── host 燃料消息：DSH 真实工作 → 游戏事件 ──
			handleHostMsg(msg) {
				if (msg.kind === HostMsg.SAVED) {
					this.best = msg.bestScore ?? null;
					this.onSaved(msg);
					return;
				}
				if (this.phase !== 'playing') return;
				// 注意：只有"真实工作燃料"才刷新工作活跃时间戳。
				// IDLE_SPAWN/HELLO/CONFIG 等控制消息绝不能算工作（曾导致待机刷怪失效）。
				if ([HostMsg.SPAWN, HostMsg.DROP_XP, HostMsg.BOSS_SPAWN, HostMsg.BUFF, HostMsg.WAVE_START].includes(msg.kind)) {
					this.lastFuelElapsed = this.elapsed;
				}
				switch (msg.kind) {
					case HostMsg.SPAWN:
						this.spawnEnemy(msg.enemy && ENEMY_TYPES[msg.enemy] ? msg.enemy : 'misc', msg.count ?? 1, !!msg.elite);
						break;
					case HostMsg.DROP_XP: {
						const n = msg.gems ?? 1;
						this.dropGems(n, msg.value ?? 1);
						const total = Math.round(n * (msg.value ?? 1));
						if (total >= 8) this.setBanner('💰 工作结算 +' + total + ' 经验');
						break;
					}
					case HostMsg.BOSS_SPAWN:
						this.spawnBoss(msg.enemy && ENEMY_TYPES[msg.enemy] ? msg.enemy : 'bin', msg.hp ?? 80);
						break;
					case HostMsg.BUFF:
						if (msg.buff === 'shield') { this.shieldTimer = msg.duration ?? 5; this.setBanner('🛡 审批等待 → 护盾 ' + (msg.duration ?? 5) + 's'); }
						else if (msg.buff === 'freeze') { this.freezeTimer = msg.duration ?? 10; this.setBanner('❄ 审批中 → 全场减速'); }
						else if (msg.buff === 'chaos') { this.chaosTimer = msg.duration ?? 8; this.setBanner('🔥 重试风暴 → 双倍刷怪双倍经验'); }
						break;
					case HostMsg.WAVE_START:
						this.setBanner('🌊 工作波次 #' + (msg.wave ?? 1) + ' 来袭');
						break;
					case HostMsg.WAVE_CLEAR:
						this.dropGems(3, Math.max(1, (msg.bonusXp ?? 5) / 3));
						this.setBanner('✅ 回合完成 +' + (msg.bonusXp ?? 5) + ' 经验');
						break;
					case HostMsg.SCREEN_NUKE:
						this.nuke();
						this.setBanner('💥 用户中止 → 全屏清怪');
						break;
					default:
						break;
				}
			}

			setBanner(text) { this.banner = { text, life: 2.6 }; }

			spawnBoss(type, hp) {
				if (this.enemies.length >= 240) return;
				const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.bin;
				const pos = this.edgeSpawnPos();
				this.enemies.push({
					id: nextId++, type,
					x: pos.x, y: pos.y,
					hp, maxHp: hp,
					speed: base.speed * 0.6, size: base.size * 3,
					color: base.color, label: base.label,
					xp: base.xp * 8,
					elite: true, boss: true, hitFlash: 0, slow: 0,
				});
				this.setBanner('👾 BOSS：巨型 ' + base.label + ' 文件怪！');
				this.shake = Math.max(this.shake, 0.5);
			}

			/** 精英瞄准弹 / Boss 环形报错弹幕 */
			fireErrorBullets(e) {
				if (this.enemyBullets.length > 60) return;
				const speed = 110 + Math.min(80, this.elapsed / 4);
				const mk = (vx, vy) => this.enemyBullets.push({
					x: e.x, y: e.y, vx, vy, text: pick(ERROR_TEXTS), life: 7,
				});
				if (e.boss) {
					const n = 8;
					const off = rand(0, Math.PI);
					for (let i = 0; i < n; i++) {
						const a = off + (i * Math.PI * 2) / n;
						mk(Math.cos(a) * speed * 0.8, Math.sin(a) * speed * 0.8);
					}
				} else {
					const dx = this.player.x - e.x, dy = this.player.y - e.y;
					const d = Math.hypot(dx, dy) || 1;
					mk((dx / d) * speed, (dy / d) * speed);
				}
			}

			// ── 生成 ──
			edgeSpawnPos() {
				const side = Math.floor(Math.random() * 4);
				const m = 30;
				if (side === 0) return { x: rand(-m, GAME_W + m), y: -m };
				if (side === 1) return { x: rand(-m, GAME_W + m), y: GAME_H + m };
				if (side === 2) return { x: -m, y: rand(-m, GAME_H + m) };
				return { x: GAME_W + m, y: rand(-m, GAME_H + m) };
			}

			spawnEnemy(type, count, elite) {
				for (let i = 0; i < count; i++) {
					if (this.enemies.length >= 240) return;
					const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.misc;
					const pos = this.edgeSpawnPos();
					const hpScale = 1 + this.elapsed / 90;
					this.enemies.push({
						id: nextId++, type,
						x: pos.x + rand(-14, 14), y: pos.y + rand(-14, 14),
						hp: base.hp * hpScale * (elite ? 3 : 1),
						maxHp: base.hp * hpScale * (elite ? 3 : 1),
						speed: base.speed, size: base.size * (elite ? 1.5 : 1),
						color: base.color, label: base.label,
						xp: base.xp * (elite ? 3 : 1),
						elite: !!elite, hitFlash: 0, slow: 0,
					});
				}
			}

			idleSpawn(dt) {
				this.spawnTimer -= dt * (this.chaosTimer > 0 ? 2 : 1);
				if (this.spawnTimer > 0) return;
				const interval = Math.max(0.45, 2.2 - this.elapsed / 120);
				this.spawnTimer = interval;
				const batch = 1 + Math.floor(this.elapsed / 45);
				let pool = TIERS_BY_TIME[0][1];
				for (const [t, types] of TIERS_BY_TIME) if (this.elapsed >= t) pool = types;
				for (let i = 0; i < batch; i++) this.spawnEnemy(pick(pool), 1, false);
				if (this.elapsed > 100 && Math.random() < 0.06) {
					this.spawnEnemy(pick(pool), 1, true);
				}
			}

			dropGems(count, valueEach) {
				for (let i = 0; i < count; i++) {
					if (this.gems.length >= 400) this.gems.shift();
					const a = rand(0, Math.PI * 2);
					const r = rand(6, 40);
					this.gems.push({
						x: Math.max(8, Math.min(GAME_W - 8, this.player.x + Math.cos(a) * r)),
						y: Math.max(8, Math.min(GAME_H - 8, this.player.y + Math.sin(a) * r)),
						value: valueEach, magnetized: false,
					});
				}
			}

			nuke() {
				for (const e of this.enemies) this.burst(e.x, e.y, e.color, 4);
				this.kills += this.enemies.length;
				this.enemies = [];
				this.shake = Math.max(this.shake, 0.4);
			}

			// ── 武器数值工具 ──
			weaponLevel(type) {
				const w = this.player.weapons.find((x) => x.type === type);
				return w ? w.level : 0;
			}
			cdMul() { return Math.max(0.4, 1 - 0.07 * this.player.passives.haste); }
			dmgMul() { return 1 + 0.12 * this.player.passives.might; }

			takeWeaponCd(type) {
				if (this.weaponCd[type] === undefined) this.weaponCd[type] = 0;
				return this.weaponCd[type];
			}

			// ── 主更新 ──
			tick(dt) {
				if (this.phase !== 'playing') return;
				dt = Math.min(dt, 1 / 30);
				this.elapsed += dt;

				if (this.shieldTimer > 0) this.shieldTimer -= dt;
				if (this.freezeTimer > 0) this.freezeTimer -= dt;
				if (this.chaosTimer > 0) this.chaosTimer -= dt;
				if (this.banner) { this.banner.life -= dt; if (this.banner.life <= 0) this.banner = null; }

				// 保底刷怪常驻（工作是额外加怪，不让位）；chaos 期间加倍
				this.idleSpawn(dt);

				this.updatePlayer(dt);
				this.updateEnemies(dt);
				this.buildGrid();
				this.updateWeapons(dt);
				this.updateRings(dt);
				this.updateProjectiles(dt);
				this.updateBeams(dt);
				this.updateMines(dt);
				this.updateEnemyBullets(dt);
				this.checkCollisions();
				this.collectGems(dt);
				this.updateFx(dt);
				this.checkLevelUp();

				if (this.player.hp <= 0) this.gameOver();
			}

			updatePlayer(dt) {
				const p = this.player;
				let dx = 0, dy = 0;
				if (this.focused) {
					if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
					if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
					if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
					if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
				}
				p.moving = dx !== 0 || dy !== 0;
				if (p.moving) {
					const len = Math.hypot(dx, dy);
					const spd = p.speed * (1 + 0.08 * p.passives.speed);
					p.x += (dx / len) * spd * dt;
					p.y += (dy / len) * spd * dt;
					if (dx !== 0) p.facing = dx > 0 ? 1 : -1;
				}
				p.x = Math.max(16, Math.min(GAME_W - 16, p.x));
				p.y = Math.max(16, Math.min(GAME_H - 16, p.y));
				if (p.invuln > 0) p.invuln -= dt;
				if (p.celebrate > 0) p.celebrate -= dt;
				if (p.passives.regen > 0) p.hp = Math.min(p.maxHp, p.hp + 0.6 * p.passives.regen * dt);
			}

			updateEnemies(dt) {
				const p = this.player;
				const slowMul = (e) => (e.slow > 0 ? 0.5 : 1) * (this.freezeTimer > 0 ? 0.5 : 1);
				for (const e of this.enemies) {
					const dx = p.x - e.x, dy = p.y - e.y;
					const d = Math.hypot(dx, dy) || 1;
					const spd = e.speed * slowMul(e);
					e.x += (dx / d) * spd * dt;
					e.y += (dy / d) * spd * dt;
					if (e.hitFlash > 0) e.hitFlash -= dt;
					if (e.slow > 0) e.slow -= dt;
					// 精英/Boss 发射报错弹幕
					if (e.elite) {
						e.shootCd = (e.shootCd ?? rand(1.2, 2.6)) - dt;
						if (e.shootCd <= 0) {
							e.shootCd = e.boss ? 4 : 2.6;
							this.fireErrorBullets(e);
						}
					}
				}
				// 屏外太远的回收
				this.enemies = this.enemies.filter((e) =>
					e.x > -160 && e.x < GAME_W + 160 && e.y > -160 && e.y < GAME_H + 160);
			}

			updateWeapons(dt) {
				for (const w of this.player.weapons) {
					this.weaponCd[w.type] = (this.weaponCd[w.type] ?? 0) - dt;
					if (this.weaponCd[w.type] > 0) continue;
					switch (w.type) {
						case 'whip': this.fireWhip(w.level); this.weaponCd.whip = 1.1 * this.cdMul(); break;
						case 'bolt': this.fireBolt(w.level); this.weaponCd.bolt = 0.85 * this.cdMul(); break;
						case 'laser': this.fireLaser(w.level); this.weaponCd.laser = 2.4 * this.cdMul(); break;
						case 'mine': this.fireMine(w.level); this.weaponCd.mine = 2.6 * this.cdMul(); break;
						case 'zap': this.fireZap(w.level); this.weaponCd.zap = 1.9 * this.cdMul(); break;
						case 'orb': this.weaponCd.orb = 0.1; break; // orb 常驻，cd 只防重复
						default: break;
					}
				}
				// 语法环绕：位置由 orbAngle 驱动
				const orbLv = this.weaponLevel('orb');
				if (orbLv > 0) {
					this.orbAngle += (orbLv >= 3 ? 2.9 : 2.2) * dt;
					const orbR = orbLv >= 3 ? 78 : 62;
					const count = orbLv >= 4 ? 4 : orbLv >= 2 ? 3 : 2;
					const dmg = (orbLv >= 4 ? 2.0 : 1.2) * this.dmgMul();
					for (let i = 0; i < count; i++) {
						const a = this.orbAngle + (i * Math.PI * 2) / count;
						const ox = this.player.x + Math.cos(a) * orbR;
						const oy = this.player.y + Math.sin(a) * orbR;
						for (const e of this.grid.query(ox, oy, 30)) {
							const cdKey = e.id;
							if ((this.orbHitCd.get(cdKey) ?? 0) > this.elapsed) continue;
							this.orbHitCd.set(cdKey, this.elapsed + 0.5);
							this.hurtEnemy(e, dmg);
						}
					}
				}
			}

			fireWhip(lv) {
				// 环形鞭波：Lv1 一圈，Lv2 两圈，Lv3+ 三圈（错峰扩散）
				const count = lv >= 3 ? 3 : lv;
				const radius = lv >= 3 ? 110 : 80;
				const dmg = (lv >= 4 ? 4 : lv >= 3 ? 3 : 2) * this.dmgMul();
				for (let i = 0; i < count; i++) {
					this.rings.push({
						x: this.player.x, y: this.player.y,
						r: 12, maxR: radius, speed: 260,
						damage: dmg, kb: lv >= 4,
						delay: i * 0.15, hitSet: new Set(),
					});
				}
			}

			updateRings(dt) {
				for (const rg of this.rings) {
					if (rg.delay > 0) { rg.delay -= dt; continue; }
					rg.r += rg.speed * dt;
					for (const e of this.grid.query(rg.x, rg.y, rg.maxR)) {
						const d = Math.hypot(e.x - rg.x, e.y - rg.y);
						if (d <= rg.r && d >= rg.r - 28 && !rg.hitSet.has(e.id)) {
							rg.hitSet.add(e.id);
							this.hurtEnemy(e, rg.damage);
							if (rg.kb && d > 0) {
								e.x += ((e.x - rg.x) / d) * 30;
								e.y += ((e.y - rg.y) / d) * 30;
							}
						}
					}
				}
				this.rings = this.rings.filter((rg) => rg.delay > 0 || rg.r < rg.maxR);
			}

			fireBolt(lv) {
				const p = this.player;
				const shots = lv >= 2 ? 2 : 1;
				const pierce = lv >= 4 ? 2 : lv >= 3 ? 1 : 0;
				const speed = lv >= 4 ? 540 : 420;
				const dmg = (lv >= 3 ? 3.5 : 2.5) * this.dmgMul();
				const targets = this.nearestEnemies(shots);
				if (targets.length === 0) return;
				for (let i = 0; i < shots; i++) {
					const t = targets[i % targets.length];
					const dx = t.x - p.x, dy = t.y - p.y;
					const d = Math.hypot(dx, dy) || 1;
					this.projectiles.push({
						x: p.x, y: p.y,
						vx: (dx / d) * speed, vy: (dy / d) * speed,
						damage: dmg, pierce, life: 1.6, hitSet: new Set(), kind: 'bolt',
					});
				}
			}

			fireLaser(lv) {
				const n = lv >= 2 ? 8 : 4;
				const dmg = (lv >= 3 ? 5 : 3) * this.dmgMul();
				const dur = lv >= 4 ? 0.5 : 0.28;
				for (let i = 0; i < n; i++) {
					const a = (i * Math.PI * 2) / n + (lv >= 2 ? Math.PI / 8 : 0);
					this.beams.push({ x: this.player.x, y: this.player.y, angle: a, len: 280, width: 12, damage: dmg, life: dur, maxLife: dur, hitSet: new Set() });
				}
			}

			fireMine(lv) {
				const cap = lv >= 2 ? 4 : 3;
				if (this.mines.length >= cap) this.mines.shift();
				this.mines.push({
					x: this.player.x, y: this.player.y,
					radius: lv >= 3 ? 78 : 60,
					damage: (lv >= 3 ? 10 : 7) * this.dmgMul(),
					slow: lv >= 4, arm: 0.4,
				});
			}

			fireZap(lv) {
				const strikes = lv >= 2 ? 2 : 1;
				const dmg = (lv >= 4 ? 6 : 4) * this.dmgMul();
				const radius = lv >= 4 ? 62 : 46;
				const cands = this.enemies.filter((e) => Math.hypot(e.x - this.player.x, e.y - this.player.y) < 320);
				if (cands.length === 0) return;
				for (let i = 0; i < strikes; i++) {
					const t = pick(cands);
					this.burst(t.x, t.y, '#ffe066', 8);
					this.particles.push({ kind: 'zap', x: t.x, y: t.y, life: 0.22, maxLife: 0.22 });
					for (const e of this.grid.query(t.x, t.y, radius)) {
						if (Math.hypot(e.x - t.x, e.y - t.y) <= radius) this.hurtEnemy(e, dmg);
					}
					if (lv >= 3) {
						for (const e2 of this.grid.query(t.x, t.y, 110)) {
							if (e2 !== t && Math.hypot(e2.x - t.x, e2.y - t.y) <= 110 && Math.random() < 0.5) {
								this.hurtEnemy(e2, dmg * 0.6);
							}
						}
					}
				}
			}

			nearestEnemies(n) {
				return this.enemies
					.map((e) => ({ e, d: Math.hypot(e.x - this.player.x, e.y - this.player.y) }))
					.sort((a, b) => a.d - b.d)
					.slice(0, n)
					.map((x) => x.e);
			}

			updateEnemyBullets(dt) {
				for (const b of this.enemyBullets) {
					b.x += b.vx * dt;
					b.y += b.vy * dt;
					b.life -= dt;
				}
				this.enemyBullets = this.enemyBullets.filter((b) =>
					b.life > 0 && b.x > -60 && b.x < GAME_W + 60 && b.y > -60 && b.y < GAME_H + 60);
			}

			updateProjectiles(dt) {
				for (const pr of this.projectiles) {
					pr.x += pr.vx * dt;
					pr.y += pr.vy * dt;
					pr.life -= dt;
				}
				this.projectiles = this.projectiles.filter((pr) =>
					pr.life > 0 && pr.pierce >= 0 && pr.x > -40 && pr.x < GAME_W + 40 && pr.y > -40 && pr.y < GAME_H + 40);
			}

			updateBeams(dt) {
				for (const b of this.beams) b.life -= dt;
				this.beams = this.beams.filter((b) => b.life > 0);
			}

			updateMines(dt) {
				for (const m of this.mines) {
					if (m.arm > 0) { m.arm -= dt; continue; }
					const near = this.grid.query(m.x, m.y, 26).some((e) => Math.hypot(e.x - m.x, e.y - m.y) < 26);
					if (near) {
						m.dead = true;
						this.burst(m.x, m.y, '#ffb74d', 14);
						this.shake = Math.max(this.shake, 0.18);
						for (const e of this.grid.query(m.x, m.y, m.radius)) {
							if (Math.hypot(e.x - m.x, e.y - m.y) <= m.radius) {
								this.hurtEnemy(e, m.damage);
								if (m.slow) e.slow = 2;
							}
						}
					}
				}
				this.mines = this.mines.filter((m) => !m.dead);
			}

			buildGrid() {
				this.grid.clear();
				for (const e of this.enemies) this.grid.insert(e);
			}

			checkCollisions() {
				const p = this.player;
				// 弹道 vs 敌人
				for (const pr of this.projectiles) {
					for (const e of this.grid.query(pr.x, pr.y, 26)) {
						if (pr.hitSet.has(e.id)) continue;
						if (Math.hypot(e.x - pr.x, e.y - pr.y) < e.size * 0.6 + 7) {
							pr.hitSet.add(e.id);
							this.hurtEnemy(e, pr.damage);
							pr.pierce -= 1;
							if (pr.pierce < 0) { pr.life = 0; break; }
						}
					}
				}
				// 激光 vs 敌人
				for (const b of this.beams) {
					const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
					for (const e of this.grid.query(b.x, b.y, b.len)) {
						if (b.hitSet.has(e.id)) continue;
						const rx = e.x - b.x, ry = e.y - b.y;
						const along = rx * cos + ry * sin;
						if (along < 0 || along > b.len) continue;
						const perp = Math.abs(-rx * sin + ry * cos);
						if (perp < b.width / 2 + e.size * 0.5) {
							b.hitSet.add(e.id);
							this.hurtEnemy(e, b.damage);
						}
					}
				}
				// 护盾期间不吃任何伤害
				if (this.shieldTimer > 0) return;
				// 工作中（10s 内有真实工作燃料）→ 大额减伤 75%
				const workMul = this.isWorkActive() ? 0.25 : 1;
				// 敌人接触伤害
				if (p.invuln <= 0) {
					for (const e of this.grid.query(p.x, p.y, 40)) {
						if (Math.hypot(e.x - p.x, e.y - p.y) < e.size * 0.55 + 13) {
							const raw = (8 + Math.min(20, this.elapsed / 30) + (e.elite ? 4 : 0)) * workMul;
							const dmg = Math.max(1, raw - p.passives.armor);
							p.hp -= dmg;
							p.invuln = 0.7;
							this.shake = Math.max(this.shake, 0.3);
							this.dmgNums.push({ x: p.x, y: p.y - 22, text: '-' + Math.round(dmg), color: '#ff5f56', life: 0.8 });
							break;
						}
					}
				}
				// 报错弹幕命中
				if (p.invuln <= 0) {
					for (const b of this.enemyBullets) {
						if (Math.hypot(b.x - p.x, b.y - p.y) < 15) {
							b.life = 0;
							const dmg = Math.max(1, (6 + Math.min(12, this.elapsed / 40)) * workMul - p.passives.armor);
							p.hp -= dmg;
							p.invuln = 0.5;
							this.shake = Math.max(this.shake, 0.2);
							this.dmgNums.push({ x: p.x, y: p.y - 22, text: b.text, color: '#ff8a5c', life: 0.9 });
							break;
						}
					}
				}
			}

			hurtEnemy(e, dmg) {
				e.hp -= dmg;
				e.hitFlash = 0.12;
				if (this.dmgNums.length < 30) {
					this.dmgNums.push({ x: e.x + rand(-6, 6), y: e.y - e.size, text: String(Math.round(dmg)), color: '#ffe066', life: 0.55 });
				}
				if (e.hp <= 0) this.killEnemy(e);
			}

			killEnemy(e) {
				this.enemies = this.enemies.filter((x) => x !== e);
				this.kills++;
				this.burst(e.x, e.y, e.color, e.elite ? 12 : 6);
				this.dropGemsAt(e.x, e.y, e.xp);
			}

			dropGemsAt(x, y, value) {
				if (this.gems.length >= 400) this.gems.shift();
				this.gems.push({ x, y, value, magnetized: false });
			}

			collectGems(dt) {
				const p = this.player;
				const magnetR = 50 + 28 * p.passives.magnet;
				for (const g of this.gems) {
					const dx = p.x - g.x, dy = p.y - g.y;
					const d = Math.hypot(dx, dy) || 1;
					if (d < magnetR) g.magnetized = true;
					if (g.magnetized) {
						const spd = 320;
						g.x += (dx / d) * spd * dt;
						g.y += (dy / d) * spd * dt;
					}
					if (d < 16) {
						g.taken = true;
						p.xp += g.value * (this.chaosTimer > 0 ? 2 : 1);
					}
				}
				this.gems = this.gems.filter((g) => !g.taken);
			}

			checkLevelUp() {
				const p = this.player;
				while (p.xp >= p.xpNeed) {
					p.xp -= p.xpNeed;
					p.level++;
					p.xpNeed = xpNext(p.level);
					p.celebrate = 1.1;
					this.choices = this.buildChoices();
					this.phase = 'levelup';
					break;
				}
			}

			buildChoices() {
				const p = this.player;
				const cands = [];
				const ownedTypes = p.weapons.map((w) => w.type);
				for (const w of p.weapons) {
					if (w.level < WEAPON_MAX) cands.push({ kind: 'weapon-up', type: w.type });
				}
				if (ownedTypes.length < 6) {
					for (const t of Object.keys(WEAPONS)) {
						if (!ownedTypes.includes(t)) {
							cands.push({ kind: 'weapon-new', type: t });
							if (ownedTypes.length < 2) cands.push({ kind: 'weapon-new', type: t }); // 早期加权
						}
					}
				}
				for (const t of Object.keys(PASSIVES)) {
					if (p.passives[t] < PASSIVE_MAX) cands.push({ kind: 'passive-up', type: t });
				}
				if (cands.length === 0) return [{ kind: 'heal' }, { kind: 'nuke' }];
				const picked = [];
				for (const c of shuffle(cands)) {
					if (picked.length >= 3) break;
					const same = picked.find((x) => x.kind === c.kind && x.type === c.type);
					if (!same) picked.push(c);
				}
				return picked;
			}

			applyChoice(i) {
				if (this.phase !== 'levelup' || !this.choices) return;
				const c = this.choices[i];
				if (!c) return;
				const p = this.player;
				if (c.kind === 'weapon-new') p.weapons.push({ type: c.type, level: 1 });
				else if (c.kind === 'weapon-up') {
					const w = p.weapons.find((x) => x.type === c.type);
					if (w) w.level++;
				} else if (c.kind === 'passive-up') p.passives[c.type]++;
				else if (c.kind === 'heal') p.hp = p.maxHp;
				else if (c.kind === 'nuke') this.nuke();
				this.choices = null;
				this.phase = 'playing';
				this.focusCanvas();
			}

			gameOver() {
				this.phase = 'gameover';
				this.finalScore = this.score();
				this.sendWs({
					kind: ClientMsg.GAME_OVER,
					score: this.finalScore,
					kills: this.kills,
					duration: Math.round(this.elapsed),
					level: this.player.level,
					discovered: [...new Set(this.enemies.map((e) => e.type))],
				});
			}

			score() { return this.kills * 10 + this.player.level * 50 + Math.floor(this.elapsed) * 2; }

			// ── 粒子/飘字 ──
			burst(x, y, color, n) {
				for (let i = 0; i < n; i++) {
					if (this.particles.length > 200) this.particles.shift();
					const a = rand(0, Math.PI * 2);
					const s = rand(30, 120);
					this.particles.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.5), maxLife: 0.5, color, size: rand(2, 5) });
				}
			}

			updateFx(dt) {
				for (const pt of this.particles) {
					pt.life -= dt;
					if (pt.kind === 'spark') { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= 0.9; pt.vy *= 0.9; }
				}
				this.particles = this.particles.filter((pt) => pt.life > 0);
				for (const d of this.dmgNums) { d.life -= dt; d.y -= 34 * dt; }
				this.dmgNums = this.dmgNums.filter((d) => d.life > 0);
				if (this.shake > 0) this.shake -= dt;
			}

			// ── 渲染 ──
			render(now) {
				const c = this.ctx2d;
				const t = now / 1000;
				c.save();
				c.clearRect(0, 0, GAME_W, GAME_H);

				// 震屏
				if (this.shake > 0) c.translate(rand(-3, 3), rand(-3, 3));

				this.drawBackground(c);
				this.drawGems(c, t);
				this.drawMines(c, t);
				this.drawEnemies(c);
				this.drawOrbs(c);
				this.drawRings(c);
				this.drawProjectiles(c);
				this.drawBeams(c);
				this.drawEnemyBullets(c);
				this.drawPlayer(c, t);
				this.drawParticles(c);
				this.drawDmgNums(c);
				this.drawBanner(c);

				c.restore();
			}

			drawEnemyBullets(c) {
				c.save();
				c.font = 'bold 11px ui-monospace,monospace';
				c.textAlign = 'center';
				c.textBaseline = 'middle';
				for (const b of this.enemyBullets) {
					c.shadowColor = '#ff5f56';
					c.shadowBlur = 6;
					c.fillStyle = '#ff8a80';
					c.fillText(b.text, b.x, b.y);
				}
				c.restore();
			}

			drawBanner(c) {
				if (!this.banner) return;
				const k = Math.min(1, this.banner.life / 0.5);
				c.save();
				c.globalAlpha = k;
				c.font = 'bold 20px system-ui,sans-serif';
				c.textAlign = 'center';
				c.textBaseline = 'middle';
				c.shadowColor = '#000';
				c.shadowBlur = 8;
				c.fillStyle = '#ffd54f';
				c.fillText(this.banner.text, GAME_W / 2, 64);
				c.restore();
			}

			drawBackground(c) {
				c.fillStyle = '#0b0d13';
				c.fillRect(-8, -8, GAME_W + 16, GAME_H + 16);
				c.strokeStyle = 'rgba(79,110,247,0.05)';
				c.lineWidth = 1;
				c.beginPath();
				for (let x = 0; x <= GAME_W; x += 48) { c.moveTo(x, 0); c.lineTo(x, GAME_H); }
				for (let y = 0; y <= GAME_H; y += 48) { c.moveTo(0, y); c.lineTo(GAME_W, y); }
				c.stroke();
			}

			drawPlayer(c, t) {
				const p = this.player;
				if (p.invuln > 0 && Math.floor(t * 14) % 2 === 0 && this.phase === 'playing') c.globalAlpha = 0.5;
				let state = 'eat';                       // 站着不动：吃饭
				if (this.phase === 'gameover') state = 'disappointed';
				else if (p.celebrate > 0) state = 'celebrate';
				else if (p.invuln > 0.45) state = 'error';
				else if (p.moving) state = 'walk';
				// whale-girl 素材默认朝左：朝右移动时才需要水平翻转
				const drawn = drawSprite(c, state, t, p.x, p.y, 56, p.facing > 0);
				if (!drawn) {
					c.fillStyle = '#7c5cfc';
					c.beginPath();
					c.arc(p.x, p.y, 14, 0, Math.PI * 2);
					c.fill();
				}
				c.globalAlpha = 1;
				// 工作减伤气场（蓝色虚线环）
				if (this.isWorkActive()) {
					c.save();
					c.strokeStyle = 'rgba(64,196,255,' + (0.45 + Math.sin(t * 5) * 0.2) + ')';
					c.lineWidth = 2;
					c.setLineDash([6, 5]);
					c.beginPath();
					c.arc(p.x, p.y, 30, t, t + Math.PI * 2);
					c.stroke();
					c.restore();
				}
				// 护盾光圈
				if (this.shieldTimer > 0) {
					c.save();
					c.strokeStyle = 'rgba(61,220,132,' + (0.5 + Math.sin(t * 8) * 0.25) + ')';
					c.lineWidth = 3;
					c.beginPath();
					c.arc(p.x, p.y, 34, 0, Math.PI * 2);
					c.stroke();
					c.restore();
				}
			}

			drawEnemies(c) {
				for (const e of this.enemies) {
					const s = e.size;
					const w = s * 1.15, hh = s * 1.35;
					const x = e.x - w / 2, y = e.y - hh / 2;
					const fold = Math.min(7, s * 0.32);
					if (e.elite) {
						c.save();
						c.shadowColor = '#ff5f56';
						c.shadowBlur = 12;
					}
					// 文件主体（圆角矩形 + 折角）
					c.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color;
					c.beginPath();
					c.moveTo(x + 2, y);
					c.lineTo(x + w - fold, y);
					c.lineTo(x + w, y + fold);
					c.lineTo(x + w, y + hh - 2);
					c.quadraticCurveTo(x + w, y + hh, x + w - 2, y + hh);
					c.lineTo(x + 2, y + hh);
					c.quadraticCurveTo(x, y + hh, x, y + hh - 2);
					c.lineTo(x, y + 2);
					c.quadraticCurveTo(x, y, x + 2, y);
					c.closePath();
					c.fill();
					if (e.elite) c.restore();
					// 折角阴影
					c.fillStyle = 'rgba(0,0,0,0.25)';
					c.beginPath();
					c.moveTo(x + w - fold, y);
					c.lineTo(x + w - fold, y + fold);
					c.lineTo(x + w, y + fold);
					c.closePath();
					c.fill();
					// 扩展名标签
					c.fillStyle = e.hitFlash > 0 ? '#333' : 'rgba(10,12,18,0.85)';
					c.font = 'bold ' + Math.max(7, Math.floor(s * 0.42)) + 'px ui-monospace,monospace';
					c.textAlign = 'center';
					c.textBaseline = 'middle';
					c.fillText(e.label, e.x, e.y + s * 0.18);
					// 精英/Boss 血条（Boss 更宽，常驻显示）
					if (e.elite && (e.boss || e.hp < e.maxHp)) {
						const bw = e.boss ? 56 : 32;
						c.fillStyle = '#1c1f2b';
						c.fillRect(e.x - bw / 2, e.y - hh / 2 - 8, bw, e.boss ? 6 : 4);
						c.fillStyle = e.boss ? '#ff9800' : '#ff5f56';
						c.fillRect(e.x - bw / 2, e.y - hh / 2 - 8, bw * Math.max(0, e.hp / e.maxHp), e.boss ? 6 : 4);
					}
				}
			}

			drawGems(c, t) {
				for (const g of this.gems) {
					const v = g.value;
					const color = v > 20 ? '#ffd54f' : v > 5 ? '#b388ff' : v > 1.5 ? '#40c4ff' : '#69f0ae';
					const pulse = 1 + Math.sin(t * 6 + g.x) * 0.12;
					const s = 5 * pulse;
					c.save();
					c.translate(g.x, g.y);
					c.rotate(Math.PI / 4);
					c.fillStyle = color;
					c.fillRect(-s / 2, -s / 2, s, s);
					c.restore();
				}
			}

			drawMines(c, t) {
				for (const m of this.mines) {
					const pulse = 1 + Math.sin(t * 5) * 0.15;
					c.fillStyle = m.arm > 0 ? 'rgba(255,183,77,0.35)' : 'rgba(255,183,77,0.8)';
					c.beginPath();
					c.arc(m.x, m.y, 6 * pulse, 0, Math.PI * 2);
					c.fill();
					c.strokeStyle = 'rgba(255,183,77,0.25)';
					c.beginPath();
					c.arc(m.x, m.y, m.radius * 0.4, 0, Math.PI * 2);
					c.stroke();
				}
			}

			drawOrbs(c) {
				const lv = this.weaponLevel('orb');
				if (lv <= 0) return;
				const count = lv >= 4 ? 4 : lv >= 2 ? 3 : 2;
				const orbR = lv >= 3 ? 78 : 62;
				for (let i = 0; i < count; i++) {
					const a = this.orbAngle + (i * Math.PI * 2) / count;
					const ox = this.player.x + Math.cos(a) * orbR;
					const oy = this.player.y + Math.sin(a) * orbR;
					c.save();
					c.shadowColor = '#9d6bff';
					c.shadowBlur = 10;
					c.fillStyle = '#9d6bff';
					c.beginPath();
					c.arc(ox, oy, 7, 0, Math.PI * 2);
					c.fill();
					c.shadowBlur = 0;
					c.fillStyle = '#fff';
					c.font = 'bold 8px ui-monospace,monospace';
					c.textAlign = 'center';
					c.textBaseline = 'middle';
					c.fillText('{}', ox, oy);
					c.restore();
				}
			}

			drawRings(c) {
				for (const rg of this.rings) {
					if (rg.delay > 0) continue;
					const k = Math.max(0, 1 - rg.r / rg.maxR);
					c.save();
					c.globalAlpha = 0.25 + k * 0.6;
					c.strokeStyle = '#ffd54f';
					c.lineWidth = 5;
					c.beginPath();
					c.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
					c.stroke();
					c.restore();
				}
			}

			drawProjectiles(c) {
				for (const pr of this.projectiles) {
					c.fillStyle = '#40c4ff';
					c.save();
					c.shadowColor = '#40c4ff';
					c.shadowBlur = 8;
					c.beginPath();
					c.arc(pr.x, pr.y, 5, 0, Math.PI * 2);
					c.fill();
					c.restore();
				}
			}

			drawBeams(c) {
				for (const b of this.beams) {
					const alpha = Math.max(0, b.life / b.maxLife);
					c.save();
					c.translate(b.x, b.y);
					c.rotate(b.angle);
					const grad = c.createLinearGradient(0, 0, b.len, 0);
					grad.addColorStop(0, `rgba(157,107,255,${0.85 * alpha})`);
					grad.addColorStop(1, 'rgba(157,107,255,0)');
					c.fillStyle = grad;
					c.fillRect(0, -b.width / 2, b.len, b.width);
					c.restore();
				}
			}

			drawParticles(c) {
				for (const pt of this.particles) {
					const k = Math.max(0, pt.life / pt.maxLife);
					if (pt.kind === 'spark') {
						c.globalAlpha = k;
						c.fillStyle = pt.color;
						c.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
						c.globalAlpha = 1;
					} else if (pt.kind === 'zap') {
						c.globalAlpha = k;
						c.strokeStyle = '#ffe066';
						c.lineWidth = 3;
						c.beginPath();
						c.moveTo(pt.x + rand(-6, 6), pt.y - 260);
						let yy = pt.y - 260;
						while (yy < pt.y) { yy += rand(24, 48); c.lineTo(pt.x + rand(-12, 12), Math.min(yy, pt.y)); }
						c.stroke();
						c.globalAlpha = 1;
					}
				}
			}

			drawDmgNums(c) {
				c.font = 'bold 12px ui-monospace,monospace';
				c.textAlign = 'center';
				for (const d of this.dmgNums) {
					c.globalAlpha = Math.min(1, d.life * 2);
					c.fillStyle = d.color;
					c.fillText(d.text, d.x, d.y);
				}
				c.globalAlpha = 1;
			}

			// ── HUD 快照（React 10fps 轮询） ──
			snapshot() {
				if (typeof window !== 'undefined' && window.__vsGameDebug) window.__vsGameDebug.engine = this;
				return {
					phase: this.phase,
					focused: this.focused,
					hp: Math.max(0, Math.round(this.player.hp)),
					maxHp: this.player.maxHp,
					level: this.player.level,
					xp: this.player.xp,
					xpNeed: this.player.xpNeed,
					elapsed: this.elapsed,
					kills: this.kills,
					score: this.score(),
					weapons: this.player.weapons.map((w) => ({ type: w.type, level: w.level })),
					passives: Object.entries(this.player.passives).filter(([, v]) => v > 0).map(([type, level]) => ({ type, level })),
					choices: this.choices,
					best: this.best,
					buffs: [
						this.isWorkActive() ? { icon: '💼', left: 0, text: '工作中 -75% 受伤' } : null,
						this.shieldTimer > 0 ? { icon: '🛡', left: Math.ceil(this.shieldTimer) } : null,
						this.freezeTimer > 0 ? { icon: '❄', left: Math.ceil(this.freezeTimer) } : null,
						this.chaosTimer > 0 ? { icon: '🔥', left: Math.ceil(this.chaosTimer) } : null,
					].filter(Boolean),
				};
			}
		}

		// 调试钩子：DevTools 控制台可用 __vsGameDebug 查看/操作引擎内部
		if (typeof window !== 'undefined') {
			window.__vsGameDebug = { GameEngine, ENEMY_TYPES, WEAPONS, PASSIVES };
		}

		// ════════════════════════════════════════════════════════════════════
		// [8] React 组件
		// ════════════════════════════════════════════════════════════════════
		function fmtTime(s) {
			const m = Math.floor(s / 60);
			const ss = Math.floor(s % 60);
			return m + ':' + String(ss).padStart(2, '0');
		}

		function Hud({ snap }) {
			return hs('div', { className: 'dsh-vs-hud', children: [
				h('div', { key: 'tl', className: 'dsh-vs-hud-tl', children: [
					h('div', { key: 'hp', className: 'dsh-vs-bar dsh-vs-hp', children: [
						h('i', { key: 'f', style: { width: Math.max(0, snap.hp / snap.maxHp * 100) + '%' } }),
					] }),
					h('div', { key: 'xp', className: 'dsh-vs-bar dsh-vs-xp', children: [
						h('i', { key: 'f', style: { width: Math.min(100, snap.xp / snap.xpNeed * 100) + '%' } }),
					] }),
					h('div', { key: 'lv', style: { color: '#8a8fa3', fontSize: 11 }, children: 'Lv.' + snap.level + '  HP ' + snap.hp + '/' + snap.maxHp }),
				] }),
				h('div', { key: 'tr', className: 'dsh-vs-hud-tr', children: [
					h('div', { key: 't', className: 'dsh-vs-timer', children: fmtTime(snap.elapsed) }),
					h('div', { key: 'k', children: '击杀 ' + snap.kills + ' · 分数 ' + snap.score }),
					snap.buffs.length > 0 ? h('div', { key: 'b', style: { color: '#ffd54f' }, children: snap.buffs.map((b) => b.text ?? (b.icon + b.left + 's')).join('  ') }) : null,
				] }),
				h('div', { key: 'bl', className: 'dsh-vs-hud-bl', children: snap.weapons.map((w) =>
					h('div', { key: w.type, className: 'dsh-vs-chip', children: [
						h('span', { key: 'i', children: WEAPONS[w.type].icon }),
						h('b', { key: 'l', children: 'Lv' + w.level }),
					] })),
				}),
				h('div', { key: 'br', className: 'dsh-vs-hud-br', children: snap.passives.map((p) =>
					h('div', { key: p.type, className: 'dsh-vs-chip', children: [
						h('span', { key: 'i', children: PASSIVES[p.type].icon }),
						h('b', { key: 'l', children: 'Lv' + p.level }),
					] })),
				}),
			] });
		}

		function LevelUpCards({ choices, onPick }) {
			return h('div', { className: 'dsh-vs-cover', children: [
				h('h2', { key: 'h', children: '🎉 升级了！三选一' }),
				h('div', { key: 'cards', className: 'dsh-vs-cards', children: choices.map((c, i) => {
					let icon = '✨', nm = '', lv = '', desc = '';
					if (c.kind === 'weapon-new') { icon = WEAPONS[c.type].icon; nm = WEAPONS[c.type].name; lv = '新武器'; desc = WEAPONS[c.type].desc; }
					else if (c.kind === 'weapon-up') {
						icon = WEAPONS[c.type].icon; nm = WEAPONS[c.type].name;
						const w = null; // 等级从引擎快照读不到单项，用通用文案
						lv = '强化'; desc = WEAPONS[c.type].lvDesc[2];
					} else if (c.kind === 'passive-up') { icon = PASSIVES[c.type].icon; nm = PASSIVES[c.type].name; lv = '被动强化'; desc = PASSIVES[c.type].desc; }
					else if (c.kind === 'heal') { icon = '💖'; nm = '鲸鱼小灶'; lv = ''; desc = '回满 HP'; }
					else if (c.kind === 'nuke') { icon = '🧹'; nm = '一键清理'; lv = ''; desc = '清空全场敌人'; }
					return hs('div', { key: i, className: 'dsh-vs-card', onClick: () => onPick(i), children: [
						h('div', { key: 'i', className: 'icon', children: icon }),
						h('div', { key: 'n', className: 'nm', children: nm }),
						h('div', { key: 'l', className: 'lv', children: lv }),
						h('div', { key: 'd', className: 'desc', children: desc }),
						h('span', { key: 'k', className: 'key', children: '按 ' + (i + 1) }),
					] });
				}) }),
			] });
		}

		/** 游戏窗口：canvas + HUD + 各阶段覆盖层 */
		function GameWindow({ onClose, wsStatus, send }) {
			const canvasRef = useRef(null);
			const engineRef = useRef(null);
			const [snap, setSnap] = useState(null);

			// ── 窗口拖拽（标题栏），位置持久化到 localStorage ──
			const [offset, setOffset] = useState(() => {
				try {
					const raw = localStorage.getItem('dsh-vs-game:win-offset');
					if (raw) { const o = JSON.parse(raw); if (Number.isFinite(o.x) && Number.isFinite(o.y)) return o; }
				} catch { /* noop */ }
				return { x: 0, y: 0 };
			});
			const dragRef = useRef(null);
			const onHeadDown = (e) => {
				if (e.target.closest('button')) return; // 按钮不触发拖拽
				dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
			};
			const onHeadMove = (e) => {
				if (!dragRef.current) return;
				const d = dragRef.current;
				setOffset({ x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy });
			};
			const onHeadUp = () => {
				if (!dragRef.current) return;
				dragRef.current = null;
				try { localStorage.setItem('dsh-vs-game:win-offset', JSON.stringify(offsetRef.current)); } catch { /* noop */ }
			};
			const offsetRef = useRef(offset);
			offsetRef.current = offset;

			// 引擎生命周期
			useEffect(() => {
				const canvas = canvasRef.current;
				if (!canvas) return;
				const dpr = Math.min(window.devicePixelRatio || 1, 2);
				canvas.width = GAME_W * dpr;
				canvas.height = GAME_H * dpr;
				const engine = new GameEngine(canvas, { sendWs: send });
				engineRef.current = engine;
				canvas.getContext('2d').scale(dpr, dpr);
				let raf = 0;
				let last = performance.now();
				const loop = (now) => {
					const dt = (now - last) / 1000;
					last = now;
					try {
						engine.tick(dt);
						engine.render(now);
					} catch { /* 渲染/逻辑错误不炸宿主页面 */ }
					raf = requestAnimationFrame(loop);
				};
				raf = requestAnimationFrame(loop);
				const hudTimer = setInterval(() => setSnap(engine.snapshot()), 100);
				return () => {
					cancelAnimationFrame(raf);
					clearInterval(hudTimer);
					engine.destroy();
					engineRef.current = null;
				};
			}, [send]);

			// host 消息 → 引擎（通过轮询 snap 拿不到，走 window 级转发）
			useEffect(() => {
				gameMsgTarget.engine = engineRef;
				return () => { gameMsgTarget.engine = null; };
			}, []);

			const s = snap;
			return hs('div', {
				className: 'dsh-vs-win',
				style: { transform: 'translate(calc(-50% + ' + offset.x + 'px), calc(-50% + ' + offset.y + 'px))' },
				children: [
				h('div', {
					key: 'head', className: 'dsh-vs-head',
					title: '拖拽移动窗口',
					onPointerDown: onHeadDown, onPointerMove: onHeadMove,
					onPointerUp: onHeadUp, onPointerCancel: onHeadUp,
					children: [
					h('span', { key: 't', className: 'dsh-vs-title', children: '🐟 工作中的大肥鱼' }),
					hs('div', { key: 'r', className: 'dsh-vs-head-right', children: [
						h('span', { key: 'd', className: 'dsh-vs-dot ' + (wsStatus === 'open' ? 'ok' : wsStatus === 'closed' ? 'bad' : 'wait'), title: '工作事件通道' }),
						h('button', { key: 'min', className: 'dsh-vs-iconbtn', title: '关闭面板', onClick: onClose, children: '—' }),
						h('button', { key: 'x', className: 'dsh-vs-iconbtn', title: '关闭', onClick: onClose, children: '✕' }),
					] }),
				] }),
				hs('div', { key: 'stage', className: 'dsh-vs-stage', children: [
					h('canvas', { key: 'cv', ref: canvasRef, style: { width: GAME_W, height: GAME_H } }),
					s && s.phase !== 'menu' ? h(Hud, { key: 'hud', snap: s }) : null,
					s && s.phase === 'playing' && !s.focused ? h('div', { key: 'kh', className: 'dsh-vs-keys', children: [
						h('button', { key: 'b', onClick: () => engineRef.current?.focusCanvas(), children: '🎮 点我接管键盘（WASD 移动）' }),
					] }) : null,
					s && s.phase === 'playing' && s.focused ? h('div', { key: 'fh', className: 'dsh-vs-focus-hint', children: 'WASD/方向键移动 · Esc 释放键盘 · P 暂停' }) : null,
					!s || s.phase === 'menu' ? hs('div', { key: 'menu', className: 'dsh-vs-cover', children: [
						h('h2', { key: 'h', children: '🐟 工作中的大肥鱼' }),
						h('div', { key: 'sub', className: 'sub', children: '文件是敌人，token 是经验。Agent 干活时刷文件怪、掉 token 宝石；没活干时待机刷怪保底。WASD 移动，武器全自动，升级三选一，活下去！' }),
						h('button', { key: 'go', className: 'dsh-vs-btn', onClick: () => engineRef.current?.start(), children: '开始游戏' }),
						h('div', { key: 'cr', className: 'dsh-vs-credit', children: '角色素材：whale-girl（MIT · 画师 ZipZipPipe）' }),
					] }) : null,
					s && s.phase === 'paused' ? hs('div', { key: 'pause', className: 'dsh-vs-cover', children: [
						h('h2', { key: 'h', children: '⏸ 已暂停' }),
						h('button', { key: 'r', className: 'dsh-vs-btn', onClick: () => engineRef.current?.resume(), children: '继续（P）' }),
						h('button', { key: 'q', className: 'dsh-vs-btn ghost', onClick: () => { engineRef.current?.reset(); setSnap(engineRef.current.snapshot()); }, children: '放弃本局' }),
					] }) : null,
					s && s.phase === 'levelup' && s.choices ? h(LevelUpCards, { key: 'lv', choices: s.choices, onPick: (i) => engineRef.current?.applyChoice(i) }) : null,
					s && s.phase === 'gameover' ? hs('div', { key: 'over', className: 'dsh-vs-cover', children: [
						h('h2', { key: 'h', children: '💤 下班了' }),
						h('div', { key: 'st', className: 'dsh-vs-stats', children: [
							h('div', { key: 't', children: [h('b', { key: 'v', children: fmtTime(s.elapsed) }), '存活'] }),
							h('div', { key: 'k', children: [h('b', { key: 'v', children: String(s.kills) }), '击杀'] }),
							h('div', { key: 'l', children: [h('b', { key: 'v', children: 'Lv.' + s.level }), '等级'] }),
							h('div', { key: 's', children: [h('b', { key: 'v', children: String(s.score) }), '分数'] }),
						] }),
						s.best != null ? h('div', { key: 'best', className: 'sub', children: '最佳纪录：' + s.best }) : null,
						h('button', { key: 'again', className: 'dsh-vs-btn', onClick: () => engineRef.current?.start(), children: '再来一局' }),
						h('button', { key: 'menu', className: 'dsh-vs-btn ghost', onClick: () => { engineRef.current?.reset(); setSnap(engineRef.current.snapshot()); }, children: '返回菜单' }),
					] }) : null,
				] }),
			] });
		}

		// host 消息转发目标（useGameWs 在根组件，引擎在游戏窗口内）
		const gameMsgTarget = { engine: null };

		/** 根组件：入口按钮 + 窗口开关 + WS 接入 */
		function VsGameRoot() {
			const [open, setOpen] = useState(false);
			const onMsgRef = useRef(null);
			onMsgRef.current = (msg) => {
				if (msg.kind === HostMsg.TOGGLE_PANEL) { setOpen((o) => !o); return; }
				const ref = gameMsgTarget.engine;
				if (ref?.current) ref.current.handleHostMsg(msg);
			};
			const { status, send } = useGameWs(onMsgRef);
			useEffect(() => { ensureSprites(); }, []);

			return hs('div', { className: 'dsh-vs-root', children: [
				open ? h(GameWindow, { key: 'win', onClose: () => setOpen(false), wsStatus: status, send }) : null,
				h('button', {
					key: 'toggle',
					className: 'dsh-vs-toggle',
					title: '工作中的大肥鱼',
					onClick: () => setOpen((o) => !o),
					children: '🐟',
				}),
			] });
		}

		// ════════════════════════════════════════════════════════════════════
		// [9] cordis 插件三件套
		// ════════════════════════════════════════════════════════════════════
		const name = 'vs-game';
		const inject = ['slots'];

		function apply(ctx, config) {
			ctx.slots.inject('shell.overlay', function* () {
				yield ctx.slots.register({
					name: 'shell.overlay',
					id: 'vs-game',
					order: 1100,
				}, (ownerProps) => h(VsGameRoot, { config, ...ownerProps }));
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
