/**
 * ============================================================================
 * dsh-vs-game —— session/event → 游戏燃料事件 纯归约器
 * ============================================================================
 *
 * 借鉴 dsh-dafeiyu 的纯 reducer 模式：无副作用、无 IO，输入 (session, event)，
 * 输出 0~n 条协议消息（host 直接广播给 client）。所有 event.data 访问用
 * 可选链 + try/catch，DSH 版本事件格式漂移时静默降级，绝不抛错。
 *
 * 燃料语义（与 client 半 GameEngine.handleHostMsg 对应）：
 *   spawn        { enemy, count, elite }   刷文件怪（工作额外加怪）
 *   drop-xp      { gems, value }           回合结束时的 token 经验结算
 *   wave-start   { wave }                  回合开始
 *   boss-spawn   { enemy, hp }             大回合 Boss
 *   buff         { buff, duration }        shield/freeze/chaos
 *   screen-nuke  {}                        回合结束/用户中止 → 全屏清怪
 *
 * 经验结算节奏（用户定的规则）：turn 内 token 只累积不掉落，
 * 回合结束（completed/aborted）时全屏清怪 + 一次性经验雨。
 */
import { classifyTool, enemyTypeOfPath } from './lang-map.js';

/** 本 turn 累计 token / 工具调用超过该阈值 → 出 Boss */
export const BOSS_TOKEN_THRESHOLD = 10000;
export const BOSS_TOOL_THRESHOLD = 15;

export class GameReducer {
  constructor() {
    this.turnDepth = 0;
    this.tokensThisTurn = 0;
    this.toolCallsThisTurn = 0;
    this.pendingXp = 0;   // 本 turn 累积待结算的经验
    this.wave = 0;
    this.lastFileType = 'misc';
    this.lastActivity = 0;
    this.totalTokens = 0;
  }

  /** 距离上次真实工作活动是否已空闲 */
  isIdle(now = Date.now()) {
    return this.lastActivity === 0 || now - this.lastActivity > 10_000;
  }

  /**
   * 处理一条会话事件，返回燃料消息数组（可能为空）。
   * @param {object} session - cordis session 对象（仅读 id/title 等展示信息）
   * @param {object} event   - { type, data } 会话事件
   */
  handle(session, event) {
    try {
      return this._handle(session, event);
    } catch {
      return [];
    }
  }

  _handle(session, event) {
    const type = event?.type;
    if (typeof type !== 'string') return [];
    const data = event?.data ?? {};
    const out = [];
    const touch = () => { this.lastActivity = Date.now(); };

    switch (type) {
      case 'user/message': {
        touch();
        break;
      }

      case 'assistant/message': {
        touch();
        const usage = data?.usage;
        if (usage && typeof usage === 'object') {
          const total = (Number(usage.inputTokens) || 0)
            + (Number(usage.outputTokens) || 0)
            + (Number(usage.cacheReadTokens) || 0) * 0.1
            + (Number(usage.cacheWriteTokens) || 0) * 0.1;
          if (total > 0) {
            this.tokensThisTurn += total;
            this.totalTokens += total;
            // 经验累积：100 token ≈ 1 XP，回合内只攒不掉落，turn 结束统一结算
            this.pendingXp = Math.min(400, this.pendingXp + Math.max(1, Math.round(total / 100)));
          }
        }
        break;
      }

      case 'tool/call': {
        touch();
        this.toolCallsThisTurn++;
        const cls = classifyTool(data?.name);
        if (cls === 'file') {
          let path;
          try { path = JSON.parse(data?.arguments ?? '{}')?.file_path; } catch { path = undefined; }
          const enemy = enemyTypeOfPath(path);
          this.lastFileType = enemy;
          out.push({ kind: 'spawn', enemy, count: 1, elite: false });
        } else if (cls === 'term') {
          this.lastFileType = 'term';
          out.push({ kind: 'spawn', enemy: 'term', count: 1, elite: false });
        } else if (cls === 'search') {
          this.lastFileType = 'search';
          out.push({ kind: 'spawn', enemy: 'search', count: 3, elite: false });
        }
        break;
      }

      case 'tool/result': {
        touch();
        // 工具报错 → 精英怪（红晕，3 倍血，掉落加倍）
        const hasError = data?.error != null
          || (typeof data?.result === 'string' && /error|exception|failed/i.test(data.result.slice(0, 200)));
        if (hasError) {
          out.push({ kind: 'spawn', enemy: this.lastFileType, count: 1, elite: true });
        }
        break;
      }

      case 'turn/start': {
        touch();
        this.turnDepth++;
        this.tokensThisTurn = 0;
        this.toolCallsThisTurn = 0;
        this.wave++;
        out.push({ kind: 'wave-start', wave: this.wave });
        break;
      }

      case 'turn/end': {
        touch();
        if (this.turnDepth > 0) this.turnDepth--;
        const reason = data?.reason?.kind ?? data?.kind;
        if (reason === 'blocked') {
          // 等待审批：工作暂停但未结束，经验继续挂着
          out.push({ kind: 'buff', buff: 'shield', duration: 5 });
          break;
        }
        // completed / aborted：工作结束 → 全屏清怪 + 结算累积经验
        out.push({ kind: 'screen-nuke' });
        if (this.pendingXp > 0) {
          const xp = this.pendingXp;
          const gems = Math.min(12, Math.max(1, Math.ceil(xp / 10)));
          out.push({ kind: 'drop-xp', gems, value: Math.round((xp / gems) * 10) / 10 });
          this.pendingXp = 0;
        }
        if (reason !== 'aborted'
          && (this.tokensThisTurn > BOSS_TOKEN_THRESHOLD || this.toolCallsThisTurn > BOSS_TOOL_THRESHOLD)) {
          out.push({
            kind: 'boss-spawn',
            enemy: this.lastFileType,
            hp: Math.round(50 + this.tokensThisTurn / 200),
          });
        }
        break;
      }

      case 'approval/asked': {
        touch();
        out.push({ kind: 'buff', buff: 'freeze', duration: 10 });
        break;
      }

      case 'llm/retry': {
        touch();
        out.push({ kind: 'buff', buff: 'chaos', duration: 8 });
        break;
      }

      default:
        break;
    }
    return out;
  }
}
