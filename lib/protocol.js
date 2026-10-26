/**
 * ============================================================================
 * dsh-vs-game —— host ↔ client WebSocket 消息协议
 * ============================================================================
 *
 * 传输约定：
 *   - WebSocket 文本帧，每条消息一行 JSON（以 '\n' 分隔）
 *   - 一帧可能包含多条消息：解码时按 '\n' 切分逐条 parse
 *   - 所有消息带 v:1 版本字段，便于将来演进
 *
 * 注意：client 半（lib/client.js）运行在 DSH 的 ModuleLoader 沙箱里，
 * 无法 import 本文件，因此 client 内联了一份相同的常量（见 client.js 协议区）。
 * 修改协议时两处必须同步。
 */

/** host → client 消息类型 */
export const HostMsg = Object.freeze({
  /** 连接建立：{ v, kind:'hello', snapshot:{ lastActivity, totalTokens }, config } */
  HELLO: 'hello',
  /** 生成敌人：{ kind:'spawn', enemy:string, count:number, elite:boolean } */
  SPAWN: 'spawn',
  /** 掉落经验宝石：{ kind:'drop-xp', gems:number, value:number } */
  DROP_XP: 'drop-xp',
  /** 波次开始：{ kind:'wave-start', wave:number } */
  WAVE_START: 'wave-start',
  /** 波次清空奖励：{ kind:'wave-clear', bonusXp:number } */
  WAVE_CLEAR: 'wave-clear',
  /** Boss 出现：{ kind:'boss-spawn', boss:string, hp:number, tags:string[] } */
  BOSS_SPAWN: 'boss-spawn',
  /** 增益/减益：{ kind:'buff', buff:'shield'|'freeze'|'chaos', duration:number } */
  BUFF: 'buff',
  /** 全屏清怪：{ kind:'screen-nuke' } */
  SCREEN_NUKE: 'screen-nuke',
  /** 空闲保底刷怪：{ kind:'idle-spawn', difficulty:number } */
  IDLE_SPAWN: 'idle-spawn',
  /** 空闲 Boss：{ kind:'idle-boss', hp:number } */
  IDLE_BOSS: 'idle-boss',
  /** 配置下发：{ kind:'config', config:{...} } */
  CONFIG: 'config',
  /** 切换游戏面板显隐：{ kind:'toggle-panel' } */
  TOGGLE_PANEL: 'toggle-panel',
  /** 关底翻卡发牌：{ kind:'cards', cards:[{kind:'acc'|'mat'|'gold', item?, amount?}], freeFlips, extraCost, firstClear, firstClearGold } */
  CARDS: 'cards',
  /** 翻卡结果：{ kind:'card-result', index, card, character } */
  CARD_RESULT: 'card-result',
  /** 成绩/图鉴回执：{ kind:'saved', bestScore:number, totalKills:number, goldEarned:number, character:object } */
  SAVED: 'saved',
  /** 角色数据同步：{ kind:'character', character:{ gold, initialWeapon, passives, inventory, accessories, activeSkill } } */
  CHARACTER: 'character',
  HOME_MESSAGE: 'home-message',
  /** 多存档槽位摘要：{ kind:'save-slots', saves:{ activeSlot, introSeen, slots:[{id,exists,gold,kills,rooms,cleared,savedAt}] }, error?:string } */
  SAVE_SLOTS: 'save-slots',
});

