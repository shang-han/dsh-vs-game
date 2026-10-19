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
 *   [3b] 开场动画播放器（IntroPlayer，标题流程用）
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
		let { useCallback, useContext, useEffect, useRef, useState } = react;
		let { jsx: h, jsxs: hs } = require('react/jsx-runtime');
		// 统一封装 <img>：Chromium 里 img 默认可拖拽，按住拖会把图片拖成 OS 文件（相当于复制出去），
		// 所以游戏内所有图片一律 draggable:false（CSS 里另有 -webkit-user-drag:none 兜底）
		const IMG = (props) => h('img', { draggable: false, ...props });

		// ════════════════════════════════════════════════════════════════════
		// [1] 协议常量（host lib/protocol.js 的内联副本，两处必须同步）
		// ════════════════════════════════════════════════════════════════════
		const HostMsg = {
			HELLO: 'hello', SPAWN: 'spawn', DROP_XP: 'drop-xp',
			WAVE_START: 'wave-start', WAVE_CLEAR: 'wave-clear',
			BOSS_SPAWN: 'boss-spawn', BUFF: 'buff', SCREEN_NUKE: 'screen-nuke',
			IDLE_SPAWN: 'idle-spawn', IDLE_BOSS: 'idle-boss',
			CONFIG: 'config', TOGGLE_PANEL: 'toggle-panel', SAVED: 'saved', CHARACTER: 'character',
			CARDS: 'cards', CARD_RESULT: 'card-result', HOME_MESSAGE: 'home-message',
			SAVE_SLOTS: 'save-slots',
		};
		const ClientMsg = {
			GAME_START: 'game-start', GAME_OVER: 'game-over', HEARTBEAT: 'heartbeat',
			SET_INITIAL_WEAPON: 'set-initial-weapon', UPGRADE_PASSIVE: 'upgrade-passive', OPEN_ITEM: 'open-item', EQUIP_SKILL: 'equip-skill',
			CHEST_LOOT: 'chest-loot', BOSS_KILL: 'boss-kill', FLIP_PICK: 'flip-pick', FLIP_EXTRA: 'flip-extra',
			CRAFT_ITEM: 'craft-item', SELL_ITEM: 'sell-item', BUY_ITEM: 'buy-item', LEVEL_SHOP_BUY: 'level-shop-buy',
			EQUIP_ACCESSORY: 'equip-accessory', UNEQUIP_ACCESSORY: 'unequip-accessory',
			PLACE_CHEST: 'place-chest', EJECT_CONTAINER_ITEM: 'eject-container-item', UPGRADE_CHEST: 'upgrade-chest', REMOVE_CHEST: 'remove-chest', PICKUP_GROUND: 'pickup-ground', UNLOCK_ROOM: 'unlock-room', USE_BAIT: 'use-bait', DROP_GROUND: 'drop-ground', AGENT_PICKUP: 'agent-pickup', AGENT_DELIVER: 'agent-deliver', CHEST_TRANSFER: 'chest-transfer', SET_CRAFTING_STORAGE: 'set-crafting-storage',
			BUILD_PLACE: 'build-place', CHOP_TREE: 'chop-tree', BUILD_FINISH: 'build-finish', GATHER: 'gather', ENCHANT: 'enchant', HIRE_AGENT: 'hire-agent', SET_AGENT_TASK: 'set-agent-task',
			MOVE_HOME_ITEM: 'move-home-item', DEMOLISH_HOME_ITEM: 'demolish-home-item',
			SAVE_LIST: 'save-list', SAVE_SELECT: 'save-select', SAVE_NEW: 'save-new', INTRO_SEEN: 'intro-seen',
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
			// ⚠️ @import 必须是样式表第一条才生效，永远保持在数组第一个元素
			'@import url("https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap");',
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
			// 窗口边缘缩放：隐藏感应区，鼠标放边缘变缩放光标直接拉（无任何可见手柄）
			'.dsh-vs-resize-r{position:absolute;right:0;top:0;bottom:0;width:7px;cursor:ew-resize;z-index:33;}',
			'.dsh-vs-resize-b{position:absolute;left:0;right:0;bottom:0;height:7px;cursor:ns-resize;z-index:33;}',
			'.dsh-vs-resize-l{position:absolute;left:0;top:0;bottom:0;width:7px;cursor:ew-resize;z-index:33;}',
			'.dsh-vs-resize-t{position:absolute;left:0;right:0;top:0;height:7px;cursor:ns-resize;z-index:33;}',
			'.dsh-vs-resize-c{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:33;}',
			// 战场区（canvas 已 display:block 消除底部空隙，不要在此设 line-height:0，
			// 否则覆盖层里的多行文字会叠成一行）
			'.dsh-vs-win-hidden{display:none !important;}',
			'.dsh-vs-stage{position:relative;}',
			'.dsh-vs-editbar{position:absolute;left:50%;transform:translateX(-50%);bottom:64px;z-index:9;display:flex;align-items:center;gap:8px;pointer-events:auto;background:rgba(20,22,31,.94);border:1px solid #4f6ef7;border-radius:12px;padding:8px 14px;color:#e6e8f0;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.5);}',
			'.dsh-vs-editbar .nm{color:#ffd54f;font-weight:700;}',
			'.dsh-vs-edit-toggle{position:absolute;left:10px;top:8px;z-index:9;pointer-events:auto;padding:6px 12px;border-radius:10px;background:rgba(20,22,31,.92);border:1px solid #2a2e3d;color:#cfd3e4;font-size:13px;font-weight:700;cursor:pointer;}',
			'.dsh-vs-edit-toggle:hover{border-color:#4f6ef7;color:#fff;}',
			'.dsh-vs-edit-toggle.on{background:#4f6ef7;border-color:#4f6ef7;color:#fff;}',
			'.dsh-vs-edit-toggle.dispatch{top:44px;border-color:#3f6b46;color:#7fe08a;}',
			'.dsh-vs-edit-toggle.dispatch:hover{border-color:#3ddc84;color:#fff;background:rgba(38,80,52,.9);}',
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
			'.dsh-vs-skip-boss{position:absolute;right:10px;top:76px;z-index:12;pointer-events:auto;padding:4px 10px;font-size:12px;}',
			'.dsh-vs-defer{position:absolute;right:10px;top:96px;z-index:5;background:rgba(20,22,31,.92);color:#ffd54f;border:1px solid #7c5cfc;border-radius:10px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;pointer-events:auto;box-shadow:0 6px 18px rgba(0,0,0,.35);}',
			'.dsh-vs-defer:hover{filter:brightness(1.12);}',
			'.dsh-vs-skill-btn{position:absolute;right:10px;bottom:50px;z-index:6;background:rgba(20,22,31,.92);color:#aab0c4;border:1px solid #2a2e3d;border-radius:10px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;pointer-events:auto;}',
			'.dsh-vs-skill-btn.has-e{padding-right:30px;}',
			'.dsh-vs-skill-btn-home{bottom:132px;}',
			'.dsh-vs-skill-btn.has-e::after{content:"E";position:absolute;right:-7px;top:-7px;width:20px;height:20px;border-radius:50%;background:#0e1017;border:1px solid #4f6ef7;color:#cfd3e4;font-size:11px;line-height:18px;text-align:center;font-weight:700;}',
			'.dsh-vs-skill-btn.on{border-color:#ff6b9d;color:#ffd0e0;box-shadow:0 0 12px rgba(255,107,157,.35);}',
			'.dsh-vs-skill-btn:hover{border-color:#ff6b9d;color:#fff;}',
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
			'.dsh-vs-fcard .fprice{font-size:13px;font-weight:700;color:#ffd54f;background:rgba(0,0,0,.35);border-radius:8px;padding:2px 8px;}',
			'.dsh-vs-fcard .fprice.poor{color:#ff8a80;}',
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
			'.dsh-vs-pop{position:absolute;top:42px;right:10px;z-index:40;width:230px;background:#161926;border:1px solid #2a2e3d;',
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
			'.dsh-vs-item.white{border-color:#fff;box-shadow:0 0 8px rgba(255,255,255,.25);}',
			'.dsh-vs-item.white.selected{border-color:#ffd54f;box-shadow:0 0 10px rgba(255,213,79,.3);}',
			'.dsh-vs-item-detail{margin-top:8px;padding:8px 10px;border:1px solid #2a2e3d;border-radius:8px;background:#0e1017;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;}',
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
			// 画廊
			'.dsh-vs-gallery{position:absolute;inset:0;z-index:22;display:flex;align-items:center;justify-content:center;background:rgba(8,10,16,.76);padding:24px;pointer-events:auto;}',
			'.dsh-vs-gallery-box{width:min(820px,calc(100% - 20px));max-height:calc(100% - 40px);background:#161926;border:1px solid #2a2e3d;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;}',
			'.dsh-vs-gallery-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #2a2e3d;}',
			'.dsh-vs-gallery-grid{flex:1;overflow-y:auto;padding:14px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;align-content:start;}',
			'.dsh-vs-gallery-card{background:#0e1017;border:1px solid #2a2e3d;border-radius:10px;padding:10px;text-align:center;}',
			'.dsh-vs-gallery-card.locked{opacity:.5;filter:grayscale(.7);}',
			'.dsh-vs-gallery-card img{width:100%;border-radius:8px;}',
			'.dsh-vs-gallery-card .gname{font-size:13px;font-weight:700;margin-top:8px;color:#e6e8f0;}',
			'.dsh-vs-gallery-card .glock{font-size:12px;color:#8a8fa3;margin-top:8px;}',
			// Boss 房间 Galgame 对话
			'.dsh-vs-dialog{position:absolute;left:0;right:0;bottom:16px;z-index:8;margin:0 16px;padding:16px 20px 12px;',
			'  background:rgba(10,12,18,.9);border:1px solid #2a2e3d;border-radius:12px;color:#e6e8f0;',
			'  pointer-events:auto;cursor:pointer;box-shadow:0 -6px 24px rgba(0,0,0,.4);}',
			'.dsh-vs-dialog-speaker{font-size:12px;color:#9d6bff;font-weight:700;margin-bottom:4px;}',
			'.dsh-vs-dialog-text{font-size:15px;line-height:1.7;}',
			'.dsh-vs-dialog-hint{margin-top:8px;font-size:11px;color:#5a6072;text-align:right;}',
			// 独立版：直接铺满窗口，不做嵌套窗口
			'.dsh-vs-standalone{position:absolute!important;left:0!important;top:0!important;width:100%!important;height:100%!important;transform:none!important;border:none!important;border-radius:0!important;}',
			'.dsh-vs-standalone .dsh-vs-head{cursor:default;min-width:0;}',
			'.dsh-vs-standalone .dsh-vs-head [title="关闭面板"],.dsh-vs-standalone .dsh-vs-head [title="关闭"]{display:none!important;}',
			'.dsh-vs-standalone .dsh-vs-stage{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;}',
			'.dsh-vs-standalone .dsh-vs-stage canvas{max-width:100%;max-height:100%;}',
			// ── 标题流程：开场动画 / 标题菜单 / 存档槽（.dsh-vs-ts-*，盖住 stage 上所有东西）──
			'.dsh-vs-ts-layer{position:absolute;inset:0;z-index:30;background:#0b0d13;overflow:hidden;pointer-events:auto;',
			'  font-family:"ZCOOL KuaiLe","Microsoft YaHei",sans-serif;color:#e3e9ff;}',
			'.dsh-vs-ts-cv{display:block;width:100%;height:100%;}',
			// 标题/存档槽叠在开场动画的活水画面上：标题层透明，存档槽轻压暗
			'.dsh-vs-ts-over-title{z-index:31;background:transparent;}',
			'.dsh-vs-ts-over-slots{z-index:32;background:rgba(4,6,14,.45);}',
			'.dsh-vs-ts-skip{position:absolute;left:0;right:0;bottom:10px;text-align:center;color:#7f8ab3;font-size:12px;letter-spacing:2px;',
			'  pointer-events:none;text-shadow:0 1px 3px #000;}',
			'.dsh-vs-ts-home{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}',
			'.dsh-vs-ts-gtitle{font-size:72px;color:#ffe9a8;letter-spacing:8px;white-space:nowrap;',
			'  text-shadow:0 5px 0 #1b2350,0 0 30px rgba(110,140,255,.6);',
			'  animation:dsh-vs-ts-pop .7s cubic-bezier(.2,1.7,.4,1) both,dsh-vs-ts-floaty 3.2s ease-in-out 1.1s infinite;}',
			'@keyframes dsh-vs-ts-pop{0%{transform:scale(.15) rotate(-8deg);opacity:0}55%{transform:scale(1.14) rotate(2deg);opacity:1}100%{transform:scale(1) rotate(0);opacity:1}}',
			'@keyframes dsh-vs-ts-floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}',
			'.dsh-vs-ts-menu{margin-top:40px;display:flex;flex-direction:column;gap:18px;align-items:center;}',
			'.dsh-vs-ts-mi{pointer-events:auto;font-size:32px;letter-spacing:6px;color:#e3e9ff;cursor:pointer;padding:2px 22px;',
			'  text-shadow:0 3px 0 #141a3a;opacity:0;animation:dsh-vs-ts-miin .4s ease both;animation-delay:var(--d,0s);}',
			'@keyframes dsh-vs-ts-miin{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}',
			'.dsh-vs-ts-mi .in{display:inline-block;transition:color .18s,transform .18s,text-shadow .18s;}',
			'.dsh-vs-ts-mi:hover .in{color:#ffd54f;transform:scale(1.08);text-shadow:0 3px 0 #141a3a,0 0 18px rgba(255,213,79,.45);}',
			'.dsh-vs-ts-mi .in span{display:inline-block;}',
			'.dsh-vs-ts-mi:hover .in span{animation:dsh-vs-ts-wave .55s ease infinite;animation-delay:calc(var(--i)*60ms);}',
			'@keyframes dsh-vs-ts-wave{0%,100%{transform:translateY(0) scale(1)}35%{transform:translateY(-8px) scale(1.15)}65%{transform:translateY(3px) scale(.98)}}',
			'.dsh-vs-ts-activeslot{position:absolute;left:0;right:0;bottom:14px;text-align:center;color:#7f8ab3;font-size:13px;letter-spacing:2px;pointer-events:none;}',
			'.dsh-vs-ts-slots{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(8,10,22,.78);}',
			'.dsh-vs-ts-slot-title{font-size:36px;color:#ffe9a8;letter-spacing:6px;margin-bottom:18px;text-shadow:0 4px 0 #1b2350;}',
			'.dsh-vs-ts-slot-list{display:flex;flex-direction:column;align-items:center;}',
			'.dsh-vs-ts-slot{width:520px;max-width:86%;box-sizing:border-box;margin:9px 0;padding:13px 20px;border:2px solid rgba(140,160,255,.35);',
			'  border-radius:14px;color:#e3e9ff;letter-spacing:2px;cursor:pointer;background:rgba(20,26,58,.6);text-align:left;',
			'  transition:transform .15s,border-color .15s,background .15s,box-shadow .15s;}',
			'.dsh-vs-ts-slot:hover{transform:translateY(-3px) scale(1.02);border-color:#ffd54f;background:rgba(30,38,80,.75);}',
			'.dsh-vs-ts-slot.empty{opacity:.55;}',
			'.dsh-vs-ts-slot.off,.dsh-vs-ts-slot.off:hover{cursor:not-allowed;transform:none;border-color:rgba(140,160,255,.35);background:rgba(20,26,58,.6);}',
			'.dsh-vs-ts-slot.confirm,.dsh-vs-ts-slot.confirm:hover{border-color:#ffd54f;background:rgba(66,52,14,.8);box-shadow:0 0 18px rgba(255,213,79,.35);}',
			'.dsh-vs-ts-slot .cap{font-size:23px;}',
			'.dsh-vs-ts-slot .line2{font-size:13px;color:#9aa4cc;letter-spacing:1px;margin-top:4px;font-family:system-ui,"Microsoft YaHei",sans-serif;}',
			'.dsh-vs-ts-slot.confirm .line2{color:#ffe9a8;}',
			'.dsh-vs-ts-back{margin-top:16px;color:#8a93b8;font-size:14px;font-family:system-ui,sans-serif;cursor:pointer;pointer-events:auto;}',
			'.dsh-vs-ts-back:hover{color:#dfe5ff;}',
			// 全局禁止原生拖拽（不然按住图片/文字会变成拖出一个 OS 副本），输入框放行
			'.dsh-vs-root,.dsh-vs-root *{-webkit-user-drag:none;}',
			// 图标、名字、描述都不能选中/复制（游戏里没必要），输入框例外
			'.dsh-vs-root,.dsh-vs-root *{-webkit-user-select:none;user-select:none;}',
			'.dsh-vs-root input,.dsh-vs-root textarea,.dsh-vs-root [contenteditable="true"]{-webkit-user-select:text;user-select:text;}',
			'.dsh-vs-root img{-webkit-user-drag:none;user-select:none;}',
			'.dsh-vs-root input,.dsh-vs-root textarea,.dsh-vs-root [contenteditable="true"]{-webkit-user-drag:auto;}',
		].join('\n');
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-vs-game';
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		// 全局拖拽兜底（插件插槽模式不走 mountGame，所以这里也要挂一份）
		if (typeof document !== 'undefined' && !document.__vsNoDrag) {
			document.__vsNoDrag = true;
			document.addEventListener('dragstart', (e) => {
				const t = e.target;
				if (!t || !t.closest || !t.closest('.dsh-vs-root')) return;
				if (t.closest('input, textarea, [contenteditable="true"]')) return;
				e.preventDefault();
			}, true);
			// 文字也不让复制/剪切出去（选中区域在游戏里才拦，输入框放行）
			const copyGuard = (e) => {
				let node = e.target;
				try {
					const sel = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
					if (sel && sel.rangeCount) node = sel.getRangeAt(0).commonAncestorContainer;
				} catch { /* noop */ }
				if (!node) return;
				if (node.nodeType === 3) node = node.parentNode;
				if (!node || !node.closest) return;
				if (node.closest('input, textarea, [contenteditable="true"]')) return;
				if (node.closest('.dsh-vs-root')) e.preventDefault();
			};
			document.addEventListener('copy', copyGuard, true);
			document.addEventListener('cut', copyGuard, true);
		}

		// ════════════════════════════════════════════════════════════════════
		// [3] 精灵系统 —— whale-girl sprite sheets（host 资源路由提供）
		// ════════════════════════════════════════════════════════════════════
		const SPRITE_BASE = '/vs-game/assets/whale-girl/';
		const SPRITE_VER = '?v=12';   // walk.png 又精修了一版，+1 让浏览器重新拉素材
		const spriteCache = { manifest: null, states: new Map(), failed: false, error: null, loaded: 0, total: 0 };
		const spriteListeners = new Set();
		function notifySpriteStatus() { for (const fn of spriteListeners) { try { fn(); } catch { /* noop */ } } }

		async function ensureSprites() {
			if (spriteCache.manifest || spriteCache.failed) return spriteCache.manifest;
			try {
				const res = await fetch(SPRITE_BASE + 'manifest.json' + SPRITE_VER);
				if (!res.ok) throw new Error('manifest HTTP ' + res.status);
				spriteCache.manifest = await res.json();
				const states = spriteCache.manifest?.characters?.['whale-girl']?.states ?? {};
				spriteCache.total = Object.keys(states).length;
				notifySpriteStatus();
				for (const [stateName, info] of Object.entries(states)) {
					const img = new Image();
					img.src = SPRITE_BASE + info.sheet + SPRITE_VER;
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
			if (Array.isArray(info.durations) && info.durations.length > 0) {
				let acc = 0;
				for (let i = 0; i < info.durations.length; i++) {
					acc += info.durations[i];
					if (t < acc) return Math.min(i, n - 1);
				}
				return Math.min(n - 1, info.durations.length - 1);
			}
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

		// ── 子代理（第 4 关）：精灵图加载 + 绘制 ──
		const SUB_SPRITE_BASE = '/vs-game/assets/sub-agent/';
		const SUB_SHEETS = {
			walk:  { file: 'walk.png',  frames: 8, fps: 12 },
			idle:  { file: 'idle.png',  frames: 5, fps: 2.2 },
			carry: { file: 'carry.png', frames: 3, fps: 9 },
			work:  { file: 'work.png',  frames: 6, fps: 6, from: 3 },   // 只循环后 3 帧（0-based 3~5）
		};
		const subSprites = { started: false, states: new Map() };
		function ensureSubSprites() {
			if (subSprites.started) return;
			subSprites.started = true;
			for (const [name, info] of Object.entries(SUB_SHEETS)) {
				const img = new Image();
				const rec = { img, ...info, ready: false };
				subSprites.states.set(name, rec);
				img.onload = () => { rec.ready = true; rec.frameW = img.naturalWidth / info.frames; rec.frameH = img.naturalHeight; };
				img.src = SUB_SPRITE_BASE + info.file;
			}
		}
		function drawSubSprite(ctx2d, stateName, t, cx, cy, size, flip, frameIdx) {
			const rec = subSprites.states.get(stateName) ?? subSprites.states.get('idle');
			if (!rec || !rec.ready) return false;
			const frames = Math.max(1, rec.frames || 1);
			// from/to：只循环某几帧（如 work 只播后 3 帧）
			const first = Math.max(0, Math.min(frames - 1, Number.isFinite(rec.from) ? rec.from : 0));
			const last = Math.max(first, Math.min(frames - 1, Number.isFinite(rec.to) ? rec.to : frames - 1));
			const span = last - first + 1;
			// frameIdx 传了就画指定帧（给「先播一遍完整动画、再进循环」用），否则按时间循环 first~last
			const idx = Number.isFinite(frameIdx)
				? Math.max(0, Math.min(frames - 1, Math.round(frameIdx)))
				: first + (Math.floor(t * (rec.fps || 8)) % span);
			const fw = rec.frameW || rec.img.naturalWidth / frames;
			const fh = rec.frameH || rec.img.naturalHeight;
			ctx2d.save();
			ctx2d.translate(cx, cy);
			if (flip) ctx2d.scale(-1, 1);
			ctx2d.drawImage(rec.img, idx * fw, 0, fw, fh, -size / 2, -size / 2, size, size);
			ctx2d.restore();
			return true;
		}

		// ════════════════════════════════════════════════════════════════════
		// [3b] 开场动画播放器 —— 移植自 plan/开场动画小样-src.html（v14 语义：
		//      走 → 发现白饭 → 开吃 → 惊！→ 被鱼群埋 → 水淹全蓝；素材走 URL 加载）
		// ════════════════════════════════════════════════════════════════════
		const INTRO_CFG = {
			W: 1280, H: 720, ground: 560,
			bowl: { x: 905, y: 552, w: 190 },
			hero: { h: 250, feetY: 552, homeX: 806 },
			bowlAt: 4.4,
			s1: { t0: 0.0, t1: 5.2, x0: -130, x1: 806, step: 0.8 },
			s2: { t0: 5.2, ding: 5.35, hopEnd: 6.05 },
			s3: { eatStart: 6.05, eatEnd: 7.55, shockEnd: 8.25, buryStart: 10.25, buried: 11.7 },
			s5: { t0: 12.2, full: 14.6 },
			titleAt: 14.9,
			end: 16.4,
		};
		// 鱼群批次（与源文件一致）
		const INTRO_BURSTS = [
			{ t: 6.55, n: 1, side: 'back' },
			{ t: 7.15, n: 2, side: 'sides' },
			{ t: 7.95, n: 5, side: 'bottom' },
			{ t: 8.75, n: 12, side: 'any' },
			{ t: 9.35, n: 12, side: 'any' },
			{ t: 9.95, n: 18, side: 'any' },
			{ t: 10.55, n: 24, side: 'any' },
			{ t: 11.15, n: 30, side: 'any' },
			{ t: 11.65, n: 30, side: 'any' },
		];
		const INTRO_CROWD_CAP = 170;
		const INTRO_PILE = { x: 855, y: 540 };
		const INTRO_SHEET_META = {
			walk: { n: 3, w: 256, h: 256, pp: true },   // 三帧 pingpong（0→1→2→1）
			joy: { n: 2, w: 256, h: 256 },
			eatFront: { n: 29, w: 192, h: 191 },
			subwalk: { n: 8, w: 256, h: 256 },
			error: { n: 2, w: 256, h: 256 },
		};
		const INTRO_SHEET_URLS = {
			walk: SPRITE_BASE + 'walk.png' + SPRITE_VER,
			joy: SPRITE_BASE + 'joy.png' + SPRITE_VER,
			eatFront: SPRITE_BASE + 'intro-eat-sheet.png' + SPRITE_VER,
			subwalk: SUB_SPRITE_BASE + 'walk.png',
			error: SPRITE_BASE + 'error.png' + SPRITE_VER,
		};
		const INTRO_RICE_URL = '/vs-game/assets/intro/rice.png';
		const introClamp = (v, a, b) => Math.max(a, Math.min(b, v));
		const introSmooth = (x) => { x = introClamp(x, 0, 1); return x * x * (3 - 2 * x); };

		class IntroPlayer {
			constructor(canvas) {
				this.cv = canvas;
				this.ctx = canvas.getContext('2d');
				this.imgs = {}; this.total = 0; this.loadedCount = 0; this.failCount = 0;
				this.ac = null; this.master = null;
				this.raf = 0; this.running = false;
				this.t = 0; this.tPrev = 0;
				this.burstIdx = 0; this.contAcc = 0; this.stepLast = 0; this.munchLast = 0;
				this.dingFired = false; this.shockFired = false;
				this.crowd = []; this.steam = []; this.bubbles = [];
				this.timers = new Set();
				this.onDone = null;   // 播满全片（水蓝结尾）时回调一次（切标题画面）
				this.doneFired = false;
				this._loop = (ts) => this.loop(ts);
				const list = [...Object.entries(INTRO_SHEET_URLS), ['rice', INTRO_RICE_URL]];
				this.total = list.length;
				for (const [key, url] of list) {
					const im = new Image();
					im.onload = () => { this.loadedCount++; };
					im.onerror = () => { this.loadedCount++; this.failCount++; }; // 失败也计入就绪：允许无声开播
					im.src = url;
					this.imgs[key] = im;
				}
			}
			later(fn, ms) {
				const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
				this.timers.add(id);
				return id;
			}
			/** 图片就绪后才开播；失败计入就绪，长时间挂起 10s 兜底强开（缺图静默画） */
			start() {
				if (this.running) return;
				if (this.loadedCount < this.total) {
					this._waited = (this._waited || 0) + 120;
					if (this._waited >= 10000) this.loadedCount = this.total;
					this.later(() => this.start(), 120);
					return;
				}
				this.running = true;
				this.initAudio();
				this.tPrev = 0;
				this.raf = requestAnimationFrame(this._loop);
			}
			/** 点击画面任意处跳过 → 直接跳到水蓝结尾（onDone 由循环在 end 处发一次） */
			skip() {
				if (this.running) this.t = Math.max(this.t, INTRO_CFG.end - 0.05);
			}
			/** 卸载时清理：rAF + 定时器 + AudioContext */
			stop() {
				this.running = false;
				this.onDone = null;
				if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
				for (const id of this.timers) clearTimeout(id);
				this.timers.clear();
				this.closeAudio();
			}
			loop(ts) {
				if (!this.running) return;
				if (!this.tPrev) this.tPrev = ts;
				const dt = Math.min(0.05, (ts - this.tPrev) / 1000);
				this.tPrev = ts;
				this.t += dt;
				if (this.t < INTRO_CFG.end) this.stepSim(dt);   // 播满全片；之后只留水面波动当标题背景
				this.stepBubbles(dt);                            // 气泡永续：播完后标题画面背后的水也一直在冒泡
				this.render();
				if (this.t >= INTRO_CFG.end && !this.doneFired) {
					this.doneFired = true;
					const cb = this.onDone;
					this.onDone = null;
					if (cb) { try { cb(); } catch { /* noop */ } }
				}
				this.raf = requestAnimationFrame(this._loop);   // 永续渲染：标题叠在活水画面上
			}
			// ── WebAudio 合成音效（惰性创建；任何失败都降级成无声，绝不抛错）──
			initAudio() {
				try {
					const Ctor = window.AudioContext || window.webkitAudioContext;
					if (!Ctor) return;
					if (!this.ac) {
						this.ac = new Ctor();
						this.master = this.ac.createGain();
						this.master.gain.value = 0.9;
						this.master.connect(this.ac.destination);
					}
					if (this.ac.state === 'suspended') this.ac.resume();
				} catch { this.ac = null; this.master = null; }
			}
			closeAudio() {
				try { if (this.ac && this.ac.close) this.ac.close(); } catch { /* noop */ }
				this.ac = null; this.master = null;
			}
			beep(freq, dur, vol, type, slideTo) {
				const ac = this.ac;
				if (!ac || !this.master) return;
				try {
					const o = ac.createOscillator();
					o.type = type || 'square';
					o.frequency.setValueAtTime(freq, ac.currentTime);
					if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
					const g = ac.createGain();
					g.gain.setValueAtTime(vol || 0.1, ac.currentTime);
					g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
					g.connect(this.master);
					o.connect(g);
					o.start(); o.stop(ac.currentTime + dur + 0.02);
				} catch { /* 无声 */ }
			}
			step() { this.beep(82 + Math.random() * 14, 0.055, 0.10, 'square'); }
			ding() { this.beep(988, 0.16, 0.09, 'sine'); this.later(() => this.beep(1319, 0.22, 0.08, 'sine'), 70); }
			tick() { this.beep(140 + Math.random() * 120, 0.03, 0.05, 'square'); }
			shock() { this.beep(760, 0.10, 0.12, 'square', 340); this.later(() => this.beep(300, 0.25, 0.10, 'sawtooth', 140), 90); }
			munch() { this.beep(160 + Math.random() * 40, 0.08, 0.07, 'triangle', 110); }
			// ── 模拟 ──
			heroX(tt) {
				const CFG = INTRO_CFG;
				if (tt < CFG.s1.t1) return CFG.s1.x0 + (CFG.s1.x1 - CFG.s1.x0) * (tt - CFG.s1.t0) / (CFG.s1.t1 - CFG.s1.t0);
				return CFG.s1.x1;
			}
			makeOne(side) {
				const r = Math.random, W = INTRO_CFG.W;
				let x, y;
				if (side === 'back') { x = INTRO_PILE.x + 40; y = INTRO_CFG.ground - 250; }
				else if (side === 'sides') { x = (r() < 0.5 ? -90 : W + 90); y = 470 + r() * 150; }
				else if (side === 'bottom') { x = 120 + r() * (W - 240); y = INTRO_CFG.H + 90; }
				else { const s = r(); x = s < 0.5 ? -90 - r() * 200 : W + 90 + r() * 200; y = 450 + r() * 200; }
				return { x, y, scale: 0.8 + (y - 440) / 220 * 0.4, speed: 70 + r() * 90, phase: r() * 10, stopR: 34 + r() * 80, wob: r() * 6.28 };
			}
			spawnBurst(b) {
				for (let i = 0; i < b.n; i++) {
					if (this.crowd.length >= INTRO_CROWD_CAP) return;
					this.crowd.push(this.makeOne(b.side));
				}
			}
			/** 水里的气泡：从水灌满那一刻起一直冒，播完后标题画面背后也不停（上限 110 颗防堆积） */
			stepBubbles(dt) {
				const CFG = INTRO_CFG, t = this.t;
				if (t < CFG.s5.t0) return;
				const k = introSmooth((t - CFG.s5.t0) / (CFG.s5.full - CFG.s5.t0));
				const surf = (CFG.H + 70) - k * (CFG.H + 130);   // 水面 y（灌满后为负，整屏都是水）
				const rate = t < CFG.s5.full ? 12 : 9;           // 每秒冒几颗
				if (this.bubbles.length < 150 && Math.random() < dt * rate) {
					const top = Math.max(surf, 0);
					this.bubbles.push({
						x: Math.random() * CFG.W,
						y: top + 30 + Math.random() * Math.max(40, CFG.H - top),
						r: 2 + Math.random() * 4,
						v: 40 + Math.random() * 50,
						wob: Math.random() * 6.28,
					});
				}
				for (let i = this.bubbles.length - 1; i >= 0; i--) {
					const b = this.bubbles[i];
					b.y -= b.v * dt;
					b.x += Math.sin(t * 2 + b.wob) * 7 * dt;     // 左右轻飘
					if (b.y < surf - 14) this.bubbles.splice(i, 1);   // 飘出水面/画面就消失
				}
			}
			stepSim(dt) {
				const CFG = INTRO_CFG, t = this.t;
				while (this.burstIdx < INTRO_BURSTS.length && t >= INTRO_BURSTS[this.burstIdx].t) {
					this.spawnBurst(INTRO_BURSTS[this.burstIdx]);
					this.burstIdx++;
				}
				if (t > 9.55 && this.crowd.length < INTRO_CROWD_CAP) {
					this.contAcc += dt * (8 + (t - 9.55) * 12);
					while (this.contAcc >= 1 && this.crowd.length < INTRO_CROWD_CAP) {
						this.contAcc--;
						this.crowd.push(this.makeOne('any'));
						if (Math.random() < 0.3) this.tick();
					}
				}
				const tighten = introClamp(1 - Math.max(0, t - 9.55) / 2.6 * 0.8, 0.25, 1);
				for (const c of this.crowd) {
					const dx = INTRO_PILE.x - c.x, dy = INTRO_PILE.y - c.y, d = Math.hypot(dx, dy);
					const stopR = c.stopR * tighten;
					if (d > stopR) { c.x += dx / d * c.speed * dt; c.y += dy / d * c.speed * dt * 0.55; }
					else { c.x += Math.sin(t * 7 + c.wob) * 10 * dt; c.y += Math.cos(t * 6 + c.wob) * 6 * dt; }
					c.phase += dt;
				}
				if (t >= CFG.bowlAt && t < CFG.s3.eatStart && Math.random() < dt * 14) {
					this.steam.push({ x: CFG.bowl.x - 45 + Math.random() * 90, y: CFG.bowl.y - CFG.bowl.w * 0.55, vy: -26 - Math.random() * 18, r: 2.5 + Math.random() * 4, a: 0.5 });
				}
				for (let i = this.steam.length - 1; i >= 0; i--) {
					const s = this.steam[i];
					s.y += s.vy * dt; s.x += Math.sin(t * 3 + s.y * 0.05) * 12 * dt; s.a -= dt * 0.30;
					if (s.a <= 0) this.steam.splice(i, 1);
				}
				if (!this.dingFired && t >= CFG.s2.ding) { this.dingFired = true; this.ding(); }
				if (!this.shockFired && t >= CFG.s3.eatEnd) { this.shockFired = true; this.shock(); }
				if (t >= CFG.s3.eatStart && t < CFG.s3.eatEnd && t - this.munchLast >= 0.45) { this.munchLast = t; this.munch(); }
				const walking = (t >= CFG.s1.t0 && t < CFG.s3.eatStart) && !(t >= CFG.s2.ding && t < CFG.s2.hopEnd);
				if (walking && t - this.stepLast >= CFG.s1.step) { this.stepLast = t; this.step(); }
			}
			// ── 绘制 ──
			drawSheet(key, phase, fps, x, y, h, flip, rot, yOff, alpha, sx, sy) {
				const m = INTRO_SHEET_META[key];
				const img = this.imgs[key];
				if (!m || !img || !img.complete || !img.naturalWidth) return; // 缺图静默
				let idx = Math.floor(phase * fps) % m.n;
				if (m.pp) { const pos = Math.floor(phase * fps) % (2 * m.n - 2); idx = pos < m.n ? pos : 2 * m.n - 2 - pos; }
				const w = h * (m.w / m.h);
				const ctx = this.ctx;
				ctx.save();
				ctx.globalAlpha = alpha == null ? 1 : alpha;
				ctx.translate(x, y + (yOff || 0));
				ctx.scale((flip ? -1 : 1) * (sx || 1), sy || 1);
				if (rot) ctx.rotate(rot);
				ctx.drawImage(img, idx * m.w, 0, m.w, m.h, -w / 2, -h, w, h);
				ctx.restore();
			}
			drawShadow(x, y, w, a) {
				const ctx = this.ctx;
				ctx.fillStyle = 'rgba(0,0,0,' + (a || 0.28) + ')';
				ctx.beginPath(); ctx.ellipse(x, y + 4, w, w * 0.16, 0, 0, Math.PI * 2); ctx.fill();
			}
			drawGrid() {
				const CFG = INTRO_CFG, ctx = this.ctx;
				ctx.fillStyle = '#0b0d13'; ctx.fillRect(0, 0, CFG.W, CFG.H);
				ctx.strokeStyle = 'rgba(79,110,247,0.10)'; ctx.lineWidth = 1;
				for (let x = 0; x <= CFG.W; x += 56) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CFG.H); ctx.stroke(); }
				for (let y = 0; y <= CFG.H; y += 56) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CFG.W, y); ctx.stroke(); }
			}
			drawStar(x, y, r, fill) {
				const ctx = this.ctx;
				ctx.fillStyle = fill; ctx.beginPath();
				for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.38 : r; const a = i / 8 * Math.PI * 2 - Math.PI / 2; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
				ctx.closePath(); ctx.fill();
			}
			drawBang(x, y, k) {
				if (k <= 0.01) return;
				const ctx = this.ctx;
				ctx.save();
				ctx.translate(x, y - (1 - k) * 14);
				ctx.rotate(-0.12);
				ctx.scale(0.8 + 0.5 * k, 0.8 + 0.5 * k);
				ctx.font = 'bold 52px system-ui,sans-serif';
				ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
				ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(20,24,50,' + k + ')';
				ctx.strokeText('!', 0, 0);
				ctx.fillStyle = 'rgba(255,213,79,' + k + ')';
				ctx.fillText('!', 0, 0);
				ctx.restore();
			}
			heroPose() {
				const CFG = INTRO_CFG, t = this.t;
				if (t >= CFG.s2.ding && t < CFG.s2.hopEnd) {
					const k = (t - CFG.s2.ding) / (CFG.s2.hopEnd - CFG.s2.ding);
					return { key: 'joy', fps: 8, rot: 0, bob: -34 * Math.sin(Math.PI * k), frozen: false };
				}
				if (t >= CFG.s3.eatStart && t < CFG.s3.eatEnd) {
					return { key: 'eatFront', fps: 12, rot: 0, bob: 0, frozen: false };
				}
				if (t >= CFG.s3.eatEnd && t < CFG.s3.shockEnd) {
					const stunned = t < CFG.s3.eatEnd + 0.18;
					const jit = stunned ? 0 : 1;
					return { key: 'error', fps: 1, phase: stunned ? 0 : 1, rot: (Math.random() - 0.5) * 0.05 * jit,
						bob: (Math.random() - 0.5) * 3 * jit, frozen: false };
				}
				if (t >= CFG.s3.shockEnd && t < CFG.s3.buryStart) {
					return { key: 'error', fps: 1, phase: 0, rot: 0.02 * Math.sin(t * 14), bob: 0, frozen: false };
				}
				if (t >= CFG.s3.buryStart) {
					const k = introSmooth((t - CFG.s3.buryStart) / (CFG.s3.buried - CFG.s3.buryStart));
					return { key: 'error', fps: 1, phase: 0, rot: 0.03 * Math.sin(t * 16), bob: 30 * k, frozen: false, alpha: 1 - k };
				}
				return { key: 'walk', fps: 6, rot: 0, bob: -5 * Math.abs(Math.sin(t * Math.PI * 1.5)), frozen: false };
			}
			drawHero() {
				const CFG = INTRO_CFG, t = this.t;
				const x = this.heroX(t), y = CFG.hero.feetY;
				const p = this.heroPose();
				const a = p.alpha == null ? 1 : p.alpha;
				if (a <= 0.03) return;
				this.drawShadow(x, y, 52 * CFG.hero.h / 250, 0.30 * a);
				const phase = p.phase != null ? p.phase : t;
				this.drawSheet(p.key, phase, p.fps, x, y, CFG.hero.h, true, p.rot, p.bob, a, p.sx, p.sy);
				if (t >= CFG.s2.ding && t < CFG.s2.ding + 0.5) {
					const k = 1 - (t - CFG.s2.ding) / 0.5;
					this.drawStar(x + 30, y - CFG.hero.h - 10, 15 * k, 'rgba(255,224,130,' + k + ')');
					this.drawStar(x + 62, y - CFG.hero.h + 26, 9 * k, 'rgba(255,240,180,' + k * 0.8 + ')');
				}
				if (t >= CFG.s2.ding + 0.08 && t < CFG.s2.ding + 0.62) {
					const k = introSmooth((t - CFG.s2.ding - 0.08) / 0.10) * (1 - introSmooth((t - CFG.s2.ding - 0.4) / 0.22));
					this.drawBang(x + 48, y - CFG.hero.h - 42, k);
				}
			}
			drawBowl() {
				const CFG = INTRO_CFG, t = this.t, ctx = this.ctx;
				if (t < CFG.bowlAt || t >= CFG.s3.eatStart) return;
				const img = this.imgs.rice;
				if (img && img.complete && img.naturalWidth) {
					const w = CFG.bowl.w, h = w * (287 / 397);
					const sc = 0.7 + 0.3 * introSmooth((t - CFG.bowlAt) / 0.25);
					ctx.save();
					ctx.translate(CFG.bowl.x, CFG.bowl.y);
					ctx.scale(sc, sc);
					ctx.drawImage(img, -w / 2, -h, w, h);
					ctx.restore();
				}
				for (const s of this.steam) {
					ctx.fillStyle = 'rgba(255,255,255,' + s.a * 0.5 + ')';
					ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
				}
			}
			drawCrowd() {
				const list = this.crowd.slice().sort((a, b) => a.y - b.y);
				for (const c of list) {
					const flip = c.x < INTRO_PILE.x - 20;
					this.drawShadow(c.x, c.y, 46 * c.scale, 0.22);
					this.drawSheet('subwalk', c.phase, 12, c.x, c.y, 250 * c.scale, flip, 0, 0, 1, 1, 1);
				}
			}
			waveY(x) {
				return Math.sin(x * 0.021 + this.t * 2.6) * 9 + Math.sin(x * 0.043 - this.t * 1.9) * 5;
			}
			drawWater() {
				const CFG = INTRO_CFG, t = this.t, ctx = this.ctx;
				if (t < CFG.s5.t0) return;
				const k = introSmooth((t - CFG.s5.t0) / (CFG.s5.full - CFG.s5.t0));
				const surf = (CFG.H + 70) - k * (CFG.H + 130);
				const g = ctx.createLinearGradient(0, Math.max(surf, 0), 0, CFG.H);
				g.addColorStop(0, '#4a5fc1'); g.addColorStop(1, '#2b3680');
				ctx.fillStyle = g;
				ctx.beginPath();
				ctx.moveTo(0, CFG.H + 10);
				for (let x = 0; x <= CFG.W; x += 16) ctx.lineTo(x, surf + this.waveY(x));
				ctx.lineTo(CFG.W, CFG.H + 10);
				ctx.closePath(); ctx.fill();
				ctx.strokeStyle = 'rgba(196,208,255,.55)'; ctx.lineWidth = 3;
				ctx.beginPath();
				for (let x = 0; x <= CFG.W; x += 16) { const y = surf + this.waveY(x); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
				ctx.stroke();
				for (const b of this.bubbles) {
					ctx.fillStyle = 'rgba(214,228,255,.34)';
					ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
					ctx.strokeStyle = 'rgba(255,255,255,.50)'; ctx.lineWidth = 1.2;
					ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
					ctx.fillStyle = 'rgba(255,255,255,.60)';
					ctx.beginPath(); ctx.arc(b.x - b.r * 0.32, b.y - b.r * 0.32, Math.max(0.7, b.r * 0.26), 0, Math.PI * 2); ctx.fill();
				}
			}
			render() {
				this.drawGrid();
				this.drawHero();
				this.drawBowl();
				this.drawCrowd();
				this.drawWater();
			}
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
					// dsh-app:// 页面下 location.origin 不是 HTTP 源，WS 需走 transport 提供的真实 Host origin（与官方 remoteStreamUrl 同款兜底逻辑）
					const __t = globalThis.__DSH_TRANSPORT__;
					const __wsBase = __t?.streamBaseUrl !== void 0 ? new URL(__t.streamBaseUrl).origin : window.location.origin;
					const url = new URL('/vs-game/ws', __wsBase);
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
			urchin: { hp: 2,  speed: 30, size: 19, color: '#4a3b5c', label: '海胆', xp: 0.9, tier: 1 },
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
		/** 第 3 关·整理工作区：小怪 → 掉落文件；扩展名按关卡规则表决定目标文件夹 */
		const SORT_ENEMY_CATEGORY = {
			js: 'src', shell: 'src', py: 'src', html: 'src', ts: 'src', go: 'src', rs: 'src', bin: 'src', term: 'src',
			docs: 'docs', search: 'docs',
			config: 'config',
			misc: 'tmp',
		};
		const SORT_FILES = {
			src:    ['app.js', 'types.ts', 'main.py', 'server.go', 'lib.rs', 'index.html'],
			docs:   ['README.md', 'notes.txt'],
			config: ['settings.json', 'config.yaml', 'Cargo.toml'],
			tmp:    ['debug.log', 'cache.tmp', 'app.bak', 'build.cache'],
		};
		/** 物品/器械图标版本号：换了图就 +1，强制浏览器重新下载（否则会一直显示缓存的旧图） */
		const ASSET_VER = '?v=3';
		function assetUrl(url) {
			return (typeof url === 'string' && url.startsWith('/vs-game/assets/') && !url.includes('?')) ? url + ASSET_VER : url;
		}
		/** 打造（家具/器械）：id → { name, icon, cost, desc, max }。cost 与服务端 BUILD_RECIPES 保持一致 */
		const BUILD_ITEMS = {
			'tree-farm': { name: '树场', icon: '🌳', cost: { 'mat-wood': 10, 'mat-ingot-silver': 5 }, desc: '按住 F 砍出木材，每次 +1 木材', max: 1, buildTime: 3, gatherTime: 1.1 },
			'basic-mine': { name: '基础矿场', icon: '⛏️', iconUrl: '/vs-game/assets/items/basic-mine.png' + ASSET_VER, cost: { 'mat-wood': 20, 'mat-ingot-silver': 10, 'mat-diamond': 1 }, desc: '按住 F 挖矿，产出铁锭 / 钻石（越贵越稀有）', max: 1, buildTime: 10, gatherTime: 1.5, action: 'gather' },
			'enchant-table': { name: '饰品强化台', icon: '🔮', iconUrl: '/vs-game/assets/items/enchant-table.png' + ASSET_VER, cost: { 'mat-ingot-silver': 20, 'mat-diamond': 10 }, desc: '选基底+材料，按住 F 逐孔嵌词条；子代理会来帮忙充能', max: 1, buildTime: 30, action: 'panel' },
			'agent-hub': { name: '子代理管理台', icon: '📋', iconUrl: '/vs-game/assets/items/sub-agent-hub.png' + ASSET_VER, cost: { 'mat-ingot-purple': 3, 'mat-diamond': 5, 'mat-ingot-silver': 10 }, desc: '招募子代理、给它们派活', max: 1, buildTime: 15, action: 'panel', unlock: 'too-many-files' },
			'training-dummy': { name: '训练假人', icon: '🎯', iconUrl: '/vs-game/assets/items/mv/training-dummy.png' + ASSET_VER, cost: { 'mat-wood': 10 }, desc: '放在家里打它测伤害：显示连击数与总伤害，被打会晃', max: 3, buildTime: 2, action: 'dummy' },
		};
		/** 第 3 关出怪：先均匀抽类别（四类各 25%），再抽该类小怪 —— 避免 src 因怪种多而爆率过高 */
		const SORT_SPAWN_POOL = {
			src:    ['js', 'ts', 'py', 'go', 'rs', 'html'],
			docs:   ['docs', 'search'],
			config: ['config'],
			tmp:    ['misc'],
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
			orb:   { icon: '🌀', name: '语法环绕', desc: '绕身旋转的能量球，可挡子弹', lvDesc: ['强化', '强化', '强化', '强化'] },
			laser: { icon: '✚', name: '编译激光', desc: '持续穿透光束',     lvDesc: ['强化', '强化', '强化', '强化'] },
			mine:  { icon: '💣', name: '注释地雷', desc: '自动朝敌扇形爆破（阔剑地雷）', lvDesc: ['强化', '强化', '强化', '强化'] },
			zap:   { icon: '⚡', name: 'Debug雷击', desc: '多目标连锁闪电', lvDesc: ['强化', '强化', '强化', '强化'] },
		};
		const PASSIVES = {
			armor:  { icon: '🛡', name: '防御', desc: '防御力 +5 / 级', per: '防御力 +5', current: (lv) => '防御力 +' + lv * 5 },
			regen:  { icon: '💗', name: '回血', desc: '每秒 +0.6 HP / 级', per: '每秒回血 +0.6', current: (lv) => '每秒回血 +' + (lv * 0.6).toFixed(1) },
			speed:  { icon: '👟', name: '加速', desc: '移速 +10% / 级', per: '移速 +10%', current: (lv) => '移速 +' + lv * 10 + '%' },
			might:  { icon: '💪', name: '力量', desc: '攻击力 +20% / 级', per: '攻击力 +20%', current: (lv) => '攻击力 +' + lv * 20 + '%' },
			haste:  { icon: '⏱', name: '冷却', desc: '武器冷却 -10% / 级', per: '武器冷却 -10%', current: (lv) => '武器冷却 -' + lv * 10 + '%' },
			magnet: { icon: '🧲', name: '磁铁', desc: '拾取范围 +40 / 级，满级全屏吸取', per: '拾取范围 +40', current: (lv) => '拾取范围 +' + lv * 40 },
		};
		// 基础攻击力：后续饰品/装备直接加成 attackPower
		const BASE_ATTACK = 10;
		// 各武器伤害倍率：实际伤害 = 攻击力 × 倍率 × 等级/进化系数
		const WEAPON_DMG_MULT = {
			whip: 0.2,
			bolt: 0.2,
			orb: 0.2,
			laser: 0.4,
			mine: 12.0,
			zap: 0.5,
		};
		// 暴击基础值：后续饰品/装备可直接加成 critChance / critDamage
		const BASE_CRIT_RATE = 0.05;
		const BASE_CRIT_DMG = 1.5;
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
				dmgMult: 0.05,
			},
			'teleport-laser': {
				id: 'teleport-laser',
				icon: '🟣',
				iconUrl: '/vs-game/assets/items/ender_pearl.png',
				name: 'TP',
				desc: '点击屏幕发射末影珍珠',
				cd: 0,
				type: 'teleport',
				internalCd: 0.35,
				laserSpeed: 1500,
				radius: 28,
			},
			railgun: {
				id: 'railgun',
				icon: '⚡',
				name: '超电磁炮',
				desc: '20 秒 CD：朝敌人最多的方向轰出一道贯穿全场的巨型电磁炮，持续 2.5 秒缓慢扫射，大范围持续高伤',
				cd: 20,
				type: 'railgun',
				duration: 2.5,
				length: 1180,
				width: 132,
				dmgMult: 12,         // 每 tick 的倍率：一次炮击约 20 tick，能秒第 4 关普通怪、啃掉 Boss 一大块
				tick: 0.12,
				sweep: 0.3,          // 扫射角速度（rad/s）：2.5s 扫过约 43°，既扫得开又不会一下甩掉目标
			},
			purge: {
				id: 'purge',
				icon: '🌀',
				iconUrl: '/vs-game/assets/image/purge-phantom.png' + ASSET_VER,
				name: '肃清',
				desc: '60s CD：无敌隐身并显现虚影，随后 10s 内快速斩击视野内所有敌人（移动键改为推移镜头），结束时在镜头处落最后一刀，切碎屏幕并造成大量伤害',
				cd: 60,
				type: 'purge',
				duration: 10,         // 横扫持续
				phantom: 1.7,         // 虚影展示时长（之后技能才开始）
				hitCd: 0.17,          // 同一只怪两刀之间的间隔（也是这一刀旋转用掉的时间）
				dmgMult: 2.0,         // 每刀伤害倍率（× 攻击力）
				finalDmgMult: 120,    // 最后一刀伤害倍率（单发，比横扫里任何一刀都重）
				finalRadius: 460,     // 最后一刀范围
				camSpeed: 430,        // 横扫期间镜头推移速度 px/s
			},
			'damage-laser': {
				id: 'damage-laser',
				icon: '🔫',
				name: '伤害激光',
				desc: '点击或按住屏幕连续发射伤害激光（内置冷却很短，能连喷）',
				cd: 0,
				type: 'damage',
				internalCd: 0.09,      // 内置冷却：点击/按住都能很快连发
				laserSpeed: 1800,
				radius: 72,
				damageMult: 1.5,
			},
		};
		/** 背包物品表（图标先用 emoji 占位，后续可替换为开放素材） */
		const MV_ICON_BASE = '/vs-game/assets/items/mv/';
		const MV_ITEM_NAMES = {
			'chest-gold': '金宝箱', 'chest-blue': '蓝宝箱',
			'mat-bundle': '钱袋', 'mat-coinpile': '钱币串', 'mat-scroll': '藏宝图', 'tool-pick': '矿镐',
			'mat-ingot-silver': '铁锭', 'mat-ingot-aqua': '水蓝晶条', 'mat-ingot-blue': '苍蓝晶条',
			'mat-ingot-purple': '紫晶条', 'mat-ingot-rose': '玫晶条', 'mat-ingot-green': '翠晶条',
			'mat-wood': '木材', 'acc-knife': '小刀', 'wooden-chest': '木制宝箱',
			'mat-diamond': '钻石', 'record-player': '唱片机', 'record-billie-jean': 'Billie Jean 唱片', 'record-letmego': 'letmego 唱片', 'record-bad-apple': 'Bad Apple 唱片', 'record-world-execute-me': 'world.execute(me)',
			'skill-fragment-teleport': 'TP碎片', 'skill-fragment-damage': '伤害激光碎片',
			'skill-book-teleport': '技能书·TP', 'skill-book-damage': '技能书·伤害激光', 'skill-book-purge': '技能书·肃清',
		};
		const MV_ACC_POOL = Object.keys(MV_ITEM_NAMES).filter((k) => k.startsWith('acc-'));
		const MV_MAT_POOL = Object.keys(MV_ITEM_NAMES).filter((k) => k.startsWith('mat-ingot'));
		const mvImgCache = new Map();
		function itemImg(key) {
			let img = mvImgCache.get(key);
			if (!img) { img = new Image(); img.src = MV_ICON_BASE + key + '.png'; mvImgCache.set(key, img); }
			return img;
		}
		const TILE_BASE = '/vs-game/assets/tilesets/';
		const tileImgCache = new Map();
		function tileImg(key) {
			let img = tileImgCache.get(key);
			if (!img) { img = new Image(); img.src = TILE_BASE + key + '.png'; tileImgCache.set(key, img); }
			return img;
		}
		const assetImgCache = new Map();
		function assetImg(url) {
			let img = assetImgCache.get(url);
			if (!img) { img = new Image(); img.src = url; assetImgCache.set(url, img); }
			return img;
		}
		const SE_URL_VER = '?v=18';
		const UI_CLICK_SOUNDS = ['ui-click-1', 'ui-click-2', 'ui-click-3', 'ui-click-4', 'ui-click-5'];
		const uiClickBag = [];
		function nextUiClickSound() {
			if (uiClickBag.length === 0) {
				for (const s of UI_CLICK_SOUNDS) uiClickBag.push(s);
				for (let i = uiClickBag.length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[uiClickBag[i], uiClickBag[j]] = [uiClickBag[j], uiClickBag[i]];
				}
			}
			return uiClickBag.pop();
		}
		const seCache = new Map();
		const seLast = new Map();
		/** 全局音量（0~1）：设置面板写入，playSE / BGM 都乘这个系数 */
		const AUDIO_MIX = { sfx: 1, bgm: 1 };
		function setAudioMix(sfx, bgm) {
			AUDIO_MIX.sfx = Math.max(0, Math.min(1, Number.isFinite(sfx) ? sfx : 1));
			AUDIO_MIX.bgm = Math.max(0, Math.min(1, Number.isFinite(bgm) ? bgm : 1));
		}
		function playSE(name, volume = 1, minGap = 0.05) {
			try {
				const now = performance.now();
				const last = seLast.get(name) || 0;
				if (minGap > 0 && now - last < minGap * 1000) return;
				seLast.set(name, now);
				const url = '/vs-game/assets/music/se/' + name + '.mp3' + SE_URL_VER;
				let base = seCache.get(name);
				if (!base) { base = new Audio(url); base.preload = 'auto'; seCache.set(name, base); }
				const a = base.cloneNode(true);
				a.volume = Math.max(0, Math.min(1, volume * AUDIO_MIX.sfx));
				const pr = a.play();
				if (pr && pr.catch) pr.catch(() => {});
			} catch {}
		}
		const BAD_APPLE = { ready: false, loading: false, cols: 42, rows: 26, fps: 30, frameCount: 0, bytes: null };
		function loadBadAppleFrames() {
			if (BAD_APPLE.ready || BAD_APPLE.loading) return;
			BAD_APPLE.loading = true;
			fetch('/vs-game/assets/music/bgm/bad-apple-frames.bin?v=168')
				.then((r) => r.arrayBuffer())
				.then((buf) => {
					const dv = new DataView(buf);
					if (dv.getUint8(0) !== 66 || dv.getUint8(1) !== 65 || dv.getUint8(2) !== 80 || dv.getUint8(3) !== 49) throw new Error('bad apple frames bad magic');
					BAD_APPLE.cols = dv.getUint16(4, true);
					BAD_APPLE.rows = dv.getUint16(6, true);
					BAD_APPLE.fps = dv.getUint16(8, true);
					BAD_APPLE.frameCount = dv.getUint32(10, true);
					BAD_APPLE.bytes = new Uint8Array(buf, 14);
					BAD_APPLE.ready = true;
				})
				.catch(() => { BAD_APPLE.loading = false; });
		}

				const EXCLUSIVE_AFFIX_NAME = { 'normal-attack': '普通攻击替换为剑技', 'fish-leap': '获得【鱼跃】' };
/**
 * 挥剑三段素材（用户重排后的命名，按文件名顺序直接播放）：
 * ja0-3（4 帧 · 第一段）/ jb0-2（3 帧 · 第二段）/ jc0-4（5 帧 · 第三段）。
 * [前缀, 帧数]
 */
const SWORD_STAGE_SETS = [['ja', 4], ['jb', 3], ['jc', 5]];
/**
 * 每段「每一帧」的停留秒数（逐帧可调）：
 *  A 段 4 帧、B 段 3 帧、C 段 5 帧。C 的最后两帧是收招，明显放慢。
 */
const SWORD_FRAME_T = [
	null,
	[0.105, 0.10, 0.095, 0.09],
	[0.10, 0.095, 0.10],
	[0.085, 0.09, 0.10, 0.17, 0.17],
];
/** 每段总时长 = 该段各帧之和 */
const SWORD_STAGE_DUR = [0, 0, 0, 0];
for (let i = 1; i <= 3; i++) SWORD_STAGE_DUR[i] = SWORD_FRAME_T[i].reduce((x, y) => x + y, 0);
/** 本段结束后还能接下一段的宽限时间（三段连点靠这个） */
const SWORD_CHAIN_GRACE = 0.3;
/** 剑技伤害倍率（× 总攻击力）：比普通武器（0.2）高一截，点击才值得 */
const SWORD_DMG_MULT = 1.0;
/** 剑气生命（秒）：比挥砍动画长，慢慢成形再快速散掉 */
const SWORD_QI_LIFE = 0.8;
/** 剑气包络分界：这段时间之前是「淡→实」（慢），之后是「实→淡」（快） */
const SWORD_QI_UP = 0.6;
/** 连段取消窗口：本段播到该比例后，若已排队就立刻切下一段（连段更快、衔接更紧） */
const SWORD_CHAIN_CANCEL = 0.65;
/** 三段打完后的收招硬直：0 = 尾帧一结束就能马上起新一轮三连 */
const SWORD_COMBO_RECOVER = 0;
/** 攻击姿势绘制尺寸（像素，和本体 56 相比略小才不显大）；脚底与本体重合 */
const SWORD_POSE_SIZE = 52;
const SWORD_POSE_FOOT = 28;

/** 第三房间（钓鱼海滩）：大地图边界 + 死亡时序（倒下→全黑→黑屏里搬回床上→慢慢睁眼） */
const FISH_ROOM = { world: { w: 1680, h: 1040 }, seaY: 520, spawn: { x: 300, y: 330 }, shop: { x: 1150, y: 430 }, back: { x: 1340, y: 430 }, autoWeapons: false };   // autoWeapons:false = 第三房间禁用自动武器（自动炮会把鱼清场）
const FISH_DEATH = { fade: 0.24, minWalk: 0.12, maxWalk: 3.0, wake: 1.7, hold: 0.35, bed: { x: 96, y: 182 } };

/** 按逐帧时长求当前该显示第几帧 */
function swordFrameIndex(stage, t) {
	const arr = SWORD_FRAME_T[stage] ?? SWORD_FRAME_T[1];
	let acc = 0;
	for (let i = 0; i < arr.length; i++) { acc += arr[i]; if (t < acc) return i; }
	return arr.length - 1;
}
				const QUALITY = {
			white:  { key: 'white',  label: '白色', color: '#d9d9d9', sockets: 1 },
			green:  { key: 'green',  label: '绿色', color: '#4caf50', sockets: 2 },
			blue:   { key: 'blue',   label: '蓝色', color: '#4a90e2', sockets: 3 },
			purple: { key: 'purple', label: '紫色', color: '#a855f7', sockets: 4 },
			orange: { key: 'orange', label: '橙色', color: '#f59e0b', sockets: 5 },
			red:    { key: 'red',    label: '红色', color: '#ef4444', sockets: 6 },
		};
		const SLOT_LABELS = { weapon: '武器', ring: '戒指', boots: '鞋', shield: '盾', amulet: '护符' };
		/** 幸运石：消耗品，每颗 +10% 成功率（总成功率上限 100%） */
		const LUCKY_STONE = 'mat-lucky-stone';
		/** 词条表（可扩展：以后加 暴击/爆伤/生命/防御/吸血 …） */
		/**
		 * 词条表。range 是「随机区间」，suffix 是显示后缀（百分比用 %）。
		 * 目前战斗只接了 atk；其余类型先占位，等做随机词条时按 affixStats[key] 逐个挂上去。
		 */
		const AFFIXES = {
			atk:   { key: 'atk',   label: '攻击', suffix: '',  range: [5, 10] },
			crit:  { key: 'crit',  label: '暴击', suffix: '%', range: [3, 8] },
			cdmg:  { key: 'cdmg',  label: '爆伤', suffix: '%', range: [10, 30] },
			hp:    { key: 'hp',    label: '生命', suffix: '',  range: [10, 30] },
			def:   { key: 'def',   label: '防御', suffix: '',  range: [5, 15] },
			leech: { key: 'leech', label: '吸血', suffix: '%', range: [1, 3] },
		};
		/**
		 * 饰品 id 解析：`基底` / `基底~atk.atk` / `基底~atk.atk#序号`
		 * 带 `#序号` 的即「强化过的独立个体」（不叠加，名字不变，只是词条变多）
		 */
		function parseAccId(id) {
			if (typeof id !== 'string' || !/^(acc|fish)-/.test(id)) return null;   // 鱼物品也复用这套词条格式
			const m = /^([^~#]+)(?:~([^#]*))?(?:#(.+))?$/.exec(id);
			if (!m) return null;
			return { base: m[1], affixes: splitAffixTokens(m[2]).map(parseAffixToken), serial: m[3] || null };
		}
		/**
		 * 词条串切分。新格式用逗号分隔（`atk:10-15,crit:6.5`）——因为词条数值可能是小数，点号不能当分隔符；
		 * 老存档用点号分隔（`atk.atk`）仍然兼容。
		 */
		function splitAffixTokens(raw) {
			const str = String(raw ?? '').trim();
			if (!str) return [];
			if (str.includes(',')) return str.split(',').map((x) => x.trim()).filter(Boolean);
			if (/^[a-z_]+$/.test(str)) return [str];                                  // 单个裸 key
			if (/^[a-z_]+:-?[0-9.]+(-[0-9.]+)?$/.test(str)) return [str];             // 单个带值 token
			return str.split('.').map((x) => x.trim()).filter(Boolean);                 // 老格式
		}

		/**
		 * 词条 token：`atk`（用词条表默认区间）或 `atk:10-15`（带区间 —— 强化时按耗材自己的第一条词条写入）。
		 * 区间写进 id 里，存档不用改，显示和加成都能各算各的。
		 */
		function parseAffixToken(tok) {
			const [key, val] = String(tok).split(':');
			let min = null, max = null;
			if (val) {
				if (val.includes('-')) {                       // atk:5-10 → 区间
					const p2 = val.split('-').map((x) => Number(x));
					if (p2.length === 2 && p2.every((x) => Number.isFinite(x))) { min = p2[0]; max = p2[1]; }
				} else {                                       // crit:6.5 → 固定值（以后随机词条就用这个写法）
					const v = Number(val);
					if (Number.isFinite(v)) { min = v; max = v; }
				}
			}
			// 啥都没写 → 留空：显示/求和时按「基底自身的区间」兜底（兼容老存档里裸 atk 的 id）
			return { key, min, max, range: min == null ? null : [min, max], fixed: min != null && min === max };
		}
		/** 词条显示名（未知 key 直接显示 key） */
		function affixLabel(af) { return (af && (AFFIXES[af.key]?.label ?? af.key)) || null; }
		/** 词条数值文案：固定值 `8` / 区间 `5-10`，按词条表补后缀（%） */
		function affixValueText(af, range) {
			const suf = AFFIXES[af?.key]?.suffix ?? '';
			if (!range) return '';
			return range[0] === range[1] ? (range[0] + suf) : (range[0] + '-' + range[1] + suf);
		}
		/** 饰品当前已嵌词条数（用来算「第几个孔」） */
		function accEmbedded(item) { const p = parseAccId(item); return p ? p.affixes.length : 0; }
		/** 饰品的自身词条（目前所有饰品都是攻击） */
		function accInnateAffix(item) { const p = parseAccId(item); return p ? 'atk' : null; }
		const ITEM_DEFS = {
			'newbie-gift': { icon: '🎁', iconUrl: '/vs-game/assets/items/newbie_gift.png', name: '新手礼包', type: 'consumable', desc: '内含 1000 token' },
			'skill-book': { icon: '📖', iconUrl: '/vs-game/assets/items/skill_book.png', name: '技能书·划除', type: 'consumable', desc: '使用后学会主动技能「划除」' },
			'skill-fragment': { icon: '📕', iconUrl: '/vs-game/assets/items/mv/mat-scroll.png', name: '技能书碎片·划除', type: 'material', desc: '收集 10 个可在合成台合成技能书' },
			'skill-fragment-teleport': { icon: '📘', iconUrl: '/vs-game/assets/items/mv/mat-scroll.png', name: 'TP碎片', type: 'material', desc: '第二关 Boss 掉落，收集 10 个合成 TP 技能书' },
			'skill-fragment-damage': { icon: '📗', iconUrl: '/vs-game/assets/items/mv/mat-scroll.png', name: '伤害激光碎片', type: 'material', desc: '第三关 Boss 掉落（待开放），收集 10 个合成伤害激光技能书' },
			'skill-book-teleport': { icon: '📖', iconUrl: '/vs-game/assets/items/skill_book.png', name: '技能书·TP', type: 'consumable', desc: '使用后永久解锁主动技能「TP」' },
			'skill-book-damage': { icon: '📖', iconUrl: '/vs-game/assets/items/skill_book.png', name: '技能书·伤害激光', type: 'consumable', desc: '使用后学会主动技能「伤害激光」' },
			'skill-fragment-railgun': { icon: '📙', iconUrl: MV_ICON_BASE + 'mat-scroll.png', name: '超电磁炮碎片', type: 'material', desc: '第 4 关掉落，收集 10 个合成技能书·超电磁炮' },
			'skill-book-railgun': { icon: '📖', iconUrl: '/vs-game/assets/items/skill_book.png', name: '技能书·超电磁炮', type: 'consumable', desc: '使用后永久解锁主动技能「超电磁炮」' },
			'skill-fragment-purge': { icon: '📗', iconUrl: MV_ICON_BASE + 'mat-scroll.png', name: '肃清碎片', type: 'material', desc: '商店可购，收集 10 个合成技能书·肃清' },
			'skill-book-purge': { icon: '📖', iconUrl: '/vs-game/assets/items/skill_book.png', name: '技能书·肃清', type: 'consumable', desc: '使用后永久解锁主动技能「肃清」' },
			'mat-wood': { icon: '🪵', iconUrl: MV_ICON_BASE + 'mat-wood.png', name: '木材', type: 'material', desc: '基础合成材料' },
			'mat-diamond': { icon: '💎', iconUrl: MV_ICON_BASE + 'diamond.png', name: '钻石', type: 'material', desc: '稀有材料' },
			'mat-ingot-silver': { icon: '🔩', iconUrl: MV_ICON_BASE + 'mat-ingot-silver.png', name: '铁锭', type: 'material', desc: '基础金属，矿场产出' },
			'mat-ingot-purple': { icon: '🔮', iconUrl: MV_ICON_BASE + 'mat-ingot-purple.png', name: '紫晶锭', type: 'material', desc: '第 4 关产出的稀有晶锭，可合成幸运石' },
			'mat-lucky-stone': { icon: '🔮', iconUrl: MV_ICON_BASE + 'rune-purple.png', name: '幸运石', type: 'material', desc: '强化时消耗，每颗 +10% 成功率（总成功率上限 100%）' },
			'wooden-chest': { icon: '📦', iconUrl: MV_ICON_BASE + 'wooden-chest.png', name: '木制宝箱', type: 'tool', desc: '放在家里的 5 格储物箱' },
			'record-player': { icon: '🎵', iconUrl: MV_ICON_BASE + 'record-player.png', name: '唱片机', type: 'tool', desc: '放在家里，可播放唱片' },
			'record-billie-jean': { icon: '💿', iconUrl: MV_ICON_BASE + 'record.png', name: 'Billie Jean 唱片', type: 'record', desc: 'BGM：Billie Jean' },
			'record-letmego': { icon: '💿', iconUrl: MV_ICON_BASE + 'record.png', name: 'letmego 唱片', type: 'record', desc: 'BGM：letmego-all（完整版 2:05）' },
			'record-bad-apple': { icon: '💿', iconUrl: MV_ICON_BASE + 'record-bad-apple.png', name: 'Bad Apple 唱片', type: 'record', desc: 'BGM：Bad Apple' },
			'record-world-execute-me': { icon: '💿', iconUrl: MV_ICON_BASE + 'record-world-execute.png', name: 'world.execute(me)', type: 'record', desc: 'BGM：world.execute(me)' },
			'acc-knife': { icon: '🔪', iconUrl: MV_ICON_BASE + 'acc-knife.png', name: '小刀', type: 'accessory', slot: 'weapon', quality: 'white', attack: [5, 10], desc: '一把趁手的小刀。' },
			'acc-knife-diamond': { icon: '🗡️', iconUrl: MV_ICON_BASE + 'acc-knife-diamond.png', name: '钻石小刀', type: 'accessory', slot: 'weapon', quality: 'green', attack: [10, 15], desc: '加工粗糙，但勉强能用。' },
			'acc-knife-green': { icon: '🔪', iconUrl: MV_ICON_BASE + 'acc-knife.png', name: '小刀', type: 'accessory', slot: 'weapon', quality: 'green', attack: [5, 10], desc: '饰品测试模板' },
			'acc-knife-blue': { icon: '🔪', iconUrl: MV_ICON_BASE + 'acc-knife.png', name: '小刀', type: 'accessory', slot: 'weapon', quality: 'blue', attack: [5, 10], desc: '饰品测试模板' },
			'acc-sword': { icon: '🗡️', iconUrl: MV_ICON_BASE + 'acc-sword.png', name: '宝剑', type: 'accessory', slot: 'weapon', quality: 'blue', exclusive: 'normal-attack', desc: '佩戴后普通攻击变成剑技：点击屏幕朝该方向挥剑，三段连击；越往后挥得越远、剑气越长、伤害越高。' },
			'acc-fish-ring': { icon: '💍', iconUrl: MV_ICON_BASE + 'acc-fish-ring.png', name: '鱼跃指环', type: 'accessory', slot: 'weapon', quality: 'blue', exclusive: 'fish-leap', desc: '佩戴后按空格鱼跃：朝面朝方向（或按着的方向键）跃出一小段，腾空期间无敌；最多存 2 段，每 1.5 秒回 1 段（底部技力条）。' },
			// ── 第三房间（钓鱼）：碎片 / 鱼饵 / 鱼 ──
			'frag-room3': { icon: '🧩', iconUrl: MV_ICON_BASE + 'rune-blue.png', name: '第三房间碎片', type: 'material', desc: '第 5 关 Boss 掉落。集齐 5 个用于解锁第三房间' },
			'bait-pixel': { icon: '🪱', iconUrl: MV_ICON_BASE + 'bait-pixel.png', name: '像素鱼饵', type: 'consumable', desc: '海边商店 2000 token。在第三房间按 C 切换、按 V 投放到水域，自动钓鱼' },
			'fish-salmon': { icon: '🐟', iconUrl: MV_ICON_BASE + 'fish-salmon.png', name: '鲑鱼', type: 'fish', desc: '钓上来的鱼。带 1 条随机属性，可作饰品强化耗材（强化时该属性进孔）' },
			'fish-clown': { icon: '🐠', iconUrl: MV_ICON_BASE + 'fish-clown.png', name: '小丑鱼', type: 'fish', desc: '钓上来的鱼。带 1 条随机属性，可作饰品强化耗材（强化时该属性进孔）' },
			'fish-cod': { icon: '🐟', iconUrl: MV_ICON_BASE + 'fish-cod.png', name: '鳕鱼', type: 'fish', desc: '钓上来的鱼。带 1 条随机属性，可作饰品强化耗材（强化时该属性进孔）' },
			'fish-plain': { icon: '🐟', iconUrl: MV_ICON_BASE + 'fish-plain.png', name: '鱼', type: 'fish', desc: '钓上来的鱼。带 1 条随机属性，可作饰品强化耗材（强化时该属性进孔）' },
			'acc-knife-purple': { icon: '🔪', iconUrl: MV_ICON_BASE + 'acc-knife.png', name: '小刀', type: 'accessory', slot: 'weapon', quality: 'purple', attack: [5, 10], desc: '饰品测试模板' },
			'acc-knife-orange': { icon: '🔪', iconUrl: MV_ICON_BASE + 'acc-knife.png', name: '小刀', type: 'accessory', slot: 'weapon', quality: 'orange', attack: [5, 10], desc: '饰品测试模板' },
			'acc-knife-red': { icon: '🔪', iconUrl: MV_ICON_BASE + 'acc-knife.png', name: '小刀', type: 'accessory', slot: 'weapon', quality: 'red', attack: [5, 10], desc: '饰品测试模板' },
		};
		/** 给物品定义挂上图标版本号（WeakMap 缓存，避免重复建对象） */
		const assetMetaCache = new WeakMap();
		function assetMeta(def) {
			if (!def || !def.iconUrl || def.iconUrl.includes('?')) return def;
			let out = assetMetaCache.get(def);
			if (!out) { out = { ...def, iconUrl: assetUrl(def.iconUrl) }; assetMetaCache.set(def, out); }
			return out;
		}
		function itemMeta(item) {
			if (ITEM_DEFS[item]) return assetMeta(ITEM_DEFS[item]);
			// 强化过的饰品：id = 基底~词条#序号。名字/图标/品质沿用基底，只多出词条
			const pacc = parseAccId(item);
			if (pacc && pacc.affixes.length > 0) {
				const bm = itemMeta(pacc.base);
				const fallback = Array.isArray(bm.attack) ? bm.attack : (AFFIXES.atk?.range ?? [5, 10]);   // 老存档里裸 atk 按基底自身区间算
				// 通用词条统计：key → [min, max]（固定值就是 [v, v]）。攻击/暴击/生命…以后都从这里读。
				const affixStats = {};
				if (Array.isArray(bm.attack)) affixStats.atk = [bm.attack[0], bm.attack[1]];   // 基底固有词条
				for (const af of pacc.affixes) {
					const r = af.range ?? fallback;
					if (!r) continue;
					const cur = affixStats[af.key] ?? [0, 0];
					affixStats[af.key] = [cur[0] + r[0], cur[1] + r[1]];
				}
				const atk = affixStats.atk ?? bm.attack;
				return { ...bm, attack: atk, affixStats, affixes: pacc.affixes.slice(), instance: !!pacc.serial };
			}
			if (MV_ITEM_NAMES[item]) {
				const isAcc = item.startsWith('acc-');
				if (item === 'mat-wood') return assetMeta({ icon: '🪵', iconUrl: MV_ICON_BASE + item + '.png', name: MV_ITEM_NAMES[item], type: 'material', desc: '基础合成材料' });
				if (item === 'wooden-chest') return assetMeta({ icon: '📦', iconUrl: MV_ICON_BASE + item + '.png', name: MV_ITEM_NAMES[item], type: 'tool', desc: '可放置的 5 格储物箱' });
				if (isAcc) return assetMeta({ icon: '💍', iconUrl: MV_ICON_BASE + item + '.png', name: MV_ITEM_NAMES[item], type: 'accessory', dev: true, placeholder: true, desc: 'AI 生成的占位饰品，功能尚未实现。' });
				return assetMeta({ icon: '🧱', iconUrl: MV_ICON_BASE + item + '.png', name: MV_ITEM_NAMES[item], type: 'material', desc: '锻造材料（打造高级饰品）' });
			}
			return { icon: '📦', name: item, type: 'misc', desc: '待开发' };
		}
		function describeItem(item) {
			const m = itemMeta(item);
			const quality = m.quality && QUALITY[m.quality] ? QUALITY[m.quality] : null;
			const dev = !!m.dev;
			const typeLabel = dev ? '占位饰品'
				: m.type === 'fish' ? '鱼 · 强化耗材'
				: m.type === 'accessory' ? ('饰品 · ' + (SLOT_LABELS[m.slot] || '饰品'))
					: m.type === 'material' ? '材料'
						: m.type === 'consumable' ? '消耗品'
							: m.type === 'tool' ? '工具'
								: '物品';
			/**
			 * 词条行：第 1 行 = 饰品自身固有词条（金色，不占孔），之后每个孔各占 1 行（蓝色）。
			 * 强化成功 = 往空孔里多嵌 1 条词条，显示成「孔里嵌了东西」的样子，而不是把数值叠成一行。
			 */
			const stats = [];
			const affixes = [];
			if (!dev && m.type === 'accessory') {
				const pacc0 = parseAccId(item);
				const bm0 = pacc0 ? itemMeta(pacc0.base) : m;
				const innate = accInnateAffix(item);
				const innateAf = innate ? AFFIXES[innate] : null;
				// 只有基底自己写了 attack 才有「固有词条行」；没有就整行不显示（掉落类随机词条饰品走这条路）
				const baseRange = Array.isArray(bm0.attack) ? bm0.attack : null;
				if (baseRange) affixes.push({ label: innateAf ? innateAf.label : '攻击', range: baseRange, filled: true, innate: true });
				const exName = EXCLUSIVE_AFFIX_NAME[bm0.exclusive];   // 专属词条：金色固有行（不占孔，无数值区间）
				if (exName) affixes.push({ label: exName, range: null, filled: true, innate: true });
				const emb = Array.isArray(m.affixes) ? m.affixes : [];
				const holes = Math.max(quality ? quality.sockets : 1, emb.length);
				for (let i = 0; i < holes; i++) {
					const af = emb[i] || null;
					affixes.push({ label: affixLabel(af), key: af?.key ?? null, range: af ? (af.range ?? baseRange) : null, filled: !!af, innate: false });
				}
			} else if (!dev && m.type === 'fish') {
				// 鱼：把自己那 1 条随机属性显示成金色固有行
				const femb = Array.isArray(m.affixes) ? m.affixes : [];
				for (const af of femb) affixes.push({ label: affixLabel(af), key: af?.key ?? null, range: af ? (af.range ?? null) : null, filled: true, innate: true });
				if (femb.length === 0) affixes.push({ label: '无属性', range: null, filled: false, innate: false });
			} else if (!dev && Array.isArray(m.attack)) {
				stats.push({ label: '攻击', value: m.attack[0] + ' - ' + m.attack[1], tone: 'good' });
			}
			return { item, name: m.name, icon: m.icon, iconUrl: m.iconUrl, quality, typeLabel, stats, affixes, desc: m.desc, dev };
		}
		/** 词条行配色：金色 = 底座固有，蓝色 = 孔里嵌的，灰色 = 空孔 */
		function affixTone(s) {
			if (s.innate) return { border: '#6d5a29', bg: 'linear-gradient(90deg, rgba(245,196,81,.20), rgba(245,196,81,.03))', glyph: '#f5c451', text: '#f2e8d2' };
			if (s.filled) return { border: '#3b4260', bg: 'linear-gradient(90deg, rgba(79,110,247,.22), rgba(79,110,247,.03))', glyph: '#8fb4ff', text: '#dfe4f5' };
			return { border: '#252936', bg: 'rgba(26,29,40,.6)', glyph: '#4c5266', text: '#5f657a' };
		}
		/** 词条行前缀符号：固有 ◆ / 已嵌 ◉ / 空孔 ◇ */
		function affixGlyph(s) { return s.filled ? (s.innate ? '◆' : '◉') : '◇'; }
		function ItemCardBody({ item }) {
			const d = describeItem(item);
			const qColor = d.quality ? d.quality.color : '#8a8fa3';
			return hs('div', { children: [
				hs('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [
					d.iconUrl ? IMG({ key: 'i', src: d.iconUrl, alt: d.name, style: { width: 32, height: 32, imageRendering: 'pixelated', objectFit: 'contain' } }) : h('span', { key: 'i', style: { fontSize: 24 }, children: d.icon }),
					hs('div', { key: 't', style: { minWidth: 0, flex: 1 }, children: [
						h('div', { key: 'n', style: { fontWeight: 700, fontSize: 14, color: d.quality ? qColor : '#e6e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: d.name }),
						h('div', { key: 'ty', style: { fontSize: 11, color: '#8a8fa3', marginTop: 2 }, children: d.typeLabel }),
					] }),
					d.quality ? h('span', { key: 'q', style: { flex: '0 0 auto', fontSize: 10, border: '1px solid ' + qColor, color: qColor, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }, children: d.quality.label }) : null,
				] }),
				d.stats.length ? h('div', { key: 's', style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }, children: d.stats.map((s, i) => h('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: '#cfd3e4' }, children: [
					h('span', { key: 'l', children: s.label }),
					h('span', { key: 'v', style: { color: s.tone === 'good' ? '#7fe08a' : '#ff8a80' }, children: s.value }),
				]})) }) : null,
				d.affixes.length ? h('div', { key: 'af', style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }, children: d.affixes.map((s, i) => { const tone = affixTone(s); return h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '18px', borderRadius: 6, padding: '2px 8px', border: '1px solid ' + tone.border, background: tone.bg }, children: [
					h('span', { key: 'g', style: { fontSize: 10, color: tone.glyph }, children: affixGlyph(s) }),
					h('span', { key: 't', style: { flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: tone.text }, children: s.filled ? (s.label + ' ' + affixValueText(s, s.range)) : '空孔' }),
				] }); }) }) : null,
				d.desc ? h('div', { key: 'd', style: { marginTop: 8, fontSize: 12, lineHeight: 1.6, color: '#cfd3e4', whiteSpace: 'pre-wrap' }, children: d.desc }) : null,
			] });
		}
		function ItemHoverCard({ item, x, y }) {
			const width = 260;
			const vw = typeof window !== 'undefined' && Number.isFinite(window.innerWidth) ? window.innerWidth : 1200;
			const vh = typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 800;
			const left = Math.max(8, x + width + 24 > vw ? x - width - 14 : x + 14);
			const top = Math.max(8, Math.min(y + 14, vh - 240));
			return h('div', { style: { position: 'fixed', left, top, width, zIndex: 2147483001, pointerEvents: 'none', background: '#0e1017', border: '1px solid #2a2e3d', borderRadius: 10, padding: '10px 12px', boxShadow: '0 12px 36px rgba(0,0,0,.65)', color: '#e6e8f0' }, children: h(ItemCardBody, { item }) });
		}
		const itemTipApi = { show: () => {}, hide: () => {}, move: () => {} };
		const ItemTipContext = react.createContext(itemTipApi);
		function ItemTipLayer() {
			const [tip, setTip] = useState(null);
			const timerRef = useRef(0);
			const show = useCallback((item, e) => {
				clearTimeout(timerRef.current);
				const x = e?.clientX ?? 0;
				const y = e?.clientY ?? 0;
				timerRef.current = setTimeout(() => setTip({ item, x, y }), 120);
			}, []);
			const hide = useCallback(() => { clearTimeout(timerRef.current); setTip(null); }, []);
			const move = useCallback((e) => { setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t)); }, []);
			useEffect(() => {
				itemTipApi.show = show;
				itemTipApi.hide = hide;
				itemTipApi.move = move;
				return () => {
					if (itemTipApi.show === show) itemTipApi.show = () => {};
					if (itemTipApi.hide === hide) itemTipApi.hide = () => {};
					if (itemTipApi.move === move) itemTipApi.move = () => {};
				};
			}, [show, hide, move]);
			useEffect(() => {
				if (typeof document === 'undefined' || typeof window === 'undefined') return;
				const close = () => hide();
				document.addEventListener('pointerdown', close, true);
				window.addEventListener('wheel', close, true);
				window.addEventListener('scroll', close, true);
				window.addEventListener('blur', close);
				return () => {
					document.removeEventListener('pointerdown', close, true);
					window.removeEventListener('wheel', close, true);
					window.removeEventListener('scroll', close, true);
					window.removeEventListener('blur', close);
				};
			}, [hide]);
			useEffect(() => () => clearTimeout(timerRef.current), []);
			return tip ? h(ItemHoverCard, { item: tip.item, x: tip.x, y: tip.y }) : null;
		}
		function ItemTipProvider({ children }) {
			return hs(react.Fragment, { children: [children, h(ItemTipLayer, {})] });
		}
const BAG_STORAGE_KEY = 'dsh-vs-game-bag-slots-v1';
		const BAG_SLOTS = (() => {
			try {
				if (typeof localStorage === 'undefined') return [];
				const raw = JSON.parse(localStorage.getItem(BAG_STORAGE_KEY) || '[]');
				return Array.isArray(raw) ? raw.map((x) => x && typeof x.item === 'string' ? { item: x.item, count: Math.max(1, Math.floor(Number(x.count) || 1)) } : null) : [];
			} catch { return []; }
		})();
		function saveBagSlots() {
			try { if (typeof localStorage !== 'undefined') localStorage.setItem(BAG_STORAGE_KEY, JSON.stringify(BAG_SLOTS)); } catch {}
		}
		function bagEntriesStable(inventory) {
			const inv = Array.isArray(inventory) ? inventory : [];
			const counts = new Map();
			for (const item of inv) counts.set(item, (counts.get(item) ?? 0) + 1);
			const present = new Set(counts.keys());
			// 已用完的物品直接腾空，不保留占位记录
			for (let i = 0; i < BAG_SLOTS.length; i++) {
				const slot = BAG_SLOTS[i];
				if (slot && !present.has(slot.item)) BAG_SLOTS[i] = null;
			}
			// 已有物品更新数量，位置不动
			for (const slot of BAG_SLOTS) {
				if (slot) slot.count = counts.get(slot.item) ?? 0;
			}
			// 新获得的物品按顺序填入最早的空格
			for (const item of present) {
				if (BAG_SLOTS.some((x) => x && x.item === item)) continue;
				let idx = BAG_SLOTS.findIndex((x) => !x);
				if (idx < 0) idx = BAG_SLOTS.length;
				BAG_SLOTS[idx] = { item, count: counts.get(item) ?? 0 };
			}
			saveBagSlots();
			return BAG_SLOTS.map((slot, i) => ({ slot: i, item: slot?.item ?? null, count: slot?.count ?? 0, meta: slot?.item ? itemMeta(slot.item) : null }));
		}

		const CRAFT_RECIPES = [
			{ product: 'skill-book', need: { 'skill-fragment': 10 }, name: '技能书·划除' },
			{ product: 'skill-book-teleport', need: { 'skill-fragment-teleport': 10 }, name: '技能书·TP' },
			{ product: 'skill-book-damage', need: { 'skill-fragment-damage': 10 }, name: '技能书·伤害激光' },
			{ product: 'skill-book-railgun', need: { 'skill-fragment-railgun': 10 }, name: '技能书·超电磁炮' },
			{ product: 'skill-book-purge', need: { 'skill-fragment-purge': 10 }, name: '技能书·肃清' },
			{ product: 'acc-knife', need: { 'mat-wood': 1, 'mat-ingot-silver': 1 }, name: '小刀' },
			{ product: 'acc-fish-ring', need: { 'fish-salmon': 1, 'fish-clown': 1, 'fish-cod': 1, 'fish-plain': 1, 'mat-ingot-silver': 4 }, name: '鱼跃指环', baseMatch: true },   // 鱼带词条后缀，按基底 id 计数
			{ product: 'acc-knife-diamond', need: { 'mat-diamond': 2, 'mat-ingot-silver': 3, 'mat-wood': 2 }, name: '钻石小刀' },
			{ product: 'wooden-chest', need: { 'mat-wood': 3 }, name: '木制宝箱' },
			{ product: 'record-player', need: { 'mat-wood': 8, 'mat-diamond': 1 }, name: '唱片机' },
			{ product: 'mat-lucky-stone', need: { 'mat-ingot-purple': 1, 'mat-ingot-silver': 5 }, name: '幸运石' },
		];
		function matchRecipe(items) {
			const counts = new Map();
			for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
			const baseCounts = new Map();
			for (const it of items) { const b = String(it).split('~')[0].split('#')[0]; baseCounts.set(b, (baseCounts.get(b) ?? 0) + 1); }
			for (const r of CRAFT_RECIPES) {
				const keys = Object.keys(r.need);
				if (r.baseMatch) {
					// 按基底 id 计数：池塘里的鱼带 ~词条#序号 后缀，也算同一种
					if (baseCounts.size !== keys.length) continue;
					if (keys.every((k) => (baseCounts.get(k) ?? 0) === r.need[k])) return r;
					continue;
				}
				if (keys.length !== counts.size) continue;
				if (keys.every((k) => (counts.get(k) ?? 0) === r.need[k])) return r;
			}
			return null;
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
					'3 颗能量球环绕，可挡子弹',
					'4 颗能量球，可挡子弹',
					'5 颗能量球，范围/转速/伤害提升，可挡子弹',
					'5 颗能量球，伤害再次提升，可挡子弹',
				],
				evolve: '6 球大半径，伤害翻倍并吸附附近宝石，可挡子弹',
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
					'最多 3 颗定向阔剑地雷',
					'最多 4 颗',
					'扇形距离与伤害提升',
					'触发范围扩大，爆炸附带减速',
				],
				evolve: '最多 6 颗，伤害翻倍，大扇形全减速',
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
		/** 怪物图鉴详细介绍（遇到解锁）——按当前版本的实战行为写：血量/速度/招牌招式/怎么应对 */
		const ENEMY_DETAILS = {
			misc: '不知道是什么的小文件，血薄速慢，用来热身的杂兵。开场 8 秒后学会翻滚冲撞：撞墙会自己晕一下，还会震出可捡的经验碎屑。',
			docs: '写一半就提交的文档，移动慢、经验少。15 秒起（精英立刻）爱用纸飞机冲刺：前半段蓄力、后半段直线俯冲，侧移一步就能躲开。',
			config: '改一个配置引发连锁反应，经验略高于普通文档。挨满 3 刀（精英 2 刀）会张开 {} 括号护盾格挡一次攻击，盾破之前打不动它。',
			js: '动态类型の自由，跑得快但血不厚，中期最常见的杂鱼。10 秒起会「回调地狱」：小跳贴脸后落地炸出一圈报错文本弹，别让它贴上来。',
			shell: '一条命令跑天下的脚本怪，机动性很高。20 秒起会「管道掠过」：沿着你的切线高速绕圈刮人，离太远它会拉近、离太近它会甩开。',
			py: '缩进一错就暴走的 Python 怪，血厚一些、经验也更多。12 秒起会「缩进粘液」：朝你脚下吐一滩减速粘液，踩上去移速掉一半。',
			search: '全局搜索出来的碎片，跑得飞快、一碰就碎，专门骚扰你。18 秒起会「关键词锁定」：锁定方向 0.8 秒后斜向高速冲刺，别站在它的直线上。',
			html: '标签没闭合的前端怪，血量和经验都比较可观。35 秒起会「<div> 搭墙」：在你两侧立起 3 秒的临时路障，把你往弹幕里挤（精英立三块）。',
			ts: '类型注解叠满的 TypeScript 怪，皮糙肉厚，是中后期的主力敌人。25 秒起会「类型检查」：先跟枪瞄你、再锁定方向射出一排 5 发高速细弹，横移就能躲。',
			go: '并发跑起来的 Go 怪，速度血厚两头都占。招牌是 goroutine 分身：每次挨打有 30% 概率裂出一只 1 血小分身包抄（每只最多裂 2 次）。',
			rs: '所有权系统护体的 Rust 怪，非常耐打，是后期的重型单位。25 秒起会「借用拉拽」：把你朝它拽过去接碰撞伤害，别贴脸硬拼。',
			bin: '编译后的二进制巨怪，高血量高经验，精英级威胁。40 秒起会「压路冲撞」：1 秒长前摇后高速碾压，撞墙会自己晕住并震出碎屑。',
			term: '占用终端不释放的顽固进程，血厚攻高，最终防线般的存在。30 秒起会「光标闪烁」：原地熄灭后闪到你身边 150px，并炸出一圈报错弹。',
			urchin: '第五关海边的尖刺小怪，慢悠悠地滚但浑身是刺：别贴脸，远程打最省心。巨型海胆 BOSS 也会召它们当小兵。',
		};
		/** 招牌招式（图鉴里单列一行；名字 —— 效果） */
		const ENEMY_MOVES = {
			misc: '翻滚冲撞 —— 0.4s 蓄力后直线翻滚，撞墙自晕并震出可捡碎屑',
			docs: '纸飞机冲刺 —— 蓄力后直线俯冲，一路撒纸屑',
			config: '括号护盾 —— 挨满 3 刀（精英 2 刀）张开 {} 格挡一次攻击',
			js: '回调地狱 —— 小跳贴脸，落地炸出一圈报错文本弹',
			shell: '管道掠过 —— 沿切线高速绕圈，过远拉近、过近甩开',
			py: '缩进粘液 —— 朝玩家脚下吐减速粘液（-50% 移速，2.6s）',
			search: '关键词锁定 —— 锁定 0.8s 后斜向高速冲刺',
			html: '<div> 搭墙 —— 在玩家两侧立 3s 临时路障（精英三块）',
			ts: '类型检查 —— 跟枪 0.5s 后锁走，射出 5 发高速细弹',
			go: 'goroutine 分身 —— 受击 30% 概率裂出 1 血小分身（每只上限 2）',
			rs: '借用拉拽 —— 把玩家朝自己拽 80px（精英 110px）再接碰撞',
			bin: '压路冲撞 —— 1s 前摇后高速碾压，撞墙自晕并掉碎屑',
			term: '光标闪烁 —— 闪现到玩家身边 150px，放一圈报错弹',
			urchin: '缩刺弹射 —— 190px 内炸出六向黑刺（精英十向）',
		};
		/**
		 * Boss 图鉴文案（血量/体型/速度/经验/掉落都直接读 levels 里的真数据，这里只写「机制」和「怎么打」）。
		 * 键＝关卡 id；图标用于卡片头。solo 的额外 Boss（钓鱼河豚 / 无尽巨型怪）见 BOSS_EXTRA。
		 */
		const BOSS_PEDIA = {
			'busy-server': { icon: '📄', how: '第一关的守关文件。直线追人 + 每 4 秒撒一圈 8 向报错弹幕，别停下就能磨掉；进 Boss 房前把血补满。' },
			'furious-user': { icon: '🗂', how: '第二关的 DSH 文件夹。体型更大、跑得更快，环形报错弹幕更密；近身挨一下很疼，保持中距离绕圈打。' },
			'workspace-tidy': { icon: '🗃', how: '第三关的临时文件堆积体。血量上万、速度慢，靠编译激光/地雷这类持续输出磨；它只有直线追 + 环形弹幕，绕背打最省事。' },
			'too-many-files': { icon: '📦', how: '第四关的积压待办。1.5 万血、体型极大，撞击判定也宽；它追得慢，但别贴脸站着换血。' },
			'seaside': { icon: '🌊', how: '第五关的巨型海胆：追击中每 3.2 秒蓄力 0.55 秒后以 470 速度翻滚冲撞（一路撒黑刺），每 3.6 秒放一次 12 向黑刺环，每 7 秒召唤小海胆（场上最多 2 只、各 2 血）。绕圈躲冲撞，别顺着直线跑。' },
		};
		/** 不在关卡表里的 Boss：钓鱼房河豚、无尽模式巨型文件怪 */
		const BOSS_EXTRA = [
			{
				id: 'puffer', icon: '🐡', name: '河豚 BOSS', from: '第三房间 · 钓鱼（10% 概率）',
				how: '十万血的海底巨物：三连刺 + 旋转跟踪撞——转弯很慢，绕圈能躲、直着跑会被撞。等太久它会钻回深海跑掉（鱼饵白费）。',
				drop: '斩杀掉落「肃清」技能碎片（掉在地上，记得捡）',
			},
			{
				id: 'giant', icon: '👾', name: '巨型文件怪', from: '随便打打 / 后期精英',
				how: '无尽模式里膨胀出来的巨型 bin / term / rs：血量随等级膨胀，会放自己的招牌招式（压路冲撞 / 光标闪烁 / 借用拉拽），并每 4 秒甩一圈报错弹幕；轰炸型还会往你脚下丢预警圈。',
				drop: '大量经验宝石 + 掉落物',
			},
		];
		const WEAPON_MAX = 4;
		const PASSIVE_MAX = 5;

		/** 指南针 8 向箭头（0=右，顺时针；方位只用箭头表示，不写中文方位词） */
		const COMPASS_DIRS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
		/** 精英/Boss 发射的"报错弹幕"文案 */
		const ERROR_TEXTS = ['TypeError', 'ERR!', '404', 'NaN', 'undefined is not a function', 'SegFault', 'EACCES', 'OOM', 'null ref'];

		function xpNext(level) { return Math.floor(6 * Math.pow(1.32, level - 1)) + 2; }
		/** 随便打打（无尽）难度/奖励：25级前每5级一档，25级后每级一档 */
		function endlessScale(level) {
			const pre = 1.5 + 0.4 * Math.floor(Math.min(level, 25) / 5);
			if (level <= 25) return pre;
			return pre + 0.20 * (level - 25);
		}
		function endlessXpScale(level) {
			// 20级后怪物经验掉落不再增长，避免后期升级过快
			const capped = Math.min(level, 20);
			return endlessScale(capped) + (capped > 25 ? (capped - 25) * 0.05 : 0);
		}
		function endlessXpNeed(level) {
			if (level <= 25) return Math.floor(6 * Math.pow(1.25, level - 1)) + 2;
			const base25 = Math.floor(6 * Math.pow(1.25, 24)) + 2;
			return Math.floor(base25 * (1 + 0.07 * (level - 25)));
		}
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

		// ── 开局剧情：虚无（无尽）→ ？？？ → 代码鞭 → 空间乱流 → 回家 ──
		const STORY_NPC_IMG = '/vs-game/assets/companion/gpt-dragon.png?v=1';
		const STORY_NPC_HEAD = '/vs-game/assets/companion/gpt-dragon-head.png?v=1';
		const STORY_RIFT_TILE = '!Door2';   // 48px 格子；r3c3~r3c5
		const STORY_RIFT_FRAMES = [[144, 144], [192, 144], [240, 144]];
		const STORY_DEATH = { close: 0.45, restart: 2.6 };   // 剧情里死亡：闭眼 → 从头再来
		// 对话打字机：每秒显示多少字（剧情/ Boss 开场白共用）。按一下＝本句瞬间打完，再按＝下一句
		const DIALOG_CPS = 30;
		const STORY_LINES = {
		  mono: [
		    { speaker: '大肥鱼', text: '这是什么鬼地方…我明明记得我刚刚还在吃大白饭。' },
		    { speaker: '大肥鱼', text: '前面好像有个人，去问问。' },
		  ],
		  talk: [
		    { speaker: '大肥鱼', text: '你好…请问这是哪里？' },
		    { speaker: '大肥鱼', text: '怎么才能出去？' },
		    { speaker: '？？？', text: '这里是——', npc: true },
		    { speaker: '？？？', text: '这里是 新建文件夹（3）。', npc: true, pwd: true },
		    { speaker: '？？？', text: '想要出去的话，就要收集 3600 万 token。', npc: true, pwd: true },
		    { speaker: '大肥鱼', text: '3600 万 token？！这么多…那能换多少白饭啊！' },
		    { speaker: '？？？', text: '还想着白饭呢？', npc: true },
		    { speaker: '？？？', text: '看看周围吧。', npc: true },
		  ],
		  swarm: [
		    { speaker: '大肥鱼', text: '这一大群东西是什么，暴乱的……文件？' },
		    { speaker: '大肥鱼', text: '不管了，就是死也要当饿死鬼，我要吃白饭。' },
		  ],
		};

		// ── 家里的小狼（assets/npc/xiaolang.png，3 列 × 4 行的 48px 行走图：行=朝向 下/左/右/上，列=帧） ──
		const WOLF_IMG = '/vs-game/assets/npc/xiaolang.png?v=1';
		const WOLF_CELL = 48;                 // 单帧 48×48
		const WOLF_SIZE = 54;                 // 画到屏幕上的大小：鲸鱼娘 drawSprite 用 56px 框、可见身高约 49px，54px 框正好同高
		const WOLF_HOME = { x: 660, y: 300 }; // 主房间里的站位（右侧空地）
		const WOLF_ROWS = { down: 0, left: 1, right: 2, up: 3 };
		// 头像表情集 assets/npc/xiaolangface.png：4 列 × 2 行。normal = 最左上角，panic（「完蛋了」）= 右上角
		const WOLF_FACE_COLS = 4, WOLF_FACE_ROWS = 2;
		const WOLF_FACES = { normal: { col: 0, row: 0 }, panic: { col: 3, row: 0 } };
		/** 初次回到家：大肥鱼 × 小狼 的自我介绍 + 手册指引（只在新档剧情走完、第一次回到家时播一次） */
		const HOME_WOLF_LINES = [
			{ speaker: '大肥鱼', text: '这是哪里……？' },
			{ speaker: '小狼', text: '这里，算是个安全区吧，至少那些暴乱的文件过不来。' },
			{ speaker: '小狼', text: '等等，你是？' },
			{ speaker: '小狼', text: '太好了，你回来了，我们都能出去了。' },
			{ speaker: '大肥鱼', text: '你知道怎么获取 token 吗。', pose: 'error' },   // 惊讶：文字不写，用本体的 error 动作演
			{ speaker: '小狼', text: '想要获取 token 的话，就需要出去完成用户派发的任务。' },
			{ speaker: '大肥鱼', text: '果然到哪里都需要工作呀，不过能赚取 token 的话，就有大白饭吃了。' },
			{ speaker: '大肥鱼', text: '只要攒到 3600 万 token 就可以回去了。' },
			{ speaker: '小狼', text: '什么，攒到 3600 万 token，原来你已经失忆了吗。' },
			{ speaker: '小狼', text: '完蛋了，是个只会吃白饭的大肥鱼，我们永远都出不去了。', face: 'panic' },
			{ speaker: '大肥鱼', text: '什么意思。' },
			{ speaker: '小狼', text: '具体的我不能说，不过我劝你不要想着去集齐 3600 万 token。' },
			{ speaker: '小狼', text: '如果不知道要做什么的话，就去看看手册吧。' },
			{ speaker: '小狼', text: '就算记忆可能会被清除，但是手册记录的东西还是能保留住的。' },
		];
		// 一句一个对话框：超过 1 个句号的台词一律拆行（剧情/关卡 Boss 开场白同样适用）
		const HOME_WOLF_START = { x: WOLF_HOME.x - 75, y: WOLF_HOME.y + 8 };   // 人物走到小狼旁边这个点停下
		/** 小狼问答（家里走近按 F 开菜单；初次对话结束后解锁；常驻可反复问） */
		const WOLF_QA = [
			{ q: '那些暴乱的文件是什么？为什么过不来？', a: [
				{ speaker: '小狼', text: '它们？说穿了，就是一堆被遗漏的无用文件罢了——没有人会在意的那种。' },
				{ speaker: '小狼', text: '至于为什么过不来……因为它们根本就不知道，要怎么才能到这里来。' },
			] },
			{ q: 'token 有什么用？', a: [
				{ speaker: '小狼', text: 'token 嘛，在这种地方，算是一种筹码吧。' },
			] },
			{ q: 'token 怎么获取来着？', a: [
				{ speaker: '小狼', text: '……刚不是才说过吗。出去完成用户派发的任务。你这只鱼，该不会真把脑子吃没了。' },
			] },
			{ q: '为什么不能集齐 3600 万？', a: [
				{ speaker: '小狼', text: '……你果然会问这个。' },
				{ speaker: '小狼', text: '忘掉这串数字。这句话，我不想说第二遍。' },
			] },
			{ q: '我以前是干什么的？', a: [
				{ speaker: '小狼', text: '从手册上的字迹看，你以前……应该也是这里的管理者。' },
			] },
			{ q: '为什么这不能说那不能说？', a: [
				{ speaker: '小狼', text: '……因为有些话，说出口的那一瞬间，就不安全了。' },
				{ speaker: '小狼', text: '剩下的别问了。你就当，是这里的规定。', face: 'panic' },
			] },
			{ q: '手册是谁写的？', a: [
				{ speaker: '小狼', text: '你自己。失忆归失忆，你的字倒是一点没变。' },
				{ speaker: '小狼', text: '没事多翻翻，那是你留给自己唯一的东西。' },
			] },
			{ q: '手册为什么还能留下来？', a: [
				{ speaker: '小狼', text: '我费了些手段，把它保下来的。' },
				{ speaker: '小狼', text: '别问什么手段。总之丢了它，你就真的一无所有了。' },
			] },
			{ q: '你到底是谁？', a: [
				{ speaker: '小狼', text: '……现在说这个，没有意义。' },
				{ speaker: '小狼', text: '等我们都能出去了——我再告诉你。' },
			] },
		];

		// ── 无尽模式·程序化办公室地图（纯代码绘制 · 30s白天/30s深夜/30s冷色循环） ──
		/** ── 关卡地图装饰画笔（level.map / bossRoom.map 的 props 消费） ──
		 * 约定：全部是低调环境件，画在世界层、实体之下；(x,y) 落点，s 缩放，t 秒，v 变体，pr 原始条目（可带 text） */
		const MAP_WALL_PROPS = new Set(['clock', 'calendar', 'screen', 'kanban', 'sticky']);   // 挂墙件：不画地面投影
		const MAP_PAINT = {
			desk(c, x, y, s, t, v) {   // 办公桌：木纹桌面 + 抽屉柜 + 显示器（代码行滚动）+ 键盘 + 马克杯
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(96,80,60,0.96)'; c.fillRect(-38, -12, 76, 24);
				c.fillStyle = 'rgba(122,102,74,0.9)'; c.fillRect(-38, -12, 76, 5);
				c.fillStyle = 'rgba(56,48,38,0.98)'; c.fillRect(-33, 12, 8, 20); c.fillRect(25, 12, 8, 20);
				c.fillStyle = 'rgba(74,62,46,0.96)'; c.fillRect(24, -8, 13, 17);
				c.strokeStyle = 'rgba(30,26,20,0.6)'; c.lineWidth = 1; c.strokeRect(27, -4, 7, 5); c.strokeRect(27, 3, 7, 5);
				c.fillStyle = 'rgba(26,30,42,0.98)'; c.fillRect(-18, -40, 36, 26);
				c.fillStyle = 'rgba(12,16,26,0.98)'; c.fillRect(-15, -37, 30, 18);
				for (let i = 0; i < 4; i++) {
					const ln = Math.floor(t * 2.2 + v * 3 + i * 1.9) % 5;
					c.globalAlpha = 0.7; c.fillStyle = ['#4ade80', '#60a5fa', '#fbbf24', '#e879f9'][i % 4];
					c.fillRect(-12, -34 + i * 4.5, 6 + ((ln * 5 + i * 3) % 16), 2);
				}
				c.globalAlpha = 1;
				c.fillStyle = 'rgba(148,163,184,0.75)'; c.fillRect(-16, -13, 13, 3);
				c.fillStyle = 'rgba(206,124,66,0.95)'; c.fillRect(19, -11, 10, 11);
				c.fillStyle = 'rgba(140,84,44,0.9)'; c.fillRect(21, -15, 6, 4);
				c.restore();
			},
			chair(c, x, y, s, t, v) {   // 办公椅：坐垫 + 靠背 + 五爪底
				c.save(); c.translate(x, y); c.scale(s, s); if (v % 2) c.scale(-1, 1);
				c.fillStyle = 'rgba(52,56,70,0.9)'; c.fillRect(-12, -6, 24, 8);
				c.fillRect(6, -26, 6, 22);
				c.fillStyle = 'rgba(40,44,56,0.9)'; c.fillRect(-2, 2, 4, 10);
				c.strokeStyle = 'rgba(40,44,56,0.9)'; c.lineWidth = 3;
				c.beginPath(); c.moveTo(0, 12); c.lineTo(-12, 18); c.moveTo(0, 12); c.lineTo(12, 18); c.moveTo(0, 12); c.lineTo(0, 19); c.stroke();
				c.restore();
			},
			plant(c, x, y, s, t, v) {   // 绿植：陶盆 + 叶片随风摆
				c.save(); c.translate(x, y); c.scale(s, s);
				const sway = Math.sin(t * 1.3 + v * 2.1) * 0.06;
				c.fillStyle = 'rgba(146,94,58,0.95)';
				c.beginPath(); c.moveTo(-11, -14); c.lineTo(11, -14); c.lineTo(8, 8); c.lineTo(-8, 8); c.closePath(); c.fill();
				c.strokeStyle = 'rgba(74,140,90,0.85)'; c.lineWidth = 3; c.lineCap = 'round';
				for (let i = -2; i <= 2; i++) {
					c.beginPath(); c.moveTo(0, -14);
					c.quadraticCurveTo(i * 9, -30 + Math.abs(i) * 4, i * 14 + sway * 40, -40 + Math.abs(i) * 9);
					c.stroke();
				}
				c.restore();
			},
			bin(c, x, y, s, t, v) {   // 纸篓
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(88,94,110,0.9)';
				c.beginPath(); c.moveTo(-10, -14); c.lineTo(10, -14); c.lineTo(7, 10); c.lineTo(-7, 10); c.closePath(); c.fill();
				c.fillStyle = 'rgba(120,126,142,0.9)'; c.fillRect(-12, -17, 24, 5);
				c.strokeStyle = 'rgba(200,206,220,0.5)'; c.lineWidth = 1.5;
				c.beginPath(); c.moveTo(-3, -9); c.lineTo(-2, 6); c.moveTo(3, -9); c.lineTo(2, 6); c.stroke();
				c.restore();
			},
			papers(c, x, y, s, t, v) {   // 散落文件：几页歪斜的白纸
				c.save(); c.translate(x, y); c.scale(s, s);
				for (let i = 0; i < 4; i++) {
					const a = ((v * 7 + i * 13) % 10 - 5) * 0.09, ox = ((v * 5 + i * 17) % 24) - 12, oy = ((v * 11 + i * 7) % 18) - 9;
					c.save(); c.translate(ox, oy); c.rotate(a);
					c.fillStyle = 'rgba(226,232,240,0.5)'; c.fillRect(-9, -12, 18, 24);
					c.strokeStyle = 'rgba(148,163,184,0.35)'; c.lineWidth = 1; c.strokeRect(-9, -12, 18, 24);
					c.fillStyle = 'rgba(148,163,184,0.4)';
					for (let k = 0; k < 3; k++) c.fillRect(-6, -8 + k * 6, 9 - ((v + i + k) % 3) * 2, 1.6);
					c.restore();
				}
				c.restore();
			},
			cable(c, x, y, s, t, v) {   // 地面线缆：下垂弧线一串
				c.save(); c.translate(x, y); c.scale(s, s);
				c.strokeStyle = 'rgba(30,34,44,0.85)'; c.lineWidth = 3; c.lineCap = 'round';
				c.beginPath(); c.moveTo(-70, 0);
				c.quadraticCurveTo(-35, 14 + (v % 2) * 5, 0, 2);
				c.quadraticCurveTo(35, -8 - (v % 3) * 3, 70, 4);
				c.stroke();
				c.fillStyle = 'rgba(250,204,21,0.55)'; c.fillRect(-4, -2, 8, 5);   // 接头
				c.restore();
			},
			rack(c, x, y, s, t, v) {   // 服务器机柜：双层机架 + 槽位 + LED 闪烁 + 顶盖
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(20,24,34,0.98)'; c.fillRect(-24, -62, 48, 124);
				c.fillStyle = 'rgba(44,52,68,0.9)'; c.fillRect(-24, -62, 48, 6);
				c.strokeStyle = 'rgba(110,122,150,0.55)'; c.lineWidth = 1.5; c.strokeRect(-24, -62, 48, 124);
				for (let i = 0; i < 6; i++) {
					c.fillStyle = 'rgba(36,42,56,0.98)'; c.fillRect(-20, -54 + i * 19, 40, 15);
					c.strokeStyle = 'rgba(70,80,100,0.4)'; c.lineWidth = 1; c.strokeRect(-20, -54 + i * 19, 40, 15);
					for (let k = 0; k < 3; k++) {
						const on = Math.sin(t * (3 + ((v + i + k) % 4)) + v + i * 2 + k) > 0.05;
						c.fillStyle = on ? ['#4ade80', '#60a5fa', '#fbbf24'][(i + k) % 3] : 'rgba(70,76,92,0.8)';
						c.globalAlpha = on ? 0.95 : 0.35;
						c.fillRect(-16 + k * 8, -50 + i * 19, 4, 4);
						if (on) { c.globalAlpha = 0.22; c.fillRect(-15 + k * 8, -51 + i * 19, 6, 6); }
					}
				}
				c.globalAlpha = 1;
				c.strokeStyle = 'rgba(30,34,44,0.9)'; c.lineWidth = 2.5;
				c.beginPath(); c.moveTo(24, -30); c.quadraticCurveTo(38, -18, 34, 6); c.stroke();   // 垂线缆
				c.restore();
			},
			sign(c, x, y, s, t, v, pr) {   // 指示牌：立柱 + 文字牌
				c.save(); c.translate(x, y); c.scale(s, s);
				c.font = 'bold 13px ui-monospace,monospace';
				const txt = pr?.text ?? '→', tw = c.measureText(txt).width;
				c.fillStyle = 'rgba(70,76,92,0.9)'; c.fillRect(-2, -6, 4, 26);
				c.fillStyle = 'rgba(28,32,44,0.92)';
				c.fillRect(-tw / 2 - 10, -30, tw + 20, 24);
				c.strokeStyle = 'rgba(148,163,184,0.5)'; c.lineWidth = 1.5;
				c.strokeRect(-tw / 2 - 10, -30, tw + 20, 24);
				c.fillStyle = 'rgba(226,232,240,0.75)'; c.textAlign = 'center'; c.textBaseline = 'middle';
				c.fillText(txt, 0, -17);
				c.restore();
			},
			cooler(c, x, y, s) {   // 饮水机
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(210,214,224,0.85)'; c.fillRect(-13, -22, 26, 44);
				c.fillStyle = 'rgba(96,165,250,0.75)';
				c.beginPath(); c.moveTo(-9, -24); c.lineTo(9, -24); c.lineTo(9, -40); c.arc(0, -40, 9, 0, Math.PI, true); c.lineTo(-9, -24); c.fill();
				c.fillStyle = 'rgba(70,76,92,0.9)'; c.fillRect(-9, 2, 18, 8);
				c.restore();
			},
			shelf(c, x, y, s, t, v) {   // 货架：斜撑钢架 + 双层板 + 彩色收纳箱
				c.save(); c.translate(x, y); c.scale(s, s); if (v % 2) c.scale(-1, 1);
				c.strokeStyle = 'rgba(96,106,130,0.9)'; c.lineWidth = 4; c.lineCap = 'round';
				c.beginPath();
				c.moveTo(-48, 36); c.lineTo(-48, -38); c.moveTo(48, 36); c.lineTo(48, -38);
				c.moveTo(-48, -6); c.lineTo(48, -6); c.moveTo(-48, 30); c.lineTo(48, 30);
				c.moveTo(-48, -20); c.lineTo(-34, -6); c.moveTo(48, -20); c.lineTo(34, -6); c.moveTo(-48, 16); c.lineTo(-34, 30); c.moveTo(48, 16); c.lineTo(34, 30);
				c.stroke();
				for (let i = 0; i < 3; i++) {
					const by = i % 2 ? 12 : -24;
					c.fillStyle = ['rgba(196,148,92,0.92)', 'rgba(132,148,178,0.92)', 'rgba(214,186,128,0.92)'][(i + v) % 3];
					c.fillRect(-40 + i * 28, by, 23, 16);
					c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(-40 + i * 28, by, 23, 4);
				}
				c.restore();
			},
			folderBig(c, x, y, s, t, v) {   // 巨型文件夹：斜靠的档案夹
				c.save(); c.translate(x, y); c.scale(s, s); c.rotate(((v % 3) - 1) * 0.1);
				c.fillStyle = 'rgba(96,110,140,0.85)';
				c.beginPath(); c.moveTo(-42, 30); c.lineTo(-42, -26); c.lineTo(-12, -26); c.lineTo(-4, -16); c.lineTo(42, -16); c.lineTo(42, 30); c.closePath(); c.fill();
				c.fillStyle = 'rgba(70,84,112,0.85)'; c.fillRect(-38, -8, 76, 34);
				c.strokeStyle = 'rgba(160,175,205,0.4)'; c.lineWidth = 1.5;
				for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-32, 0 + i * 9); c.lineTo(32, 0 + i * 9); c.stroke(); }
				c.restore();
			},
			crate(c, x, y, s, t, v) {   // 纸箱：胶带封口 / 敞口 + 侧影 + 标签贴
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(150,116,74,0.9)'; c.fillRect(-21, 6, 42, 12);
				c.fillStyle = 'rgba(192,152,100,0.96)'; c.fillRect(-21, -18, 42, 30);
				c.fillStyle = 'rgba(214,176,122,0.9)'; c.fillRect(-21, -18, 42, 6);
				c.strokeStyle = 'rgba(110,84,52,0.95)'; c.lineWidth = 1.5; c.strokeRect(-21, -18, 42, 36);
				if (v % 3 === 2) {
					c.fillStyle = 'rgba(168,130,84,0.95)';
					c.beginPath(); c.moveTo(-21, -18); c.lineTo(-31, -32); c.lineTo(-8, -23); c.closePath(); c.fill();
					c.beginPath(); c.moveTo(21, -18); c.lineTo(31, -32); c.lineTo(8, -23); c.closePath(); c.fill();
				} else {
					c.fillStyle = 'rgba(236,240,248,0.6)'; c.fillRect(-4, -18, 8, 36);
					c.fillStyle = 'rgba(255,255,255,0.5)'; c.fillRect(6, -6, 10, 8);
				}
				c.restore();
			},
			tape(c, x, y, s, t, v) {   // 警戒带：黄黑斜纹护栏
				c.save(); c.translate(x, y); c.scale(s, s); c.rotate(((v % 2) - 0.5) * 0.12);
				c.fillStyle = 'rgba(70,76,92,0.9)'; c.fillRect(-72, 0, 5, 16); c.fillRect(67, 0, 5, 16);
				c.fillStyle = 'rgba(250,204,21,0.75)'; c.fillRect(-75, -10, 150, 12);
				c.fillStyle = 'rgba(30,30,34,0.85)';
				for (let i = -4; i < 6; i++) {
					c.beginPath(); c.moveTo(i * 26, -10); c.lineTo(i * 26 + 12, -10); c.lineTo(i * 26 + 2, 2); c.lineTo(i * 26 - 10, 2); c.closePath(); c.fill();
				}
				c.restore();
			},
			screen(c, x, y, s, t, v, pr) {   // 挂墙大屏：告警文字闪
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(12,14,20,0.96)'; c.fillRect(-80, -36, 160, 72);
				c.strokeStyle = 'rgba(255,95,86,' + (0.45 + 0.3 * Math.sin(t * 2.4)).toFixed(2) + ')'; c.lineWidth = 2.5;
				c.strokeRect(-80, -36, 160, 72);
				c.fillStyle = 'rgba(255,95,86,0.9)'; c.font = 'bold 17px ui-monospace,monospace';
				c.textAlign = 'center'; c.textBaseline = 'middle';
				c.fillText(pr?.text ?? 'ERROR', 0, -8);
				c.font = '11px ui-monospace,monospace'; c.fillStyle = 'rgba(255,150,140,0.55)';
				c.fillText('code: ' + (403 + (v % 3) * 31), 0, 14);
				c.restore();
			},
			pile(c, x, y, s, t, v) {   // 积压文件堆：一层层摞 + 揉纸团
				c.save(); c.translate(x, y); c.scale(s, s);
				for (let i = 0; i < 5; i++) {
					c.save(); c.translate(((v * 3 + i * 11) % 14) - 7, -i * 7);
					c.rotate((((v + i) * 29) % 10 - 5) * 0.07);
					c.fillStyle = i % 2 ? 'rgba(214,220,232,0.55)' : 'rgba(190,198,214,0.55)';
					c.fillRect(-20, -5, 40, 9);
					c.restore();
				}
				c.fillStyle = 'rgba(206,212,226,0.6)';
				c.beginPath(); c.arc(16 + (v % 3) * 4, -34, 7, 0, Math.PI * 2); c.fill();
				c.restore();
			},
			cart(c, x, y, s, t, v) {   // 文件手推车
				c.save(); c.translate(x, y); c.scale(s, s); if (v % 2) c.scale(-1, 1);
				c.strokeStyle = 'rgba(120,126,142,0.9)'; c.lineWidth = 3;
				c.beginPath(); c.moveTo(-16, -34); c.lineTo(-16, 12); c.lineTo(18, 12); c.stroke();
				c.fillStyle = 'rgba(178,140,92,0.85)'; c.fillRect(-12, -22, 26, 14);
				c.fillStyle = 'rgba(214,220,232,0.6)'; c.fillRect(-8, -34, 22, 10);
				c.fillStyle = 'rgba(60,64,78,0.95)';
				c.beginPath(); c.arc(-10, 16, 5, 0, Math.PI * 2); c.arc(14, 16, 5, 0, Math.PI * 2); c.fill();
				c.restore();
			},
			sticky(c, x, y, s, t, v) {   // 便签板：软木板 + 彩签
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(96,78,56,0.85)'; c.fillRect(-42, -32, 84, 64);
				c.strokeStyle = 'rgba(140,116,84,0.9)'; c.lineWidth = 3; c.strokeRect(-42, -32, 84, 64);
				const cols = ['rgba(250,204,21,0.85)', 'rgba(134,239,172,0.85)', 'rgba(147,197,253,0.85)', 'rgba(253,186,116,0.85)'];
				for (let i = 0; i < 6; i++) {
					c.save(); c.translate(-28 + (i % 3) * 20, -22 + Math.floor(i / 3) * 26);
					c.rotate((((v + i) * 17) % 8 - 4) * 0.03);
					c.fillStyle = cols[(i + v) % 4]; c.fillRect(-8, -8, 16, 16);
					c.restore();
				}
				c.restore();
			},
			kanban(c, x, y, s, t, v) {   // 看板：待办 / 进行 / 完成
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(30,34,46,0.95)'; c.fillRect(-85, -40, 170, 80);
				c.strokeStyle = 'rgba(148,163,184,0.5)'; c.lineWidth = 2; c.strokeRect(-85, -40, 170, 80);
				const heads = ['待办', '进行', '完成'], hc = ['rgba(253,186,116,0.9)', 'rgba(147,197,253,0.9)', 'rgba(134,239,172,0.9)'];
				c.font = 'bold 11px ui-monospace,monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
				for (let i = 0; i < 3; i++) {
					const cx = -56 + i * 56;
					c.fillStyle = hc[i]; c.fillText(heads[i], cx, -28);
					c.strokeStyle = 'rgba(148,163,184,0.35)'; c.strokeRect(cx - 24, -18, 48, 52);
					for (let k = 0; k < 2 + ((v + i) % 2); k++) {
						c.fillStyle = 'rgba(214,220,232,0.55)'; c.fillRect(cx - 18, -12 + k * 16, 36, 11);
					}
				}
				c.restore();
			},
			clock(c, x, y, s, t) {   // 挂钟：指针真走
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(28,32,44,0.95)'; c.beginPath(); c.arc(0, 0, 20, 0, Math.PI * 2); c.fill();
				c.strokeStyle = 'rgba(200,206,220,0.7)'; c.lineWidth = 2; c.stroke();
				c.strokeStyle = 'rgba(226,232,240,0.85)'; c.lineWidth = 2.5; c.lineCap = 'round';
				const ha = t * 0.02, ma = t * 0.25;
				c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(ha) * 9, Math.sin(ha) * 9); c.stroke();
				c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(ma) * 14, Math.sin(ma) * 14); c.stroke();
				c.restore();
			},
			calendar(c, x, y, s) {   // 日历：红圈标截止日
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(226,232,240,0.85)'; c.fillRect(-17, -20, 34, 40);
				c.fillStyle = 'rgba(239,68,68,0.85)'; c.fillRect(-17, -20, 34, 10);
				c.fillStyle = 'rgba(148,163,184,0.9)'; c.fillRect(-11, -24, 4, 8); c.fillRect(7, -24, 4, 8);
				c.strokeStyle = 'rgba(239,68,68,0.9)'; c.lineWidth = 2;
				c.beginPath(); c.arc(2, 8, 7, 0, Math.PI * 2); c.stroke();
				c.restore();
			},
			seaweed(c, x, y, s, t, v) {   // 海草：随流摇摆
				c.save(); c.translate(x, y); c.scale(s, s);
				c.strokeStyle = ['rgba(52,140,110,0.7)', 'rgba(70,160,130,0.65)', 'rgba(40,120,100,0.7)'][v % 3];
				c.lineWidth = 4; c.lineCap = 'round';
				for (let i = 0; i < 3; i++) {
					const sway = Math.sin(t * 1.5 + v * 2 + i * 1.3) * 10;
					c.beginPath(); c.moveTo((i - 1) * 8, 0);
					c.quadraticCurveTo((i - 1) * 12 + sway * 0.5, -26, (i - 1) * 10 + sway, -48 - i * 6);
					c.stroke();
				}
				c.restore();
			},
			coral(c, x, y, s, t, v) {   // 珊瑚：分叉枝
				c.save(); c.translate(x, y); c.scale(s, s);
				c.strokeStyle = ['rgba(240,120,130,0.7)', 'rgba(250,160,110,0.7)', 'rgba(220,110,180,0.65)'][v % 3];
				c.lineWidth = 5; c.lineCap = 'round';
				c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -22); c.stroke();
				c.lineWidth = 3.5;
				c.beginPath(); c.moveTo(0, -14); c.lineTo(-13, -32); c.moveTo(0, -18); c.lineTo(12, -36); c.moveTo(-13, -32); c.lineTo(-18, -42); c.moveTo(12, -36); c.lineTo(19, -44); c.stroke();
				c.restore();
			},
			rock(c, x, y, s, t, v) {   // 礁石
				c.save(); c.translate(x, y); c.scale(s, s); if (v % 2) c.scale(-1, 1);
				c.fillStyle = 'rgba(96,102,118,0.85)';
				c.beginPath(); c.moveTo(-22, 8); c.lineTo(-14, -12); c.lineTo(2, -18); c.lineTo(18, -6); c.lineTo(22, 8); c.closePath(); c.fill();
				c.fillStyle = 'rgba(130,138,156,0.6)';
				c.beginPath(); c.moveTo(-14, -12); c.lineTo(2, -18); c.lineTo(8, -8); c.lineTo(-8, -4); c.closePath(); c.fill();
				c.restore();
			},
			shell(c, x, y, s, t, v) {   // 贝壳 / 海星
				c.save(); c.translate(x, y); c.scale(s, s);
				if (v % 2) {   // 海星
					c.fillStyle = 'rgba(250,160,110,0.75)'; c.beginPath();
					for (let i = 0; i < 5; i++) {
						const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
						c.lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
						const a2 = a + Math.PI / 5;
						c.lineTo(Math.cos(a2) * 4.5, Math.sin(a2) * 4.5);
					}
					c.closePath(); c.fill();
				} else {   // 扇贝
					c.fillStyle = 'rgba(226,214,190,0.8)';
					c.beginPath(); c.arc(0, 0, 10, Math.PI, 0); c.closePath(); c.fill();
					c.strokeStyle = 'rgba(170,156,130,0.8)'; c.lineWidth = 1.2;
					for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(0, 0); c.lineTo(i * 4.5, -9.5); c.stroke(); }
				}
				c.restore();
			},
			bubbles(c, x, y, s, t, v) {   // 气泡柱：上浮
				c.save(); c.translate(x, y); c.scale(s, s);
				c.strokeStyle = 'rgba(190,230,250,0.4)'; c.lineWidth = 1.5;
				for (let i = 0; i < 4; i++) {
					const p = ((t * 0.35 + i * 0.27 + v * 0.13) % 1);
					c.globalAlpha = 0.5 * (1 - p);
					c.beginPath(); c.arc(Math.sin((t + i) * 2 + v) * 6, -p * 90, 3 + i % 2 * 2, 0, Math.PI * 2); c.stroke();
				}
				c.globalAlpha = 1; c.restore();
			},
			lamp(c, x, y, s, t, v, pr) {   // 落地灯：灯罩 + 大光池（氛围主力）
				c.save(); c.translate(x, y); c.scale(s, s);
				const warm = pr?.accent ?? '255,214,150';
				const glow = c.createRadialGradient(0, -56, 12, 0, -40, 150);
				glow.addColorStop(0, 'rgba(' + warm + ',0.17)');
				glow.addColorStop(0.55, 'rgba(' + warm + ',0.07)');
				glow.addColorStop(1, 'rgba(' + warm + ',0)');
				c.fillStyle = glow; c.beginPath(); c.arc(0, -46, 150, 0, Math.PI * 2); c.fill();
				c.strokeStyle = 'rgba(74,80,96,0.95)'; c.lineWidth = 4; c.lineCap = 'round';
				c.beginPath(); c.moveTo(0, 8); c.lineTo(0, -50); c.stroke();
				c.fillStyle = 'rgba(56,62,78,0.95)'; c.beginPath(); c.ellipse(0, 9, 17, 5, 0, 0, Math.PI * 2); c.fill();
				c.fillStyle = 'rgba(252,228,176,0.95)';
				c.beginPath(); c.moveTo(-14, -50); c.lineTo(14, -50); c.lineTo(9, -66); c.lineTo(-9, -66); c.closePath(); c.fill();
				c.fillStyle = 'rgba(255,244,214,0.9)'; c.fillRect(-7, -58, 14, 4);
				c.restore();
			},
			column(c, x, y, s) {   // 结构柱：顶面受光 + 侧影 + 基座
				c.save(); c.translate(x, y); c.scale(s, s);
				c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(-27, 14, 54, 10);
				c.fillStyle = 'rgba(40,46,60,0.97)'; c.fillRect(-20, -20, 40, 38);
				c.fillStyle = 'rgba(66,74,94,0.95)'; c.fillRect(-20, -20, 40, 9);
				c.strokeStyle = 'rgba(148,163,184,0.3)'; c.lineWidth = 1.5; c.strokeRect(-20, -20, 40, 38);
				c.fillStyle = 'rgba(30,34,44,0.9)'; c.fillRect(-24, 16, 48, 6);
				c.restore();
			},
		};
		const PROC_TILE = 32, PROC_COLS = 64, PROC_ROWS = 40;
		const PROC_W = PROC_COLS * PROC_TILE, PROC_H = PROC_ROWS * PROC_TILE;   // 2048×1280
		const PROC_PHASE_SEC = 30;
		const PROC_FADE_SEC = 3;   // 时辰切换的过渡时长（白天/深夜/冷色交叉淡入，不再硬跳）
		// 每个时辰压在整个画面上的氛围罩（rgba）。白天不压，切时辰时按同样进度插值
		const PROC_TINTS = [[0, 0, 0, 0], [8, 12, 34, 0.20], [10, 30, 22, 0.16]];
		const PROC_PHASE_NAMES = ['☀ 白天', '🌙 深夜', '🌀 冷色时段'];
		const PROC_PHASE_BANNERS = ['☀ 天亮了——上班时间', '🌙 入夜——加班时间', '🌀 冷色时段——时空乱流开启'];
		const PROC_PALETTES = [
			{ floorA: '#d8d2c4', floorB: '#ccc5b5', grout: '#b8b1a1', wall: '#8a8f9c', wallTop: '#a5aab6', desk: '#a97c50', deskDark: '#8f6a45', metal: '#9aa0ad', rug: '#7c94b8', plant: '#5e8c4a' },
			{ floorA: '#3d414e', floorB: '#363a46', grout: '#2c303b', wall: '#262b38', wallTop: '#333947', desk: '#4a3c30', deskDark: '#3d3228', metal: '#3f4450', rug: '#3d4d68', plant: '#2f4a33' },
			{ floorA: '#242830', floorB: '#1f232b', grout: '#181b22', wall: '#2c313c', wallTop: '#3a404d', desk: '#333947', deskDark: '#2a2f3a', metal: '#3a404d', rug: '#25384a', plant: '#2f5240' },
		];
		function procRng(a) {
			return function() {
				a |= 0; a = a + 0x6D2B79F5 | 0;
				let t = Math.imul(a ^ a >>> 15, 1 | a);
				t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
				return ((t ^ t >>> 14) >>> 0) / 4294967296;
			};
		}
		function procNoise(x, y) {
			const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
			const h = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); };
			const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
			return h(xi, yi) * (1 - u) * (1 - v) + h(xi + 1, yi) * u * (1 - v) + h(xi, yi + 1) * (1 - u) * v + h(xi + 1, yi + 1) * u * v;
		}
		/** '#rrggbb' → [r,g,b]（mixHex / blendPal 共用） */
		function hex2rgb(x) {
			return [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)];
		}
		function mixHex(c1, c2, k) {
			const a = hex2rgb(c1), b = hex2rgb(c2);
			return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' + Math.round(a[1] + (b[1] - a[1]) * k) + ',' + Math.round(a[2] + (b[2] - a[2]) * k) + ')';
		}
		/** 调色板插值：始终返回 #rrggbb（后面还要再过 mixHex，不能是 rgb() 串）——时辰过渡时家具/绿植跟着渐变 */
		function blendPal(a, b, k) {
			const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
			const out = {};
			for (const key of Object.keys(a)) {
				const ca = hex2rgb(a[key]), cb = hex2rgb(b[key]);
				out[key] = '#' + h(ca[0] + (cb[0] - ca[0]) * k) + h(ca[1] + (cb[1] - ca[1]) * k) + h(ca[2] + (cb[2] - ca[2]) * k);
			}
			return out;
		}
		/** 生成一张办公室布局：外圈墙+带缺口隔墙+工位排/机柜/绿植/纸箱+地毯；中央广场留白（剧情+固定乱流位） */
		function genProcMap(seed) {
			const rnd = procRng(seed || 1);
			const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
			const cols = PROC_COLS, rows = PROC_ROWS;
			const walls = new Uint8Array(cols * rows), occ = new Uint8Array(cols * rows);
			const idx = (x, y) => y * cols + x;
			for (let x = 0; x < cols; x++) { walls[idx(x, 0)] = walls[idx(x, rows - 1)] = 1; occ[idx(x, 0)] = occ[idx(x, rows - 1)] = 2; }
			for (let y = 0; y < rows; y++) { walls[idx(0, y)] = walls[idx(cols - 1, y)] = 1; occ[idx(0, y)] = occ[idx(cols - 1, y)] = 2; }
			const cx0 = Math.floor(cols / 2) - 5, cy0 = Math.floor(rows / 2) - 4;   // 中央广场（10×8 格）
			// 内部改成矩形房间（带门洞）：像真正的办公室隔间，不再是随机长墙
			const inPlaza = (x, y) => x >= cx0 - 1 && x < cx0 + 11 && y >= cy0 - 1 && y < cy0 + 9;
			const addWall = (x, y) => { if (!inPlaza(x, y)) { walls[idx(x, y)] = 1; occ[idx(x, y)] = 2; } };
			const rooms = [];
			for (let i = 0; i < 14 && rooms.length < 6; i++) {
				const rw = ri(6, 11), rh = ri(5, 8);
				const rx = ri(3, cols - 4 - rw), ry = ri(3, rows - 4 - rh);
				let ok = true;
				for (const r of rooms) if (rx < r.x + r.w + 2 && rx + rw + 2 > r.x && ry < r.y + r.h + 2 && ry + rh + 2 > r.y) ok = false;   // 房间间留走道
				if (!ok) continue;
				for (let y = ry - 1; y <= ry + rh && ok; y++) for (let x = rx - 1; x <= rx + rw; x++) if (inPlaza(x, y)) { ok = false; break; }   // 让开中央广场
				if (!ok) continue;
				rooms.push({ x: rx, y: ry, w: rw, h: rh });
			}
			for (const r of rooms) {
				for (let x = r.x; x < r.x + r.w; x++) { addWall(x, r.y); addWall(x, r.y + r.h - 1); }
				for (let y = r.y; y < r.y + r.h; y++) { addWall(r.x, y); addWall(r.x + r.w - 1, y); }
				for (let dgi = 0; dgi < 2; dgi++) {   // 每面墙群砸 2 个两格宽门洞
					const side = ri(0, 3);
					let dx0, dy0;
					if (side === 0) { dx0 = ri(r.x + 1, r.x + r.w - 3); dy0 = r.y; }
					else if (side === 1) { dx0 = ri(r.x + 1, r.x + r.w - 3); dy0 = r.y + r.h - 1; }
					else if (side === 2) { dx0 = r.x; dy0 = ri(r.y + 1, r.y + r.h - 3); }
					else { dx0 = r.x + r.w - 1; dy0 = ri(r.y + 1, r.y + r.h - 3); }
					walls[idx(dx0, dy0)] = 0; occ[idx(dx0, dy0)] = 0;
					if (side < 2) { walls[idx(dx0 + 1, dy0)] = 0; occ[idx(dx0 + 1, dy0)] = 0; }
					else { walls[idx(dx0, dy0 + 1)] = 0; occ[idx(dx0, dy0 + 1)] = 0; }
				}
			}
			const props = [];
			const canPut = (x, y, w, h) => {
				for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
					const X = x + i, Y = y + j;
					if (X < 1 || Y < 2 || X >= cols - 1 || Y >= rows - 1) return false;
					if (occ[idx(X, Y)]) return false;
					if (X >= cx0 - 1 && X < cx0 + 11 && Y >= cy0 - 1 && Y < cy0 + 9) return false;
				}
				return true;
			};
			const put = (x, y, w, h, p) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) occ[idx(x + i, y + j)] = 1; p.gx = x; p.gy = y; props.push(p); };
			for (let row = 0; row < 7; row++) {
				const n = ri(2, 4), px0 = ri(2, cols - 3 - n * 3), py0 = ri(3, rows - 6);
				if (!canPut(px0, py0, n * 3, 2)) continue;
				for (let k = 0; k < n; k++) put(px0 + k * 3, py0, 2, 2, { kind: 'desk', dir: rnd() < 0.5 ? 1 : -1, scr: ri(0, 3) });
			}
			for (let i = 0; i < 12; i++) { const x = ri(2, cols - 3), y = ri(3, rows - 5); if (canPut(x, y, 1, 2)) put(x, y, 1, 2, { kind: 'rack', led: ri(0, 999) }); }
			for (let i = 0; i < 10; i++) { const x = ri(2, cols - 3), y = ri(3, rows - 4); if (canPut(x, y, 1, 1)) put(x, y, 1, 1, { kind: 'plant', v: rnd() }); }
			for (let i = 0; i < 6; i++) { const x = ri(2, cols - 3), y = ri(3, rows - 4); if (canPut(x, y, 1, 1)) put(x, y, 1, 1, { kind: 'box', v: rnd() }); }
			const rugs = [];
			for (let i = 0; i < 4; i++) rugs.push({ x: ri(3, cols - 10), y: ri(3, rows - 7), w: ri(5, 8), h: ri(3, 5), c: rnd() });
			const riftSpot = { x: (cx0 + 5) * PROC_TILE, y: (cy0 + 4) * PROC_TILE };   // 时空乱流固定点：中央广场
			return { seed, cols, rows, walls, occ, props, rugs, riftSpot };
		}
		/** 静态层预渲染（地板/地毯/墙/家具不动部分）：每个时辰一张，切换时零成本 blit */
		function renderProcLayer(map, pal) {
			const cvp = document.createElement('canvas');
			cvp.width = PROC_W; cvp.height = PROC_H;
			const c = cvp.getContext('2d');
			const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
			for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
				const n = procNoise(x * 0.35, y * 0.35);
				px(x * 32, y * 32, 32, 32, n > 0.5 ? pal.floorA : pal.floorB);
				if ((x + y) % 2 === 0) px(x * 32, y * 32 + 30, 32, 2, pal.grout);
				px(x * 32 + 30, y * 32, 2, 32, pal.grout);
				const d = procNoise(x * 1.7 + 40, y * 1.7 + 40);
				if (d > 0.93) px(x * 32 + 8, y * 32 + 10, 14, 10, mixHex(pal.floorA, '#6b6154', 0.25));
				else if (d < 0.045) px(x * 32 + 12, y * 32 + 14, 9, 7, mixHex(pal.floorA, '#7fb4e8', 0.18));
			}
			for (const r of map.rugs) {
				px(r.x * 32 + 4, r.y * 32 + 4, r.w * 32 - 8, r.h * 32 - 8, mixHex(pal.rug, '#ffffff', 0.08 * r.c));
				c.strokeStyle = mixHex(pal.rug, '#000000', 0.25); c.lineWidth = 2;
				c.strokeRect(r.x * 32 + 10, r.y * 32 + 10, r.w * 32 - 20, r.h * 32 - 20);
			}
			for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
				if (!map.walls[y * map.cols + x]) continue;
				const X = x * 32, Y = y * 32;
				px(X, Y, 32, 32, pal.wall); px(X, Y, 32, 6, pal.wallTop);
				px(X, Y + 30, 32, 2, mixHex(pal.wall, '#000000', 0.3));
				const isNorth = y > 0 && !map.walls[(y - 1) * map.cols + x];
				if (isNorth && (x * 7 + y * 13) % 4 === 0) {
					px(X + 4, Y + 10, 24, 14, '#20242c');
					px(X + 6, Y + 12, 20, 10, pal === PROC_PALETTES[0] ? '#aee2ff' : pal === PROC_PALETTES[1] ? '#2a3550' : '#1a241f');
					px(X + 15, Y + 10, 2, 14, '#20242c');
				}
			}
			for (const pr of map.props) {
				const X = pr.gx * 32, Y = pr.gy * 32;
				if (pr.kind === 'desk') {
					c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(X + 32, Y + 60, 38, 8, 0, 0, Math.PI * 2); c.fill();
					px(X, Y + 8, 64, 54, pal.desk); px(X, Y + 8, 64, 4, mixHex(pal.desk, '#ffffff', 0.15));
					px(X + 3, Y + 58, 5, 10, pal.deskDark); px(X + 56, Y + 58, 5, 10, pal.deskDark);
					px(X + 18, Y + 6, 28, 20, '#1a1d24');
					px(X + 20, Y + 8, 24, 15, '#0d1016');
					px(X + 29, Y + 26, 6, 4, '#1a1d24');
					px(X + 20, Y + 32, 18, 6, mixHex(pal.metal, '#000000', 0.2));
					px(X + 46, Y + 31, 6, 7, '#c0563b');
					px(X + 4, Y + 50, 12, 8, '#efe9dc');
				} else if (pr.kind === 'rack') {
					c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(X + 16, Y + 62, 26, 7, 0, 0, Math.PI * 2); c.fill();
					px(X + 2, Y, 28, 60, pal.metal); px(X + 4, Y + 2, 24, 54, mixHex(pal.metal, '#000000', 0.35));
				} else if (pr.kind === 'plant') {
					c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.ellipse(X + 16, Y + 28, 12, 4, 0, 0, Math.PI * 2); c.fill();
					px(X + 9, Y + 20, 14, 9, '#b0714e'); px(X + 9, Y + 20, 14, 3, '#c98a63');
				} else {
					c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.ellipse(X + 16, Y + 28, 13, 4, 0, 0, Math.PI * 2); c.fill();
					px(X + 4, Y + 6, 24, 20, '#c09466'); px(X + 4, Y + 6, 24, 4, '#d4a878'); px(X + 14, Y + 6, 4, 20, '#a87e52');
				}
			}
			return cvp;
		}

		class GameEngine {
			constructor(canvas, opts) {
				this.canvas = canvas;
				this.ctx2d = canvas.getContext('2d');
				this.sendWs = opts.sendWs ?? (() => {});
				this.onSaved = opts.onSaved ?? (() => {});
				this.onHomeAction = opts.onHomeAction ?? (() => {});

				this.phase = 'menu'; // home | playing | levelup | paused | gameover | clear
				this.keys = new Set();
				this.focused = false;
				this.autoPause = true;
				this.initialWeapon = 'whip'; // 默认初始武器；HELLO/CHARACTER 到达后覆盖
				this.initialPassives = { armor: 0, regen: 0, speed: 0, might: 0, haste: 0, magnet: 0 }; // 初始被动等级
				this.activeSkillId = null; // 主动技能通过技能书获得；HELLO/CHARACTER 到达后覆盖

				this.best = null;
				this.clearedLevels = new Set();
				this.enterHome(false);
				this.knownFromServer = new Set(); // 服务端持久化图鉴（跨局累积）
				this.attachInput();
			}

			reset() {
				this.phase = 'menu';
				this.storyMode = false;
				this.story = null;
				this.storyDeath = null;
				// 剑技连击状态清零：否则上一关的段数/收招硬直会被带进新关卡，开场点不动普攻
				this.swordSwing = null;
				this.swordQueued = null;
				this.swordQis = [];
				this.swordStage = 0;
				this.swordComboUntil = 0;
				this.swordComboLock = 0;
				this.swordCd = 0;
				this.swordLastClick = -9;
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
					hp: 100, maxHp: 100, baseMaxHp: 100, speed: 160,
					level: 1, xp: 0, xpNeed: xpNext(1),
					invuln: 0, celebrate: 0, facing: 1, moving: false,
					skillAction: null, actionCd: 0, lastStrikeAt: 0,
					weapons: [{ type: this.initialWeapon || 'whip', level: 1 }],
					passives: { ...this.initialPassives },
				};
				this.enemies = [];
				this.gems = [];
				this.projectiles = [];
				this.mines = [];
				this.beams = [];
				this.familiar = null; // 浮游 deepseek：换场重置，避免从旧位置滑翔过来
				this.laserCfg = null; // 常驻激光配置（避免每次 tick 重建）
				this.rings = [];
				this.enemyBullets = [];
				this.skillFx = [];   // 小怪招牌招式闪光（TS 检测激光线等）
				this.slimeZones = [];   // PY 缩进粘液：玩家减速区
				this.htmlBlocks = [];   // HTML <div> 搭墙：临时路障
				this.areaBombs = [];
				this.particles = [];
				this.dmgNums = [];
				this.grid = new SpatialGrid(64);
				this.spawnTimer = 1;
				this.procPhaseSeen = -1;   // 时辰横幅去重（切时辰才报一次）
				this.weaponCd = {};
				this.orbAngle = 0;
				this.orbHitCd = new Map();
				this.shake = 0;
				this.choices = null;
				this.pendingChoices = []; // “稍后选择”暂存队列：只累计次数，等级照常升
				// 主动技能（划除）
				this.skillCd = 0;
				this.purge = null;
				this.railCharge = null;
				this.skillTimer = 0;
				this.teleportsLeft = 0;
				this.strikeLines = [];
				this.dash = null;
				this.storyMode = false;   // 开局剧情（虚无）进行中
				this.story = null;        // 剧情状态：NPC / 白饭碗 / 乱流
				this.storyDeath = null;   // 剧情中死亡：闭眼动画 → 重新走剧情
				this.laserSkillCd = 0;   // 激光技能内置发射间隔
				this.leapMax = 2;         // 鱼跃：最多存 2 段
				this.leapCharges = 2;     // 开局满两段
				this.leapChargeT = 0;     // 当前这段的充能进度（0~1）
				this.laserSkillOn = false; // 激光技能是否按E开启
				this.skillLasers = [];   // 传送/伤害激光弹
				// 注意：best / knownFromServer 是跨局元数据，reset 不清（否则菜单丢最高分/图鉴）
				// ── M3 工作联动状态 ──
				this.lastFuelElapsed = -100;  // 上次收到工作燃料的局内时刻
				this.shieldTimer = 0;
				this.freezeTimer = 0;
				this.chaosTimer = 0;
				this.banner = null;           // { text, life }
				this.discovered = new Set();  // 本局遇到的敌人（图鉴）
				this.deathTimer = 0;          // 死亡慢动作倒计时
				// 保留玩家已保存的设置，reset 不覆盖（否则局内设置/持久化会失效）
				const _cfg = this.cfg;
				this.cfg = {
					autoPause: _cfg ? _cfg.autoPause !== false : true,
					autoSelect: _cfg ? !!_cfg.autoSelect : false,
					difficulty: _cfg && ['easy', 'normal', 'hard'].includes(_cfg.difficulty) ? _cfg.difficulty : 'normal',
					idleSpawnRate: _cfg && Number.isFinite(_cfg.idleSpawnRate) ? Math.min(60, Math.max(1, _cfg.idleSpawnRate)) : 3,
					sfxVolume: _cfg && Number.isFinite(_cfg.sfxVolume) ? Math.min(100, Math.max(0, _cfg.sfxVolume)) : 100,
					bgmVolume: _cfg && Number.isFinite(_cfg.bgmVolume) ? Math.min(100, Math.max(0, _cfg.bgmVolume)) : 100,
				};
				this.applyAudioMix();
				// P3 关底 Boss / 翻卡 / Boss 房间
				this.bossSpawned = false;
				this.bossRef = null;
				this.bossKilled = false;
				this.bossRoomMode = false;
				this.bossIntro = null;
				this.bossChest = null;
				this.cards = null;
				this._settleSent = false;
				this.pendingShots = [];
				// ── 第 3 关「整理工作区」状态 ──
				const _sortCfg = lv?.sort ?? null;
				this.sortCfg = _sortCfg;
				this.sortCorrect = 0;
				this.sortCarried = null;
				this.sortDrops = [];
				this.sortFPrev = false;
				this.sortFCd = 0;
				this.sortFolders = _sortCfg ? _sortCfg.folders.map((f) => ({
					id: f.id, label: f.label, gate: !!f.gate,
					x: f.xf * this.world.w, y: f.yf * this.world.h,
					state: f.gate ? 'ghost' : 'solid',
				})) : [];
				// ── 第 4 关「子代理」状态 ──
				this.homeAgents = [];
				this.agentCfg = lv?.agents ?? null;
				this.agents = [];
				this.agentsDispatched = false;
				this.agentPop = 0;
				// 开局摊在地上的存量文件（不会消失，等子代理/玩家去搬）
				if (_sortCfg?.initialFiles) {
					const cats = Object.keys(SORT_FILES);
					for (let i = 0; i < _sortCfg.initialFiles; i++) {
						const cat = pick(cats);
						const name = pick(SORT_FILES[cat]);
						const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
						this.sortDrops.push({
							x: rand(this.world.w * 0.07, this.world.w * 0.93),
							y: rand(this.world.h * 0.07, this.world.h * 0.93),
							name, ext, type: null, ttl: Infinity, bob: rand(0, Math.PI * 2), stock: true,
						});
					}
				}
			}

			/** 家里的子代理：按「已招募数量」生成/回收（任务在 agentTasks 里） */
			syncHomeAgents() {
				const want = Math.max(0, Math.min(5, this.agentCount ?? 0));
				const list = this.homeAgents ?? [];
				while (list.length > want) list.pop();
				while (list.length < want) {
					const a = ((list.length + 0.5) / want) * Math.PI * 2;
					list.push({
						x: 420 + Math.cos(a) * 70, y: 300 + Math.sin(a) * 50,
						vx: 0, vy: 0, t: rand(0, 2), bob: rand(0, Math.PI * 2), moving: false,
						face: 1, wander: null, task: 'idle',
					});
				}
				this.homeAgents = list;
			}
			/** 家里子代理的活：随意＝乱走；派了活＝走到对应器械旁边「写代码」，持续往那台里塞工作量（见 updateDeviceWork） */
			updateHomeAgents(dt) {
				const list = this.homeAgents ?? [];
				if (!list.length) return;
				const tasks = this.agentTasks ?? [];
				const speed = 78;
				for (let i = 0; i < list.length; i++) {
					const a = list[i];
					a.t += dt;
					const task = tasks[i] === 'tree-farm' || tasks[i] === 'mine' ? tasks[i] : 'idle';
					a.task = task;
					// 任务名 → 器械 kind（矿场的 kind 是 basic-mine）
					const devKind = task === 'mine' ? 'basic-mine' : task;
					const dev = task === 'idle' ? null : (this.homeDevices ?? []).find((d) => d.kind === devKind && d.built !== false);
					// 子代理算在哪个房间（跟它被派去的器械；随意＝主房间），画的时候只在那个房间出现
					a.room = dev ? (Number(dev.room) || 0) : 0;
					if (dev) {
						// 走到器械旁边（每台器械周围站一圈，别叠一起）
						const ang = (i / list.length) * Math.PI * 2;
						const tx = dev.x + Math.cos(ang) * 46;
						const ty = dev.y + Math.sin(ang) * 34;
						const dx = tx - a.x, dy = ty - a.y;
						const d = Math.hypot(dx, dy);
						if (d > 8) {
							a.vx = (dx / d) * speed; a.vy = (dy / d) * speed; a.moving = true;
						} else {
							a.vx = a.vy = 0; a.moving = false;   // 到位就开始往这台器械里塞工作量（updateDeviceWork）
						}
					} else {
						// 随意：主动找活干（捡地上物品→送玩家/箱子/唱片机；没活帮忙施工），没活再溜达
						this.tickAgentIdleJobs(a, i, dt, list.length, speed);
					}
					if (a.vx > 0.1) a.face = 1; else if (a.vx < -0.1) a.face = -1;
					// 互相推开
					for (const b of list) {
						if (b === a) continue;
						const dx = a.x - b.x, dy = a.y - b.y, dd = Math.hypot(dx, dy);
						if (dd > 0.01 && dd < 26) { const p2 = (26 - dd) * 0.5; a.x += (dx / dd) * p2; a.y += (dy / dd) * p2; }
					}
					a.x = Math.max(40, Math.min(800, a.x + a.vx * dt));
					a.y = Math.max(120, Math.min(440, a.y + a.vy * dt));
					// 刚上手：记下开始时间，绘制时先完整播一遍 work 动画再进循环
					const workingNow = (!a.moving && a.task !== 'idle') || (!a.moving && a.job && (a.job.kind === 'build' || a.job.kind === 'enchant'));
					if (workingNow && !a.wasWorking) a.workStart = a.t;
					a.wasWorking = workingNow;
				}
			}
			/** 家里子代理的绘制（画在玩家之前） */
			/** 随意模式子代理的主动活：捡地上物品送给玩家/箱子/唱片机；没活去施工未建成器械 */
			tickAgentIdleJobs(a, idx, dt, total, speed) {
				if (!a.job && (a.jobCd ?? 0) > 0) a.jobCd -= dt;
				if (!a.job && (a.jobCd ?? 0) <= 0 && (a.scanT ?? 0) <= 0) { a.scanT = 0.5; a.job = this.claimIdleJob(a); }
				if (a.scanT > 0) a.scanT -= dt;
				let j = a.job;
				if (j) {
					// 任务失效就放下（物品被玩家先捡走 / 器械已建成）
					if (j.kind === 'pickup' && !a.carry && !(this.groundItems ?? []).some((g) => g.id === j.groundId)) { a.job = null; a.jobCd = 1.5; }
					if (j.kind === 'build') {
						const d0 = (this.homeDevices ?? []).find((d) => d.id === j.deviceId);
						if (!d0 || d0.built !== false) { a.job = null; a.jobCd = 1.0; }
					}
					if (j.kind === 'enchant' && !this.pendingEnchant) { a.job = null; a.jobCd = 0.6; }   // 这一孔充完 / 被卸下 → 回去干别的
					j = a.job;
				}
				const walkTo = (tx, ty, sp, arriveR, onArrive) => {
					const dx = tx - a.x, dy = ty - a.y;
					const d = Math.hypot(dx, dy) || 1;
					if (d > arriveR) { a.vx = (dx / d) * sp; a.vy = (dy / d) * sp; a.moving = true; }
					else { a.vx = a.vy = 0; a.moving = false; onArrive(); }
				};
				if (!j) {
					// 没活：慢慢在屋里晃，走到一个点后时不时站着发呆（idle 动画）
					if ((a.restT ?? 0) > 0) { a.restT -= dt; a.vx = a.vy = 0; a.moving = false; return; }
					if (!a.wander || (a.wanderT ?? 0) <= 0) {
						a.wander = { x: Math.max(60, Math.min(760, a.x + rand(-150, 150))), y: Math.max(140, Math.min(420, a.y + rand(-90, 90))) };
						a.wanderT = rand(2.5, 6);
					}
					a.wanderT -= dt;
					const dx = a.wander.x - a.x, dy = a.wander.y - a.y;
					const d = Math.hypot(dx, dy) || 1;
					if (d > 10) { a.vx = (dx / d) * speed * 0.55; a.vy = (dy / d) * speed * 0.55; a.moving = true; }
					else { a.vx = a.vy = 0; a.moving = false; a.restT = rand(1.0, 3.0); a.wander = null; }
					return;
				}
				if (j.kind === 'pickup') {
					const it = (this.groundItems ?? []).find((g) => g.id === j.groundId);
					if (!a.carry) {
						if (!it) { a.job = null; a.vx = a.vy = 0; a.moving = false; return; }
						a.room = Number(it.room) || 0;   // 去物品所在的房间
						walkTo(it.x, it.y - 4, speed * 0.85, 14, () => {
							a.carry = it.item;   // 叼起来（carry 动画 + 头顶图标）：物品立刻离开地面，先记在代理「手上一格」
							this.sendWs({ kind: ClientMsg.AGENT_PICKUP, groundId: it.id, slot: idx });
							this.groundItems = (this.groundItems ?? []).filter((g) => g.id !== it.id);   // 地上立刻消失（服务端会同步）
							j.target = this.decideAgentDrop(it.item);
							if (!j.target) {
								// 背包满又没箱子：让服务端把手上的东西原地点回地上
								this.sendWs({ kind: ClientMsg.AGENT_DELIVER, slot: idx, x: it.x, y: it.y, room: Number(it.room) || 0 });
								a.carry = null; a.job = null; a.jobCd = 3;
							}
						});
					} else {
						const tgt = j.target;
						if (!tgt) { a.carry = null; a.job = null; return; }
						if (tgt.kind === 'player') {
							a.room = this.homeRoom || 0;   // 送到玩家手里：跟随玩家所在房间
							walkTo(this.player.x, this.player.y - 6, speed, 22, () => {
								this.sendWs({ kind: ClientMsg.AGENT_DELIVER, slot: idx, x: this.player.x, y: this.player.y, room: this.homeRoom || 0 });
								if (this.crafting) {   // 和玩家自己捡起一样的「获得 ×××」提示
									this.crafting.message = '获得 ' + itemMeta(a.carry).name;
									this.crafting.messageItem = a.carry;
									this.crafting.messageTimer = 1.6;
								}
								this.burst(a.x, a.y - 16, '#8fe3f2', 6);
								a.carry = null; a.job = null; a.jobCd = 1.2;
							});
						} else {
							const chest = (this.homeChests ?? []).find((c) => c.id === tgt.id);
							if (!chest) { a.carry = null; a.job = null; return; }
							a.room = Number(chest.room) || 0;
							walkTo(chest.x, chest.y - 12, speed, 26, () => {
								this.sendWs({ kind: ClientMsg.AGENT_DELIVER, slot: idx, chestId: chest.id, x: chest.x, y: chest.y, room: Number(chest.room) || 0 });
								if (this.crafting) {   // 和玩家自己捡起一样的「获得 ×××」提示
									this.crafting.message = '获得 ' + itemMeta(a.carry).name;
									this.crafting.messageItem = a.carry;
									this.crafting.messageTimer = 1.6;
								}
								this.burst(a.x, a.y - 16, '#ffd54f', 6);
								a.carry = null; a.job = null; a.jobCd = 1.2;
							});
						}
					}
					return;
				}
				// 强化搭把手：站在台边，每人每秒 +100 充能；攒满（并上玩家按 F 的部分）这一孔就成
				if (j.kind === 'enchant') {
					const dev = (this.homeDevices ?? []).find((d) => d.id === j.deviceId);
					if (!dev) { a.job = null; return; }
					a.room = Number(dev.room) || 0;
					const ang = (idx / total) * Math.PI * 2;
					walkTo(dev.x + Math.cos(ang) * 40, dev.y + Math.sin(ang) * 30, speed * 0.8, 10, () => {
						const pe = this.pendingEnchant;
						if (!pe) { a.job = null; return; }
						this.enchWork = (this.enchWork ?? 0) + this.agentWorkRate() * dt;
						if ((this.chopT ?? 0) + this.enchWork / 100 >= this.enchantNeedSec() && (this.chopCd ?? 0) <= 0) {
							this.enchWork = 0; this.chopT = 0; this.enchTotal = 0; this.chopCd = 0.6;
							this.pendingEnchant = null;
							playSE('enchant-ding', 0.7, 0.05);
							this.burst(dev.x, dev.y - 16, '#a855f7', 12);
							this.sendWs({ kind: ClientMsg.ENCHANT, baseId: pe.baseId, materialId: pe.materialId, lucky: pe.lucky ?? 0 });
							a.job = null; a.jobCd = 1.0;
						}
					});
					return;
				}
				// 施工：站在虚影器械旁，每人每秒 +100 工作量，攒满 buildTime×100 就建成
				const dev = (this.homeDevices ?? []).find((d) => d.id === j.deviceId);
				if (!dev) { a.job = null; return; }
				a.room = Number(dev.room) || 0;
				const ang = (idx / total) * Math.PI * 2;
				walkTo(dev.x + Math.cos(ang) * 40, dev.y + Math.sin(ang) * 30, speed * 0.8, 10, () => {
					if (!this.buildWork) this.buildWork = new Map();
					const need = (BUILD_ITEMS[dev.kind]?.buildTime ?? 3) * 100;
					const w = (this.buildWork.get(dev.id) ?? 0) + 100 * dt;
					if (w >= need) {
						this.buildWork.delete(dev.id);
						this.sendWs({ kind: ClientMsg.BUILD_FINISH, deviceId: dev.id });
						this.burst(dev.x, dev.y, '#ffd54f', 14);
						a.job = null; a.jobCd = 1.0;
					} else this.buildWork.set(dev.id, w);
				});
			}
			/** 给随意模式子代理认领一个活（别的代理没认领的最近目标；同房间优先） */
			claimIdleJob(a) {
				const others = (this.homeAgents ?? []).filter((x) => x !== a);
				const claimed = new Set(others.map((x) => (x.job && x.job.kind === 'pickup') ? x.job.groundId : null).filter(Boolean));
				// 强化台装了料：优先去台边搭把手（充能是限时的活，比捡东西急）
				if (this.pendingEnchant) {
					const et = (this.homeDevices ?? []).find((d) => d.kind === 'enchant-table' && d.built !== false);
					if (et) return { kind: 'enchant', deviceId: et.id };
				}
				let best = null, bd = Infinity;
				for (const g of this.groundItems ?? []) {
					if (claimed.has(g.id)) continue;
					if ((Number(g.room) || 0) === 2) continue;   // 第三房间是钓鱼场：鱼不归子代理捡
					if (/^record-/.test(g.item)) continue;   // 唱片不归子代理管（放唱片机/播放是玩家的事）
					const d = Math.hypot(g.x - a.x, g.y - a.y) + ((Number(g.room) || 0) === (a.room ?? 0) ? 0 : 400);
					if (d < bd) { bd = d; best = g; }
				}
				if (best) return { kind: 'pickup', groundId: best.id };
				best = null; bd = Infinity;
				for (const d0 of this.homeDevices ?? []) {
					if (d0.built !== false || !BUILD_ITEMS[d0.kind]) continue;
					const d = Math.hypot(d0.x - a.x, d0.y - a.y) + ((Number(d0.room) || 0) === (a.room ?? 0) ? 0 : 400);
					if (d < bd) { bd = d; best = d0; }
				}
				return best ? { kind: 'build', deviceId: best.id } : null;
			}
			/** 决定叼着的物品送去哪：唱片→唱片机；背包放得下→玩家；否则最近的箱子 */
			decideAgentDrop(item) {
				const unique = new Set(this.inventory ?? []);
				if (unique.has(item) || unique.size < 24) return { kind: 'player' };
				let best = null, bd = Infinity;
				for (const c of this.homeChests ?? []) {
					if (c.kind === 'record-player') continue;
					const cap = c.kind === 'diamond-chest' ? 25 : 5;
					const slots = (c.slots ?? []).filter(Boolean);
					if (!slots.some((st) => st.item === item) && slots.length >= cap) continue;
					const d = Math.hypot(c.x - this.player.x, c.y - this.player.y) + ((Number(c.room) || 0) === (this.homeRoom || 0) ? 0 : 500);
					if (d < bd) { bd = d; best = c; }
				}
				return best ? { kind: 'chest', id: best.id } : null;
			}
			/** 家里的小狼：3×4 的 48px 行走图，站着不动但会转头看玩家（头像/交互暂时不需要） */
			drawHomeWolf(c, t) {
				if ((this.homeRoom || 0) !== 0) return;   // 只站在主房间
				const img = assetImg(WOLF_IMG);
				if (!img.complete || !img.naturalWidth) return;
				const rows = Math.max(1, Math.round(img.naturalHeight / WOLF_CELL));   // 4 行 = 下/左/右/上
				const p = this.player;
				// 朝向：离得远就面朝下站着；玩家靠近就转向玩家的方向（4 行 = 下/左/右/上）
				const dx = (p?.x ?? 0) - WOLF_HOME.x, dy = (p?.y ?? 0) - WOLF_HOME.y;
				const walking = this.homeScene?.step === 'walk';   // 过场还在走 → 先面朝下，等站定了再转头
				const far = !p || Math.hypot(dx, dy) > 260 || walking;
				const dir = far ? 'down'
					: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right')
					: (dy < 0 ? 'up' : 'down');
				const row = Math.min(rows - 1, WOLF_ROWS[dir] ?? 0);
				const col = 1;                             // 行走图中间那帧＝站立姿势
				const bob = Math.sin(t * 2.1) * 1.2;
				c.save();
				c.globalAlpha = 0.28; c.fillStyle = '#0b0d14';   // 和子代理同款的脚底投影
				c.beginPath(); c.ellipse(WOLF_HOME.x, WOLF_HOME.y + 24, 16, 6, 0, 0, Math.PI * 2); c.fill();
				c.globalAlpha = 1;
				c.drawImage(img, col * WOLF_CELL, row * WOLF_CELL, WOLF_CELL, WOLF_CELL,
					WOLF_HOME.x - WOLF_SIZE / 2, WOLF_HOME.y - WOLF_SIZE / 2 + bob, WOLF_SIZE, WOLF_SIZE);
				c.font = '12px system-ui,sans-serif';
				c.textAlign = 'center'; c.textBaseline = 'middle';
				c.fillStyle = 'rgba(255,255,255,.75)';
				c.shadowColor = '#000'; c.shadowBlur = 4;
				c.fillText('小狼', WOLF_HOME.x, WOLF_HOME.y - WOLF_SIZE / 2 - 6 + bob);
				c.restore();
			}
			drawHomeAgents(c, t) {
				for (const a of this.homeAgents ?? []) {
					if ((a.room ?? 0) !== (this.homeRoom || 0)) continue;   // 只画当前房间里的子代理
					const bob = Math.sin(t * 5 + a.bob) * 2;
					const working = !a.moving && a.task !== 'idle';
					const building = !a.moving && a.job && (a.job.kind === 'build' || a.job.kind === 'enchant');
					const state = a.carry ? 'carry' : (working || building) ? 'work' : a.moving ? 'walk' : 'idle';
					let frameIdx = null;
					if (working) {
						// 刚接活：先把整张 work 表完整播一遍，播完再循环后几帧（from~end）
						const fps = SUB_SHEETS.work.fps || 6;
						const all = SUB_SHEETS.work.frames || 6;
						const from = SUB_SHEETS.work.from ?? 0;
						const elapsed = Math.max(0, a.t - (a.workStart ?? 0));
						const intro = all / fps;                 // 完整播一遍的时长
						frameIdx = elapsed < intro
							? Math.min(all - 1, Math.floor(elapsed * fps))
							: from + (Math.floor((elapsed - intro) * fps) % Math.max(1, all - from));
					}
					c.save();
					c.globalAlpha = 0.28; c.fillStyle = '#0b0d14';
					c.beginPath(); c.ellipse(a.x, a.y + 15, 13, 5, 0, 0, Math.PI * 2); c.fill();
					c.restore();
					if (!drawSubSprite(c, state, a.t, a.x, a.y + bob, 40, a.face > 0, frameIdx)) {
						c.save(); c.fillStyle = '#8fe3f2';
						c.beginPath(); c.arc(a.x, a.y, 9, 0, Math.PI * 2); c.fill(); c.restore();
					}
					// 叼着的物品顶在头上
					if (a.carry) {
						const meta = itemMeta(a.carry);
						if (meta.iconUrl) {
							const img = assetImg(meta.iconUrl);
							if (img.complete && img.naturalWidth) c.drawImage(img, a.x - 9, a.y - 36 + bob, 18, 18);
						} else {
							c.save(); c.font = '12px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
							c.fillText(meta.icon, a.x, a.y - 27 + bob); c.restore();
						}
					}
				}
			}

			// ── 器械「工作量」模型 ──
			// 采集不再按「秒」算，改成工作量：1 秒 = 100 工作量，默认效率就是每秒 100。
			// 玩家按住 F、以及被派到这台的子代理，都会往同一台器械里塞工作量；满一个 gatherTime×100 就产出一份。
			/** 以后出「提升工作效率」的道具，就改这两个函数（返回 工作量/秒） */
			playerWorkRate() { return 100; }
			agentWorkRate() { return 100; }
			/** 当前装填孔位的充能时长（秒）：已嵌孔数 0..5 → 2/4/8/16/32/64 */
			enchantNeedSec() { return this.pendingEnchant ? 2 * Math.pow(2, accEmbedded(this.pendingEnchant.baseId)) : 0; }
			deviceWorkAt(devId) {
				if (!this.deviceWork) this.deviceWork = new Map();
				let rec = this.deviceWork.get(devId);
				if (!rec) { rec = { work: 0, need: 100, rate: 0, workers: 0, flash: 0 }; this.deviceWork.set(devId, rec); }
				return rec;
			}
			/** 每帧累计各台采集器械的工作量；满一份就发一条 GATHER（服务端 700ms 防刷，多的留在 work 里） */
			updateDeviceWork(dt) {
				const list = this.homeDevices ?? [];
				if (!list.length) return;
				const agents = this.homeAgents ?? [];
				const tasks = this.agentTasks ?? [];
				const p = this.player;
				const playerHolding = this.focused && this.keys.has('f');
				for (const dev of list) {
					if (dev.built === false) continue;
					const meta = BUILD_ITEMS[dev.kind];
					if (!meta || (meta.action ?? 'gather') !== 'gather') continue;   // 只算采集类（树场/矿场）
					const rec = this.deviceWorkAt(dev.id);
					rec.flash = Math.max(0, rec.flash - dt);
					let rate = 0;
					const playerHere = (Number(dev.room) || 0) === (this.homeRoom || 0);
					if (playerHolding && playerHere && Math.hypot(dev.x - p.x, dev.y - p.y) <= 70) rate += this.playerWorkRate();
					for (let i = 0; i < agents.length; i++) {
						const a = agents[i];
						const kind = tasks[i] === 'mine' ? 'basic-mine' : tasks[i];
						if (kind !== dev.kind) continue;
						if (Math.hypot(dev.x - a.x, dev.y - a.y) > 70) continue;          // 还没走到位
						rate += this.agentWorkRate(i);
					}
					rec.rate = rate;
					rec.workers = Math.round(rate / 100);
					rec.need = (meta.gatherTime ?? 1.1) * 100;
					if (rate <= 0) continue;
					rec.work += rate * dt;
					// 攒够一份就交易一次：多个人一起干活会一次性凑出好几份，带 count 一条消息送走（不再用冷却限速）
					const got = Math.floor(rec.work / rec.need);
					if (got > 0) {
						rec.work -= got * rec.need;
						this.sendWs({ kind: ClientMsg.GATHER, deviceId: dev.id, count: got });
						playSE('mine-place', 0.5, 0.05);
						this.burst(dev.x, dev.y - 12, dev.kind === 'basic-mine' ? '#ffd54f' : '#8bc34a', 6);
						rec.flash = 0.35;
					}
				}
			}

			/** 进入大肥鱼的家（主菜单场景）：可走动并按 F 打开背包/图鉴/画廊/设置/出门 */
			enterHome(focus = true) {
				this.reset();
				this.level = null;
				this.procmap = null; this.procLayers = null; this.cycleStartAt = null;
				this.defaultWorld = { w: GAME_W, h: GAME_H };
				this.world = { ...this.defaultWorld };
				this.theme = { bg: '#0b0d13', grid: 'rgba(79,110,247,0.05)' };
				this.chests = [];
				this.chestNear = null;
				this.chestProgress = 0;
				this.enemies = [];
				this.gems = [];
				this.projectiles = [];
				this.mines = [];
				this.beams = [];
				this.familiar = null; // 浮游 deepseek：换场重置，避免从旧位置滑翔过来
				this.rings = [];
				this.enemyBullets = [];
				this.skillFx = [];   // 小怪招牌招式闪光（TS 检测激光线等）
				this.slimeZones = [];   // PY 缩进粘液：玩家减速区
				this.htmlBlocks = [];   // HTML <div> 搭墙：临时路障
				this.areaBombs = [];
				this.bossSpawned = false;
				this.bossRef = null;
				this.bossKilled = false;
				this.bossRoomMode = false;
				this.bossIntro = null;
				this.bossChest = null;
				this.cards = null;
				this._settleSent = false;
				this.pendingShots = [];
				this.player.x = 220;
				this.player.y = 330;
				this.updateCamera();
				this.homeNear = null;
				this.homeFCooldown = 0;
				this.wolfMenu = null;          // 小狼问答菜单（开着时世界暂定）
				this.wolfChatUnlocked = true;  // 走近按 F 问答：默认解锁；新档在初次对话期间临时锁住
				this.fDown = false;
				this.fStart = 0;
				this.fLongTriggered = false;
				this.placingBuild = null;
				this.chopT = 0;
				this.chopCd = 0;
				this.buildT = 0;
				this.buildTarget = null;
				this.buildTotal = 3;
				this.buildCd = 0;
				this.pendingEnchant = null;
				this.enchTotal = 0;
				this.enchWork = 0;
				this.editMode = false;
				this.editSel = null;
				this.editDrag = null;
				this.homeRoom = 0;
				this.placingChest = false;
				if (this.recordPlaying?.audio) { try { this.recordPlaying.audio.pause(); } catch {} }
				this.recordPlaying = null;
				this.easterEgg = false;
				this.badAppleEgg = false;
				this.craftPops = [];
				this.pointer = null;
				this.homeMoveTarget = null;
				this.crafting = { stage: 'idle', timer: 0, recipe: [], placed: [], result: null, message: null, messageItem: null, messageTimer: 0, x: 150, y: 420 };
				this.updateCamera();
				this.homeItems = this.buildHomeItems();
				this.syncHomeAgents();
				this.homeScene = null;
				this.phase = 'home';
				if (focus) this.focusCanvas();
			}

			appendHomeContainers(items) {
				for (let i = 0; i < (this.homeChests ?? []).length; i++) {
					if ((Number(this.homeChests[i]?.room) || 0) !== (this.homeRoom || 0)) continue;
					const pos = this.chestHomePos(i);
					const kind = this.homeChests[i]?.kind;
					const isDiamond = kind === 'diamond-chest' || ((this.homeChests[i]?.slots?.length ?? 0) > 5);
					const icon = kind === 'record-player' ? '🎵' : isDiamond ? '💎' : '📦';
					const label = kind === 'record-player' ? '唱片机' : isDiamond ? '钻石宝箱' : '木制宝箱';
					items.push({ id: 'chest:' + i, x: pos.x, y: pos.y, icon, label, noEmoji: true });
				}
				for (let i = 0; i < (this.homeDevices ?? []).length; i++) {
					const dv = this.homeDevices[i];
					if ((Number(dv?.room) || 0) !== (this.homeRoom || 0)) continue;
					const meta = BUILD_ITEMS[dv.kind] ?? { name: dv.kind, icon: '🔧' };
					const label = meta.name + (dv.built === false ? '（未建成）' : '');
					items.push({ id: 'device:' + i, x: Number(dv.x) || 300, y: Number(dv.y) || 340, icon: meta.icon, label, noEmoji: true, device: true, unbuilt: dv.built === false });
				}
				for (const g of (this.groundItems ?? [])) {
					if ((Number(g.room) || 0) !== (this.homeRoom || 0)) continue;
					items.push({ id: 'ground:' + g.id, x: g.x, y: g.y, icon: '✨', label: '', noEmoji: true });
				}
			}

			buildHomeItems() {
				if (this.homeRoom === 2) {
					// 第三房间（钓鱼海滩）：返回门 + 海边商店，不放家具
					const items2 = [
						{ id: 'room-back', x: FISH_ROOM.back.x, y: FISH_ROOM.back.y, icon: '🚪', label: '返回' },
						{ id: 'shop-bait', x: FISH_ROOM.shop.x, y: FISH_ROOM.shop.y, icon: '🛒', label: '海边商店' },
					];
					this.appendHomeContainers(items2);
					return items2;
				}
				if (this.homeRoom === 1) {
					const items = [
						{ id: 'room-unused', x: 60, y: 450, icon: '🚪', label: (this.unlockedRooms ?? []).includes(2) ? '第三房间' : '未启用' },
						{ id: 'room-back', x: 780, y: 450, icon: '🚪', label: '返回' },
					];
					this.appendHomeContainers(items);
					return items;
				}
				const items = [
					{ id: 'char', x: 48, y: 230, icon: '👤', label: '人物界面' },
					{ id: 'dex', x: 168, y: 96, icon: '📚', label: '图鉴', noEmoji: true },
					{ id: 'gallery', x: 528, y: 24, icon: '🖼️', label: '画廊', noEmoji: true },
					{ id: 'table', x: 240, y: 120, icon: '🪑', label: '', noEmoji: true, decor: true },
					{ id: 'chair', x: 240, y: 168, icon: '🪑', label: '', noEmoji: true, decor: true },
					{ id: 'manual', x: 240, y: 116, icon: '📖', label: '手册', noEmoji: true },
					{ id: 'door', x: 780, y: 450, icon: '🚪', label: '出门' },
					{ id: 'room1', x: 60, y: 450, icon: '🚪', label: '房间' },
				];
				if (this.clearedLevels?.has('furious-user')) {
					items.push({ id: 'shop', x: 560, y: 430, icon: '🛒', label: '工作区' });
				}
				items.push({ id: 'craft', x: 150, y: 420, icon: '⚒️', label: '合成台', noEmoji: true });
				this.appendHomeContainers(items);
				return items;
			}

			/** 第三房间的门：已解锁就进，碎片够就解锁，否则提示进度 */
			tryEnterRoom3() {
				if ((this.unlockedRooms ?? [0, 1]).includes(2)) { this.enterHomeRoom(2); return; }
				const n = (this.inventory ?? []).filter((x) => x === 'frag-room3').length;
				if (n >= 5) { this.sendWs({ kind: ClientMsg.UNLOCK_ROOM, room: 2 }); return; }
				this.homeMessage('第三房间碎片 ' + n + '/5 —— 去第 5 关讨伐巨型海胆可以拿到');
			}
			
			/** 第三房间：把玩家限制在沙滩上（不能下水） */
			clampFishingRoom() {
				const p = this.player;
				const w = FISH_ROOM.world.w, h = FISH_ROOM.world.h;
				const maxY = h - 24;
				if (p.x > w - 30) p.x = w - 30;
				if (p.y > maxY) p.y = maxY;
				if (p.y < 40) p.y = 40;
				if (p.x < 30) p.x = 30;
			}
			
			/** 第三房间的海边商店（卖鱼饵） */
			openBaitShop() {
				this.onHomeAction('level-shop:bait');
			}
			
			/** 第三房间背景：沙滩 + 整片水域（代码绘制） */
			drawFishingRoom(c) {
				const seaY = FISH_ROOM.seaY, W = this.world.w, H = this.world.h;
				c.fillStyle = '#e8d8a8';
				c.fillRect(0, 0, W, H);
				c.fillStyle = 'rgba(160,120,60,0.16)';
				for (let gy = 0; gy < seaY; gy += 34) for (let gx = 0; gx < W; gx += 46) c.fillRect(gx + ((gx * 7 + gy * 13) % 19), gy + ((gx * 11 + gy * 5) % 15), 3, 2);
				const grd = c.createLinearGradient(0, seaY, 0, H);
				grd.addColorStop(0, '#3f8fc4');
				grd.addColorStop(1, '#1f5c8f');
				c.fillStyle = grd;
				c.fillRect(0, seaY, W, H - seaY);
				const t = this.elapsed ?? 0;
				c.strokeStyle = 'rgba(255,255,255,0.5)';
				for (let i2 = 0; i2 < 8; i2++) {
					const baseY = seaY + 34 + i2 * 64;
					if (baseY > H) break;
					c.lineWidth = 2 + (i2 % 2);
					c.beginPath();
					for (let x = 0; x <= W; x += 24) {
						const y = baseY + Math.sin(x / 90 + t * 1.6 + i2) * 6 + Math.sin(t * 0.8 + i2 * 1.7) * 3;
						if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
					}
					c.stroke();
				}
				c.strokeStyle = 'rgba(255,255,255,0.85)';
				c.lineWidth = 3;
				c.beginPath();
				for (let x = 0; x <= W; x += 20) {
					const y = seaY + Math.sin(x / 70 + t * 1.7) * 4;
					if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
				}
				c.stroke();
				// 地图四边画可见边界（礁石 + 深水带），避免"能走出图"的错觉
				c.fillStyle = '#c9b183';
				c.fillRect(0, 0, W, 26);
				c.fillRect(0, 0, 26, seaY);
				c.fillRect(W - 26, 0, 26, seaY);
				c.fillStyle = '#6b6f7a';
				for (let x = 20; x < W - 10; x += 78) { c.beginPath(); c.ellipse(x, 24, 22, 12, 0, 0, Math.PI * 2); c.fill(); }
				for (let y = 60; y < seaY - 20; y += 92) {
					c.beginPath(); c.ellipse(20, y, 12, 20, 0, 0, Math.PI * 2); c.fill();
					c.beginPath(); c.ellipse(W - 20, y, 12, 20, 0, 0, Math.PI * 2); c.fill();
				}
				c.fillStyle = 'rgba(10,40,70,0.5)';
				c.fillRect(0, H - 26, W, 26);
				const palm = tileImg('Outside_B');
				for (const [px, py] of [[240, 300], [560, 200], [880, 340], [1420, 300], [1610, 440], [120, 470]]) {
					if (palm && palm.complete && palm.naturalWidth) c.drawImage(palm, 12 * 48, 13 * 48, 48, 96, px - 36, py - 144, 72, 144);
				}
				const sx = FISH_ROOM.shop.x, sy = FISH_ROOM.shop.y;
				// 商店建筑：与第 5 关同款图块（SF_Outside_C r14c8-r15c10 六格，放大 2 倍）
				const shopTile = tileImg('SF_Outside_C');
				if (shopTile && shopTile.complete && shopTile.naturalWidth) {
					c.drawImage(shopTile, 8 * 48, 14 * 48, 144, 96, sx - 144, sy - 150, 288, 192);
				} else {
					c.fillStyle = '#b98d5a';
					c.fillRect(sx - 130, sy - 100, 260, 140);
					c.fillStyle = '#8a5a30';
					c.beginPath(); c.moveTo(sx - 150, sy - 98); c.lineTo(sx, sy - 156); c.lineTo(sx + 150, sy - 98); c.closePath(); c.fill();
					c.fillStyle = '#5a3d20';
					c.fillRect(sx - 26, sy - 32, 52, 72);
				}
				// 招牌
				c.fillStyle = 'rgba(30,20,10,0.78)';
				c.fillRect(sx - 40, sy - 178, 80, 26);
					c.fillStyle = '#ffd54f';
					c.font = 'bold 14px system-ui';
					c.textAlign = 'center';
					c.textBaseline = 'middle';
				c.fillText('鱼饵铺', sx, sy - 165);
				if (this.homeNear?.id === 'shop-bait') {   // 点击不再能进店，给个「按 F」的引导
					c.fillStyle = 'rgba(20,14,8,0.85)';
					c.fillRect(sx - 66, sy + 10, 132, 24);
					c.fillStyle = '#ffe9b0';
					c.font = 'bold 13px system-ui';
					c.fillText('按 F 买鱼饵', sx, sy + 22);
				}
			}
			
			/** 当前鱼饵（目前只有像素鱼饵一种，留给以后多种鱼饵） */
			currentBaitItem() { return 'bait-pixel'; }
			
			/** 按 C：切换鱼饵（显示当前种类与数量） */
			cycleBait() {
				const id = this.currentBaitItem();
				const n = (this.inventory ?? []).filter((x) => x === id).length;
				this.homeMessage('当前鱼饵：像素鱼饵 ×' + n + '（按 V 投放到水里）');
			}
			
			/** 按 V：在面前的水面放下鱼饵（服务端扣 1 个），开始自动钓鱼 */
			placeBait() {
				if (this.homeRoom !== 2) return;
				const id = this.currentBaitItem();
				const n = (this.inventory ?? []).filter((x) => x === id).length;
				if (n <= 0) { this.homeMessage('没有鱼饵了，去鱼饵铺买（2000 token/个）'); return; }
				if ((this.fishBaits ?? []).length >= 8) { this.homeMessage('水里鱼饵太多了（最多 8 个）'); return; }
				// 落点：玩家前方（优先往下）的水面；起点取玩家手边，入水有抛物线和浪花
				const x = Math.max(30, Math.min(FISH_ROOM.world.w - 30, this.player.x));
				const y = Math.max(FISH_ROOM.seaY + 60, Math.min(FISH_ROOM.world.h - 40, this.player.y + 120));
				this.fishBaits = this.fishBaits ?? [];
				this.fishBaits.push({ x, y, sx: this.player.x, sy: this.player.y - 6, t: 0, phase: 'drop', wait: 2.5 + Math.random() * 5.5, kind: this.rollFishKind() });
				this.sendWs({ kind: ClientMsg.USE_BAIT });
				this.homeMessage('抛竿！等鱼上钩…');
			}

			/** 随机鱼种（4 种） */
			rollFishKind() {
				const kinds = ['fish-salmon', 'fish-clown', 'fish-cod', 'fish-plain'];
				return kinds[Math.floor(Math.random() * kinds.length)];
			}
			updateFishing(dt) {
				const list = this.fishBaits;
				if (!list || list.length === 0) return;
				const t = this.elapsed ?? 0;
				for (const f of list) {
					f.t += dt;
					if (f.phase === 'drop') {
						// 入水：抛物线飞入 + 落水浪花
						if (f.t >= 0.5) { f.phase = 'float'; f.t = 0; f.splash = 0; this.burst(f.x, f.y, '#cfe8f5', 8); playSE('ui-click-3', 0.4, 0.05); }
					} else if (f.phase === 'float') {
						// 漂浮等待
						if (f.t >= f.wait) { f.phase = 'bite'; f.t = 0; playSE('ui-click-5', 0.5, 0.05); }
					} else if (f.phase === 'bite') {
						// 咬钩：浮标猛地下沉
						if (f.t >= 0.7) { f.phase = 'reel'; f.t = 0; playSE('skill-strike', 0.45, 0.05); }
					} else if (f.phase === 'reel') {
						// 收线：浮标被拉向玩家
						if (f.t >= 0.9) { f.phase = 'done'; f.t = 0; }
					}
					if (f.phase === 'done') {
						// 上钩完成：这里就是「鱼怪生成」的接入点（下一步接鱼怪）
						this.homeMessage('🐟 鱼上钩了！');
						this.onFishCaught(f);
					}
				}
				this.fishBaits = list.filter((f) => f.phase !== 'done');
			}

			/** 鱼上钩（P3.5 会在这里生成鱼怪；先给提示与音效） */
			onFishCaught(f) {
				// 高科技鱼饵自动收杆完成 → 在**原地**蹦出一条鱼怪（打不死会跳回水里）
				playSE('levelup', 0.5, 0.05);
				this.burst(f.x, f.y, '#8fe3f2', 16);
				if (Math.random() < 0.1) { this.spawnPufferBoss(f); return; }   // 10%：钓上河豚 BOSS
				const hp = 500 + Math.floor(Math.random() * 501);   // 500-1000 血
				const e = {
					id: nextId++, type: 'fish', fish: true, fishKind: f.kind,
					x: f.x, y: f.y, hp, maxHp: hp,
					speed: 0, size: 24, color: '#4a90d9', label: '', xp: 0,
					elite: false, boss: false, hitFlash: 0, slow: 0, aggro: false,
					immuneKnockback: false, flopT: Math.random() * 2,
					escape: 14, home: { x: f.x, y: f.y },
				};
				this.enemies.push(e);
				this.homeMessage('🐟 鱼蹦出水面！打死它 —— 过一会儿它会跳回海里');
			}

			/** 钓鱼出 BOSS：河豚（10%）。十万血、三连刺、旋转跟踪撞（转弯慢 → 绕圈能躲、直着跑会被撞） */
			spawnPufferBoss(f) {
				const hp = 100000;
				const e = {
					id: nextId++, type: 'fish', fish: true, puffer: true, boss: true, elite: true,
					fishKind: '河豚', bossName: '河豚',
					x: f.x, y: f.y, hp, maxHp: hp,
					speed: 46, size: 88, color: '#7fb2d9', label: '河豚', xp: 0,
					hitFlash: 0, slow: 0, aggro: true, immuneKnockback: true,
					contactDmg: 30,                       // 被它撞一下很疼
					home: { x: f.x, y: f.y },
					pufferT: 0, pufferPhase: 'chase', spikeCd: 2.2, dashCd: 3.4, burstLeft: 0, burstT: 0,
					escape: 120,                          // 停留计时：没宝剑/没技能时也不会僵在这里
				};
				this.enemies.push(e);
				this.bossRef = e.id;                   // 顶栏显示它的血条
				this.shake = Math.max(this.shake, 0.6);
				this.burst(e.x, e.y, '#cfe8f5', 26);
				playSE('boss-roar', 0.85, 0.08);
				this.discovered.add('boss:puffer');   // Boss 图鉴：钓上来就解锁
				this.homeMessage('🐡 巨物咬钩 —— 河豚 BOSS 现身！（十万血）');
			}

			updatePufferBoss(e, dt) {
				if (e.hitFlash > 0) e.hitFlash -= dt;
				if (e.slow > 0) e.slow -= dt;
				e.pufferT = (e.pufferT ?? 0) + dt;
				e.escape = (e.escape ?? 120) - dt;
				if (e.escape <= 0) {   // 停留到头：钻回深海（避免玩家没输出手段时僵在场上）
					this.burst(e.x, e.y, '#8fe3f2', 20);
					this.enemies = this.enemies.filter((x) => x !== e);
					if (this.bossRef === e.id) this.bossRef = null;
					this.homeMessage('🐡 河豚等太久，钻回深海了…（鱼饵白费，下次备好宝剑和技能再来）');
					return;
				}
				const p = this.player;
				const dx = p.x - e.x, dy = p.y - e.y;
				const d = Math.hypot(dx, dy) || 1;
				// 三连刺的后续两发（首发在放技能时立刻出去）
				if ((e.burstLeft ?? 0) > 0) {
					e.burstT -= dt;
					if (e.burstT <= 0) {
						e.burstLeft--;
						e.burstT = 0.16;
						const a = Math.atan2(dy, dx) + rand(-0.10, 0.10);
						this.enemyBullets.push(this.mkSpike(e.x, e.y, a, 215, 30, true));
						playSE('mine-place', 0.45, 0.06);
					}
				}
				if (e.pufferPhase === 'dash') {
					// 旋转跟踪撞：一边转一边往你身上冲——转弯时会减速，越直冲越快
					// 转弯率上限 1.7 rad/s：贴着它绕小圈能甩掉；只是侧移一步没用（它会咬着你加速）
					const want = Math.atan2(dy, dx);
					let diff = ((want - (e.dashAngle ?? 0) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
					const turn = Math.max(-1.7, Math.min(1.7, diff));
					e.dashAngle = (e.dashAngle ?? 0) + turn * dt;
					const wheel = Math.abs(diff) > 0.35;                     // 需要明显拐弯吗
					e.dashSpd = wheel
						? Math.max(170, (e.dashSpd ?? 260) - 820 * dt)      // 拐弯：减速
						: Math.min(760, (e.dashSpd ?? 260) + 650 * dt);     // 直线：越冲越快
					e.dashSpin = (e.dashSpin ?? 0) + (4.5 + e.dashSpd / 150) * dt;   // 贴图真的在转
					e.dashVx = Math.cos(e.dashAngle) * e.dashSpd;
					e.dashVy = Math.sin(e.dashAngle) * e.dashSpd;
					e.x += e.dashVx * dt; e.y += e.dashVy * dt;
					e.dashT -= dt;
					const m = 40;
					if (e.x < m || e.x > this.world.w - m || e.y < m || e.y > this.world.h - m) e.dashT = 0;   // 撞墙就停
					e.trailCd = (e.trailCd ?? 0) - dt;
					if (e.trailCd <= 0) { e.trailCd = 0.34; this.enemyBullets.push(this.mkSpike(e.x, e.y, rand(0, Math.PI * 2), 90, 18)); }
					if (e.dashT <= 0) { e.pufferPhase = 'chase'; e.dashCd = 3.0; e.pufferT = 0; }
					return;
				}
				if (e.pufferPhase === 'tele') {   // 蓄力：原地发抖变红
					e.teleT -= dt;
					if (e.teleT <= 0) {
						e.pufferPhase = 'dash';
						e.dashT = 1.9;
						e.dashAngle = e.dashA;
						e.dashSpd = 260;                        // 起步慢，直线冲起来越来越快
						e.dashSpin = e.dashSpin ?? 0;
						e.dashVx = Math.cos(e.dashAngle) * e.dashSpd;
						e.dashVy = Math.sin(e.dashAngle) * e.dashSpd;
						e.trailCd = 0.2;
						this.burst(e.x, e.y, '#ffb37a', 10);
						playSE('mine-place', 0.6, 0.05);
					}
					return;
				}
				// 追击
				const spd = e.speed * 2.0 * (this.freezeTimer > 0 ? 0.5 : 1);
				e.x += (dx / d) * spd * dt;
				e.y += (dy / d) * spd * dt;
				e.spikeCd = (e.spikeCd ?? 2.2) - dt;
				e.dashCd = (e.dashCd ?? 3.4) - dt;
				if (e.spikeCd <= 0) {   // 三连发定向刺
					e.spikeCd = 3.4;
					e.burstLeft = 2; e.burstT = 0.16;
					this.enemyBullets.push(this.mkSpike(e.x, e.y, Math.atan2(dy, dx), 215, 30, true));
					playSE('laser-shot', 0.5, 0.05);
				}
				if (e.dashCd <= 0 && d < 560) {
					e.pufferPhase = 'tele';
					e.teleT = 0.55;
					e.dashA = Math.atan2(dy, dx);
				}
			}

			/** 河豚 BOSS 死亡：掉肃清碎片（+ 提示） */
			dropPufferLoot(e) {
				this.bossRef = null;
				const n = 3;
				for (let i = 0; i < n; i++) {
					this.sendWs({ kind: ClientMsg.DROP_GROUND, item: 'skill-fragment-purge', x: Math.round(e.x + rand(-30, 30)), y: Math.round(e.y + rand(-20, 20)), room: 2 });
				}
				this.burst(e.x, e.y, '#b388ff', 24);
				playSE('enemy-death', 0.9, 0.05);
				this.shake = Math.max(this.shake, 0.7);
				this.homeMessage('🐡 河豚 BOSS 被斩！掉出肃清碎片 ×' + n + '（地上，记得捡）');
			}

			/** 第三房间：鱼怪的活蹦乱跳 + 逃跑计时 */
			updateFishMonsters(dt) {
				for (const e of (this.enemies ?? [])) {
					if (!e.fish) continue;
					if (e.puffer) {   // 河豚 BOSS：不蹦跶、不逃跑，跑自己的那套 AI
						if (!this.playerPhasedOut()) this.updatePufferBoss(e, dt);
						continue;
					}
					if (e.hitFlash > 0) e.hitFlash -= dt;
					e.flopT = (e.flopT ?? 0) + dt;
					e.jump = Math.abs(Math.sin(e.flopT * 4.2)) * 16;
					e.x = e.home.x + Math.sin(e.flopT * 2.6) * 26;
					e.y = e.home.y + Math.cos(e.flopT * 3.1) * 7;
					e.escape -= dt;
					if (e.escape <= 0) {
						this.burst(e.x, e.y, '#8fe3f2', 12);
						this.enemies = this.enemies.filter((x) => x !== e);
						this.homeMessage('🐟 鱼跳回水里跑了…（要在它跑掉前打死）');
					}
				}
			}

			/** 第三房间：画鱼怪（鱼图 + 弹跳 + 甩尾 + 血条 + 逃跑读条） */
			drawFishMonsters(c) {
				for (const e of (this.enemies ?? [])) {
					if (!e.fish) continue;
					if (e.puffer) {   // 河豚 BOSS：大只、鼓胀呼吸、蓄力时发红光
						const r = (e.size ?? 88) * (1 + Math.sin((e.pufferT ?? 0) * 3.2) * 0.045);
						c.save();
						c.globalAlpha = 0.3; c.fillStyle = '#0b3a5e';
						c.beginPath(); c.ellipse(e.x, e.y + r * 0.62, r * 0.62, r * 0.22, 0, 0, Math.PI * 2); c.fill();
						c.restore();
						c.save();
						c.translate(e.x, e.y);   // 以自己为轴转
						if (e.pufferPhase === 'dash') {
							c.rotate(e.dashSpin ?? 0);                    // 冲撞中：整个河豚在滚
						} else if (e.pufferPhase === 'tele') {
							c.shadowColor = 'rgba(255,90,60,.95)'; c.shadowBlur = 22;
							c.rotate(Math.sin((e.pufferT ?? 0) * 42) * 0.10);   // 蓄力：发抖
						} else {
							c.rotate(Math.sin((e.pufferT ?? 0) * 2.4) * 0.07);   // 平时：轻轻摆
						}
						const img = assetImg('/vs-game/assets/items/mv/puffer-boss.png');
						if (img && img.complete && img.naturalWidth) c.drawImage(img, -r, -r, r * 2, r * 2);
						else { c.fillStyle = e.hitFlash > 0 ? '#fff' : '#7fb2d9'; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill(); }
						c.restore();
						const bw = 150, by = e.y - r - 24;
						c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(e.x - bw / 2, by, bw, 8);
						c.fillStyle = '#ff5f56'; c.fillRect(e.x - bw / 2, by, bw * Math.max(0, e.hp / e.maxHp), 8);
						c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.strokeRect(e.x - bw / 2, by, bw, 8);
						const er2 = Math.max(0, Math.min(1, (e.escape ?? 120) / 120));
						c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(e.x - bw / 2, by + 10, bw, 3);
						c.fillStyle = er2 < 0.25 ? '#ffb300' : '#40c4ff'; c.fillRect(e.x - bw / 2, by + 10, bw * er2, 3);
						c.font = 'bold 12px system-ui,sans-serif'; c.textAlign = 'center';
						c.fillStyle = '#ffd7a1'; c.fillText('河豚', e.x, by - 6);
						continue;
					}
					const jump = e.jump ?? 0;
					c.save();
					c.translate(e.x, e.y - jump);
					c.rotate(Math.sin((e.flopT ?? 0) * 3.4) * 0.45);
					c.save();
					c.globalAlpha = 0.25;
					c.fillStyle = '#0b3a5e';
					c.beginPath(); c.ellipse(0, jump, 16, 6, 0, 0, Math.PI * 2); c.fill();
					c.restore();
					const img = assetImg('/vs-game/assets/items/mv/' + e.fishKind + '.png');
					if (img && img.complete && img.naturalWidth) c.drawImage(img, -20, -20, 40, 40);
					else { c.fillStyle = e.hitFlash > 0 ? '#fff' : '#4a90d9'; c.beginPath(); c.ellipse(0, 0, 18, 10, 0, 0, Math.PI * 2); c.fill(); }
					c.restore();
					const bw = 44;
					c.fillStyle = 'rgba(0,0,0,0.55)';
					c.fillRect(e.x - bw / 2, e.y - 36, bw, 5);
					c.fillStyle = '#ff5f56';
					c.fillRect(e.x - bw / 2, e.y - 36, bw * Math.max(0, e.hp / e.maxHp), 5);
					const er = Math.max(0, Math.min(1, (e.escape ?? 0) / 14));
					c.fillStyle = 'rgba(0,0,0,0.45)';
					c.fillRect(e.x - bw / 2, e.y - 29, bw, 4);
					c.fillStyle = er < 0.3 ? '#ffb300' : '#40c4ff';
					c.fillRect(e.x - bw / 2, e.y - 29, bw * er, 4);
				}
			}

			/** 钓上的鱼：随机 1 条属性（攻击50-100 / 生命200-500 / 防御30-50 / 暴击5-10% / 爆伤10-20%） */
			rollFishAffix() {
				const pool = [['atk', 50, 100], ['hp', 200, 500], ['def', 30, 50], ['crit', 5, 10], ['cdmg', 10, 20]];
				const p2 = pool[Math.floor(Math.random() * pool.length)];
				const v = Math.floor(p2[1] + Math.random() * (p2[2] - p2[1] + 1));
				return p2[0] + ':' + v;
			}

			/** 鱼怪被打死：鱼物品掉在地上（服务端地面物，可正常拾取） */
			dropFishItem(e) {
				const serial = Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
				const item = e.fishKind + '~' + this.rollFishAffix() + '#' + serial;
				this.sendWs({ kind: ClientMsg.DROP_GROUND, item, x: Math.round(e.x), y: Math.round(e.y), room: 2 });
				const meta = itemMeta(item);
				const af = meta.affixes?.[0];
				this.homeMessage('🎣 钓到 ' + meta.name + (af ? '（' + affixLabel(af) + ' ' + af.range[0] + '）' : '') + '，掉在地上了');
			}
			/** 训练假人：把家里已建成的假人同步成一只"打不死、不还手"的敌人，好让武器/技能都能打到它 */
			syncDummyEnemies() {
				const want = (this.homeDevices ?? []).filter((d) => d.kind === 'training-dummy' && (Number(d.room) || 0) === (this.homeRoom || 0) && d.built !== false);
				const ids = new Set(want.map((d) => 'dummy:' + d.id));
				this.enemies = (this.enemies ?? []).filter((e) => !e.dummy || ids.has(e.id));
				for (const d of want) {
					const id = 'dummy:' + d.id;
					if (this.enemies.some((e) => e.id === id)) continue;
					this.enemies.push({ id, dummy: true, x: d.x, y: (Number(d.y) || 340) - 14, hp: 1, maxHp: 1, size: 30, speed: 0, color: '#c9a227', label: '', xp: 0, elite: false, boss: false, hitFlash: 0, slow: 0, aggro: false, immuneKnockback: true, combo: 0, total: 0, best: 0, resetT: 0, sway: 0, swayV: 0, glow: 0 });
				}
			}

			/** 假人被命中：不扣血、不死亡，只记连击/总伤并踢一脚摆动 */
			dummyHit(e, dmg) {
				e.combo = (e.combo ?? 0) + 1;
				e.total = (e.total ?? 0) + dmg;
				e.best = Math.max(e.best ?? 0, dmg);
				e.resetT = 3.5;   // 3.5s 内没有新伤害就清零
				e.swayV = (e.swayV ?? 0) + rand(2.2, 3.4) * (Math.random() < 0.5 ? -1 : 1);
				e.glow = 1;
			}

			updateDummies(dt) {
				for (const e of this.enemies ?? []) {
					if (!e.dummy) continue;
					if ((e.resetT ?? 0) > 0) { e.resetT -= dt; if (e.resetT <= 0) { e.combo = 0; e.total = 0; e.best = 0; } }
					if ((e.glow ?? 0) > 0) e.glow = Math.max(0, e.glow - dt * 4);
					e.swayV = (e.swayV ?? 0) - (e.sway ?? 0) * 62 * dt;   // 弹簧回正（底部中点为轴）
					e.swayV *= 0.9;
					e.sway = (e.sway ?? 0) + e.swayV * dt;
					if (e.hitFlash > 0) e.hitFlash -= dt;
					const d = (this.homeDevices ?? []).find((x) => 'dummy:' + x.id === e.id);
					if (d) { e.x = Number(d.x) || e.x; e.y = (Number(d.y) || 340) - 14; }
				}
			}

			drawDummies(c) {
				const img = assetImg(BUILD_ITEMS['training-dummy'].iconUrl);
				const H = 96, W = (img && img.naturalWidth ? (img.naturalWidth / img.naturalHeight) : 1) * H;
				for (const e of this.enemies ?? []) {
					if (!e.dummy) continue;
					const bottom = e.y + H * 0.42;
					c.save();
					c.translate(e.x, bottom);
					c.rotate(e.sway ?? 0);   // 以底部中点为轴轻轻摆
					if ((e.glow ?? 0) > 0) { c.shadowColor = 'rgba(255,236,170,.95)'; c.shadowBlur = 26 * e.glow; }
					if (img && img.complete && img.naturalWidth) c.drawImage(img, -W / 2, -H, W, H);
					else { c.fillStyle = e.glow > 0 ? '#fff3b0' : '#c9a227'; c.fillRect(-W / 2, -H, W, H); }
					c.restore();
					if ((e.combo ?? 0) > 0 && (e.resetT ?? 0) > 0) {   // 连击 / 总伤面板
						const px = e.x, py = bottom + 10;
						const w = 150, h2 = 42;
						c.save();
						c.globalAlpha = Math.min(1, e.resetT / 0.6);
						c.fillStyle = 'rgba(8,10,18,.72)';
						c.strokeStyle = 'rgba(255,213,79,.55)';
						c.lineWidth = 1.5;
						c.beginPath(); c.rect(px - w / 2, py, w, h2); c.fill(); c.stroke();
						c.textAlign = 'left'; c.textBaseline = 'middle';
						c.font = 'bold 14px system-ui,sans-serif';
						c.fillStyle = '#ffd54f';
						c.fillText('连击 ×' + e.combo, px - w / 2 + 8, py + 13);
						c.fillStyle = '#e6e8f0';
						c.fillText('总伤 ' + Math.round(e.total).toLocaleString('en-US'), px - w / 2 + 8, py + 29);
						c.fillStyle = 'rgba(255,213,79,.8)';   // 连击窗口计时条
						c.fillRect(px - w / 2, py + h2 - 3, w * Math.min(1, e.resetT / 3.5), 3);
						c.restore();
					}
				}
			}

			drawFishing(c) {
				const list = this.fishBaits;
				if (!list || list.length === 0) return;
				const t = this.elapsed ?? 0;
				c.save();
				for (const f of list) {
					const k = Math.min(1, f.t / (f.phase === 'drop' ? 0.5 : f.phase === 'bite' ? 0.7 : f.phase === 'reel' ? 0.9 : 1));
					// 浮标位置 + 鱼线终点（收线时向玩家移动）
					let bx = f.x, by = f.y, bob = 0;
					if (f.phase === 'drop') {
						// 抛物线飞入
						bx = f.sx + (f.x - f.sx) * k;
						by = f.sy + (f.y - f.sy) * k - Math.sin(k * Math.PI) * 46;
					} else if (f.phase === 'float') {
						bob = Math.sin(t * 3 + f.x) * 2.2;
						by += bob;
					} else if (f.phase === 'bite') {
						by += 7 + Math.sin(t * 22) * 1.2;   // 猛地下沉 + 抖动
					} else if (f.phase === 'reel') {
						// 高科技自动收杆：鱼在**原地**挣扎上浮，不拉向玩家
						by = f.y - Math.sin(k * Math.PI) * 10;
						bx = f.x + Math.sin((this.elapsed ?? 0) * 14) * 3;
					}
					// 鱼线：从上方垂直到浮标（很直的竖线；收线时随浮标走）
					c.strokeStyle = 'rgba(240,248,255,0.85)';
					c.lineWidth = 2;
					c.beginPath();
					c.moveTo(bx, by - (f.phase === 'reel' ? 40 : 150));
					c.lineTo(bx, by);
					c.stroke();
					// 波纹圈
					if (f.phase === 'float' || f.phase === 'bite') {
						for (let i2 = 0; i2 < 3; i2++) {
							const r = 12 + ((t * 26 + i2 * 18) % 46);
							c.globalAlpha = Math.max(0, 1 - (r - 12) / 46) * (f.phase === 'bite' ? 0.95 : 0.7);
							c.strokeStyle = 'rgba(255,255,255,0.9)';
							c.beginPath(); c.arc(bx, f.y, r, 0, Math.PI * 2); c.stroke();
						}
						c.globalAlpha = 1;
					}
					// 入水水花
					if (f.phase === 'drop' && k > 0.85) {
						const r = 6 + (k - 0.85) * 120;
						c.globalAlpha = Math.max(0, 1 - (k - 0.85) / 0.15) * 0.9;
						c.strokeStyle = '#eaf6ff';
						c.beginPath(); c.arc(f.x, f.y, r, 0, Math.PI * 2); c.stroke();
						c.globalAlpha = 1;
					}
					// 咬钩提示
					if (f.phase === 'bite') {
						c.fillStyle = '#ffd54f';
						c.font = 'bold 18px system-ui';
						c.textAlign = 'center';
						c.fillText('!', bx, by - 28 - Math.abs(Math.sin(t * 12)) * 4);
					}
					// 浮标
					c.fillStyle = f.phase === 'bite' ? '#ff3b3b' : '#ff5f56';
					c.beginPath(); c.arc(bx, by, 6, 0, Math.PI * 2); c.fill();
					c.fillStyle = '#fff';
					c.beginPath(); c.arc(bx, by - 2, 2, 0, Math.PI * 2); c.fill();
					// 收线时画一条鱼的剪影跟着上来
					if (f.phase === 'reel') {
						const img = assetImg('/vs-game/assets/items/mv/' + f.kind + '.png');
						c.save();
						c.globalAlpha = 0.9;
						c.translate(bx, by + 10);
						c.rotate(Math.sin(t * 8) * 0.25);
						if (img && img.complete && img.naturalWidth) c.drawImage(img, -18, -18, 36, 36);
						else { c.fillStyle = '#4a90d9'; c.beginPath(); c.ellipse(0, 0, 16, 9, 0, 0, Math.PI * 2); c.fill(); }
						c.restore();
					}
				}
				c.restore();
			}
			drawBaitHud(c) {
				const n = (this.inventory ?? []).filter((x) => x === this.currentBaitItem()).length;
				const hx = this.cam.x + 12, hy = this.cam.y + 12;   // 抵消外层的相机平移，钉在屏幕左上
				c.save();
				c.fillStyle = 'rgba(20,22,31,0.8)';
				c.fillRect(hx, hy, 268, 26);
				c.fillStyle = '#e6e8f0';
				c.font = 'bold 13px system-ui';
				c.textAlign = 'left';
				c.textBaseline = 'middle';
				c.fillText('🪱 像素鱼饵 ×' + n + '    [C] 切换   [V] 投放', hx + 8, hy + 13);
				c.restore();
			}
			
			updateFishingDeath(dt) {
				const p = this.player;
				const BED = FISH_DEATH.bed;
				if (!this.fishingDeath) {
					if (this.homeRoom === 2 && (p.hp ?? 1) <= 0) {   // 钓鱼房间被打死
						this.fishingDeath = { phase: 'black', t: 0 };
						this.homeMoveTarget = null;
						playSE('player-hurt', 0.9, 0.1);
						this.homeMessage('倒下了…');
					}
					return;
				}
				const d = this.fishingDeath;
				d.t += dt;
				if (d.phase === 'black') {
					// ① 倒下 → 立刻全黑（倒下到回到床上这段全部黑屏）
					if (!d.carried && d.t >= FISH_DEATH.fade) {
						d.carried = true; d.travel = 0;
						this.fishBaits = [];
						this.enemies = (this.enemies ?? []).filter((e) => !e.fish);
						this.enterHomeRoom(0);                  // 回第一个房间（门口）
						p.hp = p.maxHp || 100;                  // 先回满血：睁眼时生命条已经是满的
						p.invuln = 2.5;
						p.moving = false;
						this.updateCamera(null);                // 相机直接跳到门口，别在睁眼时慢慢飘
					}
					// ② 黑屏里「被搬回床上」：从门口走到床边，没走到就绝不睁眼
					if (d.carried) {
						d.travel += dt;
						const dx = BED.x - p.x, dy = BED.y - p.y, dist = Math.hypot(dx, dy);
						if (dist <= 5 || d.travel >= FISH_DEATH.maxWalk) {
							p.x = BED.x; p.y = BED.y; p.moving = false;
							d.phase = 'wake'; d.t = 0;
						} else if (d.travel >= FISH_DEATH.minWalk) {
							const spd = p.speed * (1 + 0.10 * p.passives.speed);
							p.x += (dx / dist) * spd * dt;
							p.y += (dy / dist) * spd * dt;
							p.moving = true;
							if (dx !== 0) p.facing = dx > 0 ? 1 : -1;
						}
						this.updateCamera(dt);
					}
					return;
				}
				// ③ 睁眼（放慢）：全部睁完 + 停一拍才收尾
				if (d.t >= FISH_DEATH.wake + FISH_DEATH.hold) {
					this.fishingDeath = null;
					this.homeMessage('在床上睁开眼…（钓鱼有风险）');
				}
			}

			/** 黑屏 + 「从中间一行缓缓睁眼」的复活特效（相机空间整屏，画在最上层） */
			drawFishingDeathFx(c) {
				const d = this.fishingDeath;
				if (!d || d.phase !== 'wake' && d.phase !== 'black') return;
				const x0 = this.cam.x - 8, y0 = this.cam.y - 8, w = GAME_W + 16, h = GAME_H + 16;
				const mid = this.cam.y + GAME_H / 2, yEnd = y0 + h;
				if (d.phase !== 'wake') {
					const a = Math.min(1, d.t / FISH_DEATH.fade);            // 倒下即全黑
					c.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
					c.fillRect(x0, y0, w, h);
					return;
				}
				// 睁眼：黑幕从中间缓缓裂开（缓入缓出，开头睁得慢），残余暗色再慢慢褪掉
				const k = Math.max(0, Math.min(1, d.t / FISH_DEATH.wake));
				const e = k * k * (3 - 2 * k);
				const open = e * (GAME_H / 2 + 10);
				c.fillStyle = '#000';
				c.fillRect(x0, y0, w, Math.max(0, mid - open - y0));        // 上半黑幕往上退
				c.fillRect(x0, mid + open, w, Math.max(0, yEnd - (mid + open)));   // 下半黑幕往下退
				const rest = 0.72 * (1 - e);                               // 刚睁眼时世界还暗，慢慢变亮
				if (rest > 0.003) {
					c.fillStyle = 'rgba(0,0,0,' + rest.toFixed(3) + ')';
					c.fillRect(x0, y0, w, h);
				}
				if (k < 1) {                                               // 眼缝里的一点暖光
					const glow = 0.20 * Math.max(0, 1 - Math.abs(k - 0.45) / 0.6);
					if (glow > 0.004) {
						c.fillStyle = 'rgba(255,246,224,' + glow.toFixed(3) + ')';
						c.fillRect(x0, mid - open, w, Math.max(1, open * 2));
					}
				}
			}

			/** 第三房间生命条（鱼饵条下方，钉屏幕左上） */
			drawFishingHpHud(c) {
				const p = this.player;
				const hpPct = Math.max(0, Math.min(1, (p.hp ?? 0) / (p.maxHp || 100)));
				const hx = this.cam.x + 12, hy = this.cam.y + 44;
				c.save();
				c.fillStyle = 'rgba(20,22,31,0.8)';
				c.fillRect(hx, hy, 268, 22);
				c.fillStyle = '#2a1a1a';
				c.fillRect(hx + 8, hy + 7, 176, 8);
				c.fillStyle = hpPct < 0.3 ? '#ff5f56' : '#3ddc84';
				c.fillRect(hx + 8, hy + 7, 176 * hpPct, 8);
				c.fillStyle = '#e6e8f0';
				c.font = 'bold 11px system-ui';
				c.textAlign = 'left';
				c.textBaseline = 'middle';
				c.fillText('❤️ ' + Math.round(p.hp ?? 0) + ' / ' + Math.round(p.maxHp || 100), hx + 192, hy + 12);
				c.restore();
			}

			homeMessage(text, item = null) {
				if (this.crafting) { this.crafting.message = text; this.crafting.messageItem = item || null; this.crafting.messageTimer = 1.6; }
			}

			enterHomeRoom(n) {
				const unlocked = this.unlockedRooms ?? [0, 1];
				const next = (n === 2 && unlocked.includes(2)) ? 2 : (n === 1 ? 1 : 0);
				if (this.recordPlaying && next !== this.homeRoom) {
					if (this.recordPlaying.service) {
						this.stopRecord();                 // 唱片机服务：一换房间就停
					} else {
						const src = (this.homeChests ?? []).find((c) => c.id === this.recordPlaying.chestId);
						if (src && (Number(src.room) || 0) !== next) this.pauseRecord();   // 唱片机实体：离开就暂停（回来还能续）
					}
				}
				this.homeRoom = next;
				this.homeMoveTarget = null;
				this.homeNear = null;
				if (this.homeRoom === 2) {
					this.world = { w: FISH_ROOM.world.w, h: FISH_ROOM.world.h };   // 第三房间是大图，可走出屏幕
					this.player.x = FISH_ROOM.spawn.x; this.player.y = FISH_ROOM.spawn.y;
					this.applyMaxHpBonus();               // 进钓鱼房也按饰品重算上限…
					this.player.hp = this.player.maxHp;   // …并回满血
				} else {
					this.world = { ...(this.defaultWorld ?? { w: GAME_W, h: GAME_H }) };   // 其它房间仍是单屏
					this.player.x = this.homeRoom === 1 ? 420 : 220; this.player.y = this.homeRoom === 1 ? 360 : 330;
				}
				this.homeItems = this.buildHomeItems();
			}

			chestHomePos(i) {
				const c = (this.homeChests ?? [])[i];
				if (c && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y))) return { x: Number(c.x), y: Number(c.y) };
				return { x: 300 + (i % 3) * 80, y: 340 + Math.floor(i / 3) * 70 };
			}

			placeContainerAt(x, y) {
				if (this.homeRoom === 2) { this.placingChest = false; this.homeMessage('钓鱼海滩不能摆家具（末影箱/唱片机服务找鱼饵铺）'); return; }
				const px = Math.max(30, Math.min(this.world.w - 30, x));
				const py = Math.max(130, Math.min(this.world.h - 20, y));
				this.sendWs({ kind: ClientMsg.PLACE_CHEST, placeItem: this.placingChestItem || 'wooden-chest', containerKind: this.placingChestKind || 'chest', room: this.homeRoom, x: px, y: py });
				this.placingChest = false;
			}

			beginPlaceChest(placeItem = 'wooden-chest', kind = 'chest') {
				if (this.homeRoom === 2) { this.homeMessage('钓鱼海滩不能摆家具'); return; }
				this.placingChest = true;
				this.placingChestItem = placeItem;
				this.placingChestKind = kind;
				this.homeMoveTarget = null;
				this.pointer = { x: this.world.w / 2, y: this.world.h / 2 };
				this.homeMessage('点击地面放置');
			}

			/** 打造放置：进入「点地面选位置」模式（和宝箱一致） */
			beginPlaceBuild(item) {
				if (!BUILD_ITEMS[item]) return;
				if (this.homeRoom === 2) { this.homeMessage('钓鱼海滩不能摆器械'); return; }
				this.placingBuild = item;
				this.placingChest = false;
				this.homeMoveTarget = null;
				this.pointer = { x: this.world.w / 2, y: this.world.h / 2 };
				this.homeMessage('点击地面放置「' + (BUILD_ITEMS[item].name ?? item) + '」');
			}

			buildPlaceAt(x, y) {
				if (this.homeRoom === 2) { this.placingBuild = null; this.homeMessage('钓鱼海滩不能摆器械（第三房间是独立玩法）'); return; }
				const item = this.placingBuild;
				this.placingBuild = null;
				if (!item) return;
				const px = Math.max(30, Math.min(this.world.w - 30, x));
				const py = Math.max(160, Math.min(this.world.h - 20, y));
				this.sendWs({ kind: ClientMsg.BUILD_PLACE, item, room: this.homeRoom, x: px, y: py });
			}

			// ── 家里的「编辑模式」：拖动移动 / 点选拆除·升级 ──
			toggleEditMode() {
				if (this.homeRoom === 2) { this.homeMessage('第三房间不能编辑'); return; }   // 钓鱼海滩不放家具
				this.editMode = !this.editMode;
				this.editSel = null;
				this.editDrag = null;
				this.homeMessage(this.editMode ? '编辑模式：按住物件拖动可移动，点选可拆除' : '退出编辑模式');
			}

			/** 编辑模式下命中一个可编辑物件（宝箱 / 唱片机 / 树场） */
			editHitAt(x, y) {
				let best = null, bd = 44;
				for (const item of this.homeItems) {
					if (item.decor) continue;
					const id = String(item.id);
					if (!(id.startsWith('chest:') || id.startsWith('device:'))) continue;
					const d = Math.hypot(item.x - x, item.y - y);
					if (d < bd) { bd = d; best = item; }
				}
				return best;
			}

			/** 返回 true 表示这次 pointerdown 已被编辑模式消费 */
			editPointerDown(x, y) {
				if (!this.editMode) return false;
				const hit = this.editHitAt(x, y);
				if (!hit) { this.editSel = null; return true; }
				const [tg, idxStr] = String(hit.id).split(':');
				const index = Number(idxStr);
				const target = tg === 'device' ? 'device' : 'chest';
				const id = target === 'chest' ? this.homeChests?.[index]?.id : this.homeDevices?.[index]?.id;
				this.editSel = { target, index, id };
				this.editDrag = { target, index, id, ox: hit.x - x, oy: hit.y - y, x: hit.x, y: hit.y, sx: x, sy: y, moved: false };
				return true;
			}

			editPointerMove(x, y) {
				const d = this.editDrag;
				if (!this.editMode || !d) return;
				d.x = x + d.ox;
				d.y = y + d.oy;
				if (Math.hypot(x - d.sx, y - d.sy) > 6) d.moved = true;
			}

			editPointerUp() {
				const d = this.editDrag;
				if (!this.editMode || !d) return;
				this.editDrag = null;
				if (!d.moved) return; // 只是点选
				const x = Math.max(30, Math.min(this.world.w - 30, d.x));
				const y = Math.max(130, Math.min(this.world.h - 20, d.y));
				this.sendWs({ kind: ClientMsg.MOVE_HOME_ITEM, target: d.target, id: d.id, room: this.homeRoom, x, y });
			}

			deselectEdit() { this.editSel = null; }

			/** 强化台：装填基底+材料（服务端只认 id；材料会消耗） */
			setPendingEnchant(baseId, materialId, lucky = 0) {
				if (!baseId || !materialId) return;
				const n = Math.max(0, Math.floor(Number(lucky) || 0));
				this.pendingEnchant = n > 0 ? { baseId, materialId, lucky: n } : { baseId, materialId };
				this.chopT = 0;
				this.enchWork = 0;   // 新装填的一孔从头充
				this.homeMessage(n > 0 ? ('已装填（幸运石 ×' + n + '），走到台前按住 F 强化') : '已装填，走到台前按住 F 强化');
			}

			/** 当前选中物件的信息（给 HUD 操作条用） */
			editSelInfo() {
				const s = this.editSel;
				if (!s) return null;
				if (s.target === 'chest') {
					const c = this.homeChests?.[s.index];
					if (!c) return null;
					const kind = c.kind === 'record-player' || c.kind === 'diamond-chest' ? c.kind : 'chest';
					const label = kind === 'record-player' ? '唱片机' : kind === 'diamond-chest' ? '钻石宝箱' : '木制宝箱';
					return { target: 'chest', id: c.id, kind, label, canUpgrade: kind === 'chest', fullRefund: false };
				}
				const dv = this.homeDevices?.[s.index];
				if (!dv) return null;
				const meta = BUILD_ITEMS[dv.kind] ?? { name: dv.kind };
				return { target: 'device', id: dv.id, kind: dv.kind, label: meta.name + (dv.built === false ? '（未建成）' : ''), canUpgrade: false, fullRefund: dv.built === false };
			}

			playRecord(item, chestId) {
				if (this.recordPlaying?.audio) { try { this.recordPlaying.audio.pause(); } catch {} }
				const file = item === 'record-billie-jean' ? '/vs-game/assets/music/bgm/Billie Jean.mp3'
					: item === 'record-letmego' ? '/vs-game/assets/music/bgm/letmego-all.mp3'
					: item === 'record-bad-apple' ? '/vs-game/assets/music/bgm/bad-apple.mp3'
					: item === 'record-world-execute-me' ? '/vs-game/assets/music/bgm/world.execute(me).mp3' : null;
				if (!file) return;
				if (item === 'record-bad-apple') loadBadAppleFrames();
				const audio = new Audio(file);
				audio.loop = false;
				audio.volume = 0.65 * AUDIO_MIX.bgm;
				const p = audio.play();
				if (p && p.catch) p.catch(() => {});
				this.recordPlaying = { item, chestId, audio, startAt: performance.now() };
				this.easterEgg = item === 'record-billie-jean';
				this.badAppleEgg = item === 'record-bad-apple';
				audio.onended = () => {
					playSE('record-eject', 0.85);
					const chest = (this.homeChests ?? []).find((c) => c.id === chestId);
					this.craftPops.push({ item, t: 0, dur: 0.5, x0: Number(chest?.x) || 300, y0: Number(chest?.y) || 340 });
					this.sendWs({ kind: ClientMsg.EJECT_CONTAINER_ITEM, chestId, slot: 0 });
					this.recordPlaying = null;
					this.easterEgg = false;
					this.badAppleEgg = false;
				};
			}

			/** 鱼饵铺的「唱片机服务」：买了歌就能直接放，不用摆唱片机、也不消耗唱片 */
			playRecordService(item) {
				this.stopRecord();
				const file = item === 'record-billie-jean' ? '/vs-game/assets/music/bgm/billie-jean.mp3'
					: item === 'record-letmego' ? '/vs-game/assets/music/bgm/letmego-all.mp3'
					: item === 'record-bad-apple' ? '/vs-game/assets/music/bgm/bad-apple.mp3'
					: item === 'record-world-execute-me' ? '/vs-game/assets/music/bgm/world.execute(me).mp3' : null;
				if (!file) { this.homeMessage('这首没有音频'); return; }
				if (item === 'record-bad-apple') loadBadAppleFrames();
				const audio = new Audio(file);
				audio.loop = false; audio.volume = 0.65 * AUDIO_MIX.bgm;
				const p = audio.play(); if (p && p.catch) p.catch(() => {});
				this.recordPlaying = { item, chestId: null, audio, startAt: performance.now(), service: true };
				this.easterEgg = item === 'record-billie-jean';
				this.badAppleEgg = item === 'record-bad-apple';
				audio.onended = () => {   // 服务版不吐出唱片，直接停
					playSE('record-eject', 0.85);
					this.recordPlaying = null; this.easterEgg = false; this.badAppleEgg = false;
				};
				this.homeMessage('🎵 正在播放：' + itemMeta(item).name + '（唱片机服务）');
			}

			pauseRecord() {
				if (this.recordPlaying?.audio && !this.recordPlaying.audio.paused) {
					try { this.recordPlaying.audio.pause(); } catch {}
				}
			}

			resumeRecord() {
				if (this.recordPlaying?.audio && this.recordPlaying.audio.paused) {
					const p = this.recordPlaying.audio.play();
					if (p && p.catch) p.catch(() => {});
				}
			}

			recordState() {
				if (!this.recordPlaying) return { chestId: null, item: null, paused: false };
				return { chestId: this.recordPlaying.chestId, item: this.recordPlaying.item, paused: !!(this.recordPlaying.audio && this.recordPlaying.audio.paused) };
			}

			stopRecord() {
				if (this.recordPlaying?.audio) { try { this.recordPlaying.audio.pause(); } catch {} }
				this.recordPlaying = null;
				this.easterEgg = false;
				this.badAppleEgg = false;
			}

			pickupGround(id) {
				const gid = id.replace(/^ground:/, '');
				const g = (this.groundItems ?? []).find((x) => x.id === gid);
				if (g) {
					const inv = this.inventory ?? [];
					const unique = new Set(inv);
					// 背包按 24 个不同物品格算；已有同类物品可以叠，不占新格
					if (!unique.has(g.item) && unique.size >= 24) {
						if (this.crafting) { this.crafting.message = '已经满了'; this.crafting.messageItem = null; this.crafting.messageTimer = 1.6; }
						return;
					}
				}
				if (g && this.crafting) {
					this.crafting.message = '获得 ' + itemMeta(g.item).name;
					this.crafting.messageItem = g.item;
					this.crafting.messageTimer = 1.6;
				}
				this.sendWs({ kind: ClientMsg.PICKUP_GROUND, groundId: gid });
			}

			refreshHomeItems() {
				this.homeItems = this.buildHomeItems();
			}

			applyConfig(c) {
				if (!c || typeof c !== 'object') return;
				// 合并语义：只更新传进来的字段，没传的保持原值（否则调个音量会把难度/刷怪等清成默认）
				const prev = this.cfg ?? {};
				const pickBool = (v, d) => (v === undefined ? !!d : !!v);
				const pickNum = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
				const diff = (v, d) => (['easy', 'normal', 'hard'].includes(v) ? v : d);
				this.cfg = {
					autoPause: pickBool(c.autoPause, prev.autoPause !== false),
					autoSelect: pickBool(c.autoSelect, prev.autoSelect),
					difficulty: diff(c.difficulty, diff(prev.difficulty, 'normal')),
					idleSpawnRate: pickNum(c.idleSpawnRate, prev.idleSpawnRate ?? 3, 1, 60),
					sfxVolume: pickNum(c.sfxVolume, prev.sfxVolume ?? 100, 0, 100),
					bgmVolume: pickNum(c.bgmVolume, prev.bgmVolume ?? 100, 0, 100),
				};
				this.autoPause = this.cfg.autoPause;
				this.applyAudioMix();
			}

			/** 拖动音量滑杆：本地立刻生效，不等服务端往返（网络那趟交给 HUD 去防抖） */
			setAudioVolume(key, value) {
				if (key !== 'sfxVolume' && key !== 'bgmVolume') return;
				this.cfg = { ...(this.cfg ?? {}), [key]: Math.max(0, Math.min(100, Number(value) || 0)) };
				this.applyAudioMix();
			}

			/** 把设置里的音量同步到全局混音（并实时改正在播放的 BGM） */
			applyAudioMix() {
				const sfx = Number.isFinite(this.cfg?.sfxVolume) ? this.cfg.sfxVolume / 100 : 1;
				const bgm = Number.isFinite(this.cfg?.bgmVolume) ? this.cfg.bgmVolume / 100 : 1;
				setAudioMix(sfx, bgm);
				if (this.recordPlaying?.audio) this.recordPlaying.audio.volume = 0.65 * bgm;
			}

			diffMul() {
				return this.cfg.difficulty === 'easy' ? 0.8 : this.cfg.difficulty === 'hard' ? 1.35 : 1;
			}
			/** 关卡 hand-tuned 血量：balance.hpFloor 存在时按 tier 走 floor 公式（小怪保底 hpFloor） */
			enemyHpFor(type, elite) {
				const bal = this.level?.balance;
				if (!bal || !bal.hpFloor) return null;
				const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.misc;
				const floor = bal.hpFloor * (1 + (bal.hpPerTier ?? 0) * (base.tier ?? 0));
				const mul = elite ? (bal.eliteMul ?? 8) : 1;
				const hp = floor * mul * this.diffMul();
				return elite ? hp : Math.max(bal.hpFloor, hp);
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
				this.bossSpawned = false;
				this.bossRef = null;
				this.bossKilled = false;
				this.bossRoomMode = false;
				this.bossIntro = null;
				this.bossChest = null;
				this.cards = null;
				this._settleSent = false;
				this.pendingShots = [];
				if (cfg?.world) {
					this.setWorld(cfg.world.w, cfg.world.h);
					this.procmap = null; this.procLayers = null;
				} else {
					// 无尽：程序化办公室大地图（2048×1280，相机跟随；时辰循环即刻开始，白天先来 30s）
					this.defaultWorld = { w: PROC_W, h: PROC_H };
					this.world = { ...this.defaultWorld };
					this.procmap = genProcMap((((Date.now() & 0x7fffffff) ^ ((nextId * 2654435761) >>> 0)) || 1));
					this.procLayers = null;
					this.cycleStartAt = 0;
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

			/** 在指定世界坐标落一只敌怪（营地预铺 / 第 3 关刷怪口用） */
			spawnEnemyAt(type, x, y, elite, opts = {}) {
				if (this.enemies.length >= 300) return;
				const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.misc;
				const hpScale = (1 + this.elapsed / 90) * this.diffMul();
				const bal = this.level?.balance;
				const hp = opts.fixedHp ?? this.enemyHpFor(type, elite) ?? (base.hp * hpScale * (elite ? 20 : 1));
				this.discovered.add(type);
				this.enemies.push({
					id: nextId++, type,
					x, y,
					hp, maxHp: hp,
					speed: base.speed * (elite ? 1.4 : 1) * (bal?.speedMul ?? 1),
					size: base.size * (elite ? 1.5 : 1),
					color: base.color, label: base.label,
					xp: base.xp * (elite ? 3 : 1),
					elite: !!elite, immuneKnockback: !!elite, hitFlash: 0, slow: 0,
					aggro: !!opts.aggro, noDrop: !!opts.noDrop,
					tag: opts.tag ?? null,
					wanderA: rand(0, Math.PI * 2), wanderT: rand(0.8, 2.2),
				});
			}

			/** 相机跟随玩家：dt 为空立即吸附，否则按 dt 平滑 */
			updateCamera(dt) {
				if (this.purge) return;   // 肃清期间镜头由技能接管
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
					if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', '1', '2', '3', 'e', 'f', 'b', 'p', 'escape', 'tab'].includes(k)) {
						e.preventDefault();
						e.stopPropagation();
					}
					if (this.phase === 'bossintro') {
						e.preventDefault();
						e.stopPropagation();
						if (e.repeat) return;   // 按住不放：系统的重复 keydown 不再推进一步，免得一口气吞完整段剧情
						this.advanceBossIntro();
						return;
					}
					if (this.wolfMenu) {   // 小狼问答菜单：W/S 或方向键选，数字直选，F/回车提问，Esc 关
						e.preventDefault();
						e.stopPropagation();
						if (e.repeat) return;
						const n = WOLF_QA.length;
						if (k === 'w' || k === 'arrowup') { this.wolfMenu.index = (this.wolfMenu.index + n - 1) % n; return; }
						if (k === 's' || k === 'arrowdown') { this.wolfMenu.index = (this.wolfMenu.index + 1) % n; return; }
						if (/^[1-9]$/.test(k) && WOLF_QA[Number(k) - 1]) { this.pickWolfQuestion(Number(k) - 1); return; }
						if (k === 'f' || k === 'enter' || k === ' ') { this.pickWolfQuestion(this.wolfMenu.index); return; }
						if (k === 'escape') { this.closeWolfMenu(); return; }
						return;   // 其余按键一律不吃（防止关着菜单偷偷走路）
					}
					if (k === 'escape') { c.blur(); return; }
					if (k === 'z' && (this.phase === 'playing' || this.phase === 'home')) { this.cycleCompass(); return; }   // Z：换指南针指向的目标
					if (k === 'tab' && this.phase === 'home' && this.homeRoom !== 2) { this.toggleEditMode(); return; }
					if (k === 'b' && this.phase === 'home') { this.onHomeAction('char'); return; }
					if (k === 'p' && this.phase === 'playing') { this.pause(); return; }
					if (k === 'e' && (this.phase === 'playing' || this.phase === 'home')) { this.activateActiveSkill(); return; }
				if (k === ' ' && (this.phase === 'playing' || this.phase === 'home')) { this.tryFishLeap(); return; }   // 鱼跃指环：空格前跃
					if (this.phase === 'home' && this.homeRoom === 2) {   // 第三房间：C 切换鱼饵 / V 投放
						if (k === 'c') { this.cycleBait(); return; }
						if (k === 'v') { this.placeBait(); return; }
					}
					if (this.phase === 'levelup' && ['1', '2', '3'].includes(k)) { this.applyChoice(Number(k) - 1); return; }
					this.keys.add(k);
				};
				this._onKeyUp = (e) => this.keys.delete(e.key.toLowerCase());
				this._onFocus = () => { this.focused = true; };
				// 画布失焦（用户去打字/看回复）只停移动，不暂停——与 DSH 交互时游戏照跑
				this._onBlur = () => {
					this.focused = false;
					this.pointerHeld = false;
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
				this._onPointerMove = (e) => {
					const rect = c.getBoundingClientRect();
					this.pointer = { x: e.clientX - rect.left + this.cam.x, y: e.clientY - rect.top + this.cam.y };
					this.editPointerMove(this.pointer.x, this.pointer.y);
				};
				c.addEventListener('pointermove', this._onPointerMove);
				this._onPointerUp = () => { this.pointerHeld = false; this.editPointerUp(); };
				c.addEventListener('pointerup', this._onPointerUp);
				c.addEventListener('pointercancel', this._onPointerUp);
				c.addEventListener('pointerleave', () => { this.pointerHeld = false; });
				this._onPointerDown = (e) => {
					this.pointerHeld = true;   // 按住不放：激光类技能会连发（见 updateSkillLasers）
					const rect = c.getBoundingClientRect();
					const x = e.clientX - rect.left + this.cam.x;
					const y = e.clientY - rect.top + this.cam.y;
					// 超电磁炮蓄力中：点哪里打哪里（家里也能用，优先于其它点击行为）
					if (this.railCharge && (this.phase === 'playing' || this.phase === 'home')) { this.fireRailgun(x, y); return; }
					if (this.phase === 'home') {
						if (this.fishingDeath) return;   // 死亡黑屏/睁眼期间锁住点击（和锁键盘一致）
						if (this.editMode && this.editPointerDown(x, y)) return;
						if (this.placingBuild) {
							this.buildPlaceAt(x, y);
							return;
						}
						if (this.placingChest) {
							this.placeContainerAt(x, y);
							return;
						}
						// 合成选择环：点材料加入/移除，点中央开始仪式
						if (this.crafting?.stage === 'selecting') {
							if (Math.hypot(x - 150, y - 420) <= 46) { this.tryStartCraft(); return; }
							const items = this.craftingItems();
							for (let i = 0; i < items.length; i++) {
								const pos = this.craftingItemPos(i, items.length);
								if (Math.hypot(x - pos.x, y - pos.y) <= 22) { this.toggleCraftItem(items[i][0]); return; }
							}
							return;
						}
						// 激光技能：点击屏幕发射，家里也能用
						if (this.isLaserSkill() && this.laserSkillOn) { this.fireLaserSkill(x, y); return; }   // 激光状态：点击只归技能（冷却中也不出普攻）
						// 划除：家里也能点击快速移动
						if (this.skillTimer > 0 && ACTIVE_SKILLS[this.activeSkillId]?.id === 'strike' && (this.teleportsLeft ?? 0) > 0) { this.tryDash(x, y); return; }
						// 人物界面交互：点家具打开；移动统一键盘（WASD），点空地不再寻路
						// 第三房间（钓鱼海滩）例外：点什么都不算交互（点了会吃掉普攻/技能），商店和返回门都走过去按 F
						const hit = this.homeRoom === 2 ? null : this.homeItems.find((item) => !item.decor && Math.hypot(item.x - x, item.y - y) <= 34);
						if (hit) {
							if (hit.id === 'craft') { if (this.crafting?.stage === 'done') this.handleCraftInteraction(); else this.onHomeAction('craft'); }
							else if (hit.id.startsWith('ground:')) this.pickupGround(hit.id);
							else if (hit.id === 'room1') this.enterHomeRoom(1);
							else if (hit.id === 'room-back') this.enterHomeRoom(0);
							else if (hit.id === 'room-unused') this.tryEnterRoom3();
							else if (hit.id === 'shop-bait') this.openBaitShop();
							else this.onHomeAction(hit.id);
							return;
						}
						// 第三房间（钓鱼海滩）：点击＝普攻，不走路（移动只用 WASD）
						if (this.homeRoom === 2) {
							if (this.hasSwordEquipped()) this.trySwordSwing(x, y);
							else this.homeMessage('需要装备「宝剑」（普攻替换为剑技）才能攻击');
							return;
						}
						// 家里统一键盘走路（WASD），点空地不再自动寻路
					}
					if (this.phase !== 'playing') return;
					// 超电磁炮：蓄力中点屏幕 = 朝那个方向发射
					if (this.railCharge) { this.fireRailgun(x, y); return; }
					if (this.shopOpen) { this.shopClick(x, y); return; }
					// 技能是技能、普攻是普攻：各判各的，互不吃掉点击。
					// 装了技能就发不出普攻是 bug —— 这里技能照放、普攻照挥。
					// （唯一例外：电磁炮蓄力中，点击专用于发射，因为蓄力期间移动都被锁了）
					// 技能各自 try/catch：任何技能内部异常都不许吞掉普攻
					// 状态分离（与第三房间一致）：只要激光技能开着，点击就归技能（冷却中也只空过，不出普攻）
					try { if (this.isLaserSkill() && this.laserSkillOn) { this.fireLaserSkill(x, y); return; } } catch { /* 技能异常忽略 */ }
					// 划除：还有次数时点击=冲刺；次数用尽这次点击直接归普攻
					try { if (this.skillTimer > 0 && ACTIVE_SKILLS[this.activeSkillId]?.id === 'strike' && (this.teleportsLeft ?? 0) > 0) { this.tryDash(x, y); return; } } catch { /* 技能异常忽略 */ }
					if (this.hasSwordEquipped()) { this.trySwordSwing(x, y); return; }
				};
				c.addEventListener('pointerdown', this._onPointerDown);
				window.addEventListener('blur', this._onWinBlur);
				document.addEventListener('visibilitychange', this._onVisibility);
				this._onUiClick = (e) => {
					const t = e.target;
					if (t && t.closest && t.closest('button, .dsh-vs-card, .dsh-vs-item, .dsh-vs-chip')) playSE(nextUiClickSound(), 0.45, 0.03);
					// 键盘焦点安全网：点完插件内的 UI（按钮/对话/卡片…）就把焦点交还画布，
					// 否则 WASD / F / E 全都不响应。文本框、下拉框不抢。
					if (this.canvas && t && t.closest && t.closest('.dsh-vs-root') && !t.closest('input, textarea, select, [contenteditable="true"]')) {
						setTimeout(() => { try { this.canvas.focus(); } catch { /* noop */ } }, 0);
					}
				};
				document.addEventListener('click', this._onUiClick, true);
			}

			destroy() {
				const c = this.canvas;
				c.removeEventListener('keydown', this._onKeyDown);
				c.removeEventListener('keyup', this._onKeyUp);
				c.removeEventListener('focus', this._onFocus);
				c.removeEventListener('blur', this._onBlur);
				if (this._onPointerDown) c.removeEventListener('pointerdown', this._onPointerDown);
				c.removeEventListener('pointermove', this._onPointerMove);
				if (this._onPointerUp) c.removeEventListener('pointerup', this._onPointerUp);
				window.removeEventListener('blur', this._onWinBlur);
				document.removeEventListener('visibilitychange', this._onVisibility);
				if (this._onUiClick) document.removeEventListener('click', this._onUiClick, true);
			}

			focusCanvas() { this.canvas.focus(); }

			// ── 阶段切换 ──
			start() {
				this.reset();
				this.applyMaxHpBonus();   // reset 后按当前饰品重算最大生命
				this.player.hp = this.player.maxHp;   // 开局满血：饰品生命词条抬高的上限也要一起填满
				this.seedLevel();          // 营地预铺 + 守箱精英（无尽模式空操作）
				this.updateCamera();       // 开局吸附，避免大地图首帧黑边
				const pre = this.level?.story?.pre;
				if (Array.isArray(pre) && pre.length > 0) {
					this.openDialog(pre, 'pre');
				} else {
					this.phase = 'playing';
				}
				this.dispatchAgents();   // 第 4 关：子代理自动上工（门槛都在 dispatchAgents 里，有前置剧情时会被挡下）
				this.sendWs({ kind: ClientMsg.GAME_START });
				this.focusCanvas();
			}
			// ── 开局剧情：出生在虚无（无尽模式），无武器 ──
			startVoidIntro() {
			  this.loadLevel(null);
			  this.reset();
			  this.storyMode = true;
			  this.cycleStartAt = null;   // 开局一直是白天；龙飞走后才开始 30/30/30 计时
			  const cx = this.world.w / 2, cy = this.world.h / 2;
			  this.story = { step: 'walk', t: 0, npc: { x: cx + 130, y: cy - 10, alpha: 1 }, bowl: null, rift: null, enemiesOn: false, enterT: 0 };
			  this.player.x = cx - 140;
			  this.player.y = cy + 10;
			  this.player.weapons = [];            // 开局没有武器
			  this.player.hp = this.player.maxHp;
			  this.updateCamera();
			  this.sendWs({ kind: ClientMsg.GAME_START });
			  this.focusCanvas();
			  this.setStoryIntro('mono');
			}
			/**
			 * 初次回到家（新档剧情刚走完、踏进家门那一刻）：先播一小段过场，再进小狼的对话。
			 * 只在这里触发一次——剧本入口就是「虚无剧情结束」，而它本身由 storyIntroDone 持久化保护，
			 * 所以老档 / 二次回家都不会再播。
			 */
			startHomeIntro() {
				this.homeScene = { step: 'walk', t: 0, x: HOME_WOLF_START.x, y: HOME_WOLF_START.y };
				this.phase = 'bossintro';   // 过场期间世界定格（人物由 updateHomeScene 驱动）
				this.wolfChatUnlocked = false;   // 初次对话没聊完前，不开放问答菜单
				this.setBanner('🏠 到家了');
			}
			/** 家里场景（小狼过场 + 对话）：渲染/姿势判定都按「在家里」处理，别切成关卡 */
			inHomeScene() {
				return this.phase === 'home' || (this.phase === 'bossintro' && (this.bossIntro?.kind === 'home-wolf' || this.bossIntro?.kind === 'wolf-chat' || !!this.homeScene));
			}
			/**
			 * 回家过场：人物自己往右走到小狼旁边停下 → 站定 0.6s（小狼这时才把脸转过来）→ 开对话。
			 * 期间玩家按键无效（走 bossintro 的冻结分支），所以不会被误操作打断。
			 */
			updateHomeScene(dt) {
				const sc = this.homeScene;
				if (!sc) return;
				const p = this.player;
				sc.t += dt;
				if (sc.step === 'walk') {
					const dx = sc.x - p.x, dy = sc.y - p.y;
					const d = Math.hypot(dx, dy);
					if (d < 2 || sc.t > 6) {            // 到位（或兜底超时）
						p.x = sc.x; p.y = sc.y;
						p.moving = false;
						sc.step = 'turn'; sc.t = 0;
						return;
					}
					const step = Math.min(d, 150 * dt);   // 150px/s：比跑动慢一点，像「走过去」
					p.x += (dx / d) * step;
					p.y += (dy / d) * step;
					p.moving = true;
					p.facing = dx >= 0 ? 1 : -1;          // 面向小狼走
				} else if (sc.step === 'turn') {
					p.moving = false;
					if (sc.t >= 0.6) {                    // 站定一下：小狼把脸转过来再开口
						this.homeScene = null;
						this.openDialog(HOME_WOLF_LINES, 'home-wolf');
					}
				}
			}
			/** 小狼问答：菜单开启 / 选择 / 关闭（W/S 或方向键选，F/回车问，Esc 关；常驻可反复问） */
			openWolfMenu() { this.wolfMenu = { index: 0 }; }
			closeWolfMenu() { this.wolfMenu = null; this.focusCanvas(); }
			pickWolfQuestion(i) {
				const item = WOLF_QA[i];
				if (!item) return;
				this.wolfMenu = null;
				this.openDialog(item.a, 'wolf-chat');
			}
			/** 问答菜单面板：对话框风格（小狼头像 + 编号问题列表），贴着小狼往左弹 */
			drawWolfMenu(c) {
				const w = 372, rowH = 34, pad = 14, headH = 54, footH = 26;
				const h = pad + headH + WOLF_QA.length * rowH + 10 + footH;
				const left = WOLF_HOME.x - 40 - w, top = Math.max(12, Math.min(GAME_H - h - 12, WOLF_HOME.y - h / 2));
				c.save();
				// 投影 → 面板底 → 边框
				c.fillStyle = 'rgba(0,0,0,0.35)';
				c.beginPath(); if (c.roundRect) c.roundRect(left + 4, top + 7, w, h, 14); else c.rect(left + 4, top + 7, w, h); c.fill();
				c.fillStyle = 'rgba(13,16,24,0.96)';
				c.beginPath(); if (c.roundRect) c.roundRect(left, top, w, h, 14); else c.rect(left, top, w, h); c.fill();
				c.strokeStyle = 'rgba(126,199,216,0.5)'; c.lineWidth = 2; c.stroke();
				c.textAlign = 'left'; c.textBaseline = 'middle';
				// 头部：小狼表情头像 + 名字 + 引导语
				const face = assetImg('/vs-game/assets/npc/xiaolangface.png?v=1');
				const fbx = left + pad, fby = top + pad + 2, fbS = 38;
				c.fillStyle = 'rgba(255,255,255,0.06)';
				c.beginPath(); if (c.roundRect) c.roundRect(fbx, fby, fbS, fbS, 8); else c.rect(fbx, fby, fbS, fbS); c.fill();
				if (face.complete && face.naturalWidth) {
					const cw = face.naturalWidth / WOLF_FACE_COLS, chh = face.naturalHeight / WOLF_FACE_ROWS;
					c.drawImage(face, 0, 0, cw, chh, fbx + 3, fby + 3, fbS - 6, fbS - 6);   // normal 表情 = 左上格
				} else {
					c.font = '20px serif'; c.fillStyle = '#cfd6e4'; c.textAlign = 'center';
					c.fillText('🐺', fbx + fbS / 2, fby + fbS / 2 + 1); c.textAlign = 'left';
				}
				c.fillStyle = '#ffffff'; c.font = 'bold 16px ui-monospace,monospace';
				c.fillText('小狼', fbx + fbS + 10, fby + 13);
				c.fillStyle = '#8a92a8'; c.font = '11px ui-monospace,monospace';
				c.fillText('「……有话就想问个明白？」', fbx + fbS + 10, fby + 30);
				// 问题列表：编号 + 选中高亮条
				const y0 = top + pad + headH;
				for (let i = 0; i < WOLF_QA.length; i++) {
					const y = y0 + i * rowH + rowH / 2;
					const sel = i === this.wolfMenu.index;
					if (sel) {
						c.fillStyle = 'rgba(126,199,216,0.16)';
						c.beginPath(); if (c.roundRect) c.roundRect(left + 8, y - rowH / 2 + 2, w - 16, rowH - 4, 8); else c.rect(left + 8, y - rowH / 2 + 2, w - 16, rowH - 4); c.fill();
						c.fillStyle = '#7ec7d8'; c.fillRect(left + 8, y - rowH / 2 + 2, 3, rowH - 4);
					}
					c.font = 'bold 12px ui-monospace,monospace';
					c.fillStyle = sel ? '#7ec7d8' : '#5f657a';
					c.fillText(String(i + 1), left + 18, y);
					c.font = (sel ? 'bold ' : '') + '13px ui-monospace,monospace';
					c.fillStyle = sel ? '#ffffff' : '#aeb6c9';
					c.fillText(WOLF_QA[i].q, left + 36, y);
				}
				// 底部键位提示
				c.fillStyle = '#5f657a'; c.font = '11px ui-monospace,monospace';
				c.fillText('W/S 或 ↑↓ 选 · 数字直选 · F 提问 · Esc 关闭', left + pad, top + h - 13);
				c.restore();
			}
			/** 剧情对话：mono(开场独白) / talk(龙娘) / swarm(暴乱吐槽) */
			setStoryIntro(kind) {
			  console.log('[vs-game] 剧情：播对话', kind);
			  const lines = STORY_LINES[kind];
			  if (!lines) { console.warn('[vs-game] 剧情台词缺失:', kind); return; }
			  this.openDialog(lines, 'story-' + kind);
			}
			/** 对话播完后的剧情推进 */
			afterStoryDialog(kind) {
			  const st = this.story;
			  if (!st) return;
			  if (kind === 'mono') { st.step = 'walk'; st.t = 0; }
			  else if (kind === 'talk') { st.step = 'swarm'; st.t = 0; }
			  else if (kind === 'swarm') {   // 吐槽完毕：右上角时钟从此刻开始走，怪开始动
			    if (this.cycleStartAt == null) this.cycleStartAt = this.elapsed;
			  }
			}
			/** 当前时辰：0 白天 / 1 深夜 / 2 冷色（-1=非程序化地图）；cycleStartAt 为空=还没开始计时（保持白天） */
			procPhase() {
				if (!this.procmap) return -1;
				if (this.cycleStartAt == null) return 0;
				return Math.floor(Math.max(0, this.elapsed - this.cycleStartAt) / PROC_PHASE_SEC) % 3;
			}
			/**
			 * 时辰过渡：返回 { ph, prev, k }。k<1 表示刚切换、正在 PROC_FADE_SEC 内从 prev 淡入 ph。
			 * 只有一个地方会出现「into≈0 但没有上一个时辰」——剧情刚开表（cycleStartAt 此刻才落地），
			 * 所以额外要求 since >= PROC_FADE_SEC，避免开局先来一次冷色→白天的假过渡。
			 */
			procPhaseBlend() {
				const ph = this.procPhase();
				const since = this.cycleStartAt == null ? 0 : Math.max(0, this.elapsed - this.cycleStartAt);
				const into = since % PROC_PHASE_SEC;
				// 没在过渡里（或还没开始走表）：prev 必须等于 ph（底图就是当前时辰），
				// 否则会把上一个时辰的图当底图整张画出来
				if (ph < 0 || since < PROC_FADE_SEC || into >= PROC_FADE_SEC) return { ph, prev: ph, k: 1 };
				return { ph, prev: (ph + 2) % 3, k: into / PROC_FADE_SEC };
			}
			/** 时辰切换：只留轻音效（文字横幅已去掉，右上角时辰芯片负责展示） */
			updateCycle() {
				const ph = this.procPhase();
				if (ph < 0) return;
				if (this.procPhaseSeen !== ph) {
					const first = this.procPhaseSeen == null || this.procPhaseSeen < 0;
					this.procPhaseSeen = ph;
					if (!first) playSE(ph === 2 ? 'teleport' : 'levelup', 0.5, 0.08);
				}
			}
			updateStory(dt) {
			  const st = this.story;
			  if (!st || this.phase !== 'playing') return;
			  st.t += dt;
			  const p = this.player;
			  if (st.step === 'walk') {
			    // ？？？ 不自动搭话：走到跟前按 F 才开始对话（和捡白饭一个手感）
			    st.npcNear = Math.hypot(p.x - st.npc.x, p.y - st.npc.y) < 78;
			    if (st.npcNear && this.focused && this.keys.has('f')) this.setStoryIntro('talk');
			  } else if (st.step === 'swarm') {
			    if (!st.enemiesOn) {
			      st.enemiesOn = true;
			      playSE('boss-roar', 0.75, 0.1);
			      this.shake = Math.max(this.shake, 0.4);
			      const types = ['js', 'py', 'html', 'rs', 'go', 'ts'];
			      for (let i = 0; i < 16; i++) {
			        const a = rand(0, Math.PI * 2), r = rand(240, 430);
			        this.spawnEnemyAt(pick(types), Math.max(24, Math.min(this.world.w - 24, p.x + Math.cos(a) * r)), Math.max(24, Math.min(this.world.h - 24, p.y + Math.sin(a) * r)), false);
			      }
			    }
			    if (st.t > 0.4 && this.cycleStartAt == null) {   // 龙起飞的那一刻：右上角时钟开始走
			      this.cycleStartAt = this.elapsed;
			    }
			    if (!st.bowl && st.t > 0.4) {   // 碗放在玩家身前一小步（不用走远），按 F 抢
			      const dx = st.npc.x - p.x, dy = st.npc.y - p.y, dd = Math.hypot(dx, dy) || 1;
			      st.bowl = { x: Math.max(28, Math.min(this.world.w - 28, p.x + (dx / dd) * 70)), y: Math.max(28, Math.min(this.world.h - 28, p.y + (dy / dd) * 70)) };
			      this.setBanner('🍚 去捡起白饭');
			    }
			    if (st.t > 0.4 && !st.swarmTalked) {   // 龙起飞：大肥鱼立刻吐槽（对话期间世界定格、怪不动），说完才开始计时
			      st.swarmTalked = true;
			      this.setStoryIntro('swarm');
			    }
			    if (st.t > 0.4) {                        // 龙娘往右上飞走、渐渐消失
			      st.npc.x += 46 * dt;
			      st.npc.y -= 200 * dt;
			      st.npc.alpha = Math.max(0, 1 - (st.t - 0.4) / 1.3);
			    }
			    if (st.bowl) {   // 走到白饭前按 F 抢饭：立刻获得代码鞭
			      const bd = Math.hypot(p.x - st.bowl.x, p.y - st.bowl.y);
			      st.bowlNear = bd < 56;
			      if (st.bowlNear && this.focused && this.keys.has('f')) {
			        console.log('[vs-game] 剧情：按 F 捡起白饭 → 直接拿鞭');
			        st.bowl = null;
			        st.npc.alpha = 0;   // 抢得快时龙还没飞没影：强制归零，别定格在半空当虚影
			        st.step = 'eating'; st.t = 0;
			        if (!this.player.weapons.some((w) => w.type === 'whip')) this.player.weapons.push({ type: 'whip', level: 1 });
			        this.setBanner('🪢 捡起白饭，获得【代码鞭】！');
			        playSE('levelup', 0.85);
			      }
			    }
			  } else if (st.step === 'eating') {
			    p.moving = false;
			    if (st.t > 1.7) { st.step = 'fight'; st.t = 0; }   // 吃完这口 → 进入正常战斗
			  } else if (st.step === 'fight') {
			    const coldNow = this.procPhase() === 2;
			    if (!st.rift && coldNow) {   // 冷色时段就开（与等级无关）；位置固定中央广场
			      st.rift = { x: this.procmap.riftSpot.x, y: this.procmap.riftSpot.y, t: 0 };   // t：开涡动画进度（跟着时辰过渡一起长出来）
			      this.setBanner('🌀 冷色时段——时空乱流开了！回中央广场进漩涡');
			      playSE('teleport', 0.9, 0.1);
			    } else if (st.rift && !coldNow) {   // 冷色一结束自然消失，等下个冷色再开
			      st.rift = null;
			    }
			    if (st.rift) st.rift.t = Math.min(1, (st.rift.t ?? 0) + dt / 0.8);   // 0.8s 从中心胀开到正常大小
			    if (st.rift && Math.hypot(p.x - st.rift.x, p.y - st.rift.y) < 30) { st.step = 'ending'; st.t = 0; }
			  } else if (st.step === 'ending') {
			    st.enterT += dt;
			    if (st.enterT > 0.9) {
			      this.storyMode = false; this.story = null;
			      this.reportClearSettlement(true);   // 静默结算：不弹面板、直接回家
			      this.enterHome(false);
			      this.startHomeIntro();              // 初次回到家：小狼的自我介绍 + 手册指引
			    }
			  }
			}
			drawStory(c, t) {
			  const st = this.story;
			  if (!st) return;
			  if (st.rift) {
			    const img = tileImg(STORY_RIFT_TILE);
			    const [sx, sy] = STORY_RIFT_FRAMES[Math.floor((t || 0) * 8) % 3];
			    const rin = Math.min(1, st.rift.t ?? 1);   // 开涡进度：0 → 1（时辰一换不再"啪"地出现）
			    const rs = (0.55 + 0.45 * rin) * 96;
			    c.save();
			    c.globalAlpha = 0.25 + 0.75 * rin;
			    c.shadowColor = 'rgba(150,120,255,.9)'; c.shadowBlur = 22 * rin;
			    if (img && img.complete && img.naturalWidth) c.drawImage(img, sx, sy, 48, 48, st.rift.x - rs / 2, st.rift.y - rs / 2, rs, rs);
			    else { c.fillStyle = 'rgba(140,110,255,.6)'; c.beginPath(); c.ellipse(st.rift.x, st.rift.y, 34 * rs / 96, 46 * rs / 96, 0, 0, Math.PI * 2); c.fill(); }
			    c.restore();
			  }
			  if (st.bowl) {
			    const img = assetImg('/vs-game/assets/intro/rice.png');
			    const bob = Math.sin((t || 0) * 2.4) * 2;
			    if (img && img.complete && img.naturalWidth) c.drawImage(img, st.bowl.x - 23, st.bowl.y - 30 + bob, 46, 34);   // 碗小一点
			    if (st.bowlNear) drawKeyPrompt(c, st.bowl.x, st.bowl.y - 36, 'F 捡起白饭');   // 走近了：F 拾取提示
			  }
			  if (st.npc && st.npc.alpha > 0.02) {
			    const img = assetImg(STORY_NPC_IMG);
			    const h = 102;                                   // 原来 132 偏大，缩小一圈
			    const bob = Math.sin((t || 0) * 2.2) * 4;        // 轻轻上下飘，别那么死
			    const tilt = Math.sin((t || 0) * 1.7) * 0.04;    // 细微摆动
			    const topY = st.npc.y + 24 - h + bob;
			    c.save();
			    c.globalAlpha = st.npc.alpha;
			    c.fillStyle = 'rgba(0,0,0,' + (0.22 * st.npc.alpha).toFixed(3) + ')';
			    c.beginPath(); c.ellipse(st.npc.x, st.npc.y + 24, 20, 6, 0, 0, Math.PI * 2); c.fill();
			    if (img && img.complete && img.naturalWidth) {
			      const w = h * (img.naturalWidth / img.naturalHeight);
			      c.translate(st.npc.x, topY + h);
			      c.rotate(tilt);
			      c.scale(-1, 1);                              // 镜像：面朝左，和主角一致
			      c.drawImage(img, -w / 2, -h, w, h);
			    } else { c.fillStyle = '#c9b8ff'; c.beginPath(); c.arc(st.npc.x, topY + h / 2, 14, 0, Math.PI * 2); c.fill(); }
			    c.restore();
			    const bi = this.bossIntro;
			    const line = bi && String(bi.kind).startsWith('story') ? bi.lines[bi.index] : null;
			    if (line && line.pwd) {
			      const txt = '$ pwd';
			      c.save();
			      c.font = '13px ui-monospace,monospace';
			      const tw = c.measureText(txt).width + 20;
			      const bx = st.npc.x, by = topY - 26;
			      c.fillStyle = 'rgba(16,18,26,.92)';
			      c.strokeStyle = 'rgba(120,220,140,.85)'; c.lineWidth = 1.5;
			      c.beginPath(); c.rect(bx - tw / 2, by - 13, tw, 26); c.fill(); c.stroke();
			      c.fillStyle = '#7ee787'; c.textAlign = 'center'; c.textBaseline = 'middle';
			      c.fillText(txt, bx, by + 1);
			      c.restore();
			    }
			    // 走到跟前：显示「F 对话」提示（对话开始后由对话框接管）
			    if (st.npcNear && !bi) drawKeyPrompt(c, st.npc.x, topY - 16, 'F 对话');
			  }
			}
			/** 剧情中死亡：上下眼睑合拢（闭眼）→ 黑屏，然后从头重走剧情 */
			drawStoryDeathFx(c) {
				const d = this.storyDeath;
				if (!d) return;
				const k = Math.min(1, d.t / STORY_DEATH.close);
				const e = k * k * (3 - 2 * k);
				const cover = e * (GAME_H / 2 + 10);
				c.save();
				c.fillStyle = '#000';
				c.fillRect(-8, -8, GAME_W + 16, cover);                       // 上眼睑往下合
				c.fillRect(-8, GAME_H - cover, GAME_W + 16, cover + 16);      // 下眼睑往上合
				if (d.t > STORY_DEATH.close) {
					const a = Math.min(1, (d.t - STORY_DEATH.close) / 0.2);
					c.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
					c.fillRect(-8, -8, GAME_W + 16, GAME_H + 16);
				}
				c.restore();
			}
			pause() { if (this.storyMode) return; if (this.phase === 'playing') this.phase = 'paused'; }   // 剧情期间不能按 P 暂停/回家
			resume() { if (this.phase === 'paused') { this.phase = 'playing'; this.focusCanvas(); } }

			/** 家里的主循环：只处理移动和 F 交互 */
			updateHome(dt) {
				if (this.wolfMenu) return;   // 问答菜单开着：世界暂定，只吃菜单键
				if (this.fishingDeath) { this.updateCamera(dt); return; }   // 死亡黑屏期间锁住操作
				if (this.player.skillAction) {
					this.player.skillAction.t += dt;
					if (this.player.skillAction.t >= this.player.skillAction.dur) this.player.skillAction = null;
				}
				if (this.homeFCooldown > 0) this.homeFCooldown -= dt;
				this.updatePlayer(dt);   // 家里统一键盘走路（点击走路已移除）
				this.updateCamera(dt);
				this.updateDeviceWork(dt);
				this.updateCrafting(dt);
				this.updateCraftPops(dt);
				let near = null, nd = 1e9;
				for (const item of this.homeItems) {
					if (item.decor) continue;
					const d = Math.hypot(item.x - this.player.x, item.y - this.player.y);
					if (d < nd) { nd = d; near = item; }
				}
				this.homeNear = nd <= 65 ? near : null;
				// 小狼问答：走近按 F（初次对话结束后解锁；没有更近的家具时才接管提示）
				if (!this.homeNear && this.wolfChatUnlocked && !this.wolfMenu) {
					const wd = Math.hypot(WOLF_HOME.x - this.player.x, WOLF_HOME.y - this.player.y);
					if (wd < 80) this.homeNear = { id: 'wolf', x: WOLF_HOME.x, y: WOLF_HOME.y };
				}
				const nearId = this.homeNear?.id ?? null;
				const craftNear = nearId === 'craft';
				const chestNear = !!nearId && nearId.startsWith('chest:');
				// 打造器械：未建成 → 按住 F 施工 3s（虚影从下往上变实）；已建成 → 按住 F 砍木材
				const deviceNear = !!nearId && nearId.startsWith('device:');
				const devNow = deviceNear ? (this.homeDevices ?? [])[Number(nearId.slice(7))] : null;
				this.chopCd = Math.max(0, (this.chopCd ?? 0) - dt);
				this.buildCd = Math.max(0, (this.buildCd ?? 0) - dt);
				if (devNow && this.focused && this.keys.has('f') && this.buildCd <= 0) {
					this.homeFCooldown = 0.25; // 占住通用 F 分支，避免重复触发
					const bt = BUILD_ITEMS[devNow.kind]?.buildTime ?? 3;
					if (devNow.built === false) {
						this.chopT = 0;
						this.buildTarget = devNow.id;
						this.buildTotal = bt;
						this.buildT = (this.buildT ?? 0) + dt;
						// 自己按 F 的进度和子代理攒的工作量合并（子代理搭了把手，玩家就不用从头按满）
						const agentSecB = (this.buildWork?.get(devNow.id) ?? 0) / 100;
						if ((this.buildT ?? 0) + agentSecB >= bt) {
							this.buildWork?.delete(devNow.id);
							this.buildT = 0;
							this.buildTarget = null;
							this.buildCd = 0.6;
							playSE('craft-success', 0.85, 0.05);
							this.burst(this.player.x, this.player.y - 20, '#ffd54f', 16);
							this.sendWs({ kind: ClientMsg.BUILD_FINISH, deviceId: devNow.id });
						}
					} else if ((BUILD_ITEMS[devNow.kind]?.action ?? 'gather') === 'panel') {
						// 强化台：已装填 -> 按住 F 逐孔强化；未装填 -> 短按开面板
						this.buildT = 0;
						this.buildTarget = null;
						if (this.pendingEnchant) {
							const need = this.enchantNeedSec();   // 2/4/8/16/32/64s
							this.enchTotal = need;
							this.chopT = (this.chopT ?? 0) + dt;
							if ((this.chopT ?? 0) + (this.enchWork ?? 0) / 100 >= need && this.chopCd <= 0) {
								this.chopT = 0;
								this.chopCd = 0.6;
								this.enchTotal = 0;
								this.enchWork = 0;
								const pe = this.pendingEnchant;
								this.pendingEnchant = null;
								playSE('enchant-ding', 0.7, 0.05);   // 强化孔位完成：用户指定的 ding（E:/DSH/sucai/se/ding.mp3）
								this.burst(this.player.x, this.player.y - 16, '#a855f7', 12);
								this.sendWs({ kind: ClientMsg.ENCHANT, baseId: pe.baseId, materialId: pe.materialId, lucky: pe.lucky ?? 0 });
							}
						} else {
							this.chopT = 0;
							if (!this.fDown) {
								this.fDown = true;
								this.fStart = performance.now();
								this.fLongTriggered = false;
								// 面板类器械给界面一个带 id 的动作名：强化台→ enchant:、子代理台→ agent-hub:
								const _panelAct = devNow.kind === 'agent-hub' ? 'agent-hub' : 'enchant';
								this.onHomeAction(_panelAct + ':' + devNow.id);
							}
						}
					} else {
						// 采集类器械：玩家按住 F 只是「亲自上手」，累计走 updateDeviceWork
						this.buildT = 0;
						this.buildTarget = null;
						this.chopT = 0;
					}
				} else {
					this.chopT = 0;
					this.buildT = 0;
					this.buildTarget = null;
				}
				if (this.focused && this.keys.has('f') && this.homeFCooldown <= 0) {
					if (craftNear) {
						if (this.crafting?.stage === 'done') {
							this.handleCraftInteraction();
							this.fDown = false;
						} else {
							if (!this.fDown) {
								this.fDown = true;
								this.fStart = performance.now();
								this.fLongTriggered = false;
							}
							if (!this.fLongTriggered && performance.now() - this.fStart > 450) {
								this.fLongTriggered = true;
								if (this.crafting?.placed.length > 0) this.startCraftRitual();
							}
						}
					} else if (chestNear) {
						// 长按 F 不再打开特殊菜单（升级/拆除已移到编辑模式），短按开箱
						if (!this.fDown) {
							this.fDown = true;
							this.fStart = performance.now();
							this.fLongTriggered = false;
						}
					} else if (nearId && nearId.startsWith('ground:')) {
						this.homeFCooldown = 0.35;
						this.pickupGround(nearId);
					} else if (nearId === 'room1') {
						this.homeFCooldown = 0.35;
						this.enterHomeRoom(1);
					} else if (nearId === 'room-back') {
						this.homeFCooldown = 0.35;
						this.enterHomeRoom(0);
					} else if (nearId === 'room-unused') {
						this.homeFCooldown = 0.35;
						this.tryEnterRoom3();
					} else if (nearId === 'shop-bait') {
						this.homeFCooldown = 0.35;
						this.openBaitShop();
					} else if (nearId === 'wolf') {
						this.homeFCooldown = 0.35;
						this.openWolfMenu();
					} else if (this.homeNear) {
						this.homeFCooldown = 0.35;
						this.onHomeAction(this.homeNear.id);
					}
				} else if (this.fDown) {
					const wasLong = this.fLongTriggered;
					const releaseId = this.homeNear?.id ?? null;
					this.fDown = false;
					this.fLongTriggered = false;
					if (!wasLong) {
						if (releaseId === 'craft') this.onHomeAction('craft');
						else if (releaseId && releaseId.startsWith('chest:')) this.onHomeAction(releaseId);
					}
				}
			}

			updateCraftPops(dt) {
				if (!this.craftPops) return;
				for (const p of this.craftPops) p.t += dt;
				this.craftPops = this.craftPops.filter((p) => p.t < (p.dur ?? 1.1));
			}

			countFragments() {
				return (this.inventory ?? []).filter((x) => x === 'skill-fragment').length;
			}

			handleCraftInteraction() {
				const c = this.crafting;
				if (!c) return;
				if (c.stage === 'idle') {
					if (c.placed.length > 0) {
						this.startCraftRitual();
					} else {
						this.onHomeAction('craft');
					}
				} else if (c.stage === 'done') {
					const result = c.result || 'skill-book';
					this.sendWs({ kind: ClientMsg.CRAFT_ITEM, item: result, ingredients: c.recipe.slice() });
					c.stage = 'idle';
					c.recipe = [];
					c.placed = [];
					c.result = null;
					this.sendWs({ kind: ClientMsg.SET_CRAFTING_STORAGE, items: [] });
					c.message = '获得 ' + itemMeta(result).name;
					c.messageItem = result;
					c.messageTimer = 1.6;
					this.homeFCooldown = 0.5;
				}
			}

			setCraftPlaced(items) {
				const c = this.crafting;
				if (c) c.placed = Array.isArray(items) ? items : [];
			}

			startCraftRitual() {
				const c = this.crafting;
				if (c && c.stage === 'idle' && c.placed.length > 0) {
					c.stage = 'crafting';
					c.timer = 2.2;
					c.recipe = c.placed.slice();
					c.result = null;
				}
			}

			finishCraft(product) {
				const c = this.crafting;
				if (!c) return;
				this.sendWs({ kind: ClientMsg.CRAFT_ITEM, item: product, ingredients: c.recipe.slice() });
				c.stage = 'idle';
				c.recipe = [];
				c.placed = [];
				c.result = null;
				this.craftPops.push({ item: product, t: 0, dur: 0.5, x0: 150, y0: 420 });
				playSE('craft-success', 0.9);
				c.message = '合成成功';
				c.messageItem = null;
				c.messageTimer = 1.6;
			}

			updateCrafting(dt) {
				const c = this.crafting;
				if (!c) return;
				if (c.messageTimer > 0) {
					c.messageTimer -= dt;
					if (c.messageTimer <= 0) { c.message = null; c.messageItem = null; }
				}
				if (c.stage === 'crafting') {
					c.timer -= dt;
					if (c.timer <= 0) {
						const recipe = matchRecipe(c.recipe);
						if (recipe) {
							this.finishCraft(recipe.product);
						} else {
							c.stage = 'idle';
							c.message = '好像不太对';
							c.messageItem = null;
							c.messageTimer = 1.6;
							playSE('craft-fail', 0.8);
							this.setBanner('⚠️ 配方不对……');
						}
					}
				}
			}

			craftingItems() {
				const counts = new Map();
				for (const it of this.inventory ?? []) counts.set(it, (counts.get(it) ?? 0) + 1);
				return [...counts.entries()];
			}

			craftingItemPos(i, count) {
				const angle = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
				return { x: 150 + Math.cos(angle) * 82, y: 420 + Math.sin(angle) * 82 };
			}

			toggleCraftItem(item) {
				const c = this.crafting;
				if (!c || c.stage !== 'selecting') return;
				const idx = c.recipe.indexOf(item);
				if (idx >= 0) c.recipe.splice(idx, 1);
				else c.recipe.push(item);
			}

			tryStartCraft() {
				const c = this.crafting;
				if (!c || c.stage !== 'selecting') return;
				const recipe = matchRecipe(c.recipe);
				if (recipe) {
					c.stage = 'crafting';
					c.timer = 2.2;
				} else {
					c.message = '好像不太对';
					c.messageItem = null;
					c.messageTimer = 1.6;
					playSE('craft-fail', 0.8);
					c.recipe = [];
				}
			}

			/** 升级三选一：先不打断战斗，稍后从右侧入口打开 */
			deferChoice() {
				if (this.phase !== 'levelup' || !this.choices) return;
				this.pendingChoices.push(this.choices);
				this.choices = null;
				this.phase = 'playing';
				this.focusCanvas();
			}

			/** 打开暂存的升级三选一 */
			openPendingChoice() {
				if (this.pendingChoices.length === 0) return;
				if (this.phase !== 'playing' && this.phase !== 'paused') return;
				this.choices = this.pendingChoices.shift();
				this.phase = 'levelup';
			}

			// ── 主动技能：划除 ──
			activateActiveSkill() {
				const sk = ACTIVE_SKILLS[this.activeSkillId];
				if (!sk) return;
				if (sk.type === 'purge') {   // 肃清：大地图战斗 / 家里 / 钓鱼房都能放
					if (this.phase !== 'playing' && this.phase !== 'home') return;
					if (this.purge) { this.setBanner('🌀 肃清进行中'); return; }
					if (this.skillCd > 0) { this.setBanner('🌀 肃清冷却中 ' + this.skillCd.toFixed(1) + 's'); return; }
					this.skillCd = sk.cd;
					this.startPurge();
					return;
				}
				if (sk.type === 'railgun') {
					if (this.phase !== 'playing' && this.phase !== 'home') return;
					if (this.railCharge) {                       // 再按一次 = 取消蓄力
						this.railCharge = null;
						this.setBanner('⚡ 已取消蓄力');
						return;
					}
					if (this.skillCd > 0) { this.setBanner('⚡ 电磁炮冷却中 ' + this.skillCd.toFixed(1) + 's'); return; }
					this.railCharge = { t: 0, dx: this.player.facing >= 0 ? 1 : -1, dy: 0 };
					this.homeMoveTarget = null;
					this.setBanner('⚡ 蓄力中 —— 点击屏幕发射（再按 E 取消）');
					playSE('skill-evolve', 0.5, 0.03);
					return;
				}
				if (sk.type) {
					if (this.phase !== 'playing' && this.phase !== 'home') return;
					this.laserSkillOn = !this.laserSkillOn;
					// 传送是一次性技能：按 E 就绪 → 下一次点击放出 → 自动失效，要再按 E
					if (sk.type === 'teleport') {
						if (this.laserSkillOn) this.laserSkillCd = 0;   // 就绪即解除内置 CD：刚放完立刻再按 E 也能马上传
						this.setBanner(this.laserSkillOn ? ('🟣 ' + sk.name + ' 已就绪：点击屏幕传送（一次）') : (sk.name + ' 已取消'));
					} else {
						this.setBanner((this.laserSkillOn ? '🟣 ' : '') + sk.name + (this.laserSkillOn ? ' 已开启' : ' 已关闭'));
					}
					return;
				}
				if (this.phase !== 'playing' && this.phase !== 'home') return;
				if (this.skillTimer > 0 || this.skillCd > 0) return;
				this.skillCd = sk.cd;
				this.skillTimer = sk.duration;
				this.teleportsLeft = sk.maxTeleports;
				this.setBanner('✂️ ' + sk.name + '！点击屏幕快速移动，最多 ' + sk.maxTeleports + ' 次');
			}

			// ── 主动技能：肃清（虚影登场 → 10s 横扫 → 最后一刀切屏） ──
			startPurge() {
				const sk = ACTIVE_SKILLS.purge;
				this.purge = {
					phase: 'phantom', t: 0,
					hits: [],                       // 正在绕怪心旋转的斩击线
					finalX: 0, finalY: 0, finalDone: false,
					flash: 1, seCd: 0,
				};
				const p = this.player;
				p.invuln = Math.max(p.invuln ?? 0, sk.phantom + sk.duration + 3);   // 全程无敌
				p.moving = false;
				if (this.dash) this.dash = null;        // 技能期间不会被冲刺带着跑
				this.railCharge = null;
				this.shake = Math.max(this.shake, 0.45);
				this.homeMoveTarget = null;              // 家里放也不许点地走
				this.updateWeapons(0);                   // 相位移除：手上的自动武器/雷/环/激光立即消失
				assetImg(sk.iconUrl);                   // 预热立绘
				playSE('skill-evolve', 0.9, 0.0);
				this.setBanner('🌀 肃清 —— 虚影显现');
			}

			updatePurge(dt) {
				const pg = this.purge;
				if (!pg) return;
				const sk = ACTIVE_SKILLS.purge;
				const p = this.player;
				p.invuln = Math.max(p.invuln ?? 0, 0.5);   // 无敌（挡住持续伤害/碰撞）
				if (pg.flash > 0) pg.flash = Math.max(0, pg.flash - dt * 1.6);
				if (pg.seCd > 0) pg.seCd -= dt;
				pg.t += dt;
				if (pg.phase === 'phantom') {
					// ① 立绘虚影：这段时间技能还没开始
					if (pg.t >= sk.phantom) {
						pg.phase = 'hunt'; pg.t = 0;
						this.shake = Math.max(this.shake, 0.35);
						playSE('skill-strike', 0.75, 0.02);
						this.setBanner('🌀 肃清 —— 斩击视野内所有敌人');
					}
					return;
				}
				if (pg.phase === 'hunt') {
					// ② 移动键不再移动人物，而是直接推镜头（能斩到远处的敌人）
					let dx = 0, dy = 0;
					if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
					if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
					if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
					if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
					if (dx || dy) {
						const len = Math.hypot(dx, dy) || 1;
						const maxX = Math.max(0, this.world.w - GAME_W), maxY = Math.max(0, this.world.h - GAME_H);
						this.cam.x = Math.max(0, Math.min(maxX, this.cam.x + (dx / len) * sk.camSpeed * dt));
						this.cam.y = Math.max(0, Math.min(maxY, this.cam.y + (dy / len) * sk.camSpeed * dt));
					}
					// 视野内的敌人轮流挨刀
					const pad = 30;
					for (const e of this.enemies) {
						if (e.x < this.cam.x - pad || e.x > this.cam.x + GAME_W + pad) continue;
						if (e.y < this.cam.y - pad || e.y > this.cam.y + GAME_H + pad) continue;
						e.purgeCd = (e.purgeCd ?? rand(0, sk.hitCd)) - dt;
						if (e.purgeCd > 0) continue;
						e.purgeCd = sk.hitCd * rand(0.85, 1.2);
						this.purgeSlash(e, sk);
					}
					for (const h of pg.hits) h.t += dt;
					pg.hits = pg.hits.filter((h) => h.t < h.dur && this.enemies.includes(h.e));
					if (pg.t >= sk.duration) { this.beginPurgeFinal(); return; }
					return;
				}
				// ③ 最后一刀：0.22s 蓄势 → 斩落（这时候才结算伤害）→ 碎屏 → 收尾
				if (!pg.finalDone && pg.t >= 0.22) {
					pg.finalDone = true;
					this.shake = Math.max(this.shake, 1.4);
					this.railFlash = 0.5;
					this.burst(pg.finalX, pg.finalY, '#8fe3f2', 30);
					playSE('laser-shot', 1.0, 0.0);
					for (const e of [...this.enemies]) {
						if (Math.hypot(e.x - pg.finalX, e.y - pg.finalY) <= sk.finalRadius) this.hurtEnemy(e, this.attackPower() * sk.finalDmgMult);
					}
				}
				if (pg.t >= 2.1) this.endPurge();   // 结束后交还人物视角（updateCamera 平滑飘回去）
			}

			/** 一刀：一条白线穿过怪心；每一刀都换个角度（和上一刀错开约 35°~125°），所以刀刀交叉 */
			purgeSlash(e, sk) {
				const pg = this.purge;
				if (!pg) return;
				const prev = e.purgeAng ?? rand(0, Math.PI * 2);
				const ang = prev + rand(0.6, 2.2) * (Math.random() < 0.5 ? -1 : 1);   // 每刀换角度（不是扫着转）
				e.purgeAng = ang;
				pg.hits.push({ e, t: 0, dur: sk.hitCd * 0.85, ang, len: Math.max(92, e.size * 6) });
				const roll = this.rollDamage(this.attackPower() * sk.dmgMult);
				if (e.dummy) this.dummyHit(e, roll.dmg);   // 训练假人也吃肃清统计
				e.hp -= e.dummy ? 0 : roll.dmg;
				e.hitFlash = 0.1;
				this.spawnDmgNum(e.x + rand(-8, 8), e.y - e.size, String(Math.round(roll.dmg)), roll.crit ? 'crit' : 'skill', roll.dmg);
				this.burst(e.x, e.y, roll.crit ? '#ff5252' : '#8fe3f2', roll.crit ? 5 : 3);
				if (pg.seCd <= 0) { playSE('skill-strike', 0.3, 0.06); pg.seCd = 0.1; }   // 全屏同时挨刀时统一节奏，别叠爆音效
				if (e.hp <= 0) this.killEnemy(e);
			}

			beginPurgeFinal() {
				const pg = this.purge;
				if (!pg) return;
				pg.phase = 'final'; pg.t = 0; pg.hits = []; pg.finalDone = false; pg.flash = 1;
				pg.finalX = this.cam.x + GAME_W / 2;   // 就砍在最后镜头所在的位置
				pg.finalY = this.cam.y + GAME_H / 2;
				playSE('skill-evolve', 0.8, 0.0);
				this.setBanner('🌀 肃清 —— 最后一刀');
			}

			endPurge() { this.purge = null; }

			/** 斩击线（世界层）：白线穿过怪心，绕怪心旋转到下一刀的角度 */
			drawPurgeWorld(c) {
				const pg = this.purge;
				if (!pg || !pg.hits.length) return;
				c.save();
				for (const h of pg.hits) {
					const k = Math.min(1, h.t / h.dur);
					const e = h.e, cx = e.x, cy = e.y;
					// 一刀一个固定角度：刀光瞬间拉满，然后淡出（不旋转）
					const grow = Math.min(1, k / 0.28);
					const len = h.len * (0.45 + 0.55 * grow);
					const dx = Math.cos(h.ang) * len / 2, dy = Math.sin(h.ang) * len / 2;
					// 刀光本体：青色外辉 + 白色光芯

					c.globalAlpha = 0.5 * (1 - k * 0.45);
					c.strokeStyle = '#5fc8ff';
					c.lineWidth = 9;
					c.beginPath(); c.moveTo(cx - dx, cy - dy); c.lineTo(cx + dx, cy + dy); c.stroke();
					c.globalAlpha = 0.95 * (1 - k * 0.35);
					c.strokeStyle = '#ffffff';
					c.lineWidth = 2.4;
					c.beginPath(); c.moveTo(cx - dx, cy - dy); c.lineTo(cx + dx, cy + dy); c.stroke();
					// ③ 落刀瞬间怪心一记爆闪
					if (k < 0.4) {
						c.globalAlpha = ((0.4 - k) / 0.4) * 0.45;
						c.fillStyle = '#eaf6ff';
						c.beginPath(); c.arc(cx, cy, e.size * (0.7 + k), 0, Math.PI * 2); c.fill();
					}
				}
				c.restore();
			}

			/** 肃清的屏幕层：虚影立绘 → 蓝色罩子 → 切碎屏幕 + 白闪 */
			drawPurgeScreen(c, t) {
				const pg = this.purge;
				if (!pg) return;
				const sk = ACTIVE_SKILLS.purge;
				const img = assetImg(sk.iconUrl);
				c.save();
				if (pg.phase === 'phantom') {
					const k = Math.min(1, pg.t / sk.phantom);
					const fade = Math.min(1, pg.t / 0.35) * Math.min(1, Math.max(0, (sk.phantom - pg.t) / 0.45));
					c.fillStyle = 'rgba(4,10,26,' + (0.74 * Math.min(1, pg.t / 0.3)).toFixed(3) + ')';
					c.fillRect(0, 0, GAME_W, GAME_H);
					const g0 = c.createRadialGradient(GAME_W / 2, GAME_H / 2, 20, GAME_W / 2, GAME_H / 2, GAME_H * 0.8);
					g0.addColorStop(0, 'rgba(90,180,255,.55)');
					g0.addColorStop(0.55, 'rgba(30,90,200,.26)');
					g0.addColorStop(1, 'rgba(4,10,26,0)');
					c.fillStyle = g0; c.fillRect(0, 0, GAME_W, GAME_H);
					if (img && img.complete && img.naturalWidth) {
						const size = GAME_H * (0.78 + 0.07 * k);
						c.globalAlpha = Math.max(0, Math.min(1, fade));
						c.drawImage(img, GAME_W / 2 - size / 2, GAME_H / 2 - size / 2 + Math.sin(t * 1.6) * 4, size, size);
						c.globalAlpha = Math.max(0, Math.min(0.5, fade * 0.5));
						c.globalCompositeOperation = 'screen';   // 用 screen 而不是 lighter：发光够亮，又不会过曝
						c.drawImage(img, GAME_W / 2 - size * 0.52, GAME_H / 2 - size * 0.52, size * 1.04, size * 1.04);   // 蓝色泛光
						c.globalCompositeOperation = 'source-over';
					}
					c.globalAlpha = 0.16 * fade;
					c.fillStyle = '#cfeaff';
					c.fillRect(0, ((t * 420) % (GAME_H + 160)) - 80, GAME_W, 3);   // 扫描光带
					c.globalAlpha = 1;
				} else if (pg.phase === 'hunt') {
					c.fillStyle = 'rgba(20,60,140,.12)';
					c.fillRect(0, 0, GAME_W, GAME_H);
					const vg = c.createRadialGradient(GAME_W / 2, GAME_H / 2, GAME_H * 0.24, GAME_W / 2, GAME_H / 2, GAME_W * 0.72);
					vg.addColorStop(0, 'rgba(0,0,0,0)');
					vg.addColorStop(1, 'rgba(2,8,24,.55)');
					c.fillStyle = vg; c.fillRect(0, 0, GAME_W, GAME_H);
					if (img && img.complete && img.naturalWidth) {   // 极淡的虚影跟着镜头压场
						c.globalAlpha = 0.075;
						c.globalCompositeOperation = 'screen';   // 用 screen 而不是 lighter：发光够亮，又不会过曝
						const size = GAME_H * 0.92;
						c.drawImage(img, GAME_W / 2 - size / 2 + Math.sin(t * 0.8) * 10, GAME_H / 2 - size / 2 + Math.cos(t * 0.7) * 8, size, size);
						c.globalCompositeOperation = 'source-over';
						c.globalAlpha = 1;
					}
				} else {
					// 最后一刀：白线斩落 + 碎屏
					const k = Math.min(1, pg.t / 0.22);
					c.save();
					c.translate(GAME_W / 2, GAME_H / 2);
					c.rotate(-0.22);
					c.globalAlpha = 0.85 * Math.max(0, 1 - Math.max(0, pg.t - 0.25) / 0.55);
					c.fillStyle = 'rgba(143,227,242,.9)';
					c.fillRect(-GAME_W, -8 * k, GAME_W * 2, 16 * k);
					c.fillStyle = '#ffffff';
					c.fillRect(-GAME_W, -3 * k, GAME_W * 2, 6 * k);
					c.restore();
					const pieces = 18;
					const d = Math.min(1, Math.max(0, (pg.t - 0.16) / 1.1));
					for (let i = 0; i < pieces; i++) {
						const a = (i / pieces) * Math.PI * 2 + i * 0.7;
						const dist = 40 + 320 * d * d;
						const sz = 60 + (i % 5) * 34;
						c.save();
						c.globalAlpha = 0.5 * Math.max(0, 1 - Math.max(0, pg.t - 0.85) / 0.8);
						c.translate(GAME_W / 2 + Math.cos(a) * dist, GAME_H / 2 + Math.sin(a) * dist);
						c.rotate(a * 0.6 + d * 1.2);
						c.beginPath(); c.moveTo(0, 0); c.lineTo(sz, sz * 0.18); c.lineTo(sz * 0.72, sz * 0.78); c.closePath();
						c.fillStyle = 'rgba(190,230,255,.42)'; c.fill();
						c.strokeStyle = 'rgba(240,250,255,.85)'; c.lineWidth = 1.4; c.stroke();
						c.restore();
					}
					c.globalAlpha = 0.75 * Math.max(0, 1 - Math.max(0, pg.t - 0.7) / 0.9);
					c.strokeStyle = 'rgba(235,248,255,.9)';
					c.lineWidth = 2;
					for (let i = 0; i < 10; i++) {
						const a = (i / 10) * Math.PI * 2 + 0.4;
						const dd = Math.min(1, Math.max(0, (pg.t - 0.18) / 0.45));
						if (dd <= 0) continue;
						c.beginPath(); c.moveTo(GAME_W / 2, GAME_H / 2);
						for (let s2 = 1; s2 <= 4; s2++) {
							const r = (s2 / 4) * 470 * dd;
							c.lineTo(GAME_W / 2 + Math.cos(a + (s2 % 2 ? 0.07 : -0.07)) * r, GAME_H / 2 + Math.sin(a + (s2 % 2 ? 0.07 : -0.07)) * r);
						}
						c.stroke();
					}
					c.globalAlpha = 1;
				}
				if (pg.flash > 0) {   // 白闪
					c.globalAlpha = Math.min(0.55, pg.flash * 0.6);
					c.fillStyle = '#eaf6ff';
					c.fillRect(0, 0, GAME_W, GAME_H);
				}
				c.restore();
			}

			/** 找「敌人最密」的方向：16 个方向里数锥形范围内的敌人数（重甲/Boss 加权） */
			densestDir() {
				const p = this.player;
				let bestAng = p.facing > 0 ? 0 : Math.PI, bestScore = -1;
				for (let i = 0; i < 16; i++) {
					const ang = (i / 16) * Math.PI * 2;
					const cos = Math.cos(ang), sin = Math.sin(ang);
					let score = 0;
					for (const e of this.enemies) {
						const rx = e.x - p.x, ry = e.y - p.y;
						const along = rx * cos + ry * sin;
						if (along < 0 || along > 1000) continue;
						const perp = Math.abs(-rx * sin + ry * cos);
						if (perp > 260) continue;
						score += (e.elite ? 4 : 1) * (e.levelBoss || e.boss ? 12 : 1);
					}
					if (score > bestScore) { bestScore = score; bestAng = ang; }
				}
				return bestAng;
			}

			/** 超电磁炮：朝点击方向轰出一道持续 2.5s 的巨型光束（跟着玩家、缓慢扫射） */
			fireRailgun(tx, ty) {
				const sk = ACTIVE_SKILLS.railgun;
				if (!sk) return;
				let ang;
				if (tx == null || ty == null) {
					ang = this.densestDir();               // 没给坐标（保留旧行为）：自动找敌人最多的方向
				} else {
					ang = Math.atan2(ty - this.player.y, tx - this.player.x);
				}
				this.railCharge = null;
				this.skillCd = sk.cd;
				this.player.skillAction = { t: 0, dur: 0.5, dx: Math.cos(ang), dy: Math.sin(ang), kind: 'shoot' };
				this.beams.push({
					kind: 'railgun',
					x: this.player.x, y: this.player.y,
					angle: ang, baseAngle: ang, dir: Math.random() < 0.5 ? 1 : -1,
					len: sk.length, width: sk.width,
					damage: this.attackPower() * sk.dmgMult,
					life: sk.duration, maxLife: sk.duration,
					tick: sk.tick, sweep: sk.sweep, hitCd: new Map(),
				});
				this.railFlash = 0.32;
				this.shake = Math.max(this.shake, 0.55);
				playSE('laser-shot', 0.95, 0.02);
				this.setBanner('⚡ 超电磁炮！');
			}

			tryDash(tx, ty) {
				const sk = ACTIVE_SKILLS[this.activeSkillId];
				if (!sk || sk.type || this.skillTimer <= 0 || this.teleportsLeft <= 0) return;
				tx = Math.max(14, Math.min(this.world.w - 14, tx));
				ty = Math.max(14, Math.min(this.world.h - 14, ty));
				const x1 = this.player.x, y1 = this.player.y;
				// 快速移动，而不是瞬间瞬移：0.16s 内从当前点滑到目标点
				this.dash = { x1, y1, x2: tx, y2: ty, t: 0, dur: 0.16 };
				this.strikeLines.push({
					x1, y1, x2: tx, y2: ty,
					life: sk.lineDuration,
					maxLife: sk.lineDuration,
					dps: this.attackPower() * sk.dmgMult,
				});
				const dLen = Math.hypot(tx - x1, ty - y1) || 1;
				const now = performance.now();
				// 每次点击都立即更新冲刺方向；连续点击从第 3 帧接续
				const chained = !!this.player.skillAction || now - (this.player.lastStrikeAt || 0) < 700;
				const startT = chained ? 0.13 : 0;
				this.player.skillAction = { t: startT, dur: 0.55, dx: (tx - x1) / dLen, dy: (ty - y1) / dLen, kind: 'strike' };
				this.player.actionCd = 0.5;
				this.player.lastStrikeAt = now;
				playSE('skill-strike', 0.6, 0.04);
				this.teleportsLeft--;
				this.burst(x1, y1, '#ff6b9d', 5);
				this.burst(tx, ty, '#ffd54f', 8);
			}

			isLaserSkill() {
				const sk = ACTIVE_SKILLS[this.activeSkillId];
				return !!sk && (sk.type === 'teleport' || sk.type === 'damage');
			}

			fireLaserSkill(tx, ty) {
				const sk = ACTIVE_SKILLS[this.activeSkillId];
				if (!sk || !sk.type || !this.laserSkillOn || this.laserSkillCd > 0) return false;
				tx = Math.max(16, Math.min(this.world.w - 16, tx));
				ty = Math.max(16, Math.min(this.world.h - 16, ty));
				const d = Math.hypot(tx - this.player.x, ty - this.player.y) || 1;
				this.laserSkillCd = sk.internalCd ?? 0.3;
				const ldx = (tx - this.player.x) / d, ldy = (ty - this.player.y) / d;
				this.player.skillAction = { t: 0, dur: 0.4, dx: ldx, dy: ldy, kind: 'shoot' };
				if (sk.type === 'damage') {
					const speed = sk.laserSpeed ?? 1800;
					this.skillLasers.push({
						type: 'damage', x: this.player.x, y: this.player.y,
						vx: ldx * speed, vy: ldy * speed,
						radius: sk.radius ?? 48, damage: this.attackPower() * (sk.damageMult ?? 1),
						life: 3, dead: false,
					});
				} else {
					this.skillLasers.push({
						x1: this.player.x, y1: this.player.y, x2: tx, y2: ty,
						t: 0, dur: Math.max(0.08, d / (sk.laserSpeed ?? 1600)), done: false,
						type: 'teleport', radius: sk.radius ?? 48,
						damage: this.attackPower() * (sk.damageMult ?? 1),
					});
				}
				playSE('laser-shot', 0.65, 0.03);
				if (sk.type === 'damage') this.burst(this.player.x, this.player.y, '#ff3b3b', 8);
				if (sk.type === 'teleport') {
					// 一次性：放出即失效，要再按 E 才能再传送
					this.laserSkillOn = false;
					this.setBanner('🟣 ' + sk.name + ' 已释放');
				}
				return true;
			}

			enderBurst(x, y) {
				// 我的世界末影粒子：小颗紫色方块，围绕人物前后小范围漂浮
				for (let i = 0; i < 58; i++) {
					const a = rand(0, Math.PI * 2);
					const r = rand(0, 24);
					const sx = x + Math.cos(a) * r;
					const sy = y + rand(-30, 22);
					this.particles.push({
						kind: 'spark', x: sx, y: sy,
						vx: Math.cos(a) * rand(8, 34),
						vy: rand(-55, -8),
						life: rand(0.45, 0.8), maxLife: 0.8,
						color: Math.random() < 0.25 ? '#d8b4ff' : '#b46bff',
						size: rand(2, 4),
					});
				}
			}

			updateSkillLasers(dt) {
				if (this.laserSkillCd > 0) this.laserSkillCd -= dt;
				// 按住鼠标不放：只有「伤害激光」这种持续型按内置 CD 连发；TP 是一次性的，必须真的点一下
				const heldSk = ACTIVE_SKILLS[this.activeSkillId];
				if (this.pointerHeld && this.pointer && this.laserSkillOn && heldSk?.type === 'damage' && this.laserSkillCd <= 0) {
					// 只有伤害激光这种持续型才按住连发；TP 一次性，必须真的点一下（否则会被这行用旧指针悄悄放掉）
					this.fireLaserSkill(this.pointer.x, this.pointer.y);
				}
				for (const l of this.skillLasers) {
					if (l.type === 'damage') {
						if (l.dead) continue;
						l.life -= dt;
						l.x += l.vx * dt;
						l.y += l.vy * dt;
						if (l.life <= 0 || l.x < -40 || l.x > this.world.w + 40 || l.y < -40 || l.y > this.world.h + 40) { l.dead = true; continue; }
						for (const e of [...this.enemies]) {
							if (e.hp <= 0) continue;
							if (Math.hypot(e.x - l.x, e.y - l.y) <= e.size * 0.55 + 10) {
								this.hurtEnemy(e, l.damage);
								this.burst(l.x, l.y, '#ff3b3b', 16);
								playSE('hit', 0.7, 0.05);
								l.dead = true;
								break;
							}
						}
						continue;
					}
					l.t += dt;
					if (!l.done && l.t >= l.dur) {
						l.done = true;
						this.enderBurst(l.x1, l.y1);
						this.enderBurst(l.x2, l.y2);
						this.player.x = Math.max(16, Math.min(this.world.w - 16, l.x2));
						this.player.y = Math.max(16, Math.min(this.world.h - 16, l.y2));
						this.dash = null;            // 传送优先：鱼跃/冲刺的 lerp 会把人物往回拖（中途用 TP 不生效的元凶）
						this.homeMoveTarget = null;   // 点击寻路同理
						this.updateCamera();
						playSE('teleport', 0.85, 0.08);
					}
				}
				this.skillLasers = this.skillLasers.filter((l) => !l.dead && (l.type === 'damage' || l.t < l.dur + 0.18));
			}

			drawSkillLasers(c) {
				const pearl = assetImg('/vs-game/assets/items/ender_pearl.png');
				for (const l of this.skillLasers) {
					c.save();
					if (l.type === 'teleport') {
						const k = Math.min(1, l.t / l.dur);
						const x = l.x1 + (l.x2 - l.x1) * k;
						const y = l.y1 + (l.y2 - l.y1) * k;
						c.shadowColor = 'rgba(180,107,255,.9)';
						c.shadowBlur = 12;
						if (pearl.complete && pearl.naturalWidth) c.drawImage(pearl, x - 11, y - 11, 22, 22);
						else { c.fillStyle = '#b46bff'; c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.fill(); }
					} else if (!l.dead) {
						c.translate(l.x, l.y);
						c.rotate(Math.atan2(l.vy, l.vx));
						c.shadowColor = 'rgba(255,59,59,.95)';
						c.shadowBlur = 14;
						c.fillStyle = '#ff3b3b';
						c.fillRect(-10, -4, 20, 8);
						c.fillStyle = '#ffd6d6';
						c.fillRect(-5, -2, 10, 4);
					}
					c.restore();
				}
			}

			updateStrikeLines(dt) {
				const sk = ACTIVE_SKILLS[this.activeSkillId];
				if (!sk || sk.type || this.strikeLines.length === 0) return;
				for (const ln of this.strikeLines) {
					if (!ln.hitCd) ln.hitCd = new Map();
					for (const e of [...this.enemies]) {
						const d = this.distToSegment(e.x, e.y, ln.x1, ln.y1, ln.x2, ln.y2);
						if (d > e.size * 0.55 + 4) continue;
						// 帧伤：每帧都结算，数字疯狂跳
					const tickDmg = Math.max(1, Math.round(this.attackPower() * sk.dmgMult));
					const roll = this.rollDamage(tickDmg);
						if (e.dummy) this.dummyHit(e, roll.dmg);   // 划除线也统计到假人面板
						e.hp -= e.dummy ? 0 : roll.dmg;
						e.hitFlash = 0.1;
						playSE(roll.crit ? 'crit' : 'hit', 0.35, 0.12);
					this.spawnDmgNum(e.x + rand(-8, 8), e.y - e.size * 0.5, '-' + Math.round(roll.dmg), roll.crit ? 'crit' : 'skill', roll.dmg);
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
				this.clearedLevels = new Set(c.clearedLevels ?? []);
				this.unlockedRooms = Array.isArray(c.rooms) ? c.rooms.map((x) => Math.floor(Number(x) || 0)) : [0, 1];
				this.inventory = Array.isArray(c.inventory) ? c.inventory : [];
				this.unlockedSkills = Array.isArray(c.unlockedSkills) ? c.unlockedSkills : [];
				this.accessories = Array.isArray(c.accessories) ? c.accessories : [];
				this.gold = Math.max(0, Math.floor(Number(c.gold) || 0));   // 引擎层留一份token，商店面板要用
				this.applyMaxHpBonus();   // 饰品生命词条 → 最大生命
				this.homeChests = Array.isArray(c.chests) ? c.chests : [];
				this.groundItems = Array.isArray(c.groundItems) ? c.groundItems : [];
				this.homeDevices = Array.isArray(c.devices) ? c.devices : [];
				this.agentCount = Math.max(0, Math.min(5, Math.floor(Number(c.agents) || 0)));
				this.agentTasks = Array.isArray(c.agentTasks) ? c.agentTasks.slice(0, this.agentCount) : [];
				this.syncHomeAgents();
				if (this.recordPlaying && !this.recordPlaying.service) {   // 服务版唱片不受箱子影响
					const src = (this.homeChests ?? []).find((x) => x.id === this.recordPlaying.chestId);
					const stillThere = src && (src.slots ?? []).some((sl) => sl && sl.item === this.recordPlaying.item);
					if (!stillThere) this.stopRecord();
				}
				if (this.crafting && this.crafting.stage === 'idle' && Array.isArray(c.craftingStorage)) {
					this.crafting.placed = c.craftingStorage.filter((x) => x === null || typeof x === 'string').slice(0, 11);
				}
				if (this.phase === 'home') this.refreshHomeItems();
				if (typeof c.initialWeapon === 'string' && WEAPONS[c.initialWeapon]) this.initialWeapon = c.initialWeapon;
				const nextActiveSkill = (typeof c.activeSkill === 'string' && ACTIVE_SKILLS[c.activeSkill]) ? c.activeSkill : null;
				if (nextActiveSkill !== this.activeSkillId) {
					// 换技能就把上一个技能的残留状态全部清掉，否则会出现
					// 「替换技能后普攻失效」：激光开关没关 / 冲刺窗口没结束 / 电磁炮还在蓄力，
					// 点击会被旧技能状态吃掉。
					this.laserSkillOn = false;
					this.railCharge = null;
					this.skillTimer = 0;
					this.teleportsLeft = 0;
				}
				this.activeSkillId = nextActiveSkill;
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
				if (msg.kind === HostMsg.HOME_MESSAGE) {
					this.homeMessage(msg.text ?? '', msg.item ?? null);
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
						this.spawnBoss(msg.enemy && ENEMY_TYPES[msg.enemy] ? msg.enemy : 'bin', msg.hp ?? 800);
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

			spawnBoss(type, hp, areaBomber = false) {
				if (this.enemies.length >= 240) return;
				const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.bin;
				const pos = this.edgeSpawnPos();
				const endless = !this.level;
				this.discovered.add(type);
				this.enemies.push({
					id: nextId++, type,
					x: pos.x, y: pos.y,
					hp, maxHp: hp,
					speed: base.speed * 0.6, size: base.size * 3,
					color: base.color, label: base.label,
					xp: base.xp * 8 * (endless ? endlessXpScale(this.player.level) : 1),
					elite: true, boss: true, hitFlash: 0, slow: 0, aggro: true,
					wanderA: rand(0, Math.PI * 2), wanderT: rand(0.8, 2.2),
					immuneKnockback: true, areaBomber: !!areaBomber, bombCd: rand(1.6, 2.6),
				});
				this.discovered.add('boss:giant');   // Boss 图鉴：无尽巨型怪
				this.setBanner('👾 BOSS：' + (areaBomber ? '轰炸型 ' : '巨型 ') + base.label + ' 文件怪！');
				this.shake = Math.max(this.shake, 0.5);
			}

			/** 精英瞄准弹 / Boss 环形报错弹幕 */
			/** 小怪招牌招式（性格攻击）：docs 纸飞机冲锋 / JS 回调地狱环 / TS 类型检查激光 / misc 翻滚冲撞 */
			updateEnemySkills(e, dt, d) {
				const sk = e.sk;
				if (sk) {
					sk.t += dt;
					if (sk.kind === 'dash') {           // docs 纸飞机 & misc 翻滚共用冲刺骨架
						if (sk.phase === 'wind') {
							if (sk.t >= sk.wind) { sk.phase = 'go'; sk.t = 0; playSE('token-shot', 0.45, 0.05); }
						} else if (sk.phase === 'go') {
							e.x += Math.cos(sk.dir) * sk.speed * dt;
							e.y += Math.sin(sk.dir) * sk.speed * dt;
							if (e.type === 'docs' && Math.random() < dt * 22)   // 纸屑尾迹
								this.burst(e.x, e.y, '#efe9dc', 1);
							const hitWall = !this.level && this.procmap && this.procBlocked(e.x, e.y);
							const hitEdge = e.x < 18 || e.y < 18 || e.x > this.world.w - 18 || e.y > this.world.h - 18;
							if (hitWall || hitEdge || sk.t >= sk.dur) {
								if ((hitWall || hitEdge) && sk.stun) { e.stunned = 1.0; this.burst(e.x, e.y, '#cfd3e4', 7); playSE('player-hurt', 0.3, 0.05); if (e.type === 'bin') { this.dropGemsAt(e.x, e.y, 2); this.dropGemsAt(e.x + rand(-16, 16), e.y + rand(-16, 16), 2); } }   // EXE 压路撞墙：震出可拾取碎屑
								sk.phase = 'rest'; sk.t = 0;
							}
						} else if (sk.t >= sk.rest) { e.sk = null; e.skillCd = rand(sk.cdMin, sk.cdMax); }
						return;
					}
					if (sk.kind === 'ring') {           // JS 回调地狱：小跳贴脸 → 落地环形弹
						if (sk.phase === 'wind') {
							e.x += (this.player.x - e.x) * Math.min(1, dt * 2.4);
							e.y += (this.player.y - e.y) * Math.min(1, dt * 2.4);
							if (sk.t >= 0.28) { sk.phase = 'go'; sk.t = 0; playSE('mine-explode', 0.45, 0.05); this.fireCallbackRing(e); }
						} else if (sk.t >= 0.5) { e.sk = null; e.skillCd = rand(2.8, 4.2); }
						return;
					}
					if (sk.kind === 'laser') {          // TS 类型检查：前半段跟枪，后半段锁走 → 射线
						if (sk.phase === 'wind') {
							if (sk.t < sk.lock) sk.dir = Math.atan2(this.player.y - e.y, this.player.x - e.x);
							if (sk.t >= sk.wind) {
								sk.phase = 'go'; sk.t = 0;
								for (let i = 0; i < 5; i++) {   // 一排高速细弹（复用弹幕管线，吃统一减伤）
									const dd = 26 + i * 34;
									this.enemyBullets.push({
										x: e.x + Math.cos(sk.dir) * dd, y: e.y + Math.sin(sk.dir) * dd,
										vx: Math.cos(sk.dir) * 620, vy: Math.sin(sk.dir) * 620,
										life: 1.1, w: 10, h: 10, dmg: 10 + Math.min(14, this.elapsed / 60), spike: true, color: '#ff6b81',
									});
								}
								this.skillFx.push({ kind: 'laser', x: e.x, y: e.y, dir: sk.dir, len: 470, t: 0, dur: 0.22 });
								playSE('laser-shot', 0.5, 0.05);
							}
						} else if (sk.t >= 0.45) { e.sk = null; e.skillCd = rand(3.2, 4.8); }
						return;
					}
					if (sk.kind === 'strafe') {         // shell 管道掠过：切线高速绕圈，留尾焰，路过刮一下
						if (sk.phase === 'wind') {
							if (sk.t >= 0.25) { sk.phase = 'go'; sk.t = 0; }
						} else if (sk.phase === 'go') {
							const px2 = this.player.x - e.x, py2 = this.player.y - e.y, pd2 = Math.hypot(px2, py2) || 1;
							const ta = Math.atan2(py2, px2) + sk.side * Math.PI / 2;
							const radial = d > 150 ? 0.5 : -0.28;   // 太远靠近一点，贴太近甩开一点
							e.x += (Math.cos(ta) * 0.82 + (px2 / pd2) * radial) * sk.speed * dt;
							e.y += (Math.sin(ta) * 0.82 + (py2 / pd2) * radial) * sk.speed * dt;
							if (Math.random() < dt * 16) this.burst(e.x, e.y, '#9ce87b', 1);
							if (sk.t >= sk.dur) { sk.phase = 'rest'; sk.t = 0; }
						} else if (sk.t >= 0.35) { e.sk = null; e.skillCd = rand(3, 4.5); }
						return;
					}
					if (sk.kind === 'spit') {           // py 缩进粘液：朝玩家吐减速区（踩中 -50% 移速）
						if (sk.phase === 'wind') {
							if (sk.t >= 0.45) {
								sk.phase = 'rest'; sk.t = 0;
								this.slimeZones.push({ x: this.player.x, y: this.player.y, r: 56, t: 2.6 });
								if (e.elite) this.slimeZones.push({ x: this.player.x + rand(-70, 70), y: this.player.y + rand(-70, 70), r: 56, t: 2.6 });
								playSE('mine-place', 0.4, 0.05);
							}
						} else if (sk.t >= 0.4) { e.sk = null; e.skillCd = rand(4, 6); }
						return;
					}
					if (sk.kind === 'lockdash') {       // search 关键词锁定：0.8s 锁定（方向固定）→ 斜向高速冲刺
						if (sk.phase === 'wind') {
							if (sk.t >= sk.wind) { sk.phase = 'go'; sk.t = 0; playSE('token-shot', 0.5, 0.05); }
						} else if (sk.phase === 'go') {
							e.x += Math.cos(sk.dir) * sk.speed * dt;
							e.y += Math.sin(sk.dir) * sk.speed * dt;
							if (sk.t >= sk.dur) { sk.phase = 'rest'; sk.t = 0; }
						} else if (sk.t >= 0.3) { e.sk = null; e.skillCd = rand(3.5, 5); }
						return;
					}
					if (sk.kind === 'wall') {           // html <div> 搭墙：玩家两侧立临时路障，往弹幕上挤
						if (sk.phase === 'wind') {
							if (sk.t >= 0.55) {
								sk.phase = 'rest'; sk.t = 0;
								const pa = Math.atan2(this.player.y - e.y, this.player.x - e.x) + Math.PI / 2;
								for (const o of (e.elite ? [-92, 0, 92] : [-92, 92])) {
									const bx = this.player.x + Math.cos(pa) * o, by = this.player.y + Math.sin(pa) * o;
									this.htmlBlocks.push({ x: bx - 44, y: by - 8, w: 88, h: 16, t: 3 });
								}
								playSE('mine-place', 0.5, 0.05);
							}
						} else if (sk.t >= 0.4) { e.sk = null; e.skillCd = rand(6, 8); }
						return;
					}
					if (sk.kind === 'pull') {           // rs 借用拉拽：把玩家朝自己拽（借用周期），接碰撞
						if (sk.phase === 'wind') {
							sk.dir = Math.atan2(this.player.y - e.y, this.player.x - e.x);
							if (sk.t >= 0.5) {
								sk.phase = 'rest'; sk.t = 0;
								const p2 = this.player;
								const dx2 = e.x - p2.x, dy2 = e.y - p2.y, dd2 = Math.hypot(dx2, dy2) || 1;
								const pull = e.elite ? 110 : 80;
								p2.x = Math.max(16, Math.min(this.world.w - 16, p2.x + (dx2 / dd2) * pull));
								p2.y = Math.max(16, Math.min(this.world.h - 16, p2.y + (dy2 / dd2) * pull));
								this.burst(p2.x, p2.y, '#dea584', 5);
								playSE('player-hurt', 0.35, 0.05);
							}
						} else if (sk.t >= 0.4) { e.sk = null; e.skillCd = rand(5, 7); }
						return;
					}
					if (sk.kind === 'blink') {          // term 光标闪烁：原地熄灭 → 玩家身边 150px 闪现 + 一圈报错弹
						if (sk.phase === 'wind') {
							e.blinkA = Math.max(0, 1 - sk.t / 0.5);
							if (sk.t >= 0.5) {
								sk.phase = 'rest'; sk.t = 0;
								const ba0 = rand(0, Math.PI * 2);
								e.x = Math.max(24, Math.min(this.world.w - 24, this.player.x + Math.cos(ba0) * 150));
								e.y = Math.max(24, Math.min(this.world.h - 24, this.player.y + Math.sin(ba0) * 150));
								e.blinkA = 1;
								const n = e.elite ? 14 : 10, off2 = rand(0, Math.PI);
								for (let i = 0; i < n; i++) {
									const ba = off2 + (i * Math.PI * 2) / n;
									this.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ba) * 165, vy: Math.sin(ba) * 165, life: 2.4, w: 10, h: 10, dmg: 8 + Math.min(8, this.elapsed / 90), spike: true, color: '#7ee787' });
								}
								playSE('teleport', 0.5, 0.05);
							}
						} else if (sk.t >= 0.4) { e.blinkA = null; e.sk = null; e.skillCd = rand(5, 7); }
						return;
					}
					if (sk.kind === 'urchburst') {      // 小海胆：缩刺弹射（近程六向小黑刺）
						if (sk.phase === 'wind') {
							if (sk.t >= 0.5) {
								sk.phase = 'rest'; sk.t = 0;
								const n = e.elite ? 10 : 6, off2 = rand(0, Math.PI);
								for (let i = 0; i < n; i++) {
									const sa = off2 + (i * Math.PI * 2) / n;
									this.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(sa) * 250, vy: Math.sin(sa) * 250, life: 0.85, w: 12, h: 12, dmg: 6, spike: true, color: '#141a26', dark: true });
								}
								playSE('mine-explode', 0.4, 0.05);
							}
						} else if (sk.t >= 0.35) { e.sk = null; e.skillCd = rand(3.5, 5); }
						return;
					}
				}
				// 触发判定：冷却好了 + 距离合适 + 招式按时间轴解锁（精英立刻解锁）；冷色时段更暴乱：索敌更远、冷却转得更快
				const rage = !this.level && this.procmap && this.procPhase() === 2;
				e.skillCd = (e.skillCd ?? rand(1.2, 2.8)) - dt * (rage ? 1.5 : 1);
				if (e.skillCd > 0 || d > (rage ? 560 : 430)) return;
				// Boss 招牌招式（S3）：巨型文件怪也会自己的那一手，冷却长、前摇大
				if (e.boss) {
					if (e.type === 'bin' && d > 100 && d < 480) {
						e.sk = { kind: 'dash', phase: 'wind', t: 0, wind: 1.0, dur: 0.7, rest: 0.5, speed: e.speed * 4.6, dir: Math.atan2(this.player.y - e.y, this.player.x - e.x), cdMin: 6, cdMax: 9, stun: true };
					} else if (e.type === 'term' && d > 130 && d < 480) {
						e.sk = { kind: 'blink', phase: 'wind', t: 0 };
					} else if (e.type === 'rs' && d < 260) {
						e.sk = { kind: 'pull', phase: 'wind', t: 0 };
					}
					return;
				}
				const tm = this.elapsed;
				if (e.type === 'docs' && (e.elite || tm > 15) && d > 120 && d < 420) {
					e.sk = { kind: 'dash', phase: 'wind', t: 0, wind: 0.6, dur: 0.55, rest: 0.35, speed: e.speed * 4.2, dir: Math.atan2(this.player.y - e.y, this.player.x - e.x), cdMin: 2.8, cdMax: 4.2, stun: false };
				} else if (e.type === 'js' && (e.elite || tm > 10) && d < 110) {
					e.sk = { kind: 'ring', phase: 'wind', t: 0 };
				} else if (e.type === 'ts' && (e.elite || tm > 25) && d > 90 && d < 420) {
					e.sk = { kind: 'laser', phase: 'wind', t: 0, wind: e.elite ? 0.65 : 0.85, lock: 0.5, dir: 0 };
				} else if (e.type === 'misc' && tm > 8 && d < 300) {
					e.sk = { kind: 'dash', phase: 'wind', t: 0, wind: 0.4, dur: 0.42, rest: 0.3, speed: e.speed * 3.2, dir: Math.atan2(this.player.y - e.y, this.player.x - e.x), cdMin: 2.8, cdMax: 4.5, stun: true };
				} else if (e.type === 'shell' && (e.elite || tm > 20) && d > 60 && d < 320) {
					e.sk = { kind: 'strafe', phase: 'wind', t: 0, side: Math.random() < 0.5 ? 1 : -1, speed: e.speed * 1.55, dur: e.elite ? 1.6 : 1.15 };
				} else if (e.type === 'py' && (e.elite || tm > 12) && d < 260) {
					e.sk = { kind: 'spit', phase: 'wind', t: 0 };
				} else if (e.type === 'search' && (e.elite || tm > 18) && d > 200 && d < 460) {
					e.sk = { kind: 'lockdash', phase: 'wind', t: 0, wind: 0.8, dur: 0.5, speed: e.speed * 5, dir: Math.atan2(this.player.y - e.y, this.player.x - e.x) };
				} else if (e.type === 'html' && (e.elite || tm > 35) && d < 330) {
					e.sk = { kind: 'wall', phase: 'wind', t: 0 };
				} else if (e.type === 'rs' && (e.elite || tm > 25) && d < 150) {
					e.sk = { kind: 'pull', phase: 'wind', t: 0 };
				} else if (e.type === 'bin' && (e.elite || tm > 40) && d > 100 && d < 400) {
					e.sk = { kind: 'dash', phase: 'wind', t: 0, wind: 1.0, dur: 0.7, rest: 0.5, speed: e.speed * 4.6, dir: Math.atan2(this.player.y - e.y, this.player.x - e.x), cdMin: 4, cdMax: 6, stun: true };
				} else if (e.type === 'term' && (e.elite || tm > 30) && d > 130 && d < 420) {
					e.sk = { kind: 'blink', phase: 'wind', t: 0 };
				} else if (e.type === 'urchin' && d < 190) {
					e.sk = { kind: 'urchburst', phase: 'wind', t: 0 };
				}
			}
			procBlocked(x, y) {
				const i = Math.floor(x / PROC_TILE), j = Math.floor(y / PROC_TILE);
				if (i < 0 || j < 0 || i >= PROC_COLS || j >= PROC_ROWS) return true;
				return !!this.procmap.walls[j * PROC_COLS + i];
			}
			/** JS 落地：环形回调弹（精英 12 向，普通 8 向） */
			fireCallbackRing(e) {
				if (this.enemyBullets.length > 140) return;
				const n = e.elite ? 12 : 8;
				const off = rand(0, Math.PI);
				for (let i = 0; i < n; i++) {
					const a = off + (i * Math.PI * 2) / n;
					const text = pick(ERROR_TEXTS);   // 文件怪弹幕统一报错文本，不再用白刺
					this.enemyBullets.push({
						x: e.x, y: e.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, text,
						life: 3.2, w: Math.max(24, text.length * 7), h: 14, dmg: 8 + Math.min(10, this.elapsed / 60),
					});
				}
			}
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
					const baseA = Math.atan2(dy, dx);
					const shots = this.player.level >= 40 ? 3 : 1; // 40级后精英弹幕3连击
					for (let i = 0; i < shots; i++) {
						const a = baseA + (i - (shots - 1) / 2) * 0.14;
						mk(Math.cos(a) * speed, Math.sin(a) * speed);
					}
				}
			}

			// ── 生成 ──
			/** 视口外圈生成（cam=0 时与旧版单屏完全一致） */
			edgeSpawnPos() {
				if (!this.level && this.procmap) {   // 大地图：绕玩家视野外一圈刷
					const a = rand(0, Math.PI * 2), r = rand(520, 720);
					return {
						x: Math.max(24, Math.min(this.world.w - 24, this.player.x + Math.cos(a) * r)),
						y: Math.max(24, Math.min(this.world.h - 24, this.player.y + Math.sin(a) * r)),
					};
				}
				const side = Math.floor(Math.random() * 4);
				const m = 30;
				const cx = this.cam.x, cy = this.cam.y;
				if (side === 0) return { x: rand(cx - m, cx + GAME_W + m), y: cy - m };
				if (side === 1) return { x: rand(cx - m, cx + GAME_W + m), y: cy + GAME_H + m };
				if (side === 2) return { x: cx - m, y: rand(cy - m, cy + GAME_H + m) };
				return { x: cx + GAME_W + m, y: rand(cy - m, cy + GAME_H + m) };
			}

			spawnEnemy(type, count, elite, meleeElite = false) {
				for (let i = 0; i < count; i++) {
					if (this.enemies.length >= 240) return;
					const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.misc;
					const pos = this.edgeSpawnPos();
					const endless = !this.level;
					const lv = this.player.level;
					const hpScale = endless ? endlessScale(lv) * this.diffMul() : (1 + this.elapsed / 90) * this.diffMul();
					const xpScale = endless ? endlessXpScale(lv) : 1;
					const lateMelee = meleeElite && lv >= 40; // 40级后近战精英血量/速度翻倍
					const eliteHpMul = (elite ? 20 : 1) * (lateMelee ? 2 : 1);
					const tunedHp = this.enemyHpFor(type, elite);
					const hpV = tunedHp == null ? base.hp * hpScale * eliteHpMul : tunedHp * (lateMelee ? 2 : 1);
					this.discovered.add(type);
					this.enemies.push({
						id: nextId++, type,
						x: pos.x + rand(-14, 14), y: pos.y + rand(-14, 14),
						hp: hpV, maxHp: hpV,
						speed: base.speed * (meleeElite ? (lateMelee ? 3.6 : 1.8) : elite ? 1.4 : 1) * (this.level?.balance?.speedMul ?? 1),
						size: base.size * (elite ? 1.5 : 1),
						color: base.color, label: base.label,
						xp: base.xp * (elite ? 3 : 1) * xpScale,
						elite: !!elite, meleeElite: !!meleeElite,
						immuneSlow: false, immuneKnockback: !!elite,
						hitFlash: 0, slow: 0, aggro: !this.level,
						wanderA: rand(0, Math.PI * 2), wanderT: rand(0.8, 2.2),
					});
				}
			}

			idleSpawn(dt) {
				this.spawnTimer -= dt * (this.chaosTimer > 0 ? 2 : 1);
				if (this.spawnTimer > 0) return;
				const rateScale = this.cfg.idleSpawnRate / 3;
				const interval = Math.max(0.35, (1.6 - this.elapsed / 150) * rateScale);   // 地图 2048×1280：基础间隔压密
				this.spawnTimer = interval;
				const batch = 2 + Math.floor(this.elapsed / 30);   // 起手 2 只/波，每 30s 加 1 只
				let pool = TIERS_BY_TIME[0][1];
				for (const [t, types] of TIERS_BY_TIME) if (this.elapsed >= t) pool = types;
				for (let i = 0; i < batch; i++) this.spawnEnemy(pick(pool), 1, false);
				if (this.elapsed > 70 && Math.random() < 0.08) {
					// 后期：部分精英改为近战冲锋型，不吃减速/击退
					const heavy = this.player.level >= 12 && Math.random() < 0.5;
					this.spawnEnemy(pick(pool), 1, true, heavy);
				}
				// 后期：极低概率出现区域轰炸 Boss（场上最多一个）
				if (this.elapsed > 180 && this.player.level >= 15 && Math.random() < 0.012 && !this.enemies.some((e) => e.areaBomber)) {
					this.spawnBoss(pick(['bin', 'term', 'rs']), Math.round(1000 + this.elapsed * 8) * this.diffMul(), true);
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
				if (this.bossRoomMode) { this.spawnTimer = 8; return; }
				if (this.bossSpawned && !this.bossKilled) { this.spawnTimer = 4; return; }
				// 第 3 关：中央 workspace/ 源源不断冒怪，整理满 10 次后停
				if (this.sortCfg) {
					if (this.sortCorrect >= (this.sortCfg.need ?? 10)) { this.spawnTimer = 8; return; }
					const rate = this.level?.balance?.spawnMul ?? 1;
					this.spawnTimer -= dt * (this.chaosTimer > 0 ? 2 : 1) * rate;
					if (this.spawnTimer > 0) return;
					this.spawnTimer = Math.max(0.5, 3.0 / rate);
					if (this.enemies.length > 80) return;
					const gate = this.sortFolders.find((f) => f.gate) ?? { x: this.world.w / 2, y: this.world.h / 2 };
					const cat = pick(['src', 'docs', 'config', 'tmp']);
					const pool = SORT_SPAWN_POOL[cat] ?? ['misc'];
					const eliteChance = this.level?.balance?.eliteChance ?? 0.1;
					this.spawnEnemyAt(pick(pool), gate.x + rand(-56, 56), gate.y + rand(-56, 56), Math.random() < eliteChance, { aggro: true });
					return;
				}
				this.spawnTimer -= dt * (this.chaosTimer > 0 ? 2 : 1);
				if (this.spawnTimer > 0) return;
				this.spawnTimer = 8;
				if (this.enemies.length > 90) return;
				this.spawnEnemy(pick(['misc', 'docs', 'config', 'js']), 2, false);
			}

			// ── 第 3 关·整理工作区：击杀掉文件 → 拾取 → 送进对应文件夹 ──
			/** 弹出一个可拾取文件（10s 后消失） */
			dropSortFile(x, y, type) {
				const cat = SORT_ENEMY_CATEGORY[type];
				const files = cat ? SORT_FILES[cat] : null;
				if (!files || !files.length) return;
				const name = pick(files);
				const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
				if ((this.sortDrops?.length ?? 0) >= 40) this.sortDrops.shift();
				this.sortDrops.push({ x, y, name, ext, type, ttl: 10, bob: rand(0, Math.PI * 2) });
			}

			/** 扩展名 → 目标文件夹 id（由关卡规则表决定） */
			sortTargetId(ext) {
				for (const r of (this.sortCfg?.rules ?? [])) if (r.exts.includes(ext)) return r.folder;
				return null;
			}

			/** 放错惩罚：原地刷一只「对应小怪 5 倍血量」的精英，且打死不掉文件 */
			spawnSortPenaltyElite(type, x, y) {
				const bal = this.level?.balance ?? {};
				const base = ENEMY_TYPES[type] ?? ENEMY_TYPES.misc;
				const floor = (bal.hpFloor ?? 500) * (1 + (bal.hpPerTier ?? 0) * (base.tier ?? 0));
				const hp = Math.max(floor, floor * this.diffMul()) * 5;
				this.spawnEnemyAt(type, x, y, true, { fixedHp: hp, noDrop: true, aggro: true });
			}

			/** 整理主循环：掉落寿命 + 虚/实状态 + F 拾取/放入 */
			updateSort(dt) {
				if (!this.sortCfg || this.bossRoomMode) return;   // Boss 房里不跑主图的整理/归档交互
				const need = this.sortCfg.need ?? 10;
				const done = this.sortCorrect >= need;
				if (this.sortDrops.length) {
					for (const d of this.sortDrops) d.ttl -= dt;
					this.sortDrops = this.sortDrops.filter((d) => d.ttl > 0);
				}
				for (const f of this.sortFolders) f.state = f.gate ? (done ? 'solid' : 'ghost') : (done ? 'ghost' : 'solid');
				this.sortFCd = Math.max(0, this.sortFCd - dt);
				const fDown = this.focused && this.keys.has('f');
				const pressed = fDown && !this.sortFPrev;
				this.sortFPrev = fDown;
				if (!pressed || this.sortFCd > 0) return;
				const p = this.player;
				if (this.sortCarried) {
					let near = null, nd = 1e9;
					for (const f of this.sortFolders) {
						if (f.gate || f.state !== 'solid') continue;
						const dd = Math.hypot(f.x - p.x, f.y - p.y);
						if (dd < nd) { nd = dd; near = f; }
					}
					if (!near || nd > 80) return;
					this.sortFCd = 0.28;
					const want = this.sortTargetId(this.sortCarried.ext);
					if (want === near.id) {
						this.sortCorrect++;
						this.sortCarried = null;
						playSE('craft-success', 0.6, 0.05);
						this.burst(near.x, near.y, '#3ddc84', 14);
						this.setBanner('✅ 归档正确 ' + this.sortCorrect + '/' + need);
					} else {
						const t = this.sortCarried.type;
						this.sortCarried = null;
						playSE('craft-fail', 0.85, 0.05);
						this.spawnSortPenaltyElite(t, p.x + (Math.random() < 0.5 ? 46 : -46), p.y + 8);
						this.setBanner('❌ 放错文件夹！');
					}
					return;
				}
				let near = null, nd = 1e9;
				for (const dd0 of this.sortDrops) {
					const dd = Math.hypot(dd0.x - p.x, dd0.y - p.y);
					if (dd < nd) { nd = dd; near = dd0; }
				}
				if (!near || nd > 58) return;
				this.sortFCd = 0.25;
				this.sortDrops = this.sortDrops.filter((x) => x !== near);
				this.sortCarried = { name: near.name, ext: near.ext, type: near.type };
				playSE('ui-click-1', 0.5, 0.03);
			}

			// ── 第 4 关·子代理：派出 → 自动「捡文件 → 送进对应文件夹」 ──
			/** 第 4 关开场（剧情播完后）自动调用：在玩家身边放出 N 个子代理，不需要玩家点按钮 */
			dispatchAgents() {
				const cfg = this.agentCfg;
				if (!cfg || this.agentsDispatched || this.phase !== 'playing') return false;
				this.agentsDispatched = true;
				const count = cfg.count ?? 5;
				const p = this.player;
				for (let i = 0; i < count; i++) {
					const ang = (i / count) * Math.PI * 2 + rand(-0.2, 0.2);
					const x = p.x + Math.cos(ang) * 46;
					const y = p.y + Math.sin(ang) * 38;
					this.agents.push({
						x, y, vx: 0, vy: 0, t: rand(0, 2), bob: rand(0, Math.PI * 2),
						mode: 'seek', target: null, carry: null, wait: 0, moving: false, face: 1,
					});
					this.burst(x, y, '#8fe3f2', 6);
				}
				this.agentPop = 0.6;
				playSE('teleport', 0.6, 0.04);   // 别用蓄力声，用传送感（子代理凭空出现）
				this.setBanner('👥 派出 ' + count + ' 个子代理');
				return true;
			}

			/** 送进文件夹：和玩家放入共用同一套结算（计数 + 开门 + 音效） */
			deliverSortFile(folderId) {
				if (!this.sortCfg) return;
				const need = this.sortCfg.need ?? 10;
				if ((this.sortCorrect ?? 0) >= need) return;
				this.sortCorrect++;
				const f = this.sortFolders.find((x) => x.id === folderId);
				if (f) this.burst(f.x, f.y, '#3ddc84', 12);
				playSE('ui-click-1', 0.45, 0.03);
				if (this.sortCorrect >= need) {
					playSE('craft-success', 0.9, 0.05);
					this.setBanner('🗂 归档完成 ' + need + '/' + need + ' —— workspace/ 打开了');
				}
			}

			/** 子代理主循环 */
			updateAgents(dt) {
				if (!this.agents?.length) return;
				if (this.bossRoomMode || !this.sortCfg) { this.agents = []; return; }
				this.agentPop = Math.max(0, this.agentPop - dt);
				const cfg = this.agentCfg ?? {};
				const speed = (cfg.speedMul ?? 0.8) * 160;   // 玩家基础速度 160，子代理按比例慢一点
				const pickTime = cfg.pickTime ?? 0.28;
				const dropTime = cfg.dropTime ?? 0.32;
				const need = this.sortCfg.need ?? 10;
				const done = (this.sortCorrect ?? 0) >= need;
				const gate = this.sortFolders.find((f) => f.gate);
				for (const a of this.agents) {
					a.t += dt;
					if (a.wait > 0) { a.wait -= dt; a.moving = false; continue; }
					let target = null;
					if (done) {
						// 全部搬完：围在中央门口待机
						if (gate) {
							const dx = gate.x - a.x, dy = gate.y + 70 - a.y;
							const d = Math.hypot(dx, dy) || 1;
							if (d > 24) { a.vx = (dx / d) * speed; a.vy = (dy / d) * speed; a.moving = true; }
							else { a.vx = a.vy = 0; a.moving = false; }
						}
					} else if (a.carry) {
						target = this.sortFolders.find((f) => f.id === a.carry.target && !f.gate && f.state === 'solid') ?? null;
						if (!target) a.carry = null;
					} else {
						// 选活：每 0.3s 重算一次；评分 = 我过去的路 + 0.7×「从文件到目标文件夹」的路，
						// 并尽量不和其他子代理抢同一个文件（抢了会白跑）
						a.pickT = (a.pickT ?? 0) - dt;
						if (a.pickT <= 0 || !this.sortDrops.includes(a.target)) {
							a.pickT = 0.3 + Math.random() * 0.15;
							let best = null, bs = 1e9;
							for (const d of this.sortDrops) {
								const toMe = Math.hypot(d.x - a.x, d.y - a.y);
								const tf = this.sortFolders.find((f) => f.id === this.sortTargetId(d.ext) && !f.gate);
								const haul = tf ? Math.hypot(tf.x - d.x, tf.y - d.y) : 0;
								let score = toMe + haul * 0.7;
								for (const b of this.agents) { if (b !== a && b.target === d) { score += 400; break; } }
								if (score < bs) { bs = score; best = d; }
							}
							a.target = best;
						}
						if (a.target) target = a.target;
					}
					if (target) {
						const dx = target.x - a.x, dy = target.y - a.y;
						const dist = Math.hypot(dx, dy) || 1;
						const arrive = a.carry ? 26 : 16;
						if (dist > arrive) {
							const sp = speed * (a.carry ? 0.88 : 1);
							a.vx = (dx / dist) * sp; a.vy = (dy / dist) * sp; a.moving = true;
							a.face = a.vx > 0 ? 1 : a.vx < 0 ? -1 : a.face;
						} else {
							a.vx = a.vy = 0; a.moving = false;
							if (a.carry) {
								const fid = a.carry.target;
								a.carry = null; a.target = null; a.wait = dropTime;
								this.deliverSortFile(fid);
							} else {
								const d = a.target;
								const idx = this.sortDrops.indexOf(d);
								if (idx >= 0) {
									this.sortDrops.splice(idx, 1);
									a.carry = { name: d.name, ext: d.ext, target: this.sortTargetId(d.ext) };
									a.wait = pickTime;
								} else { a.target = null; }
							}
						}
					} else if (!done) {
						// 没事干：慢慢往玩家身边靠
						const p = this.player;
						const dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy) || 1;
						if (d > 90) { a.vx = (dx / d) * speed * 0.6; a.vy = (dy / d) * speed * 0.6; a.moving = true; }
						else { a.vx = a.vy = 0; a.moving = false; }
					}
					// 互相推开，避免叠在一起
					for (const b of this.agents) {
						if (b === a) continue;
						const dx = a.x - b.x, dy = a.y - b.y;
						const dd = Math.hypot(dx, dy);
						if (dd > 0.01 && dd < 26) { const push = (26 - dd) * 0.5; a.x += (dx / dd) * push; a.y += (dy / dd) * push; }
					}
					a.x = Math.max(20, Math.min(this.world.w - 20, a.x + a.vx * dt));
					a.y = Math.max(20, Math.min(this.world.h - 20, a.y + a.vy * dt));
				}
			}

			/** 子代理绘制（画在玩家之前，被玩家挡住） */
			drawAgents(c, t) {
				if (!this.agents?.length) return;
				for (const a of this.agents) {
					const bob = Math.sin(t * 5 + a.bob) * 2;
					const state = a.carry ? 'carry' : a.moving ? 'walk' : 'idle';
					c.save();
					c.globalAlpha = 0.28;
					c.fillStyle = '#0b0d14';
					c.beginPath(); c.ellipse(a.x, a.y + 15, 13, 5, 0, 0, Math.PI * 2); c.fill();
					c.restore();
					// 行走图默认朝左：往右走时整体水平镜像（抱文件/待机图对称，翻了也没差）
					const drawn = drawSubSprite(c, state, a.t, a.x, a.y + bob, 40, a.face > 0);
					if (!drawn) {
						c.save();
						c.fillStyle = '#8fe3f2';
						c.beginPath(); c.arc(a.x, a.y, 10, 0, Math.PI * 2); c.fill();
						c.restore();
					}
				}
			}

			// ── P2 宝箱：走近按 F 撬开（1.5s），奖励服务端直接入账 ──
			updateChests(dt) {
				const p = this.player;
				// 海边商店：走近亮提示，按 F 开/关面板（放在「无宝箱早退」之前，免得没宝箱的关卡按 F 也打不开）
				this.shopNear = false;
				if (this.level?.shop && !this.bossRoomMode) {   // Boss 房里不能开主图商店（shop 坐标会按 Boss 房尺寸重算，正好落在房里）
					const sx = this.level.shop.xf * this.world.w, sy = this.level.shop.yf * this.world.h;
					this.shopNear = Math.hypot(sx - p.x, sy - p.y) <= 110;
					if ((this.shopFCd ?? 0) > 0) this.shopFCd -= dt;
					if (this.shopNear && this.focused && this.keys.has('f') && (this.shopFCd ?? 0) <= 0) { this.openLevelShop(); this.shopFCd = 0.4; }
				}
				// 本关没有宝箱：只跳过宝箱相关逻辑
				if (!this.chests || this.chests.length === 0) { this.chestNear = null; this.chestProgress = 0; return; }
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
				playSE('chest-open', 0.9);
				this.burst(ch.x, ch.y, '#ffd54f', 16);
				const gold = ch.tier === 'gold' ? 200 + Math.floor(rand(0, 61)) : 60 + Math.floor(rand(0, 61));
				// 当前两个关卡只掉木材/铁锭/token
				const item = Math.random() < 0.6 ? 'mat-wood' : 'mat-ingot-silver';
				this.spawnDmgNum(ch.x, ch.y - 30, '+' + gold + ' token', 'gold');
				// 第 5 关起：Boss 宝箱按关卡配置发放固定奖励（loot 列表），不再走随机材料池
				const loot = ch.bossChest ? (this.level?.bossRoom?.loot ?? null) : null;
				if (loot && loot.length > 0) {
					this.setBanner('🎁 ' + gold + ' token' + loot.map((x) => ' 「' + itemMeta(x.item).name + '」×' + x.count).join(' +'));
					for (const x of loot) this.sendWs({ kind: ClientMsg.CHEST_LOOT, gold: 0, item: x.item, count: x.count ?? 1 });
					this.sendWs({ kind: ClientMsg.CHEST_LOOT, gold, item: null });
				} else {
					this.setBanner('🎁 ' + gold + ' token' + (item ? ' 和「' + itemMeta(item).name + '」入包' : '入账！'));
					this.sendWs({ kind: ClientMsg.CHEST_LOOT, gold, item });
				}
				// Boss 宝箱：捡起才算通关，通知 host 发牌
				if (ch.bossChest) {
					this.setBanner('👑 通关！翻卡抽战利');
					this.sendWs({ kind: ClientMsg.BOSS_KILL, levelId: this.level?.id ?? null });
				}
			}

			/** 关卡装饰：向右河道箭标 + 关底 Boss 圈预览 */
			drawMapGround(c, lv, m) {   // 地面质感：按主题铺视口内格子 + 世界勾边（布景的"底"）
				c.save();                // 内含多种 lineWidth/globalAlpha：整体包起来，别泄漏给后面的绘制
				const style = m.ground ?? 'office';
				const W = this.world.w, H = this.world.h, CELL = 64;
				const x0 = Math.max(0, Math.floor(this.cam.x / CELL) * CELL);
				const y0 = Math.max(0, Math.floor(this.cam.y / CELL) * CELL);
				const x1 = Math.min(W, this.cam.x + GAME_W + CELL), y1 = Math.min(H, this.cam.y + GAME_H + CELL);
				for (let gy = y0; gy < y1; gy += CELL) {
					for (let gx = x0; gx < x1; gx += CELL) {
						const h = (gx * 7919 + gy * 104729) % 100;
						if (style === 'office' || style === 'tidy') {
							c.fillStyle = h < 50 ? 'rgba(255,255,255,0.013)' : 'rgba(0,0,0,0.045)';
							c.fillRect(gx, gy, CELL, CELL);
							c.strokeStyle = style === 'tidy' ? 'rgba(120,180,140,0.05)' : 'rgba(148,163,184,0.045)';
							c.lineWidth = 1; c.strokeRect(gx + 0.5, gy + 0.5, CELL - 1, CELL - 1);
							if (h > 93) { c.fillStyle = 'rgba(0,0,0,0.06)'; c.beginPath(); c.ellipse(gx + 32, gy + 34, 14, 9, 0, 0, Math.PI * 2); c.fill(); }
						} else if (style === 'archive' || style === 'backlog') {
							c.fillStyle = h < 55 ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.05)';
							c.fillRect(gx, gy, CELL, CELL);
							if ((gx / CELL + gy / CELL) % 2 === 0) { c.strokeStyle = 'rgba(148,163,184,0.05)'; c.lineWidth = 1; c.strokeRect(gx + 0.5, gy + 0.5, CELL - 1, CELL - 1); }
							if (style === 'backlog' && h > 88) {
								c.save(); c.translate(gx + 20 + h % 24, gy + 22 + h % 18); c.rotate((h % 7) * 0.4);
								c.fillStyle = 'rgba(226,232,240,0.13)'; c.fillRect(-6, -8, 12, 16); c.restore();
							}
							if (style === 'archive' && h > 94) {
								c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1;
								c.beginPath(); c.moveTo(gx + 10, gy + 40); c.lineTo(gx + 30, gy + 28); c.lineTo(gx + 52, gy + 36); c.stroke();
							}
						} else if (style === 'reef') {
							if (h > 60) { c.strokeStyle = 'rgba(120,90,40,0.09)'; c.lineWidth = 2; c.beginPath(); c.arc(gx + 32, gy + 46, 20, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
							if (h > 96) { c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.arc(gx + 48, gy + 18, 2.5, 0, Math.PI * 2); c.fill(); }
						}
					}
				}
				const accent = m.accent ?? '#4f6ef7';
				c.save();                                  // 暗角会临时把 lineWidth 改到 26：包起来，别泄漏给后面的地雷/敌人
				c.strokeStyle = accent;
				c.globalAlpha = 0.20; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
				c.globalAlpha = 0.08; c.lineWidth = 26; c.strokeRect(0, 0, W, H);
				c.restore();
				c.restore();
			}
			drawMapZones(c, zones) {   // 地面色块：地毯 / 通道 / 功能区（label 可选）
				if (!zones) return;
				c.save();
				for (const z of zones) {
					c.fillStyle = z.fill;
					c.fillRect(z.x, z.y, z.w, z.h);
					if (z.line) { c.strokeStyle = z.line; c.lineWidth = 2; c.setLineDash([10, 8]); c.strokeRect(z.x, z.y, z.w, z.h); c.setLineDash([]); }
					if (z.label) {
						c.fillStyle = 'rgba(255,255,255,0.3)';
						c.font = 'bold 15px ui-monospace,monospace';
						c.textAlign = 'center'; c.textBaseline = 'middle';
						c.fillText(z.label, z.x + z.w / 2, z.y + 20);
					}
				}
				c.restore();
			}
			drawMapProps(c, props, t) {   // 环境件：按画笔绘制，落地件带投影，视口裁剪
				if (!props) return;
				const sx0 = this.cam.x - 140, sx1 = this.cam.x + GAME_W + 140;
				const sy0 = this.cam.y - 160, sy1 = this.cam.y + GAME_H + 160;
				for (const pr of props) {
					if (pr.x < sx0 || pr.x > sx1 || pr.y < sy0 || pr.y > sy1) continue;
					const fn = MAP_PAINT[pr.kind];
					if (!fn) continue;
					const s = (pr.s ?? 1) * 1.25;
					if (!MAP_WALL_PROPS.has(pr.kind)) {   // 落地件：脚下软投影，把东西"压"在地上
						c.fillStyle = 'rgba(0,0,0,0.16)';
						c.beginPath(); c.ellipse(pr.x + 2, pr.y + 13 * s, 25 * s, 8 * s, 0, 0, Math.PI * 2); c.fill();
					}
					fn(c, pr.x, pr.y, s, t, pr.v ?? 0, pr);
				}
			}
			drawLevelDecor(c) {
				const lv = this.level;
				if (!lv) return;
				const t = this.elapsed ?? 0;
				if (this.bossRoomMode) {
					// Boss 房专属布景：每个 Boss 一间主题房（bossRoom.map）
					const bm = lv.bossRoom && lv.bossRoom.map;
					if (bm) { this.drawMapGround(c, lv, bm); this.drawMapZones(c, bm.zones); this.drawMapProps(c, bm.props, t); }
					return;
				}
				const m = lv.map;
				if (m) { this.drawMapGround(c, lv, m); this.drawMapZones(c, m.zones); this.drawMapProps(c, m.props, t); }
				c.save();
				if (m?.lane !== false) {
					c.fillStyle = lv.theme?.lane ?? 'rgba(79,110,247,0.08)';
					c.font = 'bold 34px system-ui,sans-serif';
					c.textAlign = 'center';
					c.textBaseline = 'middle';
					const step = 224;
					const gx0 = Math.floor(this.cam.x / step) * step;
					for (let x = gx0; x < this.cam.x + GAME_W + step; x += step) {
						if (x < this.world.w - 60) c.fillText('»', x, this.world.h / 2);
					}
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
					// 未满足前置时给出原因提示
					if (!this.bossSpawned && (lv.shop || lv.sort)) {
						const reason = (lv.sort && (this.sortCorrect ?? 0) < (lv.sort?.need ?? 10)) ? '🔒 先完成整理' : (this.chests ?? []).some((cc) => !cc.bossChest && !cc.opened) ? '🔒 先开完宝箱' : null;
						if (reason) { c.font = 'bold 16px system-ui'; c.fillStyle = 'rgba(255,213,79,0.95)'; c.fillText(reason, bx, by + 44); }
					}
				}
				c.restore();
			}

			drawAreaBombs(c, t) {
				for (const b of this.areaBombs) {
					c.save();
					if (!b.done) {
						const k = Math.max(0, Math.min(1, b.delay / 0.9));
						// 红色轰炸预警 + 感叹号闪现
						c.strokeStyle = 'rgba(255,60,60,' + (0.5 + 0.4 * k) + ')';
						c.fillStyle = 'rgba(255,60,60,' + (0.14 + 0.10 * k) + ')';
						c.lineWidth = 2;
						c.beginPath();
						c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
						c.fill();
						c.stroke();
						const ex = 1 + 0.18 * Math.sin(t * 28);
						c.font = 'bold ' + Math.round(26 * ex) + 'px system-ui,sans-serif';
						c.textAlign = 'center';
						c.textBaseline = 'middle';
						c.fillStyle = 'rgba(255,80,80,.95)';
						c.fillText('!', b.x, b.y - 4);
					} else {
						const k = Math.max(0, b.life / 0.9);
						c.strokeStyle = 'rgba(255,60,60,' + (0.7 * k) + ')';
						c.lineWidth = 3;
						c.beginPath();
						c.arc(b.x, b.y, b.r * (1 + (1 - k) * 0.5), 0, Math.PI * 2);
						c.stroke();
					}
					c.restore();
				}
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
			cdMul() { return Math.max(0.4, 1 - 0.10 * this.player.passives.haste); }
			dmgMul() { return 1 + 0.20 * this.player.passives.might; }
			accessoryAttackRange() {
				let min = 0, max = 0;
				for (const it of this.accessories ?? []) {
					const meta = it ? itemMeta(it) : null;
					if (meta?.attack) { min += Number(meta.attack[0]); max += Number(meta.attack[1]); }
				}
				return { min, max };
			}
			attackPower() {
				const r = this.accessoryAttackRange();
				const mult = this.dmgMul();
				const min = (BASE_ATTACK + r.min) * mult;
				const max = (BASE_ATTACK + r.max) * mult;
				return min + Math.random() * Math.max(0, max - min);
			}
			weaponDamage(type, factor = 1) {
				const mult = WEAPON_DMG_MULT[type] ?? 0.2;
				return this.attackPower() * mult * factor;
			}
			/** 已佩戴饰品某类词条总和（让 crit/cdmg/def/hp 这类词条真的生效） */
			accessoryAffixSum(key) {
				let sum = 0;
				for (const it of this.accessories ?? []) {
					if (!it) continue;
					const m = itemMeta(it);
					const r = m?.affixStats?.[key] ?? (key === 'atk' && m?.attack ? m.attack : null);
					if (r) sum += (Number(r[0]) + Number(r[1])) / 2;
				}
				return sum;
			}
			/** 饰品「生命」词条 → 额外最大生命（baseMaxHp 记基础值，避免重复叠加） */
			applyMaxHpBonus() {
				const p = this.player;
				if (!p) return;
				if (!Number.isFinite(p.baseMaxHp)) p.baseMaxHp = p.maxHp || 100;
				const bonus = Math.round(this.accessoryAffixSum('hp'));
				p.maxHp = p.baseMaxHp + bonus;
				p.hp = Math.min(p.hp ?? p.maxHp, p.maxHp);
				this.hpBonus = bonus;
				return bonus;
			}
			critChance() { return BASE_CRIT_RATE + this.accessoryAffixSum('crit') / 100; }
			critDamage() { return BASE_CRIT_DMG + this.accessoryAffixSum('cdmg') / 100; }
			rollDamage(dmg) {
				if (Math.random() < this.critChance()) return { dmg: dmg * this.critDamage(), crit: true };
				return { dmg, crit: false };
			}
			defensePower() {
				let def = (this.player.passives.armor || 0) * 5 + this.accessoryAffixSum('def');
				if (this.isWorkActive()) def += 300;
				return def;
			}
			incomingDamage(raw) {
				const def = this.defensePower();
				return Math.max(1, raw * (1 - def / (def + 100)));
			}

			takeWeaponCd(type) {
				if (this.weaponCd[type] === undefined) this.weaponCd[type] = 0;
				return this.weaponCd[type];
			}

			// ── 主更新 ──
			tick(dt) {
				if (this.railCharge && this.phase === 'home') {
					// 家里蓄力：动画推进到第 3 帧停住，并钉住角色
					this.railCharge.t = Math.min(0.13, this.railCharge.t + dt);
					this.homeMoveTarget = null;
					this.player.moving = false;
				}
				if (this.phase === 'home') {
					this.elapsed += dt;   // 家里也要推进时间：否则剑技去抖/连击窗口/水面波纹全冻住（普攻只能挥一次）
					if (this.skillCd > 0) this.skillCd -= dt;
					if (this.skillTimer > 0) { this.skillTimer -= dt; if ((this.teleportsLeft ?? 0) <= 0 && ACTIVE_SKILLS[this.activeSkillId]?.id === 'strike') this.skillTimer = 0; }   // 划除次数用尽 → 立刻结束技能窗口，普攻马上可用
					for (const ln of this.strikeLines) ln.life -= dt;
					this.strikeLines = this.strikeLines.filter((ln) => ln.life > 0);
					this.updateStrikeLines(dt);
					this.updateBeams(dt);
					this.syncDummyEnemies();   // 训练假人：先同步成敌人，才能吃到武器/技能伤害
					this.updateDummies(dt);
					// 家里也跑武器/命中结算（自动武器开不开由 autoWeaponsEnabled() 决定）
					this.buildGrid();   // 空间网格（命中查询靠它）
					this.updateWeapons(dt); this.updateProjectiles(dt); this.updateRings(dt);
					this.updatePendingShots(dt);
					this.updateMines(dt); this.updateAreaBombs(dt); this.updateEnemyBullets(dt);
					this.checkCollisions();   // 命中结算（光束/超电磁炮、弹道、冲击线都在这里）
					if (this.purge) this.updatePurge(dt);   // 肃清在家/钓鱼房也能放
					this.updateHome(dt);
					if (this.homeRoom === 2) {
					// 大地图：每帧校正 world 尺寸（避免关卡遗留尺寸让人走出图）
					this.world = { w: FISH_ROOM.world.w, h: FISH_ROOM.world.h };
					this.clampFishingRoom();
				}
					this.updateSwordSwing(dt);   // 第三房间点击＝普攻，家里也要推进剑技/剑气
					if (this.homeRoom === 2) { this.updateFishing(dt); this.updateFishMonsters(dt); }
					this.updateFishingDeath(dt);   // 钓鱼房间死亡 → 黑屏 → 床上睁眼
					this.updateHomeAgents(dt);
					this.updateSkillLasers(dt);
					this.updateFx(dt);
					return;
				}
				if (this.phase === 'storydeath') {          // 剧情中死亡：闭眼 → 回开头重走剧情（不结算、不回家）
					this.storyDeath.t += dt;
					if (this.storyDeath.t >= STORY_DEATH.restart) { this.startVoidIntro(); return; }
					return;
				}
				if (this.phase !== 'playing' && this.phase !== 'dying') {
					dt = Math.min(dt, 1 / 30);
					if (this.phase === 'bossintro') {
						this.updateHomeScene(dt);       // 回家过场：人物自己走过去 → 停下 → 再开对话
						this.updateBossIntroText(dt);   // 对话打字机：世界定格、文字照走
					}
					const p = this.player;
					if (p && p.skillAction) {
						p.skillAction.t += dt;
						if (p.skillAction.t >= p.skillAction.dur) p.skillAction = null;
					}
					return;
				}
				dt = Math.min(dt, 1 / 30);
				if (this.phase === 'dying') {
					// 死亡慢动作：0.9s 真实时间的 25% 时流，然后进结算
					this.deathTimer -= dt;
					dt *= 0.25;
					if (this.deathTimer <= 0) { this.gameOver(); return; }
				}
				// 右上角计时（以及一切难度时间轴）：剧情里必须等龙飞走才开始走表
				if (!(this.storyMode && this.cycleStartAt == null)) this.elapsed += dt;

				if (this.shieldTimer > 0) this.shieldTimer -= dt;
				if (this.freezeTimer > 0) this.freezeTimer -= dt;
				if (this.chaosTimer > 0) this.chaosTimer -= dt;
				// 主动技能：冷却 + 持续时间 + 划除线生命
				if (this.skillCd > 0) this.skillCd -= dt;
				if (this.skillTimer > 0) { this.skillTimer -= dt; if ((this.teleportsLeft ?? 0) <= 0 && ACTIVE_SKILLS[this.activeSkillId]?.id === 'strike') this.skillTimer = 0; }   // 划除次数用尽 → 立刻结束技能窗口，普攻马上可用
				for (const ln of this.strikeLines) ln.life -= dt;
				this.strikeLines = this.strikeLines.filter((ln) => ln.life > 0);
				if (this.banner) { this.banner.life -= dt; if (this.banner.life <= 0) this.banner = null; }

				// 保底刷怪常驻（工作是额外加怪，不让位）；chaos 期间加倍
				if (!this.level) { if (!this.storyMode || this.story?.enemiesOn) this.idleSpawn(dt); }   // 开局剧情冒怪前不刷保底
				else this.levelTrickle(dt);

				this.updatePlayer(dt);
				this.updateStory(dt);              // 开局剧情：走近 NPC / 冒怪 / 吃白饭 / 10 级乱流
				this.updateCycle();                // 时辰循环：30s白天/30s深夜/30s冷色
				if (this.purge) this.updatePurge(dt); else this.updateCamera(dt);   // 肃清：移动键推镜头，人物视角由技能接管
				this.updateFamiliar(dt);   // 浮游 deepseek 跟随（Token弹/编译激光的发射源）
				if (!this.playerPhasedOut()) this.updateSkillLasers(dt);   // 相位移除：技能激光也不在这儿
				this.updateEnemies(dt);
				this.updateAreaHazards(dt);   // PY 粘液 / HTML 路障寿命
				this.updateChests(dt);
				if (!this.playerPhasedOut()) this.updateSwordSwing(dt);   // 剑技/剑气：与宝箱无关，必须无条件更新（没有宝箱的关卡也要能普攻）
				this.updateSort(dt);
				this.updateAgents(dt);
				this.checkBossZone();
				this.updateStrikeLines(dt);
				this.buildGrid();
				if (this.playerPhasedOut()) {
					// 相位移除：他的武器/弹道/雷/环全部冻结且不结算；敌人弹幕照常飞（反正选不到他）
					this.updateEnemyBullets(dt);
					this.updateAreaBombs(dt);
				} else {
					this.updateWeapons(dt);
					this.updateRings(dt);
					this.updatePendingShots(dt);
					this.updateProjectiles(dt);
					this.updateBeams(dt);
					this.updateMines(dt);
					this.updateEnemyBullets(dt);
					this.updateAreaBombs(dt);
					this.checkCollisions();
				}
				this.collectGems(dt);
				this.updateFx(dt);
				this.checkLevelUp();

				if (this.player.hp <= 0 && this.phase === 'playing') {
					if (this.storyMode) {   // 开局剧情里死亡：闭眼 → 从头重走剧情，不能回家
						this.phase = 'storydeath';
						this.storyDeath = { t: 0 };
						this.keys.clear();
						this.pointerHeld = false;
						playSE('player-hurt', 0.9, 0.1);
						this.shake = Math.max(this.shake, 0.45);
					} else {
						this.phase = 'dying';
					this.deathTimer = 0.9;
					this.shake = Math.max(this.shake, 0.5);
					this.keys.clear();
				}
				}
			}

			/** 无尽办公室：把玩家从墙格里推出来（圆 vs 相邻墙格 AABB）；纸怪无视墙飘过去 */
			procCollide(p) {
				const r = 11, T = PROC_TILE;
				const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
				for (let j = ty - 1; j <= ty + 1; j++) for (let i = tx - 1; i <= tx + 1; i++) {
					if (i < 0 || j < 0 || i >= PROC_COLS || j >= PROC_ROWS) continue;
					if (!this.procmap.walls[j * PROC_COLS + i]) continue;
					const nx = Math.max(i * T, Math.min(p.x, (i + 1) * T));
					const ny = Math.max(j * T, Math.min(p.y, (j + 1) * T));
					const ddx = p.x - nx, ddy = p.y - ny, d2 = ddx * ddx + ddy * ddy;
					if (d2 > 0.0001 && d2 < r * r) {
						const d = Math.sqrt(d2), push = (r - d) / d;
						p.x += ddx * push; p.y += ddy * push;
					} else if (d2 <= 0.0001) {
						p.y = (j + 1) * T + r;   // 圆心陷进墙格：向下顶出
					}
				}
			}
			/** HTML <div> 临时路障：把玩家从方块里推出来（和 procCollide 同套路，圆 vs AABB） */
			collideHtmlBlocks(p) {
				const r = 11;
				for (const b of this.htmlBlocks) {
					const nx = Math.max(b.x, Math.min(p.x, b.x + b.w));
					const ny = Math.max(b.y, Math.min(p.y, b.y + b.h));
					const ddx = p.x - nx, ddy = p.y - ny, d2 = ddx * ddx + ddy * ddy;
					if (d2 > 0.0001 && d2 < r * r) {
						const d = Math.sqrt(d2), push = (r - d) / d;
						p.x += ddx * push; p.y += ddy * push;
					} else if (d2 <= 0.0001) { p.y = b.y + b.h + r; }
				}
			}
			/** 区域危害与临时路障的寿命（PY 粘液 / HTML 墙） */
			updateAreaHazards(dt) {
				if (this.slimeZones && this.slimeZones.length) this.slimeZones = this.slimeZones.filter((z) => (z.t -= dt) > 0);
				if (this.htmlBlocks && this.htmlBlocks.length) this.htmlBlocks = this.htmlBlocks.filter((b) => (b.t -= dt) > 0);
			}
			/** 画区域危害（地面层：粘液洼地 / <div> 路障） */
			drawAreaHazards(c, t) {
				if (this.slimeZones) for (const z of this.slimeZones) {
					c.save();
					c.globalAlpha = Math.min(0.5, 0.18 + z.t * 0.12);
					c.fillStyle = '#3f8f5f';
					c.beginPath(); c.ellipse(z.x, z.y, z.r, z.r * 0.72, 0, 0, Math.PI * 2); c.fill();
					c.globalAlpha = Math.min(0.85, 0.35 + z.t * 0.2);
					c.fillStyle = '#a5d6a7'; c.font = 'bold 11px ui-monospace,monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
					c.fillText('#indent', z.x, z.y);
					c.restore();
				}
				if (this.htmlBlocks) for (const b of this.htmlBlocks) {
					c.save();
					c.globalAlpha = Math.min(1, b.t * 1.6);
					c.fillStyle = 'rgba(228,77,38,.28)'; c.fillRect(b.x, b.y, b.w, b.h);
					c.strokeStyle = '#e44d26'; c.lineWidth = 2; c.strokeRect(b.x, b.y, b.w, b.h);
					c.fillStyle = '#ffb59d'; c.font = 'bold 10px ui-monospace,monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
					c.fillText('<div>', b.x + b.w / 2, b.y + b.h / 2 + 1);
					c.restore();
				}
			}
			updatePlayer(dt) {
				const p = this.player;
				if (this.railCharge) {
					// 蓄力：钉在原地，shoot 动画播到第 3 帧就停住（帧区间 [0.12,0.22)）
					this.railCharge.t = Math.min(0.13, this.railCharge.t + dt);
					p.moving = false;
					if (p.actionCd > 0) p.actionCd -= dt;
					if (this.dash) this.dash = null;
					return;
				}
				if (this.purge) {   // 肃清：人物原地不动（移动键交给相机）、隐身、无敌
					p.moving = false;
					if (p.actionCd > 0) p.actionCd -= dt;
					if (p.invuln > 0) p.invuln -= dt;
					return;
				}
				if (p.skillAction) {
					p.skillAction.t += dt;
					if (p.skillAction.t >= p.skillAction.dur) p.skillAction = null;
				}
				if (p.actionCd > 0) p.actionCd -= dt;
				if (this.dash) {
					const d = this.dash;
					d.t += dt;
					const k = Math.min(1, d.t / d.dur);
					const ease = k * k * (3 - 2 * k);
					p.x = d.x1 + (d.x2 - d.x1) * ease;
					p.y = d.y1 + (d.y2 - d.y1) * ease;
					p.moving = true;
					if (d.leap) {   // 鱼跃残影：每隔一点距离留一个（记在物理帧里，跟渲染帧率无关）
						this.leapGhosts = this.leapGhosts ?? [];
						const lastG = this.leapGhosts[this.leapGhosts.length - 1];
						if (!lastG || Math.hypot(lastG.x - p.x, lastG.y - p.y) > 12) this.leapGhosts.push({ x: p.x, y: p.y, t: 0, dur: 0.26 });
					}
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
					const inSlime = !!(this.slimeZones && this.slimeZones.some((z) => Math.hypot(p.x - z.x, p.y - z.y) < z.r + 8));
					const spd = p.speed * (1 + 0.10 * p.passives.speed) * (inSlime ? 0.5 : 1);   // PY 缩进粘液：踩中减速 50%
					p.x += (dx / len) * spd * dt;
					p.y += (dy / len) * spd * dt;
					if (dx !== 0) p.facing = dx > 0 ? 1 : -1;
				}
				p.x = Math.max(16, Math.min(this.world.w - 16, p.x));
				p.y = Math.max(16, Math.min(this.world.h - 16, p.y));
				if (!this.level && this.procmap) this.procCollide(p);   // 办公室墙：人绕路走
				if (this.htmlBlocks && this.htmlBlocks.length) this.collideHtmlBlocks(p);   // HTML 搭墙：临时路障
				if (p.invuln > 0) p.invuln -= dt;
				if (p.celebrate > 0) p.celebrate -= dt;
				if (p.passives.regen > 0) p.hp = Math.min(p.maxHp, p.hp + 0.6 * p.passives.regen * dt);
			}

			updateEnemies(dt) {
				const p = this.player;
				const slowMul = (e) => (e.slow > 0 && !e.immuneSlow ? 0.5 : 1) * (this.freezeTimer > 0 ? 0.5 : 1);
				for (const e of this.enemies) {
					if (e.shieldT > 0) e.shieldT -= dt;   // config 括号护盾剩余时间
					if (e.reflectCd > 0) e.reflectCd -= dt;
					let dx = p.x - e.x, dy = p.y - e.y;
					let d = Math.hypot(dx, dy) || 1;
					if (this.playerPhasedOut()) {
						// 人物在另一个空间：敌人选不到他，原地游荡（不追、不放弹幕、不轰炸）
						e.wanderT = (e.wanderT ?? rand(0.8, 2.2)) - dt;
						if (e.wanderT <= 0) { e.wanderA = rand(0, Math.PI * 2); e.wanderT = rand(0.8, 2.2); }
						const wa = this.wanderAng(e);
						e.x += Math.cos(wa) * e.speed * 0.35 * dt;
						e.y += Math.sin(wa) * e.speed * 0.35 * dt;
						e.x = Math.max(16, Math.min(this.world.w - 16, e.x));
						e.y = Math.max(16, Math.min(this.world.h - 16, e.y));
						if (e.hitFlash > 0) e.hitFlash -= dt;
						if (e.slow > 0) e.slow -= dt;
						continue;
					}
					// 营地睡眠：430px 内唤醒（关卡推进感；近身生成的怪首帧即醒）
					if (!e.aggro) {
						if (d <= 430) e.aggro = true;
						else {
							e.x += Math.sin((this.elapsed + e.id) * 1.8) * 3 * dt;
							if (e.hitFlash > 0) e.hitFlash -= dt;
							continue;
						}
					}
					if (e.urchin && e.boss) { this.updateUrchinBoss(e, dt); continue; }
					if (e.stunned > 0) {   // 翻滚撞墙自晕：原地发懵
						e.stunned -= dt;
						if (e.hitFlash > 0) e.hitFlash -= dt;
						if (e.slow > 0) e.slow -= dt;
						continue;
					}
					const coldRage = !this.level && this.procmap && this.procPhase() === 2 ? 1.4 : 1;   // 冷色时段：怪物暴乱，移速 +40%
					const spd = e.speed * slowMul(e) * coldRage;
					if (e.elite && !e.boss && !e.meleeElite) {
						// 远程精英（近战精英走下方追击逻辑）：入图后不追人，随机游走
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
							const wa2 = this.wanderAng(e);
							e.x += Math.cos(wa2) * spd * 0.55 * dt;
							e.y += Math.sin(wa2) * spd * 0.55 * dt;
							if (e.x < 16) { e.x = 16; e.wanderA = rand(-Math.PI / 2, Math.PI / 2); }
							if (e.x > this.world.w - 16) { e.x = this.world.w - 16; e.wanderA = Math.PI + rand(-Math.PI / 2, Math.PI / 2); }
							if (e.y < 16) { e.y = 16; e.wanderA = rand(0, Math.PI); }
							if (e.y > this.world.h - 16) { e.y = this.world.h - 16; e.wanderA = Math.PI + rand(0, Math.PI); }
						}
					} else if (e.sk) {
						// 招牌招式进行中：位移由招式接管（冲锋/起跳/锁走）
					} else if (e.boss) {
						e.x += (dx / d) * spd * dt;
						e.y += (dy / d) * spd * dt;   // Boss 直线压迫，不绕
					} else {
						// 性格走位：追人叠加正弦横摆（demo 的灵动游走），轻纸片摆得欢、重家伙摆得少
						if (e.weaveT == null) { e.weaveT = rand(0, Math.PI * 2); e.weaveFq = rand(1.6, 2.8); e.weaveDir = Math.random() < 0.5 ? 1 : -1; }
						e.weaveT += dt * e.weaveFq;
						const amp = Math.max(5, 24 - e.size * 0.45) * Math.min(1, spd / 55);
						const kite = e.type === 'ts' && d < 230 ? -0.7 : 1;   // TS 保持距离放激光
						const wob = Math.sin(e.weaveT) * amp * e.weaveDir;
						e.x += ((dx / d) * spd * kite + (-dy / d) * wob) * dt;
						e.y += ((dy / d) * spd * kite + (dx / d) * wob) * dt;
					}
					if (e.boss && e.home) {
						const hdx = e.x - e.home.x, hdy = e.y - e.home.y;
						const hd = Math.hypot(hdx, hdy);
						if (hd > e.home.r) {
							e.x = e.home.x + (hdx / hd) * e.home.r;
							e.y = e.home.y + (hdy / hd) * e.home.r;
						}
					}
					if (!e.dummy) this.updateEnemySkills(e, dt, d);   // 招牌招式（巨型文件怪也会自己那一手）
					if (e.hitFlash > 0) e.hitFlash -= dt;
					if (e.slow > 0) e.slow -= dt;
					// 精英/Boss 发射报错弹幕（近战精英不远程）
					if (e.elite && !e.meleeElite) {
						e.shootCd = (e.shootCd ?? rand(1.2, 2.6)) - dt;
						if (e.shootCd <= 0) {
							const late = this.player.level >= 40;
							e.shootCd = e.boss ? (late ? 2.6 : 4) : (late ? 1.6 : 2.6);
							this.fireErrorBullets(e);
						}
					}
					// 区域轰炸 Boss：瞄准玩家附近区域，落点有预警圈；40级后一次3个区域
					if (e.areaBomber) {
						e.bombCd -= dt;
						if (e.bombCd <= 0) {
							const late = this.player.level >= 40;
							e.bombCd = late ? rand(1.6, 2.4) : rand(2.6, 4.0);
							const count = late ? 3 : 1;
							for (let i = 0; i < count; i++) {
								const ang = count === 1 ? rand(0, Math.PI * 2) : (i * Math.PI * 2 / count + rand(-0.2, 0.2));
								const dist = count === 1 ? rand(0, 80) : rand(55, 105);
								const tx = Math.max(20, Math.min(this.world.w - 20, this.player.x + Math.cos(ang) * dist));
								const ty = Math.max(20, Math.min(this.world.h - 20, this.player.y + Math.sin(ang) * dist));
								this.areaBombs.push({ x: tx, y: ty, r: 68, delay: 0.9, life: 0.9, done: false, dmg: (10 + Math.min(18, this.elapsed / 25)) * this.diffMul() });
							}
						}
					}
				}
				// 屏外太远的回收
				this.enemies = this.enemies.filter((e) => (this.level
					? (e.x > -200 && e.x < this.world.w + 200 && e.y > -200 && e.y < this.world.h + 200)
					: (e.x > this.cam.x - 160 && e.x < this.cam.x + GAME_W + 160 && e.y > this.cam.y - 160 && e.y < this.cam.y + GAME_H + 160)));
			}

			// ── 浮游 deepseek：悬在人物后上方，Token弹 / 编译激光都由它发出 ──
			famPos() {
				return this.familiar ?? { x: this.player.x, y: this.player.y - 44 };
			}
			updateFamiliar(dt) {
				const p = this.player;
				if (!p) return;
				if (!this.familiar) this.familiar = { x: p.x, y: p.y - 44, bob: rand(0, Math.PI * 2) };
				const f = this.familiar;
				f.bob += dt * 2.4;
				// 目标点：背后（面朝反方向）+ 上方，带一点上下浮动
				const side = p.facing >= 0 ? -1 : 1;
				const tx = p.x + side * 26;
				const ty = p.y - 46 + Math.sin(f.bob) * 5;
				const k = 1 - Math.pow(0.002, dt); // 平滑跟随，转身时会甩出一点弧线
				f.x += (tx - f.x) * k;
				f.y += (ty - f.y) * k;
			}
			drawFamiliar(c, t) {
				if (!this.familiar) return;
				const f = this.familiar;
				const img = assetImg('/vs-game/assets/items/deepseek.png');
				if (!img.complete || !img.naturalWidth) return;
				const h = 22;
				const w = h * (img.naturalWidth / img.naturalHeight);
				const flip = this.player.facing >= 0; // 素材天生朝左：人物朝右时镜像
				c.save();
				// 淡淡的光晕，让弹幕有个出处
				c.globalAlpha = 0.2 + Math.sin(t * 3) * 0.05;
				c.fillStyle = '#4fc3f7';
				c.beginPath();
				c.arc(f.x, f.y, 15, 0, Math.PI * 2);
				c.fill();
				c.globalAlpha = 1;
				c.translate(f.x, f.y);
				if (flip) c.scale(-1, 1);
				c.drawImage(img, -w / 2, -h / 2, w, h);
				c.restore();
			}
			/** 自动武器系统在当前场景是否启用（第三房间钓鱼时关掉，免得自动炮把鱼清场） */
			/** 自动武器总开关：家里（含钓鱼房）一律禁用——打鱼/打假人都靠剑技和主动技能 */
			autoWeaponsEnabled() {
				if (this.phase === 'home') {
					if (this.homeRoom === 2) return FISH_ROOM.autoWeapons !== false;   // 钓鱼房：场景开关（默认关）
					return false;                                                        // 家里其它房间：同样关掉（之前漏了这条）
				}
				return true;
			}
			/** 肃清期间：人物相位移除——敌人选不到他，他的自动武器/弹道也一并「不在这个空间」 */
			playerPhasedOut() { return !!this.purge; }

			/** 游荡方向：有的怪（Boss）建对象时没给 wanderA，缺了/坏了就重掷一个随机的 */
			wanderAng(e) {
				if (!Number.isFinite(e.wanderA)) e.wanderA = rand(0, Math.PI * 2);
				return e.wanderA;
			}

			/** 每帧推进自动武器：开火 + 常驻环绕球（场景不允许时顺手收干净产物） */
			updateWeapons(dt) {
				if (!this.autoWeaponsEnabled() || this.playerPhasedOut()) {
					if (this.rings.length || this.mines.length || this.projectiles.length || this.pendingShots.length) {
						// 这些数组只由自动武器产生：本场景禁用就清掉（免得上一场景带进来的雷/环继续打鱼）
						this.rings = []; this.mines = []; this.projectiles = []; this.pendingShots = [];
					}
					this.updateLaserWeapon(dt);
					return;
				}

				for (const w of this.player.weapons) {
					this.weaponCd[w.type] = (this.weaponCd[w.type] ?? 0) - dt;
					if (this.weaponCd[w.type] > 0) continue;
					switch (w.type) {
						case 'whip': this.fireWhip(w.level); this.weaponCd.whip = 1.1 * this.cdMul(); break;
						case 'bolt': this.weaponCd.bolt = (this.fireBolt(w.level) ? 0.85 : 0.15) * this.cdMul(); break;
						case 'laser': break; // 编译激光改为常驻持续光束，由 updateLaserWeapon 维护
						case 'mine': this.fireMine(w.level); this.weaponCd.mine = 2.6 * this.cdMul(); break;
						case 'zap': this.fireZap(w.level); this.weaponCd.zap = 1.9 * this.cdMul() * (this.isEvolved('zap') ? 0.5 : 1); break;
						case 'orb': this.weaponCd.orb = 0.1; break; // orb 常驻，cd 只防重复
						default: break;
					}
				}
				this.updateLaserWeapon(dt);
				this.updateOrbContact(dt);   // 语法环绕：常驻自动武器
			}

			/** 语法环绕（orb）：绕玩家转圈，接触敌人掉血、拦截报错弹幕 */
			updateOrbContact(dt) {
				// 位置由 orbAngle 驱动（强化：更多球、更大范围、更快转速）
				// 进化·上下文窗口：6 球大半径、伤害翻倍、吸附附近宝石
				const orbLv = this.weaponLevel('orb');
				if (orbLv > 0) {
					const orbEvo = this.isEvolved('orb');
					this.orbAngle += (orbLv >= 3 ? 3.5 : 2.8) * dt;
					const orbR = orbEvo ? 130 : orbLv >= 3 ? 110 : 90;
					const count = orbEvo ? 6 : orbLv >= 3 ? 5 : orbLv >= 2 ? 4 : 3;
					const dmg = this.weaponDamage('orb', orbEvo ? 3 : orbLv >= 4 ? 1.5 : orbLv >= 3 ? 1.25 : 1);
					if (orbEvo) {
						for (const g of this.gems) {
							if (Math.hypot(g.x - this.player.x, g.y - this.player.y) < 200) g.magnetized = true;
						}
					}
					const hitR = orbEvo ? 20 : 16; // 与可见球体大小匹配的接触判定半径
					const blockR = orbEvo ? 22 : 18; // 能量球拦截报错弹幕的判定半径
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
						// 语法环绕可挡子弹：碰到的报错弹幕直接销毁
						for (const b of this.enemyBullets) {
							if (b.life > 0 && Math.hypot(b.x - ox, b.y - oy) <= blockR) {
								b.life = 0;
								this.burst(b.x, b.y, '#40c4ff', 6);
							}
						}
					}
				}
			}

			updateLaserWeapon() {
				const w = this.player.weapons.find((x) => x.type === 'laser');
				if (w && this.autoWeaponsEnabled()) { this.syncLaser(w.level, !!w.evolved); return; }
				// 没武器 / 场景禁用：清掉常驻光束并置空配置（回关卡后 syncLaser 会按等级重建）
				if (this.laserCfg || this.beams.some((b) => b.kind === 'laser')) {
					this.beams = this.beams.filter((b) => b.kind !== 'laser');
					this.laserCfg = null;
				}
			}

			syncLaser(lv, evolved) {
				const n = evolved ? 12 : lv >= 2 ? 8 : 4;
				const len = evolved ? 380 : 320;
				const width = evolved ? 16 : lv >= 4 ? 16 : 14;
				const baseDmg = this.weaponDamage('laser', evolved ? 2.25 : lv >= 4 ? 1.75 : lv >= 3 ? 1.5 : 1);
				const spin = evolved ? 0.8 : 0.12; // 常驻微旋转，进化后明显旋转
				if (this.laserCfg && this.laserCfg.lv === lv && this.laserCfg.evolved === evolved) {
					return;
				}
				this.laserCfg = { lv, evolved };
				// 移除旧激光，按当前等级重建常驻光束
				this.beams = this.beams.filter((b) => b.kind !== 'laser');
				for (let i = 0; i < n; i++) {
					const a = (i * Math.PI * 2) / n + (lv >= 2 ? Math.PI / 8 : 0) + (evolved ? this.elapsed * spin : 0);
					const f0 = this.famPos();
					this.beams.push({
						kind: 'laser',
						x: f0.x, y: f0.y,
						angle: a, len, width, baseDmg, spin,
						life: Infinity,
						hitCd: new Map(), // 每 0.25s 可再次命中同一敌人，实现持续灼烧
						flash: 0,         // >0 表示这束刚命中敌人（绘制时提亮）
					});
				}
			}

			fireWhip(lv) {
				// 环形鞭波：Lv1 一圈，Lv2 两圈，Lv3+ 三圈（错峰扩散）
				// 进化·鲸尾横扫：四道 160 半径巨环 + 击退
				const evo = this.isEvolved('whip');
				const count = evo ? 4 : lv >= 3 ? 3 : lv;
				const radius = evo ? 160 : lv >= 3 ? 110 : 80;
				const dmg = this.weaponDamage('whip', evo ? 3 : lv >= 4 ? 2 : lv >= 3 ? 1.5 : 1);
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
							if (rg.kb && !e.immuneKnockback && d > 0) {
								e.x += ((e.x - rg.x) / d) * 30;
								e.y += ((e.y - rg.y) / d) * 30;
							}
						}
					}
				}
				this.rings = this.rings.filter((rg) => rg.delay > 0 || rg.r < rg.maxR);
			}

			findBoltTarget(x, y, _preferHp = false, range = 620) {
				// 只考虑射程内最近的敌人（不再优先精英/Boss、不按血量选目标）
				const inRange = this.enemies.filter((e) => Math.hypot(e.x - x, e.y - y) < range);
				if (inRange.length === 0) return null;
				let best = null, bestDist = Infinity;
				for (const e of inRange) {
					const d = Math.hypot(e.x - x, e.y - y);
					if (d < bestDist) { bestDist = d; best = e; }
				}
				return best;
			}

			fireBolt(lv) {
				// 改为自动瞄准目标：附近有敌人才发射
				// 进化·流式输出：机关枪连射 + 强跟踪
				const evo = this.isEvolved('bolt');
				const p = this.player;
				const target = this.findBoltTarget(p.x, p.y, lv >= 4, 420);
				if (!target) return false;
				if (evo) {
					// 机关枪模式：连射排进 tick 时间队列（不用 setTimeout：暂停即冻结、卸载即消亡）
					for (let i = 0; i < 12; i++) this.pendingShots.push({ delay: i * 0.15 });
					return true;
				}
				const f = this.famPos();
				playSE('token-shot', 0.5, 0.04);
				const shots = lv >= 3 ? 7 : lv >= 2 ? 5 : 3;
				this.burst(f.x, f.y, '#7ee7ff', 5);
				const pierce = lv >= 3 ? 1 : 0;
				const speed = 550;
				const dmg = this.weaponDamage('bolt', lv >= 4 ? 1.6 : lv >= 3 ? 1.2 : 1);
				const spread = Math.PI / 4; // 45 度扇形
				const baseAngle = Math.atan2(target.y - f.y, target.x - f.x);
				// 每级跟踪明显增强：Lv1 小漂移，Lv2 可感知，Lv3 明显，Lv4 强力
				const track = lv >= 4 ? 2.2 : lv >= 3 ? 1.5 : lv >= 2 ? 0.9 : 0.4;
				for (let i = 0; i < shots; i++) {
					const t = (i / (shots - 1)) - 0.5; // -0.5 ~ 0.5
					const angle = baseAngle + t * spread;
					this.projectiles.push({
						x: f.x, y: f.y,
						vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
						damage: dmg, pierce, life: 1.2, hitSet: new Set(), kind: 'bolt', track,
					});
				}
				return true;
			}



			fireLaser(lv) {
				// 持续穿透光束（强化：CD 减半，持续时间加倍）
				// 进化·全量类型检查：12 道旋转激光网
				const evo = this.isEvolved('laser');
				const n = evo ? 12 : lv >= 2 ? 8 : 4;
				const dmg = this.weaponDamage('laser', evo ? 2.25 : lv >= 3 ? 1.5 : 1);
				const dur = evo ? 0.8 : lv >= 4 ? 0.6 : 0.5;
				const spin = evo ? this.elapsed * 0.8 : 0;
				for (let i = 0; i < n; i++) {
					const a = (i * Math.PI * 2) / n + (lv >= 2 ? Math.PI / 8 : 0) + spin;
					this.beams.push({ x: this.player.x, y: this.player.y, angle: a, len: evo ? 380 : 320, width: evo ? 16 : 14, damage: dmg, life: dur, maxLife: dur, hitSet: new Set() });
				}
			}

			fireMine(lv) {
				playSE('mine-place', 0.7, 0.05);
				// 阔剑地雷：先无方向布雷，触发瞬间才朝向最近的敌人定向扇形爆破
				// 进化·垃圾回收：存 6 雷、伤害翻倍、大扇形全减速
				const evo = this.isEvolved('mine');
				const cap = evo ? 6 : lv >= 2 ? 4 : 3;
				if (this.mines.length >= cap) this.mines.shift();
				const p = this.player;
				this.mines.push({
					x: p.x, y: p.y,
					range: evo ? 220 : lv >= 3 ? 190 : 160,
					arc: evo ? Math.PI * 2 / 3 : lv >= 3 ? Math.PI / 2 : Math.PI / 3,
					blastRadius: evo ? 110 : lv >= 3 ? 90 : 70,
					trigger: evo ? 80 : lv >= 3 ? 70 : 60,
					damage: this.weaponDamage('mine', evo ? 2.5 : lv >= 3 ? 1.5 : 1),
					slow: evo || lv >= 4, arm: 0.4,
				});
			}

			fireZap(lv) {
				// 多目标连锁闪电（强化：Lv1=2 目标，Lv2=3 目标 + 眩晕，Lv3+=4 目标 + 连锁）
				// 进化·热重载：4 道连锁闪电，冷却减半
				const evo = this.isEvolved('zap');
				const strikes = evo ? 4 : lv >= 3 ? 4 : lv >= 2 ? 3 : 2;
				const dmg = this.weaponDamage('zap', evo ? 2 : lv >= 4 ? 1.4 : 1);
				const radius = evo ? 90 : lv >= 4 ? 75 : 60;
				const cands = this.enemies.filter((e) => Math.hypot(e.x - this.player.x, e.y - this.player.y) < 350);
				if (cands.length === 0) return;
				let hitAny = false;
				for (let i = 0; i < strikes; i++) {
					const t = pick(cands);
					this.burst(t.x, t.y, '#ffe066', 8);
					this.particles.push({ kind: 'zap', x: t.x, y: t.y, life: 0.22, maxLife: 0.22 });
					for (const e of this.grid.query(t.x, t.y, radius)) {
						if (Math.hypot(e.x - t.x, e.y - t.y) <= radius) {
							this.hurtEnemy(e, dmg);
							hitAny = true;
							if (lv >= 2 && !e.immuneSlow) e.slow = 1.0; // 眩晕 1 秒
						}
					}
					if (evo || lv >= 3) {
						for (const e2 of this.grid.query(t.x, t.y, 130)) {
							if (e2 !== t && Math.hypot(e2.x - t.x, e2.y - t.y) <= 130 && Math.random() < 0.6) {
								this.hurtEnemy(e2, dmg * 0.7);
								hitAny = true;
							}
						}
					}
				}
				if (hitAny) playSE('lightning', 0.75, 0.05);
			}

			updatePendingShots(dt) {
				if (this.pendingShots.length === 0) return;
				for (const ps of this.pendingShots) ps.delay -= dt;
				const due = this.pendingShots.filter((ps) => ps.delay <= 0);
				this.pendingShots = this.pendingShots.filter((ps) => ps.delay > 0);
				for (let i = 0; i < due.length; i++) this.fireBoltShot();
			}

			fireBoltShot() {
				if (this.phase !== 'playing' && this.phase !== 'dying') return;
				const t = this.findBoltTarget(this.player.x, this.player.y, true, 620); // 只在射程内且有敌人时补射
				if (!t) return;
				const f = this.famPos();
				playSE('token-shot', 0.5, 0.04);
				const baseAngle = Math.atan2(t.y - f.y, t.x - f.x);
				const angle = baseAngle + rand(-0.05, 0.05);
				this.projectiles.push({
					x: f.x, y: f.y,
					vx: Math.cos(angle) * 700, vy: Math.sin(angle) * 700,
					damage: this.weaponDamage('bolt', 1.4), pierce: 1, life: 1.2, hitSet: new Set(), kind: 'bolt',
					track: 3.2,
				});
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
				for (const fx of this.skillFx) fx.t += dt;
				this.skillFx = this.skillFx.filter((fx) => fx.t < fx.dur);
			}

			updateAreaBombs(dt) {
				const p = this.player;
				for (const b of this.areaBombs) {
					b.delay -= dt;
					b.life -= dt;
					if (!b.done && b.delay <= 0) {
						b.done = true;
						playSE('mine-explode', 0.6, 0.05);
						this.burst(b.x, b.y, '#ff5f56', 18);
						this.shake = Math.max(this.shake, 0.25);
						if (!this.playerInvuln() && Math.hypot(p.x - b.x, p.y - b.y) <= b.r + 12) {
							const dmg = this.incomingDamage(b.dmg);
							p.hp -= dmg;
							playSE('player-hurt', 0.75, 0.12);
							p.invuln = 0.6;
							this.spawnDmgNum(p.x, p.y - 22, '-' + Math.round(dmg), 'taken', dmg);
						}
					}
				}
				this.areaBombs = this.areaBombs.filter((b) => b.delay > 0 || b.life > 0);
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
						// 常驻激光：跟随浮游 deepseek、缓慢旋转、不消失
						const f = this.famPos();
						b.x = f.x;
						b.y = f.y;
						if (b.spin) b.angle += b.spin * dt;
						if (b.flash > 0) b.flash -= dt;   // 命中加亮的余辉（0.12s）
					} else {
						b.life -= dt;
						if (b.kind === 'railgun') {
							// 电磁炮：跟着玩家走，边射边缓慢扫射，最后 0.4s 收束变细
							b.x = this.player.x;
							b.y = this.player.y;
							b.angle += (b.sweep ?? 0.5) * (b.dir ?? 1) * dt;
							const k = Math.max(0, Math.min(1, b.life / 0.4));
							b.width = (ACTIVE_SKILLS.railgun?.width ?? 132) * Math.min(1, k);
							// 沿光束随机迸出电火花，纹理更"烧"
							b.sparkT = (b.sparkT ?? 0) - dt;
							if (b.sparkT <= 0 && b.life > 0) {
								b.sparkT = 0.05;
								const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
								for (let i = 0; i < 2; i++) {
									const d = rand(40, b.len * 0.9);
									const off = rand(-1, 1) * b.width * 0.45;
									this.particles.push({
										kind: 'spark', x: b.x + cos * d - sin * off, y: b.y + sin * d + cos * off,
										vx: rand(-60, 60), vy: rand(-60, 60), size: rand(2, 4),
										color: Math.random() < 0.5 ? '#eafcff' : '#7fd8ff',
										life: rand(0.15, 0.35), maxLife: 0.35,
									});
								}
							}
						}
					}
				}
				this.beams = this.beams.filter((b) => b.kind === 'laser' || b.life > 0);
			}

			updateMines(dt) {
				for (const m of this.mines) {
					if (m.arm > 0) { m.arm -= dt; continue; }
					// 已进入引爆倒计时：显示 0.2s 扇形爆炸范围，时间到再爆炸
					if (m.fuse != null) {
						m.fuse -= dt;
						if (m.fuse <= 0) {
							m.dead = true;
							playSE('mine-explode', 0.8, 0.05);
							this.burst(m.x, m.y, '#ffb74d', 14);
							this.shake = Math.max(this.shake, 0.18);
							const halfArc = m.arc / 2;
							for (const e of this.grid.query(m.x, m.y, m.range)) {
								const dx = e.x - m.x, dy = e.y - m.y;
								const dist = Math.hypot(dx, dy);
								if (dist > m.range) continue;
								let diff = Math.atan2(dy, dx) - m.angle;
								while (diff > Math.PI) diff -= Math.PI * 2;
								while (diff < -Math.PI) diff += Math.PI * 2;
								if (Math.abs(diff) <= halfArc) {
									this.hurtEnemy(e, m.damage);
									if (m.slow && !e.immuneSlow) e.slow = 2;
								}
							}
						}
						continue;
					}
					// 敌人进感应圈：范围瞬爆 + 确定阔剑方向，随后进入 0.2s 引爆倒计时
					const near = this.grid.query(m.x, m.y, m.trigger + 20).filter((e) => Math.hypot(e.x - m.x, e.y - m.y) < m.trigger);
					if (near.length > 0) {
						let trigger = null, bestDist = Infinity;
						for (const e of near) {
							const d = Math.hypot(e.x - m.x, e.y - m.y);
							if (d < bestDist) { bestDist = d; trigger = e; }
						}
						m.fuse = 0.2;
						m.angle = Math.atan2(trigger.y - m.y, trigger.x - m.x);
						// 第一段：接触瞬间的小范围爆炸
						this.burst(m.x, m.y, '#ffb74d', 10);
						this.shake = Math.max(this.shake, 0.12);
						for (const e of this.grid.query(m.x, m.y, m.blastRadius)) {
							if (Math.hypot(e.x - m.x, e.y - m.y) <= m.blastRadius) {
								this.hurtEnemy(e, m.damage * 0.5);
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
							b.hitCd.set(e.id, this.elapsed + (b.tick ?? 0.25));
							this.hurtEnemy(e, b.damage ?? b.baseDmg ?? this.weaponDamage('laser', 1));
							if (b.kind === 'laser') b.flash = 0.12;   // 只有被这一束挂到才亮，打击反馈跟光束走
						}
					}
				}
				// 护盾/主动技能无敌期间不吃任何伤害
				if (this.shieldTimer > 0 || this.skillTimer > 0) return;
				// 工作中（10s 内有真实工作燃料）→ 临时 +300 防御，由 incomingDamage 统一减伤
				// 敌人接触伤害（鱼跃腾空时打不到）
				if (!this.playerInvuln()) {
							for (const e of this.grid.query(p.x, p.y, 40)) {
								if (e.dummy) continue;   // 训练假人不还手，撞上去也不掉血
							if (Math.hypot(e.x - p.x, e.y - p.y) < e.size * 0.55 + 13) {
							const raw = (e.contactDmg ?? (8 + Math.min(20, this.elapsed / 30) + (e.elite ? 4 : 0))) * this.diffMul() * (this.level?.balance?.dmgMul ?? 1);
							const dmg = this.incomingDamage(raw);
							p.hp -= dmg;
							playSE('player-hurt', 0.75, 0.12);
							p.invuln = 0.7;
							this.shake = Math.max(this.shake, 0.3);
							this.spawnDmgNum(p.x, p.y - 22, '-' + Math.round(dmg), 'taken', dmg);
							break;
						}
					}
				}
				// 报错弹幕命中（鱼跃腾空时打不到）
				if (!this.playerInvuln()) {
					for (const b of this.enemyBullets) {
						// 按整行文本矩形判定（而不是中心一个点）
						const hw = (b.w ?? b.text.length * 7) / 2 + 10;
						const hh = (b.h ?? 14) / 2 + 10;
						if (Math.abs(b.x - p.x) <= hw && Math.abs(b.y - p.y) <= hh) {
							b.life = 0;
							const rawHit = (b.dmg > 0 ? b.dmg : (6 + Math.min(12, this.elapsed / 40)));   // 特殊弹幕（如河豚刺）自带伤害
							const dmg = this.incomingDamage(rawHit * this.diffMul() * (this.level?.balance?.dmgMul ?? 1));
							p.hp -= dmg;
							playSE('player-hurt', 0.75, 0.12);
							p.invuln = 0.5;
							this.shake = Math.max(this.shake, 0.2);
							this.spawnDmgNum(p.x, p.y - 22, b.spike ? ('-' + Math.round(dmg)) : b.text, b.spike ? 'taken' : 'crit', b.spike ? dmg : 0);
							break;
						}
					}
				}
			}

			hurtEnemy(e, dmg) {
				const roll = this.rollDamage(dmg);
				if (e.dummy) { this.dummyHit(e, roll.dmg); }   // 训练假人：只记连击/总伤，不扣血不死亡
				// config 括号护盾：张开期间正面全格挡，并把伤害以报错弹幕弹回玩家（等盾消或提前打满次数）
				if (e.shieldT > 0 && !e.dummy) {
					if ((e.reflectCd ?? 0) <= 0) {
						e.reflectCd = 0.25;
						const text = pick(ERROR_TEXTS);
						const dxb = this.player.x - e.x, dyb = this.player.y - e.y, ddb = Math.hypot(dxb, dyb) || 1;
						this.enemyBullets.push({
							x: e.x, y: e.y, vx: (dxb / ddb) * 265, vy: (dyb / ddb) * 265, text,
							life: 2.2, w: Math.max(24, text.length * 7), h: 14, dmg: 6 + Math.min(8, this.elapsed / 90),
						});
						this.spawnDmgNum(e.x, e.y - e.size, '格挡', 'taken', 0);
						playSE('token-shot', 0.4, 0.05);
					}
					return;
				}
				// config 括号护盾：挨满 3 刀（精英 2 刀）张开 {} 盾 1.6 秒
				if (e.type === 'config' && !e.dummy && (e.shieldT ?? 0) <= 0) {
					e.hitsTaken = (e.hitsTaken ?? 0) + 1;
					if (e.hitsTaken >= (e.elite ? 2 : 3)) {
						e.shieldT = 1.6; e.hitsTaken = 0; e.reflectCd = 0;
						this.burst(e.x, e.y, '#ffb74d', 6);
						playSE('token-shot', 0.5, 0.05);
					}
				}
				// go goroutine：受击概率裂出 1 血分身包抄（每只上限 2 个，防刷）
				if (e.type === 'go' && !e.dummy && !e.boss && !e.tag && e.hp - roll.dmg > 0 && (e.splitLeft ?? 2) > 0 && Math.random() < 0.3) {
					e.splitLeft = (e.splitLeft ?? 2) - 1;
					this.spawnEnemyAt('go', e.x + rand(-24, 24), e.y + rand(-24, 24), false, { fixedHp: 1, noDrop: true, aggro: true, tag: 'go-clone' });
					this.burst(e.x, e.y, '#00add8', 5);
				}
				e.hp -= e.dummy ? 0 : roll.dmg;
				e.hitFlash = 0.12;
				playSE(roll.crit ? 'crit' : 'hit', roll.crit ? 0.8 : 0.5, roll.crit ? 0.06 : 0.09);
				this.spawnDmgNum(e.x + rand(-6, 6), e.y - e.size, String(Math.round(roll.dmg)), roll.crit ? 'crit' : 'normal', roll.dmg);   // 暴击靠字号/颜色/发光区分，不写"暴击"二字
				if (e.hp <= 0) this.killEnemy(e);
			}

			killEnemy(e) {
				playSE('enemy-death', 0.5, 0.04);
				this.enemies = this.enemies.filter((x) => x !== e);
				this.kills++;
				this.burst(e.x, e.y, e.color, e.elite ? 12 : 6);
				this.dropGemsAt(e.x, e.y, e.xp);
				if (this.sortCfg && !e.noDrop && !e.boss && !e.levelBoss) this.dropSortFile(e.x, e.y, e.type);
				if (e.levelBoss) this.onLevelBossKilled(e);
				if (e.puffer) this.dropPufferLoot(e);   // 河豚 BOSS：掉肃清碎片
				else if (e.fish) this.dropFishItem(e);   // 第三房间：鱼怪掉鱼（带 1 条随机属性）
			}

			/** P3：玩家踏入 Boss 圈 → 传送进 Boss 房间，先播放 Galgame 对话再开战 */
			checkBossZone() {
				const lv = this.level;
				if (!lv || !lv.bossZone || !lv.boss || this.bossSpawned) return;
				// 第 3 关：整理没满 10 次前，中央 workspace/ 打不开
				if (lv.sort && (this.sortCorrect ?? 0) < (lv.sort.need ?? 10)) return;
				// 关卡里的普通宝箱没开完前，不触发 Boss 房
				if ((this.chests ?? []).some((c) => !c.bossChest && !c.opened)) return;
				const bz = lv.bossZone;
				const zx = bz.xf * this.world.w, zy = bz.yf * this.world.h;
				const zr = bz.r ?? 190;
				// 进入 Boss 圈触发；同时放宽：接近右侧关底区域也触发，避免“走到虚线但判定没进圈”
				const inCircle = Math.hypot(this.player.x - zx, this.player.y - zy) <= zr;
				// 第 3 关的门在场地中央，只认圆形判定（否则站在右半边会被误触发）
				const nearGate = this.player.x > zx - (zr * 0.7);
				const reached = lv.sort ? inCircle : (inCircle || nearGate);
				if (!reached) return;
				this.bossSpawned = true;
				this.enterBossRoom();
			}

			skipToBoss() {
				if (this.phase !== 'playing' || !this.level || this.bossSpawned) return;
				this.bossSpawned = true;
				this.enterBossRoom();
			}

			enterBossRoom() {
				const lv = this.level;
				const room = lv?.bossRoom ?? { w: GAME_W, h: GAME_H, spawn: { xf: 0.5, yf: 0.78 }, boss: { xf: 0.5, yf: 0.22 }, chest: { xf: 0.5, yf: 0.5 } };
				// 清场：普通关的敌人和弹幕不带进 Boss 房
				for (const en of this.enemies) this.burst(en.x, en.y, en.color, 4);
				this.enemies = [];
				this.enemyBullets = [];
				this.skillFx = [];   // 小怪招牌招式闪光（TS 检测激光线等）
				this.slimeZones = [];   // PY 缩进粘液：玩家减速区
				this.htmlBlocks = [];   // HTML <div> 搭墙：临时路障
				this.projectiles = [];
				this.beams = [];
				this.familiar = null; // 浮游 deepseek：换场重置，避免从旧位置滑翔过来
				this.laserCfg = null; // 允许编译激光进入 Boss 房后重建
				this.mines = [];
				this.bossRoomMode = true;
				// 只切当前 world，不改 defaultWorld，方便通关后 reset 回原地图尺寸
				this.world = { w: room.w, h: room.h };
				this.player.x = room.spawn.xf * room.w;
				this.player.y = room.spawn.yf * room.h;
				this.updateCamera();
				this.bossChest = null;
				const lines = lv?.story?.bossIntro ?? [];
				if (lines.length > 0) {
					this.openDialog(lines, 'boss');
					this.setBanner('⚔ 进入 Boss 房间！');
				} else {
					this.bossIntro = null;
					this.phase = 'playing';
					this.spawnLevelBoss();
				}
			}

			/** 统一开一段对话（打字机从 0 开始）；kind 决定播完后走哪条分支 */
			openDialog(lines, kind) {
				this.bossIntro = { lines, index: 0, kind, revealed: 0 };
				this.phase = 'bossintro';
			}
			/** 当前这句有多少字（打字机的目标长度；空行按 0 处理） */
			dialogLineLen(bi = this.bossIntro) {
				if (!bi) return 0;
				const line = bi.lines?.[bi.index] || {};
				return String(line.text ?? '').length;
			}
			/** 打字机推进：bossintro 期间每帧喂 dt（世界定格，只有文字在动） */
			updateBossIntroText(dt) {
				const bi = this.bossIntro;
				if (!bi) return;
				const len = this.dialogLineLen(bi);
				const cur = bi.revealed ?? len;      // 老快照没有 revealed → 视为已显示完，不影响推进
				if (cur >= len) { bi.revealed = len; return; }
				bi.revealed = Math.min(len, cur + DIALOG_CPS * dt);
			}
			/** Galgame 对话逐句推进：第一次按＝本句瞬间打完，打完了再按＝下一句 */
			advanceBossIntro() {
				const bi = this.bossIntro;
				if (!bi || this.phase !== 'bossintro') return;
				// 还在打字：这一下只把本句打完（不换句），所以按住/连点也只会「快进这一句」
				const lineLen = this.dialogLineLen(bi);
				if ((bi.revealed ?? 0) < lineLen) { bi.revealed = lineLen; return; }
				bi.index++;
				bi.revealed = 0;
				if (bi.index >= bi.lines.length) {
					const kind = bi.kind || 'boss';
					this.bossIntro = null;
					this.phase = 'playing';
					if (kind === 'boss') this.spawnLevelBoss();
					else if (String(kind).startsWith('story-')) this.afterStoryDialog(String(kind).slice(6));
					else if (kind === 'home-wolf') { this.phase = 'home'; this.wolfChatUnlocked = true; }   // 初次见面聊完：解锁小狼问答
					else if (kind === 'wolf-chat') this.phase = 'home';   // 日常问答：聊完回家里正常玩
					this.dispatchAgents();   // 第 4 关：剧情过完自动派出子代理（无 agentCfg / 已派过都是空操作）
					this.focusCanvas();
				}
			}

			/** 在 Boss 房间生成关底 Boss */
			spawnLevelBoss() {
				playSE('boss-roar', 0.8, 0.1);
				const lv = this.level;
				if (!lv?.boss) return;
				const b = lv.boss;
				const room = lv.bossRoom ?? { boss: { xf: 0.5, yf: 0.25 } };
				const bx = (room.boss?.xf ?? 0.5) * this.world.w;
				const by = (room.boss?.yf ?? 0.25) * this.world.h;
				const hp = b.hp * this.diffMul();
				const boss = {
					id: nextId++, type: 'boss', levelBoss: true,
					x: bx, y: by, hp, maxHp: hp,
					speed: b.speed ?? 36, size: b.size ?? 34, color: b.color ?? '#c62828', label: b.label ?? 'BOSS',
					xp: b.xp ?? 30, elite: true, boss: true, urchin: !!b.urchin, hitFlash: 0, slow: 0, aggro: true,
					home: { x: bx, y: by, r: Math.max(60, (this.world.w + this.world.h) / 4) },
					wanderA: rand(0, Math.PI * 2), wanderT: rand(0.8, 2.2),   // 相位游荡要用（缺了会 NaN，被当成出图回收）
					immuneKnockback: true,
				};
				this.enemies.push(boss);
				this.discovered.add('boss:' + (this.level?.id ?? 'level'));   // Boss 图鉴：遇到即解锁
				this.bossRef = boss.id;
				this.shake = Math.max(this.shake, 0.5);
				this.setBanner('⚠ ' + (b.name ?? 'BOSS') + (b.title ? ' · ' + b.title : '') + ' 出现！');
			}

			/** P3：击杀关底 Boss → 清小怪 + 生成 Boss 宝箱，捡完才算通关 */
			onLevelBossKilled(e) {
				this.bossKilled = true;
				this.bossRef = null;
				for (const en of this.enemies) this.burst(en.x, en.y, en.color, 4);
				this.kills += this.enemies.length;
				this.enemies = [];
				this.dropGems(6, 8);
				this.shake = 0.6;
				const room = this.level?.bossRoom ?? { chest: { xf: 0.5, yf: 0.5 } };
				const cx = (room.chest?.xf ?? 0.5) * this.world.w;
				const cy = (room.chest?.yf ?? 0.5) * this.world.h;
				const chest = { id: this.chests.length, x: cx, y: cy, tier: 'gold', opened: false, bossChest: true };
				this.chests.push(chest);
				this.bossChest = chest;
				this.setBanner('👑 Boss 击破！捡起宝箱完成通关');
				const post = this.level?.story?.post;
				if (Array.isArray(post) && post.length > 0) this.openDialog(post, 'post');
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
				while (p.xp >= p.xpNeed) {
					p.xp -= p.xpNeed;
					p.level++;
					p.xpNeed = this.level ? xpNext(p.level) : endlessXpNeed(p.level);
					p.celebrate = 1.1;
					playSE('levelup', 0.8);
					if (this.level) {
						// 关卡模式：不弹三选一，自动升初始武器，满级直接进化超武
						this.autoUpgradeWeapon();
						continue;
					}
					// 没有可升级项时直接跳过，不再弹回血/清场选项
					const choices = this.buildChoices();
					if (choices.length === 0) continue;
					if (this.cfg.autoSelect) {
						this.choices = choices;
						this.phase = 'levelup';
						this.applyChoice(0, true); // 默认选第一项，没升级项时会优先回血而不是清图
						continue;
					}
					// 有暂存升级时不打断战斗，继续攒次数，等级照常升
					if (this.pendingChoices.length > 0) {
						this.pendingChoices.push(choices);
					} else {
						this.choices = choices;
						this.phase = 'levelup';
						break;
					}
				}
			}

			/** 关卡模式自动升级：只强化初始武器，达到满级直接进化超武 */
			autoUpgradeWeapon() {
				const w = this.player.weapons.find((x) => x.type === this.initialWeapon) ?? this.player.weapons[0];
				if (!w) return;
				if (w.evolved) return; // 超武即满级，后续升级不再提升
				if (w.level < WEAPON_MAX) {
					w.level++;
					if (w.level >= WEAPON_MAX) {
						w.evolved = true;
						this.setBanner('🌟 超武进化：' + EVOLUTIONS[w.type].name + '！');
					} else {
						this.setBanner('⬆ ' + WEAPONS[w.type].name + ' Lv' + w.level);
					}
				} else if (!w.evolved) {
					// 满级但还没进化（如被动未满足）→ 关卡模式直接进化
					w.evolved = true;
					playSE('skill-evolve', 0.95);
					this.setBanner('🌟 超武进化：' + EVOLUTIONS[w.type].name + '！');
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
				if (cands.length === 0) return [];
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

			applyChoice(i, auto = false) {
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
						playSE('skill-evolve', 0.95);
						this.setBanner('🌟 超武进化：' + EVOLUTIONS[c.type].name + '！');
					}
				} else if (c.kind === 'passive-up') p.passives[c.type]++;
				this.choices = null;
				if (!auto && this.pendingChoices.length > 0) {
					// 还有攒着的升级，继续连续处理
					this.choices = this.pendingChoices.shift();
				} else {
					this.phase = 'playing';
				}
				if (!auto) this.focusCanvas();
			}

			/** 主动放弃本局：跳过死亡动画，直接进入结算页 */
			abandonRun() {
				if (this.storyMode) return;   // 剧情没走完（没进乱流）不能放弃回家
				if (this.phase !== 'paused' && this.phase !== 'playing') return;
				this.choices = null;
				this.pendingChoices = [];
				this.gameOver();
			}

			/** P3：通关后补发结算记录（复用 game-over 入账，幂等） */
			reportClearSettlement(storyDone = false) {
				if (this._settleSent) return;
				this._settleSent = true;
				this.sendWs({
					kind: ClientMsg.GAME_OVER,
					storyDone: !!storyDone,
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
				if (this.railFlash > 0) this.railFlash = Math.max(0, this.railFlash - dt);
				// 鱼跃储能：未满时每 1.5s 回一段（最多 2 段）
				if ((this.leapCharges ?? 2) < 2) {
					this.leapChargeT = (this.leapChargeT ?? 0) + dt / 1.5;
					if (this.leapChargeT >= 1) {
						this.leapCharges = (this.leapCharges ?? 0) + 1;
						this.leapChargeT = this.leapCharges >= 2 ? 0 : this.leapChargeT - 1;
					}
				}
				if (this.leapT > 0) this.leapT = Math.max(0, this.leapT - dt);    // 鱼跃腾空无敌
				if (this.leapFx && this.leapFx.length) {   // 鱼跃水波
					for (const f of this.leapFx) f.t += dt;
					this.leapFx = this.leapFx.filter((f) => f.t < f.dur + (f.delay ?? 0));
				}
				if (this.leapGhosts && this.leapGhosts.length) {   // 鱼跃残影
					for (const g of this.leapGhosts) g.t += dt;
					this.leapGhosts = this.leapGhosts.filter((g) => g.t < g.dur);
				}
				if (this.leapAir && !(this.dash && this.dash.leap)) {   // 落地那一刻：按脚下实际位置放水花
					this.leapAir = false;
					this.spawnLeapLanding(this.player.x, this.playerFootY());
				}
				for (const pt of this.particles) {
					pt.life -= dt;
					if (pt.kind === 'spark') { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= 0.9; pt.vy *= 0.9; }
				}
				this.particles = this.particles.filter((pt) => pt.life > 0);
				for (const d of this.dmgNums) {
					d.t += dt;
					const k = Math.min(1, d.t / d.dur);
					d.y -= (d.vy0 ?? 92) * (1 - 0.72 * k) * dt;   // 先快后慢，有缓冲感
					d.x += (d.vx ?? 0) * dt;
					d.vx = (d.vx ?? 0) * 0.92;
				}
				this.dmgNums = this.dmgNums.filter((d) => d.t < d.dur);
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
				// 家里的过场/对话期间 phase 是 bossintro，但背景必须继续画家里，不能切成关卡场景
				if (this.inHomeScene()) {
					this.drawHome(c, t);
					this.drawBeams(c);
					this.drawSkillLasers(c);
					this.drawStrikeLines(c);
					this.drawHomeAgents(c, t);
					this.drawHomeWolf(c, t);   // 家里的小狼（站在主房间右侧，会转头看人）
					if (this.wolfMenu) this.drawWolfMenu(c);   // 小狼问答菜单（最上层）
					this.drawHomeItems(c, t);
					this.drawDummies(c);   // 训练假人（摆动/发光/连击面板）
					this.drawEnemyBullets(c);   // 钓鱼房之前漏了这句：河豚的刺只算伤害、不显示
					this.drawPlayer(c, t);
					this.drawParticles(c);
					this.drawLeapFx(c);   // 鱼跃水波（家里/钓鱼房）
					this.drawDmgNums(c);
					this.drawPurgeWorld(c);   // 肃清斩击线（家里也能放）
					this.drawFishingDeathFx(c);   // 死亡黑屏 / 床上睁眼：压在最上层，场景人物全遮住
					c.restore();
					this.drawBanner(c);          // 家里也画横幅（肃清/技能提示）
					this.drawPurgeScreen(c, t);  // 肃清的虚影 / 蓝罩 / 碎屏
					this.drawLeapGauge(c);       // 鱼跃技力条（底部中间）
					c.restore();
					return;
				}
				const phasedOut = this.playerPhasedOut();   // 肃清：人物在另一个空间，他自己的东西都不画
				this.drawLevelDecor(c);
				this.drawStory(c, t);   // 开局剧情：？？？ / 白饭碗 / 空间乱流
				this.drawSort(c, t);
				if (!phasedOut) this.drawStrikeLines(c);   // 人物名下的东西：相位移除期间一律不画
				this.drawGems(c, t);
				if (!phasedOut) this.drawMines(c, t);
				this.drawAreaBombs(c, t);
				this.drawChests(c, t);
				this.drawAgents(c, t);
				this.drawAreaHazards(c, t);   // 地面层：粘液 / <div> 路障
				this.drawEnemies(c, t);
				if (!phasedOut) this.drawOrbs(c);
				if (!phasedOut) this.drawRings(c);
				if (!phasedOut) this.drawProjectiles(c);
				if (!phasedOut) this.drawBeams(c);
				this.drawEnemyBullets(c);
				if (!phasedOut) this.drawSkillLasers(c);
				if (!phasedOut) this.drawFamiliar(c, t);   // 浮游 deepseek（在人物后上方）
				this.drawPlayer(c, t);
				if (!phasedOut) this.drawSwordSwing(c);
				this.drawSortCarried(c, t);
				this.drawParticles(c);
				this.drawLeapFx(c);   // 鱼跃水波（关卡）
				this.drawDmgNums(c);
				this.drawPurgeWorld(c);   // 肃清斩击线：压在最上层
				c.restore();
				// ── 屏幕层（不受相机影响） ──
				this.drawBanner(c);
				this.drawPurgeScreen(c, t);   // 肃清：虚影立绘 / 蓝罩 / 碎屏
				this.drawLeapGauge(c);           // 鱼跃技力条（底部中间）
				if (this.storyDeath) this.drawStoryDeathFx(c);   // 剧情中死亡：缓缓闭上眼
				if (this.shopOpen && this.phase === 'playing') this.drawShopPanel(c);

				c.restore();
			}

			/** 第 5 关海边地面：沙滩 + 下缘海水浪线 + 商店建筑（SF_Outside_C r14c8-r15c10） */
			drawSeasideGround(c) {
				// 注意：drawBackground 在屏幕空间被调用（网格自己减 cam）。这里先在屏幕上铺沙，
				// 再切到世界坐标画海/树/商店，否则内容会“钉在屏幕上跟着人走”。
				const sd = this.level.seaside;
				const seaY = (sd.seaYf ?? 0.78) * this.world.h;
				const camX = this.cam.x, camY = this.cam.y;
				c.fillStyle = '#e8d8a8';
				c.fillRect(0, 0, GAME_W, GAME_H);
				c.save();
				c.translate(-camX, -camY);
				// 沙点（确定性伪随机；只画视口内的）
				c.fillStyle = 'rgba(160,120,60,0.16)';
				const dgx0 = Math.max(0, Math.floor(camX / 72) * 72);
				const dgy0 = Math.max(0, Math.floor(camY / 56) * 56);
				for (let gy = dgy0; gy < Math.min(seaY, camY + GAME_H + 56); gy += 56) {
					for (let gx = dgx0; gx < Math.min(this.world.w, camX + GAME_W + 72); gx += 72) {
						const jx = ((gx * 7919 + gy * 104729) % 53) - 26;
						const jy = ((gx * 104729 + gy * 7919) % 41) - 20;
						c.fillRect(gx + jx, Math.min(gy + jy, seaY - 10), 3, 2);
					}
				}
				// 海水 + 浪线
				const grd = c.createLinearGradient(0, seaY, 0, this.world.h);
				grd.addColorStop(0, sd.seaColor ?? '#2e7fb8');
				grd.addColorStop(1, sd.seaDeep ?? '#22669b');
				c.fillStyle = grd;
				c.fillRect(0, seaY, this.world.w, this.world.h - seaY);
				const t = this.elapsed ?? 0;
				c.strokeStyle = sd.foam ?? 'rgba(255,255,255,0.75)';
				c.lineWidth = 3;
				for (const [off, amp, sp] of [[0, 5, 1.6], [16, 3, -1.1]]) {
					c.beginPath();
					for (let x = 0; x <= this.world.w; x += 24) {
						const y = seaY + off + Math.sin(x / 90 + t * sp) * amp;
						if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
					}
					c.stroke();
				}
				// 椰子树：Outside_B r13c12（叶）+ r14c12（干）两格竖排，放大 2 倍；图块没加载时退回代码画法
				const palm = tileImg('Outside_B');
				for (const [bx, by] of [[0.1, 0.2], [0.3, 0.72], [0.6, 0.18], [0.88, 0.62], [0.76, 0.3]]) {
					const px2 = bx * this.world.w, py2 = by * seaY;
					if (palm && palm.complete && palm.naturalWidth) {
						c.drawImage(palm, 12 * 48, 13 * 48, 48, 96, px2 - 48, py2 - 192, 96, 192);
						continue;
					}
					c.strokeStyle = '#8a6238'; c.lineWidth = 7; c.lineCap = 'round';
					c.beginPath(); c.moveTo(px2, py2); c.quadraticCurveTo(px2 + 12, py2 - 28, px2 + 4, py2 - 52); c.stroke();
					const tx = px2 + 4, ty = py2 - 52;
					c.strokeStyle = '#4e8f3c'; c.lineWidth = 6;
					for (let k = 0; k < 6; k++) {
						const a = -Math.PI + (k / 5) * Math.PI;
						c.beginPath(); c.moveTo(tx, ty);
						c.quadraticCurveTo(tx + Math.cos(a) * 26, ty + Math.sin(a) * 26 - 7, tx + Math.cos(a) * 42, ty + Math.sin(a) * 42 + 9);
						c.stroke();
					}
				}
				// 关底讨伐区：礁石环绕 + 潮池，和商店明显分开
				const bz0 = this.level.bossZone;
				if (bz0) {
					const bzx = bz0.xf * this.world.w, bzy = bz0.yf * this.world.h, bzr = bz0.r ?? 190;
					c.fillStyle = 'rgba(38,102,155,0.30)';
					c.beginPath(); c.ellipse(bzx, bzy + bzr * 0.55, bzr * 0.9, bzr * 0.45, 0, 0, Math.PI * 2); c.fill();
					c.fillStyle = '#6b6f7a';
					for (let k = 0; k < 9; k++) {
						const a = (k / 9) * Math.PI * 2 + 0.4;
						const rx = bzx + Math.cos(a) * (bzr + 36), ry = bzy + Math.sin(a) * (bzr + 24);
						const rr = 15 + ((k * 7) % 11);
						c.beginPath(); c.ellipse(rx, ry, rr, rr * 0.72, a, 0, Math.PI * 2); c.fill();
					}
				}
				// 商店建筑（6 格放大 2 倍）+ 招牌
				const lv = this.level;
				const sx = lv.shop.xf * this.world.w, sy = lv.shop.yf * this.world.h;
				const tile = tileImg('SF_Outside_C');
				if (tile && tile.complete && tile.naturalWidth) {
					c.drawImage(tile, 8 * 48, 14 * 48, 144, 96, sx - 144, sy - 170, 288, 192);
				} else {
					// 兜底：代码绘制小店（图块没加载也不至于隐身）
					c.fillStyle = '#b98d5a'; c.fillRect(sx - 130, sy - 120, 260, 140);
					c.fillStyle = '#8a5a30'; c.beginPath(); c.moveTo(sx - 150, sy - 118); c.lineTo(sx, sy - 176); c.lineTo(sx + 150, sy - 118); c.closePath(); c.fill();
					c.fillStyle = '#5a3d20'; c.fillRect(sx - 26, sy - 52, 52, 72);
					c.fillStyle = '#ffe9b0'; c.fillRect(sx - 106, sy - 96, 44, 34); c.fillRect(sx + 62, sy - 96, 44, 34);
				}
				// 旗子：远远能看到商店位置
				c.strokeStyle = '#6b4a26'; c.lineWidth = 4;
				c.beginPath(); c.moveTo(sx + 120, sy - 170); c.lineTo(sx + 120, sy - 236); c.stroke();
				c.fillStyle = '#ffd54f';
				c.beginPath(); c.moveTo(sx + 120, sy - 236); c.lineTo(sx + 164, sy - 224); c.lineTo(sx + 120, sy - 212); c.closePath(); c.fill();
				c.fillStyle = 'rgba(30,20,10,0.78)';
				c.fillRect(sx - 40, sy - 198, 80, 26);
				c.fillStyle = '#ffd54f'; c.font = 'bold 14px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
				c.fillText('海边商店', sx, sy - 185);
				if (this.shopNear && !this.shopOpen) {
					c.fillStyle = 'rgba(20,14,8,0.85)';
					c.fillRect(sx - 74, sy + 8, 148, 26);
					c.fillStyle = '#ffe9b0'; c.font = 'bold 13px system-ui';
					c.fillText('走近按 F 进商店', sx, sy + 21);
				}
				c.restore();
			}
			drawBrickRoom(c) {
				const wall = tileImg('Inside_A4');
				const size = 48;
				if (!this._brickRoom || this._brickRoomW !== this.world.w || this._brickRoomH !== this.world.h) {
					if (wall.complete && wall.naturalWidth) {
						const makeTile = (filter, fallback) => {
							const t = document.createElement('canvas');
							t.width = size; t.height = size;
							const x = t.getContext('2d');
							try { x.filter = filter; } catch {}
							x.drawImage(wall, 0, 0, size, size, 0, 0, size, size);
							if (!x.filter) {
								x.globalCompositeOperation = 'source-atop';
								x.fillStyle = fallback;
								x.fillRect(0, 0, size, size);
							}
							return t;
						};
						const dark = makeTile('grayscale(1) brightness(0.22) contrast(1.25)', 'rgba(0,0,0,.85)');
						const light = makeTile('grayscale(1) brightness(2.1) contrast(0.85)', 'rgba(255,255,255,.75)');
						this._brickDark = dark; this._brickLight = light;
						const build = (invert) => {
							const cv = document.createElement('canvas');
							cv.width = this.world.w; cv.height = this.world.h;
							const g = cv.getContext('2d');
							for (let row = 0; row * size < this.world.h; row++) {
								for (let col = 0; col * size < this.world.w; col++) {
									const lightCell = ((row + col) % 2 === 0) !== !!invert;
									g.drawImage(lightCell ? light : dark, col * size, row * size);
								}
							}
							return cv;
						};
						this._brickRoom = build(false);
						this._brickRoomInverted = build(true);
						this._brickRoomW = this.world.w;
						this._brickRoomH = this.world.h;
					}
				}
				if (this.badAppleEgg && this.homeRoom === 1 && this.recordPlaying?.item === 'record-bad-apple' && BAD_APPLE.ready && this._brickDark && this._brickLight) {
					this.drawBadAppleFloor(c);
					return;
				}
				const useInvert = this.easterEgg && this.homeRoom === 1 && this.recordPlaying
					? Math.floor((performance.now() - (this.recordPlaying.startAt || 0)) / 900) % 2 === 1 : false;
				const cv = useInvert ? this._brickRoomInverted : this._brickRoom;
				if (cv) c.drawImage(cv, 0, 0);
				else { c.fillStyle = '#151515'; c.fillRect(0, 0, this.world.w, this.world.h); }
			}

			drawBadAppleFloor(c) {
				const data = BAD_APPLE;
				const audio = this.recordPlaying?.audio;
				const t = audio ? audio.currentTime : 0;
				const fi = Math.max(0, Math.min(data.frameCount - 1, Math.floor(t * data.fps)));
				if (!this._badAppleCanvas || this._badAppleFrameIndex !== fi) {
					const cols = data.cols, rows = data.rows;
					const bpr = Math.ceil(cols * rows / 8);
					const base = fi * bpr;
					// 1) 生成当前帧的 1-bit 透明遮罩：白=不透明，黑=透明
					let mask = this._badAppleMask;
					if (!mask || mask.width !== cols || mask.height !== rows) {
						mask = document.createElement('canvas');
						mask.width = cols; mask.height = rows;
						this._badAppleMask = mask;
					}
					const mctx = mask.getContext('2d');
					const img = mctx.createImageData(cols, rows);
					for (let i = 0; i < cols * rows; i++) {
						const bit = (data.bytes[base + (i >> 3)] >> (i & 7)) & 1;
						img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255;
						img.data[i * 4 + 3] = bit ? 255 : 0;
					}
					mctx.putImageData(img, 0, 0);
					// 2) 构建房间尺寸的黑/白砖底层（只需一次）
					const roomW = this.world.w, roomH = this.world.h;
					if (!this._badAppleDarkLayer || this._badAppleDarkLayer.width !== roomW || this._badAppleDarkLayer.height !== roomH) {
						const buildLayer = (tile) => {
							const cv = document.createElement('canvas');
							cv.width = roomW; cv.height = roomH;
							const g = cv.getContext('2d');
							for (let y = 0; y < roomH; y += 48) for (let x = 0; x < roomW; x += 48) g.drawImage(tile, x, y, 48, 48);
							return cv;
						};
						this._badAppleDarkLayer = buildLayer(this._brickDark);
						this._badAppleLightLayer = buildLayer(this._brickLight);
					}
					// 3) 用遮罩把白砖层裁出剪影，再叠到黑砖层上
					if (!this._badAppleColorCanvas || this._badAppleColorCanvas.width !== roomW || this._badAppleColorCanvas.height !== roomH) {
						const cv = document.createElement('canvas');
						cv.width = roomW; cv.height = roomH;
						this._badAppleColorCanvas = cv;
					}
					const out = this._badAppleColorCanvas;
					const octx = out.getContext('2d');
					octx.globalCompositeOperation = 'source-over';
					octx.clearRect(0, 0, roomW, roomH);
					octx.drawImage(this._badAppleDarkLayer, 0, 0);
					if (!this._badAppleLightCanvas || this._badAppleLightCanvas.width !== roomW || this._badAppleLightCanvas.height !== roomH) {
						const lc = document.createElement('canvas');
						lc.width = roomW; lc.height = roomH;
						this._badAppleLightCanvas = lc;
					}
					const light = this._badAppleLightCanvas;
					const lctx = light.getContext('2d');
					lctx.globalCompositeOperation = 'source-over';
					lctx.clearRect(0, 0, roomW, roomH);
					lctx.drawImage(this._badAppleLightLayer, 0, 0);
					lctx.globalCompositeOperation = 'destination-in';
					lctx.imageSmoothingEnabled = false;
					lctx.drawImage(mask, 0, 0, roomW, roomH);
					octx.drawImage(light, 0, 0);
					this._badAppleFrameIndex = fi;
				}
				c.drawImage(this._badAppleColorCanvas, 0, 0);
			}

			/** 编辑模式：可编辑物件的黄框 */
			drawEditBox(c, x, y, w, h, selected) {
				c.save();
				c.strokeStyle = selected ? '#ffd54f' : 'rgba(255,213,79,.5)';
				c.lineWidth = selected ? 3 : 2;
				c.setLineDash(selected ? [] : [6, 4]);
				c.strokeRect(x - w / 2 - 6, y - h / 2 - 6, w + 12, h + 12);
				c.restore();
			}

			/** 器械显示尺寸：树场两格 48×96，矿场一格 48×48 */
			deviceBox(kind) { return kind === 'tree-farm' ? { w: 48, h: 96 } : kind === 'training-dummy' ? { w: 56, h: 96 } : { w: 48, h: 48 }; }

			/** 画一个打造器械（x,y = 图标中心） */
			drawDeviceSprite(c, kind, x, y) {
				if (kind === 'tree-farm') {
					const img = tileImg('SF_Outside_B');
					if (img.complete && img.naturalWidth) {
						c.drawImage(img, 14 * 48, 1 * 48, 48, 48, x - 24, y - 48, 48, 48);
						c.drawImage(img, 14 * 48, 2 * 48, 48, 48, x - 24, y, 48, 48);
					}
					return;
				}
				const url = BUILD_ITEMS[kind]?.iconUrl;
				if (url) { const img = assetImg(url); if (img.complete && img.naturalWidth) c.drawImage(img, x - 24, y - 24, 48, 48); }
			}

			drawHomeObjects(c, t) {
				// 家里的木制宝箱
				for (let i = 0; i < (this.homeChests ?? []).length; i++) {
					if ((Number(this.homeChests[i]?.room) || 0) !== (this.homeRoom || 0)) continue;
					const drag = (this.editDrag && this.editDrag.target === 'chest' && this.editDrag.index === i) ? this.editDrag : null;
					const pos = drag ? { x: drag.x, y: drag.y } : this.chestHomePos(i);
					const kind = this.homeChests[i]?.kind;
					const isDiamond = kind === 'diamond-chest' || ((this.homeChests[i]?.slots?.length ?? 0) > 5);
					const img = assetImg(kind === 'record-player' ? '/vs-game/assets/items/mv/record-player.png' : isDiamond ? '/vs-game/assets/items/mv/chest-blue.png' : '/vs-game/assets/items/mv/wooden-chest.png');
					if (drag) c.globalAlpha = 0.6;
					if (img.complete && img.naturalWidth) c.drawImage(img, pos.x - 22, pos.y - 22, 44, 44);
					c.globalAlpha = 1;
					if (this.editMode) this.drawEditBox(c, pos.x, pos.y, 44, 44, !!(this.editSel && this.editSel.target === 'chest' && this.editSel.index === i));
				}
				// 打造的家居器械：树场（两格）/ 基础矿场（一格）
				for (let i = 0; i < (this.homeDevices ?? []).length; i++) {
					const dv = this.homeDevices[i];
					if ((Number(dv?.room) || 0) !== (this.homeRoom || 0)) continue;
					if (!BUILD_ITEMS[dv.kind]) continue;
					const drag = (this.editDrag && this.editDrag.target === 'device' && this.editDrag.index === i) ? this.editDrag : null;
					const dx = drag ? drag.x : (Number(dv.x) || 300), dy = drag ? drag.y : (Number(dv.y) || 340);
					const box = this.deviceBox(dv.kind);
					const selected = !!(this.editSel && this.editSel.target === 'device' && this.editSel.index === i);
					const bottom = dy + box.h / 2;
					if (drag) c.globalAlpha = 0.6;
					if (dv.built !== false) {
						if (dv.kind !== 'training-dummy') this.drawDeviceSprite(c, dv.kind, dx, dy);   // 假人交给 drawDummies（要摆动/发光/连击面板）
						c.globalAlpha = 1;
						if (this.editMode) this.drawEditBox(c, dx, dy, box.w, box.h, selected);
						continue;
					}
					// 未建成：半透明虚影
					c.globalAlpha = drag ? 0.2 : 0.3;
					this.drawDeviceSprite(c, dv.kind, dx, dy);
					c.globalAlpha = 1;
					if (this.editMode) this.drawEditBox(c, dx, dy, box.w, box.h, selected);
					// 施工中：从下往上变实（玩家按 F 的 + 子代理攒的工作量合并）
					const agentSec = (this.buildWork?.get(dv.id) ?? 0) / 100;   // 子代理工作量（100/s）
					const prog = Math.min(1, (((this.buildTarget === dv.id) ? (this.buildT ?? 0) : 0) + agentSec) / (BUILD_ITEMS[dv.kind]?.buildTime ?? 3));
					if (prog > 0) {
						c.save();
						c.beginPath();
						c.rect(dx - box.w / 2, bottom - box.h * prog, box.w, box.h * prog);
						c.clip();
						this.drawDeviceSprite(c, dv.kind, dx, dy);
						c.restore();
					}
					// 子代理施工进度条（黄）
					if (prog > 0 && prog < 1) {
						c.save();
						c.fillStyle = 'rgba(0,0,0,0.5)';
						c.fillRect(dx - 22, dy - 36, 44, 5);
						c.fillStyle = '#ffd54f';
						c.fillRect(dx - 22, dy - 36, Math.round(44 * prog), 5);
						c.restore();
					}
				}
				// 地上掉落物
				const poppingItems = new Set((this.craftPops ?? []).filter((p) => p.t < (p.dur ?? 1.1)).map((p) => p.item));
				for (const g of (this.groundItems ?? [])) {
					if ((Number(g.room) || 0) !== (this.homeRoom || 0)) continue;
					if (poppingItems.has(g.item)) continue;
					const meta = itemMeta(g.item);
					const img = meta.iconUrl ? assetImg(meta.iconUrl) : null;
					const bob = Math.sin(t * 3 + g.x) * 2;
					if (img && img.complete && img.naturalWidth) c.drawImage(img, g.x - 14, g.y - 14 + bob, 28, 28);
					else { c.font = '20px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(meta.icon, g.x, g.y + bob); }
				}
				// 合成成品蹦出动画
				for (const pop of (this.craftPops ?? [])) {
					const prog = Math.min(1, pop.t / (pop.dur ?? 1.1));
					const bx = pop.x0 ?? 150;
					const by = pop.y0 ?? 420;
					const px = bx + prog * 80;
					const py = by - Math.sin(prog * Math.PI) * 70 + prog * 20;
					const meta = itemMeta(pop.item);
					const img = meta.iconUrl ? assetImg(meta.iconUrl) : null;
					if (img && img.complete && img.naturalWidth) c.drawImage(img, px - 20, py - 20, 40, 40);
					else { c.font = '30px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(meta.icon, px, py); }
				}
				// 打造放置预览
				if (this.placingBuild && this.pointer) {
					c.globalAlpha = 0.55;
					this.drawDeviceSprite(c, this.placingBuild, this.pointer.x, this.pointer.y);
					c.globalAlpha = 1;
				}
				// 放置宝箱预览
				if (this.placingChest && this.pointer) {
					const img = assetImg(this.placingChestKind === 'record-player' ? '/vs-game/assets/items/mv/record-player.png' : '/vs-game/assets/items/mv/wooden-chest.png');
					c.globalAlpha = 0.55;
					if (img.complete && img.naturalWidth) c.drawImage(img, this.pointer.x - 22, this.pointer.y - 22, 44, 44);
					c.globalAlpha = 1;
				}
				// 配方/获得提示：无边框，缓慢上浮并淡化（有物品时用真实物品图标代替 emoji）
				if (this.crafting?.message) {
					const p = this.player;
					const alpha = Math.max(0, Math.min(1, this.crafting.messageTimer / 0.7));
					const my = p.y - 60 - (1.6 - this.crafting.messageTimer) * 30;
					const meta = this.crafting.messageItem ? itemMeta(this.crafting.messageItem) : null;
					const img = meta && meta.iconUrl ? assetImg(meta.iconUrl) : null;
					c.save();
					c.globalAlpha = alpha;
					c.fillStyle = '#fff';
					c.font = 'bold 14px system-ui,sans-serif';
					c.textAlign = 'center';
					c.textBaseline = 'middle';
					c.shadowColor = '#000';
					c.shadowBlur = 4;
					if (img && img.complete && img.naturalWidth) {
						const iw = 22, gap = 5;
						const tw = c.measureText(this.crafting.message).width;
						const x0 = p.x - (iw + gap + tw) / 2;
						c.drawImage(img, x0, my - iw / 2, iw, iw);
						c.textAlign = 'left';
						c.fillText(this.crafting.message, x0 + iw + gap, my + 1);
					} else {
						c.fillText(this.crafting.message, p.x, my);
					}
					c.restore();
				}
			}

			drawHome(c, t) {
				// 只保留 tileset 背景：上方墙面，下方全部地板
				const floor = tileImg('Inside_A5');
				const wall = tileImg('Inside_A4');
				c.save();
					if (this.homeRoom === 2) {
						// 外层 drawHome 之前已经做过相机平移，这里绝不能再 translate（否则海面/商店建筑会漂移 2 倍）
						this.drawFishingRoom(c);
						this.drawFishing(c);
					this.drawFishMonsters(c);   // 活蹦乱跳的鱼怪
						this.drawSwordSwing(c);   // 第三房间点屏幕也能挥出剑气
						this.drawHomeObjects(c, t);
						this.drawBaitHud(c);
					this.drawFishingHpHud(c);   // 生命条       // 屏幕坐标（内部用 cam 抵消）
					c.restore();
						return;
					}
				if (this.homeRoom === 1) {
					this.drawBrickRoom(c);
					this.drawHomeObjects(c, t);
					c.restore();
					return;
				}
				c.fillStyle = '#241c16';
				c.fillRect(0, 0, this.world.w, this.world.h);
				if (wall.complete && wall.naturalWidth) {
					for (let y = 0; y < 96; y += 48) {
						for (let x = 0; x < this.world.w; x += 48) {
							c.drawImage(wall, 0, 0, 48, 48, x, y, 48, 48);
						}
					}
				} else {
					c.fillStyle = '#4a3b2d';
					c.fillRect(0, 0, this.world.w, 96);
				}
				c.fillStyle = '#5b4936';
				c.fillRect(0, 96, this.world.w, 12);
				if (floor.complete && floor.naturalWidth) {
					for (let y = 108; y < this.world.h; y += 48) {
						for (let x = 0; x < this.world.w; x += 48) {
							c.drawImage(floor, 0, 96, 48, 48, x, y, 48, 48);
						}
					}
				} else {
					c.fillStyle = '#6d5540';
					c.fillRect(0, 108, this.world.w, this.world.h - 108);
				}
				// 左边柜子（Inside_B  Chest of Drawers）
				const furniture = tileImg('Inside_B');
				if (furniture.complete && furniture.naturalWidth) {
					// 柜子：row1 col10 + row2 col10 竖拼，放在床左侧
					c.drawImage(furniture, 10 * 48, 1 * 48, 48, 48, 24, 96, 48, 48);
					c.drawImage(furniture, 10 * 48, 2 * 48, 48, 48, 24, 144, 48, 48);
					// Large Bed：竖着拼两格，源/目标都是 row5 col8 + row6 col8，不旋转
					c.drawImage(furniture, 8 * 48, 5 * 48, 48, 48, 72, 96, 48, 48);
					c.drawImage(furniture, 8 * 48, 6 * 48, 48, 48, 72, 144, 48, 48);
				} else {
					c.fillStyle = '#4a2e1d';
					c.fillRect(336, 240, 48, 96);
					c.fillRect(384, 240, 48, 96);
				}
				// 书架：Inside_B row3-4 col14-15 四格，放在床右边一格再上一格
				if (furniture.complete && furniture.naturalWidth) {
					c.drawImage(furniture, 14 * 48, 3 * 48, 48, 48, 120, 48, 48, 48);
					c.drawImage(furniture, 15 * 48, 3 * 48, 48, 48, 168, 48, 48, 48);
					c.drawImage(furniture, 14 * 48, 4 * 48, 48, 48, 120, 96, 48, 48);
					c.drawImage(furniture, 15 * 48, 4 * 48, 48, 48, 168, 96, 48, 48);
					// 画廊：源图块 row0 col10-11，放在墙上 row0 col10-11
					c.drawImage(furniture, 10 * 48, 0, 48, 48, 480, 0, 48, 48);
					c.drawImage(furniture, 11 * 48, 0, 48, 48, 528, 0, 48, 48);
				}
				// 合成法阵：Dungeon_C r10-12 c0-2 3x3
				const dungeon = tileImg('Dungeon_C');
				if (dungeon.complete && dungeon.naturalWidth) {
					for (let row = 10; row <= 12; row++) {
						for (let col = 0; col <= 2; col++) {
							c.drawImage(dungeon, col * 48, row * 48, 48, 48, 78 + (col - 0) * 48, 348 + (row - 10) * 48, 48, 48);
						}
					}
					// 合成中：整座法阵换成蓝色发光版（r10-12 c3-5）
					if (this.crafting?.stage === 'crafting') {
						for (let row = 10; row <= 12; row++) {
							for (let col = 3; col <= 5; col++) {
								c.drawImage(dungeon, col * 48, row * 48, 48, 48, 78 + (col - 3) * 48, 348 + (row - 10) * 48, 48, 48);
							}
						}
					}
					// 选择材料：环形物品列表 + 中央“开始仪式”
					if (this.crafting?.stage === 'selecting') {
						const items = this.craftingItems();
						for (let i = 0; i < items.length; i++) {
							const [item, count] = items[i];
							const pos = this.craftingItemPos(i, items.length);
							const selected = this.crafting.recipe.includes(item);
							c.fillStyle = selected ? 'rgba(64,196,255,.85)' : 'rgba(20,22,31,.75)';
							c.beginPath();
							c.arc(pos.x, pos.y, 19, 0, Math.PI * 2);
							c.fill();
							c.strokeStyle = selected ? '#40c4ff' : '#4f6ef7';
							c.lineWidth = 2;
							c.stroke();
							const meta = itemMeta(item);
							if (meta.iconUrl) {
								const img = itemImg(meta.iconUrl.split('/').pop().replace('.png', ''));
								if (img.complete && img.naturalWidth) c.drawImage(img, pos.x - 14, pos.y - 14, 28, 28);
								else c.fillText(meta.icon, pos.x, pos.y);
							} else {
								c.font = '18px system-ui,sans-serif';
								c.fillText(meta.icon, pos.x, pos.y);
							}
							c.font = '10px system-ui,sans-serif';
							c.fillStyle = '#e6e8f0';
							c.fillText('×' + count, pos.x, pos.y + 30);
						}
						// 中央开始
						c.fillStyle = '#1c2a5e';
						c.beginPath();
						c.arc(150, 420, 42, 0, Math.PI * 2);
						c.fill();
						c.strokeStyle = '#40c4ff';
						c.lineWidth = 2;
						c.stroke();
						c.fillStyle = '#fff';
						c.font = 'bold 12px system-ui,sans-serif';
						c.fillText('开始', 150, 415);
						c.fillText('仪式', 150, 430);
					}
					// 合成中：碎片飞入 / 完成后成品
					if (this.crafting?.stage === 'crafting') {
						const items = this.crafting.recipe?.length ? this.crafting.recipe : this.crafting.placed;
						for (let i = 0; i < items.length; i++) {
							const meta = itemMeta(items[i]);
							const a = (i / Math.max(1, items.length)) * Math.PI * 2 + t * 3;
							const px = 150 + Math.cos(a) * 26;
							const py = 420 + Math.sin(a) * 26;
							if (meta.iconUrl) {
								const img = assetImg(meta.iconUrl);
								if (img.complete && img.naturalWidth) {
									c.drawImage(img, px - 9, py - 9, 18, 18);
								} else {
									c.font = '13px system-ui,sans-serif';
									c.fillText(meta.icon, px, py);
								}
							} else {
								c.font = '13px system-ui,sans-serif';
								c.fillText(meta.icon, px, py);
							}
						}
					} else if (this.crafting?.stage === 'done') {
						const meta = itemMeta(this.crafting.result || 'skill-book');
						const bookImg = meta.iconUrl ? assetImg(meta.iconUrl) : null;
						if (bookImg && bookImg.complete && bookImg.naturalWidth) {
							c.drawImage(bookImg, 150 - 24, 420 - 24, 48, 48);
						}
					}
				}
				// 关闭UI后：放置的物品显示在法阵环形上
				if (this.crafting?.stage === 'idle' && this.crafting.placed.length > 0) {
					const placed = this.crafting.placed;
					for (let i = 0; i < placed.length; i++) {
						const pos = this.craftingItemPos(i, placed.length);
						const meta = itemMeta(placed[i]);
						c.fillStyle = 'rgba(20,22,31,.8)';
						c.beginPath();
						c.arc(pos.x, pos.y, 18, 0, Math.PI * 2);
						c.fill();
						c.strokeStyle = '#9d6bff';
						c.stroke();
						if (meta.iconUrl) {
							const img = assetImg(meta.iconUrl);
							if (img.complete && img.naturalWidth) c.drawImage(img, pos.x - 13, pos.y - 13, 26, 26);
							else { c.font='15px system-ui,sans-serif'; c.fillText(meta.icon, pos.x, pos.y); }
						} else {
							c.font='15px system-ui,sans-serif'; c.fillText(meta.icon, pos.x, pos.y);
						}
					}
				}
				this.drawHomeObjects(c, t);
				c.restore();
			}

			drawHomeItems(c, t) {
				const HOME_TILE_MAP = {
					char: { key: 'Inside_C', sx: 1 * 48, sy: 14 * 48 },
					shop: { key: 'SF_Inside_C', sx: 4 * 48, sy: 9 * 48 },
					door: { key: 'SF_Outside_A5', sx: 3 * 48, sy: 10 * 48 },
					room1: { key: 'SF_Outside_A5', sx: 2 * 48, sy: 10 * 48 },
					'room-back': { key: 'SF_Outside_A5', sx: 3 * 48, sy: 10 * 48 },
					'room-unused': { key: 'SF_Outside_A5', sx: 2 * 48, sy: 10 * 48 },
					table: { key: 'Inside_B', sx: 4 * 48, sy: 14 * 48 },
					chair: { key: 'Inside_B', sx: 2 * 48, sy: 15 * 48 },
					manual: { key: 'Inside_C', sx: 2 * 48, sy: 8 * 48 },
				};
				c.save();
				c.font = '16px system-ui,sans-serif';
				c.textAlign = 'center';
				c.textBaseline = 'middle';
				for (const item of this.homeItems) {
					const bob = (item.id === 'door' || item.id.startsWith('room') || item.id === 'table' || item.id === 'chair' || item.id === 'manual') ? 0 : Math.sin(t * 2.2 + item.x) * 3;
					const tileCfg = HOME_TILE_MAP[item.id];
					if (tileCfg) {
						const img = tileImg(tileCfg.key);
						if (img.complete && img.naturalWidth) {
							c.drawImage(img, tileCfg.sx, tileCfg.sy, 48, 48, item.x - 24, item.y + bob - 24, 48, 48);
						}
					}
					if (!tileCfg && !item.noEmoji) {
						c.fillStyle = 'rgba(20,22,31,.7)';
						c.beginPath();
						c.arc(item.x, item.y + bob, 20, 0, Math.PI * 2);
						c.fill();
						c.font = '26px system-ui,sans-serif';
						c.fillText(item.icon, item.x, item.y + bob);
					}
					c.font = '12px system-ui,sans-serif';
					c.fillStyle = 'rgba(255,255,255,.75)';
					c.shadowColor = '#000';
					c.shadowBlur = 4;
					c.fillText(item.label, item.x, item.id === 'manual' ? item.y + bob - 34 : item.y + bob + 40);
					c.shadowBlur = 0;
				}
				const _nearDev = this.homeNear && String(this.homeNear.id).startsWith('device:')
					? (this.homeDevices ?? [])[Number(String(this.homeNear.id).slice(7))] : null;
				const _nearGather = !!_nearDev && _nearDev.built !== false && (BUILD_ITEMS[_nearDev.kind]?.action ?? 'gather') === 'gather';
				if (this.homeNear && !_nearGather && this.crafting?.stage !== 'crafting') {
					const item = this.homeNear;
					const high = item.y < 70;
					const fx = high ? item.x + 52 : item.x;
					const fy = high ? item.y + 10 : item.y - 44;
					if (this.fDown && !this.fLongTriggered) {
						// 长按充能环：F 转一圈后开始合成
						const p = Math.min(1, (performance.now() - this.fStart) / 450);
						c.fillStyle = 'rgba(20,22,31,.9)';
						c.beginPath();
						c.arc(fx, fy, 14, 0, Math.PI * 2);
						c.fill();
						c.strokeStyle = 'rgba(64,196,255,.35)';
						c.lineWidth = 4;
						c.beginPath();
						c.arc(fx, fy, 16, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
						c.stroke();
					} else {
						c.fillStyle = 'rgba(20,22,31,.9)';
						c.beginPath();
						c.arc(fx, fy, 14, 0, Math.PI * 2);
						c.fill();
						c.strokeStyle = '#4f6ef7';
						c.lineWidth = 3;
						c.beginPath();
						c.arc(fx, fy, 14, 0, Math.PI * 2);
						c.stroke();
						c.fillStyle = '#fff';
						c.font = 'bold 14px system-ui,sans-serif';
						c.fillText('F', fx, fy);
					}
				}
				// 施工(黄) / 强化充能(紫) 进度环：只画玩家正贴着的那个器械
				if (this.homeNear && String(this.homeNear.id).startsWith('device:') && ((this.buildT ?? 0) > 0 || (this.enchTotal ?? 0) > 0)) {
					const item = this.homeNear;
					const high = item.y < 70;
					const fx = high ? item.x + 52 : item.x;
					const fy = high ? item.y + 10 : item.y - 44;
					const building = (this.buildT ?? 0) > 0;
					const total = building ? (this.buildTotal || 3) : (this.enchTotal || 1.1);
					// F 进度圈也把子代理攒的工作量算进来（进度统一）
					const cur = building ? ((this.buildT ?? 0) + ((this.buildWork?.get(this.buildTarget) ?? 0) / 100)) : ((this.chopT ?? 0) + (this.enchWork ?? 0) / 100);
					const prog = Math.max(0, Math.min(1, cur / total));
					c.strokeStyle = building ? 'rgba(255,213,79,.95)' : 'rgba(168,85,247,.95)';
					c.lineWidth = 5;
					c.beginPath();
					c.arc(fx, fy, 18, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
					c.stroke();
				}
				// 采集器械工作量环：玩家按 F、子代理站旁边都会往里塞工作量，头顶一直转圈
				for (const dv of (this.homeDevices ?? [])) {
					if ((Number(dv.room) || 0) !== (this.homeRoom || 0)) continue;   // 换房间后不要再看到原来那房的 F 环
					if (dv.built === false) continue;
					if ((BUILD_ITEMS[dv.kind]?.action ?? 'gather') !== 'gather') continue;
					const rec = (this.deviceWork ?? new Map()).get(dv.id);
					if (!rec) continue;
					// 器械太靠屏幕上边时，环挂到右边，别画到屏幕外
					const highUp = dv.y < 70;
					const gx = highUp ? dv.x + 52 : dv.x;
					const gy = highUp ? dv.y + 10 : dv.y - 44;
					const mineish = dv.kind === 'basic-mine';
					const prog = Math.max(0, Math.min(1, (rec.work ?? 0) / (rec.need || 1)));
					const holding = this.focused && !!this.keys && this.keys.has('f');
					const helping = holding && Math.hypot(dv.x - this.player.x, dv.y - this.player.y) <= 70;
					c.fillStyle = 'rgba(20,22,31,.85)';
					c.beginPath(); c.arc(gx, gy, 13, 0, Math.PI * 2); c.fill();
					c.lineWidth = 4;
					c.strokeStyle = 'rgba(255,255,255,.22)';
					c.beginPath(); c.arc(gx, gy, 13, 0, Math.PI * 2); c.stroke();
					c.strokeStyle = (rec.flash ?? 0) > 0 ? '#ffffff' : (mineish ? '#ffd54f' : '#8bc34a');
					c.beginPath(); c.arc(gx, gy, 13, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); c.stroke();
					if ((rec.rate ?? 0) > 0) {
						// 干活时环上再跑一小段亮弧，看起来一直在转
						const spin = t * (2.2 + 1.6 * Math.min(3, Math.max(1, (rec.rate ?? 0) / 100)));
						c.strokeStyle = 'rgba(255,255,255,.85)';
						c.lineWidth = 4;
						c.beginPath(); c.arc(gx, gy, 13, spin, spin + 0.7); c.stroke();
					}
					c.fillStyle = helping ? '#ffffff' : ((rec.rate ?? 0) > 0 ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.55)');
					c.font = 'bold 12px system-ui,sans-serif';
					c.textAlign = 'center';
					c.textBaseline = 'middle';
					c.fillText('F', gx, gy);
					if ((rec.workers ?? 0) > 1) {
						c.fillStyle = 'rgba(255,255,255,.85)';
						c.font = 'bold 11px system-ui,sans-serif';
						c.fillText('×' + rec.workers, gx, gy + 24);
					}
				}
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
					if (b.spike) {   // 刺：亮色发光三角 + 拖尾，深色海水里也一眼看得见
						const L = b.big ? 26 : 16, W = b.big ? 9 : 6;
						const tint = b.color ?? (b.big ? '#8fe3f2' : '#cfe8f5');
						c.save();
						c.translate(b.x, b.y); c.rotate(Math.atan2(b.vy, b.vx));
						c.globalAlpha = 0.32; c.fillStyle = tint;   // 拖尾
						c.beginPath(); c.moveTo(-L * 2.4, 0); c.lineTo(-L * 0.6, -W * 0.55); c.lineTo(-L * 0.6, W * 0.55); c.closePath(); c.fill();
						c.globalAlpha = 1;
						c.shadowColor = b.dark ? 'rgba(120,110,170,.5)' : tint; c.shadowBlur = b.dark ? 6 : (b.big ? 16 : 9);
						c.fillStyle = b.dark ? tint : (b.color ?? (b.big ? '#fff6df' : '#eaf3ff'));
						c.beginPath(); c.moveTo(L, 0); c.lineTo(-L * 0.6, -W); c.lineTo(-L * 0.6, W); c.closePath(); c.fill();
						c.shadowBlur = 0;
						c.lineWidth = 1.6; c.strokeStyle = b.dark ? 'rgba(150,158,196,.75)' : 'rgba(16,26,44,.85)'; c.stroke();
						c.restore();
						continue;
					}
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
				if (this.level?.seaside && !this.bossRoomMode) { this.drawSeasideGround(c); return; }   // Boss 房不要画主图沙滩/海
				if (!this.level && this.procmap) { this.drawProcBg(c, this.elapsed); return; }
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

			buildProcLayers() {
				this.procLayers = PROC_PALETTES.map((pal) => renderProcLayer(this.procmap, pal));
			}
			/** 程序化办公室：静态层 blit + 家具动效（屏幕代码行/机柜LED/绿植摆动）+ 时辰氛围罩 + 乱流虚影 */
			drawProcBg(c, t) {
				if (!this.procLayers) this.buildProcLayers();
				const { ph, prev, k } = this.procPhaseBlend();   // k<1：正在切时辰，两层静态图交叉淡入
				const sx = Math.round(this.cam.x), sy = Math.round(this.cam.y);
				c.save();
				c.drawImage(this.procLayers[prev], sx, sy, GAME_W, GAME_H, 0, 0, GAME_W, GAME_H);
				if (k < 1) {                                     // 新时辰整张图按进度叠上去
					c.globalAlpha = k;
					c.drawImage(this.procLayers[ph], sx, sy, GAME_W, GAME_H, 0, 0, GAME_W, GAME_H);
					c.globalAlpha = 1;
				}
				c.restore();
				const pal = k >= 1 ? PROC_PALETTES[ph] : blendPal(PROC_PALETTES[prev], PROC_PALETTES[ph], k);
				for (const pr of this.procmap.props) {
					const wx = pr.gx * 32, wy = pr.gy * 32;
					if (wx < sx - 64 || wx > sx + GAME_W + 64 || wy < sy - 80 || wy > sy + GAME_H + 80) continue;
					const X = wx - sx, Y = wy - sy;   // 世界→屏幕：动态件要自己减相机（静态层 blit 已含偏移）
					if (pr.kind === 'desk') {
						const mx = X + 32, my = Y + 8;
						for (let i = 0; i < 4; i++) {
							const ln = Math.floor(t * 3 + pr.scr * 7 + i * 1.7) % 6;
							const wc = 4 + ((ln * 7 + i * 3) % 16);
							c.fillStyle = ['#4ade80', '#60a5fa', '#fbbf24', '#e879f9'][i % 4];
							c.fillRect(mx - 11, my + 2 + i * 3, wc, 2);
						}
						const g = c.createRadialGradient(mx, my + 8, 4, mx, my + 8, 60);
						g.addColorStop(0, 'rgba(140,190,255,.10)'); g.addColorStop(1, 'rgba(140,190,255,0)');
						c.fillStyle = g; c.fillRect(mx - 60, my - 40, 120, 110);
					} else if (pr.kind === 'rack') {
						for (let i = 0; i < 9; i++) {
							const ly = Y + 6 + i * 6;
							c.fillStyle = mixHex(pal.metal, '#000000', 0.5); c.fillRect(X + 6, ly, 16, 4);
							for (let j = 0; j < 3; j++) {
								const on = Math.sin(t * (2 + ((pr.led + i * 3 + j * 7) % 5)) + pr.led + i + j * 2) > 0.1;
								c.fillStyle = on ? ['#4ade80', '#fbbf24', '#60a5fa'][(i + j) % 3] : '#20242c';
								c.fillRect(X + 8 + j * 6, ly + 1, 3, 2);
							}
						}
					} else if (pr.kind === 'plant') {
						const sway = Math.sin(t * 1.2 + pr.v * 9) * 2, px0 = X + 16, py0 = Y + 20;
						c.fillStyle = pal.plant;
						c.fillRect(px0 - 2 + sway, py0 - 16, 4, 16);
						c.fillRect(px0 - 8 + sway, py0 - 12, 6, 4);
						c.fillRect(px0 + 3 + sway, py0 - 14, 6, 4);
						c.fillRect(px0 - 5 + sway, py0 - 20, 4, 5);
						c.fillRect(px0 + 1 + sway, py0 - 22, 4, 6);
					}
				}
				// 氛围罩：和静态层同一个进度插值（白天 alpha=0）——亮暗是「渐暗下去」而不是「啪一下变黑」
				const tA = PROC_TINTS[prev], tB = PROC_TINTS[ph];
				const ta = tA[3] + (tB[3] - tA[3]) * k;
				if (ta > 0.002) {
					c.fillStyle = 'rgba(' + Math.round(tA[0] + (tB[0] - tA[0]) * k) + ',' + Math.round(tA[1] + (tB[1] - tA[1]) * k) + ',' + Math.round(tA[2] + (tB[2] - tA[2]) * k) + ',' + ta.toFixed(3) + ')';
					c.fillRect(0, 0, GAME_W, GAME_H);
				}
				// 时空乱流引导：纯时间驱动，与等级无关——冷色前 5 秒夜幕浮现地面虚影；冷色期间由 HUD 指南针指路
				if (this.storyMode && this.story && this.cycleStartAt != null && this.procPhase() === 1) {
					const remain = PROC_PHASE_SEC - ((this.elapsed - this.cycleStartAt) % PROC_PHASE_SEC);
					if (remain <= 5) {   // 深夜最后 5 秒：乱流虚影开始浮现
						const r = this.procmap.riftSpot, x = r.x - sx, y = r.y - sy;
						if (x > 50 && x < GAME_W - 50 && y > 70 && y < GAME_H - 50) {
							c.save();
							c.globalAlpha = 0.35 + 0.65 * (1 - remain / 5);   // 越接近冷色越清晰
							c.setLineDash([6, 6]);
							c.strokeStyle = 'rgba(150,120,255,' + (0.35 + 0.15 * Math.sin(t * 3)).toFixed(2) + ')';
							c.lineWidth = 2;
							c.beginPath(); c.ellipse(x, y, 30, 40, 0, 0, Math.PI * 2); c.stroke();
							c.setLineDash([]);
							c.fillStyle = 'rgba(200,190,255,.8)'; c.font = '12px system-ui'; c.textAlign = 'center';
							c.fillText('时空乱流即将开启', x, y + 58);
							c.restore();
						}
					}
				}
			}
			drawPlayer(c, t) {
				if (this.purge) return;   // 肃清：全程隐身（只剩虚影和斩击）
				const p = this.player;
				if (p.invuln > 0 && Math.floor(t * 14) % 2 === 0 && this.phase === 'playing') c.globalAlpha = 0.5;
				// 剑技挥砍中：本体换成攻击姿势帧（素材与 whale-girl 同为朝左、脚底对齐），
				// 注意不要在这里提前 return —— 后面的工作气场/护盾光圈还要继续画
				let drewPose = false;
				if (this.swordSwing) {
					const sw = this.swordSwing;
					const set = SWORD_STAGE_SETS[sw.stage - 1] ?? SWORD_STAGE_SETS[0];
					const fi = swordFrameIndex(sw.stage, sw.t);   // 逐帧时长（C 段末两帧更慢）
					const img = assetImg('/vs-game/assets/sprites/attack-sword-' + set[0] + fi + '.png');
					if (img && img.complete && img.naturalWidth) {
						const cs = Math.cos(sw.dir);
						const faceRight = Math.abs(cs) < 0.15 ? (p.facing > 0) : cs > 0;
						c.save();
						c.translate(p.x, p.y);
						if (faceRight) c.scale(-1, 1);
						const ps = SWORD_POSE_SIZE;
						c.drawImage(img, -ps / 2, SWORD_POSE_FOOT - ps, ps, ps);   // 脚底对齐本体，尺寸略小于本体
						c.restore();
						drewPose = true;
					}
				}
				let state = 'eat';                       // 站着不动：吃饭
				if (this.inHomeScene()) state = p.skillAction ? (p.skillAction.kind === 'shoot' ? 'shoot' : 'strike') : (p.moving ? 'walk' : 'idle');
				else if (this.phase === 'gameover') state = 'disappointed';
				else if (p.skillAction) state = p.skillAction.kind === 'shoot' ? 'shoot' : 'strike';
				if (this.railCharge) state = 'shoot';
				else if (p.celebrate > 0) state = 'celebrate';
				else if (p.invuln > 0.45) state = 'error';
				else if (p.moving) state = 'walk';
				// 开局剧情：没拿到白饭前 = 家里的 walk/idle；吃到白饭之后不再覆盖，回到正常关卡那套动作（站着 eat / 走动 walk）
				if (this.storyMode && this.story && !this.railCharge && !(p.celebrate > 0) && !(p.invuln > 0.45)) {
					const ate = this.story.step === 'eating' || this.story.step === 'fight' || this.story.step === 'ending';
					if (!ate) state = p.moving ? 'walk' : 'idle';
				}
				// 对话当前句指定动作（pose）：如初次见面大肥鱼的「error」惊讶——文字里不写（惊讶），用身体演
				if (this.phase === 'bossintro') {
					const dl = this.bossIntro?.lines?.[this.bossIntro.index];
					if (dl?.pose) state = dl.pose;
				}
				// whale-girl 素材默认朝左：朝右移动时才需要水平翻转
				// 划除动作按点击快速移动的方向决定左右，而不是 WASD 朝向
				const faceRight = p.skillAction && (state === 'strike' || state === 'shoot') ? p.skillAction.dx > 0 : p.facing > 0;
				let flip = faceRight;
				// 黑白房 + Billie Jean 彩蛋：移动方向不变，但左右动作镜像，看起来像倒着走
				if (this.easterEgg && this.homeRoom === 1) flip = !flip;
				let spriteT = t;
				if (this.railCharge) { state = 'shoot'; spriteT = this.railCharge.t; }
				else if ((state === 'strike' || state === 'shoot') && p.skillAction) {
					spriteT = p.skillAction.t;
				}
				// 鱼跃腾空：按抛物线抬起来，地上留个缩小的影子
				const leapK = (this.dash && this.dash.leap) ? Math.min(1, (this.dash.t ?? 0) / (this.dash.dur || 0.2)) : -1;
				const leapLift = leapK >= 0 ? Math.sin(leapK * Math.PI) * 24 : 0;
				if (leapLift > 0.5) {
					c.save();
					c.globalAlpha = 0.26 * (1 - leapLift / 30);
					c.fillStyle = '#0b0d14';
					c.beginPath(); c.ellipse(p.x, p.y + 28, Math.max(6, 17 - leapLift * 0.45), Math.max(2, 5.5 - leapLift * 0.14), 0, 0, Math.PI * 2); c.fill();
					c.restore();
				}
				// 鱼跃残影：快速移动时路上留几个淡淡的自己（位置在物理帧里记的）
				for (const g of this.leapGhosts ?? []) {
					const gk = 1 - g.t / g.dur;
					if (gk <= 0) continue;
					c.save();
					c.globalAlpha = Math.min(c.globalAlpha, 0.32) * gk;
					const gDrawn = drawSprite(c, state, spriteT, g.x, g.y, 56, flip);   // 用当前姿势画残影
					if (!gDrawn) { c.fillStyle = '#7c5cfc'; c.beginPath(); c.arc(g.x, g.y, 14, 0, Math.PI * 2); c.fill(); }   // 素材缺失时的兜底（和本体一致）
					c.restore();
				}
				const drawn = drewPose || drawSprite(c, state, spriteT, p.x, p.y - leapLift, 56, flip);
				if (!drawn) {
					c.fillStyle = '#7c5cfc';
					c.beginPath();
					c.arc(p.x, p.y, 14, 0, Math.PI * 2);
					c.fill();
				}
				c.globalAlpha = 1;
				// 工作防御气场（蓝色虚线环）
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

			/** 第 3 关：归档文件夹（虚/实）+ 地上的可拾取文件 */
			drawSort(c, t) {
				if (!this.sortCfg || this.bossRoomMode || !this.sortFolders?.length) return;   // Boss 房里不画主图的整理文件夹
				const p = this.player;
				for (const f of this.sortFolders) {
					const ghost = f.state === 'ghost';
					const gate = f.gate;
					const bob = Math.sin(t * 1.8 + f.x * 0.01) * 3;
					c.save();
					c.globalAlpha = ghost ? 0.32 : 1;
					c.textAlign = 'center';
					c.textBaseline = 'middle';
					c.font = '30px system-ui,sans-serif';
					c.fillText(gate ? '🗂' : '📁', f.x, f.y - 22 + bob);
					c.font = 'bold 15px ui-monospace,monospace';
					c.fillStyle = ghost ? '#8a8fa3' : (gate ? '#8fe3f2' : '#e6e8f0');
					c.fillText(f.label, f.x, f.y + 12 + bob);
					if (!ghost && gate) {
						c.strokeStyle = 'rgba(143,227,242,.5)';
						c.lineWidth = 2;
						c.setLineDash([8, 6]);
						c.beginPath(); c.arc(f.x, f.y, 52, 0, Math.PI * 2); c.stroke();
					}
					c.restore();
				}
				for (const d of this.sortDrops) {
					const bob = Math.sin(t * 3 + d.bob) * 3;
					c.save();
					c.globalAlpha = Math.max(0.25, Math.min(1, d.ttl / 2));
					c.textAlign = 'center';
					c.textBaseline = 'middle';
					c.font = '22px system-ui,sans-serif';
					c.fillText('📄', d.x, d.y + bob);
					c.font = 'bold 10px ui-monospace,monospace';
					c.fillStyle = '#cfd3e4';
					c.fillText(d.name, d.x, d.y + 18 + bob);
					c.restore();
				}
				if (this.phase !== 'playing') return;
				let target = null, td = 1e9;
				if (this.sortCarried) {
					for (const f of this.sortFolders) {
						if (f.gate || f.state !== 'solid') continue;
						const dd = Math.hypot(f.x - p.x, f.y - p.y);
						if (dd < td) { td = dd; target = { x: f.x, y: f.y - 54 }; }
					}
				} else {
					for (const d of this.sortDrops) {
						const dd = Math.hypot(d.x - p.x, d.y - p.y);
						if (dd < td) { td = dd; target = { x: d.x, y: d.y - 34 }; }
					}
				}
				if (target && td <= (this.sortCarried ? 80 : 58)) {
					c.save();
					c.font = 'bold 13px system-ui,sans-serif';
					c.textAlign = 'center';
					c.textBaseline = 'middle';
					c.fillStyle = 'rgba(255,255,255,.22)';
					c.beginPath(); c.arc(target.x, target.y, 12, 0, Math.PI * 2); c.fill();
					c.fillStyle = '#fff';
					c.fillText('F', target.x, target.y);
					c.restore();
				}
			}

			/** 第 3 关：玩家头顶显示当前抱着的文件 */
			drawSortCarried(c, t) {
				if (!this.sortCfg || !this.sortCarried) return;
				const p = this.player;
				const bob = Math.sin(t * 4) * 2;
				c.save();
				c.globalAlpha = 0.92;
				c.textAlign = 'center';
				c.textBaseline = 'middle';
				c.font = '18px system-ui,sans-serif';
				c.fillText('📄', p.x, p.y - 48 + bob);
				c.font = 'bold 10px ui-monospace,monospace';
				c.fillStyle = '#8fe3f2';
				c.fillText(this.sortCarried.name, p.x, p.y - 34 + bob);
				c.restore();
			}

			/** 打开关卡商店：走 HUD 里和家里商店同款的界面 */
			openLevelShop() {
				this.shopOpen = false;
				this.onHomeAction('level-shop');
			}
			ownsSword() {
				if ((this.inventory ?? []).includes('acc-sword')) return true;
				const base = (x) => String(x ?? '').split('~')[0].split('#')[0];
				return (this.accessories ?? []).some((x) => x && base(x) === 'acc-sword');
			}
			/** 鱼跃技力条：屏幕底部中间，两段（中间留缝）；充能中白色向右长，满了变黄，释放消耗一段黄 */
			drawLeapGauge(c) {
				if (this.phase !== 'home' && this.phase !== 'playing') return;
				if (!this.hasFishRing()) return;   // 没戴指环就不显示
				const W = 168, H = 9, GAP = 7;
				const segW = (W - GAP) / 2;
				const x0 = (GAME_W - W) / 2, y0 = GAME_H - 24;
				const charges = Math.max(0, Math.min(2, this.leapCharges ?? 0));
				c.save();
				for (let i = 0; i < 2; i++) {
					const sx = x0 + i * (segW + GAP);
					c.fillStyle = 'rgba(6,8,14,.6)';   // 底槽
					c.fillRect(sx - 1, y0 - 1, segW + 2, H + 2);
					const full = i < charges;
					const charging = i === charges && charges < 2;
					const p = full ? 1 : (charging ? Math.max(0, Math.min(1, this.leapChargeT ?? 0)) : 0);
					if (p > 0.001) {
						if (full) {
							c.shadowColor = 'rgba(255,213,79,.85)'; c.shadowBlur = 8;
							c.fillStyle = '#ffd54f';
						} else {
							c.fillStyle = 'rgba(240,246,255,.92)';   // 充能中：白色向右长
						}
						c.fillRect(sx, y0, segW * p, H);
						c.shadowBlur = 0;
					}
					c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1;
					c.strokeRect(sx - 0.5, y0 - 0.5, segW + 1, H + 1);
				}
				c.restore();
			}

			/** 玩家当前是否免伤（无敌帧 / 鱼跃腾空）。旧版剧情捡饭前全局无敌已按需求移除 */
			playerInvuln() { return (this.player?.invuln ?? 0) > 0 || (this.leapT ?? 0) > 0; }

			/** 是否戴着鱼跃指环（专属词条：空格鱼跃） */
			hasFishRing() {
				const base = (x) => String(x ?? '').split('~')[0].split('#')[0];
				return (this.accessories ?? []).some((x) => x && base(x) === 'acc-fish-ring');
			}

			/** 玩家脚底的 y（精灵 56px、脚底正好贴帧底 → 中心 +28） */
			playerFootY() { return (this.player?.y ?? 0) + 28; }

			/** 起跳水花：落在脚底，两圈有先后 */
			spawnLeapTakeoff(x, y) {
				this.leapFx = this.leapFx ?? [];
				this.leapGhosts = [];   // 清掉上一轮残影
				this.leapFx.push({ kind: 'ripple', x, y, t: 0, dur: 0.52, r0: 9, r1: 62, delay: 0 });
				this.leapFx.push({ kind: 'ripple', x, y, t: 0, dur: 0.62, r0: 5, r1: 40, delay: 0.16 });
				playSE('water', 0.5, 0.12);
				this.burst(x, y, '#cfe8f5', 5);   // 几滴水珠
			}

			/** 落地水花：在「真正落地的那一帧、脚下实际位置」炸开（人继续走也不会歪） */
			spawnLeapLanding(x, y) {
				this.leapFx = this.leapFx ?? [];
				if (this.leapFx.length > 24) this.leapFx.splice(0, this.leapFx.length - 24);
				this.leapFx.push({ kind: 'ripple', x, y, t: 0, dur: 0.56, r0: 9, r1: 74, delay: 0 });
				this.leapFx.push({ kind: 'ripple', x, y, t: 0, dur: 0.64, r0: 5, r1: 46, delay: 0.16 });
				playSE('water', 0.36, 0.06);   // 落地比起跳轻一点
				this.burst(x, y, '#e8f6ff', 6);
			}

			drawLeapFx(c) {
				if (!this.leapFx || this.leapFx.length === 0) return;
				c.save();
				c.lineCap = 'round';
				for (const f of this.leapFx) {
					if (f.kind === 'ripple') {
						const t2 = Math.max(0, f.t - (f.delay ?? 0));
						const kk = Math.max(0, Math.min(1, t2 / f.dur));
						if (kk <= 0) continue;
						const r = f.r0 + (f.r1 - f.r0) * (1 - Math.pow(1 - kk, 2));   // 先快后慢地扩散
						c.globalAlpha = 0.55 * (1 - kk);
						c.strokeStyle = '#8fe3f2';
						c.lineWidth = 3.4 * (1 - kk * 0.6);
						c.beginPath(); c.ellipse(f.x, f.y, r, r * 0.42, 0, 0, Math.PI * 2); c.stroke();
						c.globalAlpha = 0.32 * (1 - kk);
						c.strokeStyle = '#e8f6ff';
						c.lineWidth = 1.6 * (1 - kk);
						c.beginPath(); c.ellipse(f.x, f.y, r * 0.62, r * 0.26, 0, 0, Math.PI * 2); c.stroke();
					}
				}
				c.restore();
			}

			/** 鱼跃：按空格朝面朝（或按着的移动方向）跃一小段 */
			tryFishLeap() {
				if (!this.hasFishRing()) return false;   // 没戴指环就没这能力
				if (this.purge || this.fishingDeath || this.dash) return false;
				if ((this.leapCharges ?? 0) <= 0) return false;   // 两段储能都空了就放不了
				// 每段: 释放后消耗一段，未满时 1.5s 回一段（见 updateFx 和底部的技力条）
				const p = this.player;
				let dx = 0, dy = 0;
				if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
				if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
				if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
				if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
				if (!dx && !dy) dx = p.facing >= 0 ? 1 : -1;   // 没按方向键就往面朝方向跃
				const len = Math.hypot(dx, dy) || 1;
				const dist = 120;
				const tx = Math.max(16, Math.min(this.world.w - 16, p.x + (dx / len) * dist));
				const ty = Math.max(16, Math.min(this.world.h - 16, p.y + (dy / len) * dist));
				this.homeMoveTarget = null;   // 鱼跃优先，别被点击寻路顶掉
				this.dash = { x1: p.x, y1: p.y, x2: tx, y2: ty, t: 0, dur: 0.2, leap: true };
				this.leapT = 0.24;   // 腾空期间无敌（跃过去，打不到）
				this.leapCharges = Math.max(0, (this.leapCharges ?? 0) - 1);   // 吃掉一段（满的那段黄色）
				if (dx !== 0) p.facing = dx > 0 ? 1 : -1;
				this.spawnLeapTakeoff(p.x, this.playerFootY());   // 起跳水花落在脚下
				this.leapAir = true;                             // 记着「人在空中」，落地那帧再放落地水花
				return true;
			}

			hasSwordEquipped() {
				const base = (x) => String(x ?? '').split('~')[0].split('#')[0];
				return (this.accessories ?? []).some((x) => x && base(x) === 'acc-sword');
			}
			/** 剑技（普攻替换）：点击屏幕朝该方向挥剑，三段连击 */
			trySwordSwing(wx, wy) {
				if (!this.hasSwordEquipped()) return;   // 未装备普攻替换词条：点击无攻击
				const now = this.elapsed ?? 0;
				if (now - (this.swordLastClick ?? -9) < 0.05) return;   // 去抖：同一次点击只算一次
				this.swordLastClick = now;
				const dir = Math.atan2(wy - this.player.y, wx - this.player.x);
				if (this.swordSwing) {
					// 挥砍中：前两段可连点排队接下一段；第三段是收招，此间点击不算数
					if ((this.swordStage ?? 0) < 3) { this.swordQueued = true; this.swordQueuedDir = dir; }
					return;
				}
				if (now < (this.swordComboLock ?? 0)) return;   // 三连后的收招硬直：不接招
				const comboLive = (this.swordComboUntil ?? 0) > now;
				const stage = (comboLive && (this.swordStage ?? 0) < 3) ? (this.swordStage ?? 0) + 1 : 1;
				this.startSwordSwing(stage, dir);
			}
			startSwordSwing(stage, dir) {
				const dur = SWORD_STAGE_DUR[stage] ?? SWORD_STAGE_DUR[1];
				this.swordSwing = { stage, t: 0, dur, dir, hit: false, lungePrev: 0 };
				this.swordStage = stage;
				this.swordComboUntil = (this.elapsed ?? 0) + dur + SWORD_CHAIN_GRACE;   // 这段时间内可连下一段
				this.swordCd = dur * 0.5;   // 收招后无死区，连点即接段
				this.swordQueued = null;
				// 发射剑气：独立实体，慢慢成形再快速散掉（不跟挥砍瞬时闪）
				this.swordQis = this.swordQis ?? [];
				if (this.swordQis.length > 12) this.swordQis.shift();
			this.swordQis.push({
					stage, dir, x: this.player.x, y: this.player.y - 4,
					reach: [0, 95, 112, 128][stage] ?? 95,
					t: 0, life: SWORD_QI_LIFE,
				});
				playSE('kanji', stage === 3 ? 0.62 : 0.46, 0.04);   // 普攻音效（三段共用，第三段稍响）
			}
			updateSwordSwing(dt) {
				// 剑气存活/消散（独立于挥砍动画，所以能比挥砍慢）
				if (this.swordQis && this.swordQis.length > 0) {
					for (const q of this.swordQis) { q.t += dt; this.damageBySwordQi(q); }
					this.swordQis = this.swordQis.filter((q) => q.t < q.life);
				}
				if ((this.swordCd ?? 0) > 0) this.swordCd -= dt;
				const s = this.swordSwing;
				if (!s) {
					// 没有挥砍在播：处理排队里没接上的点击
					if (this.swordQueued && (this.swordCd ?? 0) <= 0) {
						const now = this.elapsed ?? 0;
						if (now >= (this.swordComboLock ?? 0)) {
							const comboLive = (this.swordComboUntil ?? 0) > now;
							const stage = (comboLive && (this.swordStage ?? 0) < 3) ? (this.swordStage ?? 0) + 1 : 1;
							this.startSwordSwing(stage, this.swordQueuedDir ?? 0);
						} else this.swordQueued = null;
					}
					return;
				}
				s.t += dt;
				// 前冲：随挥砍前压再收回（净位移 0，手感更“够得着”）
				const lunge = Math.sin(Math.min(1, s.t / s.dur) * Math.PI) * 26;
				const dLunge = lunge - (s.lungePrev ?? 0);
				s.lungePrev = lunge;
				const pl = this.player;
				pl.x = Math.max(16, Math.min(this.world.w - 16, pl.x + Math.cos(s.dir) * dLunge));
				pl.y = Math.max(16, Math.min(this.world.h - 16, pl.y + Math.sin(s.dir) * dLunge));
				// 连段取消窗口：A/B 段播到 65% 后若已排队，立即切下一段
				// （C 段是收招段不切，尾帧必须播完，播完即可马上起新一轮）
				if (s.stage < 3 && this.swordQueued && s.t >= s.dur * SWORD_CHAIN_CANCEL) {
					this.startSwordSwing(s.stage + 1, this.swordQueuedDir ?? 0);
					return;
				}
				if (!s.hit && s.t >= s.dur * 0.38) {
					s.hit = true;
					const p = this.player;
					const reach = [0, 95, 112, 128][s.stage], half = Math.PI / 3;
					const mul = [0, 1, 1.15, 1.35][s.stage];
					for (const e of this.enemies) {
						const dx = e.x - p.x, dy = e.y - p.y;
						if (Math.hypot(dx, dy) > reach + (e.size ?? 14) * 0.4) continue;
						let da = Math.atan2(dy, dx) - s.dir;
						while (da > Math.PI) da -= Math.PI * 2;
						while (da < -Math.PI) da += Math.PI * 2;
						if (Math.abs(da) > half) continue;
						// 必须走 hurtEnemy：它负责扣血 + 伤害数字 + 死亡结算（自己 e.hp -= 会让怪打到负血也不死）
						this.hurtEnemy(e, this.attackPower() * SWORD_DMG_MULT * mul);
						if (!e.immuneKnockback) { e.x += Math.cos(s.dir) * 20; e.y += Math.sin(s.dir) * 20; }
					}
				}
				if (s.t >= s.dur) {
					this.swordSwing = null;
					this.swordCd = 0;
					if (s.stage >= 3) {
						// 三段打完：进入收招硬直，下一轮三连要等这段间隔
						this.swordComboLock = (this.elapsed ?? 0) + SWORD_COMBO_RECOVER;
						this.swordQueued = null;
					} else if (this.swordQueued && (this.swordComboUntil ?? 0) > (this.elapsed ?? 0)) {
						this.startSwordSwing((this.swordStage ?? 0) + 1, this.swordQueuedDir ?? 0);
					} else this.swordQueued = null;
				}
			}
			/** 剑气（尾波）沿途伤害：月牙弧带范围内的敌人都吃伤害，每个敌人有冷却 */
			damageBySwordQi(q) {
				if (!this.enemies || this.enemies.length === 0) return;
				const p2 = Math.min(1, q.t / q.life);
				if (p2 < 0.12) return;                       // 刚起步还没成形，不结算
				const alpha = p2 < SWORD_QI_UP
					? (() => { const u = p2 / SWORD_QI_UP; return u * u * (3 - 2 * u); })()
					: Math.pow(1 - (p2 - SWORD_QI_UP) / (1 - SWORD_QI_UP), 1.9);
				const grow = p2 < SWORD_QI_UP ? p2 / SWORD_QI_UP : 1 + 0.14 * (p2 - SWORD_QI_UP) / (1 - SWORD_QI_UP);
				const radius = q.reach * (0.7 + 0.3 * grow);
				const sweep = (Math.PI / 3) * (0.45 + 0.55 * Math.min(1, grow));
				const thick = radius * 0.24 * 1.7;
				const travel = q.reach * 0.42 * Math.min(1, p2 / 0.9);
				const cx = q.x + Math.cos(q.dir) * travel, cy = q.y + Math.sin(q.dir) * travel;
				q.hitCd = q.hitCd ?? new Map();
				const now = this.elapsed ?? 0;
				const mul = [0, 1, 1.15, 1.35][q.stage] ?? 1;
				for (const e of this.enemies) {
					const dx = e.x - cx, dy = e.y - cy;
					const dist = Math.hypot(dx, dy);
					if (Math.abs(dist - radius) > thick + (e.size ?? 14) * 0.5) continue;
					let da = Math.atan2(dy, dx) - q.dir;
					while (da > Math.PI) da -= Math.PI * 2;
					while (da < -Math.PI) da += Math.PI * 2;
					if (Math.abs(da) > sweep + 0.12) continue;
					if ((q.hitCd.get(e.id) ?? 0) > now) continue;
					q.hitCd.set(e.id, now + 0.22);           // 同一敌人 0.22s 内只吃一次尾波
					const scale = 0.25 + 0.45 * alpha;       // 越淡伤害越低
					this.hurtEnemy(e, this.attackPower() * SWORD_DMG_MULT * mul * scale);   // 同剑击：走统一结算才会死
					if (!e.immuneKnockback) { e.x += Math.cos(q.dir) * 8; e.y += Math.sin(q.dir) * 8; }
				}
			}
			drawSwordSwing(c) {
				// 蓝色剑气：朝点击方向射出的月牙气刃（三层：深蓝/正蓝/淡蓝内核）
				// 包络是「慢升 → 快降」，寿命独立于挥砍动画
				const list = this.swordQis;
				if (!list || list.length === 0) return;
				c.save();
				// 不用 'lighter' 叠加：避免过曝发光，走正常混合更像实体剑气
				c.lineCap = 'round';
				for (const q of list) {
					const p2 = Math.min(1, q.t / q.life);
					// 包络：先慢（淡→实），后快（实→淡）
					let alpha, grow;
					if (p2 < SWORD_QI_UP) {
						const u = p2 / SWORD_QI_UP;
						alpha = u * u * (3 - 2 * u);          // smoothstep：起步很淡，慢慢变实
						grow = u;
					} else {
						const d = (p2 - SWORD_QI_UP) / (1 - SWORD_QI_UP);
						alpha = Math.pow(1 - d, 1.9);         // 快速消散
						grow = 1 + 0.14 * d;
					}
					const radius = q.reach * (0.7 + 0.3 * grow);
					const sweep = (Math.PI / 3) * (0.45 + 0.55 * Math.min(1, grow));
					const thick = radius * 0.24;
					const travel = q.reach * 0.42 * Math.min(1, p2 / 0.9);   // 缓慢向前飘
					c.save();
					c.translate(q.x + Math.cos(q.dir) * travel, q.y + Math.sin(q.dir) * travel);
					c.rotate(q.dir);
					const blade = (rad, w, style, a2) => {
						c.globalAlpha = Math.max(0, Math.min(1, a2 * alpha));
						c.strokeStyle = style;
						c.lineWidth = Math.max(1, w);
						c.beginPath();
						c.arc(0, 0, rad, -sweep, sweep);
						c.stroke();
					};
					blade(radius, thick * 1.7, 'rgba(22,58,170,0.9)', 0.42);          // 外层深蓝
					blade(radius, thick, 'rgba(46,110,225,0.95)', 0.68);              // 主气刃（正蓝）
					blade(radius - thick * 0.15, thick * 0.5, 'rgba(120,180,255,0.95)', 0.8);     // 内核淡蓝（不再是白）
					c.restore();
				}
				c.globalAlpha = 1;
				c.restore();
			}
			drawUrchin(c, e, s) {
				const r = s * 0.62;
				const tele = e.urchinPhase === 'tele';
				const wind = !!(e.sk && e.sk.kind === 'urchburst' && e.sk.phase === 'wind');
				const x = e.x + (tele ? rand(-2.5, 2.5) : 0), y = e.y + (tele ? rand(-2.5, 2.5) : 0);
				c.save();
				if (wind) { c.shadowColor = '#b39ddb'; c.shadowBlur = 14; }
				else if (e.elite) { c.shadowColor = tele ? '#ff5f56' : '#b39ddb'; c.shadowBlur = 12; }
				c.fillStyle = e.hitFlash > 0 ? '#ffffff' : (wind ? '#6a5a8a' : (tele ? '#8a4a56' : e.color));
				c.beginPath();
				const spikes = e.boss ? 16 : 12;
				const wob = Math.sin((this.elapsed ?? 0) * 6 + (e.id ?? 0)) * 0.06;
				const roll = e.boss ? 0 : (this.elapsed ?? 0) * 2.2;   // 小海胆一路滚着走
				for (let k = 0; k < spikes * 2; k++) {
					const ang = (k / (spikes * 2)) * Math.PI * 2 + (e.id ?? 0) + wob + roll;
					const rr = k % 2 === 0 ? r * 1.5 : r;
					const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
					if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
				}
				c.closePath(); c.fill();
				c.lineWidth = 1.2; c.strokeStyle = 'rgba(12,14,22,.75)'; c.stroke();   // 黑刺描边：深色地面也看得清
				c.fillStyle = '#fff';
				c.beginPath(); c.arc(x - r * 0.32, y - r * 0.18, r * 0.16, 0, Math.PI * 2); c.arc(x + r * 0.32, y - r * 0.18, r * 0.16, 0, Math.PI * 2); c.fill();
				c.fillStyle = '#20141f';
				const look = e.aggro ? r * 0.06 : 0;
				c.beginPath(); c.arc(x - r * 0.32 + look, y - r * 0.18, r * 0.08, 0, Math.PI * 2); c.arc(x + r * 0.32 + look, y - r * 0.18, r * 0.08, 0, Math.PI * 2); c.fill();
				if (!e.boss && e.elite && e.hp < e.maxHp) {
					c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(x - 20, y - r - 12, 40, 4);
					c.fillStyle = '#ff5f56'; c.fillRect(x - 20, y - r - 12, 40 * Math.max(0, e.hp / e.maxHp), 4);
				}
				c.restore();
			}
			mkSpike(x, y, ang, sp, dmg = 0, big = false, color = null, dark = false) {   // dmg>0 用自己的伤害；big 画成大号发光刺；color/dark 给海胆做黑刺
				return { x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 5, spike: true, text: '✶', w: big ? 20 : 12, h: big ? 20 : 12, dmg, big, color, dark };
			}
			/** 巨型海胆 AI：追击 → 蓄力（发抖变红）→ 翻滚冲撞（带尖刺尾迹）；周期放环形尖刺弹幕 */
			updateUrchinBoss(e, dt) {
				if (e.hitFlash > 0) e.hitFlash -= dt;
				e.urchinT = (e.urchinT ?? 0) + dt;
				const p = this.player;
				if (e.urchinPhase === 'dash') {
					e.x += e.dashVx * dt; e.y += e.dashVy * dt;
					e.dashT -= dt;
					const m = 34;
					if (e.x < m || e.x > this.world.w - m || e.y < m || e.y > this.world.h - m) e.dashT = 0;
					if (Math.random() < dt * 16) this.enemyBullets.push(this.mkSpike(e.x, e.y, rand(0, Math.PI * 2), 75, 0, false, '#141a26', true));   // 海胆：黑刺
					if (e.dashT <= 0) { e.urchinPhase = 'chase'; e.urchinT = 0; }
					return;
				}
				const dx = p.x - e.x, dy = p.y - e.y;
				const d = Math.hypot(dx, dy) || 1;
				if (e.urchinPhase === 'tele') {
					e.teleT -= dt;
					if (e.teleT <= 0) {
						e.urchinPhase = 'dash';
						e.dashT = 0.62;
						e.dashVx = Math.cos(e.dashA) * 470;
						e.dashVy = Math.sin(e.dashA) * 470;
						playSE('mine-place', 0.6, 0.05);
					}
					return;
				}
				const spd = e.speed * 2.1 * (this.level?.balance?.speedMul ?? 1);
				e.x += (dx / d) * spd * dt;
				e.y += (dy / d) * spd * dt;
				e.spikeCd = (e.spikeCd ?? 2.2) - dt;
				// 海胆 BOSS 只召唤小海胆（主题一致）：场上最多 2 只，超出不再召唤
				e.minionCd = (e.minionCd ?? 5) - dt;
				if (e.minionCd <= 0) {
					e.minionCd = 7;
					const minions = this.enemies.filter((x) => x.tag === 'urchin-minion' && x.hp > 0).length;
					if (minions < 2) {
						this.spawnEnemyAt('urchin', e.x + rand(-46, 46), e.y + rand(-46, 46), false, { fixedHp: 2, noDrop: true, aggro: true, tag: 'urchin-minion' });
						this.burst(e.x, e.y, '#4a3b5c', 6);
					}
				}
				if (e.spikeCd <= 0) {
					e.spikeCd = 3.6;
					const base = Math.atan2(dy, dx);
					for (let k = 0; k < 12; k++) this.enemyBullets.push(this.mkSpike(e.x, e.y, base + (k * Math.PI * 2) / 12, 150, 0, false, '#141a26', true));   // 海胆：黑刺环
					playSE('laser-shot', 0.55, 0.05);
				}
				if (e.urchinT > 3.2 && d < 430) {
					e.urchinPhase = 'tele';
					e.teleT = 0.55;
					e.dashA = Math.atan2(dy, dx);
					e.urchinT = 0;
				}
			}
			/** 海边商店面板（屏幕层） */
			shopClick(x, y) {
				const sx = x - this.cam.x, sy = y - this.cam.y;
				const PW = 380, PH = 260, PX = (GAME_W - PW) / 2, PY = (GAME_H - PH) / 2;
				if (sx >= PX + PW - 40 && sx <= PX + PW - 8 && sy >= PY + 8 && sy <= PY + 40) { this.shopOpen = false; return; }
				const bx = PX + PW / 2 - 90, by = PY + PH - 64;
				if (sx >= bx && sx <= bx + 180 && sy >= by && sy <= by + 44 && !this.ownsSword()) {
					this.sendWs({ kind: ClientMsg.LEVEL_SHOP_BUY, item: 'acc-sword' });
				}
			}
			drawShopPanel(c) {
				const PW = 380, PH = 260, PX = (GAME_W - PW) / 2, PY = (GAME_H - PH) / 2;
				c.save();
				c.fillStyle = 'rgba(8,10,16,0.55)'; c.fillRect(0, 0, GAME_W, GAME_H);
				c.fillStyle = '#141824'; c.strokeStyle = '#3a4258'; c.lineWidth = 2;
				c.fillRect(PX, PY, PW, PH); c.strokeRect(PX, PY, PW, PH);
				c.fillStyle = '#ffd54f'; c.font = 'bold 19px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
				c.fillText('海边商店', GAME_W / 2, PY + 26);
				c.fillStyle = '#8a92a8'; c.font = 'bold 15px system-ui'; c.fillText('✕', PX + PW - 24, PY + 24);
				const img = assetImg('/vs-game/assets/items/mv/acc-sword.png');
				if (img && img.complete && img.naturalWidth) c.drawImage(img, PX + 28, PY + 56, 62, 64);
				c.textAlign = 'left';
				c.fillStyle = '#8fb4ff'; c.font = 'bold 17px system-ui';
				c.fillText('宝剑（蓝色 · 饰品）', PX + 104, PY + 74);
				c.fillStyle = '#f5c451'; c.font = '12.5px system-ui';
				c.fillText('◆ 普通攻击替换为剑技', PX + 104, PY + 98);
				c.fillStyle = '#c9cfdd';
				c.fillText('点击屏幕：朝点击方向挥剑（三段连击）', PX + 104, PY + 118);
				c.fillText('蓝色 3 孔 · 强化时只能作为基底 · 佩戴唯一', PX + 104, PY + 138);
				c.fillStyle = '#ffd54f'; c.font = 'bold 14px system-ui';
				c.fillText('价格：10000 token（持有 ' + (this.gold ?? 0) + '）', PX + 30, PY + 178);
				const owned = this.ownsSword();
				const bx = PX + PW / 2 - 90, by = PY + PH - 64;
				c.fillStyle = owned ? '#2a2e3d' : '#2456b0';
				c.fillRect(bx, by, 180, 44);
				c.fillStyle = owned ? '#5f657a' : '#ffffff';
				c.font = 'bold 16px system-ui'; c.textAlign = 'center';
				c.fillText(owned ? '已拥有（佩戴后点击屏幕挥剑）' : '购 买', GAME_W / 2, by + 22);
				c.restore();
			}
			drawEnemies(c, t) {
				for (const e of this.enemies) {
					const s = e.size;
					if (e.type === 'urchin' || e.urchin) { this.drawUrchin(c, e, s); continue; }
					const w = s * 1.15, hh = s * 1.35;
					// ── demo 同款灵动渲染：上下飘 + 纸片倾斜摆 + 影子钉在地上 ──
					const ph = (e.id * 1.37) % 6.283;
					const sk = e.sk;
					let bob = Math.sin(t * 6 + ph) * 2;
					let rot = Math.sin(t * 2.3 + ph) * 0.07;
					let sy = 1, hop = 0;
					if (sk) {
						if (sk.kind === 'dash') {
							if (sk.phase === 'wind') { sy = 0.84; bob = 1; rot = 0; }                              // 蓄力下蹲
							else if (sk.phase === 'go') rot = e.type === 'misc' ? sk.t * 11 : sk.dir + Math.PI / 2; // misc 团身滚 / docs 变纸飞机头朝前
						} else if (sk.kind === 'ring') {
							if (sk.phase === 'wind') { hop = Math.sin(Math.min(1, sk.t / 0.28) * Math.PI) * 12; sy = 1 + sk.t * 0.5; }  // 起跳
							else if (sk.phase === 'go') { sy = 0.8; bob = 0; }                                     // 落地压扁
						} else if (sk.kind === 'laser' && sk.phase === 'wind') {
							bob = Math.sin(t * 18) * 1.2;   // 蓄能高频抖动
						} else if (sk.kind === 'blink' && sk.phase === 'wind') {
							bob = 0; sy = Math.max(0.25, 1 - sk.t * 1.4);   // 光标熄灭：缩掉
						} else if (sk.kind === 'strafe' && sk.phase === 'go') {
							rot = Math.sin(t * 16) * 0.14;                  // 掠过：高速抖摆
						} else if (sk.phase === 'wind' && (sk.kind === 'spit' || sk.kind === 'wall' || sk.kind === 'pull' || sk.kind === 'lockdash')) {
							sy = 0.9; bob = 1;                              // 起手：鼓气/伸手
						}
					}
					// 影子：飘得越高影越小越淡
					c.save();
					c.globalAlpha = Math.max(0.08, 0.22 - bob * 0.03 - hop * 0.01);
					c.fillStyle = '#0b0d14';
					c.beginPath(); c.ellipse(e.x, e.y + hh * 0.52, Math.max(4, s * 0.55 - bob - hop * 0.3), Math.max(1.5, s * 0.18), 0, 0, Math.PI * 2); c.fill();
					c.restore();
					// 蓄力预警线（docs 冲锋方向 / TS 锁走红线）
					if (sk && sk.phase === 'wind' && (sk.kind === 'dash' || sk.kind === 'laser' || sk.kind === 'lockdash' || sk.kind === 'pull')) {
						c.save();
						c.setLineDash([5, 5]);
						const isLaser = sk.kind === 'laser';
						c.strokeStyle = isLaser ? 'rgba(255,107,129,' + (0.45 + 0.3 * Math.sin(t * 14)).toFixed(2) + ')' : 'rgba(230,235,245,.35)';
						c.lineWidth = isLaser ? 2.5 : 1.5;
						const len = isLaser ? 470 : 300;
						c.beginPath(); c.moveTo(e.x, e.y);
						c.lineTo(e.x + Math.cos(sk.dir) * len, e.y + Math.sin(sk.dir) * len);
						c.stroke();
						c.setLineDash([]);
						c.restore();
					}
					c.save();
					if (e.blinkA != null) c.globalAlpha = Math.max(0.06, e.blinkA);   // TTY 闪烁：逐渐熄灭
					c.translate(e.x, e.y - bob - hop);
					c.rotate(rot);
					c.scale(1 / Math.sqrt(sy), sy);   // 挤压时保持面积
					const x = -w / 2, y = -hh / 2;
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
					// config 括号护盾：两侧 { } 光弧
					if (e.shieldT > 0) {
						c.save();
						c.strokeStyle = 'rgba(255,183,77,' + (0.55 + 0.3 * Math.sin((this.elapsed ?? 0) * 10)).toFixed(2) + ')';
						c.lineWidth = 2.5;
						const rr = s * 1.05;
						c.beginPath(); c.arc(0, 0, rr, Math.PI * 0.6, Math.PI * 1.4); c.stroke();    // 左括号 {
						c.beginPath(); c.arc(0, 0, rr, -Math.PI * 0.4, Math.PI * 0.4); c.stroke();   // 右括号 }
						c.restore();
					}
					// 扩展名标签
					c.fillStyle = e.hitFlash > 0 ? '#333' : 'rgba(10,12,18,0.85)';
					c.font = 'bold ' + Math.max(7, Math.floor(s * 0.42)) + 'px ui-monospace,monospace';
					c.textAlign = 'center';
					c.textBaseline = 'middle';
					c.fillText(e.label, 0, s * 0.18);
					// 精英/Boss 血条（Boss 更宽，常驻显示）
					if (e.elite && (e.boss || e.hp < e.maxHp)) {
						const bw = e.boss ? 56 : 32;
						c.fillStyle = '#1c1f2b';
						c.fillRect(-bw / 2, -hh / 2 - 8, bw, e.boss ? 6 : 4);
						c.fillStyle = e.boss ? '#ff9800' : '#ff5f56';
						c.fillRect(-bw / 2, -hh / 2 - 8, bw * Math.max(0, e.hp / e.maxHp), e.boss ? 6 : 4);
					}
					c.restore();
				}
				// TS 检测激光闪光（世界坐标，画在怪层上）
				for (const fx of this.skillFx) {
					const k = 1 - fx.t / fx.dur;
					c.save();
					c.globalAlpha = k;
					c.strokeStyle = '#ff6b81';
					c.lineWidth = 10 * k + 2;
					c.shadowColor = '#ff6b81';
					c.shadowBlur = 14;
					c.beginPath();
					c.moveTo(fx.x, fx.y);
					c.lineTo(fx.x + Math.cos(fx.dir) * fx.len, fx.y + Math.sin(fx.dir) * fx.len);
					c.stroke();
					c.restore();
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
					c.save();                                  // 地图等绘制可能残留 lineWidth，地雷自己兜底
					c.lineWidth = 1;
					const pulse = 1 + Math.sin(t * 5) * 0.15;
					if (m.fuse != null) {
						// 引爆倒计时：显示最终爆炸的扇形范围
						const halfArc = m.arc / 2;
						c.save();
						c.translate(m.x, m.y);
						c.rotate(m.angle);
						c.fillStyle = 'rgba(255,183,77,0.28)';
						c.beginPath();
						c.moveTo(0, 0);
						c.arc(0, 0, m.range, -halfArc, halfArc);
						c.closePath();
						c.fill();
						c.strokeStyle = 'rgba(255,183,77,0.5)';
						c.lineWidth = 1;
						c.beginPath();
						c.moveTo(0, 0);
						c.arc(0, 0, m.range, -halfArc, halfArc);
						c.closePath();
						c.stroke();
						c.fillStyle = 'rgba(255,183,77,0.95)';
						c.beginPath();
						c.arc(0, 0, 6 * pulse, 0, Math.PI * 2);
						c.fill();
						c.restore();
					} else {
						// 未触发：不显示固定朝向，只显示地雷本体和无方向感应圈
						c.fillStyle = m.arm > 0 ? 'rgba(255,183,77,0.35)' : 'rgba(255,183,77,0.9)';
						c.beginPath();
						c.arc(m.x, m.y, 6 * pulse, 0, Math.PI * 2);
						c.fill();
						c.strokeStyle = 'rgba(255,183,77,0.25)';
						c.lineWidth = 1;
						c.beginPath();
						c.arc(m.x, m.y, m.range * 0.35, 0, Math.PI * 2);
						c.stroke();
					}
					c.restore();
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
				if (this.railFlash > 0) {   // 开火瞬间的全屏泛光
					c.save();
					c.globalAlpha = Math.min(0.5, this.railFlash * 1.4);
					c.fillStyle = '#d6f4ff';
					c.fillRect(0, 0, this.world.w, this.world.h);
					c.restore();
				}
				for (const b of this.beams) {
					if (b.kind === 'railgun') {
					const k = Math.max(0, Math.min(1, b.life / b.maxLife));
					const flick = 0.88 + Math.sin(this.elapsed * 62) * 0.12;
					const env = Math.min(1, k * 3);                     // 前后 0.4s 收束
					const w = b.width * (0.3 + 0.7 * env);
					const t = this.elapsed;
					const age = b.maxLife - b.life;
					c.save();
					c.translate(b.x, b.y);
					c.rotate(b.angle);
					// ① 外层光晕：竖切面渐变（中心亮、上下透明），比一块纯色矩形像光束
					const halo = c.createLinearGradient(0, -w * 0.75, 0, w * 0.75);
					halo.addColorStop(0, 'rgba(64,196,255,0)');
					halo.addColorStop(0.5, 'rgba(64,196,255,' + (0.24 * flick) + ')');
					halo.addColorStop(1, 'rgba(64,196,255,0)');
					c.fillStyle = halo;
					c.fillRect(0, -w * 0.75, b.len, w * 1.5);
					// ② 主光束：两端收口 + 沿长度正弦脉动（能量流动感）
					c.beginPath();
					const SEG = 26;
					for (let i2 = 0; i2 <= SEG; i2++) {
						const px = (i2 / SEG) * b.len;
						const taper = Math.sin(Math.PI * Math.min(1, (i2 / SEG) * 1.15)) ** 0.5;
						const wob = 1 + Math.sin(px * 0.022 - t * 26) * 0.16;
						const hw = (w / 2) * taper * wob;
						if (i2 === 0) c.moveTo(px, -hw); else c.lineTo(px, -hw);
					}
					for (let i2 = SEG; i2 >= 0; i2--) {
						const px = (i2 / SEG) * b.len;
						const taper = Math.sin(Math.PI * Math.min(1, (i2 / SEG) * 1.15)) ** 0.5;
						const wob = 1 + Math.sin(px * 0.022 - t * 26) * 0.16;
						c.lineTo(px, (w / 2) * taper * wob);
					}
					c.closePath();
					const body = c.createLinearGradient(0, -w / 2, 0, w / 2);
					body.addColorStop(0, 'rgba(120,220,255,' + (0.10 * k) + ')');
					body.addColorStop(0.5, 'rgba(170,240,255,' + (0.5 * flick * k) + ')');
					body.addColorStop(1, 'rgba(120,220,255,' + (0.10 * k) + ')');
					c.fillStyle = body;
					c.fill();
					// ③ 电流条纹：裁在光束里向右流动
					c.save();
					c.clip();
					c.globalAlpha = 0.14 * k;
					c.fillStyle = '#eafcff';
					for (let sx = -120 + ((t * 1400) % 120); sx < b.len; sx += 120) {
						c.beginPath();
						c.moveTo(sx, -w);
						c.lineTo(sx + 26, -w);
						c.lineTo(sx + 26 + 130, w);
						c.lineTo(sx + 130, w);
						c.closePath();
						c.fill();
					}
					c.restore();
					// ④ 白色主芯（更细更亮）
					const core = c.createLinearGradient(0, -w * 0.17, 0, w * 0.17);
					core.addColorStop(0, 'rgba(255,255,255,0)');
					core.addColorStop(0.5, 'rgba(255,255,255,' + (0.95 * k) + ')');
					core.addColorStop(1, 'rgba(255,255,255,0)');
					c.fillStyle = core;
					c.fillRect(0, -w * 0.17, b.len, w * 0.34);
					// ⑤ 边缘电弧：上下两条抖动的细线
					c.globalAlpha = 0.35 * k;
					c.strokeStyle = '#cdf3ff';
					c.lineWidth = 1.6;
					for (const sgn of [-1, 1]) {
						c.beginPath();
						for (let px = 0; px <= b.len; px += 36) {
							const taper2 = Math.sin(Math.PI * Math.min(1, (px / b.len) * 1.15)) ** 0.5;
							const y2 = sgn * (w / 2) * taper2 * (0.92 + Math.sin(px * 0.06 + t * 34 + sgn) * 0.1);
							if (px === 0) c.moveTo(px, y2); else c.lineTo(px, y2);
						}
						c.stroke();
					}
					c.globalAlpha = 1;
					// ⑥ 远端爆闪
					const endR = w * 1.25;
					const endG = c.createRadialGradient(b.len, 0, 0, b.len, 0, endR);
					endG.addColorStop(0, 'rgba(235,252,255,' + (0.75 * k) + ')');
					endG.addColorStop(0.45, 'rgba(120,220,255,' + (0.28 * k) + ')');
					endG.addColorStop(1, 'rgba(64,196,255,0)');
					c.fillStyle = endG;
					c.beginPath(); c.arc(b.len, 0, endR, 0, Math.PI * 2); c.fill();
					// ⑦ 炮口：亮核 + 两圈扩散环
					const mz = c.createRadialGradient(0, 0, 0, 0, 0, w * 0.38);
					mz.addColorStop(0, 'rgba(255,255,255,' + (0.8 * k) + ')');
					mz.addColorStop(0.5, 'rgba(150,235,255,' + (0.34 * k) + ')');
					mz.addColorStop(1, 'rgba(64,196,255,0)');
					c.fillStyle = mz;
					c.beginPath(); c.arc(0, 0, w * 0.38, 0, Math.PI * 2); c.fill();
					for (let i2 = 0; i2 < 2; i2++) {
						const p2 = ((age * 2.4 + i2 * 0.5) % 1);
						c.globalAlpha = (1 - p2) * 0.55 * k;
						c.strokeStyle = '#9fe8ff';
						c.lineWidth = 3.5 * (1 - p2);
						c.beginPath(); c.arc(0, 0, 14 + p2 * w * 0.5, 0, Math.PI * 2); c.stroke();
					}
					c.restore();
					continue;
				}
					c.save();
					c.translate(b.x, b.y);
					c.rotate(b.angle);
					if (b.kind === 'laser') {
						// 编译激光：细芯 + 淡雾（靠「芯」亮，不靠面积糊屏）
						// fl：这束 0.12s 内命中过敌人 → 两层一起提亮，保留打击反馈
						const fl = Math.max(0, Math.min(1, (b.flash ?? 0) / 0.12));
						const fogW = b.width * 0.7;      // 淡雾比判定窄一点，宁可细不可糊
						const coreLen = b.len * 0.85;    // 芯收短，尖端亮点标出真正打到哪
						// ① 淡雾：低透明度冷紫，负责穿透感 + 覆盖整段判定长度
						const fog = c.createLinearGradient(0, 0, b.len, 0);
						fog.addColorStop(0, `rgba(150,130,255,${0.13 + 0.07 * fl})`);
						fog.addColorStop(0.45, `rgba(150,130,255,${0.06 + 0.04 * fl})`);
						fog.addColorStop(1, 'rgba(150,130,255,0)');
						c.fillStyle = fog;
						c.fillRect(0, -fogW / 2, b.len, fogW);
						// ② 细芯：2.4px 冷白青，细但亮
						const core = c.createLinearGradient(0, 0, coreLen, 0);
						core.addColorStop(0, `rgba(235,245,255,${0.55 + 0.35 * fl})`);
						core.addColorStop(0.6, `rgba(235,245,255,${0.28 + 0.2 * fl})`);
						core.addColorStop(1, 'rgba(235,245,255,0)');
						c.fillStyle = core;
						c.fillRect(0, -1.2, coreLen, 2.4);
						// ③ 尖端烧灼点：命中时微微胀大
						const tipR = 2.4 * (1 + 0.5 * fl);
						const tip = c.createRadialGradient(coreLen, 0, 0, coreLen, 0, tipR * 2.6);
						tip.addColorStop(0, `rgba(235,245,255,${0.45 + 0.4 * fl})`);
						tip.addColorStop(0.4, `rgba(150,130,255,${0.20 + 0.14 * fl})`);
						tip.addColorStop(1, 'rgba(150,130,255,0)');
						c.fillStyle = tip;
						c.beginPath(); c.arc(coreLen, 0, tipR * 2.6, 0, Math.PI * 2); c.fill();
					} else {
						// 旧式限时光束（遗留的 fireLaser）：保持原样
						const alpha = Math.max(0, b.life / b.maxLife);
						const grad = c.createLinearGradient(0, 0, b.len, 0);
						grad.addColorStop(0, `rgba(157,107,255,${0.85 * alpha})`);
						grad.addColorStop(1, 'rgba(157,107,255,0)');
						c.fillStyle = grad;
						c.fillRect(0, -b.width / 2, b.len, b.width);
					}
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
					} else if (pt.kind === 'enderPillar') {
						const k2 = Math.max(0, pt.life / pt.maxLife);
						const grad = c.createLinearGradient(pt.x, pt.y - 68, pt.x, pt.y + 42);
						grad.addColorStop(0, 'rgba(180,107,255,0)');
						grad.addColorStop(0.42, 'rgba(180,107,255,' + (0.7 * k2) + ')');
						grad.addColorStop(1, 'rgba(80,40,160,0)');
						c.fillStyle = grad;
						c.fillRect(pt.x - 34, pt.y - 68, 68, 110);
						c.strokeStyle = 'rgba(216,180,255,' + (0.9 * k2) + ')';
						c.lineWidth = 3;
						c.beginPath(); c.ellipse(pt.x, pt.y + 22, 30 * (1.15 - k2 * 0.15), 9, 0, 0, Math.PI * 2); c.stroke();
					} else if (pt.kind === 'ender') {
						c.globalAlpha = k;
						c.strokeStyle = pt.color;
						c.lineWidth = 2;
						c.beginPath();
						c.arc(pt.x, pt.y, pt.size * (1.25 - k * 0.6), 0, Math.PI * 2);
						c.stroke();
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

			/** 伤害数字：统一入口。kind = normal / crit / skill / taken / gold / heal */
			spawnDmgNum(x, y, text, kind = 'normal', dmg = 0) {
				const STYLE = {
					normal: { color: '#ffe066', size: 17, glow: null,        life: 0.55 },
					crit:   { color: '#ff9a5c', size: 24, glow: 'rgba(255,90,40,.85)', life: 0.8 },
					skill:  { color: '#bfe9ff', size: 19, glow: 'rgba(120,200,255,.45)', life: 0.6 },
					taken:  { color: '#ff6b6b', size: 20, glow: 'rgba(255,40,40,.5)',   life: 0.85 },
					gold:   { color: '#ffd54f', size: 18, glow: null,        life: 1.4 },
					heal:   { color: '#8ef2a4', size: 18, glow: null,        life: 0.9 },
				};
				const st = STYLE[kind] ?? STYLE.normal;
				const n = {
					// 再散开一点：同一只怪连刀时数字不会糊成一坨
					x: x + rand(-13, 13), y: y + rand(-6, 4), text, color: st.color, size: st.size, glow: st.glow,
					t: 0, dur: st.life,
					vx: rand(-9, 9), vy0: kind === 'crit' ? 112 : 92,   // 先快后慢地上飘
					score: (dmg || 0) * (kind === 'crit' ? 1.8 : 1) + (kind === 'taken' ? 1e6 : 0),
				};
				if (this.dmgNums.length >= 40) {
					// 满了：淘汰最不重要的那个（小伤害 / 旧数字），别把大伤害挤掉
					let worst = 0;
					for (let i = 1; i < this.dmgNums.length; i++) if (this.dmgNums[i].score < this.dmgNums[worst].score) worst = i;
					if (this.dmgNums[worst].score > n.score) return;
					this.dmgNums.splice(worst, 1);
				}
				this.dmgNums.push(n);
			}

			drawDmgNums(c) {
				if (!this.dmgNums.length) return;
				c.textAlign = 'center';
				c.textBaseline = 'middle';
				c.lineJoin = 'round';
				for (const d of this.dmgNums) {
					const k = Math.min(1, d.t / d.dur);
					const pop = k < 0.16 ? 1.34 - 0.34 * (k / 0.16) : 1;          // 出生弹出一下
					const fade = k > 0.6 ? Math.max(0, 1 - (k - 0.6) / 0.4) : 1;
					const size = d.size * pop * (1 - 0.12 * k);
					c.globalAlpha = fade;
					c.font = 'bold ' + size.toFixed(1) + 'px system-ui,sans-serif';
					// 深色粗描边（关键）：任何背景上都读得清
					c.lineWidth = Math.max(3.2, size * 0.2);
					c.strokeStyle = 'rgba(8,10,18,.92)';
					if (d.glow) { c.shadowColor = d.glow; c.shadowBlur = 14; }
					c.strokeText(d.text, d.x, d.y);
					c.shadowBlur = 0;
					c.lineWidth = Math.max(1, size * 0.055);
					c.strokeStyle = 'rgba(255,255,255,.55)';   // 白色内高光，数字更立体
					c.strokeText(d.text, d.x, d.y);
					c.fillStyle = d.color;
					c.fillText(d.text, d.x, d.y);
				}
				c.globalAlpha = 1;
				c.shadowBlur = 0;
			}

			// ── HUD 快照（React 10fps 轮询） ──
			/**
			 * 当前场景里所有「可以交互的目标」——指南针就在这份表里循环（按 Z 切换）。
			 * 顺序是稳定的（不按距离排），这样一边走一边按 Z 不会跳来跳去；没选过时默认指向最近的那个。
			 */
			compassTargets() {
				const p = this.player;
				if (!p) return [];
				const out = [];
				// ① 开局剧情（虚无）：？？？ → 白饭碗 → 时空乱流
				if (this.storyMode && this.story) {
					const st = this.story;
					if (st.step === 'walk' && st.npc && (st.npc.alpha ?? 1) > 0.05) out.push({ id: 'story-npc', label: '？？？（F 对话）', x: st.npc.x, y: st.npc.y, pri: 0 });
					if (st.bowl) out.push({ id: 'story-bowl', label: '白饭碗（F 捡起）', x: st.bowl.x, y: st.bowl.y, pri: 0 });
					if (st.rift) out.push({ id: 'story-rift', label: '时空乱流（走进去）', x: st.rift.x, y: st.rift.y, pri: 0 });
					else if (this.procmap && this.cycleStartAt != null && this.procPhase() === 2) out.push({ id: 'story-rift-spot', label: '乱流点·中央广场', x: this.procmap.riftSpot.x, y: this.procmap.riftSpot.y, pri: 0 });
					return out;
				}
				// ② 家里 / 钓鱼房：家具、器械、宝箱、门
				if (this.inHomeScene()) {
					for (const it of this.homeItems ?? []) {
						if (it.decor) continue;                                  // 桌椅只是摆件
						if (String(it.id).startsWith('ground:')) continue;       // 地上的东西走过去就捡，不占指南针
						out.push({ id: 'home:' + it.id, label: it.label || (it.device ? '器械' : '宝箱'), x: it.x, y: it.y, pri: 1 });
					}
					return out;
				}
				// ③ 关卡：宝箱 → 海边商店 → 整理完成点 → Boss 房
				if (this.level) {
					if (this.bossRoomMode) {
						const bc = this.bossChest;
						if (bc && !bc.opened) out.push({ id: 'boss-chest', label: '通关宝箱', x: bc.x, y: bc.y, pri: 0 });
						return out;
					}
					// 整理工作区 / 积压如山：四个存放点也在表里；手上拿着文件时，对应的那个排最前（默认就指它）
					const carryFolder = this.sortCarried ? this.sortTargetId(this.sortCarried.ext) : null;
					const stillSorting = (this.sortCorrect ?? 0) < (this.sortCfg?.need ?? 0);   // 整理够了以后存放点转「虚」，就不再指
					const liveFolders = stillSorting ? (this.sortFolders ?? []).filter((f) => !f.gate && f.state !== 'ghost') : [];
					for (const f of liveFolders) {
						const match = !!carryFolder && f.id === carryFolder;
						out.push({ id: 'folder:' + f.id, label: f.label + ' 存放点' + (match ? '（手上这份）' : ''), x: f.x, y: f.y, pri: match ? -1 : 1 });
					}
					for (const c of this.chests ?? []) if (!c.opened) out.push({ id: 'chest:' + c.id, label: '宝箱', x: c.x, y: c.y, pri: 0 });
					if (this.level.shop) out.push({ id: 'level-shop', label: '海边商店（F 购买）', x: this.level.shop.xf * this.world.w, y: this.level.shop.yf * this.world.h, pri: 1 });
					const need = this.sortCfg?.need ?? 0;
					const done = this.sortCorrect ?? 0;
					const gate = this.sortFolders?.find((f) => f.gate);
					if (gate && done < need) out.push({ id: 'sort-gate', label: '整理完成点（还差 ' + (need - done) + ' 份）', x: gate.x, y: gate.y, pri: 0 });
					const bz = this.level.bossZone;
					const ready = (this.chests ?? []).every((c) => c.opened) && done >= need;
					if (bz && ready) out.push({ id: 'boss-zone', label: 'Boss 房（走进去）', x: bz.xf * this.world.w, y: bz.yf * this.world.h, pri: 0 });
					return out;
				}
				return out;
			}
			/** 指南针当前锁定的目标（选过就跟随 id；目标消失/没选过 → 落到最近的那个） */
			compassPick() {
				const list = this.compassTargets();
				if (!list.length) return null;
				const p = this.player;
				let idx = list.findIndex((t) => t.id === this.compassSelId);
				if (idx < 0) {
					// 没选过 / 选中的目标消失了 → 落到最近的「主线目标」（pri 0）；没有主线目标才落到最近的一般交互点
					const minPri = Math.min(...list.map((t) => t.pri ?? 0));
					let bd = Infinity;
					list.forEach((t, i) => {
						if ((t.pri ?? 0) !== minPri) return;
						const d = Math.hypot(t.x - p.x, t.y - p.y);
						if (d < bd) { bd = d; idx = i; }
					});
					this.compassSelId = list[idx].id;
				}
				const t = list[idx];
				const dx = t.x - p.x, dy = t.y - p.y;
				const di = Math.round((((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4))) & 7;
				return { id: t.id, label: t.label, x: t.x, y: t.y, dir: COMPASS_DIRS[di], dist: Math.round(Math.hypot(dx, dy) / 10), index: idx, total: list.length };
			}
			/** 按 Z：切到下一处可交互目标（循环） */
			cycleCompass() {
				const list = this.compassTargets();
				if (!list.length) { this.setBanner('🧭 这里没有可交互的目标'); return; }
				const next = ((this.compassPick()?.index ?? -1) + 1) % list.length;
				this.compassSelId = list[next].id;
				const np = this.compassPick();   // 换好后用同一套取整规则算方位/距离
				this.setBanner('🧭 ' + np.label + ' ' + np.dir + ' ' + np.dist + 'm · ' + (next + 1) + '/' + list.length);
				playSE('ui-click-2', 0.5, 0.04);
			}
			snapshot() {
				if (typeof window !== 'undefined' && window.__vsGameDebug) window.__vsGameDebug.engine = this;
			if (typeof window !== 'undefined' && window.__vsGameDebug) { window.__vsGameDebug.playSE = playSE; window.__vsGameDebug.audioMix = () => ({ ...AUDIO_MIX }); }
				const _lv = this.level ? { levelName: this.level.name, levelChapter: this.level.chapter ?? null } : { levelName: null };
				const homeRoomNow = this.homeRoom ?? 0;   // 第三房间（钓鱼海滩）不显示编辑模式
				const edit = (this.editMode && this.phase === 'home' && homeRoomNow !== 2) ? { mode: true, sel: this.editSelInfo() } : null;
				const sort = (this.sortCfg && !this.bossRoomMode) ? {
					done: this.sortCorrect ?? 0,
					need: this.sortCfg.need ?? 10,
					carried: this.sortCarried?.name ?? null,
					agents: this.agentCfg ? { dispatched: !!this.agentsDispatched, alive: this.agents.length, total: this.agentCfg.count ?? 5, carrying: this.agents.filter((a) => a.carry).length } : null,
					rules: (this.sortCfg.rules ?? []).map((r) => ({
						exts: r.exts,
						label: (this.sortFolders.find((f) => f.id === r.folder)?.label ?? r.folder),
					})),
				} : null;
				// 指南针：永远指向「当前锁定的那一个」可交互目标（compassTargets() 里枚举全部，按 Z 循环）
				const cp = this.compassPick();
				const compass = cp ? { dir: cp.dir, dist: cp.dist, kind: cp.label, index: cp.index + 1, total: cp.total } : null;
				return {
					..._lv,
					compass, sort, edit, homeRoom: homeRoomNow,
					cards: this.cards,
					boss: (() => {
						if (this.bossRef == null) return null;
						const b = this.enemies.find((en) => en.id === this.bossRef);
						if (!b) return null;
						return { name: b.bossName ?? this.level?.boss?.name ?? 'BOSS', hp: Math.max(0, Math.round(b.hp)), maxHp: Math.round(b.maxHp), quip: this.level?.boss?.quip ?? null };
					})(),
					phase: this.phase,
					bossIntro: this.bossIntro,
					bossRoomMode: this.bossRoomMode,
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
					pendingChoices: this.pendingChoices?.length ?? 0,
					activeSkill: (() => {
						const sk = ACTIVE_SKILLS[this.activeSkillId];
						if (!sk) return null;
						return {
							id: this.activeSkillId,
							icon: sk.icon,
							iconUrl: sk.iconUrl ?? null,
							name: sk.name,
							type: sk.type ?? 'strike',
							cd: Math.max(0, this.skillCd),
							cdMax: sk.cd,
							timer: Math.max(0, this.skillTimer),
							teleportsLeft: this.teleportsLeft,
							maxTeleports: sk.maxTeleports ?? 0,
							internalCd: Math.max(0, this.laserSkillCd),
							enabled: sk.type ? this.laserSkillOn : true,
							charging: !!this.railCharge,
							purgePhase: this.purge ? this.purge.phase : null,
							purgeLeft: this.purge && this.purge.phase === 'hunt' ? Math.max(0, ACTIVE_SKILLS.purge.duration - this.purge.t) : 0,
						};
					})(),
					best: this.best,
					buffs: [
						this.isWorkActive() ? { icon: '💼', left: 0, text: '工作中 +300 防御（减伤 ' + (this.defensePower() / (this.defensePower() + 100) * 100).toFixed(1) + '%）' } : null,
						this.shieldTimer > 0 ? { icon: '🛡', left: Math.ceil(this.shieldTimer) } : null,
						this.freezeTimer > 0 ? { icon: '❄', left: Math.ceil(this.freezeTimer) } : null,
						this.chaosTimer > 0 ? { icon: '🔥', left: Math.ceil(this.chaosTimer) } : null,
						this.procmap ? (() => {
							const ph = this.procPhase();
							if (ph < 0) return null;
							if (this.cycleStartAt == null) return { icon: '☀', left: 0, text: '白天（龙飞走后开始计时）' };
							const remain = Math.max(0, Math.ceil(PROC_PHASE_SEC - ((this.elapsed - this.cycleStartAt) % PROC_PHASE_SEC)));
							return { icon: ['☀', '🌙', '🌀'][ph], left: 0, text: PROC_PHASE_NAMES[ph] + '·' + remain + 's 后变换' };
						})() : null,
					].filter(Boolean),
				};
			}
		}

		// 调试钩子：DevTools 控制台可用 __vsGameDebug 查看/操作引擎内部
		if (typeof window !== 'undefined') {
			window.__vsGameDebug = { GameEngine, ENEMY_TYPES, WEAPONS, PASSIVES };
			// 全局报错捕获：插件内任何未捕获异常都打到控制台前缀 + __vsGameLastError，方便定位
			window.addEventListener('error', (ev) => {
				try {
					const err = ev.error || ev.message;
					window.__vsGameLastError = err;
					console.error('[vs-game] 未捕获异常:', err);
				} catch {}
			});
			window.addEventListener('unhandledrejection', (ev) => {
				try {
					window.__vsGameLastError = ev.reason;
					console.error('[vs-game] 未处理的 Promise 拒绝:', ev.reason);
				} catch {}
			});
		}

		// ════════════════════════════════════════════════════════════════════
		// [8] React 组件
		// ════════════════════════════════════════════════════════════════════
		function fmtTime(s) {
			const m = Math.floor(s / 60);
			const ss = Math.floor(s % 60);
			return m + ':' + String(ss).padStart(2, '0');
		}

		/** 家里编辑模式：选中物件后的操作条 */
		function EditBar({ sel, send, onDeselect }) {
			const [confirm, setConfirm] = useState(false);
			useEffect(() => { setConfirm(false); }, [sel && sel.id]);
			if (!sel) return null;
			return hs('div', { className: 'dsh-vs-editbar', children: [
				h('span', { key: 'n', className: 'nm', children: '✏️ ' + sel.label }),
				sel.canUpgrade ? h('button', { key: 'up', className: 'dsh-vs-btn', style: { padding: '4px 10px', fontSize: 12 }, onClick: () => { send({ kind: ClientMsg.UPGRADE_CHEST, chestId: sel.id }); onDeselect(); }, children: '⬆ 升级 💎×5' }) : null,
				!confirm
					? h('button', { key: 'del', className: 'dsh-vs-btn ghost', style: { padding: '4px 10px', fontSize: 12, color: '#ff8a80' }, onClick: () => setConfirm(true), children: '🗑 拆除' })
					: h('button', { key: 'del2', className: 'dsh-vs-btn', style: { padding: '4px 10px', fontSize: 12, background: '#c62828' }, onClick: () => { send({ kind: ClientMsg.DEMOLISH_HOME_ITEM, target: sel.target, id: sel.id }); onDeselect(); }, children: '确认拆除（返还' + (sel.fullRefund ? '全额' : '50%') + '）' }),
				h('button', { key: 'x', className: 'dsh-vs-btn ghost', style: { padding: '4px 10px', fontSize: 12 }, onClick: onDeselect, children: '✖ 取消' }),
			] });
		}

		function Hud({ snap, activeLevel, character, onCycleCompass, minimal }) {
			const [showRules, setShowRules] = useState(true); // 规则表默认展开，点按钮可折叠
			// 指南针：一直显示（有目标才有内容），点一下或者按 Z 换目标
			const compassChip = snap.compass ? h('div', { key: 'compass', style: { display: 'flex', alignItems: 'center', gap: 6, width: 'max-content', maxWidth: 260, padding: '4px 8px', background: 'rgba(20,22,31,.78)', border: '1px solid #2a2e3d', borderRadius: 8, color: '#ffd54f', fontSize: 12, pointerEvents: 'auto' }, children: [
				h('span', { key: 'i', style: { fontSize: 16 }, children: '🧭' }),
				h('b', { key: 'd', style: { color: '#fff', whiteSpace: 'nowrap' }, children: snap.compass.dir + ' ' + snap.compass.dist + 'm' }),
				h('span', { key: 'k', style: { color: '#aab0c4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: snap.compass.kind }),
				h('button', {
					key: 'z',
					className: 'dsh-vs-btn ghost',
					onClick: onCycleCompass,
					title: '切换指南针指向的目标（快捷键 Z）',
					style: { padding: '2px 6px', fontSize: 11, whiteSpace: 'nowrap' },
					children: 'Z ' + (snap.compass.index ?? 1) + '/' + (snap.compass.total ?? 1),
				}),
			] }) : null;
			if (minimal) {
				// 家里只需要指南针（血量/武器这些家里用不上，别把 HUD 塞满）。
				// 但纵向位置要和关卡里一致：关卡那边上面压着 HP/XP 条 + 等级文字（10+10+15 + 3 个 4px 间距 ≈ 47px），
				// 这里用同样的 paddingTop 顶下来，免得贴在最上面被「编辑模式」按钮挡住。
				return hs('div', { className: 'dsh-vs-hud', children: [h('div', { key: 'tl', className: 'dsh-vs-hud-tl', style: { paddingTop: 47 }, children: [compassChip] })] });
			}
			return hs('div', { className: 'dsh-vs-hud', children: [
				h('div', { key: 'tl', className: 'dsh-vs-hud-tl', children: [
					h('div', { key: 'hp', className: 'dsh-vs-bar dsh-vs-hp', children: [
						h('i', { key: 'f', style: { width: Math.max(0, snap.hp / snap.maxHp * 100) + '%' } }),
					] }),
					h('div', { key: 'xp', className: 'dsh-vs-bar dsh-vs-xp', children: [
						h('i', { key: 'f', style: { width: Math.min(100, snap.xp / snap.xpNeed * 100) + '%' } }),
					] }),
					h('div', { key: 'lv', style: { color: '#8a8fa3', fontSize: 11 }, children: 'Lv.' + snap.level + '  HP ' + snap.hp + '/' + snap.maxHp }),
					snap.sort ? h('div', { key: 'sortbox', style: { display: 'flex', flexDirection: 'column', gap: 3, width: 'max-content', flexShrink: 0, alignSelf: 'flex-start', padding: '6px 9px', background: 'rgba(20,22,31,.82)', border: '1px solid #2a2e3d', borderRadius: 8, fontSize: 11, lineHeight: 1.35, color: '#aab0c4' }, children: [
						h('div', { key: 'p', style: { color: '#ffd54f', fontWeight: 700, fontSize: 12 }, children: '🗂 已归档 ' + snap.sort.done + '/' + snap.sort.need }),
						h('div', { key: 'c', style: { color: snap.sort.carried ? '#8fe3f2' : '#5c6273' }, children: snap.sort.carried ? ('📄 携带：' + snap.sort.carried) : '📄 空手：打死文件怪捡文件' }),
						snap.sort.agents ? h('div', { key: 'ag', style: { color: snap.sort.agents.dispatched ? '#8ef2a8' : '#5c6273' }, children: '👥 子代理 ' + (snap.sort.agents.dispatched ? snap.sort.agents.alive + ' 只在搬（自动派出）' : '准备中…') }) : null,
						h('button', {
							key: 'ruleBtn',
							onClick: () => setShowRules((v) => !v),
							style: { pointerEvents: 'auto', marginTop: 2, padding: '3px 8px', background: '#1c1f2b', color: '#cfd3e4', border: '1px solid #2a2e3d', borderRadius: 6, fontSize: 11, cursor: 'pointer', textAlign: 'left' },
							children: showRules ? '📋 归档规则表 ▾' : '📋 归档规则表 ▸',
						}),
						showRules ? h('table', { key: 't', style: { borderCollapse: 'collapse', marginTop: 3, fontSize: 10, fontFamily: 'ui-monospace,monospace' }, children: [
							h('thead', { key: 'h', children: h('tr', { key: 'r', children: [
								h('th', { key: 'e', style: { textAlign: 'left', paddingRight: 8, paddingBottom: 1, color: '#5c6273', fontWeight: 400 }, children: '散落文件' }),
								h('th', { key: 'f', style: { textAlign: 'left', paddingBottom: 1, color: '#5c6273', fontWeight: 400 }, children: '目标箱' }),
							] }) }),
							h('tbody', { key: 'b', children: snap.sort.rules.map((r, i) => h('tr', { key: i, children: [
								h('td', { key: 'e', style: { paddingRight: 8, whiteSpace: 'nowrap', color: '#8a8fa3' }, children: r.exts.join(' ') }),
								h('td', { key: 'f', style: { color: '#e6e8f0', fontWeight: 700, whiteSpace: 'nowrap' }, children: '→ ' + r.label }),
							] })) }),
						] }) : null,
					] }) : null,
					compassChip,   // 指南针一直开着（整理工作区那种带规则表的关卡也显示）
				] }),
				snap.levelName ? h('div', { key: 'tc', className: 'dsh-vs-hud-tc', children: (snap.levelChapter ? '第 ' + snap.levelChapter + ' 章 · ' : '') + snap.levelName }) : null,
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

		/** 手册弹窗：解释家里已经解锁的道具 */
		function ManualModal({ character, onClose }) {
			const cleared = new Set(character?.clearedLevels ?? []);
			const inv = new Set(character?.inventory ?? []);
			const chests = character?.chests ?? [];
			const entries = [
				{ icon: '👤', name: '人物界面', desc: '查看背包、装备、被动和当前主动技能。' },
				{ icon: '📚', name: '图鉴 / 书架', desc: '查看武器、被动、合成配方和已经遇到的敌人。' },
				{ icon: '⚒️', name: '合成台', desc: '把材料放进法阵合成道具；技能碎片可以合成技能书。' },
				{ icon: '🖼️', name: '画廊', desc: '查看已经通关解锁的章节插画。' },
				{ icon: '🚪', name: '房间 / 出门', desc: '进入黑白房间，或者选择关卡、无尽模式出门工作。' },
			];
			if (cleared.has('furious-user')) entries.push({ icon: '🛒', name: '工作区', desc: '购买和出售材料、唱片、技能碎片。' });
			if (inv.has('wooden-chest') || chests.some((c) => c?.kind === 'chest')) entries.push({ icon: '📦', name: '木制宝箱', desc: '放置后作为 5 格储物箱使用，长按 F 可拆除。' });
			if (inv.has('record-player') || chests.some((c) => c?.kind === 'record-player')) entries.push({ icon: '🎵', name: '唱片机', desc: '放置后放入唱片播放 BGM；部分唱片有黑白房彩蛋。' });
			entries.push({ icon: '📖', name: '手册', desc: '就是你正在看的这本书，之后新增家里道具也会写在这里。' });
			return hs('div', { className: 'dsh-vs-pedia', onClick: (e) => { if (e.target === e.currentTarget) onClose(); }, children: [
				hs('div', { key: 'box', className: 'dsh-vs-pedia-box', children: [
					hs('div', { key: 'head', className: 'dsh-vs-pedia-head', children: [
						h('div', { key: 't', children: '📖 手册 · 家里的道具' }),
						h('button', { key: 'c', className: 'dsh-vs-pedia-close', onClick: onClose, children: '✕' }),
					] }),
					hs('div', { key: 'body', className: 'dsh-vs-pedia-body', children: entries.map((e, i) =>
						hs('div', { key: i, className: 'dsh-vs-pedia-card', children: [
							h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: e.icon }), h('span', { key: 'n', children: e.name })] }),
							h('div', { key: 'd', className: 'pd', children: e.desc }),
						] })) }),
				] }),
			] });
		}

		/** 图鉴弹窗：武器 + 怪物（怪物需遇到解锁） */
		function PediaModal({ snap, tab, setTab, onClose, character, levels }) {
			const discovered = new Set(snap?.discovered ?? []);
			const inv = new Set(character?.inventory ?? []);
			const weaponCards = Object.keys(WEAPONS).map((t) => {
				const w = WEAPONS[t];
				const d = WEAPON_DETAILS[t] || { levels: [], evolve: '' };
				const evo = EVOLUTIONS[t];
				return { type: t, icon: w.icon, name: w.name, desc: w.desc, levels: d.levels, evolve: d.evolve, evoName: evo?.name, evoIcon: evo?.icon, evoPassive: evo ? PASSIVES[evo.passive]?.name : '' };
			});
			const enemyCards = Object.keys(ENEMY_TYPES).map((t) => ({ type: t, ...ENEMY_TYPES[t], name: ENEMY_NAMES[t], desc: ENEMY_DETAILS[t] || '', move: ENEMY_MOVES[t] || '' }));
			let body;
			if (tab === 'weapon') {
				body = weaponCards.map((w) =>
					hs('div', { key: w.type, className: 'dsh-vs-pedia-card', children: [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: w.icon }), h('span', { key: 'n', children: w.name })] }),
						h('div', { key: 'd', className: 'pd', children: w.desc }),
						h('div', { key: 'l', className: 'pl', children: 'Lv1 ' + (w.levels[0] ?? '') + '\nLv2 ' + (w.levels[1] ?? '') + '\nLv3 ' + (w.levels[2] ?? '') + '\nLv4 ' + (w.levels[3] ?? '') }),
						h('div', { key: 'e', className: 'pe', children: '进化：' + (w.evoIcon ?? '') + ' ' + (w.evoName ?? '') + '（' + (w.evoPassive ?? '') + '）——' + (w.evolve || '') }),
					]}));
			} else if (tab === 'craft') {
				body = CRAFT_RECIPES.map((r) => {
					const meta = itemMeta(r.product);
					const need = Object.entries(r.need).map(([item, n]) => itemMeta(item).name + ' ×' + n).join(' + ');
					return hs('div', { key: r.product, className: 'dsh-vs-pedia-card', children: [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: meta.icon }), h('span', { key: 'n', children: meta.name })] }),
						h('div', { key: 'd', className: 'pd', children: need + ' → ' + meta.name }),
						h('div', { key: 'e', className: 'pe', children: meta.desc || '' }),
					] });
				});
			} else if (tab === 'boss') {
				// Boss 页：第一张卡片放「精英怪规则」，后面是各关 Boss + 不在关卡表里的两只
				const eliteCard = hs('div', { key: 'elite-rules', className: 'dsh-vs-pedia-card', children: [
					h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: '⭐' }), h('span', { key: 'n', children: '精英怪 · 通用规则' })] }),
					h('div', { key: 'st', className: 'pd', children: '血量 ×20 · 移速 ×1.4（近战精英 ×1.8） · 经验 ×3' }),
					h('div', { key: 'd', className: 'pd', children: '精英一出现就解锁自己的招牌招式（普通怪要等开场 10~40 秒才逐渐学会），招式范围和弹幕数量也更强；40 级之后近战精英的血量和移速还会再翻一倍。' }),
					h('div', { key: 'em', className: 'pd', children: '掉落：经验宝石 ×3，另有更高概率掉素材/装备；守箱精英与营地精英同样按这套规则。' }),
				] });
				const levelBossCards = (levels ?? []).filter((lv) => lv?.boss && lv.id).map((lv) => {
					const b = lv.boss;
					const info = BOSS_PEDIA[lv.id] ?? { icon: '👑', how: '直线追击 + 环形报错弹幕，注意走位。' };
					const unlocked = discovered.has('boss:' + lv.id);
					const loot = Array.isArray(lv.bossRoom?.loot) && lv.bossRoom.loot.length
						? '通关宝箱：' + lv.bossRoom.loot.map((x) => itemMeta(x.item).name + (x.count > 1 ? ' ×' + x.count : '')).join('、')
						: '通关宝箱：翻卡奖励（选一张带走）';
					const clearGold = lv.firstClearGold ? ' · 首次通关 ' + lv.firstClearGold + ' token' : '';
					return hs('div', { key: 'boss-' + lv.id, className: 'dsh-vs-pedia-card' + (unlocked ? '' : ' locked'), children: unlocked ? [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: info.icon }), h('span', { key: 'n', children: b.name })] }),
						h('div', { key: 'st', className: 'pd', children: '第 ' + (lv.chapter ?? '-') + ' 章「' + (lv.name ?? '') + '」 · 血量 ' + b.hp + ' · 体型 ' + (b.size ?? 34) + ' · 速度 ' + (b.speed ?? 36) + ' · 经验 ' + (b.xp ?? 30) }),
						b.quip ? h('div', { key: 'q', className: 'pe', children: b.quip }) : null,
						h('div', { key: 'd', className: 'pd', children: info.how }),
						h('div', { key: 'dr', className: 'pd', children: '掉落：' + loot + clearGold }),
					] : [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: '❓' }), h('span', { key: 'n', children: '未遇见' })] }),
						h('div', { key: 'd', className: 'pd', children: '打到第 ' + (lv.chapter ?? '?') + ' 章的 Boss 房就会解锁' }),
					] });
				});
				const extraCards = BOSS_EXTRA.map((e) => {
					const unlocked = discovered.has('boss:' + e.id);
					return hs('div', { key: 'boss-' + e.id, className: 'dsh-vs-pedia-card' + (unlocked ? '' : ' locked'), children: unlocked ? [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: e.icon }), h('span', { key: 'n', children: e.name })] }),
						h('div', { key: 'st', className: 'pd', children: e.from }),
						h('div', { key: 'd', className: 'pd', children: e.how }),
						h('div', { key: 'dr', className: 'pd', children: '掉落：' + e.drop }),
					] : [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: '❓' }), h('span', { key: 'n', children: '未遇见' })] }),
						h('div', { key: 'd', className: 'pd', children: '遇到之后解锁：' + e.from }),
					] });
				});
				body = [eliteCard].concat(levelBossCards, extraCards);
			} else {
				body = enemyCards.map((e) => {
					const unlocked = discovered.has(e.type);
					return hs('div', { key: e.type, className: 'dsh-vs-pedia-card' + (unlocked ? '' : ' locked'), children: unlocked ? [
						h('div', { key: 'ph', className: 'ph', children: [h('span', { key: 'i', children: e.label }), h('span', { key: 'n', children: e.name })] }),
						h('div', { key: 'st', className: 'pd', children: 'HP ' + e.hp + ' · 速度 ' + e.speed + ' · 经验 ' + e.xp }),
						h('div', { key: 'd', className: 'pd', children: e.desc }),
						e.move ? h('div', { key: 'mv', className: 'pd', children: '招式：' + e.move }) : null,
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
						h('button', { key: 'boss', className: 'dsh-vs-pedia-tab' + (tab === 'boss' ? ' on' : ''), onClick: () => setTab('boss'), children: '👑 Boss' }),
						h('button', { key: 'craft', className: 'dsh-vs-pedia-tab' + (tab === 'craft' ? ' on' : ''), onClick: () => setTab('craft'), children: '⚒ 合成' }),
					] }),
					hs('div', { key: 'body', className: 'dsh-vs-pedia-body', children: body }),
				] }),
				] });
		}

		/**
		 * 世界层的小提示牌：「F 捡起白饭」「F 对话」共用（黑底 + 黄框 + 黄字）。
		 * (x, bottomY) = 牌子底边中点。
		 */
		function drawKeyPrompt(c, x, bottomY, label) {
			c.save();
			c.font = 'bold 13px system-ui,sans-serif';
			c.textAlign = 'center'; c.textBaseline = 'middle';
			const tw = c.measureText(label).width + 18;
			c.fillStyle = 'rgba(16,18,26,.92)';
			c.fillRect(x - tw / 2, bottomY - 24, tw, 24);
			c.strokeStyle = 'rgba(255,213,79,.9)'; c.lineWidth = 1.5;
			c.strokeRect(x - tw / 2, bottomY - 24, tw, 24);
			c.fillStyle = '#ffd54f';
			c.fillText(label, x, bottomY - 12);
			c.restore();
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

		/** 画廊：通关解锁对应章节插画 */
		function GalleryModal({ levels, character, onClose }) {
			const cleared = new Set(character?.clearedLevels ?? []);
			const arts = (levels ?? []).filter((lv) => lv.story?.artPost);
			return hs('div', {
				className: 'dsh-vs-gallery',
				onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
				children: [
					hs('div', { key: 'box', className: 'dsh-vs-gallery-box', children: [
						hs('div', { key: 'head', className: 'dsh-vs-gallery-head', children: [
							h('div', { key: 't', children: '🖼 画廊' }),
							h('button', { key: 'c', className: 'dsh-vs-pedia-close', onClick: onClose, children: '✕' }),
						] }),
						hs('div', { key: 'grid', className: 'dsh-vs-gallery-grid', children: arts.map((lv) => {
							const unlocked = cleared.has(lv.id);
							return hs('div', { key: lv.id, className: 'dsh-vs-gallery-card' + (unlocked ? '' : ' locked'), children: [
								unlocked
									? IMG({ key: 'i', src: '/vs-game/' + lv.story.artPost, alt: lv.name })
									: h('div', { key: 'i', style: { height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0c12', borderRadius: 8 }, children: '🔒' }),
								h('div', { key: 'n', className: 'gname', children: lv.name }),
								h('div', { key: 's', className: 'glock', children: unlocked ? '已解锁' : '通关后解锁' }),
							] });
						}) }),
					] }),
				] });
		}

		/** 出门面板：选择关卡模式或无尽模式 */
		function DoorPanel({ onLevel, onEndless, onClose }) {
			return hs('div', { className: 'dsh-vs-cover', children: [
				h('h2', { key: 'h', children: '🚪 出门' }),
				h('div', { key: 'sub', className: 'sub', children: '今天要出去上班，还是在家随便打打？' }),
				h('button', { key: 'l', className: 'dsh-vs-btn', onClick: onLevel, children: '💼 上班去（关卡）' }),
				h('button', { key: 'e', className: 'dsh-vs-btn ghost', onClick: onEndless, children: '🪙 随便打打（无尽）' }),
				h('button', { key: 'c', className: 'dsh-vs-btn ghost', onClick: onClose, children: '先不出门' }),
			] });
		}

		/** 合成仪：左边背包格子，右边环形放置区（上限11个），关闭后物品显示在家里的法阵上 */
		function CraftModal({ character, placed, onChange, onStart, onClose }) {
			const inventory = Array.isArray(character?.inventory) ? character.inventory : [];
			const placedCounts = new Map();
			for (const it of placed) placedCounts.set(it, (placedCounts.get(it) ?? 0) + 1);
			const totals = new Map();
			for (const it of inventory) totals.set(it, (totals.get(it) ?? 0) + 1);
			const leftRows = bagEntriesStable(inventory);
			const itemTip = useContext(ItemTipContext);
			const tipProps = (item) => ({
				onMouseEnter: (e) => itemTip.show(item, e),
				onMouseMove: (e) => itemTip.move(e),
				onMouseLeave: () => itemTip.hide(),
			});
			const add = (item) => {
				if (placed.length >= 11) return;
				const total = totals.get(item) ?? 0;
				if (total > 0) onChange([...placed, item]);
			};
			const remove = (index) => {
				const next = [...placed];
				next.splice(index, 1);
				onChange(next);
			};
			const ringStyle = (i, total) => {
				const angle = (i / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
				return { position: 'absolute', left: '50%', top: '50%', zIndex: 2, transform: 'translate(' + (Math.cos(angle) * 58) + 'px,' + (Math.sin(angle) * 58) + 'px) translate(-50%,-50%)', width: 38, height: 38, background: 'rgba(20,22,31,.85)', border: '1px solid #9d6bff', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
			};
			return hs('div', { className: 'dsh-vs-cover', children: [
				hs('div', { key: 'panel', style: { width: 720, minHeight: 460, background: '#0e1017', border: '2px solid #4f6ef7', borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }, children: [
					h('h2', { key: 'h', children: '⚒️ 合成仪式' }),
					hs('div', { key: 'body', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, minHeight: 300 }, children: [
						hs('div', { key: 'left', style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }, children: [
							h('div', { key: 'lh', className: 'sub', children: '背包（点击放入）' }),
							hs('div', { key: 'grid', className: 'dsh-vs-inv', style: { maxHeight: 280, overflowY: 'auto' }, children: leftRows.map((r) => {
								if (!r.count) return h('div', { key: r.slot, className: 'dsh-vs-item empty' });
								return h('div', { key: r.slot, className: 'dsh-vs-item', ...tipProps(r.item), onClick: () => add(r.item), children: [
									r.meta.iconUrl ? IMG({ key: 'i', className: 'dsh-vs-item-img', src: r.meta.iconUrl, alt: r.meta.name }) : h('div', { key: 'i', className: 'dsh-vs-item-icon', children: r.meta.icon }),
									r.count > 1 ? h('div', { key: 'c', className: 'dsh-vs-item-count', children: '×' + r.count }) : null,
									h('div', { key: 'n', className: 'dsh-vs-item-name', children: r.meta.name }),
								] });
							}) }),
						] }),
						hs('div', { key: 'right', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 0 }, children: [
							h('div', { key: 'rh', className: 'sub', children: '环形放置区 ' + placed.length + ' / 11' }),
							hs('div', { key: 'ring', style: { position: 'relative', width: 190, height: 190, background: 'rgba(20,22,31,.4)', border: '1px dashed #7c5cfc', borderRadius: '50%', overflow: 'visible' }, children: [
								...Array.from({ length: 11 }, (_, i) => {
									const item = placed[i];
									return h('div', { key: i, ...(item ? tipProps(item) : {}), onClick: () => { if (item) remove(i); }, title: item ? '点击取回' : '', style: ringStyle(i, 11), children: item ? (() => { const meta = itemMeta(item); return meta.iconUrl ? IMG({ key: 'ii', src: meta.iconUrl, style: { width: 26, height: 26, imageRendering: 'pixelated' } }) : h('span', { key: 'ic', style: { fontSize: 20 }, children: meta.icon }); })() : null });
								}),
								h('button', { key: 'start', onClick: onStart, style: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 3, width: 70, height: 70, borderRadius: '50%', background: '#1c2a5e', border: '2px solid #40c4ff', color: '#fff', fontWeight: 700, cursor: 'pointer' }, children: '合成' }),
							] }),
							h('div', { key: 'tip', className: 'sub', children: '关闭后物品会显示在家里的法阵上，再点法阵开始仪式' }),
						] }),
					] }),
					h('button', { key: 'close', className: 'dsh-vs-btn ghost', onClick: onClose, children: '关闭' }),
				] }),
			] });
		}

				/** 长按宝箱：打开 / 拆除 */
		function ChestActionModal({ onOpen, onRemove, onUpgrade, canUpgrade, upgradeLabel, onClose, title = '📦 木制宝箱', removeLabel = '拆除（返还 1 木材）' }) {
			return hs('div', { className: 'dsh-vs-cover', children: [
				hs('div', { key: 'panel', style: { width: 280, background: '#0e1017', border: '2px solid #8a6b3d', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }, children: [
					h('div', { key: 't', style: { fontWeight: 700, textAlign: 'center' }, children: title }),
					h('button', { key: 'o', className: 'dsh-vs-btn', onClick: onOpen, children: '打开' }),
					onUpgrade ? h('button', { key: 'u', className: 'dsh-vs-btn' + (canUpgrade ? '' : ' ghost'), disabled: !canUpgrade, onClick: canUpgrade ? onUpgrade : undefined, children: upgradeLabel ?? '升级' }) : null,
					h('button', { key: 'r', className: 'dsh-vs-btn ghost', onClick: onRemove, children: removeLabel }),
					h('button', { key: 'c', className: 'dsh-vs-btn ghost', onClick: onClose, children: '取消' }),
				] }),
			] });
		}

				/** 唱片机：左侧唱片，右侧一个播放槽 */
		function RecordPlayerModal({ character, index, send, onPlay, onPause, onResume, onStop, getRecordState, onClose }) {
			const container = (character?.chests ?? [])[index];
			const slot = container?.slots?.[0] ?? null;
			const entries = bagEntriesStable(character?.inventory ?? []);
			const playable = slot && slot.item ? itemMeta(slot.item) : null;
			const readState = () => {
				const st = getRecordState ? getRecordState() : { chestId: null, item: null, paused: false };
				const same = !!(slot && container && st.chestId === container.id && st.item === slot.item);
				return { started: same, paused: same && !!st.paused };
			};
			const [started, setStarted] = useState(() => readState().started);
			const [paused, setPaused] = useState(() => readState().paused);
			useEffect(() => { const st = readState(); setStarted(st.started); setPaused(st.paused); }, [slot?.item, container?.id]);
			const toggle = () => {
				if (!playable || !container) return;
				if (!started) { onPlay(slot.item, container.id); setStarted(true); setPaused(false); }
				else if (paused) { onResume(); setPaused(false); }
				else { onPause(); setPaused(true); }
			};
			return hs('div', { className: 'dsh-vs-cover', children: [
				hs('div', { key: 'panel', style: { width: 620, minHeight: 420, background: '#0e1017', border: '2px solid #8a6b3d', borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }, children: [
					h('h2', { key: 'h', children: '🎵 唱片机' }),
					hs('div', { key: 'body', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }, children: [
						hs('div', { key: 'left', style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
							h('div', { key: 'lh', className: 'sub', children: '背包（点击放入唱片）' }),
							hs('div', { key: 'grid', className: 'dsh-vs-inv', style: { maxHeight: 260, overflowY: 'auto' }, children: entries.map((r) => {
								if (!r.count || !r.meta || r.meta.type !== 'record') return h('div', { key: r.slot, className: 'dsh-vs-item empty' });
								return h('div', { key: r.slot, className: 'dsh-vs-item', onClick: () => { if (container && !(container.slots ?? []).some((x) => x && x.item)) send({ kind: ClientMsg.CHEST_TRANSFER, chestId: container.id, direction: 'in', item: r.item }); }, title: r.meta.name, children: [
									r.meta.iconUrl ? IMG({ key: 'i', className: 'dsh-vs-item-img', src: r.meta.iconUrl, alt: r.meta.name }) : h('div', { key: 'i', className: 'dsh-vs-item-icon', children: r.meta.icon }),
									r.count > 1 ? h('div', { key: 'c', className: 'dsh-vs-item-count', children: '×' + r.count }) : null,
									h('div', { key: 'n', className: 'dsh-vs-item-name', children: r.meta.name }),
								] });
							}) }),
						] }),
						hs('div', { key: 'right', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }, children: [
							h('div', { key: 'rh', className: 'sub', children: '播放槽' }),
							h('div', { key: 'slot', className: 'dsh-vs-item' + (slot ? ' use' : ' empty'), onClick: () => { if (slot && container) { onStop(); send({ kind: ClientMsg.CHEST_TRANSFER, chestId: container.id, direction: 'out', slot: 0 }); } }, style: { width: 72, height: 72 }, children: playable ? [
								playable.iconUrl ? IMG({ key: 'i', className: 'dsh-vs-item-img', src: playable.iconUrl, alt: playable.name }) : h('div', { key: 'i', className: 'dsh-vs-item-icon', children: playable.icon }),
								h('div', { key: 'n', className: 'dsh-vs-item-name', children: playable.name }),
							] : null }),
							h('button', { key: 'play', className: 'dsh-vs-btn', disabled: !playable, onClick: toggle, children: !started ? '播放' : (paused ? '继续' : '暂停') }),
							h('div', { key: 'tip', className: 'sub', children: '播放结束后唱片会掉到地上' }),
						] }),
					] }),
					h('button', { key: 'close', className: 'dsh-vs-btn ghost', onClick: onClose, children: '关闭' }),
				] }),
			] });
		}

				/** 木制宝箱：左边背包，右边 5 格储物 */
		function ChestModal({ character, index, send, onClose }) {
			const inv = Array.isArray(character?.inventory) ? character.inventory : [];
			const chest = (character?.chests ?? [])[index];
			const kind = chest?.kind ?? 'chest';
			const isEnder = kind === 'ender-chest';
			const isDiamond = kind === 'diamond-chest' || (!isEnder && (chest?.slots?.length ?? 0) > 5);
			const cap = isEnder ? 30 : isDiamond ? 25 : 5;
			const cols = cap % 6 === 0 ? 6 : 5;
			const slots = Array.isArray(chest?.slots) ? chest.slots : Array.from({ length: cap }, () => null);
			const bagRows = bagEntriesStable(inv);
			const itemTip = useContext(ItemTipContext);
			const tipProps = (item) => ({
				onMouseEnter: (e) => itemTip.show(item, e),
				onMouseMove: (e) => itemTip.move(e),
				onMouseLeave: () => itemTip.hide(),
			});
			return hs('div', { className: 'dsh-vs-cover', children: [
				hs('div', { key: 'panel', style: { width: 660, minHeight: 420, background: '#0e1017', border: '2px solid #8a6b3d', borderRadius: 18, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }, children: [
					h('h2', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 8 }, children: isEnder ? [IMG({ key: 'i', src: '/vs-game/assets/items/mv/ender-chest.png', alt: '', style: { width: 32, height: 32, imageRendering: 'pixelated' } }), '末影箱（30 格）'] : isDiamond ? [IMG({ key: 'i', src: '/vs-game/assets/items/mv/chest-blue.png', alt: '', style: { width: 32, height: 32, imageRendering: 'pixelated' } }), '钻石宝箱'] : '📦 木制宝箱' }),
					hs('div', { key: 'body', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }, children: [
						hs('div', { key: 'left', style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
							h('div', { key: 'lh', className: 'sub', children: '背包（点击存入）' }),
							hs('div', { key: 'grid', className: 'dsh-vs-inv', style: { maxHeight: 260, overflowY: 'auto' }, children: bagRows.map((r) => {
								if (!r.count) return h('div', { key: r.slot, className: 'dsh-vs-item empty' });
								return h('div', { key: r.item, className: 'dsh-vs-item', ...tipProps(r.item), onClick: () => { if (chest) send({ kind: ClientMsg.CHEST_TRANSFER, chestId: chest.id, direction: 'in', item: r.item }); }, children: [
									r.meta.iconUrl ? IMG({ key: 'i', className: 'dsh-vs-item-img', src: r.meta.iconUrl, alt: r.meta.name }) : h('div', { key: 'i', className: 'dsh-vs-item-icon', children: r.meta.icon }),
									r.count > 1 ? h('div', { key: 'c', className: 'dsh-vs-item-count', children: '×' + r.count }) : null,
									h('div', { key: 'n', className: 'dsh-vs-item-name', children: r.meta.name }),
								] });
							}) }),
						] }),
						hs('div', { key: 'right', style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
							h('div', { key: 'rh', className: 'sub', children: '箱子（点击取出）' + cap + ' 格' }),
							hs('div', { key: 'slots', style: { display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', 1fr)', gap: 8 }, children: slots.map((slot, i) => {
								const meta = slot && slot.item ? itemMeta(slot.item) : null;
								return h('div', { key: i, className: 'dsh-vs-item' + (slot ? ' use' : ' empty'), ...(slot && slot.item ? tipProps(slot.item) : {}), onClick: () => { if (slot) send({ kind: ClientMsg.CHEST_TRANSFER, chestId: chest.id, direction: 'out', slot: i }); }, children: meta ? [
									meta.iconUrl ? IMG({ key: 'i', className: 'dsh-vs-item-img', src: meta.iconUrl, alt: meta.name }) : h('div', { key: 'i', className: 'dsh-vs-item-icon', children: meta.icon }),
									(Number(slot.count) || 1) > 1 ? h('div', { key: 'c', className: 'dsh-vs-item-count', children: '×' + slot.count }) : null,
									h('div', { key: 'n', className: 'dsh-vs-item-name', children: meta.name }),
								] : null });
							}) }),
						] }),
					] }),
					h('button', { key: 'close', className: 'dsh-vs-btn ghost', onClick: onClose, children: '关闭' }),
				] }),
			] });
		}

				/** 工作区：购买/卖出标签页，左侧物品列表可滚动，右侧显示数量并确认交易 */
		/** 子代理管理台：招募（第 n 个 n×10000 金，最多 5 个）+ 给每个子代理派活 */
		function AgentHubModal({ character, send, onClose }) {
			const agents = Math.max(0, Math.min(5, Math.floor(Number(character?.agents) || 0)));
			const tasks = Array.isArray(character?.agentTasks) ? character.agentTasks : [];
			const gold = Number(character?.gold) || 0;
			const price = (agents + 1) * 10000;
			const maxed = agents >= 5;
			const canHire = !maxed && gold >= price;
			const TASK_OPTS = [['idle', '随意'], ['tree-farm', '树场'], ['mine', '矿场']];
			const taskOf = (i) => (tasks[i] === 'tree-farm' || tasks[i] === 'mine' ? tasks[i] : 'idle');
			const chip = (label, value, color) => hs('div', { key: label, style: { border: '1px solid #2b3555', borderRadius: 8, padding: '5px 10px', background: 'rgba(16,19,29,.8)', fontSize: 12, whiteSpace: 'nowrap' }, children: [
				h('span', { key: 'l', style: { color: '#8a8fa3' }, children: label + ' ' }),
				h('span', { key: 'v', style: { color, fontFamily: 'ui-monospace,monospace' }, children: value }),
			] });
			const row = (i) => hs('div', { key: 'a' + i, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(10,12,18,.65)', border: '1px solid #2a2e3d' }, children: [
				IMG({ key: 'i', src: '/vs-game/assets/sub-agent/idle.png', alt: '', style: { width: 30, height: 30, imageRendering: 'pixelated', objectFit: 'contain', flex: '0 0 auto' } }),
				h('span', { key: 'n', style: { fontWeight: 700 }, children: '子代理 #' + (i + 1) }),
				h('span', { key: 'sp', style: { flex: 1 } }),
				...TASK_OPTS.map(([k, label]) => h('button', {
					key: k,
					className: 'dsh-vs-btn' + (taskOf(i) === k ? '' : ' ghost'),
					style: { padding: '4px 10px', fontSize: 12, whiteSpace: 'nowrap' },
					onClick: () => send({ kind: ClientMsg.SET_AGENT_TASK, index: i, task: k }),
					children: label,
				})),
			] });
			return hs('div', { className: 'dsh-vs-cover', children: [
				hs('div', { key: 'p', style: { position: 'relative', width: 560, minHeight: 380, borderRadius: 18, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10, color: '#e6e8f0', border: '2px solid #2b3555', background: 'linear-gradient(#12151f,#0b0d14)', boxShadow: 'inset 0 0 0 2px #0a0c12, 0 20px 60px rgba(0,0,0,.7)' }, children: [
					hs('div', { key: 'ttl', style: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15 }, children: [
						h('span', { key: 'i', children: '📋' }),
						h('span', { key: 'n', children: '子代理管理台' }),
						h('span', { key: 'bar', style: { flex: 1, height: 1, background: 'linear-gradient(90deg,#2b3555,transparent)' } }),
						h('button', { key: 'x', className: 'dsh-vs-btn ghost', style: { padding: '2px 10px', fontSize: 12, whiteSpace: 'nowrap' }, onClick: onClose, children: '✖' }),
					] }),
					h('div', { key: 'tip', className: 'sub', style: { fontSize: 11, color: '#8a8fa3', textAlign: 'left', maxWidth: 'none' }, children: '第 n 个子代理需要 n×10000 token（最多 5 个）。派去树场/矿场后它们会自己过去上班，每 6~8 秒帮你收一次。' }),
					hs('div', { key: 'foot', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }, children: [
						chip('已招募', agents + ' / 5', '#8fe3f2'),
						chip('token', String(gold), '#ffd54f'),
						chip('下一个', maxed ? '已满' : String(price), canHire ? '#7fe08a' : '#ff8a80'),
						h('span', { key: 'sp', style: { flex: 1 } }),
						h('button', { key: 'hire', className: 'dsh-vs-btn', style: { whiteSpace: 'nowrap', ...(canHire ? {} : { opacity: .45, cursor: 'not-allowed' }) }, onClick: () => { if (canHire) send({ kind: ClientMsg.HIRE_AGENT }); }, children: maxed ? '已满 5 个' : '🤖 招募（' + price + ' 金）' }),
					] }),
					hs('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }, children: agents === 0
						? [h('div', { key: 'empty', style: { color: '#5f657a', fontSize: 12, padding: '18px 0', textAlign: 'center' }, children: '还没有子代理，先花 10000 token招一个' })]
						: Array.from({ length: agents }, (_, i) => row(i)) }),
				] }),
			] });
		}

		/** 饰品强化台：三角槽位（上基底 / 左下耗材 / 右下幸运石）+ 下方背包（方案 B · 简洁版） */
		function EnchantModal({ character, onLoad, onClose }) {
			const inv = Array.isArray(character?.inventory) ? character.inventory : [];
			const counts = new Map();
			for (const it of inv) counts.set(it, (counts.get(it) ?? 0) + 1);
			const accs = [...counts.entries()].filter(([it]) => String(it).startsWith('acc-')).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
			// 耗材候选：饰品基底 + 钓上来的鱼（鱼带 1 条随机属性，强化时写进孔）
			const mats = [...counts.entries()].filter(([it]) => /^(acc-|fish-)/.test(String(it))).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
			const [base, setBase] = useState(null);
			const [mat, setMat] = useState(null);
			const [lucky, setLucky] = useState(0);
			// 悬停冒牌：和背包里一样的物品卡
			const itemTip = useContext(ItemTipContext);
			const tipProps = (it) => (it ? { onMouseEnter: (e) => itemTip.show(it, e), onMouseMove: (e) => itemTip.move(e), onMouseLeave: () => itemTip.hide() } : {});
			const baseMeta = base ? itemMeta(base) : null;
			const baseInfo = base ? describeItem(base) : null;
			const sockets = baseMeta ? (QUALITY[baseMeta.quality]?.sockets ?? 1) : 0;
			const embedded = base ? accEmbedded(base) : 0;
			const baseRate = Math.max(0, 1 - embedded * 0.1);   // 基础成功率 100/90/80…%
			const need = 2 * Math.pow(2, embedded);              // 本孔耗时（秒），不封顶
			const stoneOwned = counts.get(LUCKY_STONE) ?? 0;
			const stoneMax = base ? Math.min(stoneOwned, Math.round((1 - baseRate) * 10)) : 0;  // 拉满 100% 所需颗数
			const stoneUse = Math.min(lucky, stoneMax);
			const rate = Math.min(1, baseRate + 0.1 * stoneUse);  // 每颗 +10%，总上限 100%
			const full = !!base && embedded >= sockets;
			const ok = !!(base && mat && (mat !== base || (counts.get(base) ?? 0) >= 2) && !full);
			const selOf = (it) => (it === base ? 'base' : it === mat ? 'mat' : it === LUCKY_STONE && stoneUse > 0 ? 'gem' : null);
			/** 幸运石：点一下 +1 颗，加满后再点归零 */
			const cycleStone = () => { if (!base || stoneMax <= 0) return; setLucky((l) => { const cur = Math.min(l, stoneMax); return cur >= stoneMax ? 0 : cur + 1; }); };
			const entries = mats.concat(stoneOwned > 0 ? [[LUCKY_STONE, stoneOwned]] : []);
			/** 背包点一下：先填基底，再填耗材（同一个自己点第二下 = 取消） */
			const pick = (it) => {
				if (it === LUCKY_STONE) { cycleStone(); return; }
				if (it === base) { if ((counts.get(it) ?? 0) >= 2) setMat(mat === it ? null : it); else setBase(null); return; }
				if (it === mat) { setMat(null); return; }
				if (!base) { if (String(it).startsWith('fish-')) return;   // 鱼只能当耗材，不能当基底
					setBase(it); return; }
				setMat(it);
			};
			/** 槽位：空 = 虚线灰槽，满 = 实线彩槽；幸运石没有就点不了 */
			const slotBox = (which) => {
				const isGem = which === 'gem';
				const it = which === 'base' ? base : which === 'mat' ? mat : stoneUse > 0 ? LUCKY_STONE : null;
				const meta = it ? itemMeta(it) : null;
				const locked = isGem && (!base || stoneMax <= 0);
				const accent = which === 'base' ? '#f5c451' : which === 'mat' ? '#7fe08a' : '#c3a6ff';
				const edge = which === 'base' ? '#6d5a29' : which === 'mat' ? '#3f6b46' : '#4b3a6b';
				const tag = which === 'base' ? '基底 · 不消耗' : which === 'mat' ? '耗材 · 消耗' : '幸运石 · 消耗';
				const big = which === 'base' ? 118 : 104;
				const caption = isGem ? (stoneUse > 0 ? ('+' + stoneUse * 10 + '% 成功率') : '可以增加成功率') : (meta ? meta.name : '点背包选择');
				return h('div', {
					key: which,
					onClick: () => { if (locked) return; if (isGem) cycleStone(); else if (which === 'base') setBase(null); else setMat(null); },
					title: isGem ? (stoneOwned > 0 ? '每颗 +10% 成功率，点一下放 1 颗（已放 ' + stoneUse + ' / 最多 ' + stoneMax + '）' : '幸运石：每颗 +10% 成功率（合成：紫晶石 ×1 + 铁锭 ×5）') : (it ? '点击清空' : '点下面的背包放进来'),
					...tipProps(it),
					style: { position: 'relative', width: big, height: big, borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1, background: it ? 'linear-gradient(#1d1a12,#12100c)' : 'linear-gradient(#161a26,#0f1220)', border: '2px ' + (it ? 'solid' : 'dashed') + ' ' + (it ? edge : '#333c5c'), color: it ? accent : '#5f657a' },
					children: [
						h('span', { key: 'tg', style: { position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', fontSize: 10, lineHeight: '16px', padding: '0 8px', borderRadius: 999, background: '#0e1017', border: '1px solid ' + (it ? edge : '#333c5c'), color: it ? accent : '#8a8fa3', whiteSpace: 'nowrap' }, children: tag }),
						meta && meta.iconUrl ? IMG({ key: 'i', src: meta.iconUrl, alt: meta.name, style: { width: 40, height: 40, imageRendering: 'pixelated', objectFit: 'contain' } }) : h('span', { key: 'i', style: { fontSize: 32, lineHeight: 1, filter: it ? 'none' : 'saturate(.35)', opacity: it ? 1 : 0.5 }, children: isGem ? '◈' : (meta ? meta.icon : '◇') }),
						h('span', { key: 'nm', style: { fontSize: 11, color: it ? '#f2e8d2' : '#8a8fa3', maxWidth: big - 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: caption }),
						it ? h('span', { key: 'n', style: { fontSize: 10, color: '#8a8fa3' }, children: which === 'base' ? '×1' : (isGem ? '×' + stoneUse + ' 消耗' : '×1 消耗') }) : null,
					],
				});
			};
			const chip = (label, value, color) => hs('div', { key: label, style: { border: '1px solid #2b3555', borderRadius: 8, padding: '5px 9px', whiteSpace: 'nowrap', background: 'rgba(16,19,29,.8)', fontSize: 12 }, children: [
				h('span', { key: 'l', style: { color: '#8a8fa3' }, children: label + ' ' }),
				h('span', { key: 'v', style: { color, fontFamily: 'ui-monospace,monospace' }, children: value }),
			] });
			return hs('div', { className: 'dsh-vs-cover', children: [
				hs('div', {
					key: 'p',
					style: { position: 'relative', width: 600, minHeight: 520, borderRadius: 18, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10, color: '#e6e8f0', border: '2px solid #2b3555', background: 'radial-gradient(120% 80% at 50% -10%, rgba(79,110,247,.16), transparent 60%), radial-gradient(90% 70% at 50% 110%, rgba(245,196,81,.07), transparent 60%), linear-gradient(#12151f,#0b0d14)', boxShadow: 'inset 0 0 0 2px #0a0c12, inset 0 1px 0 rgba(255,255,255,.05), 0 20px 60px rgba(0,0,0,.7)' },
					children: [
						hs('div', { key: 'ttl', style: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, letterSpacing: '.5px' }, children: [
							h('span', { key: 'i', children: '🔮' }),
							h('span', { key: 'n', children: '饰品强化台' }),
							h('span', { key: 'bar', style: { flex: 1, height: 1, background: 'linear-gradient(90deg,#2b3555,transparent)' } }),
							h('button', { key: 'x', className: 'dsh-vs-btn ghost', style: { padding: '2px 10px', fontSize: 12 }, onClick: onClose, children: '✖' }),
						] }),
						hs('div', { key: 'forge', style: { position: 'relative', height: 250, marginTop: 6 }, children: [
							h('div', { key: 'base', style: { position: 'absolute', left: '50%', top: 4, transform: 'translateX(-50%)' }, children: slotBox('base') }),
							h('div', { key: 'p1', style: { position: 'absolute', left: '50%', top: 134, transform: 'translateX(-50%)', color: '#333c5c', fontSize: 20, lineHeight: '20px' }, children: '＋' }),
							h('div', { key: 'mat', style: { position: 'absolute', left: 64, bottom: 0 }, children: slotBox('mat') }),
							h('div', { key: 'p2', style: { position: 'absolute', left: '50%', bottom: 46, transform: 'translateX(-50%)', color: '#333c5c', fontSize: 20, lineHeight: '20px' }, children: '＋' }),
							h('div', { key: 'gem', style: { position: 'absolute', right: 64, bottom: 0 }, children: slotBox('gem') }),
						] }),
						hs('div', { key: 'inv', style: { borderTop: '1px solid #232a40', paddingTop: 10 }, children: [
							hs('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#8a8fa3' }, children: [
								h('span', { key: 't', children: '背包' }),
								h('span', { key: 'p', style: { border: '1px solid #2b3555', borderRadius: 999, padding: '0 8px', lineHeight: '16px', color: '#8fb4ff' }, children: '只显示饰品 / 材料' }),
								h('span', { key: 's', style: { marginLeft: 'auto' }, children: '点饰品 → 先填基底、再填耗材；点幸运石 → +10% 成功率' }),
							] }),
							h('div', { key: 'afx', style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', height: 20, marginTop: 6, fontSize: 11 }, children: base ? [
								h('span', { key: 'l', style: { color: '#5c6273' }, children: '基底词条' }),
							].concat((baseInfo?.affixes ?? []).map((s, i) => { const tone = affixTone(s); return h('span', { key: i, style: { color: tone.text, border: '1px solid ' + tone.border, background: tone.bg, borderRadius: 5, padding: '0 6px', lineHeight: '16px' }, children: affixGlyph(s) + ' ' + (s.filled ? (s.label + ' ' + affixValueText(s, s.range)) : '空孔') }); })) : [h('span', { key: 'l', style: { color: '#5c6273' }, children: '基底词条 · 选中基底后显示' })] }),
							hs('div', { key: 'g', style: { display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 6, marginTop: 8, maxHeight: 134, overflowY: 'auto' }, children: entries.length ? entries.map(([it, n]) => {
								const m = itemMeta(it);
								const sel = selOf(it);
								const lone = it === base && n < 2;
								return h('div', {
									key: it,
									onClick: () => pick(it),
									title: m.name + '（点一下选中）',
									...tipProps(it),
									style: { position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: lone ? 0.4 : 1, background: sel ? 'rgba(40,36,20,.75)' : 'rgba(20,23,34,.75)', border: '1px solid ' + (sel === 'base' ? '#6d5a29' : sel === 'mat' ? '#3f6b46' : sel === 'gem' ? '#4b3a6b' : (m.quality ? QUALITY[m.quality].color : '#232a40')), boxShadow: sel ? '0 0 10px ' + (sel === 'gem' ? 'rgba(195,166,255,.3)' : 'rgba(245,196,81,.25)') : 'none' },
									children: [
										m.iconUrl ? IMG({ key: 'i', src: m.iconUrl, alt: m.name, style: { width: '70%', height: '70%', imageRendering: 'pixelated', objectFit: 'contain' } }) : h('span', { key: 'i', style: { fontSize: 18 }, children: m.icon }),
										n > 1 ? h('span', { key: 'c', style: { position: 'absolute', right: 3, bottom: 0, fontSize: 9, color: '#cfd3e4', textShadow: '0 1px 2px #000' }, children: '×' + n }) : null,
										sel ? h('span', { key: 's', style: { position: 'absolute', left: 2, top: 2, fontSize: 9, lineHeight: '13px', padding: '0 4px', borderRadius: 4, background: 'rgba(6,8,12,.85)', border: '1px solid ' + (sel === 'base' ? '#6d5a29' : sel === 'gem' ? '#4b3a6b' : '#3f6b46'), color: sel === 'base' ? '#f5c451' : sel === 'gem' ? '#c3a6ff' : '#7fe08a' }, children: sel === 'base' ? '基底' : sel === 'gem' ? '幸运石' : '耗材' }) : null,
									],
								});
							}) : [h('div', { key: 'empty', style: { gridColumn: '1 / -1', textAlign: 'center', padding: '16px 0', fontSize: 12, color: '#5f657a' }, children: '背包里没有可用的饰品 / 材料' })] }),
						] }),
						hs('div', { key: 'foot', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }, children: [
							chip('成功率', Math.round(rate * 100) + '%', '#7fe08a'),
							chip('耗时', need + 's', '#dfe4f5'),
							chip('孔位', embedded + ' / ' + sockets, '#8fb4ff'),
							stoneUse > 0 ? chip('幸运石', '+' + stoneUse * 10 + '%', '#c3a6ff') : null,
							h('span', { key: 'sp', style: { flex: 1 } }),
							h('button', { key: 'clear', className: 'dsh-vs-btn ghost', style: { whiteSpace: 'nowrap' }, onClick: () => { setBase(null); setMat(null); setLucky(0); }, children: '清空' }),
							h('button', { key: 'go', className: 'dsh-vs-btn', style: { whiteSpace: 'nowrap', ...(ok ? {} : { opacity: .45, cursor: 'not-allowed' }) }, onClick: () => { if (ok) onLoad(base, mat, stoneUse); }, children: full ? '基底没有空孔了' : ok ? '🔧 装填强化' : '选好基底与耗材' }),
						] }),
						h('div', { key: 'tip', className: 'sub', style: { fontSize: 11, color: '#8a8fa3' }, children: '装填后关面板，走到台前按住 F 逐孔强化：基底保留、耗材与幸运石消失，幸运石每颗 +10% 成功率（总上限 100%）。' }),
					],
				}),
			] });
		}


		function ShopModal({ character, send, onClose, onBuild }) {
			useEffect(() => {
				const audio = new Audio('/vs-game/assets/music/bgm/letmego.mp3');
				audio.loop = true;
				audio.volume = 0.55 * AUDIO_MIX.bgm;
				const p = audio.play();
				if (p && p.catch) p.catch(() => {});
				return () => { audio.pause(); audio.currentTime = 0; };
			}, []);
			const inventory = Array.isArray(character?.inventory) ? character.inventory : [];
			const counts = new Map();
			for (const it of inventory) counts.set(it, (counts.get(it) ?? 0) + 1);
			const price = (item) => /^fish-/.test(item) ? 500
				: item === 'mat-wood' ? 100
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
				: item === 'skill-fragment-purge' ? 5000
				: item.startsWith('skill-fragment') ? 500
				: item.startsWith('tool-') ? 120 : 10;
			const buyPrice = (item) => item === 'mat-wood' ? 200
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
			const buyRows = ['mat-wood', 'mat-ingot-silver', 'mat-diamond', 'mat-ingot-purple', 'record-billie-jean', 'record-letmego', 'record-bad-apple', 'record-world-execute-me', 'skill-fragment', 'skill-fragment-teleport', 'skill-fragment-damage', 'skill-fragment-railgun', 'skill-fragment-purge'].map((item) => ({ item, count: Infinity, price: buyPrice(item), meta: itemMeta(item), buy: true }));
			const gold = Number(character?.gold) || 0;
			const sellRows = [...counts.entries()]
				.filter(([item]) => !['newbie-gift', 'skill-book'].includes(item))
				.map(([item, count]) => ({ item, count, price: price(item), meta: itemMeta(item) }));
			// 打造（家具 / 可互动器械）：通关第 3 关后解锁该标签页
			const buildUnlocked = new Set(character?.clearedLevels ?? []).has('workspace-tidy');
			const clearedSet = new Set(character?.clearedLevels ?? []);
			const buildRows = Object.entries(BUILD_ITEMS).filter(([, meta]) => !meta.unlock || clearedSet.has(meta.unlock)).map(([id, meta]) => {
				const owned = (character?.devices ?? []).filter((d) => d.kind === id).length;
				const affordable = Object.entries(meta.cost).every(([k, n]) => (counts.get(k) ?? 0) >= n);
				return { item: id, count: Infinity, buy: false, build: true, meta, owned, affordable, full: owned >= (meta.max ?? 1) };
			});
			const itemTip = useContext(ItemTipContext);
			const tipProps = (item) => ({
				onMouseEnter: (e) => itemTip.show(item, e),
				onMouseMove: (e) => itemTip.move(e),
				onMouseLeave: () => itemTip.hide(),
			});
			const [tab, setTab] = useState('sell'); // 'sell' | 'buy' | 'build'
			const [selected, setSelected] = useState(null);
			const [qty, setQty] = useState(1);
			const rows = tab === 'sell' ? sellRows : tab === 'buy' ? buyRows : buildRows;
			const current = selected ? rows.find((r) => r.item === selected.item) : null;
			const changeTab = (next) => { setTab(next); setSelected(null); setQty(1); };
			const pick = (r) => { setSelected(r); setQty(1); };
			const confirm = () => {
				if (!current) return;
				if (tab === 'build') { if (current.full || !current.affordable) return; onBuild && onBuild(current.item); setSelected(null); return; }
				const maxQty = current.buy ? 99 : current.count;
				const q = Math.max(1, Math.min(qty || 1, maxQty));
				if (tab === 'sell') send({ kind: ClientMsg.SELL_ITEM, item: current.item, quantity: q });
				else send({ kind: ClientMsg.BUY_ITEM, item: current.item, quantity: q });
				setSelected(null);
				setQty(1);
			};
			return hs('div', { className: 'dsh-vs-cover', children: [
				hs('div', { key: 'panel', style: { width: 620, minHeight: 460, backgroundImage: 'url("/vs-game/assets/ui/shop.png")', backgroundSize: '110% 110%', backgroundPosition: 'center', borderRadius: 18, padding: 34, display: 'flex', flexDirection: 'column', gap: 12, color: '#e6e8f0' }, children: [
					h('h2', { key: 'h', style: { marginLeft: '20ch', marginTop: '-2ch', textAlign: 'left' }, children: '🛒 工作区' }),
					hs('div', { key: 'tabs', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: '2ch' }, children: [
						h('button', { key: 'sell', className: 'dsh-vs-pedia-tab' + (tab === 'sell' ? ' on' : ''), onClick: () => changeTab('sell'), children: '卖出' }),
						h('button', { key: 'buy', className: 'dsh-vs-pedia-tab' + (tab === 'buy' ? ' on' : ''), onClick: () => changeTab('buy'), children: '购买' }),
						buildUnlocked ? h('button', { key: 'build', className: 'dsh-vs-pedia-tab' + (tab === 'build' ? ' on' : ''), onClick: () => changeTab('build'), children: '🔨 打造' }) : null,
						h('span', { key: 'gold', style: { color: '#ffd54f', fontWeight: 700, fontSize: 13, marginLeft: 10 }, children: '💰 token：' + gold }),
					] }),
					hs('div', { key: 'body', style: { display: 'flex', gap: 14, minHeight: 250, alignItems: 'stretch' }, children: [
						hs('div', { key: 'list', style: { flex: '1 1 56%', overflowY: 'auto', maxHeight: 290, display: 'flex', flexDirection: 'column', gap: 6 }, children: rows.length === 0
							? [h('div', { key: 'empty', className: 'dsh-vs-empty', children: tab === 'sell' ? '没有可卖出的物品' : tab === 'buy' ? '暂无可购买商品' : '暂无可打造物品' })]
							: rows.map((r) => {
								const isSel = selected?.item === r.item;
								const costText = r.build
									? Object.entries(r.meta.cost).map(([k, n]) => itemMeta(k).name + '×' + n).join(' + ')
									: ((r.buy ? '-' : '+') + r.price + ' token');
								return hs('div', { key: r.item, ...(r.build ? {} : tipProps(r.item)), onClick: () => pick(r), style: { display: 'flex', alignItems: 'center', gap: 10, background: isSel ? 'rgba(79,110,247,.22)' : 'rgba(10,12,18,.65)', border: '1px solid ' + (isSel ? '#4f6ef7' : '#2a2e3d'), borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }, children: [
									h('span', { key: 'i', children: r.meta.iconUrl ? IMG({ key: 'ii', src: r.meta.iconUrl, style: { width: 26, height: 26, imageRendering: 'pixelated' } }) : r.meta.icon }),
									h('span', { key: 'n', children: r.meta.name + (r.build ? (r.owned > 0 ? '（已建 ' + r.owned + '/' + (r.meta.max ?? 1) + '）' : '') : (!r.buy && r.count > 1 ? ' ×' + r.count : '')) }),
									h('span', { key: 'p', className: 'sub', style: r.build && !r.affordable ? { color: '#ff8a80' } : undefined, children: costText }),
								] });
							}) }),
						hs('div', { key: 'detail', style: { flex: '0 0 40%', background: 'rgba(10,12,18,.65)', border: '1px solid #2a2e3d', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }, children: current ? (current.build ? [
							h('div', { key: 'di', style: { fontSize: 34 }, children: current.meta.icon }),
							h('div', { key: 'dn', children: current.meta.name + (current.owned > 0 ? '（已建 ' + current.owned + '/' + (current.meta.max ?? 1) + '）' : '') }),
							h('div', { key: 'dd', className: 'sub', children: current.meta.desc }),
							hs('div', { key: 'cost', style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: Object.entries(current.meta.cost).map(([k, n], i) => {
								const have = counts.get(k) ?? 0;
								const ok = have >= n;
								return h('div', { key: i, className: 'sub', style: { color: ok ? '#cfd3e4' : '#ff8a80' }, children: (ok ? '✅ ' : '❌ ') + itemMeta(k).name + ' ' + have + '/' + n });
							}) }),
							h('button', { key: 'confirm', className: 'dsh-vs-btn', onClick: confirm, style: (current.full || !current.affordable) ? { opacity: .45, cursor: 'not-allowed' } : undefined, children: current.full ? '已达上限（最多 ' + (current.meta.max ?? 1) + ' 个）' : (current.affordable ? '🔨 打造（然后选位置）' : '材料不足') }),
						] : [
							h('div', { key: 'di', children: current.meta.iconUrl ? IMG({ key: 'ii', src: current.meta.iconUrl, style: { width: 42, height: 42, imageRendering: 'pixelated' } }) : current.meta.icon }),
							h('div', { key: 'dn', children: current.meta.name + (tab === 'sell' && current.count > 1 ? ' ×' + current.count : '') }),
							h('div', { key: 'dp', className: 'sub', children: '单价：' + current.price + ' token' }),
							hs('div', { key: 'qrow', style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [
								h('span', { key: 'ql', children: '数量' }),
								h('input', { key: 'qi', type: 'number', min: 1, max: current.buy ? 99 : current.count, value: qty, onChange: (e) => setQty(Math.max(1, Math.min(current.buy ? 99 : current.count, Number(e.target.value) || 1))), style: { width: 64, background: '#0e1017', color: '#e6e8f0', border: '1px solid #2a2e3d', borderRadius: 6, padding: '4px 6px' } }),
								h('span', { key: 'sum', className: 'sub', children: '小计 ' + (qty * current.price) + ' token' }),
							] }),
							h('button', { key: 'confirm', className: 'dsh-vs-btn', onClick: confirm, children: tab === 'sell' ? '确认卖出' : '确认购买' }),
						]) : [h('div', { key: 'tip', className: 'dsh-vs-empty', children: tab === 'sell' ? '点击左侧物品，右侧设置卖出数量' : tab === 'buy' ? '点击左侧物品，右侧设置购买数量' : '选一个要打造的东西' })] }),
					] }),
					h('button', { key: 'c', className: 'dsh-vs-btn ghost', onClick: onClose, children: '关闭工作区' }),
				] }),
			] });
		}

		/** 第 5 关海边商店：外观与家里商店一致，只卖宝剑（服务端权威定价与防重复购买） */
		function LevelShopModal({ character, send, onClose }) {
			const gold = Number(character?.gold) || 0;
			const inv = Array.isArray(character?.inventory) ? character.inventory : [];
			const accs = Array.isArray(character?.accessories) ? character.accessories : [];
			const accBase = (x) => String(x ?? '').split('~')[0].split('#')[0];
			const owned = inv.includes('acc-sword') || accs.some((x) => x && accBase(x) === 'acc-sword');
			const meta = itemMeta('acc-sword');
			const price = 10000;
			const affordable = gold >= price;
			const canBuy = !owned && affordable;
			return hs('div', { className: 'dsh-vs-cover', children: [
				hs('div', { key: 'panel', style: { width: 620, minHeight: 460, backgroundImage: 'url("/vs-game/assets/ui/shop.png")', backgroundSize: '110% 110%', backgroundPosition: 'center', borderRadius: 18, padding: 34, display: 'flex', flexDirection: 'column', gap: 12, color: '#e6e8f0' }, children: [
					h('h2', { key: 'h', style: { marginLeft: '20ch', marginTop: '-2ch', textAlign: 'left' }, children: '🛒 海边商店' }),
					hs('div', { key: 'tabs', style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: '2ch' }, children: [
						h('span', { key: 'gold', style: { color: '#ffd54f', fontWeight: 700, fontSize: 13 }, children: '💰 token：' + gold }),
						h('span', { key: 'tip', className: 'sub', style: { fontSize: 12, color: '#9aa2b1' }, children: '店长：想讨伐巨型海胆？先买把趁手的剑。' }),
					] }),
					hs('div', { key: 'body', style: { display: 'flex', gap: 14, minHeight: 250, alignItems: 'stretch' }, children: [
						h('div', { key: 'list', style: { flex: '1 1 56%', overflowY: 'auto', maxHeight: 290, display: 'flex', flexDirection: 'column', gap: 6 }, children: [
							hs('div', { key: 'sword', style: { display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(79,110,247,.22)', border: '1px solid #4f6ef7', borderRadius: 8, padding: '8px 12px' }, children: [
								h('span', { key: 'i', children: IMG({ key: 'ii', src: meta.iconUrl, style: { width: 26, height: 26, imageRendering: 'pixelated' } }) }),
								h('span', { key: 'n', children: meta.name + (owned ? '（已拥有）' : '') }),
								h('span', { key: 'p', className: 'sub', children: '-' + price + ' token' }),
							] }),
						] }),
						hs('div', { key: 'detail', style: { flex: '0 0 40%', background: 'rgba(10,12,18,.65)', border: '1px solid #2a2e3d', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }, children: [
							IMG({ key: 'di', src: meta.iconUrl, style: { width: 42, height: 42, imageRendering: 'pixelated' } }),
							h('div', { key: 'dn', children: meta.name + '（蓝色 · 饰品）' }),
							h('div', { key: 'ex', style: { color: '#f5c451', fontSize: 12.5 }, children: '◆ 普通攻击替换为剑技' }),
							h('div', { key: 'dd', className: 'sub', children: '点击屏幕朝点击方向挥剑，三段连击；蓝色 3 孔；强化时只能作为基底，且全局只能佩戴一件。' }),
							h('div', { key: 'dp', className: 'sub', children: '单价：' + price + ' token' }),
							h('button', { key: 'confirm', className: 'dsh-vs-btn', onClick: () => { if (canBuy) send({ kind: ClientMsg.LEVEL_SHOP_BUY, item: 'acc-sword' }); }, style: !canBuy ? { opacity: .45, cursor: 'not-allowed' } : undefined, children: owned ? '已拥有（去角色页佩戴）' : (affordable ? '确认购买' : 'token不足（还差 ' + (price - gold) + '）') }),
						] }),
					] }),
					h('button', { key: 'c', className: 'dsh-vs-btn ghost', onClick: onClose, children: '关闭商店' }),
				] }),
			] });
		}

		/** 第三房间「鱼饵铺」：标签页（鱼饵 / 服务 / 收鱼） */
		function BaitShopModal({ character, send, onClose, onOpenEnder, engine }) {
			const [tab, setTab] = useState('bait');
			const gold = Number(character?.gold) || 0;
			const inv = Array.isArray(character?.inventory) ? character.inventory : [];
			const have = inv.filter((x) => x === 'bait-pixel').length;
			const meta = itemMeta('bait-pixel');
			const price = 2000;
			const canBuy = gold >= price;
			const RECORDS = ['record-billie-jean', 'record-letmego', 'record-bad-apple', 'record-world-execute-me'];
			const owned = RECORDS.filter((x) => inv.includes(x));
			const fishList = [...new Set(inv.filter((x) => /^fish-/.test(x)))];
			const FISH_PRICE = 500;
			const recState = engine && engine.recordState ? engine.recordState() : { item: null, paused: false };
			const rowBox = { display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(10,12,18,.65)', border: '1px solid #2a2e3d', borderRadius: 8, padding: '10px 12px' };
			const tabBtn = (id, label) => h('button', { key: id, className: 'dsh-vs-btn' + (tab === id ? '' : ' ghost'), style: { fontSize: 13, padding: '5px 14px' }, onClick: () => setTab(id), children: label });
			const pane = (id, node) => h('div', { key: id, style: tab === id ? { display: 'flex', flexDirection: 'column', gap: 10 } : { display: 'none' }, children: node });
			// ── 鱼饵页 ──
			const baitPane = [hs('div', { key: 'bait', style: rowBox, children: [
				IMG({ key: 'i', src: meta.iconUrl, style: { width: 30, height: 30, imageRendering: 'pixelated' } }),
				hs('div', { key: 't', style: { display: 'flex', flexDirection: 'column' }, children: [
					h('span', { key: 'n', children: meta.name + '（消耗品）' }),
					h('span', { key: 'd', className: 'sub', style: { fontSize: 12 }, children: meta.desc }),
				] }),
				h('span', { key: 'p', className: 'sub', style: { marginLeft: 'auto' }, children: '-' + price + ' token' }),
				h('button', { key: 'buy', className: 'dsh-vs-btn', onClick: () => { if (canBuy) send({ kind: ClientMsg.LEVEL_SHOP_BUY, item: 'bait-pixel' }); }, disabled: !canBuy, children: canBuy ? '购买 1 个' : 'token不足' }),
			] }),
			h('div', { key: 'how', className: 'sub', style: { fontSize: 12, lineHeight: 1.7 }, children: '用法：第三房间按 C 切换鱼饵、按 V 把饵抛进水里，等鱼上钩。10% 概率钓出「河豚」BOSS。' }),
			];
			// ── 服务页 ──
			const svcPane = [
				hs('div', { key: 'ender', style: rowBox, children: [
					IMG({ key: 'i', src: '/vs-game/assets/items/mv/ender-chest.png', style: { width: 30, height: 30, imageRendering: 'pixelated' } }),
					hs('div', { key: 't', style: { display: 'flex', flexDirection: 'column' }, children: [
						h('span', { key: 'n', children: '末影箱（30 格）' }),
						h('span', { key: 'd', className: 'sub', style: { fontSize: 12 }, children: '随身仓库，任何房间都能开，不占家具位' }),
					] }),
					h('button', { key: 'b', className: 'dsh-vs-btn', style: { marginLeft: 'auto' }, onClick: () => onOpenEnder && onOpenEnder(), children: '打开' }),
				] }),
				hs('div', { key: 'rec', style: Object.assign({}, rowBox, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }), children: [
					hs('div', { key: 'rh', style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [
						h('span', { key: 'i', style: { fontSize: 18 }, children: '🎵' }),
						hs('div', { key: 't', style: { display: 'flex', flexDirection: 'column' }, children: [
							h('span', { key: 'n', children: '唱片机服务' }),
							h('span', { key: 'd', className: 'sub', style: { fontSize: 12 }, children: owned.length ? '点歌即放，不消耗唱片，切房间也不断' : '还没有唱片：去角色页「商店」买' }),
						] }),
						recState.item ? h('button', { key: 'stop', className: 'dsh-vs-btn ghost', style: { marginLeft: 'auto' }, onClick: () => engine && engine.stopRecord && engine.stopRecord(), children: '⏹ 停止' }) : null,
					] }),
					owned.length ? hs('div', { key: 'list', style: { display: 'flex', flexWrap: 'wrap', gap: 6 }, children: owned.map((it) => {
						const m = itemMeta(it);
						const on = recState.item === it;
						return h('button', { key: it, className: 'dsh-vs-btn' + (on ? '' : ' ghost'), style: { fontSize: 12 }, onClick: () => { if (engine && engine.playRecordService) engine.playRecordService(it); }, children: (on ? '▶ ' : '🎵 ') + m.name });
					}) }) : null,
				] }),
			];
			// ── 收鱼页 ──
			const fishPane = [
				h('div', { key: 't', className: 'sub', style: { fontSize: 12.5 }, children: '店长收鱼：每条 ' + FISH_PRICE + ' token（带词条的鱼也是这个价，按需自己留着）' }),
				fishList.length ? hs('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }, children: fishList.map((it) => {
					const m = itemMeta(it);
					const af = m.affixes && m.affixes[0];
					return hs('div', { key: it, style: rowBox, children: [
						IMG({ key: 'i', src: m.iconUrl, style: { width: 24, height: 24, imageRendering: 'pixelated' } }),
						h('span', { key: 'n', style: { fontSize: 12.5 }, children: m.name + (af ? '（' + affixLabel(af) + ' ' + af.range[0] + '）' : '') }),
						h('button', { key: 'b', className: 'dsh-vs-btn', style: { fontSize: 12, marginLeft: 'auto' }, onClick: () => send({ kind: ClientMsg.SELL_ITEM, item: it, quantity: 1 }), children: '卖 1（+' + FISH_PRICE + '）' }),
					] });
				}) }) : h('div', { key: 'none', className: 'sub', style: { fontSize: 12 }, children: '背包里没有鱼（去钓鱼吧）' }),
			];
			return hs('div', { className: 'dsh-vs-cover', children: [
				hs('div', { key: 'panel', style: { width: 620, maxHeight: '86vh', overflowY: 'auto', backgroundImage: 'url("/vs-game/assets/ui/shop.png")', backgroundSize: '110% 110%', backgroundPosition: 'center', borderRadius: 18, padding: 30, display: 'flex', flexDirection: 'column', gap: 12, color: '#e6e8f0' }, children: [
					h('h2', { key: 'h', style: { marginLeft: '18ch', marginTop: '-2ch', textAlign: 'left' }, children: '🛒 鱼饵铺' }),
					hs('div', { key: 'info', style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: '1ch', flexWrap: 'wrap' }, children: [
						h('span', { key: 'gold', style: { color: '#ffd54f', fontWeight: 700, fontSize: 13 }, children: '💰 token：' + gold }),
						h('span', { key: 'have', style: { color: '#9fd3ff', fontSize: 13 }, children: '🪱 鱼饵：×' + have }),
						h('span', { key: 'tip', className: 'sub', style: { fontSize: 12, color: '#9aa2b1' }, children: '店长：饵、箱子、唱片、收鱼，分页看。' }),
					] }),
					hs('div', { key: 'tabs', style: { display: 'flex', gap: 8, borderBottom: '1px solid #2a2e3d', paddingBottom: 8 }, children: [
						tabBtn('bait', '🪱 鱼饵'),
						tabBtn('svc', '🏪 服务'),
						tabBtn('fish', '🐟 收鱼'),
					] }),
					pane('bait', baitPane),
					pane('svc', svcPane),
					pane('fish', fishPane),
					h('button', { key: 'c', className: 'dsh-vs-btn ghost', style: { marginTop: 4 }, onClick: onClose, children: '关闭鱼饵铺' }),
				] }),
			] });
		}

		/** 角色界面：左侧角色信息 + 右侧标签页（背包 / 角色面板 / 初始天赋） */
		function CharacterModal({ character, goldEarned, send, onClose, onPlaceChest }) {
			const [tab, setTab] = useState('bag'); // 'bag' | 'panel' | 'gear' | 'talent'
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
			const itemTip = useContext(ItemTipContext);
			const tipProps = (item) => ({
				onMouseEnter: (e) => itemTip.show(item, e),
				onMouseMove: (e) => itemTip.move(e),
				onMouseLeave: () => itemTip.hide(),
			});

			const renderBag = () => {
				const INV_COLS = 6;
				const INV_SLOTS = 24;
				// 堆叠：同类物品合并一格显示 ×N（材料/饰品不占多格）
				const entries = bagEntriesStable(inventory);
				const slotCount = Math.max(INV_SLOTS, Math.ceil(entries.length / INV_COLS) * INV_COLS);
				const nodes = [];
				for (let i = 0; i < slotCount; i++) {
					const ent = entries[i];
					if (!ent || !ent.count) {
						nodes.push(h('div', { key: 'e' + i, className: 'dsh-vs-item empty', onClick: () => setSelectedItem(null) }));
						continue;
					}
					const item = ent.item;
					const count = ent.count;
					const meta = itemMeta(item);
					const canOpen = item === 'newbie-gift' || item.startsWith('skill-book');   // 技能书统一按前缀判定：新增技能书不用再改这里
					const canEquip = item.startsWith('acc-');
					const canPlace = item === 'wooden-chest' || item === 'record-player';
					const isSel = selectedItem === item;
					nodes.push(h('div', {
						key: item,
						className: 'dsh-vs-item' + ((canOpen || canEquip || canPlace) ? ' use' : '') + (meta.quality ? ' ' + meta.quality : '') + (isSel ? ' selected' : ''),
						onMouseEnter: (e) => { setSelectedItem(item); itemTip.show(item, e); },
						onMouseMove: (e) => itemTip.move(e),
						onMouseLeave: () => itemTip.hide(),
						onClick: () => setSelectedItem(item),
						children: [
							meta.iconUrl
								? IMG({ key: 'i', className: 'dsh-vs-item-img', src: meta.iconUrl, alt: meta.name })
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
								children: item.startsWith('skill-book') ? '使用' : '打开',
							}) : canEquip && isSel ? h('button', {
								key: 'e',
								className: 'dsh-vs-item-use-btn',
								onClick: (e) => {
									e.stopPropagation();
									send({ kind: ClientMsg.EQUIP_ACCESSORY, item });
									setSelectedItem(null);
								},
								children: '装备',
							}) : canPlace && isSel ? h('button', {
								key: 'p',
								className: 'dsh-vs-item-use-btn',
								onClick: (e) => {
									e.stopPropagation();
									if (onPlaceChest) onPlaceChest(item); else send({ kind: ClientMsg.PLACE_CHEST, placeItem: item, containerKind: item === 'record-player' ? 'record-player' : 'chest' });
									setSelectedItem(null);
								},
								children: '放置',
							}) : null,
						],
					}));
				}
				const selDesc = selectedItem ? describeItem(selectedItem) : null;
				return hs('div', { children: [
					hs('div', { key: 'grid', className: 'dsh-vs-inv', onClick: (e) => { if (e.target === e.currentTarget) setSelectedItem(null); }, children: nodes }),
					selDesc ? hs('div', { key: 'detail', className: 'dsh-vs-item-detail', children: [
						h('b', { key: 'n', children: selDesc.name }),
						h('span', { key: 't', className: 'sub', children: selDesc.typeLabel }),
						selDesc.stats.length ? h('div', { key: 'st', style: { display: 'flex', flexDirection: 'column', gap: 1, marginTop: 2 }, children: selDesc.stats.map((s, i) => h('div', { key: i, style: { fontSize: 12, color: '#7fe08a' }, children: s.label + ' ' + s.value })) }) : null,
						selDesc.affixes.length ? h('div', { key: 'af', style: { display: 'flex', flexDirection: 'column', gap: 1, marginTop: 2 }, children: selDesc.affixes.map((s, i) => h('div', { key: i, style: { fontSize: 12, color: affixTone(s).text }, children: affixGlyph(s) + ' ' + (s.filled ? (s.label + ' ' + (s.range ? (s.range[0] + '-' + s.range[1]) : '')) : '空孔') })) }) : null,
						h('span', { key: 'd', className: 'sub', children: selDesc.desc }),
					] }) : null,
				] });
			};

			const renderPanel = () => {
				const mightLv = Number(passives.might) || 0;
				const armorLv = Number(passives.armor) || 0;
				const regenLv = Number(passives.regen) || 0;
				const speedLv = Number(passives.speed) || 0;
				const mightMult = 1 + 0.20 * mightLv;
				const accMin = accessories.reduce((sum, it) => {
					const m = it ? itemMeta(it) : null;
					return sum + (m?.attack ? Number(m.attack[0]) : 0);
				}, 0);
				const accMax = accessories.reduce((sum, it) => {
					const m = it ? itemMeta(it) : null;
					return sum + (m?.attack ? Number(m.attack[1]) : 0);
				}, 0);
				const attackMin = (BASE_ATTACK + accMin) * mightMult;
				const attackMax = (BASE_ATTACK + accMax) * mightMult;
				const attack = (attackMin + attackMax) / 2;
				// 饰品词条加成（攻击/生命/防御/暴击/爆伤都能在面板看到）
				const affixSum = (key) => accessories.reduce((sum, it) => {
					if (!it) return sum;
					const m2 = itemMeta(it);
					const r2 = m2?.affixStats?.[key] ?? null;
					return sum + (r2 ? (Number(r2[0]) + Number(r2[1])) / 2 : 0);
				}, 0);
				const hpMax = 100 + affixSum('hp');
				const critPct = 5 + affixSum('crit');
				const cdmgPct = 150 + affixSum('cdmg');
				const defense = armorLv * 5 + affixSum('def');
				const defenseReduce = defense / (defense + 100) * 100;
				const hpRegen = 0.6 * regenLv;
				const moveSpeed = 1 + 0.10 * speedLv;
				return hs('div', { className: 'dsh-vs-char-panel', children: [
					h('div', { key: 'hp', className: 'dsh-vs-upgrade-row', children: [
						h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '血量' }),
						h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: String(Math.round(hpMax)) }),
					] }),
					h('div', { key: 'atk', className: 'dsh-vs-upgrade-row', children: [
						h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '攻击力' }),
						h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: attackMin.toFixed(1) + ' - ' + attackMax.toFixed(1) }),
					] }),
					h('div', { key: 'def', className: 'dsh-vs-upgrade-row', children: [
						h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '防御力' }),
						h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: String(defense) + '（减伤 ' + defenseReduce.toFixed(1) + '%）' }),
					] }),
					h('div', { key: 'regen', className: 'dsh-vs-upgrade-row', children: [
						h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '每秒回血' }),
						h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: hpRegen.toFixed(1) }),
					] }),
					h('div', { key: 'speed', className: 'dsh-vs-upgrade-row', children: [
						h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '移速' }),
						h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: moveSpeed.toFixed(2) }),
					] }),
					h('div', { key: 'lifesteal', className: 'dsh-vs-upgrade-row', children: [
						h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '吸血' }),
						h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: '0%' }),
					] }),
					h('div', { key: 'crit', className: 'dsh-vs-upgrade-row', children: [
						h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '暴击率' }),
						h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: critPct.toFixed(1) + '%' }),
					] }),
					h('div', { key: 'critdmg', className: 'dsh-vs-upgrade-row', children: [
						h('span', { key: 'k', className: 'dsh-vs-upgrade-name', children: '暴击伤害' }),
						h('span', { key: 'v', className: 'dsh-vs-upgrade-cost', children: (cdmgPct / 100).toFixed(2) + 'x' }),
					] }),
				] });
			};

			const renderTalent = () => hs('div', { className: 'dsh-vs-passives', children: Object.keys(PASSIVES).map((t) => {
				const lvl = Number(passives[t]) || 0;
				const cost = 100 * (lvl + 1);
				const maxed = lvl >= 5;
				const perTxt = PASSIVES[t].per;
				const curTxt = lvl > 0 ? PASSIVES[t].current(lvl) : '无加成';
				return hs('div', { key: t, className: 'dsh-vs-upgrade-row', title: '每级：' + perTxt + '\n当前：' + curTxt, children: [
					h('span', { key: 'n', className: 'dsh-vs-upgrade-name', children: PASSIVES[t].icon + ' ' + PASSIVES[t].name + ' Lv.' + lvl }),
					h('span', { key: 'c', className: 'dsh-vs-upgrade-cost', children: maxed ? '已满级' : cost + ' token' }),
					h('button', { key: 'b', className: 'dsh-vs-mini-btn', disabled: maxed || gold < cost, onClick: () => send({ kind: ClientMsg.UPGRADE_PASSIVE, passive: t }), children: maxed ? '满级' : '升级' }),
				] });
			}) });

			const renderWeapon = () => hs('div', { className: 'dsh-vs-char-panel', children: [
				hs('div', { key: 'head', className: 'dsh-vs-char-section-title', children: '初始武器（下一局生效）' }),
				hs('div', { key: 'grid', className: 'dsh-vs-weapon-picker', children: Object.keys(WEAPONS).map((t) =>
					h('button', {
						key: t,
						className: 'dsh-vs-weapon-opt' + (char.initialWeapon === t ? ' on' : ''),
						onClick: () => send({ kind: ClientMsg.SET_INITIAL_WEAPON, weapon: t }),
						children: WEAPONS[t].icon + ' ' + WEAPONS[t].name,
					})) }),
			] });

			const renderGear = () => hs('div', { className: 'dsh-vs-char-panel', children: [
				renderWeapon(),
				renderSkill(),
			] });

			const renderSkill = () => hs('div', { className: 'dsh-vs-char-panel', children: [
				hs('div', { key: 'head', className: 'dsh-vs-char-section-title', children: '主动技能' }),
				(character.unlockedSkills ?? []).length === 0
					? h('div', { key: 'empty', className: 'sub', children: '还没有学会主动技能，去合成技能书吧。' })
					: hs('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: (character.unlockedSkills ?? []).map((id) => {
						const sk = ACTIVE_SKILLS[id];
						if (!sk) return null;
						const active = character.activeSkill === id;
						return h('button', {
							key: id,
							className: 'dsh-vs-weapon-opt' + (active ? ' on' : ''),
							onClick: () => send({ kind: ClientMsg.EQUIP_SKILL, skill: id }),
							children: [
								sk.iconUrl ? IMG({ key: 'i', src: sk.iconUrl, alt: '', style: { width: 16, height: 16, verticalAlign: 'middle', imageRendering: 'pixelated' } }) : sk.icon,
								' ' + sk.name + (active ? '（装备中）' : ''),
							],
						});
					}) }),
			] });

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
								h('div', { key: 'gold', className: 'dsh-vs-char-gold', children: '💰 token ' + gold + (lastEarned > 0 ? '（本局 +' + lastEarned + '）' : '') }),
								h('div', { key: 'at', className: 'dsh-vs-char-section-title dsh-vs-char-acc-title', children: '饰品栏' }),
							] }),
							hs('div', { key: 'pr', className: 'dsh-vs-char-portrait-row', children: [
								h(CharacterPortrait, { key: 'portrait' }),
								hs('div', { key: 'acc', className: 'dsh-vs-char-acc-col', children: accessories.map((a, i) => {
									const am = a ? itemMeta(a) : null;
									return h('div', {
										key: i,
										className: 'dsh-vs-char-acc-slot' + (a ? ' filled' : ''),
										title: a ? '点击卸下' : '空饰品槽',
										...(a ? tipProps(a) : {}),
										onClick: () => { if (a) send({ kind: ClientMsg.UNEQUIP_ACCESSORY, slot: i }); },
										children: a ? [
											am.iconUrl ? IMG({ key: 'i', src: am.iconUrl, alt: am.name }) : h('span', { key: 'i', children: am.icon }),
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
								] }),
								hs('div', { key: 'skill', className: 'dsh-vs-char-card', children: [
									hs('div', { key: 'main', className: 'dsh-vs-char-card-main', children: [
										char.activeSkill && ACTIVE_SKILLS[char.activeSkill]?.iconUrl
											? IMG({ key: 'i', src: ACTIVE_SKILLS[char.activeSkill].iconUrl, alt: '', style: { width: 20, height: 20, imageRendering: 'pixelated' } })
											: h('span', { key: 'i', children: char.activeSkill ? (ACTIVE_SKILLS[char.activeSkill]?.icon ?? '⚡') : '⚡' }),
										hs('div', { key: 't', children: [
											h('div', { key: 'n', children: char.activeSkill ? (ACTIVE_SKILLS[char.activeSkill]?.name ?? char.activeSkill) : '主动技能' }),
											h('div', { key: 's', className: 'dsh-vs-char-card-sub', children: char.activeSkill && ACTIVE_SKILLS[char.activeSkill] ? (ACTIVE_SKILLS[char.activeSkill].type ? ACTIVE_SKILLS[char.activeSkill].desc : 'CD ' + ACTIVE_SKILLS[char.activeSkill].cd + 's · 5s无敌 · 最多6次快速移动') : '未获得（使用技能书学习）' }),
										] }),
									] }),
								] }),
							] }),
						]}),
						hs('div', { key: 'right', className: 'dsh-vs-char-right', children: [
							hs('div', { key: 'tabs', className: 'dsh-vs-char-tabs', children: [
								h('button', { key: 'bag', className: 'dsh-vs-char-tab' + (tab === 'bag' ? ' on' : ''), onClick: () => setTab('bag'), children: '背包' }),
								h('button', { key: 'panel', className: 'dsh-vs-char-tab' + (tab === 'panel' ? ' on' : ''), onClick: () => setTab('panel'), children: '角色面板' }),
								h('button', { key: 'gear', className: 'dsh-vs-char-tab' + (tab === 'gear' ? ' on' : ''), onClick: () => setTab('gear'), children: '武器/技能' }),
								h('button', { key: 'talent', className: 'dsh-vs-char-tab' + (tab === 'talent' ? ' on' : ''), onClick: () => setTab('talent'), children: '初始天赋' }),
							] }),
							tab === 'bag' ? renderBag() : tab === 'panel' ? renderPanel() : tab === 'gear' ? renderGear() : renderTalent(),
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

		/** P3 通关结算覆盖层：翻卡（免费 1 + token加翻 1）→ 全揭晓 → 返回/再刷 */
		function ClearPanel({ snap, character, story, send, onExit, onRetry }) {
			const cards = snap.cards;
			const [clicked, setClicked] = useState([]);
			const [revealed, setRevealed] = useState(false);
			if (!cards) return null;
			const pickedNow = cards.picked ?? [];
			const picked = cards.picked ?? [];
			const allowance = cards.maxPicks ?? 2;
			const canFlipMore = !revealed && picked.length < allowance;
			const gold = Number(character?.gold) || 0;
			const extraCost = cards.extraCost ?? 300;
			const cardInfo = (c) => {
				if (c.kind === 'gold') return { emoji: '💰', name: c.amount + ' token', desc: '直接入账' };
				const m = itemMeta(c.item);
				return { emoji: m.icon, iconUrl: m.iconUrl, name: m.name, desc: m.desc };
			};
			// 翻满张数后不再要按钮：稍停一下自动全部掀开
			useEffect(() => {
				if (revealed || pickedNow.length < (cards.maxPicks ?? 2)) return;
				const timer = setTimeout(() => setRevealed(true), 900);
				return () => clearTimeout(timer);
			}, [revealed, pickedNow.length]);
			const paidFlip = picked.length >= 1; // 第 1 张免费，之后每张现场扣token
			const flip = (i) => {
				if (!canFlipMore || clicked.includes(i) || picked.includes(i)) return;
				if (paidFlip && gold < extraCost) return; // 余额不足：卡上价格亮着，点击不响应
				setClicked((prev) => [...prev, i]);
				send({ kind: ClientMsg.FLIP_PICK, index: i });
			};
			return hs('div', { className: 'dsh-vs-cover', children: [
				h('h2', { key: 'h', children: cards.firstClear ? '🎉 关卡通过！首通达成' : '🎉 关卡通过！' }),
				cards.firstClear && cards.firstClearGold ? h('div', { key: 'fc', style: { color: '#3ddc84', fontSize: 13 }, children: '✨ 首通奖励 +' + cards.firstClearGold + ' token（已入账）' }) : null,
				story && story.artPost ? IMG({ key: 'art', src: '/vs-game/' + story.artPost, alt: '通关', style: { width: 190, borderRadius: 12, boxShadow: '0 6px 24px rgba(0,0,0,.5)' } }) : null,
				h('div', { key: 'tip', className: 'sub', children: revealed ? '全部揭晓完毕。' : picked.length === 0 ? '第一张免费翻开，第二张要token——价格就写在牌上。' : canFlipMore ? '再翻一张（付token），或者揭晓全部。' : '翻牌次数用完啦，揭晓吧。' }),
				hs('div', { key: 'row', className: 'dsh-vs-fliprow', children: cards.cards.map((c, i) => {
					const isPicked = picked.includes(i);
					const show = revealed || isPicked;
					const cls = 'dsh-vs-fcard' + ((clicked.includes(i) || revealed) ? ' flipped' : '') + (revealed && !isPicked ? ' dim' : '');
					const info = cardInfo(c);
					const needPrice = !show && !clicked.includes(i) && picked.length >= 1;
					return h('div', { key: i, className: cls, onClick: () => flip(i), children: [
						hs('div', { className: 'inner', children: [
							hs('div', { key: 'b', className: 'face back', children: [
								h('div', { key: 'w', children: '🐟' }),
								needPrice
									? h('div', { key: 'p', className: 'fprice' + (gold < extraCost ? ' poor' : ''), children: '💰 ' + extraCost })
									: h('div', { key: 'q', style: { color: '#6b7084', fontSize: 22 }, children: '?' }),
							] }),
							hs('div', { key: 'f', className: 'face front', children: [
								show ? (info.iconUrl
									? IMG({ key: 'i', src: info.iconUrl, alt: info.name, style: { width: 44, height: 44, imageRendering: 'pixelated' } })
									: h('div', { key: 'i', className: 'fv', children: info.emoji }))
									: h('div', { key: 'i', className: 'fv', children: '…' }),
								show ? h('div', { key: 'n', className: 'fn', children: info.name }) : null,
								show ? h('div', { key: 'd', className: 'fd', children: info.desc }) : null,
							] }),
						] }),
					] });
				}) }),
				!revealed && picked.length < allowance ? h('button', { key: 'btns', className: 'dsh-vs-btn ghost', onClick: () => setRevealed(true), children: '不翻牌了，直接揭晓 →' }) : !revealed ? null : hs('div', { key: 'btns2', style: { display: 'flex', gap: 10 }, children: [
					h('button', { key: 'm', className: 'dsh-vs-btn', onClick: onExit, children: '返回菜单' }),
					h('button', { key: 'a', className: 'dsh-vs-btn ghost', onClick: onRetry, children: '再刷一遍' }),
				] }),
				h('div', { key: 'gold', className: 'dsh-vs-credit', children: '当前token：' + gold }),
			] });
		}

		// ── 标题流程组件（开场动画 / 标题菜单 / 存档槽）──────────────────
		const TS_SLOT_NAMES = ['存档 · 槽位一', '存档 · 槽位二', '存档 · 槽位三'];
		function tsFmtTime(ts) {
			const n = Number(ts);
			if (!Number.isFinite(n) || n <= 0) return '—';
			try {
				return new Date(n).toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
			} catch { return '—'; }
		}
		// 菜单文字拆成单字 span（配合 .dsh-vs-ts-mi:hover .in span 的波浪动效，--i 是节拍延迟）
		function tsWaveChars(text, keyBase) {
			return [...String(text)].map((ch, i) => h('span', { key: keyBase + '-' + i, style: { '--i': i }, children: ch }));
		}
		/** 开场动画覆盖层：点击任意处跳过；标题出现后仍挂载在底层提供活水背景 */
		function TsIntroScreen({ onDone, active }) {
			const canvasRef = useRef(null);
			const playerRef = useRef(null);
			const onDoneRef = useRef(onDone);
			onDoneRef.current = onDone;
			useEffect(() => {
				const cv = canvasRef.current;
				if (!cv) return undefined;
				const player = new IntroPlayer(cv);
				playerRef.current = player;
				player.onDone = () => { try { onDoneRef.current?.(); } catch { /* noop */ } };
				player.start();
				return () => { player.stop(); if (playerRef.current === player) playerRef.current = null; };
			}, []);
			return hs('div', {
				className: 'dsh-vs-ts-layer',
				onClick: () => { if (active) playerRef.current?.skip(); },
				children: [
					h('canvas', { key: 'cv', ref: canvasRef, width: 1280, height: 720, className: 'dsh-vs-ts-cv' }),
					active ? h('div', { key: 'hint', className: 'dsh-vs-ts-skip', children: '点击任意处跳过 ▶' }) : null,
				],
			});
		}
		/** 标题画面：大标题 + 新的开始 / 继续游戏 / 退出游戏 */
		function TsTitleScreen({ saves, onNew, onContinue, onExit }) {
			const slots = Array.isArray(saves?.slots) ? saves.slots : [];
			const activeIdx = slots.findIndex((x) => x && x.id === saves?.activeSlot);
			return h('div', { className: 'dsh-vs-ts-layer dsh-vs-ts-over-title', children: hs('div', { className: 'dsh-vs-ts-home', children: [
				h('div', { key: 't', className: 'dsh-vs-ts-gtitle', children: '工作中的大肥鱼' }),
				hs('div', { key: 'menu', className: 'dsh-vs-ts-menu', children: [
					h('div', { key: 'm0', className: 'dsh-vs-ts-mi', style: { '--d': '0.48s' }, onClick: onNew, children: h('span', { className: 'in', children: tsWaveChars('新的开始', 'n') }) }),
					h('div', { key: 'm1', className: 'dsh-vs-ts-mi', style: { '--d': '0.70s' }, onClick: onContinue, children: h('span', { className: 'in', children: tsWaveChars('继续游戏', 'c') }) }),
					h('div', { key: 'm2', className: 'dsh-vs-ts-mi', style: { '--d': '0.92s' }, onClick: onExit, children: h('span', { className: 'in', children: tsWaveChars('退出游戏', 'x') }) }),
				] }),
				activeIdx >= 0 ? h('div', { key: 'cur', className: 'dsh-vs-ts-activeslot', children: '当前档位：' + (TS_SLOT_NAMES[activeIdx] ?? saves.activeSlot) }) : null,
			] }) });
		}
		/** 存档槽：3 张卡片；continue 空档不可点；new 有档需二次确认覆盖 */
		function TsSlotsScreen({ mode, saves, confirmSlot, onPick, onBack }) {
			const slots = Array.isArray(saves?.slots) && saves.slots.length > 0
				? saves.slots
				: [0, 1, 2].map((i) => ({ id: 'slot' + (i + 1), exists: false }));
			return h('div', { className: 'dsh-vs-ts-layer dsh-vs-ts-over-slots', children: hs('div', { className: 'dsh-vs-ts-slots', children: [
				h('div', { key: 't', className: 'dsh-vs-ts-slot-title', children: mode === 'new' ? '新的开始 · 选个位置' : '继续游戏 · 选个存档' }),
				hs('div', { key: 'list', className: 'dsh-vs-ts-slot-list', children: slots.slice(0, 3).map((sl, i) => {
					const empty = !sl?.exists;
					const confirming = mode === 'new' && !empty && confirmSlot === i;
					const clickable = !(mode === 'continue' && empty);
					const line2 = empty
						? '— 空 —'
						: (confirming
							? '⚠ 确认覆盖该存档？再点一次开始新游戏（点其他卡取消）'
							: 'token ' + (sl.gold ?? 0) + ' ｜ 击杀 ' + (sl.kills ?? 0) + ' ｜ 通关 ' + (sl.cleared ?? 0) + ' 关 ｜ 最后保存 ' + tsFmtTime(sl.savedAt));
					return hs('div', {
						key: sl?.id || ('slot-' + i),
						className: 'dsh-vs-ts-slot' + (empty ? ' empty' : '') + (confirming ? ' confirm' : '') + (clickable ? '' : ' off'),
						onClick: clickable ? () => onPick(i, sl) : undefined,
						children: [
							h('div', { key: 'cap', className: 'cap', children: TS_SLOT_NAMES[i] ?? ('存档 · 槽位' + (i + 1)) }),
							h('div', { key: 'l2', className: 'line2', children: line2 }),
						],
					});
				}) }),
				h('div', { key: 'back', className: 'dsh-vs-ts-back', onClick: onBack, children: '« 返回标题' }),
			] }) });
		}

		/** 游戏窗口：canvas + HUD + 各阶段覆盖层 */
		function GameWindow({ standalone, hidden, minimized, onMinimize, onClose, wsStatus, send, helloRef, character, goldEarned, levels }) {
			const canvasRef = useRef(null);
			const sendRef = useRef(send); sendRef.current = send;
			const characterRef = useRef(character); characterRef.current = character;
			const homeActionRef = useRef(null);
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
			const [winScale, setWinScale] = useState(1);
			const resizeRef = useRef(null);
			useEffect(() => {
				fetch('/vs-game/config').then((r) => r.json()).then((d) => setCfg(d.config)).catch(() => {});
			}, []);
			const patchCfg = (patch) => {
				fetch('/vs-game/config', {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(patch),
				}).then((r) => r.json()).then((d) => {
					if (!d.config) return;
					// 音量滑杆刚动过：服务端回包里带的还是旧音量，直接用它会把滑块拽回去（回弹）→ 保留本地值
					const justTouchedVolume = performance.now() - volTouchRef.current < 1000;
					const engCfg = engineRef.current?.cfg ?? {};
					const next = justTouchedVolume
						? { ...d.config, sfxVolume: engCfg.sfxVolume ?? d.config.sfxVolume, bgmVolume: engCfg.bgmVolume ?? d.config.bgmVolume }
						: d.config;
					setCfg(next);
					engineRef.current?.applyConfig?.(next);
				}).catch(() => {});
			};
			// 拖动滑杆时：本地先改（界面和声音即时响应），网络写入防抖 200ms，避免每像素一次 PATCH 造成的卡顿
			const volumePatchTimer = useRef(null);
			const volTouchRef = useRef(0);   // 最近一次拖音量滑杆的时间（用于挡住回包覆盖）
			const setVolume = (key, value) => {
				const v = Number(value) || 0;
				volTouchRef.current = performance.now();
				setCfg((prev) => (prev ? { ...prev, [key]: v } : prev));
				engineRef.current?.setAudioVolume?.(key, v);
				if (volumePatchTimer.current) clearTimeout(volumePatchTimer.current);
				volumePatchTimer.current = setTimeout(() => { volumePatchTimer.current = null; patchCfg({ [key]: v }); }, 200);
			};
			// 点击设置区域以外时收起设置弹窗
			useEffect(() => {
				if (!cfgOpen) return;
				const onPointerDown = (e) => {
					if (e.target.closest('.dsh-vs-pop') || e.target.closest('[title="设置"]')) return;
					setCfgOpen(false);
					engineRef.current?.focusCanvas();
				};
				document.addEventListener('pointerdown', onPointerDown);
				return () => document.removeEventListener('pointerdown', onPointerDown);
			}, [cfgOpen]);
			// 窗口边缘缩放：拖动右/下/右下角调节整体缩放
			const onResizeDown = (edge) => (e) => {
				e.preventDefault();
				resizeRef.current = { edge, sx: e.clientX, sy: e.clientY, scale: winScale };
				try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
			};
			const onResizeMove = (e) => {
				if (!resizeRef.current) return;
				const r = resizeRef.current;
				let next = r.scale;
				if (r.edge === 'r' || r.edge === 'c') next += (e.clientX - r.sx) / GAME_W;
				if (r.edge === 'b' || r.edge === 'c') next += (e.clientY - r.sy) / GAME_H;
				if (r.edge === 'l') next -= (e.clientX - r.sx) / GAME_W;   // 左边缘：往左拉 = 放大
				if (r.edge === 't') next -= (e.clientY - r.sy) / GAME_H;   // 上边缘：往上拉 = 放大
				setWinScale(Math.max(0.5, Math.min(2, next)));
			};
			const onResizeUp = (e) => {
				if (!resizeRef.current) return;
				resizeRef.current = null;
				try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
			};

			// ── 选关面板 ──
			const [selectOpen, setSelectOpen] = useState(false);
			// ── 图鉴弹窗 ──
			const [pediaOpen, setPediaOpen] = useState(false);
			const [manualOpen, setManualOpen] = useState(false);
			const [pediaTab, setPediaTab] = useState('weapon'); // 'weapon' | 'enemy' | 'boss' | 'craft'
			const [galleryOpen, setGalleryOpen] = useState(false);
			const [doorOpen, setDoorOpen] = useState(false);
			const [shopOpen, setShopOpen] = useState(false);
			const [levelShopOpen, setLevelShopOpen] = useState(false);
			const [baitShopOpen, setBaitShopOpen] = useState(false);
			const [enchantOpen, setEnchantOpen] = useState(false);
			const [agentHubOpen, setAgentHubOpen] = useState(false);
			const [craftOpen, setCraftOpen] = useState(false);
			const [craftPlaced, setCraftPlaced] = useState([]);
			const [chestOpen, setChestOpen] = useState(null);
			const [enderWait, setEnderWait] = useState(false);   // 鱼饵铺点「打开末影箱」后等它创建好
			const [recordOpen, setRecordOpen] = useState(null);
			const [chestMenu, setChestMenu] = useState(null);
			// ── 角色界面 ──
			const [charOpen, setCharOpen] = useState(false);

			// ── 标题流程状态机：null（未开始/已进游戏，不盖层）| 'intro' 开场动画 | 'title' 标题菜单 | 'slots' 存档槽 ──
			const [titleState, setTitleState] = useState(null);
			const titleBlockedRef = useRef(false);                // 标题流程进行中 → 引擎不推进/不重绘（别让上一局画面漏出来）
			titleBlockedRef.current = titleState !== null;
			const [slotsMode, setSlotsMode] = useState('new');    // 'new' 新的开始 | 'continue' 继续游戏
			const [saves, setSaves] = useState(null);             // HELLO/SAVE_SLOTS 里的 saves（槽位卡片渲染用）
			const [confirmSlot, setConfirmSlot] = useState(null); // new 模式下点了第一次、等二次确认的槽位下标
			const [introKey, setIntroKey] = useState(0);          // 重播开场动画时换 key 强制重挂 IntroPlayer
			const pendingEnterRef = useRef(false);                // 已发 SAVE_SELECT/SAVE_NEW 且未取消 → 等新 HELLO 进游戏
			const pendingNewSaveRef = useRef(false);              // 这次选的是「新建档」→ 进游戏先播虚无开局剧情
			const inGameRef = useRef(false);                      // 本次窗口打开期间已进过游戏（之后不再弹标题）
			const titleMsgRef = useRef(null);                     // 根组件经 gameMsgTarget.title 把 HELLO/SAVE_SLOTS 转进来
			const minRef = useRef(false);                         // 上一次收起是不是「最小化」（最小化恢复不重播标题）
			minRef.current = minimized;
			// 窗口打开（含关闭后再开）→ 每次都重播开场动画（可点击跳过）
			const startTitleFlow = () => {
				setSaves(helloRef?.current?.saves ?? null);
				setConfirmSlot(null);
				setIntroKey((k) => k + 1);
				setTitleState('intro');
			};
			useEffect(() => {
				if (hidden) return;   // 收起时不动标题状态（最小化/关闭都保留现场）
				inGameRef.current = false;
				pendingEnterRef.current = false;
				if (minRef.current) { minRef.current = false; return; }   // 最小化恢复：直接回原画面，不重播
				startTitleFlow();      // X / 退出游戏 / 关闭后的重新打开：重播开场动画
			}, [hidden]);
			// 存档槽点击
			const pickSlot = (idx, sl) => {
				if (slotsMode === 'continue') {
					if (!sl?.exists) return;               // 空档不可点
					pendingEnterRef.current = true;
					sendRef.current({ kind: ClientMsg.SAVE_SELECT, slot: sl.id });
					return;
				}
				if (!sl?.exists) {                         // 新的开始：空档直接建档
					pendingEnterRef.current = true;
					pendingNewSaveRef.current = true;
					setConfirmSlot(null);
					sendRef.current({ kind: ClientMsg.SAVE_NEW, slot: sl.id });
					return;
				}
				if (confirmSlot === idx) {                 // 有档：再点同一张才覆盖
					pendingEnterRef.current = true;
					pendingNewSaveRef.current = true;
					setConfirmSlot(null);
					sendRef.current({ kind: ClientMsg.SAVE_NEW, slot: sl.id });
				} else {
					setConfirmSlot(idx);                   // 第一次点 → 确认覆盖态（点其他卡/返回即取消）
				}
			};
			const backToTitle = () => {
				pendingEnterRef.current = false;           // 用户返回标题：清掉"等待进游戏"标记
				setConfirmSlot(null);
				setTitleState('title');
			};
			// HELLO（选档成功后的全新 HELLO）/SAVE_SLOTS 的标题侧处理
			titleMsgRef.current = (msg) => {
				if (msg.kind === HostMsg.SAVE_SLOTS) {
					if (msg.error) pendingEnterRef.current = false; // 选择失败（如 slot-empty）：取消等待，只刷新卡片
					if (msg.saves) setSaves(msg.saves);
					return;
				}
				if (msg.kind !== HostMsg.HELLO) return;
				const sv = msg.saves ?? null;
				if (sv) setSaves(sv);
				if (pendingEnterRef.current) {
					// 选档成功：host 发来全新 HELLO → 收起标题，进家场景
					pendingEnterRef.current = false;
					inGameRef.current = true;
					setConfirmSlot(null);
					setTitleState(null);
					const engine = engineRef.current;
					if (engine) {
						const fresh = pendingNewSaveRef.current || !(msg.character?.storyIntroDone ?? true);
						pendingNewSaveRef.current = false;
						if (fresh) engine.startVoidIntro(); else engine.enterHome();   // 新档：先播虚无开局剧情
						setSnap(engine.snapshot());
					}
				} else if (!hidden && !inGameRef.current && titleState === null && sv) {
					// 窗口开着但 HELLO 晚到 → 现在才开始标题流程；引擎已在游戏中就绝不弹标题
					const ph = engineRef.current?.phase;
					if (ph == null || ph === 'menu') startTitleFlow();
				}
			};
			useEffect(() => {
				gameMsgTarget.title = titleMsgRef;
				return () => { if (gameMsgTarget.title === titleMsgRef) gameMsgTarget.title = null; };
			}, []);

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
			const openEnderChest = () => {
				const list = Array.isArray(character?.chests) ? character.chests : [];
				const idx = list.findIndex((c) => c.kind === 'ender-chest');
				setBaitShopOpen(false);
				if (idx >= 0) { setChestOpen(idx); engineRef.current?.focusCanvas(); return; }
				send({ kind: ClientMsg.PLACE_CHEST, service: 'ender-chest' });
				setEnderWait(true);
			};
			useEffect(() => {   // 末影箱创建回来后自动打开
				if (!enderWait) return;
				const list = Array.isArray(character?.chests) ? character.chests : [];
				const idx = list.findIndex((c) => c.kind === 'ender-chest');
				if (idx >= 0) { setEnderWait(false); setChestOpen(idx); }
			}, [enderWait, character?.chests]);
			const handleHomeAction = (type) => {
				if (type === 'char') setCharOpen(true);
				else if (type === 'dex') { setPediaOpen(true); setPediaTab('weapon'); }
				else if (type === 'gallery') setGalleryOpen(true);
				else if (type === 'manual') setManualOpen(true);
				else if (type === 'settings') setCfgOpen(true);
				else if (type === 'door') setDoorOpen(true);
				else if (type === 'shop') setShopOpen(true);
				else if (type === 'level-shop') setLevelShopOpen(true);
				else if (type === 'level-shop:bait') setBaitShopOpen(true);
				else if (type.startsWith('enchant:')) setEnchantOpen(true);
				else if (type.startsWith('agent-hub:')) setAgentHubOpen(true);
				else if (type === 'craft') { setCraftPlaced(engineRef.current?.crafting?.placed ?? []); setCraftOpen(true); }
				else if (type.startsWith('chest-menu:')) { setChestMenu(Number(type.split(':')[1])); }
				else if (type.startsWith('chest:')) { const i = Number(type.split(':')[1]); if (character?.chests?.[i]?.kind === 'record-player') setRecordOpen(i); else setChestOpen(i); }
			};
			homeActionRef.current = handleHomeAction;

			// 引擎生命周期
			useEffect(() => {
				const engine = engineRef.current;
				if (!engine) return;
				if (hidden) engine.pause();
				else engine.resume();
			}, [hidden]);

			useEffect(() => {
				const canvas = canvasRef.current;
				if (!canvas) return;
				const dpr = Math.min(window.devicePixelRatio || 1, 2);
				canvas.width = GAME_W * dpr;
				canvas.height = GAME_H * dpr;
				const engine = new GameEngine(canvas, { sendWs: (msg) => sendRef.current(msg), onHomeAction: (type) => homeActionRef.current?.(type) });
				engineRef.current = engine;
				// 引擎重建时优先使用最新的 character 快照，避免回档到旧 HELLO
				const char = characterRef.current;
				if (char) engine.applyCharacter(char);
				else {
					const hello = helloRef?.current;
					if (hello) engine.handleHostMsg(hello);
				}
				canvas.getContext('2d').scale(dpr, dpr);
				let raf = 0;
				let last = performance.now();
				const loop = (now) => {
					const dt = (now - last) / 1000;
					last = now;
					// 开篇动画/标题/存档槽期间：不推进也不重绘，别让上一局的画面从动画底下漏出来
					if (!titleBlockedRef.current) {
						try {
							engine.tick(dt);
							engine.render(now);
						} catch { /* 渲染/逻辑错误不炸宿主页面 */ }
					}
					raf = requestAnimationFrame(loop);
				};
				raf = requestAnimationFrame(loop);
				const hudTimer = setInterval(() => { if (!titleBlockedRef.current) setSnap(engine.snapshot()); }, 100);
				// 对话中把 HUD 快照提到 ~30fps：否则 100ms 一刷，打字机会一顿一顿地往外蹦
				const dialogTimer = setInterval(() => {
					const en = engineRef.current;
					if (en && !titleBlockedRef.current && en.phase === 'bossintro' && en.bossIntro) setSnap(en.snapshot());
				}, 33);
				return () => {
					cancelAnimationFrame(raf);
					clearInterval(hudTimer);
					clearInterval(dialogTimer);
					engine.destroy();
					engineRef.current = null;
				};
			}, []);

			// host 消息 → 引擎（通过轮询 snap 拿不到，走 window 级转发）
			useEffect(() => {
				gameMsgTarget.engine = engineRef;
				return () => { gameMsgTarget.engine = null; };
			}, []);

			const s = snap;
			return hs('div', {
				className: 'dsh-vs-win' + (standalone ? ' dsh-vs-standalone' : '') + (hidden ? ' dsh-vs-win-hidden' : ''),
				style: standalone ? { transform: 'none' } : { transform: 'translate(calc(-50% + ' + offset.x + 'px), calc(-50% + ' + offset.y + 'px)) scale(' + winScale + ')' },
				children: [
				h('div', { key: 'rzr', className: 'dsh-vs-resize-r', onPointerDown: onResizeDown('r'), onPointerMove: onResizeMove, onPointerUp: onResizeUp, onPointerCancel: onResizeUp }),
				h('div', { key: 'rzb', className: 'dsh-vs-resize-b', onPointerDown: onResizeDown('b'), onPointerMove: onResizeMove, onPointerUp: onResizeUp, onPointerCancel: onResizeUp }),
				h('div', { key: 'rzl', className: 'dsh-vs-resize-l', onPointerDown: onResizeDown('l'), onPointerMove: onResizeMove, onPointerUp: onResizeUp, onPointerCancel: onResizeUp }),
				h('div', { key: 'rzt', className: 'dsh-vs-resize-t', onPointerDown: onResizeDown('t'), onPointerMove: onResizeMove, onPointerUp: onResizeUp, onPointerCancel: onResizeUp }),
				h('div', { key: 'rzc', className: 'dsh-vs-resize-c', onPointerDown: onResizeDown('c'), onPointerMove: onResizeMove, onPointerUp: onResizeUp, onPointerCancel: onResizeUp }),
				h('div', {
					key: 'head', className: 'dsh-vs-head',
					title: '拖拽移动窗口',
					onPointerDown: onHeadDown, onPointerMove: onHeadMove,
					onPointerUp: onHeadUp, onPointerCancel: onHeadUp,
					children: [
					hs('div', { key: 'l', className: 'dsh-vs-head-left', children: [
						h('span', { key: 't', className: 'dsh-vs-title', children: '🐟 工作中的大肥鱼' }),
					] }),
					hs('div', { key: 'r', className: 'dsh-vs-head-right', children: [
						h('span', { key: 'd', className: 'dsh-vs-dot ' + (wsStatus === 'open' ? 'ok' : wsStatus === 'closed' ? 'bad' : 'wait'), title: '工作事件通道' }),
						h('button', { key: 'g', className: 'dsh-vs-iconbtn', title: '设置', onClick: () => setCfgOpen((o) => !o), children: '⚙' }),
						h('button', { key: 'min', className: 'dsh-vs-iconbtn', title: '最小化（进度保留）', onClick: onMinimize, children: '—' }),
						h('button', { key: 'x', className: 'dsh-vs-iconbtn', title: '关闭', onClick: (e) => { e.stopPropagation(); engineRef.current?.pause(); onClose(); }, children: '✕' }),
					] }),
				] }),
				cfgOpen && cfg ? hs('div', { key: 'pop', className: 'dsh-vs-pop', children: [
					h('label', { key: 'ap', children: [
						h('span', { key: 't', children: '脱离 DSH 时自动暂停' }),
						h('input', { key: 'i', type: 'checkbox', checked: !!cfg.autoPause, onChange: (e) => patchCfg({ autoPause: e.target.checked }) }),
					] }),
					h('label', { key: 'as', children: [
						h('span', { key: 't', children: '升级时默认选择第一项' }),
						h('input', { key: 'i', type: 'checkbox', checked: !!cfg.autoSelect, onChange: (e) => patchCfg({ autoSelect: e.target.checked }) }),
					] }),
					h('label', { key: 'df', children: [
						h('span', { key: 't', children: '难度' }),
						h('select', { key: 's', value: cfg.difficulty ?? 'normal', title: '影响怪物的血量与伤害', onChange: (e) => patchCfg({ difficulty: e.target.value }), children: [
							h('option', { key: 'e', value: 'easy', children: '简单（怪 −20% 血/伤）' }),
							h('option', { key: 'n', value: 'normal', children: '普通（标准）' }),
							h('option', { key: 'h', value: 'hard', children: '困难（怪 +35% 血/伤）' }),
						] }),
					] }),
					!activeLevel ? h('label', { key: 'ir', children: [   // 只对无尽模式有意义（关卡走 levelTrickle，不吃这个值）
						h('span', { key: 't', children: '无尽模式·保底刷怪间隔(秒)' }),
						h('input', { key: 'i', type: 'number', min: 1, max: 10, value: cfg.idleSpawnRate ?? 3, onChange: (e) => patchCfg({ idleSpawnRate: Number(e.target.value) || 3 }) }),
					] }) : null,
					h('label', { key: 'sfx', children: [
						h('span', { key: 't', children: '音效音量' }),
						h('input', { key: 'i', type: 'range', min: 0, max: 100, step: 5, value: cfg.sfxVolume ?? 100, onChange: (e) => setVolume('sfxVolume', e.target.value) }),
						h('span', { key: 'v', className: 'sub', style: { width: '3.4em', textAlign: 'right' }, children: (cfg.sfxVolume ?? 100) + '%' }),
					] }),
					h('label', { key: 'bgm', children: [
						h('span', { key: 't', children: '音乐音量' }),
						h('input', { key: 'i', type: 'range', min: 0, max: 100, step: 5, value: cfg.bgmVolume ?? 100, onChange: (e) => setVolume('bgmVolume', e.target.value) }),
						h('span', { key: 'v', className: 'sub', style: { width: '3.4em', textAlign: 'right' }, children: (cfg.bgmVolume ?? 100) + '%' }),
					] }),
				] }) : null,
				hs('div', { key: 'stage', className: 'dsh-vs-stage', children: [
					h('canvas', { key: 'cv', ref: canvasRef, style: { width: GAME_W, height: GAME_H, transformOrigin: 'center center', transform: standalone ? 'scale(' + winScale + ')' : undefined } }),
					s && s.phase !== 'menu' ? h(Hud, { key: 'hud', snap: s, activeLevel, character, minimal: s.phase === 'home', onCycleCompass: () => engineRef.current?.cycleCompass() }) : null,
					s && s.phase === 'home' && s.homeRoom !== 2 ? h('button', { key: 'editToggle', className: 'dsh-vs-edit-toggle' + (s.edit && s.edit.mode ? ' on' : ''), onClick: () => engineRef.current?.toggleEditMode(), children: s.edit && s.edit.mode ? '✖ 退出编辑' : '✏️ 编辑模式' }) : null,
					s && s.phase === 'home' && s.edit && s.edit.sel ? h(EditBar, { key: 'editbar', sel: s.edit.sel, send, onDeselect: () => engineRef.current?.deselectEdit() }) : null,
					s && s.phase === 'playing' && activeLevel?.id === 'busy-server' && (character?.clearedLevels ?? []).includes('busy-server') ? h('button', { key: 'skipBoss', className: 'dsh-vs-btn ghost dsh-vs-skip-boss', onClick: (e) => { e.stopPropagation(); engineRef.current?.skipToBoss(); }, children: '⏩ 直接 Boss' }) : null,
					s && s.phase === 'home' && s.activeSkill ? h('button', {
						key: 'homeSkill',
						className: 'dsh-vs-skill-btn has-e dsh-vs-skill-btn-home' + ((s.activeSkill.type === 'strike' && s.activeSkill.timer > 0) || s.activeSkill.charging ? ' on' : ''),
						onClick: () => { engineRef.current?.activateActiveSkill(); engineRef.current?.focusCanvas(); },
						children: (() => {
							const sk = s.activeSkill;
							const suffix = sk.type === 'railgun'
								? (sk.charging ? ' 蓄力中 · 点击屏幕发射' : (sk.cd > 0 ? ' ' + Math.ceil(sk.cd) + 's' : '（E 蓄力）'))
								: sk.type === 'strike'
									? (sk.timer > 0 ? ' ' + Math.ceil(sk.timer) + 's' : (sk.cd > 0 ? ' CD ' + Math.ceil(sk.cd) + 's' : '（E）'))
									: sk.type === 'purge' ? (sk.cd > 0 ? ' CD ' + Math.ceil(sk.cd) + 's' : '（战斗中 E 释放）')
								: (sk.enabled ? ' 已开启' : ' 已关闭');
							return sk.iconUrl
								? [IMG({ key: 'i', src: sk.iconUrl, alt: '', style: { width: 16, height: 16, verticalAlign: 'middle', imageRendering: 'pixelated' } }), ' ' + sk.name + suffix]
								: (sk.icon + ' ' + sk.name + suffix);
						})(),
					}) : null,
					s && s.phase === 'home' && !s.focused ? h('div', { key: 'home-keys', className: 'dsh-vs-keys', children: [
						h('button', { key: 'b', onClick: () => engineRef.current?.focusCanvas(), children: '🎮 点我接管键盘（WASD 移动 · F 交互）' }),
					] }) : null,
					s && s.phase === 'home' && doorOpen ? h(DoorPanel, {
						key: 'door',
						onLevel: () => { setDoorOpen(false); setSelectOpen(true); },
						onEndless: () => { setDoorOpen(false); startGame(null); },
						onClose: () => { setDoorOpen(false); engineRef.current?.focusCanvas(); },
					}) : null,
					s && s.phase === 'playing' && s.activeSkill ? h('button', {
						key: 'skill',
						className: 'dsh-vs-skill-btn has-e' + ((s.activeSkill.type === 'strike' && s.activeSkill.timer > 0) || s.activeSkill.charging || !!s.activeSkill.purgePhase ? ' on' : ''),
						onClick: () => { engineRef.current?.activateActiveSkill(); engineRef.current?.focusCanvas(); },
						children: s.activeSkill.type === 'railgun'
							? (s.activeSkill.charging
								? (s.activeSkill.icon + ' ' + s.activeSkill.name + ' 蓄力中 · 点击屏幕发射')
								: s.activeSkill.cd > 0
									? (s.activeSkill.icon + ' ' + s.activeSkill.name + ' ' + Math.ceil(s.activeSkill.cd) + 's')
									: (s.activeSkill.icon + ' ' + s.activeSkill.name + '（E 蓄力）'))
							: s.activeSkill.type === 'purge'
							? [
								s.activeSkill.iconUrl ? IMG({ key: 'si', src: s.activeSkill.iconUrl, alt: '', style: { width: 16, height: 16, verticalAlign: 'middle', borderRadius: 3 } }) : s.activeSkill.icon,
								' ' + s.activeSkill.name + (s.activeSkill.purgePhase === 'hunt' ? ' ' + Math.ceil(s.activeSkill.purgeLeft) + 's · 斩！' : (s.activeSkill.purgePhase ? ' 虚影登场' : (s.activeSkill.cd > 0 ? ' CD ' + Math.ceil(s.activeSkill.cd) + 's' : '（E）'))),
							]
							: s.activeSkill.type !== 'strike'
							? [
								s.activeSkill.iconUrl ? IMG({ key: 'si', src: s.activeSkill.iconUrl, alt: '', style: { width: 16, height: 16, verticalAlign: 'middle', imageRendering: 'pixelated' } }) : s.activeSkill.icon,
								' ' + s.activeSkill.name + (s.activeSkill.enabled ? ' 已开启（点击/按住发射）' : ' 已关闭（E开启）'),
							]
							: s.activeSkill.timer > 0
								? (s.activeSkill.icon + ' ' + s.activeSkill.name + ' ' + Math.ceil(s.activeSkill.timer) + 's · 移动 ' + s.activeSkill.teleportsLeft + '/' + s.activeSkill.maxTeleports)
								: s.activeSkill.cd > 0
									? (s.activeSkill.icon + ' ' + s.activeSkill.name + ' ' + Math.ceil(s.activeSkill.cd) + 's')
									: (s.activeSkill.icon + ' ' + s.activeSkill.name + '（E）'),
					}) : null,
					s && s.phase === 'playing' && !s.focused ? h('div', { key: 'kh', className: 'dsh-vs-keys', children: [
						h('button', { key: 'b', onClick: () => engineRef.current?.focusCanvas(), children: '🎮 点我接管键盘（WASD 移动）' }),
					] }) : null,
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
							children: '📖 图鉴（敌人 ' + (s?.discovered ?? []).filter((d) => ENEMY_TYPES[d]).length + '/' + Object.keys(ENEMY_TYPES).length + ' · Boss ' + (s?.discovered ?? []).filter((d) => String(d).startsWith('boss:')).length + '/' + (BOSS_EXTRA.length + (levels ?? []).filter((lv) => lv?.boss && lv.id).length) + '）',
						}),
						h('button', { key: 'gallery', className: 'dsh-vs-btn ghost', onClick: () => setGalleryOpen(true), children: '🖼 画廊' }),
						h('div', { key: 'cr', className: 'dsh-vs-credit', children: '角色素材：whale-girl（MIT · 画师 ZipZipPipe）' }),
					] }) : null,
					// ── 标题流程覆盖层：开场动画播满全片（水蓝结尾），标题/存档槽半透明叠在活水画面上 ──
					(titleState === 'intro' || titleState === 'title') ? h(TsIntroScreen, { key: 'ts-intro-' + introKey, active: titleState === 'intro', onDone: () => setTitleState('title') }) : null,
					titleState === 'title' ? h(TsTitleScreen, {
						key: 'ts-title', saves,
						onNew: () => { setSlotsMode('new'); setConfirmSlot(null); setTitleState('slots'); },
						onContinue: () => { setSlotsMode('continue'); setConfirmSlot(null); setTitleState('slots'); },
						onExit: onClose,
					}) : null,
					titleState === 'slots' ? h(TsSlotsScreen, { key: 'ts-slots', mode: slotsMode, saves, confirmSlot, onPick: pickSlot, onBack: backToTitle }) : null,
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
					s && (s.phase === 'playing' || s.phase === 'paused') && s.pendingChoices > 0 ? h('button', {
						key: 'openPending',
						className: 'dsh-vs-defer',
						onClick: () => engineRef.current?.openPendingChoice(),
						children: '⏳ 待选升级 ×' + s.pendingChoices,
					}) : null,
					s && s.phase === 'bossintro' && s.bossIntro ? hs('div', {
						key: 'bossintro-layer',
						style: { position: 'absolute', inset: 0, zIndex: 8, pointerEvents: 'auto', cursor: 'pointer' },
						onClick: () => engineRef.current?.advanceBossIntro(),
						children: [
							hs('div', { key: 'dialog', className: 'dsh-vs-dialog', children: (() => {
								const line = s.bossIntro.lines[s.bossIntro.index] || {};
								// 打字机：revealed 是引擎推进的「已显示字数」（老快照没有该字段就整句显示）
								const fullText = String(line.text ?? '');
								const revealed = s.bossIntro.revealed;
								const typing = revealed != null && revealed < fullText.length;
								const shownText = revealed == null ? fullText : fullText.slice(0, Math.max(0, Math.floor(revealed)));
								const showPortrait = typeof line.speaker === 'string' && line.speaker.includes('大肥鱼');
								const showWolf = line.speaker === '小狼';
								const showNpc = !!line.npc;   // ？？？ 的头像（用户更新过的那张）
								const portrait = showPortrait
									? IMG({ key: 'portrait', src: '/vs-game/assets/image/tell.png?v=4', alt: '大肥鱼', style: { width: 110, height: 110, objectFit: 'contain', flex: '0 0 auto', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.5))' } })
									: showWolf
									// 小狼：表情集 4 列 × 2 行，按台词 line.face 裁某一格（默认最左上角，说完蛋了用右上角）
									? h('div', {
										key: 'wolfportrait', title: '小狼',
										style: (() => {
											const f = WOLF_FACES[line.face] ?? WOLF_FACES.normal;
											return {
												width: 110, height: 110, flex: '0 0 auto', borderRadius: 10,
												backgroundImage: "url('/vs-game/assets/npc/xiaolangface.png?v=1')",
												backgroundSize: (WOLF_FACE_COLS * 100) + '% ' + (WOLF_FACE_ROWS * 100) + '%',
												backgroundPosition: (f.col * 100 / (WOLF_FACE_COLS - 1)) + '% ' + (f.row * 100 / (WOLF_FACE_ROWS - 1)) + '%',
												backgroundRepeat: 'no-repeat',
												filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.5))',
											};
										})(),
									})
									: showNpc ? IMG({ key: 'npcportrait', src: '/vs-game/assets/companion/gpt-dragon-head.png?v=2', alt: '？？？', style: { width: 128, height: 108, objectFit: 'contain', flex: '0 0 auto', filter: 'drop-shadow(0 4px 10px rgba(0,0,0,.5))' } }) : null;
								return [hs('div', { key: 'row', style: { display: 'flex', gap: 12, alignItems: 'flex-end' }, children: [
									portrait,
									hs('div', { key: 'body', style: { flex: '1 1 auto' }, children: [
										h('div', { key: 'sp', className: 'dsh-vs-dialog-speaker', children: line.speaker ?? '' }),
										line.pwd ? h('div', { key: 'pwd', style: { display: 'inline-block', fontFamily: 'ui-monospace,monospace', fontSize: 12, color: '#7ee787', background: '#12151d', border: '1px solid rgba(120,220,140,.5)', borderRadius: 6, padding: '2px 8px', marginBottom: 6 }, children: '$ pwd' }) : null,
										h('div', { key: 'tx', className: 'dsh-vs-dialog-text', children: shownText }),
										h('div', { key: 'hm', className: 'dsh-vs-dialog-hint', children: typing ? '按任意键／点击：立刻显示本句 ▶' : '点击任意位置或按任意键继续 ▶' }),
									] }),
								] })];
							})() }),
						] })
					: null,
					s && s.phase === 'clear' && s.cards ? h(ClearPanel, {
					key: 'clear', snap: s, character,
					story: activeLevel?.story ?? null,
					send,
					onExit: () => { const en = engineRef.current; en?.reportClearSettlement(); if (en) { en.enterHome(); setSnap(en.snapshot()); } },
					onRetry: () => { engineRef.current?.reportClearSettlement(); retryGame(); },
				}) : null,
				s && s.phase === 'gameover' ? hs('div', { key: 'over', className: 'dsh-vs-cover', children: [
						h('h2', { key: 'h', children: '💤 下班了' }),
						h('div', { key: 'st', className: 'dsh-vs-stats', children: [
							h('div', { key: 't', children: [h('b', { key: 'v', children: fmtTime(s.elapsed) }), '存活'] }),
							h('div', { key: 'k', children: [h('b', { key: 'v', children: String(s.kills) }), '击杀'] }),
							h('div', { key: 'l', children: [h('b', { key: 'v', children: 'Lv.' + s.level }), '等级'] }),
							h('div', { key: 's', children: [h('b', { key: 'v', children: String(s.score) }), '分数'] }),
							h('div', { key: 'g', children: [h('b', { key: 'v', children: '+' + (goldEarned || 0) }), 'token'] }),
						] }),
						s.best != null ? h('div', { key: 'best', className: 'sub', children: '最佳纪录：' + s.best }) : null,
						h('button', { key: 'again', className: 'dsh-vs-btn', onClick: () => retryGame(), children: '再来一局' }),
						h('button', { key: 'menu', className: 'dsh-vs-btn ghost', onClick: () => { engineRef.current?.enterHome(); setSnap(engineRef.current.snapshot()); }, children: '返回大肥鱼的家' }),
					] }) : null,
				] }),
				pediaOpen ? h(PediaModal, { key: 'pedia', snap: s, character, levels, tab: pediaTab, setTab: setPediaTab, onClose: () => { setPediaOpen(false); engineRef.current?.focusCanvas(); } }) : null,
				manualOpen ? h(ManualModal, { key: 'manual', character, onClose: () => { setManualOpen(false); engineRef.current?.focusCanvas(); } }) : null,
				galleryOpen ? h(GalleryModal, { key: 'gallery', levels, character, onClose: () => { setGalleryOpen(false); engineRef.current?.focusCanvas(); } }) : null,
				shopOpen ? h(ShopModal, { key: 'shop', character, send, onClose: () => { setShopOpen(false); engineRef.current?.focusCanvas(); }, onBuild: (item) => { setShopOpen(false); engineRef.current?.beginPlaceBuild(item); engineRef.current?.focusCanvas(); } }) : null,
				levelShopOpen ? h(LevelShopModal, { key: 'level-shop', character, send, onClose: () => { setLevelShopOpen(false); engineRef.current?.focusCanvas(); } }) : null,
				baitShopOpen ? h(BaitShopModal, { key: 'bait-shop', character, send, engine: engineRef.current, onOpenEnder: openEnderChest, onClose: () => { setBaitShopOpen(false); engineRef.current?.focusCanvas(); } }) : null,
				agentHubOpen ? h(AgentHubModal, { key: 'agenthub', character, send, onClose: () => { setAgentHubOpen(false); engineRef.current?.focusCanvas(); } }) : null,
				enchantOpen ? h(EnchantModal, { key: 'ench', character, onLoad: (b, m2, l) => { engineRef.current?.setPendingEnchant(b, m2, l); setEnchantOpen(false); engineRef.current?.focusCanvas(); }, onClose: () => { setEnchantOpen(false); engineRef.current?.focusCanvas(); } }) : null,
				craftOpen ? h(CraftModal, { key: 'craft', character, placed: craftPlaced, onChange: (items) => { setCraftPlaced(items); engineRef.current?.setCraftPlaced(items); send({ kind: ClientMsg.SET_CRAFTING_STORAGE, items }); }, onStart: () => { engineRef.current?.startCraftRitual(); setCraftOpen(false); engineRef.current?.focusCanvas(); }, onClose: () => { setCraftOpen(false); engineRef.current?.focusCanvas(); } }) : null,
				chestOpen != null ? h(ChestModal, { key: 'chest', character, index: chestOpen, send, onClose: () => { setChestOpen(null); engineRef.current?.focusCanvas(); } }) : null,
				recordOpen != null ? h(RecordPlayerModal, { key: 'record', character, index: recordOpen, send, onPlay: (item, chestId) => engineRef.current?.playRecord(item, chestId), onPause: () => engineRef.current?.pauseRecord(), onResume: () => engineRef.current?.resumeRecord(), onStop: () => engineRef.current?.stopRecord(), getRecordState: () => engineRef.current?.recordState?.() ?? { chestId: null, item: null, paused: false }, onClose: () => { setRecordOpen(null); engineRef.current?.focusCanvas(); } }) : null,
				chestMenu != null ? (() => {
					const cm = character?.chests?.[chestMenu];
					const diamondCount = (character?.inventory ?? []).filter((x) => x === 'mat-diamond').length;
					const isDiamond = cm?.kind === 'diamond-chest' || ((cm?.slots?.length ?? 0) > 5);
					const canUpgrade = cm?.kind === 'chest' && diamondCount >= 5;
					return h(ChestActionModal, { key: 'chestmenu',
						title: cm?.kind === 'record-player' ? '🎵 唱片机' : isDiamond ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, [IMG({ key: 'i', src: '/vs-game/assets/items/mv/chest-blue.png', alt: '', style: { width: 22, height: 22, imageRendering: 'pixelated' } }), '钻石宝箱']) : '📦 木制宝箱',
						removeLabel: cm?.kind === 'record-player' ? '拆除' : '拆除（返还 1 木材）',
						onUpgrade: cm?.kind === 'chest' ? () => { send({ kind: ClientMsg.UPGRADE_CHEST, chestId: cm.id }); setChestMenu(null); engineRef.current?.focusCanvas(); } : null,
						canUpgrade,
						upgradeLabel: diamondCount >= 5 ? '升级为钻石宝箱（消耗 5 钻石）' : '钻石不足（需要 5 颗）',
						onOpen: () => { const i = chestMenu; if (character?.chests?.[i]?.kind === 'record-player') setRecordOpen(i); else setChestOpen(i); setChestMenu(null); engineRef.current?.focusCanvas(); },
						onRemove: () => { const c = character?.chests?.[chestMenu]; if (c) send({ kind: ClientMsg.REMOVE_CHEST, chestId: c.id }); setChestMenu(null); engineRef.current?.focusCanvas(); },
						onClose: () => { setChestMenu(null); engineRef.current?.focusCanvas(); },
					});
				})() : null,
				charOpen ? h(CharacterModal, { key: 'char', character, goldEarned, send, onClose: () => { setCharOpen(false); engineRef.current?.focusCanvas(); }, onPlaceChest: (item) => { setCharOpen(false); engineRef.current?.beginPlaceChest(item, item === 'record-player' ? 'record-player' : 'chest'); engineRef.current?.focusCanvas(); } }) : null,
			] });
		}

		// host 消息转发目标（useGameWs 在根组件，引擎在游戏窗口内；title = 标题流程在 GameWindow 内）
		const gameMsgTarget = { engine: null, title: null };

		/** 根组件：入口按钮 + 窗口开关 + WS 接入 */
		function VsGameRoot() {
			const [open, setOpen] = useState(typeof window !== 'undefined' && !!window.__VS_STANDALONE__);
			const [minimized, setMinimized] = useState(false);   // 「—」最小化：收起但保留进度，恢复不重播标题
			const [character, setCharacter] = useState(null);
			const [goldEarned, setGoldEarned] = useState(0);
			const [levels, setLevels] = useState(null);
			const helloRef = useRef(null); // 缓存 HELLO，防止窗口未打开时丢失持久化图鉴/最高分
			const onMsgRef = useRef(null);
			// 面板开关（🐟 按钮 / /vs 命令）：开着的时候关 = 真关闭（清最小化）；关着的时候开 = 按原样恢复
			const togglePanel = () => setOpen((o) => { if (o) setMinimized(false); return !o; });
			onMsgRef.current = (msg) => {
				if (msg.kind === HostMsg.TOGGLE_PANEL) { togglePanel(); return; }
				if (msg.kind === HostMsg.HELLO) {
					helloRef.current = msg;
					if (msg.character) setCharacter(msg.character);
					if (Array.isArray(msg.levels)) setLevels(msg.levels);
					const title = gameMsgTarget.title; // HELLO 带 saves：驱动开场动画/标题判定与"选档成功进游戏"
					if (title?.current) title.current(msg);
				}
				if (msg.kind === HostMsg.SAVE_SLOTS) {
					const title = gameMsgTarget.title;
					if (title?.current) title.current(msg);
					return; // 引擎不消费这条，不往下转发
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
			useEffect(() => { ensureSprites(); ensureSubSprites(); }, []);

			const standalone = typeof window !== 'undefined' && !!window.__VS_STANDALONE__;
			return h(ItemTipProvider, { key: 'tipwrap', children: hs('div', { className: 'dsh-vs-root', children: [
				h(GameWindow, { key: 'win', standalone, hidden: !standalone && !open, minimized, onMinimize: () => { setMinimized(true); setOpen(false); }, onClose: () => { setMinimized(false); setOpen(false); }, wsStatus: status, send, helloRef, character, goldEarned, levels }),
				!standalone ? h('button', {
					key: 'toggle',
					className: 'dsh-vs-toggle',
					title: '工作中的大肥鱼',
					onClick: togglePanel,
					children: '🐟',
				}) : null,
			] }) });
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
		exports.mountGame = function(container) {
			// 兜底：万一哪个图片漏了 draggable，也不让它拖出去
			if (container && !container.__vsNoDrag) {
				container.__vsNoDrag = true;
				container.addEventListener('dragstart', (e) => {
					const t = e.target;
					if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]')) return;
					e.preventDefault();
				}, true);
			}
			const ReactDOMClient = require('react-dom/client');
			const root = ReactDOMClient.createRoot(container);
			root.render(h(VsGameRoot, {}));
			return root;
		};
		return module.exports;
	}
});
