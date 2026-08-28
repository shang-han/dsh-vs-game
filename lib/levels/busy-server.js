/**
 * 第 1 章 · 服务器繁忙（教学关）
 * 横版推进：出生在左端，沿主道向右清营推进，金箱守箱精英，关底 Boss 圈。
 * 布局坐标全部用比例（xf/yf 0..1），引擎 loadLevel 时换算像素。
 */
export default {
  id: 'busy-server',
  chapter: 1,
  name: '服务器繁忙',
  tagline: '今晚，她是一台坏掉的服务器',
  world: { w: 2240, h: 1400 },
  theme: { bg: '#0b0d13', grid: 'rgba(79,110,247,0.05)', lane: 'rgba(79,110,247,0.10)' },
  spawn: { xf: 0.055, yf: 0.5 },
  camps: [
    { xf: 0.13, yf: 0.5,  type: 'misc', count: 4 },       // 教学小营：贴脸开局就能打
    { xf: 0.22, yf: 0.24, type: 'docs', count: 5 },
    { xf: 0.27, yf: 0.74, type: 'config', count: 5 },
    { xf: 0.38, yf: 0.45, type: 'js', count: 6 },
    { xf: 0.46, yf: 0.18, type: 'shell', count: 4 },
    { xf: 0.52, yf: 0.8,  type: 'py', count: 6 },
    { xf: 0.62, yf: 0.35, type: 'search', count: 8 },
    { xf: 0.68, yf: 0.68, type: 'ts', count: 6 },
    { xf: 0.76, yf: 0.25, type: 'go', count: 5 },
    { xf: 0.8,  yf: 0.55, type: 'term', count: 3 },
    { xf: 0.88, yf: 0.45, type: 'rs', count: 6 },          // 关底营
  ],
  chests: [
    { xf: 0.22, yf: 0.86, tier: 'blue' },
    { xf: 0.45, yf: 0.6,  tier: 'blue' },
    { xf: 0.66, yf: 0.12, tier: 'blue' },
    { xf: 0.9,  yf: 0.5,  tier: 'gold', chestGuard: true }, // 守箱精英见 seedLevel
  ],
  bossZone: { xf: 0.95, yf: 0.5, r: 190 },                 // P3 消费
  story: { pre: null, bossQuip: null, post: null, artPost: 'assets/image/dafeiyu-1.png' },
  firstClearGold: 300,
};