/** client → host 消息类型 */
export const ClientMsg = Object.freeze({
  /** 开始新局：{ kind:'game-start' } */
  GAME_START: 'game-start',
  /**
   * 结算上报：
   * { kind:'game-over', score, kills, duration, level, discovered:string[] }
   */
  GAME_OVER: 'game-over',
  /** 保活：{ kind:'heartbeat' } */
  HEARTBEAT: 'heartbeat',
  /** 修改初始武器：{ kind:'set-initial-weapon', weapon:string } */
  SET_INITIAL_WEAPON: 'set-initial-weapon',
  /** 升级初始被动：{ kind:'upgrade-passive', passive:string } */
  UPGRADE_PASSIVE: 'upgrade-passive',
  /** 打开背包物品：{ kind:'open-item', item:string } */
  OPEN_ITEM: 'open-item',
  EQUIP_SKILL: 'equip-skill',
  EQUIP_ACCESSORY: 'equip-accessory',
  PLACE_CHEST: 'place-chest',
  EJECT_CONTAINER_ITEM: 'eject-container-item',
  UPGRADE_CHEST: 'upgrade-chest',
  REMOVE_CHEST: 'remove-chest',
  PICKUP_GROUND: 'pickup-ground',
  /** 解锁家房间：{ kind:'unlock-room', room:number }，需消耗对应碎片（虚拟海边=5 个 frag-room3） */
  UNLOCK_ROOM: 'unlock-room',
  /** 把物品丢到家里地面：{ kind:'drop-ground', item:string, x:number, y:number, room:number } */
  DROP_GROUND: 'drop-ground',
  /** 投放鱼饵：{ kind:'use-bait' }，服务端扣 1 个 bait-pixel */
  USE_BAIT: 'use-bait',
  /** 子代理捡起：{ kind:'agent-pickup', groundId:string, slot:number } —— 地面物品立刻消失，记在该代理的「手上一格」（每代理一格） */
  AGENT_PICKUP: 'agent-pickup',
  /** 子代理送达：{ kind:'agent-deliver', slot:number, chestId?:string, x?:number, y?:number, room?:number }（无 chestId=入玩家背包；放不下就按 x/y 掉回地上） */
  AGENT_DELIVER: 'agent-deliver',
  CHEST_TRANSFER: 'chest-transfer',
  SET_CRAFTING_STORAGE: 'set-crafting-storage',
  /** 打造放置：{ kind:'build-place', item:string, room:number, x:number, y:number } */
  BUILD_PLACE: 'build-place',
  /** 树场砍木材：{ kind:'chop-tree', deviceId:string } */
  CHOP_TREE: 'chop-tree',
  /** 器械采集（树场砍木材 / 矿场挖矿）：{ kind:'gather', deviceId:string } */
  GATHER: 'gather',
  /**
   * 饰品强化：{ kind:'enchant', baseId:string, materialId:string, lucky?:number }
   * lucky = 本次投入的幸运石数量（每颗 +10% 成功率，总上限 100%），服务端会按「拉满所需」截断并校验背包
   */
  ENCHANT: 'enchant',
  /**
   * 强化台装填/取回：{ kind:'enchant-stage', baseId, materialId, lucky } 或 { kind:'enchant-stage', clear:true }
   * 装填时服务端把基底/材料/幸运石从背包移进「台面上的暂存区」（防重复使用，刷新也还在）；
   * clear=true 把暂存区原样退回背包。
   */
  ENCHANT_STAGE: 'enchant-stage',
  /** 饰品锻造台：{ kind:'forge-craft', item:string } —— 立刻扣材料并排一个计时任务（按品质 1/3/5/10/30s） */
  FORGE_CRAFT: 'forge-craft',
  /** 锻造进度走满：{ kind:'forge-sync' } —— 服务端把到点任务结算进成品仓并回传角色 */
  FORGE_SYNC: 'forge-sync',
  /** 取出成品：{ kind:'forge-take', item:string } —— 成品仓里该饰品整堆进背包 */
  FORGE_TAKE: 'forge-take',
  /** 唱片机升级为智能唱片机：{ kind:'upgrade-record', chestId } —— 花 3 个紫晶锭 */
  UPGRADE_RECORD: 'upgrade-record',
  /** 智能唱片机播放模式：{ kind:'record-mode', chestId, mode:'single'|'loop'|'seq' } */
  RECORD_MODE: 'record-mode',
  /** 施工完成（虚影 → 建成）：{ kind:'build-finish', deviceId:string } */
  BUILD_FINISH: 'build-finish',
  /** 招募子代理（金币）：{ kind:'hire-agent' }，第 n 个花 n×10000 金币，最多 5 个 */
  HIRE_AGENT: 'hire-agent',
  /** 给子代理派活：{ kind:'set-agent-task', index:number, task:'idle'|'tree-farm'|'mine' } */
  SET_AGENT_TASK: 'set-agent-task',
  /** 编辑模式移动：{ kind:'move-home-item', target:'chest'|'device', id:string, room:number, x:number, y:number } */
  MOVE_HOME_ITEM: 'move-home-item',
  /** 编辑模式拆除：{ kind:'demolish-home-item', target:'chest'|'device', id:string } */
  DEMOLISH_HOME_ITEM: 'demolish-home-item',
  /** 升级矿场：{ kind:'upgrade-mine', deviceId:string } —— 1→2→3，服务端校验材料与等级 */
  UPGRADE_MINE: 'upgrade-mine',
  /** 矿场装/卸钻机：{ kind:'toggle-drill', deviceId:string } */
  TOGGLE_DRILL: 'toggle-drill',
  /** 实验室修复：{ kind:'lab-repair' } —— 按当前阶段扣材料并推进 */
  LAB_REPAIR: 'lab-repair',
  /** 工业网格放置：{ kind:'lab-place', kindId:string, x:number, y:number, dir:number } */
  LAB_PLACE: 'lab-place',
  /** 工业网格移动/旋转/拆除：{ kind:'lab-move'|'lab-rotate'|'lab-remove', id } */
  LAB_MOVE: 'lab-move',
  LAB_ROTATE: 'lab-rotate',
  LAB_REMOVE: 'lab-remove',
  /** 设置过滤/模式：{ kind:'lab-set', id, filter?:string[], mode?:'alt'|'filter' } */
  LAB_SET: 'lab-set',
  /** 箱子手动存取：{ kind:'lab-transfer', id, slot:number, dir:'in'|'out', count:number } */
  LAB_TRANSFER: 'lab-transfer',
  /** 客户端 tick 同步：{ kind:'lab-sync', cells:[...], power:{stored,brownout}, store:{...} } */
  LAB_SYNC: 'lab-sync',
  /** 从成品仓取出：{ kind:'lab-take', item:string, count:number } */
  LAB_TAKE: 'lab-take',
  /** 手动投料：{ kind:'lab-insert', id:string, item:string, count:number } */
  LAB_INSERT: 'lab-insert',
  /** 手摇发电：{ kind:'lab-power', action:'crank' } */
  LAB_POWER: 'lab-power',
  /** 选组装台配方：{ kind:'lab-recipe', id:string, recipe:string } */
  LAB_RECIPE: 'lab-recipe',
  /** 升级熔炉 → 精炼炉：{ kind:'lab-upgrade', id:string } */
  LAB_UPGRADE: 'lab-upgrade',
  UNEQUIP_ACCESSORY: 'unequip-accessory',
  /** 宝箱开箱入账：{ kind:'chest-loot', gold:number, item:string|null } */
  CHEST_LOOT: 'chest-loot',
  /** 击杀关底 Boss（请求发牌）：{ kind:'boss-kill', levelId:string } */
  BOSS_KILL: 'boss-kill',
  /** 翻某张卡：{ kind:'flip-pick', index:number } */
  FLIP_PICK: 'flip-pick',
  /** 付费加翻：{ kind:'flip-extra' } */
  FLIP_EXTRA: 'flip-extra',
  /** 合成物品：{ kind:'craft-item', item:string } */
  CRAFT_ITEM: 'craft-item',
  /** 出售物品：{ kind:'sell-item', item:string } */
  SELL_ITEM: 'sell-item',
  BUY_ITEM: 'buy-item',
  /** 关卡内商店购买：{ kind:'level-shop-buy', item:string }，价格以服务端 LEVEL_SHOP 表为准 */
  LEVEL_SHOP_BUY: 'level-shop-buy',
  /** 请求存档槽位摘要：{ kind:'save-list' } */
  SAVE_LIST: 'save-list',
  /** 切换到已有存档：{ kind:'save-select', slot:string }（宿主回 HELLO + SAVE_SLOTS） */
  SAVE_SELECT: 'save-select',
  /** 新档开荒（清空目标槽并切换）：{ kind:'save-new', slot:string } */
  SAVE_NEW: 'save-new',
  /** 开场动画已看过：{ kind:'intro-seen' } */
  INTRO_SEEN: 'intro-seen',
});

/** 编码一条消息为一行 JSON 文本 */
export function encodeMsg(msg) {
  return JSON.stringify({ v: 1, ...msg }) + '\n';
}

/** 解码一个 WebSocket 文本帧为一组消息（容错：坏行跳过） */
export function decodeFrame(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // 静默跳过坏行：协议容错优先
    }
  }
  return out;
}
