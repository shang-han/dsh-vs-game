/**
 * 第 2 章 · 用户彻底怒了
 * 更大的战场、更密的混编营地、报错弹幕量翻倍（eliteCount 词缀 P3 消费）。
 */
export default {
  id: 'furious-user',
  chapter: 2,
  name: '用户彻底怒了',
  tagline: '嗯……开幕雷击',
  world: { w: 2800, h: 1800 },
  theme: { bg: '#100b13', grid: 'rgba(255,95,86,0.05)', lane: 'rgba(255,95,86,0.09)' },
  spawn: { xf: 0.05, yf: 0.5 },
  camps: [
    { xf: 0.11, yf: 0.35, type: 'js', count: 6 },
    { xf: 0.16, yf: 0.7,  type: 'html', count: 6 },
    { xf: 0.24, yf: 0.25, type: 'search', count: 10 },
    { xf: 0.3,  yf: 0.6,  type: 'ts', count: 8 },
    { xf: 0.38, yf: 0.85, type: 'py', count: 7 },
    { xf: 0.44, yf: 0.3,  type: 'go', count: 7 },
    { xf: 0.52, yf: 0.65, type: 'config', count: 8 },
    { xf: 0.6,  yf: 0.25, type: 'rs', count: 6 },
    { xf: 0.66, yf: 0.75, type: 'bin', count: 5 },
    { xf: 0.74, yf: 0.4,  type: 'term', count: 5 },
    { xf: 0.82, yf: 0.6,  type: 'rs', count: 8, elite: true }, // 精英前哨
  ],
  chests: [
    { xf: 0.2,  yf: 0.9,  tier: 'blue' },
    { xf: 0.42, yf: 0.12, tier: 'blue' },
    { xf: 0.58, yf: 0.88, tier: 'blue' },
    { xf: 0.72, yf: 0.18, tier: 'blue' },
    { xf: 0.9,  yf: 0.5,  tier: 'gold', chestGuard: true },
  ],
  bossZone: { xf: 0.955, yf: 0.5, r: 210 },
  boss: {
    name: '彻底怒了.tgz', title: '赛博台风眼', label: '怒了', color: '#c62828',
    hp: 460, size: 38, speed: 42, xp: 55,
    quip: '"六个小时！六个小时你只回了四个字！"',
  },
  story: { pre: null, bossQuip: null, post: null, artPost: null },
  firstClearGold: 500,
};
