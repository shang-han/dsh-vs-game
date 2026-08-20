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
  /** 成绩/图鉴回执：{ kind:'saved', bestScore:number, totalKills:number } */
  SAVED: 'saved',
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
