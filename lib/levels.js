/**
 * ============================================================================
 * dsh-vs-game —— 关卡定义表（唯一数据源，host 经 HELLO/config 下发 client）
 * ============================================================================
 *
 * 一期 2 关（P1 先全开放；通关锁定逻辑 P3 接 boss 结算后启用）。
 * 字段说明：
 *   world      世界尺寸（相机跟随视口 840×520 滚动）
 *   theme      背景底色/网格色（drawBackground 消费）
 *   spawnPool  本关杂兵池（P4 经验/联动改造时消费；null = 用全局 TIERS_BY_TIME）
 *   chests     宝箱点位（P2 消费）
 *   boss       Boss 配置（P3 消费）
 *   story      三段剧情槽（文本作者提供，P5 消费；art 为图片槽位）
 */
export const LEVELS = [
  {
    id: 'busy-server',
    chapter: 1,
    name: '服务器繁忙',
    tagline: '今晚，她是一台坏掉的服务器',
    world: { w: 2240, h: 1400 },
    theme: { bg: '#0b0d13', grid: 'rgba(79,110,247,0.05)' },
    spawnPool: null,
    chests: [],
    boss: null,
    story: { pre: null, bossQuip: null, post: null, artPost: 'assets/image/dafeiyu-1.png' },
    firstClearGold: 300,
  },
  {
    id: 'furious-user',
    chapter: 2,
    name: '用户彻底怒了',
    tagline: '嗯……开幕雷击',
    world: { w: 2800, h: 1800 },
    theme: { bg: '#100b13', grid: 'rgba(255,95,86,0.05)' },
    spawnPool: null,
    chests: [],
    boss: null,
    story: { pre: null, bossQuip: null, post: null, artPost: null },
    firstClearGold: 500,
  },
];

/** 无尽模式（金币本）：单屏旧战场 */
export const ENDLESS = {
  id: null,
  name: '随便打打 · 金币本',
  world: { w: 840, h: 520 },
  theme: { bg: '#0b0d13', grid: 'rgba(79,110,247,0.05)' },
};
