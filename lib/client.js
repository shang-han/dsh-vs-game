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
			CONFIG: 'config', TOGGLE_PANEL: 'toggle-panel', SAVED: 'saved', CHARACTER: 'character',
			CARDS: 'cards', CARD_RESULT: 'card-result',
		};
		const ClientMsg = {
			GAME_START: 'game-start', GAME_OVER: 'game-over', HEARTBEAT: 'heartbeat',
			SET_INITIAL_WEAPON: 'set-initial-weapon', UPGRADE_PASSIVE: 'upgrade-passive', OPEN_ITEM: 'open-item',
			CHEST_LOOT: 'chest-loot', BOSS_KILL: 'boss-kill', FLIP_PICK: 'flip-pick', FLIP_EXTRA: 'flip-extra',
		};

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
			'.dsh-vs-hud-tc{position:absolute;left:50%;top:6px;transform:translateX(-50%);color:#9d6bff;font-size:12px;',
			'  font-weight:600;letter-spacing:1px;text-shadow:0 1px 4px #000;}',
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
			'.dsh-vs-defer{position:absolute;right:10px;top:96px;z-index:5;background:rgba(20,22,31,.92);color:#ffd54f;border:1px solid #7c5cfc;border-radius:10px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;pointer-events:auto;box-shadow:0 6px 18px rgba(0,0,0,.35);}',
			'.dsh-vs-defer:hover{filter:brightness(1.12);}',
			'.dsh-vs-skill-btn{position:absolute;right:10px;bottom:50px;z-index:6;background:rgba(20,22,31,.92);color:#aab0c4;border:1px solid #2a2e3d;border-radius:10px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;pointer-events:auto;}',
			'.dsh-vs-skill-btn.on{border-color:#ff6b9d;color:#ffd0e0;box-shadow:0 0 12px rgba(255,107,157,.35);}',
			'.dsh-vs-skill-btn:hover{border-color:#ff6b9d;color:#fff;}',
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
			// P3 翻卡结算
			'.dsh-vs-fliprow{display:flex;gap:14px;margin:10px 0;}',
			'.dsh-vs-fcard{width:118px;height:158px;perspective:640px;cursor:pointer;}',
			'.dsh-vs-fcard .inner{position:relative;width:100%;height:100%;transition:transform .5s cubic-bezier(.4,1.4,.6,1);transform-style:preserve-3d;}',
			'.dsh-vs-fcard.flipped .inner{transform:rotateY(180deg);}',
			'.dsh-vs-fcard .face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:12px;border:1px solid #2a2e3d;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;}',
			'.dsh-vs-fcard .back{background:linear-gradient(135deg,#2a2f4a,#191d2c);font-size:30px;}',
			'.dsh-vs-fcard .front{transform:rotateY(180deg);background:#161926;padding:8px;}',
			'.dsh-vs-fcard .fv{font-size:30px;}',
			'.dsh-vs-fcard .fn{font-size:12px;font-weight:700;color:#e6e8f0;text-align:center;line-height:1.4;}',
			'.dsh-vs-fcard .fd{font-size:10px;color:#8a8fa3;text-align:center;line-height:1.4;}',
			'.dsh-vs-fcard.dim{opacity:.5;cursor:default;}',
			'.dsh-vs-fcard:hover .back{border-color:#7c5cfc;}',
			'.dsh-vs-lvcard.locked{opacity:.45;cursor:default;}',
			'.dsh-vs-lvcard.locked:hover{transform:none;border-color:#2a2e3d;}',
			'.dsh-vs-lvcard .badge.lock{background:rgba(138,143,163,.12);color:#8a8fa3;border-color:#2a2e3d;}',
			// P3 Boss 血条
			'.dsh-vs-bossbar{position:absolute;left:50%;transform:translateX(-50%);bottom:52px;width:430px;pointer-events:none;text-align:center;}',
			'.dsh-vs-bossbar .nm{font-size:12px;color:#ff8a80;margin-bottom:3px;letter-spacing:1px;text-shadow:0 1px 3px #000;}',
			'.dsh-vs-bossbar .bar{height:9px;background:#1c1f2b;border:1px solid #2a2e3d;border-radius:5px;overflow:hidden;}',
			'.dsh-vs-bossbar .bar>i{display:block;height:100%;background:linear-gradient(90deg,#ff5f56,#ff9800);}',
			// 设置弹窗
			'.dsh-vs-pop{position:absolute;top:42px;right:10px;z-index:10;width:230px;background:#161926;border:1px solid #2a2e3d;',
			'  border-radius:10px;padding:12px;pointer-events:auto;display:flex;flex-direction:column;gap:10px;font-size:12px;}',
			'.dsh-vs-pop label{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#cfd3e4;}',
			'.dsh-vs-pop select,.dsh-vs-pop input[type=number]{background:#0e1017;color:#e6e8f0;border:1px solid #2a2e3d;border-radius:6px;padding:3px 6px;}',
			// 选关面板
			'.dsh-vs-levels{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;max-width:640px;}',
			'.dsh-vs-lvcard{width:230px;background:#161926;border:1px solid #2a2e3d;border-radius:12px;padding:14px;',
			'  cursor:pointer;text-align:left;transition:transform .1s ease,border-color .1s ease;position:relative;}',
			'.dsh-vs-lvcard:hover{transform:translateY(-3px);border-color:#4f6ef7;}',
			'.dsh-vs-lvcard .ch{color:#9d6bff;font-size:11px;font-weight:700;letter-spacing:1px;}',
			'.dsh-vs-lvcard .nm{color:#e6e8f0;font-size:16px;font-weight:700;margin-top:4px;}',
			'.dsh-vs-lvcard .tg{color:#8a8fa3;font-size:11px;margin-top:6px;line-height:1.5;min-height:2.9em;}',
			'.dsh-vs-lvcard .sz{color:#4d5164;font-size:10px;margin-top:8px;}',
			'.dsh-vs-lvcard .badge{position:absolute;top:10px;right:10px;font-size:10px;padding:2px 8px;border-radius:8px;',
			'  background:rgba(61,220,132,.15);color:#3ddc84;border:1px solid rgba(61,220,132,.4);}',
			// 图鉴弹窗
			'.dsh-vs-pedia{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:rgba(8,10,16,.72);padding:24px;pointer-events:auto;}',
			'.dsh-vs-pedia-box{width:min(680px,calc(100% - 20px));max-height:calc(100% - 40px);background:#161926;border:1px solid #2a2e3d;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;}',
			'.dsh-vs-pedia-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #2a2e3d;}',
			'.dsh-vs-pedia-tabs{display:flex;gap:6px;padding:10px 16px 0;}',
			'.dsh-vs-pedia-tab{padding:6px 14px;border-radius:8px 8px 0 0;background:#1c1f2b;border:1px solid #2a2e3d;color:#aab0c4;cursor:pointer;font-size:13px;}',
			'.dsh-vs-pedia-tab.on{background:#4f6ef7;border-color:#4f6ef7;color:#fff;}',
			'.dsh-vs-pedia-body{flex:1;overflow-y:auto;padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;align-content:start;}',
			'.dsh-vs-pedia-card{background:#0e1017;border:1px solid #2a2e3d;border-radius:10px;padding:10px 12px;}',
			'.dsh-vs-pedia-card.locked{opacity:.55;filter:grayscale(.6);}',
			'.dsh-vs-pedia-card .ph{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;}',
			'.dsh-vs-pedia-card .pd{color:#8a8fa3;font-size:11px;margin-top:6px;line-height:1.5;white-space:pre-line;}',
			'.dsh-vs-pedia-card .pl{color:#9d6bff;font-size:11px;margin-top:6px;line-height:1.5;white-space:pre-line;}',
			'.dsh-vs-pedia-card .pe{color:#40c4ff;font-size:11px;margin-top:6px;line-height:1.5;white-space:pre-line;}',
			'.dsh-vs-pedia-close{background:none;border:none;color:#8a8fa3;font-size:18px;cursor:pointer;padding:4px 8px;border-radius:6px;}',
			'.dsh-vs-pedia-close:hover{color:#fff;background:#2a2e3d;}',
			// 角色界面
			'.dsh-vs-head-left{display:flex;align-items:center;gap:6px;}',
			'.dsh-vs-char{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:rgba(8,10,16,.76);padding:24px;pointer-events:auto;}',
			'.dsh-vs-char-box{width:min(760px,calc(100% - 20px));max-height:calc(100% - 40px);background:#161926;border:1px solid #2a2e3d;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;}',
			'.dsh-vs-char-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #2a2e3d;}',
			'.dsh-vs-char-body{flex:1;overflow-y:auto;display:flex;gap:14px;padding:14px 16px;}',
			'.dsh-vs-char-left{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;}',
			'.dsh-vs-char-right{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;}',
			'.dsh-vs-char-gold{color:#ffd54f;font-weight:700;font-size:15px;}',
			'.dsh-vs-char-section-title{color:#8a8fa3;font-size:12px;font-weight:700;margin-top:4px;letter-spacing:.5px;}',
			'.dsh-vs-weapon-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;}',
			'.dsh-vs-weapon-opt{background:#0e1017;border:1px solid #2a2e3d;color:#cfd3e4;border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer;text-align:left;}',
			'.dsh-vs-weapon-opt.on{border-color:#7c5cfc;background:#221a3a;color:#fff;}',
			'.dsh-vs-weapon-opt:hover{border-color:#7c5cfc;}',
			'.dsh-vs-slots{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}',
			'.dsh-vs-slot{background:#0e1017;border:1px dashed #2a2e3d;border-radius:8px;padding:10px 6px;text-align:center;color:#5a6072;font-size:11px;min-height:48px;display:flex;align-items:center;justify-content:center;}',
			'.dsh-vs-slot.active{min-height:56px;border-color:#7c5cfc;color:#9d6bff;}',
			'.dsh-vs-inv{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;align-content:start;overflow-y:auto;max-height:100%;}',
			'.dsh-vs-item{position:relative;background:#0e1017;border:1px solid #2a2e3d;border-radius:8px;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 14px rgba(0,0,0,.4);}',
			'.dsh-vs-item.empty{background:#0a0c12;border-color:#1d2130;border-style:dashed;}',
			'.dsh-vs-item.use{cursor:pointer;border-color:#7c5cfc;box-shadow:0 0 10px rgba(124,92,252,.25);}',
			'.dsh-vs-item.use:hover{background:#171a26;border-color:#ffd54f;transform:translateY(-1px);}',
			'.dsh-vs-item-icon{font-size:28px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));}',
			'.dsh-vs-item-img{width:44px;height:44px;image-rendering:pixelated;object-fit:contain;}',
			'.dsh-vs-item-name{position:absolute;left:3px;right:3px;bottom:3px;font-size:9px;font-weight:700;color:#e6e9f2;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
			'.dsh-vs-item-action{position:absolute;top:3px;right:3px;font-size:8px;color:#ffd54f;background:rgba(0,0,0,.6);border-radius:4px;padding:1px 3px;margin:0;}',
			'.dsh-vs-item.selected{border-color:#ffd54f;background:#171a26;box-shadow:0 0 10px rgba(255,213,79,.25);}',
			'.dsh-vs-item-count{position:absolute;top:1px;right:5px;font-size:11px;font-weight:700;color:#ffd54f;text-shadow:0 1px 3px #000,0 0 6px #000;}',
			'.dsh-vs-item-use-btn{position:absolute;right:2px;bottom:2px;z-index:1;background:#4f6ef7;border:none;color:#fff;border-radius:5px;padding:2px 5px;font-size:9px;cursor:pointer;white-space:nowrap;}',
			'.dsh-vs-item-use-btn:hover{filter:brightness(1.15);}',
			'.dsh-vs-mini-btn{background:#4f6ef7;border:none;color:#fff;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;white-space:nowrap;}',
			'.dsh-vs-mini-btn:disabled{background:#2a2e3d;color:#5a6072;cursor:not-allowed;}',
			'.dsh-vs-passives{display:flex;flex-direction:column;gap:6px;}',
			'.dsh-vs-upgrade-row{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#0e1017;border:1px solid #2a2e3d;border-radius:8px;padding:6px 8px;font-size:11px;}',
			'.dsh-vs-upgrade-name{color:#cfd3e4;}',
			'.dsh-vs-upgrade-cost{color:#ffd54f;}',
			'.dsh-vs-empty{color:#5a6072;font-size:12px;padding:12px;text-align:center;border:1px dashed #2a2e3d;border-radius:8px;}',
			'.dsh-vs-char-portrait{width:120px;height:120px;border-radius:12px;background:#0e1017;border:1px solid #2a2e3d;object-fit:cover;}',
			'.dsh-vs-char-avatar{width:120px;height:120px;border-radius:12px;background:#0e1017;border:1px solid #2a2e3d;display:flex;align-items:center;justify-content:center;font-size:52px;}',
			'.dsh-vs-char-tabs{display:flex;gap:6px;margin-bottom:8px;}',
			'.dsh-vs-char-tab{flex:1;padding:7px 10px;border-radius:8px;background:#1c1f2b;border:1px solid #2a2e3d;color:#aab0c4;cursor:pointer;font-size:12px;text-align:center;}',
			'.dsh-vs-char-tab.on{background:#4f6ef7;border-color:#4f6ef7;color:#fff;}',
			'.dsh-vs-char-panel{display:flex;flex-direction:column;gap:10px;}',
			'.dsh-vs-char-topline{display:flex;align-items:center;justify-content:space-between;gap:12px;}',
			'.dsh-vs-char-acc-title{flex:0 0 84px;text-align:center;margin-right:36px;}',
			'.dsh-vs-char-portrait-row{display:flex;gap:12px;align-items:flex-start;}',
			'.dsh-vs-char-portrait-canvas{width:220px;height:220px;margin-top:8px;background:#0e1017;border:1px solid #2a2e3d;border-radius:14px;}',
			'.dsh-vs-char-acc-col{display:flex;flex-direction:column;gap:4px;}',
			'.dsh-vs-char-acc-slot{width:84px;height:52px;background:#0e1017;border:1px dashed #2a2e3d;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#5a6072;font-size:11px;}',
			'.dsh-vs-char-acc-slot.filled{flex-direction:column;gap:1px;}',
			'.dsh-vs-char-acc-slot img{width:18px;height:18px;image-rendering:pixelated;object-fit:contain;}',
			'.dsh-vs-acc-label{font-size:9px;color:#aab0c4;max-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;}',
			'.dsh-vs-char-cards{display:flex;flex-direction:column;gap:8px;}',
			'.dsh-vs-char-card{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#0e1017;border:1px solid #2a2e3d;border-radius:10px;padding:10px 12px;}',
			'.dsh-vs-char-card-main{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;}',
			'.dsh-vs-char-card-sub{color:#8a8fa3;font-size:11px;margin-top:2px;}',
			'.dsh-vs-weapon-picker{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px;}',
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
			whip:  { icon: '🪢', name: '代码鞭',   desc: '环形鞭波扫荡周围', lvDesc: ['强化', '强化', '强化', '强化'] },
			bolt:  { icon: '🔷', name: 'Token弹',  desc: '扇形散射射击',     lvDesc: ['强化', '强化', '强化', '强化'] },
			orb:   { icon: '🌀', name: '语法环绕', desc: '绕身旋转的能量球', lvDesc: ['强化', '强化', '强化', '强化'] },
			laser: { icon: '✚', name: '编译激光', desc: '持续穿透光束',     lvDesc: ['强化', '强化', '强化', '强化'] },
			mine:  { icon: '💣', name: '注释地雷', desc: '自动感应地雷',     lvDesc: ['强化', '强化', '强化', '强化'] },
			zap:   { icon: '⚡', name: 'Debug雷击', desc: '多目标连锁闪电', lvDesc: ['强化', '强化', '强化', '强化'] },
		};
		const PASSIVES = {
			armor:  { icon: '🛡', name: '护甲', desc: '受伤 -1 / 级' },
			regen:  { icon: '💗', name: '回血', desc: '每秒 +0.6 HP / 级' },
			speed:  { icon: '👟', name: '加速', desc: '移速 +8% / 级' },
			might:  { icon: '💪', name: '力量', desc: '全伤害 +12% / 级' },
			haste:  { icon: '⏱', name: '冷却', desc: '武器冷却 -7% / 级' },
			magnet: { icon: '🧲', name: '磁铁', desc: '拾取范围 +40 / 级，满级全屏吸取' },
		};
		/** 主动技能表 */
		const ACTIVE_SKILLS = {
			strike: {
				id: 'strike',
				icon: '✂️',
				name: '划除',
				desc: '5s 无敌，期间点击屏幕快速移动（最多 6 次），路径留下 5s 划除线灼烧敌人',
				cd: 30,
				duration: 5,
				maxTeleports: 6,
				lineDuration: 5,
				dps: 8,
			},
		};
		/** 背包物品表（图标先用 emoji 占位，后续可替换为开放素材） */
		const MV_ICON_BASE = '/vs-game/assets/items/mv/';
		const MV_ITEM_NAMES = {
			'chest-gold': '金宝箱', 'chest-blue': '蓝宝箱', 'acc-ring': '戒指盒', 'acc-boots': '疾风靴',
			'acc-shield': '龟甲盾', 'acc-grail': '圣杯', 'acc-lute': '深海鲁特琴', 'acc-flute': '潮汐长笛',
			'acc-horn': '挑战号角', 'acc-unicorn-horn': '独角兽之角', 'acc-conch': '传讯海螺', 'acc-uni-head': '独角兽头饰',
			'acc-medal-red': '赤勋章', 'acc-medal-blue': '蓝勋章', 'acc-medal-green': '绿勋章',
			'mat-bundle': '钱袋', 'mat-coinpile': '钱币串', 'mat-scroll': '藏宝图', 'tool-pick': '矿镐',
			'mat-ingot-silver': '银条', 'mat-ingot-aqua': '水蓝晶条', 'mat-ingot-blue': '苍蓝晶条',
			'mat-ingot-purple': '紫晶条', 'mat-ingot-rose': '玫晶条', 'mat-ingot-green': '翠晶条',
		};
		const MV_ACC_POOL = Object.keys(MV_ITEM_NAMES).filter((k) => k.startsWith('acc-'));
		const MV_MAT_POOL = Object.keys(MV_ITEM_NAMES).filter((k) => k.startsWith('mat-ingot'));
		const mvImgCache = new Map();
		function itemImg(key) {
			let img = mvImgCache.get(key);
			if (!img) { img = new Image(); img.src = MV_ICON_BASE + key + '.png'; mvImgCache.set(key, img); }
			return img;
		}

		const ITEM_META = {
			'newbie-gift': { icon: '🎁', iconUrl: '/vs-game/assets/items/newbie_gift.png', name: '新手礼包', desc: '内含 1000 金币' },
			'skill-book': { icon: '📖', iconUrl: '/vs-game/assets/items/skill_book.png', name: '技能书·划除', desc: '使用后学会主动技能「划除」' },
		};
		function itemMeta(item) {
			if (ITEM_META[item]) return ITEM_META[item];
			if (MV_ITEM_NAMES[item]) {
				const isAcc = item.startsWith('acc-');
				return {
					icon: isAcc ? '💍' : '🧱',
					iconUrl: MV_ICON_BASE + item + '.png',
					name: MV_ITEM_NAMES[item],
					desc: isAcc ? '饰品 · 穿戴系统开发中' : '锻造材料（打造高级饰品）',
				};
			}
			return { icon: '📦', name: item, desc: '待开发' };
		}
		/** 超武进化线：武器满级 + 指定被动 → 进化 */
		const EVOLUTIONS = {
			whip:  { passive: 'might',  name: '鲸尾横扫',   icon: '🐋', desc: '进化' },
			bolt:  { passive: 'haste',  name: '流式输出',   icon: '🌊', desc: '进化' },
			orb:   { passive: 'magnet', name: '上下文窗口', icon: '🪟', desc: '进化' },
			laser: { passive: 'armor',  name: '全量类型检查', icon: '🔍', desc: '进化' },
			mine:  { passive: 'regen',  name: '垃圾回收',   icon: '♻️', desc: '进化' },
			zap:   { passive: 'speed',  name: '热重载',     icon: '🔥', desc: '进化' },
		};
		/** 敌人图鉴中文名 */
		const ENEMY_NAMES = {
			misc: '杂鱼文件', docs: '文档碎片', config: '配置怪', js: 'JavaScript 怪',
			shell: '脚本怪', py: 'Python 怪', search: '搜索碎片', html: '前端怪',
			ts: 'TypeScript 怪', go: 'Go 怪', rs: 'Rust 怪', bin: '二进制巨怪', term: '终端怪',
		};
		/** 武器图鉴详细数据（用于主菜单图鉴，升级弹窗仍只显示“强化”） */
		const WEAPON_DETAILS = {
			whip: {
				levels: [
					'1 圈环形鞭波',
					'2 圈环形鞭波',
					'3 圈鞭波，范围扩大',
					'3 圈鞭波，伤害提升并击退',
				],
				evolve: '四道 160 半径巨环 + 击退',
			},
			bolt: {
				levels: [
					'3 发扇形 Token 弹',
					'5 发扇形 Token 弹',
					'7 发扇形 Token 弹，穿透 1',
					'7 发扇形 Token 弹，伤害提升',
				],
				evolve: '机关枪连射：0.15s 间隔持续 2s 高速弹',
			},
			orb: {
				levels: [
					'3 颗能量球环绕',
					'4 颗能量球',
					'5 颗能量球，范围/转速/伤害提升',
					'5 颗能量球，伤害再次提升',
				],
				evolve: '6 球大半径，伤害翻倍并吸附附近宝石',
			},
			laser: {
				levels: [
					'4 道常驻穿透光束',
					'8 道常驻穿透光束',
					'光束伤害提升',
					'光束更粗，伤害提升',
				],
				evolve: '12 道旋转激光网，常驻持续灼烧',
			},
			mine: {
				levels: [
					'最多 3 颗自动感应地雷',
					'最多 4 颗',
					'爆炸范围与伤害提升',
					'爆炸附带减速',
				],
				evolve: '最多 6 颗，伤害翻倍，爆炸全减速',
			},
			zap: {
				levels: [
					'2 道闪电攻击目标',
					'3 道闪电，命中眩晕',
					'4 道闪电 + 连锁伤害',
					'闪电范围与伤害提升',
				],
				evolve: '4 道连锁闪电，冷却减半',
			},
		};
		/** 怪物图鉴详细介绍（遇到解锁） */
		const ENEMY_DETAILS = {
			misc: '不知道是什么的小文件，低价值低威胁，用来热身的杂兵。',
			docs: '文档写一半就提交的碎片，移动慢，适合前期刷经验。',
			config: '改一个配置引发连锁反应的家伙，掉落的经验比普通文档略多。',
			js: '动态类型の自由，速度快但血量不高，是中期最常见的杂鱼。',
			shell: '一条命令跑天下的脚本怪，行动敏捷，小心被它绕后。',
			py: '缩进错误就会暴走的 Python 怪，血厚一些，经验也更多。',
			search: '全局搜索的碎片，跑得飞快但一碰就碎，专门骚扰你。',
			html: '标签没闭合的前端怪，血量和经验都比较可观。',
			ts: '类型注解叠满的 TypeScript 怪，皮糙肉厚，是中后期主力敌人。',
			go: '并发跑起来的 Go 怪，速度快血也厚，需要持续输出处理。',
			rs: '所有权系统护体的 Rust 怪，非常耐打，是后期的重型单位。',
			bin: '编译后的二进制巨怪，高血量高经验，精英级威胁。',
			term: '占用终端不释放的顽固进程，血厚攻高，最终防线般的存在。',
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

				this.phase = 'menu'; // menu | playing | levelup | paused | gameover | clear
				this.keys = new Set();
				this.focused = false;
				this.autoPause = true;
				this.initialWeapon = 'whip'; // 默认初始武器；HELLO/CHARACTER 到达后覆盖
				this.initialPassives = { armor: 0, regen: 0, speed: 0, might: 0, haste: 0, magnet: 0 }; // 初始被动等级
				this.activeSkillId = null; // 主动技能通过技能书获得；HELLO/CHARACTER 到达后覆盖

				this.best = null;
				this.reset();
				this.knownFromServer = new Set(); // 服务端持久化图鉴（跨局累积）
				this.attachInput();
			}

			reset() {
				this.phase = 'menu';
				// 世界/相机（P0 相机化）：无尽模式 world==view，cam 恒 0，行为与旧版逐帧一致
				// defaultWorld 由 setWorld（关卡载入）设置，reset/restart 沿用当前关卡尺寸
				this.world = { ...(this.defaultWorld ?? { w: GAME_W, h: GAME_H }) };
				this.cam = { x: 0, y: 0 };
				// 关卡布局（P2）：左侧出生 + 营地预铺 + 沿路宝箱
				const lv = this.level;
				this.chests = lv && Array.isArray(lv.chests)
					? lv.chests.map((c, i) => ({ id: i, x: c.xf * this.world.w, y: c.yf * this.world.h, tier: c.tier ?? 'blue', guard: !!c.chestGuard, opened: false }))
					: [];
				this.chestNear = null;
				this.chestProgress = 0;
				this.elapsed = 0;
				this.kills = 0;
				this.player = {
					x: lv?.spawn ? lv.spawn.xf * this.world.w : this.world.w / 2,
					y: lv?.spawn ? lv.spawn.yf * this.world.h : this.world.h / 2,
					hp: 100, maxHp: 100, speed: 160,
					level: 1, xp: 0, xpNeed: xpNext(1),
					invuln: 0, celebrate: 0, facing: 1, moving: false,
					weapons: [{ type: this.initialWeapon || 'whip', level: 1 }],
					passives: { ...this.initialPassives },
				};
				this.enemies = [];
				this.gems = [];
				this.projectiles = [];
				this.mines = [];
				this.beams = [];
				this.laserCfg = null; // 常驻激光配置（避免每次 tick 重建）
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
				this.pendingChoices = null; // 玩家选择“稍后选择”时暂存的三选一
				// 主动技能（划除）
				this.skillCd = 0;
				this.skillTimer = 0;
				this.teleportsLeft = 0;
				this.strikeLines = [];
				this.dash = null;
				// 注意：best / knownFromServer 是跨局元数据，reset 不清（否则菜单丢最高分/图鉴）
				// ── M3 工作联动状态 ──
				this.lastFuelElapsed = -100;  // 上次收到工作燃料的局内时刻
				this.shieldTimer = 0;
				this.freezeTimer = 0;
				this.chaosTimer = 0;
				this.banner = null;           // { text, life }
				this.discovered = new Set();  // 本局遇到的敌人（图鉴）
				this.deathTimer = 0;          // 死亡慢动作倒计时
				this.cfg = { autoPause: true, difficulty: 'normal', idleSpawnRate: 3 };
				// P3 关底 Boss / 翻卡
				this.bossSpawned = false;
				this.bossRef = null;
				this.bossKilled = false;
				this.cards = null;
				this._settleSent = false;
			}

			applyConfig(c) {
				if (!c || typeof c !== 'object') return;
				this.cfg = {
					autoPause: c.autoPause !== false,
					difficulty: ['easy', 'normal', 'hard'].includes(c.difficulty) ? c.difficulty : 'normal',
					idleSpawnRate: Number.isFinite(c.idleSpawnRate) ? Math.min(60, Math.max(1, c.idleSpawnRate)) : 3,
				};
				this.autoPause = this.cfg.autoPause;
			}

			diffMul() {
				return this.cfg.difficulty === 'easy' ? 0.8 : this.cfg.difficulty === 'hard' ? 1.35 : 1;
			}

			/** 设置世界尺寸（关卡载入用；world==view 时即旧版单屏）。对 restart 也生效 */
			setWorld(w, h) {
				this.defaultWorld = { w: Math.max(GAME_W, w), h: Math.max(GAME_H, h) };
				this.world = { ...this.defaultWorld };
				this.updateCamera();
			}

			/** 载入关卡（P1）：world/theme 生效；chests/boss/spawnPool 由 P2-P4 消费。传 null = 无尽 */
			loadLevel(cfg) {
				this.level = cfg ?? null;
				if (cfg?.world) {
					this.setWorld(cfg.world.w, cfg.world.h);
				} else {
					this.defaultWorld = { w: GAME_W, h: GAME_H };
					this.world = { ...this.defaultWorld };
				}
				this.theme = cfg?.theme ?? { bg: '#0b0d13', grid: 'rgba(79,110,247,0.05)' };
			}

			/** 关卡开局：按 reset 生成的宝箱表铺营地怪与守箱精英（无尽模式无操作） */
			seedLevel() {
				const lv = this.level;
				if (!lv) return;
				const W = this.world.w, H = this.world.h;
				for (const c of (lv.camps ?? [])) {
					const cx = c.xf * W, cy = c.yf * H;
					for (let i = 0; i < (c.count ?? 1); i++) {
						this.spawnEnemyAt(c.type ?? 'misc', cx + rand(-46, 46), cy + rand(-46, 46), !!c.elite);
					}
				}
				for (const ch of this.chests) {
					if (ch.guard) this.spawnEnemyAt('rs', ch.x + 52, ch.y, true);
				}
			}

			/** 在指定世界坐标落一只敌怪（营地预铺用，不参与待机刷怪节流） */
			spawnEnemyAt(type, x, y, elite) {
				if (this.enemies.length >= 300) return;
				const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.misc;
				const hpScale = (1 + this.elapsed / 90) * this.diffMul();
				this.discovered.add(type);
				this.enemies.push({
					id: nextId++, type,
					x, y,
					hp: base.hp * hpScale * (elite ? 3 : 1),
					maxHp: base.hp * hpScale * (elite ? 3 : 1),
					speed: base.speed, size: base.size * (elite ? 1.5 : 1),
					color: base.color, label: base.label,
					xp: base.xp * (elite ? 3 : 1),
					elite: !!elite, hitFlash: 0, slow: 0, aggro: false,
					wanderA: rand(0, Math.PI * 2), wanderT: rand(0.8, 2.2),
				});
			}

			/** 相机跟随玩家：dt 为空立即吸附，否则按 dt 平滑 */
			updateCamera(dt) {
				const maxX = Math.max(0, this.world.w - GAME_W);
				const maxY = Math.max(0, this.world.h - GAME_H);
				const tx = Math.max(0, Math.min(maxX, this.player.x - GAME_W / 2));
				const ty = Math.max(0, Math.min(maxY, this.player.y - GAME_H / 2));
				if (dt == null) { this.cam.x = tx; this.cam.y = ty; return; }
				const k = Math.min(1, dt * 10);
				this.cam.x += (tx - this.cam.x) * k;
				this.cam.y += (ty - this.cam.y) * k;
			}

			// ── 输入：只挂 canvas，焦点不在 canvas 时绝不干扰 DSH 输入框 ──
			attachInput() {
				const c = this.canvas;
				c.tabIndex = 0;
				this._onKeyDown = (e) => {
					const k = e.key.toLowerCase();
					if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', '1', '2', '3', 'e', 'f', 'p', 'escape'].includes(k)) {
						e.preventDefault();
						e.stopPropagation();
					}
					if (k === 'escape') { c.blur(); return; }
					if (k === 'p' && this.phase === 'playing') { this.pause(); return; }
					if (k === 'e' && this.phase === 'playing') { this.activateActiveSkill(); return; }
					if (this.phase === 'levelup' && ['1', '2', '3'].includes(k)) { this.applyChoice(Number(k) - 1); return; }
					this.keys.add(k);
				};
				this._onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
				this._onFocus = () => { this.focused = true; };
				// 画布失焦（用户去打字/看回复）只停移动，不暂停——与 DSH 交互时游戏照跑
				this._onBlur = () => {
					this.focused = false;
					this.keys.clear();
				};
				// 自动暂停锚定 DSH 窗口本身：切去别的程序/最小化才暂停
				this._onWinBlur = () => {
					if (this.autoPause && this.phase === 'playing') this.pause();
				};
				this._onVisibility = () => {
					if (document.hidden && this.autoPause && this.phase === 'playing') this.pause();
				};
				c.addEventListener('keydown', this._onKeyDown);
				c.addEventListener('keyup', this._onKeyUp);
				c.addEventListener('focus', this._onFocus);
				c.addEventListener('blur', this._onBlur);
				this._onPointerDown = (e) => {
					if (this.skillTimer <= 0 || this.phase !== 'playing') return;
					const rect = c.getBoundingClientRect();
					// 屏幕坐标 → 世界坐标：大地图必须加相机偏移（无尽 cam=0 无影响）
					this.tryDash(e.clientX - rect.left + this.cam.x, e.clientY - rect.top + this.cam.y);
				};
				c.addEventListener('pointerdown', this._onPointerDown);
				window.addEventListener('blur', this._onWinBlur);
				document.addEventListener('visibilitychange', this._onVisibility);
			}

			destroy() {
				const c = this.canvas;
				c.removeEventListener('keydown', this._onKeyDown);
				c.removeEventListener('keyup', this._onKeyUp);
				c.removeEventListener('focus', this._onFocus);
				c.removeEventListener('blur', this._onBlur);
				if (this._onPointerDown) c.removeEventListener('pointerdown', this._onPointerDown);
				window.removeEventListener('blur', this._onWinBlur);
				document.removeEventListener('visibilitychange', this._onVisibility);
			}

			focusCanvas() { this.canvas.focus(); }

			// ── 阶段切换 ──
			start() {
				this.reset();
				this.seedLevel();          // 营地预铺 + 守箱精英（无尽模式空操作）
				this.updateCamera();       // 开局吸附，避免大地图首帧黑边
				this.phase = 'playing';
				this.sendWs({ kind: ClientMsg.GAME_START });
				this.focusCanvas();
			}
			pause() { if (this.phase === 'playing') this.phase = 'paused'; }
			resume() { if (this.phase === 'paused') { this.phase = 'playing'; this.focusCanvas(); } }

			/** 升级三选一：先不打断战斗，稍后从右侧入口打开 */
			deferChoice() {
				if (this.phase !== 'levelup' || !this.choices) return;
				this.pendingChoices = this.choices;
				this.choices = null;
				this.phase = 'playing';
				this.focusCanvas();
			}

			/** 打开暂存的升级三选一 */
			openPendingChoice() {
				if (!this.pendingChoices) return;
				if (this.phase !== 'playing' && this.phase !== 'paused') return;
				this.choices = this.pendingChoices;
				this.phase = 'levelup';
			}

			// ── 主动技能：划除 ──
			activateActiveSkill() {
				if (this.phase !== 'playing' || this.skillTimer > 0) return;
				const sk = ACTIVE_SKILLS[this.activeSkillId];
				if (!sk || this.skillCd > 0) return;
				this.skillCd = sk.cd;
				this.skillTimer = sk.duration;
				this.teleportsLeft = sk.maxTeleports;
				this.setBanner('✂️ ' + sk.name + '！点击屏幕快速移动，最多 ' + sk.maxTeleports + ' 次');
			}

			tryDash(tx, ty) {
				const sk = ACTIVE_SKILLS[this.activeSkillId];
				if (!sk || this.skillTimer <= 0 || this.teleportsLeft <= 0) return;
				tx = Math.max(14, Math.min(this.world.w - 14, tx));
				ty = Math.max(14, Math.min(this.world.h - 14, ty));
				const x1 = this.player.x, y1 = this.player.y;
				// 快速移动，而不是瞬间瞬移：0.16s 内从当前点滑到目标点
				this.dash = { x1, y1, x2: tx, y2: ty, t: 0, dur: 0.16 };
				this.strikeLines.push({
					x1, y1, x2: tx, y2: ty,
					life: sk.lineDuration,
					maxLife: sk.lineDuration,
					dps: sk.dps * this.dmgMul(),
				});
				this.teleportsLeft--;
				this.burst(x1, y1, '#ff6b9d', 5);
				this.burst(tx, ty, '#ffd54f', 8);
			}

			updateStrikeLines(dt) {
				const sk = ACTIVE_SKILLS[this.activeSkillId];
				if (!sk || this.strikeLines.length === 0) return;
				for (const ln of this.strikeLines) {
					if (!ln.hitCd) ln.hitCd = new Map();
					for (const e of [...this.enemies]) {
						const d = this.distToSegment(e.x, e.y, ln.x1, ln.y1, ln.x2, ln.y2);
						if (d > e.size * 0.55 + 4) continue;
						// 每 0.3s 跳一次伤害数字，保持“持续帧伤”的压迫感
						const nextHit = ln.hitCd.get(e.id) ?? 0;
						if (nextHit > this.elapsed) continue;
						ln.hitCd.set(e.id, this.elapsed + 0.3);
						const tickDmg = Math.max(1, Math.round(ln.dps * 0.3));
						e.hp -= tickDmg;
						e.hitFlash = 0.1;
						if (this.dmgNums.length < 40) {
							this.dmgNums.push({
								x: e.x + rand(-4, 4),
								y: e.y - e.size * 0.5,
								text: '-' + tickDmg,
								color: '#ff8ac2',
								life: 0.6,
							});
						}
						if (e.hp <= 0) this.killEnemy(e);
					}
				}
			}

			distToSegment(px, py, x1, y1, x2, y2) {
				const dx = x2 - x1, dy = y2 - y1;
				const lenSq = dx * dx + dy * dy;
				if (lenSq === 0) return Math.hypot(px - x1, py - y1);
				let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
				t = Math.max(0, Math.min(1, t));
				return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
			}

			/** 是否处于"工作中"（近 10s 收到过真实工作燃料）→ 大额减伤 */
			isWorkActive() { return this.elapsed - this.lastFuelElapsed < 10; }

			applyCharacter(c) {
				if (!c || typeof c !== 'object') return;
				if (typeof c.initialWeapon === 'string' && WEAPONS[c.initialWeapon]) this.initialWeapon = c.initialWeapon;
				this.activeSkillId = (typeof c.activeSkill === 'string' && ACTIVE_SKILLS[c.activeSkill]) ? c.activeSkill : null;
				if (c.passives && typeof c.passives === 'object') {
					this.initialPassives = {
						armor: Number(c.passives.armor) || 0,
						regen: Number(c.passives.regen) || 0,
						speed: Number(c.passives.speed) || 0,
						might: Number(c.passives.might) || 0,
						haste: Number(c.passives.haste) || 0,
						magnet: Number(c.passives.magnet) || 0,
					};
				}
			}

			// ── host 消息：配置/持久化数据 + 工作燃料 ──
			handleHostMsg(msg) {
				if (msg.kind === HostMsg.CARDS) {
					this.cards = {
						cards: Array.isArray(msg.cards) ? msg.cards.slice(0, 3) : [],
						freeFlips: msg.freeFlips ?? 1,
						extraCost: msg.extraCost ?? 300,
						firstClear: !!msg.firstClear,
						firstClearGold: msg.firstClearGold ?? 0,
						picked: [], extraUsed: false,
					};
					this.phase = 'clear';
					return;
				}
				if (msg.kind === HostMsg.CARD_RESULT) {
					if (this.cards) {
						if (msg.extraGranted) this.cards.extraUsed = true;
						else if (Number.isInteger(msg.index) && !this.cards.picked.includes(msg.index)) this.cards.picked.push(msg.index);
					}
					return;
				}
				if (msg.kind === HostMsg.SAVED) {
					this.best = msg.bestScore ?? null;
					for (const t of msg.discovered ?? []) this.knownFromServer.add(t);
					this.applyCharacter(msg.character);
					this.onSaved(msg);
					return;
				}
				if (msg.kind === HostMsg.CHARACTER) {
					this.applyCharacter(msg.character);
					return;
				}
				if (msg.kind === HostMsg.CONFIG) { this.applyConfig(msg.config); return; }
				if (msg.kind === HostMsg.HELLO) {
					this.applyConfig(msg.config);
					if (msg.best != null) this.best = msg.best;
					for (const t of msg.discovered ?? []) this.knownFromServer.add(t);
					this.applyCharacter(msg.character);
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
				this.discovered.add(type);
				this.enemies.push({
					id: nextId++, type,
					x: pos.x, y: pos.y,
					hp, maxHp: hp,
					speed: base.speed * 0.6, size: base.size * 3,
					color: base.color, label: base.label,
					xp: base.xp * 8,
					elite: true, boss: true, hitFlash: 0, slow: 0, aggro: false,
				});
				this.setBanner('👾 BOSS：巨型 ' + base.label + ' 文件怪！');
				this.shake = Math.max(this.shake, 0.5);
			}

			/** 精英瞄准弹 / Boss 环形报错弹幕 */
			fireErrorBullets(e) {
				if (this.enemyBullets.length > 60) return;
				const speed = 110 + Math.min(80, this.elapsed / 4);
				const mk = (vx, vy) => {
					const text = pick(ERROR_TEXTS);
					// 报错文本是“一整行”，命中判定也按整行矩形算
					this.enemyBullets.push({
						x: e.x, y: e.y, vx, vy, text, life: 7,
						w: Math.max(24, text.length * 7),
						h: 14,
					});
				};
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
			/** 视口外圈生成（cam=0 时与旧版单屏完全一致） */
			edgeSpawnPos() {
				const side = Math.floor(Math.random() * 4);
				const m = 30;
				const cx = this.cam.x, cy = this.cam.y;
				if (side === 0) return { x: rand(cx - m, cx + GAME_W + m), y: cy - m };
				if (side === 1) return { x: rand(cx - m, cx + GAME_W + m), y: cy + GAME_H + m };
				if (side === 2) return { x: cx - m, y: rand(cy - m, cy + GAME_H + m) };
				return { x: cx + GAME_W + m, y: rand(cy - m, cy + GAME_H + m) };
			}

			spawnEnemy(type, count, elite) {
				for (let i = 0; i < count; i++) {
					if (this.enemies.length >= 240) return;
					const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.misc;
					const pos = this.edgeSpawnPos();
					const hpScale = (1 + this.elapsed / 90) * this.diffMul();
					this.discovered.add(type);
					this.enemies.push({
						id: nextId++, type,
						x: pos.x + rand(-14, 14), y: pos.y + rand(-14, 14),
						hp: base.hp * hpScale * (elite ? 3 : 1),
						maxHp: base.hp * hpScale * (elite ? 3 : 1),
						speed: base.speed, size: base.size * (elite ? 1.5 : 1),
						color: base.color, label: base.label,
						xp: base.xp * (elite ? 3 : 1),
						elite: !!elite, hitFlash: 0, slow: 0, aggro: false,
						wanderA: rand(0, Math.PI * 2), wanderT: rand(0.8, 2.2),
					});
				}
			}

			idleSpawn(dt) {
				this.spawnTimer -= dt * (this.chaosTimer > 0 ? 2 : 1);
				if (this.spawnTimer > 0) return;
				const rateScale = this.cfg.idleSpawnRate / 3;
				const interval = Math.max(0.45, (2.2 - this.elapsed / 120) * rateScale);
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
						x: Math.max(8, Math.min(this.world.w - 8, this.player.x + Math.cos(a) * r)),
						y: Math.max(8, Math.min(this.world.h - 8, this.player.y + Math.sin(a) * r)),
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

			/** 关卡低频补给：营地是主内容，清完后的轻度压力维持 */
			levelTrickle(dt) {
				if (this.bossSpawned && !this.bossKilled) { this.spawnTimer = 4; return; }
				this.spawnTimer -= dt * (this.chaosTimer > 0 ? 2 : 1);
				if (this.spawnTimer > 0) return;
				this.spawnTimer = 8;
				if (this.enemies.length > 90) return;
				this.spawnEnemy(pick(['misc', 'docs', 'config', 'js']), 2, false);
			}

			// ── P2 宝箱：走近按 F 撬开（1.5s），奖励服务端直接入账 ──
			updateChests(dt) {
				if (!this.chests || this.chests.length === 0) { this.chestNear = null; this.chestProgress = 0; return; }
				const p = this.player;
				let near = null, nd = 1e9;
				for (const c of this.chests) {
					if (c.opened) continue;
					const d = Math.hypot(c.x - p.x, c.y - p.y);
					if (d < nd) { nd = d; near = c; }
				}
				this.chestNear = nd <= 70 ? near : null;
				if (this.chestNear && this.focused && this.keys.has('f')) {
					this.chestProgress += dt / 1.5;
					if (this.chestProgress >= 1) this.openChest(this.chestNear);
				} else {
					this.chestProgress = Math.max(0, this.chestProgress - dt * 0.8);
				}
			}

			openChest(ch) {
				ch.opened = true;
				this.chestProgress = 0;
				this.chestNear = null;
				this.burst(ch.x, ch.y, '#ffd54f', 16);
				const gold = ch.tier === 'gold' ? 200 + Math.floor(rand(0, 61)) : 60 + Math.floor(rand(0, 61));
				const item = ch.tier === 'gold' ? pick(MV_ACC_POOL) : (Math.random() < 0.6 ? pick(MV_MAT_POOL) : null);
				this.dmgNums.push({ x: ch.x, y: ch.y - 30, text: '+' + gold + ' 金币', color: '#ffd54f', life: 1.4 });
				this.setBanner('🎁 ' + gold + ' 金币' + (item ? ' 和「' + itemMeta(item).name + '」入包' : '入账！'));
				this.sendWs({ kind: ClientMsg.CHEST_LOOT, gold, item });
			}

			/** 关卡装饰：向右河道箭标 + 关底 Boss 圈预览 */
			drawLevelDecor(c) {
				const lv = this.level;
				if (!lv) return;
				c.save();
				c.fillStyle = lv.theme?.lane ?? 'rgba(79,110,247,0.08)';
				c.font = 'bold 34px system-ui,sans-serif';
				c.textAlign = 'center';
				c.textBaseline = 'middle';
				const step = 224;
				const gx0 = Math.floor(this.cam.x / step) * step;
				for (let x = gx0; x < this.cam.x + GAME_W + step; x += step) {
					if (x < this.world.w - 60) c.fillText('»', x, this.world.h / 2);
				}
				if (lv.bossZone) {
					const bx = lv.bossZone.xf * this.world.w, by = lv.bossZone.yf * this.world.h;
					c.strokeStyle = 'rgba(255,95,86,0.30)';
					c.lineWidth = 3;
					c.setLineDash([14, 10]);
					c.beginPath();
					c.arc(bx, by, lv.bossZone.r ?? 190, 0, Math.PI * 2);
					c.stroke();
					c.setLineDash([]);
					c.font = '30px serif';
					c.fillText('👑', bx, by);
				}
				c.restore();
			}

			drawChests(c, t) {
				if (!this.chests || this.chests.length === 0) return;
				for (const ch of this.chests) {
					const key = ch.tier === 'gold' ? 'chest-gold' : 'chest-blue';
					const img = itemImg(key);
					const bob = ch.opened ? 0 : Math.sin(t * 2.2 + ch.id * 1.7) * 3;
					c.save();
					if (ch.opened) c.globalAlpha = 0.16;
					if (img && img.complete && img.naturalWidth) {
						c.shadowColor = ch.tier === 'gold' ? 'rgba(255,213,79,.9)' : 'rgba(64,196,255,.7)';
						c.shadowBlur = ch.opened ? 0 : 14;
						c.imageSmoothingEnabled = false;
						c.drawImage(img, ch.x - 24, ch.y - 24 + bob, 48, 48);
					} else {
						c.fillStyle = ch.tier === 'gold' ? '#c9a227' : '#3a6ea5';
						c.fillRect(ch.x - 20, ch.y - 14 + bob, 40, 28);
					}
					c.restore();
					if (!ch.opened && this.chestNear === ch) {
						c.save();
						c.font = 'bold 13px system-ui,sans-serif';
						c.textAlign = 'center';
						c.textBaseline = 'middle';
						c.shadowColor = '#000';
						c.shadowBlur = 6;
						c.fillStyle = 'rgba(255,255,255,.22)';
						c.beginPath(); c.arc(ch.x, ch.y - 46 + bob, 12, 0, Math.PI * 2); c.fill();
						c.strokeStyle = '#4f6ef7';
						c.lineWidth = 3;
						c.beginPath(); c.arc(ch.x, ch.y - 46 + bob, 12, -Math.PI / 2, -Math.PI / 2 + this.chestProgress * Math.PI * 2); c.stroke();
						c.fillStyle = '#fff';
						c.fillText('F', ch.x, ch.y - 46 + bob);
						c.restore();
					}
				}
			}

			// ── 武器数值工具 ──
			weaponLevel(type) {
				const w = this.player.weapons.find((x) => x.type === type);
				return w ? w.level : 0;
			}
			isEvolved(type) {
				const w = this.player.weapons.find((x) => x.type === type);
				return !!w?.evolved;
			}
			cdMul() { return Math.max(0.4, 1 - 0.07 * this.player.passives.haste); }
			dmgMul() { return 1 + 0.12 * this.player.passives.might; }

			takeWeaponCd(type) {
				if (this.weaponCd[type] === undefined) this.weaponCd[type] = 0;
				return this.weaponCd[type];
			}

			// ── 主更新 ──
			tick(dt) {
				if (this.phase !== 'playing' && this.phase !== 'dying') return;
				dt = Math.min(dt, 1 / 30);
				if (this.phase === 'dying') {
					// 死亡慢动作：0.9s 真实时间的 25% 时流，然后进结算
					this.deathTimer -= dt;
					dt *= 0.25;
					if (this.deathTimer <= 0) { this.gameOver(); return; }
				}
				this.elapsed += dt;

				if (this.shieldTimer > 0) this.shieldTimer -= dt;
				if (this.freezeTimer > 0) this.freezeTimer -= dt;
				if (this.chaosTimer > 0) this.chaosTimer -= dt;
				// 主动技能：冷却 + 持续时间 + 划除线生命
				if (this.skillCd > 0) this.skillCd -= dt;
				if (this.skillTimer > 0) this.skillTimer -= dt;
				for (const ln of this.strikeLines) ln.life -= dt;
				this.strikeLines = this.strikeLines.filter((ln) => ln.life > 0);
				if (this.banner) { this.banner.life -= dt; if (this.banner.life <= 0) this.banner = null; }

				// 保底刷怪常驻（工作是额外加怪，不让位）；chaos 期间加倍
				if (!this.level) this.idleSpawn(dt); else this.levelTrickle(dt);

				this.updatePlayer(dt);
				this.updateCamera(dt);
				this.updateEnemies(dt);
				this.updateChests(dt);
				this.checkBossZone();
				this.updateStrikeLines(dt);
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

				if (this.player.hp <= 0 && this.phase === 'playing') {
					this.phase = 'dying';
					this.deathTimer = 0.9;
					this.shake = Math.max(this.shake, 0.5);
					this.keys.clear();
				}
			}

			updatePlayer(dt) {
				const p = this.player;
				if (this.dash) {
					const d = this.dash;
					d.t += dt;
					const k = Math.min(1, d.t / d.dur);
					const ease = k * k * (3 - 2 * k);
					p.x = d.x1 + (d.x2 - d.x1) * ease;
					p.y = d.y1 + (d.y2 - d.y1) * ease;
					p.moving = true;
					if (k >= 1) this.dash = null;
					p.x = Math.max(16, Math.min(this.world.w - 16, p.x));
					p.y = Math.max(16, Math.min(this.world.h - 16, p.y));
					return;
				}
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
				p.x = Math.max(16, Math.min(this.world.w - 16, p.x));
				p.y = Math.max(16, Math.min(this.world.h - 16, p.y));
				if (p.invuln > 0) p.invuln -= dt;
				if (p.celebrate > 0) p.celebrate -= dt;
				if (p.passives.regen > 0) p.hp = Math.min(p.maxHp, p.hp + 0.6 * p.passives.regen * dt);
			}

			updateEnemies(dt) {
				const p = this.player;
				const slowMul = (e) => (e.slow > 0 ? 0.5 : 1) * (this.freezeTimer > 0 ? 0.5 : 1);
				for (const e of this.enemies) {
					let dx = p.x - e.x, dy = p.y - e.y;
					let d = Math.hypot(dx, dy) || 1;
					// 营地睡眠：430px 内唤醒（关卡推进感；近身生成的怪首帧即醒）
					if (!e.aggro) {
						if (d <= 430) e.aggro = true;
						else {
							e.x += Math.sin((this.elapsed + e.id) * 1.8) * 3 * dt;
							if (e.hitFlash > 0) e.hitFlash -= dt;
							continue;
						}
					}
					const spd = e.speed * slowMul(e);
					if (e.elite && !e.boss) {
						// 精英怪远程输出：入图后不追人，随机游走
						const inside = e.x > 16 && e.x < this.world.w - 16 && e.y > 16 && e.y < this.world.h - 16;
						if (!inside) {
							dx = this.world.w / 2 - e.x;
							dy = this.world.h / 2 - e.y;
							d = Math.hypot(dx, dy) || 1;
							e.x += (dx / d) * spd * dt;
							e.y += (dy / d) * spd * dt;
						} else {
							e.wanderT = (e.wanderT ?? rand(0.8, 2.2)) - dt;
							if (e.wanderT <= 0) {
								e.wanderA = rand(0, Math.PI * 2);
								e.wanderT = rand(0.8, 2.2);
							}
							e.x += Math.cos(e.wanderA) * spd * 0.55 * dt;
							e.y += Math.sin(e.wanderA) * spd * 0.55 * dt;
							if (e.x < 16) { e.x = 16; e.wanderA = rand(-Math.PI / 2, Math.PI / 2); }
							if (e.x > this.world.w - 16) { e.x = this.world.w - 16; e.wanderA = Math.PI + rand(-Math.PI / 2, Math.PI / 2); }
							if (e.y < 16) { e.y = 16; e.wanderA = rand(0, Math.PI); }
							if (e.y > this.world.h - 16) { e.y = this.world.h - 16; e.wanderA = Math.PI + rand(0, Math.PI); }
						}
					} else {
						e.x += (dx / d) * spd * dt;
						e.y += (dy / d) * spd * dt;
					}
					if (e.boss && e.home) {
						const hdx = e.x - e.home.x, hdy = e.y - e.home.y;
						const hd = Math.hypot(hdx, hdy);
						if (hd > e.home.r) {
							e.x = e.home.x + (hdx / hd) * e.home.r;
							e.y = e.home.y + (hdy / hd) * e.home.r;
						}
					}
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
				this.enemies = this.enemies.filter((e) => (this.level
					? (e.x > -200 && e.x < this.world.w + 200 && e.y > -200 && e.y < this.world.h + 200)
					: (e.x > this.cam.x - 160 && e.x < this.cam.x + GAME_W + 160 && e.y > this.cam.y - 160 && e.y < this.cam.y + GAME_H + 160)));
			}

			updateWeapons(dt) {
				for (const w of this.player.weapons) {
					this.weaponCd[w.type] = (this.weaponCd[w.type] ?? 0) - dt;
					if (this.weaponCd[w.type] > 0) continue;
					switch (w.type) {
						case 'whip': this.fireWhip(w.level); this.weaponCd.whip = 1.1 * this.cdMul(); break;
						case 'bolt': this.fireBolt(w.level); this.weaponCd.bolt = 0.85 * this.cdMul(); break;
						case 'laser': break; // 编译激光改为常驻持续光束，由 updateLaserWeapon 维护
						case 'mine': this.fireMine(w.level); this.weaponCd.mine = 2.6 * this.cdMul(); break;
						case 'zap': this.fireZap(w.level); this.weaponCd.zap = 1.9 * this.cdMul() * (this.isEvolved('zap') ? 0.5 : 1); break;
						case 'orb': this.weaponCd.orb = 0.1; break; // orb 常驻，cd 只防重复
						default: break;
					}
				}
				this.updateLaserWeapon(dt);
				// 语法环绕：位置由 orbAngle 驱动（强化：更多球、更大范围、更快转速）
				// 进化·上下文窗口：6 球大半径、伤害翻倍、吸附附近宝石
				const orbLv = this.weaponLevel('orb');
				if (orbLv > 0) {
					const orbEvo = this.isEvolved('orb');
					this.orbAngle += (orbLv >= 3 ? 3.5 : 2.8) * dt;
					const orbR = orbEvo ? 130 : orbLv >= 3 ? 110 : 90;
					const count = orbEvo ? 6 : orbLv >= 3 ? 5 : orbLv >= 2 ? 4 : 3;
					const dmg = (orbEvo ? 6 : orbLv >= 4 ? 3.0 : orbLv >= 3 ? 2.5 : 2.0) * this.dmgMul();
					if (orbEvo) {
						for (const g of this.gems) {
							if (Math.hypot(g.x - this.player.x, g.y - this.player.y) < 200) g.magnetized = true;
						}
					}
					const hitR = orbEvo ? 20 : 16; // 与可见球体大小匹配的接触判定半径
					for (let i = 0; i < count; i++) {
						const a = this.orbAngle + (i * Math.PI * 2) / count;
						const ox = this.player.x + Math.cos(a) * orbR;
						const oy = this.player.y + Math.sin(a) * orbR;
						for (const e of this.grid.query(ox, oy, 40)) {
							const d = Math.hypot(e.x - ox, e.y - oy);
							if (d > hitR + e.size * 0.5) continue;
							const cdKey = e.id;
							if ((this.orbHitCd.get(cdKey) ?? 0) > this.elapsed) continue;
							this.orbHitCd.set(cdKey, this.elapsed + 0.4);
							this.hurtEnemy(e, dmg);
						}
					}
				}
			}

			updateLaserWeapon() {
				const w = this.player.weapons.find((x) => x.type === 'laser');
				if (w) {
					this.syncLaser(w.level, !!w.evolved);
				} else {
					// 没有编译激光时清掉常驻光束
					if (this.beams.some((b) => b.kind === 'laser')) {
						this.beams = this.beams.filter((b) => b.kind !== 'laser');
						this.laserCfg = null;
					}
				}
			}

			syncLaser(lv, evolved) {
				const n = evolved ? 12 : lv >= 2 ? 8 : 4;
				const len = evolved ? 380 : 320;
				const width = evolved ? 16 : lv >= 4 ? 16 : 14;
				const baseDmg = evolved ? 9 : lv >= 4 ? 7 : lv >= 3 ? 6 : 4;
				const spin = evolved ? 0.8 : 0.12; // 常驻微旋转，进化后明显旋转
				if (this.laserCfg && this.laserCfg.lv === lv && this.laserCfg.evolved === evolved) {
					return;
				}
				this.laserCfg = { lv, evolved };
				// 移除旧激光，按当前等级重建常驻光束
				this.beams = this.beams.filter((b) => b.kind !== 'laser');
				for (let i = 0; i < n; i++) {
					const a = (i * Math.PI * 2) / n + (lv >= 2 ? Math.PI / 8 : 0) + (evolved ? this.elapsed * spin : 0);
					this.beams.push({
						kind: 'laser',
						x: this.player.x, y: this.player.y,
						angle: a, len, width, baseDmg, spin,
						life: Infinity,
						hitCd: new Map(), // 每 0.25s 可再次命中同一敌人，实现持续灼烧
					});
				}
			}

			fireWhip(lv) {
				// 环形鞭波：Lv1 一圈，Lv2 两圈，Lv3+ 三圈（错峰扩散）
				// 进化·鲸尾横扫：四道 160 半径巨环 + 击退
				const evo = this.isEvolved('whip');
				const count = evo ? 4 : lv >= 3 ? 3 : lv;
				const radius = evo ? 160 : lv >= 3 ? 110 : 80;
				const dmg = (evo ? 6 : lv >= 4 ? 4 : lv >= 3 ? 3 : 2) * this.dmgMul();
				for (let i = 0; i < count; i++) {
					this.rings.push({
						x: this.player.x, y: this.player.y,
						r: 12, maxR: radius, speed: evo ? 320 : 260,
						damage: dmg, kb: evo || lv >= 4,
						color: evo ? '#40c4ff' : '#ffd54f',
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

			findBoltTarget(x, y, preferHp = false, range = 620) {
				// 索敌半径 = 弹道射程（speed×life 打折），不再瞄到打不到的目标
				const inRange = this.enemies.filter((e) => Math.hypot(e.x - x, e.y - y) < range);
				if (inRange.length === 0) return null;
				// 优先精英/Boss：只要在场，就优先追特殊目标
				const specials = inRange.filter((e) => e.elite || e.boss);
				const pool = specials.length > 0 ? specials : inRange;
				let best = null, bestVal = preferHp ? -Infinity : Infinity;
				for (const e of pool) {
					const score = preferHp ? e.hp : Math.hypot(e.x - x, e.y - y);
					if (preferHp ? score > bestVal : score < bestVal) { bestVal = score; best = e; }
				}
				return best;
			}

			fireBolt(lv) {
				// 改为自动瞄准目标：优先锁定最近的敌人；升级后有微跟踪
				// 进化·流式输出：机关枪连射 + 强跟踪
				const evo = this.isEvolved('bolt');
				const p = this.player;
				const dir = p.facing; // 1=右，-1=左
				if (evo) {
					// 机关枪模式：高速连射，每发都实时找目标
					for (let i = 0; i < 12; i++) {
						setTimeout(() => {
							if (this.phase !== 'playing' && this.phase !== 'dying') return;
							const t = this.findBoltTarget(this.player.x, this.player.y, true, 820); // 进化弹速 700×1.2s
							const baseAngle = t ? Math.atan2(t.y - this.player.y, t.x - this.player.x) : (this.player.facing === 1 ? 0 : Math.PI);
							const angle = baseAngle + rand(-0.05, 0.05);
							this.projectiles.push({
								x: this.player.x, y: this.player.y,
								vx: Math.cos(angle) * 700, vy: Math.sin(angle) * 700,
								damage: 3.5 * this.dmgMul(), pierce: 1, life: 1.2, hitSet: new Set(), kind: 'bolt',
								track: 3.2,
							});
						}, i * 150);
					}
					return;
				}
				const target = this.findBoltTarget(p.x, p.y, lv >= 4);
				const shots = lv >= 3 ? 7 : lv >= 2 ? 5 : 3;
				const pierce = lv >= 3 ? 1 : 0;
				const speed = 550;
				const dmg = (lv >= 4 ? 4 : lv >= 3 ? 3 : 2.5) * this.dmgMul();
				const spread = Math.PI / 4; // 45 度扇形
				const baseAngle = target ? Math.atan2(target.y - p.y, target.x - p.x) : (dir === 1 ? 0 : Math.PI);
				// 每级跟踪明显增强：Lv1 小漂移，Lv2 可感知，Lv3 明显，Lv4 强力
				const track = lv >= 4 ? 2.2 : lv >= 3 ? 1.5 : lv >= 2 ? 0.9 : 0.4;
				for (let i = 0; i < shots; i++) {
					const t = (i / (shots - 1)) - 0.5; // -0.5 ~ 0.5
					const angle = baseAngle + t * spread;
					this.projectiles.push({
						x: p.x, y: p.y,
						vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
						damage: dmg, pierce, life: 1.2, hitSet: new Set(), kind: 'bolt', track,
					});
				}
			}



			fireLaser(lv) {
				// 持续穿透光束（强化：CD 减半，持续时间加倍）
				// 进化·全量类型检查：12 道旋转激光网
				const evo = this.isEvolved('laser');
				const n = evo ? 12 : lv >= 2 ? 8 : 4;
				const dmg = (evo ? 9 : lv >= 3 ? 6 : 4) * this.dmgMul();
				const dur = evo ? 0.8 : lv >= 4 ? 0.6 : 0.5;
				const spin = evo ? this.elapsed * 0.8 : 0;
				for (let i = 0; i < n; i++) {
					const a = (i * Math.PI * 2) / n + (lv >= 2 ? Math.PI / 8 : 0) + spin;
					this.beams.push({ x: this.player.x, y: this.player.y, angle: a, len: evo ? 380 : 320, width: evo ? 16 : 14, damage: dmg, life: dur, maxLife: dur, hitSet: new Set() });
				}
			}

			fireMine(lv) {
				// 自动感应地雷（强化：触发半径 24→60px，靠近即引爆）
				// 进化·垃圾回收：存 6 雷、伤害翻倍、爆炸全减速
				const evo = this.isEvolved('mine');
				const cap = evo ? 6 : lv >= 2 ? 4 : 3;
				if (this.mines.length >= cap) this.mines.shift();
				this.mines.push({
					x: this.player.x, y: this.player.y,
					radius: evo ? 120 : lv >= 3 ? 100 : 80,
					damage: (evo ? 25 : lv >= 3 ? 15 : 10) * this.dmgMul(),
					slow: evo || lv >= 4, arm: 0.4,
				});
			}

			fireZap(lv) {
				// 多目标连锁闪电（强化：Lv1=2 目标，Lv2=3 目标 + 眩晕，Lv3+=4 目标 + 连锁）
				// 进化·热重载：4 道连锁闪电，冷却减半
				const evo = this.isEvolved('zap');
				const strikes = evo ? 4 : lv >= 3 ? 4 : lv >= 2 ? 3 : 2;
				const dmg = (evo ? 10 : lv >= 4 ? 7 : 5) * this.dmgMul();
				const radius = evo ? 90 : lv >= 4 ? 75 : 60;
				const cands = this.enemies.filter((e) => Math.hypot(e.x - this.player.x, e.y - this.player.y) < 350);
				if (cands.length === 0) return;
				for (let i = 0; i < strikes; i++) {
					const t = pick(cands);
					this.burst(t.x, t.y, '#ffe066', 8);
					this.particles.push({ kind: 'zap', x: t.x, y: t.y, life: 0.22, maxLife: 0.22 });
					for (const e of this.grid.query(t.x, t.y, radius)) {
						if (Math.hypot(e.x - t.x, e.y - t.y) <= radius) {
							this.hurtEnemy(e, dmg);
							if (lv >= 2) e.slow = 1.0; // 眩晕 1 秒
						}
					}
					if (evo || lv >= 3) {
						for (const e2 of this.grid.query(t.x, t.y, 130)) {
							if (e2 !== t && Math.hypot(e2.x - t.x, e2.y - t.y) <= 130 && Math.random() < 0.6) {
								this.hurtEnemy(e2, dmg * 0.7);
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
					b.life > 0 && b.x > this.cam.x - 60 && b.x < this.cam.x + GAME_W + 60 && b.y > this.cam.y - 60 && b.y < this.cam.y + GAME_H + 60);
			}

			updateProjectiles(dt) {
				for (const pr of this.projectiles) {
					if (pr.track > 0) {
						const t = this.findBoltTarget(pr.x, pr.y);
						if (t) {
							const cur = Math.atan2(pr.vy, pr.vx);
							const want = Math.atan2(t.y - pr.y, t.x - pr.x);
							let diff = want - cur;
							while (diff > Math.PI) diff -= Math.PI * 2;
							while (diff < -Math.PI) diff += Math.PI * 2;
							const turn = Math.max(-pr.track * dt, Math.min(pr.track * dt, diff));
							const a = cur + turn;
							const spd = Math.hypot(pr.vx, pr.vy) || 1;
							pr.vx = Math.cos(a) * spd;
							pr.vy = Math.sin(a) * spd;
						}
					}
					pr.x += pr.vx * dt;
					pr.y += pr.vy * dt;
					pr.life -= dt;
				}
				this.projectiles = this.projectiles.filter((pr) =>
					pr.life > 0 && pr.pierce >= 0 && pr.x > this.cam.x - 40 && pr.x < this.cam.x + GAME_W + 40 && pr.y > this.cam.y - 40 && pr.y < this.cam.y + GAME_H + 40);
			}

			updateBeams(dt) {
				for (const b of this.beams) {
					if (b.kind === 'laser') {
						// 常驻激光：跟随玩家、缓慢旋转、不消失
						b.x = this.player.x;
						b.y = this.player.y;
						if (b.spin) b.angle += b.spin * dt;
					} else {
						b.life -= dt;
					}
				}
				this.beams = this.beams.filter((b) => b.kind === 'laser' || b.life > 0);
			}

			updateMines(dt) {
				for (const m of this.mines) {
					if (m.arm > 0) { m.arm -= dt; continue; }
					const near = this.grid.query(m.x, m.y, 60).some((e) => Math.hypot(e.x - m.x, e.y - m.y) < 60);
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
				// 激光 vs 敌人（常驻激光按 0.25s 间隔持续灼烧）
				for (const b of this.beams) {
					const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
					for (const e of this.grid.query(b.x, b.y, b.len)) {
						const rx = e.x - b.x, ry = e.y - b.y;
						const along = rx * cos + ry * sin;
						if (along < 0 || along > b.len) continue;
						const perp = Math.abs(-rx * sin + ry * cos);
						if (perp < b.width / 2 + e.size * 0.5) {
							const nextHit = b.hitCd.get(e.id) ?? 0;
							if (nextHit > this.elapsed) continue;
							b.hitCd.set(e.id, this.elapsed + 0.25);
							this.hurtEnemy(e, (b.baseDmg ?? b.damage ?? 4) * this.dmgMul());
						}
					}
				}
				// 护盾/主动技能无敌期间不吃任何伤害
				if (this.shieldTimer > 0 || this.skillTimer > 0) return;
				// 工作中（10s 内有真实工作燃料）→ 大额减伤 75%
				const workMul = this.isWorkActive() ? 0.25 : 1;
				// 敌人接触伤害
				if (p.invuln <= 0) {
					for (const e of this.grid.query(p.x, p.y, 40)) {
						if (Math.hypot(e.x - p.x, e.y - p.y) < e.size * 0.55 + 13) {
							const raw = (8 + Math.min(20, this.elapsed / 30) + (e.elite ? 4 : 0)) * workMul * this.diffMul();
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
						// 按整行文本矩形判定（而不是中心一个点）
						const hw = (b.w ?? b.text.length * 7) / 2 + 10;
						const hh = (b.h ?? 14) / 2 + 10;
						if (Math.abs(b.x - p.x) <= hw && Math.abs(b.y - p.y) <= hh) {
							b.life = 0;
							const dmg = Math.max(1, (6 + Math.min(12, this.elapsed / 40)) * workMul * this.diffMul() - p.passives.armor);
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
				if (e.levelBoss) this.onLevelBossKilled(e);
			}

			/** P3：玩家踏入 Boss 圈 → 关底 Boss 现身 */
			checkBossZone() {
				const lv = this.level;
				if (!lv || !lv.bossZone || !lv.boss || this.bossSpawned) return;
				const bz = lv.bossZone;
				const zx = bz.xf * this.world.w, zy = bz.yf * this.world.h;
				if (Math.hypot(this.player.x - zx, this.player.y - zy) > (bz.r ?? 190)) return;
				this.bossSpawned = true;
				const b = lv.boss;
				const hp = b.hp * this.diffMul();
				const boss = {
					id: nextId++, type: 'boss', levelBoss: true,
					x: zx, y: zy, hp, maxHp: hp,
					speed: b.speed ?? 36, size: b.size ?? 34, color: b.color ?? '#c62828', label: b.label ?? 'BOSS',
					xp: b.xp ?? 30, elite: true, boss: true, hitFlash: 0, slow: 0, aggro: true,
					home: { x: zx, y: zy, r: Math.max(60, (bz.r ?? 190) - 14) },
				};
				this.enemies.push(boss);
				this.bossRef = boss.id;
				this.shake = Math.max(this.shake, 0.5);
				this.setBanner('⚠ ' + (b.name ?? 'BOSS') + (b.title ? ' · ' + b.title : '') + ' 出现！');
			}

			/** P3：击杀关底 Boss → 现场清小怪 + 请求服务端发牌 */
			onLevelBossKilled(e) {
				this.bossKilled = true;
				this.bossRef = null;
				for (const en of this.enemies) this.burst(en.x, en.y, en.color, 4);
				this.kills += this.enemies.length;
				this.enemies = [];
				this.dropGems(6, 8);
				this.shake = 0.6;
				this.setBanner('👑 Boss 击破！翻卡抽战利');
				this.sendWs({ kind: ClientMsg.BOSS_KILL, levelId: this.level?.id ?? null });
			}

			dropGemsAt(x, y, value) {
				if (this.gems.length >= 400) this.gems.shift();
				this.gems.push({ x, y, value, magnetized: false });
			}

			collectGems(dt) {
				const p = this.player;
				const magnetLv = Number(p.passives.magnet) || 0;
				// 磁铁：每级 +40 拾取半径，满级直接全屏吸取
				const magnetMaxed = magnetLv >= PASSIVE_MAX;
				const magnetR = magnetMaxed ? Infinity : 50 + 40 * magnetLv;
				for (const g of this.gems) {
					const dx = p.x - g.x, dy = p.y - g.y;
					const d = Math.hypot(dx, dy) || 1;
					if (magnetMaxed || d < magnetR) g.magnetized = true;
					if (g.magnetized) {
						const spd = magnetMaxed ? 420 : 320;
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
				// 已有暂存升级时，先处理完当前三选一，避免新的升级覆盖待选卡
				if (this.pendingChoices) return;
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
				// 超武进化优先：满级武器 + 对应被动且未进化
				for (const w of p.weapons) {
					const evo = EVOLUTIONS[w.type];
					if (evo && !w.evolved && w.level >= WEAPON_MAX && p.passives[evo.passive] > 0) {
						cands.push({ kind: 'evolve', type: w.type });
					}
				}
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
				// 进化卡必出（里程碑时刻），其余随机补到 3 张
				const evolves = cands.filter((c) => c.kind === 'evolve');
				const picked = [...evolves];
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
				} else if (c.kind === 'evolve') {
					const w = p.weapons.find((x) => x.type === c.type);
					if (w) {
						w.evolved = true;
						this.setBanner('🌟 超武进化：' + EVOLUTIONS[c.type].name + '！');
					}
				} else if (c.kind === 'passive-up') p.passives[c.type]++;
				else if (c.kind === 'heal') p.hp = p.maxHp;
				else if (c.kind === 'nuke') this.nuke();
				this.choices = null;
				this.pendingChoices = null;
				this.phase = 'playing';
				this.focusCanvas();
			}

			/** 主动放弃本局：跳过死亡动画，直接进入结算页 */
			abandonRun() {
				if (this.phase !== 'paused' && this.phase !== 'playing') return;
				this.choices = null;
				this.pendingChoices = null;
				this.gameOver();
			}

			/** P3：通关后补发结算记录（复用 game-over 入账，幂等） */
			reportClearSettlement() {
				if (this._settleSent) return;
				this._settleSent = true;
				this.sendWs({
					kind: ClientMsg.GAME_OVER,
					score: this.score(),
					kills: this.kills,
					duration: Math.round(this.elapsed),
					level: this.player.level,
					discovered: [...this.discovered],
					cleared: true,
				});
			}

			gameOver() {
				if (this._settleSent) return;
				this.phase = 'gameover';
				this.finalScore = this.score();
				this.sendWs({
					kind: ClientMsg.GAME_OVER,
					score: this.finalScore,
					kills: this.kills,
					duration: Math.round(this.elapsed),
					level: this.player.level,
					discovered: [...this.discovered],
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
				// ── 世界层：相机空间 ──
				c.save();
				c.translate(-this.cam.x, -this.cam.y);
				this.drawLevelDecor(c);
				this.drawStrikeLines(c);
				this.drawGems(c, t);
				this.drawMines(c, t);
				this.drawChests(c, t);
				this.drawEnemies(c);
				this.drawOrbs(c);
				this.drawRings(c);
				this.drawProjectiles(c);
				this.drawBeams(c);
				this.drawEnemyBullets(c);
				this.drawPlayer(c, t);
				this.drawParticles(c);
				this.drawDmgNums(c);
				c.restore();
				// ── 屏幕层（不受相机影响） ──
				this.drawBanner(c);

				c.restore();
			}

			drawStrikeLines(c) {
				if (this.strikeLines.length === 0) return;
				c.save();
				for (const ln of this.strikeLines) {
					const k = Math.min(1, ln.life / 0.5);
					c.globalAlpha = k;
					c.strokeStyle = '#ff6b9d';
					c.shadowColor = '#ff6b9d';
					c.shadowBlur = 8;
					c.lineWidth = 5;
					c.setLineDash([10, 6]);
					c.beginPath();
					c.moveTo(ln.x1, ln.y1);
					c.lineTo(ln.x2, ln.y2);
					c.stroke();
					c.setLineDash([]);
				}
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
				c.fillStyle = this.theme?.bg ?? '#0b0d13';
				c.fillRect(-8, -8, GAME_W + 16, GAME_H + 16);
				// 网格线在世界空间滚动（cam=0 时与旧版逐像素一致）
				c.strokeStyle = this.theme?.grid ?? 'rgba(79,110,247,0.05)';
				c.lineWidth = 1;
				c.beginPath();
				const gx0 = Math.floor(this.cam.x / 48) * 48;
				const gy0 = Math.floor(this.cam.y / 48) * 48;
				for (let x = gx0; x <= this.cam.x + GAME_W; x += 48) {
					const sx = x - this.cam.x;
					c.moveTo(sx, 0); c.lineTo(sx, GAME_H);
				}
				for (let y = gy0; y <= this.cam.y + GAME_H; y += 48) {
					const sy = y - this.cam.y;
					c.moveTo(0, sy); c.lineTo(GAME_W, sy);
				}
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
				const evo = this.isEvolved('orb');
				const count = evo ? 6 : lv >= 3 ? 5 : lv >= 2 ? 4 : 3;
				const orbR = evo ? 130 : lv >= 3 ? 110 : 90;
				for (let i = 0; i < count; i++) {
					const a = this.orbAngle + (i * Math.PI * 2) / count;
					const ox = this.player.x + Math.cos(a) * orbR;
					const oy = this.player.y + Math.sin(a) * orbR;
					c.save();
					c.shadowColor = evo ? '#40c4ff' : '#9d6bff';
					c.shadowBlur = 10;
					c.fillStyle = evo ? '#40c4ff' : '#9d6bff';
					c.beginPath();
					c.arc(ox, oy, evo ? 9 : 7, 0, Math.PI * 2);
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
					c.strokeStyle = rg.color || '#ffd54f';
					c.lineWidth = rg.color === '#40c4ff' ? 8 : 5;
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
					const alpha = b.kind === 'laser' ? 0.85 : Math.max(0, b.life / b.maxLife);
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
				const _lv = this.level ? { levelName: this.level.name, levelChapter: this.level.chapter ?? null } : { levelName: null };
				let compass = null; let chestsLeft = 0;
				if (this.level) {
					const unopened = this.chests.filter((cc) => !cc.opened);
					chestsLeft = unopened.length;
					const bz = this.level.bossZone;
					let tx = null, ty = null, kind = 'Boss';
					if (unopened.length > 0) {
						let best = unopened[0], bd = 1e18;
						for (const cc of unopened) {
							const d = Math.hypot(cc.x - this.player.x, cc.y - this.player.y);
							if (d < bd) { bd = d; best = cc; }
						}
						tx = best.x; ty = best.y; kind = '宝箱';
					} else if (bz) { tx = bz.xf * this.world.w; ty = bz.yf * this.world.h; }
					if (tx != null) {
						const dx = tx - this.player.x, dy = ty - this.player.y;
						const idx = Math.round((((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4))) & 7;
						compass = { dir: ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][idx], dist: Math.round(Math.hypot(dx, dy) / 10), kind };
					}
				}
				return {
					..._lv,
					compass, chestsLeft,
					cards: this.cards,
					boss: (() => {
						if (this.bossRef == null) return null;
						const b = this.enemies.find((en) => en.id === this.bossRef);
						if (!b) return null;
						return { name: this.level?.boss?.name ?? 'BOSS', hp: Math.max(0, Math.round(b.hp)), maxHp: Math.round(b.maxHp), quip: this.level?.boss?.quip ?? null };
					})(),
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
					weapons: this.player.weapons.map((w) => ({ type: w.type, level: w.level, evolved: !!w.evolved })),
					discovered: [...new Set([...this.knownFromServer, ...this.discovered])],
					passives: Object.entries(this.player.passives).filter(([, v]) => v > 0).map(([type, level]) => ({ type, level })),
					choices: this.choices,
					pendingChoices: !!this.pendingChoices,
					activeSkill: this.activeSkillId ? {
						id: this.activeSkillId,
						icon: ACTIVE_SKILLS[this.activeSkillId].icon,
						name: ACTIVE_SKILLS[this.activeSkillId].name,
						cd: Math.max(0, this.skillCd),
						cdMax: ACTIVE_SKILLS[this.activeSkillId].cd,
						timer: Math.max(0, this.skillTimer),
						teleportsLeft: this.teleportsLeft,
						maxTeleports: ACTIVE_SKILLS[this.activeSkillId].maxTeleports,
					} : null,
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
				snap.levelName ? h('div', { key: 'tc', className: 'dsh-vs-hud-tc', children: (snap.levelChapter ? '第 ' + snap.levelChapter + ' 章 · ' : '') + snap.levelName + (snap.compass ? '　🧭 ' + snap.compass.kind + ' ' + snap.compass.dir + ' ' + snap.compass.dist + 'm' + (snap.chestsLeft ? '（余 ' + snap.chestsLeft + '）' : '') : '') }) : null,
				h('div', { key: 'tr', className: 'dsh-vs-hud-tr', children: [
					h('div', { key: 't', className: 'dsh-vs-timer', children: fmtTime(snap.elapsed) }),
					h('div', { key: 'k', children: '击杀 ' + snap.kills + ' · 分数 ' + snap.score }),
					snap.buffs.length > 0 ? h('div', { key: 'b', style: { color: '#ffd54f' }, children: snap.buffs.map((b) => b.text ?? (b.icon + b.left + 's')).join('  ') }) : null,
				] }),
				h('div', { key: 'bl', className: 'dsh-vs-hud-bl', children: snap.weapons.map((w) =>
					h('div', { key: w.type, className: 'dsh-vs-chip', style: w.evolved ? { borderColor: '#40c4ff' } : undefined, children: [
						h('span', { key: 'i', children: WEAPONS[w.type].icon + (w.evolved ? '★' : '') }),
						h('b', { key: 'l', children: w.evolved ? '超武' : 'Lv' + w.level }),
					] })),
				}),
				h('div', { key: 'br', className: 'dsh-vs-hud-br', children: snap.passives.map((p) =>
					h('div', { key: p.type, className: 'dsh-vs-chip', children: [
						h('span', { key: 'i', children: PASSIVES[p.type].icon }),
						h('b', { key: 'l', children: 'Lv' + p.level }),
					] })),
				}),
				snap.boss ? h('div', { key: 'boss', className: 'dsh-vs-bossbar', children: [
					h('div', { key: 'n', className: 'nm', children: '⚠ ' + snap.boss.name }),
					h('div', { key: 'b', className: 'bar', children: [h('i', { key: 'f', style: { width: (snap.boss.hp / snap.boss.maxHp * 100) + '%' } })] }),
				] }) : null,
			] });
		}

		function LevelUpCards({ choices, onPick, onDefer }) {
			return hs('div', { className: 'dsh-vs-cover', children: [
				h('h2', { key: 'h', children: '🎉 升级了！三选一' }),
				h('div', { key: 'cards', className: 'dsh-vs-cards', children: choices.map((c, i) => {
					let icon = '✨', nm = '', lv = '', desc = '';
					if (c.kind === 'evolve') { icon = EVOLUTIONS[c.type].icon; nm = EVOLUTIONS[c.type].name; lv = '🌟 超武进化'; desc = EVOLUTIONS[c.type].desc; }
					else if (c.kind === 'weapon-new') { icon = WEAPONS[c.type].icon; nm = WEAPONS[c.type].name; lv = '新武器'; desc = WEAPONS[c.type].desc; }
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
				onDefer ? h('button', {
					key: 'defer',
					className: 'dsh-vs-btn ghost',
					onClick: onDefer,
					children: '稍后选择',
				}) : null,
			] });
		}

		/** 图鉴弹窗：武器 + 怪物（怪物需遇到解锁） */
		function PediaModal({ snap, tab, setTab, onClose }) {
			const discovered = new Set(snap?.discovered ?? []);
			const weaponCards = Object.keys(WEAPONS).map((t) => {
				const w = WEAPONS[t];
				const d = WEAPON_DETAILS[t] || { levels: [], evolve: '' };
				const evo = EVOLUTIONS[t];
				return { type: t, icon: w.icon, name: w.name, desc: w.desc, levels: d.levels, evolve: d.evolve, evoName: evo?.name, evoIcon: evo?.icon, evoPassive: evo ? PASSIVES[evo.passive]?.name : '' };
			});
			const enemyCards = Object.keys(ENEMY_TYPES).map((t) => ({ type: t, ...ENEMY_TYPES[t], name: ENEMY_NAMES[t], desc: ENEMY_DETAILS[t] || '' }));
			let body;
			if (tab === 'weapon') {
				body = weaponCards.map((w) =>
					hs('div', { key: w.type, className: 'dsh-vs-pedia-card', children: [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: w.icon }), h('span', { key: 'n', children: w.name })] }),
						h('div', { key: 'd', className: 'pd', children: w.desc }),
						h('div', { key: 'l', className: 'pl', children: 'Lv1 ' + (w.levels[0] ?? '') + '\nLv2 ' + (w.levels[1] ?? '') + '\nLv3 ' + (w.levels[2] ?? '') + '\nLv4 ' + (w.levels[3] ?? '') }),
						h('div', { key: 'e', className: 'pe', children: '进化：' + (w.evoIcon ?? '') + ' ' + (w.evoName ?? '') + '（' + (w.evoPassive ?? '') + '）——' + (w.evolve || '') }),
					]}));
			} else {
				body = enemyCards.map((e) => {
					const unlocked = discovered.has(e.type);
					return hs('div', { key: e.type, className: 'dsh-vs-pedia-card' + (unlocked ? '' : ' locked'), children: unlocked ? [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: e.label }), h('span', { key: 'n', children: e.name })] }),
						h('div', { key: 'st', className: 'pd', children: 'HP ' + e.hp + ' · 速度 ' + e.speed + ' · 经验 ' + e.xp }),
						h('div', { key: 'd', className: 'pd', children: e.desc }),
					] : [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: '❓' }), h('span', { key: 'n', children: '未遇见' })] }),
						h('div', { key: 'd', className: 'pd', children: '遇到该敌人后解锁详细情报' }),
					] });
				});
			}
			return hs('div', {
				className: 'dsh-vs-pedia',
				onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
				children: [
				hs('div', { key: 'box', className: 'dsh-vs-pedia-box', children: [
					hs('div', { key: 'head', className: 'dsh-vs-pedia-head', children: [
						h('div', { key: 't', style: { fontWeight: 700 }, children: '📖 图鉴' }),
						h('button', { key: 'x', className: 'dsh-vs-pedia-close', onClick: onClose, children: '✕' }),
					] }),
					hs('div', { key: 'tabs', className: 'dsh-vs-pedia-tabs', children: [
						h('button', { key: 'weapon', className: 'dsh-vs-pedia-tab' + (tab === 'weapon' ? ' on' : ''), onClick: () => setTab('weapon'), children: '🗡 武器' }),
						h('button', { key: 'enemy', className: 'dsh-vs-pedia-tab' + (tab === 'enemy' ? ' on' : ''), onClick: () => setTab('enemy'), children: '👾 怪物' }),
					] }),
					hs('div', { key: 'body', className: 'dsh-vs-pedia-body', children: body }),
				] }),
				] });
		}

		/** 动态角色立绘：随机非行走动作（idle/think/eat/play 等） */
		const PORTRAIT_ACTIONS = ['idle', 'think', 'wait', 'joy', 'eat', 'play', 'welcome', 'celebrate', 'working', 'sleep', 'wake', 'disappointed'];
		function CharacterPortrait() {
			const ref = useRef(null);
			useEffect(() => {
				ensureSprites();
				let raf = 0;
				let action = pick(PORTRAIT_ACTIONS);
				let changedAt = performance.now();
				let lastChange = changedAt;
				const loop = (now) => {
					if (now - lastChange > 3500) {
						action = pick(PORTRAIT_ACTIONS);
						changedAt = now;
						lastChange = now;
					}
					const canvas = ref.current;
					if (canvas) {
						const ctx = canvas.getContext('2d');
						ctx.clearRect(0, 0, canvas.width, canvas.height);
						drawSprite(ctx, action, (now - changedAt) / 1000, canvas.width / 2, canvas.height / 2, 190, false);
					}
					raf = requestAnimationFrame(loop);
				};
				raf = requestAnimationFrame(loop);
				return () => cancelAnimationFrame(raf);
			}, []);
			return h('canvas', { ref, className: 'dsh-vs-char-portrait-canvas', width: 220, height: 220 });
		}

		/** 角色界面：左侧角色信息 + 右侧标签页（背包 / 角色面板 / 初始天赋） */
		function CharacterModal({ character, goldEarned, send, onClose }) {
			const [tab, setTab] = useState('bag'); // 'bag' | 'panel' | 'talent'
			const [weaponPicker, setWeaponPicker] = useState(false);
			const [selectedItem, setSelectedItem] = useState(null);
			const char = character || {
				gold: 0,
				initialWeapon: 'whip',
				passives: { armor: 0, regen: 0, speed: 0, might: 0, haste: 0, magnet: 0 },
				inventory: ['newbie-gift', 'skill-book'],
				accessories: [null, null, null, null],
				activeSkill: null,
			};
			const gold = Number(char.gold) || 0;
			const passives = char.passives || {};
			const inventory = Array.isArray(char.inventory) ? char.inventory : [];
			const accessories = Array.isArray(char.accessories) && char.accessories.length >= 4 ? char.accessories : [null, null, null, null];
			const lastEarned = Number(goldEarned) || 0;

			const renderBag = () => {
				const INV_COLS = 6;
				const INV_SLOTS = 24;
				// 堆叠：同类物品合并一格显示 ×N（材料/饰品不占多格）
				const counts = new Map();
				for (const it of inventory) counts.set(it, (counts.get(it) ?? 0) + 1);
				const entries = [...counts.entries()];
				const slotCount = Math.max(INV_SLOTS, Math.ceil(entries.length / INV_COLS) * INV_COLS);
				const nodes = [];
				for (let i = 0; i < slotCount; i++) {
					const ent = entries[i];
					if (!ent) {
						nodes.push(h('div', { key: 'e' + i, className: 'dsh-vs-item empty', onClick: () => setSelectedItem(null) }));
						continue;
					}
					const item = ent[0];
					const count = ent[1];
					const meta = itemMeta(item);
					const canOpen = item === 'newbie-gift' || item === 'skill-book';
					const isSel = selectedItem === item;
					nodes.push(h('div', {
						key: item,
						className: 'dsh-vs-item' + (canOpen ? ' use' : '') + (isSel ? ' selected' : ''),
						title: meta.name + (count > 1 ? ' ×' + count : '') + ' —— ' + meta.desc,
						onClick: () => setSelectedItem(item),
						children: [
							meta.iconUrl
								? h('img', { key: 'i', className: 'dsh-vs-item-img', src: meta.iconUrl, alt: meta.name })
								: h('div', { key: 'i', className: 'dsh-vs-item-icon', children: meta.icon }),
							count > 1 ? h('div', { key: 'c', className: 'dsh-vs-item-count', children: '×' + count }) : null,
							h('div', { key: 'n', className: 'dsh-vs-item-name', children: meta.name }),
							canOpen && isSel ? h('button', {
								key: 'a',
								className: 'dsh-vs-item-use-btn',
								onClick: (e) => {
									e.stopPropagation();
									send({ kind: ClientMsg.OPEN_ITEM, item });
									setSelectedItem(null);
								},
								children: item === 'skill-book' ? '使用' : '打开',
							}) : null,
						],
					}));
				}
				return hs('div', { className: 'dsh-vs-inv', onClick: (e) => { if (e.target === e.currentTarget) setSelectedItem(null); }, children: nodes });
			};

			const renderPanel = () => hs('div', { className: 'dsh-vs-char-panel', children: [
				h('div', { key: 'name', className: 'dsh-vs-upgrade-row', children: [
					h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '角色' }),
					h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: 'DeepSeek 娘' }),
				] }),
				h('div', { key: 'gold', className: 'dsh-vs-upgrade-row', children: [
					h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '金币' }),
					h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: gold + (lastEarned > 0 ? '（本局 +' + lastEarned + '）' : '') }),
				] }),
				h('div', { key: 'weapon', className: 'dsh-vs-upgrade-row', children: [
					h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '初始武器' }),
					h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: (WEAPONS[char.initialWeapon]?.icon ?? '') + ' ' + (WEAPONS[char.initialWeapon]?.name ?? '未选择') }),
				] }),
				h('div', { key: 'skill', className: 'dsh-vs-upgrade-row', children: [
					h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '主动技能' }),
					h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: (char.activeSkill ? (ACTIVE_SKILLS[char.activeSkill]?.icon ?? '') + ' ' + (ACTIVE_SKILLS[char.activeSkill]?.name ?? char.activeSkill) : '待开发') }),
				] }),
				h('div', { key: 'acc', className: 'dsh-vs-upgrade-row', children: [
					h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '饰品栏' }),
					h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: accessories.filter(Boolean).length + ' / 4' }),
				] }),
			] });

			const renderTalent = () => hs('div', { className: 'dsh-vs-passives', children: Object.keys(PASSIVES).map((t) => {
				const lvl = Number(passives[t]) || 0;
				const cost = 100 * (lvl + 1);
				const maxed = lvl >= 5;
				return hs('div', { key: t, className: 'dsh-vs-upgrade-row', children: [
					h('span', { key: 'n', className: 'dsh-vs-upgrade-name', children: PASSIVES[t].icon + ' ' + PASSIVES[t].name + ' Lv.' + lvl }),
					h('span', { key: 'c', className: 'dsh-vs-upgrade-cost', children: maxed ? '已满级' : cost + ' 金币' }),
					h('button', { key: 'b', className: 'dsh-vs-mini-btn', disabled: maxed || gold < cost, onClick: () => send({ kind: ClientMsg.UPGRADE_PASSIVE, passive: t }), children: maxed ? '满级' : '升级' }),
				] });
			}) });

			return hs('div', {
				className: 'dsh-vs-char',
				onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
				children: [
				hs('div', { key: 'box', className: 'dsh-vs-char-box', children: [
					hs('div', { key: 'head', className: 'dsh-vs-char-head', children: [
						h('div', { key: 't', style: { fontWeight: 700 }, children: '👤 角色' }),
						h('button', { key: 'x', className: 'dsh-vs-pedia-close', onClick: onClose, children: '✕' }),
					] }),
					hs('div', { key: 'body', className: 'dsh-vs-char-body', children: [
						hs('div', { key: 'left', className: 'dsh-vs-char-left', children: [
							hs('div', { key: 'top', className: 'dsh-vs-char-topline', children: [
								h('div', { key: 'gold', className: 'dsh-vs-char-gold', children: '💰 金币 ' + gold + (lastEarned > 0 ? '（本局 +' + lastEarned + '）' : '') }),
								h('div', { key: 'at', className: 'dsh-vs-char-section-title dsh-vs-char-acc-title', children: '饰品栏' }),
							] }),
							hs('div', { key: 'pr', className: 'dsh-vs-char-portrait-row', children: [
								h(CharacterPortrait, { key: 'portrait' }),
								hs('div', { key: 'acc', className: 'dsh-vs-char-acc-col', children: accessories.map((a, i) => {
									const am = a ? itemMeta(a) : null;
									return h('div', {
										key: i,
										className: 'dsh-vs-char-acc-slot' + (a ? ' filled' : ''),
										children: a ? [
											am.iconUrl ? h('img', { key: 'i', src: am.iconUrl, alt: am.name }) : h('span', { key: 'i', children: am.icon }),
											h('span', { key: 'n', className: 'dsh-vs-acc-label', children: am.name }),
										] : '未装备',
									});
								}) }),
							] }),
							hs('div', { key: 'cards', className: 'dsh-vs-char-cards', children: [
								hs('div', { key: 'weapon', className: 'dsh-vs-char-card', children: [
									hs('div', { key: 'main', className: 'dsh-vs-char-card-main', children: [
										h('span', { key: 'i', children: WEAPONS[char.initialWeapon]?.icon ?? '⚔' }),
										hs('div', { key: 't', children: [
											h('div', { key: 'n', children: WEAPONS[char.initialWeapon]?.name ?? '未选择' }),
											h('div', { key: 's', className: 'dsh-vs-char-card-sub', children: '初始武器' }),
										] }),
									] }),
									h('button', { key: 'ch', className: 'dsh-vs-mini-btn', onClick: () => setWeaponPicker((o) => !o), children: weaponPicker ? '收起' : '更换' }),
								] }),
								weaponPicker ? hs('div', { key: 'picker', className: 'dsh-vs-weapon-picker', children: Object.keys(WEAPONS).map((t) =>
									h('button', {
										key: t,
										className: 'dsh-vs-weapon-opt' + (char.initialWeapon === t ? ' on' : ''),
										onClick: () => send({ kind: ClientMsg.SET_INITIAL_WEAPON, weapon: t }),
										children: WEAPONS[t].icon + ' ' + WEAPONS[t].name,
									})),
								}) : null,
								hs('div', { key: 'skill', className: 'dsh-vs-char-card', children: [
									hs('div', { key: 'main', className: 'dsh-vs-char-card-main', children: [
										h('span', { key: 'i', children: char.activeSkill ? (ACTIVE_SKILLS[char.activeSkill]?.icon ?? '⚡') : '⚡' }),
										hs('div', { key: 't', children: [
											h('div', { key: 'n', children: char.activeSkill ? (ACTIVE_SKILLS[char.activeSkill]?.name ?? char.activeSkill) : '主动技能' }),
											h('div', { key: 's', className: 'dsh-vs-char-card-sub', children: char.activeSkill && ACTIVE_SKILLS[char.activeSkill] ? 'CD ' + ACTIVE_SKILLS[char.activeSkill].cd + 's · 5s无敌 · 最多6次快速移动' : '未获得（使用技能书学习）' }),
										] }),
									] }),
								] }),
							] }),
						]}),
						hs('div', { key: 'right', className: 'dsh-vs-char-right', children: [
							hs('div', { key: 'tabs', className: 'dsh-vs-char-tabs', children: [
								h('button', { key: 'bag', className: 'dsh-vs-char-tab' + (tab === 'bag' ? ' on' : ''), onClick: () => setTab('bag'), children: '背包' }),
								h('button', { key: 'panel', className: 'dsh-vs-char-tab' + (tab === 'panel' ? ' on' : ''), onClick: () => setTab('panel'), children: '角色面板' }),
								h('button', { key: 'talent', className: 'dsh-vs-char-tab' + (tab === 'talent' ? ' on' : ''), onClick: () => setTab('talent'), children: '初始天赋' }),
							] }),
							tab === 'bag' ? renderBag() : tab === 'panel' ? renderPanel() : renderTalent(),
						]}),
					]}),
				]}),
				] });
		}

		/** 选关面板：上班去 = 推剧情关（P1 全开放，通关锁定 P3 接上后启用） */
		function LevelSelect({ levels, character, onPick, onBack }) {
			const cleared = new Set(character?.clearedLevels ?? []);
			return hs('div', { className: 'dsh-vs-cover', children: [
				h('h2', { key: 'h', children: '💼 今天上哪个班' }),
				h('div', { key: 'sub', className: 'sub', children: '《上下求索》—— 路漫漫其修远兮，吾将上下而摸鱼' }),
				h('div', { key: 'list', className: 'dsh-vs-levels', children: levels.map((lv, idx) => {
						const locked = idx > 0 && !cleared.has(levels[idx - 1].id);
						return hs('div', { key: lv.id, className: 'dsh-vs-lvcard' + (locked ? ' locked' : ''), onClick: () => { if (!locked) onPick(lv); }, children: [
							cleared.has(lv.id) ? h('span', { key: 'b', className: 'badge', children: '✓ 已通关' }) : (locked ? h('span', { key: 'b', className: 'badge lock', children: '🔒 通关上一章' }) : null),
						h('div', { key: 'ch', className: 'ch', children: (lv.chapter != null ? '第 ' + lv.chapter + ' 章 · ' : '') + 'Lv-' + lv.id }),
						h('div', { key: 'nm', className: 'nm', children: lv.name }),
						h('div', { key: 'tg', className: 'tg', children: lv.tagline }),
						h('div', { key: 'sz', className: 'sz', children: '战场 ' + (lv.world?.w ?? 840) + ' × ' + (lv.world?.h ?? 520) }),
					] }); }) }),
				h('button', { key: 'back', className: 'dsh-vs-btn ghost', onClick: onBack, children: '← 返回' }),
			] });
		}

		/** P3 通关结算覆盖层：翻卡（免费 1 + 金币加翻 1）→ 全揭晓 → 返回/再刷 */
		function ClearPanel({ snap, character, story, send, onExit, onRetry }) {
			const cards = snap.cards;
			const [clicked, setClicked] = useState([]);
			const [revealed, setRevealed] = useState(false);
			if (!cards) return null;
			const picked = cards.picked ?? [];
			const allowance = 1 + (cards.extraUsed ? 1 : 0);
			const canFlipMore = !revealed && picked.length < allowance;
			const gold = Number(character?.gold) || 0;
			const extraCost = cards.extraCost ?? 300;
			const cardInfo = (c) => {
				if (c.kind === 'gold') return { emoji: '💰', name: c.amount + ' 金币', desc: '直接入账' };
				const m = itemMeta(c.item);
				return { emoji: m.icon, iconUrl: m.iconUrl, name: m.name, desc: m.desc };
			};
			const flip = (i) => {
				if (!canFlipMore || clicked.includes(i) || picked.includes(i)) return;
				setClicked((prev) => [...prev, i]);
				send({ kind: ClientMsg.FLIP_PICK, index: i });
			};
			const buyExtra = () => {
				if (!canFlipMore || cards.extraUsed || gold < extraCost) return;
				send({ kind: ClientMsg.FLIP_EXTRA });
			};
			return hs('div', { className: 'dsh-vs-cover', children: [
				h('h2', { key: 'h', children: cards.firstClear ? '🎉 关卡通过！首通达成' : '🎉 关卡通过！' }),
				cards.firstClear && cards.firstClearGold ? h('div', { key: 'fc', style: { color: '#3ddc84', fontSize: 13 }, children: '✨ 首通奖励 +' + cards.firstClearGold + ' 金币（已入账）' }) : null,
				story && story.artPost ? h('img', { key: 'art', src: '/vs-game/' + story.artPost, alt: '通关', style: { width: 190, borderRadius: 12, boxShadow: '0 6px 24px rgba(0,0,0,.5)' } }) : null,
				h('div', { key: 'tip', className: 'sub', children: revealed ? '全部揭晓完毕。' : canFlipMore ? (picked.length === 0 ? '翻一张免费牌，或花金币加翻一张。' : '还能翻 ' + (allowance - picked.length) + ' 张。') : '次数用完了，直接揭晓吧。' }),
				hs('div', { key: 'row', className: 'dsh-vs-fliprow', children: cards.cards.map((c, i) => {
					const isPicked = picked.includes(i);
					const show = revealed || isPicked;
					const cls = 'dsh-vs-fcard' + ((clicked.includes(i) || revealed) ? ' flipped' : '') + (revealed && !isPicked ? ' dim' : '');
					const info = cardInfo(c);
					return h('div', { key: i, className: cls, onClick: () => flip(i), children: [
						hs('div', { className: 'inner', children: [
							hs('div', { key: 'b', className: 'face back', children: [
								h('div', { key: 'w', children: '🐟' }),
								h('div', { key: 'q', style: { color: '#6b7084', fontSize: 22 }, children: '?' }),
							] }),
							hs('div', { key: 'f', className: 'face front', children: [
								show ? (info.iconUrl
									? h('img', { key: 'i', src: info.iconUrl, alt: info.name, style: { width: 44, height: 44, imageRendering: 'pixelated' } })
									: h('div', { key: 'i', className: 'fv', children: info.emoji }))
									: h('div', { key: 'i', className: 'fv', children: '…' }),
								show ? h('div', { key: 'n', className: 'fn', children: info.name }) : null,
								show ? h('div', { key: 'd', className: 'fd', children: info.desc }) : null,
							] }),
						] }),
					] });
				}) }),
				!revealed ? hs('div', { key: 'btns', style: { display: 'flex', gap: 10, alignItems: 'center' }, children: [
					h('button', {
						key: 'x', className: 'dsh-vs-btn ghost',
						disabled: !canFlipMore || cards.extraUsed || gold < extraCost,
						style: (!canFlipMore || cards.extraUsed || gold < extraCost) ? { opacity: 0.4, cursor: 'default' } : undefined,
						onClick: buyExtra,
						children: '💰 加翻一张（' + extraCost + ' 金币）',
					}),
					h('button', { key: 'r', className: 'dsh-vs-btn', onClick: () => setRevealed(true), children: '揭晓全部 →' }),
				] }) : hs('div', { key: 'btns2', style: { display: 'flex', gap: 10 }, children: [
					h('button', { key: 'm', className: 'dsh-vs-btn', onClick: onExit, children: '返回菜单' }),
					h('button', { key: 'a', className: 'dsh-vs-btn ghost', onClick: onRetry, children: '再刷一遍' }),
				] }),
				h('div', { key: 'gold', className: 'dsh-vs-credit', children: '当前金币：' + gold }),
			] });
		}

		/** 游戏窗口：canvas + HUD + 各阶段覆盖层 */
		function GameWindow({ onClose, wsStatus, send, helloRef, character, goldEarned, levels }) {
			const canvasRef = useRef(null);
			const engineRef = useRef(null);
			const [snap, setSnap] = useState(null);
			const [activeLevelId, setActiveLevelId] = useState(null); // null = 无尽

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

			// ── 设置弹窗（经 host HTTP 读写 settings namespace） ──
			const [cfgOpen, setCfgOpen] = useState(false);
			const [cfg, setCfg] = useState(null);
			useEffect(() => {
				fetch('/vs-game/config').then((r) => r.json()).then((d) => setCfg(d.config)).catch(() => {});
			}, []);
			const patchCfg = (patch) => {
				fetch('/vs-game/config', {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(patch),
				}).then((r) => r.json()).then((d) => { if (d.config) setCfg(d.config); }).catch(() => {});
			};

			// ── 选关面板 ──
			const [selectOpen, setSelectOpen] = useState(false);
			// ── 图鉴弹窗 ──
			const [pediaOpen, setPediaOpen] = useState(false);
			const [pediaTab, setPediaTab] = useState('weapon'); // 'weapon' | 'enemy'
			// ── 角色界面 ──
			const [charOpen, setCharOpen] = useState(false);

			// 开始游戏前把最新角色数据（初始武器/初始被动）同步给引擎
			const startGame = (lv) => {
				const engine = engineRef.current;
				if (!engine) return;
				engine.loadLevel(lv ?? null);
				setActiveLevelId(lv?.id ?? null);
				if (character) engine.applyCharacter(character);
				engine.start();
				setSnap(engine.snapshot());
			};
			const activeLevel = (levels ?? []).find((l) => l.id === activeLevelId) ?? null;
			const retryGame = () => startGame(activeLevel);

			// 引擎生命周期
			useEffect(() => {
				const canvas = canvasRef.current;
				if (!canvas) return;
				const dpr = Math.min(window.devicePixelRatio || 1, 2);
				canvas.width = GAME_W * dpr;
				canvas.height = GAME_H * dpr;
				const engine = new GameEngine(canvas, { sendWs: send });
				engineRef.current = engine;
				// 若 WebSocket 的 HELLO 在窗口/引擎创建前已到达，补放一次持久化数据
				const hello = helloRef?.current;
				if (hello) engine.handleHostMsg(hello);
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
					hs('div', { key: 'l', className: 'dsh-vs-head-left', children: [
						h('button', { key: 'ch', className: 'dsh-vs-iconbtn', title: '角色', onClick: () => setCharOpen(true), children: '👤' }),
						h('span', { key: 't', className: 'dsh-vs-title', children: '🐟 工作中的大肥鱼' }),
					] }),
					hs('div', { key: 'r', className: 'dsh-vs-head-right', children: [
						h('span', { key: 'd', className: 'dsh-vs-dot ' + (wsStatus === 'open' ? 'ok' : wsStatus === 'closed' ? 'bad' : 'wait'), title: '工作事件通道' }),
						h('button', { key: 'g', className: 'dsh-vs-iconbtn', title: '设置', onClick: () => setCfgOpen((o) => !o), children: '⚙' }),
						h('button', { key: 'min', className: 'dsh-vs-iconbtn', title: '关闭面板', onClick: onClose, children: '—' }),
						h('button', { key: 'x', className: 'dsh-vs-iconbtn', title: '关闭', onClick: onClose, children: '✕' }),
					] }),
				] }),
				cfgOpen && cfg ? hs('div', { key: 'pop', className: 'dsh-vs-pop', children: [
					h('label', { key: 'ap', children: [
						h('span', { key: 't', children: '脱离 DSH 时自动暂停' }),
						h('input', { key: 'i', type: 'checkbox', checked: !!cfg.autoPause, onChange: (e) => patchCfg({ autoPause: e.target.checked }) }),
					] }),
					h('label', { key: 'df', children: [
						h('span', { key: 't', children: '难度' }),
						h('select', { key: 's', value: cfg.difficulty ?? 'normal', onChange: (e) => patchCfg({ difficulty: e.target.value }), children: [
							h('option', { key: 'e', value: 'easy', children: '简单' }),
							h('option', { key: 'n', value: 'normal', children: '普通' }),
							h('option', { key: 'h', value: 'hard', children: '困难' }),
						] }),
					] }),
					h('label', { key: 'ir', children: [
						h('span', { key: 't', children: '保底刷怪间隔(秒)' }),
						h('input', { key: 'i', type: 'number', min: 1, max: 10, value: cfg.idleSpawnRate ?? 3, onChange: (e) => patchCfg({ idleSpawnRate: Number(e.target.value) || 3 }) }),
					] }),
				] }) : null,
				hs('div', { key: 'stage', className: 'dsh-vs-stage', children: [
					h('canvas', { key: 'cv', ref: canvasRef, style: { width: GAME_W, height: GAME_H } }),
					s && s.phase !== 'menu' ? h(Hud, { key: 'hud', snap: s }) : null,
					s && s.phase === 'playing' && s.activeSkill ? h('button', {
						key: 'skill',
						className: 'dsh-vs-skill-btn' + (s.activeSkill.timer > 0 ? ' on' : ''),
						onClick: () => engineRef.current?.activateActiveSkill(),
						children: s.activeSkill.timer > 0
							? (s.activeSkill.icon + ' ' + s.activeSkill.name + ' ' + Math.ceil(s.activeSkill.timer) + 's · 移动 ' + s.activeSkill.teleportsLeft + '/' + s.activeSkill.maxTeleports)
							: s.activeSkill.cd > 0
								? (s.activeSkill.icon + ' ' + s.activeSkill.name + ' ' + Math.ceil(s.activeSkill.cd) + 's')
								: (s.activeSkill.icon + ' ' + s.activeSkill.name + '（E）'),
					}) : null,
					s && s.phase === 'playing' && !s.focused ? h('div', { key: 'kh', className: 'dsh-vs-keys', children: [
						h('button', { key: 'b', onClick: () => engineRef.current?.focusCanvas(), children: '🎮 点我接管键盘（WASD 移动）' }),
					] }) : null,
					s && s.phase === 'playing' && s.focused ? h('div', { key: 'fh', className: 'dsh-vs-focus-hint', children: 'WASD/方向键移动 · Esc 释放键盘 · P 暂停' }) : null,
					(!s || s.phase === 'menu') && !selectOpen ? hs('div', { key: 'menu', className: 'dsh-vs-cover', children: [
						h('h2', { key: 'h', children: '🐟 工作中的大肥鱼' }),
						h('div', { key: 'sub', className: 'sub', children: '文件是敌人，token 是经验。Agent 干活时刷文件怪、回合结束清场掉经验雨；没活干时待机刷怪保底。WASD 移动，武器全自动，升级三选一，满级+被动可进化超武。' }),
						s?.best ? h('div', { key: 'best', style: { color: '#ffd54f', fontSize: 14 }, children: '🏆 最高分 ' + s.best }) : null,
						hs('div', { key: 'btns', style: { display: 'flex', gap: 12, alignItems: 'center' }, children: [
							h('button', {
								key: 'work', className: 'dsh-vs-btn',
								disabled: !levels || levels.length === 0,
								title: levels ? '推剧情关卡' : '等待关卡数据…',
								onClick: () => setSelectOpen(true),
								children: '💼 上班去',
							}),
							h('button', { key: 'endless', className: 'dsh-vs-btn ghost', onClick: () => startGame(null), children: '🪙 随便打打' }),
						] }),
						h('button', {
							key: 'dex',
							className: 'dsh-vs-btn ghost',
							onClick: () => { setPediaOpen(true); setPediaTab('weapon'); },
							children: '📖 图鉴（敌人 ' + (s?.discovered?.length ?? 0) + '/' + Object.keys(ENEMY_TYPES).length + '）',
						}),
						h('div', { key: 'cr', className: 'dsh-vs-credit', children: '角色素材：whale-girl（MIT · 画师 ZipZipPipe）' }),
					] }) : null,
					selectOpen ? h(LevelSelect, {
						key: 'select', levels: levels ?? [], character,
						onPick: (lv) => { setSelectOpen(false); startGame(lv); },
						onBack: () => setSelectOpen(false),
					}) : null,
					s && s.phase === 'paused' ? hs('div', { key: 'pause', className: 'dsh-vs-cover', children: [
						h('h2', { key: 'h', children: '⏸ 已暂停' }),
						h('button', { key: 'r', className: 'dsh-vs-btn', onClick: () => engineRef.current?.resume(), children: '继续（P）' }),
						h('button', { key: 'q', className: 'dsh-vs-btn ghost', onClick: () => { engineRef.current?.abandonRun(); setSnap(engineRef.current?.snapshot()); }, children: '放弃并结算' }),
					] }) : null,
					s && s.phase === 'levelup' && s.choices ? h(LevelUpCards, {
						key: 'lv',
						choices: s.choices,
						onPick: (i) => engineRef.current?.applyChoice(i),
						onDefer: () => engineRef.current?.deferChoice(),
					}) : null,
					s && (s.phase === 'playing' || s.phase === 'paused') && s.pendingChoices ? h('button', {
						key: 'openPending',
						className: 'dsh-vs-defer',
						onClick: () => engineRef.current?.openPendingChoice(),
						children: '⏳ 待选升级',
					}) : null,
					s && s.phase === 'clear' && s.cards ? h(ClearPanel, {
					key: 'clear', snap: s, character,
					story: activeLevel?.story ?? null,
					send,
					onExit: () => { const en = engineRef.current; en?.reportClearSettlement(); if (en) { en.reset(); setSnap(en.snapshot()); } },
					onRetry: () => { engineRef.current?.reportClearSettlement(); retryGame(); },
				}) : null,
				s && s.phase === 'gameover' ? hs('div', { key: 'over', className: 'dsh-vs-cover', children: [
						h('h2', { key: 'h', children: '💤 下班了' }),
						h('div', { key: 'st', className: 'dsh-vs-stats', children: [
							h('div', { key: 't', children: [h('b', { key: 'v', children: fmtTime(s.elapsed) }), '存活'] }),
							h('div', { key: 'k', children: [h('b', { key: 'v', children: String(s.kills) }), '击杀'] }),
							h('div', { key: 'l', children: [h('b', { key: 'v', children: 'Lv.' + s.level }), '等级'] }),
							h('div', { key: 's', children: [h('b', { key: 'v', children: String(s.score) }), '分数'] }),
							h('div', { key: 'g', children: [h('b', { key: 'v', children: '+' + (goldEarned || 0) }), '金币'] }),
						] }),
						s.best != null ? h('div', { key: 'best', className: 'sub', children: '最佳纪录：' + s.best }) : null,
						h('button', { key: 'again', className: 'dsh-vs-btn', onClick: () => retryGame(), children: '再来一局' }),
						h('button', { key: 'menu', className: 'dsh-vs-btn ghost', onClick: () => { engineRef.current?.reset(); setSnap(engineRef.current.snapshot()); }, children: '返回菜单' }),
					] }) : null,
				] }),
				pediaOpen ? h(PediaModal, { key: 'pedia', snap: s, tab: pediaTab, setTab: setPediaTab, onClose: () => setPediaOpen(false) }) : null,
				charOpen ? h(CharacterModal, { key: 'char', character, goldEarned, send, onClose: () => setCharOpen(false) }) : null,
			] });
		}

		// host 消息转发目标（useGameWs 在根组件，引擎在游戏窗口内）
		const gameMsgTarget = { engine: null };

		/** 根组件：入口按钮 + 窗口开关 + WS 接入 */
		function VsGameRoot() {
			const [open, setOpen] = useState(false);
			const [character, setCharacter] = useState(null);
			const [goldEarned, setGoldEarned] = useState(0);
			const [levels, setLevels] = useState(null);
			const helloRef = useRef(null); // 缓存 HELLO，防止窗口未打开时丢失持久化图鉴/最高分
			const onMsgRef = useRef(null);
			onMsgRef.current = (msg) => {
				if (msg.kind === HostMsg.TOGGLE_PANEL) { setOpen((o) => !o); return; }
				if (msg.kind === HostMsg.HELLO) {
					helloRef.current = msg;
					if (msg.character) setCharacter(msg.character);
					if (Array.isArray(msg.levels)) setLevels(msg.levels);
				}
				if (msg.kind === HostMsg.SAVED) {
					if (msg.character) setCharacter(msg.character);
					setGoldEarned(Number(msg.goldEarned) || 0);
				}
				if (msg.kind === HostMsg.CHARACTER) {
					if (msg.character) setCharacter(msg.character);
				}
				const ref = gameMsgTarget.engine;
				if (ref?.current) ref.current.handleHostMsg(msg);
			};
			const { status, send } = useGameWs(onMsgRef);
			useEffect(() => { ensureSprites(); }, []);

			return hs('div', { className: 'dsh-vs-root', children: [
				open ? h(GameWindow, { key: 'win', onClose: () => setOpen(false), wsStatus: status, send, helloRef, character, goldEarned, levels }) : null,
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
