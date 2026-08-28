/**
 * ============================================================================
 * 关卡注册表（唯一数据源，host 经 HELLO.levels 下发 client）
 * ============================================================================
 *
 * 约定：每关一个独立文件（避免往同一文件堆内容），在此按章节顺序注册。
 * 布局字段规范见 busy-server.js 头部注释；引擎消费方：
 *   spawn/chests/camps → P2（client.seedLevel/reset）
 *   bossZone/boss      → P3
 *   story              → P5
 */
import busyServer from './busy-server.js';
import furiousUser from './furious-user.js';

export const LEVELS = [busyServer, furiousUser];

/** 无尽模式（金币本）：单屏旧战场，无营地无宝箱 */
export const ENDLESS = {
  id: null,
  name: '随便打打 · 金币本',
  world: { w: 840, h: 520 },
  theme: { bg: '#0b0d13', grid: 'rgba(79,110,247,0.05)' },
};
