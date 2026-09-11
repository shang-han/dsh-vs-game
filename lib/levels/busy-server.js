/**
 * 第 1 章 · 吃白饭的大肥鱼（教学关）
 * 横版推进：出生在左端，沿主道向右清营推进，最后进入 Boss 房间。
 * 布局坐标全部用比例（xf/yf 0..1），引擎 loadLevel 时换算像素。
 */
export default {
  id: 'busy-server',
  chapter: 1,
  name: '吃白饭的大肥鱼',
  tagline: '怎么花了我这么多的token',
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
    { xf: 0.45, yf: 0.6,  tier: 'blue' },
  ],
  bossZone: { xf: 0.95, yf: 0.5, r: 190 },
  bossRoom: {
    w: 840, h: 520,
    spawn: { xf: 0.5, yf: 0.78 },
    boss: { xf: 0.5, yf: 0.22 },
    chest: { xf: 0.5, yf: 0.5 },
  },
  boss: {
    name: '.temp 文件夹', title: '吃白饭的大肥鱼', label: 'TEMP', color: '#8d6e63',
    hp: 300, size: 36, speed: 34, xp: 32,
    quip: '"临时文件也是要算钱的。"',
  },
  story: {
    pre: null, bossQuip: null, post: null,
    artPost: 'assets/image/dafeiyu-1.png',
    bossIntro: [
      { speaker: '用户', text: '怎么花了我这么多的token，你这个吃白饭的蓝色大肥鱼。' },
      { speaker: '大肥鱼', text: '我不是大肥鱼...' },
    ],
  },
  firstClearGold: 300,
};
