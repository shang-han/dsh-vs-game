/**
 * ============================================================================
 * 饰品强化 —— 纯数值规则（服务端与客户端共用的口径）
 * ============================================================================
 * 这里刻意不 import 任何东西（不碰 zod / ws / DSH API），方便单元测试直接
 * `import('./enchant.js')`。浏览器半侧 lib/client.js 里有一份等价实现
 * （client 是打包进浏览器的 bundle，不能 import 本文件），改动时两边要同步。
 */

/** 幸运石物品 id（强化台右下角槽位放的就是它） */
export const LUCKY_STONE = 'mat-lucky-stone';
/** 每颗幸运石提供的成功率 */
export const LUCKY_BONUS = 0.1;
/** 每多嵌 1 条词条，基础成功率的递减步长 */
export const RATE_STEP = 0.1;

/** 第 idx 个孔（从 0 数）的基础成功率：100% / 90% / 80% / 70% / 60% / 50% … */
export function baseEnchantRate(idx) {
  const i = Math.max(0, Math.floor(Number(idx) || 0));
  return Math.max(0, 1 - RATE_STEP * i);
}

/** 把基础成功率补满到 100% 需要几颗幸运石（idx=0 本来就是 100%，返回 0） */
export function luckyNeeded(idx) {
  return Math.max(0, Math.round((1 - baseEnchantRate(idx)) * 10));
}

/** 最终成功率 = 基础成功率 + 每颗幸运石 +10%，总上限 100% */
export function enchantRate(idx, stones = 0) {
  const n = Math.max(0, Math.floor(Number(stones) || 0));
  return Math.min(1, baseEnchantRate(idx) + LUCKY_BONUS * n);
}

/** 第 idx 个孔的强化耗时（秒）：2 / 4 / 8 / 16 / 32 / 64 …（不封顶） */
export function enchantTime(idx) {
  const i = Math.max(0, Math.floor(Number(idx) || 0));
  return 2 * Math.pow(2, i);
}
