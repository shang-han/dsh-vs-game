/**
 * 第 2 章 · dsh文件夹是什么
 * 更大的战场、更密的混编营地，最后 Boss 是大型搜索碎片。
 */
export default {
  id: 'furious-user',
  chapter: 2,
  name: 'dsh文件夹是什么',
  tagline: '这个dsh文件夹是什么，大烧货吗',
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
  ],
  bossZone: { xf: 0.955, yf: 0.5, r: 210 },
  bossRoom: {
    w: 840, h: 520,
    spawn: { xf: 0.5, yf: 0.78 },
    boss: { xf: 0.5, yf: 0.22 },
    chest: { xf: 0.5, yf: 0.5 },
  },
  boss: {
    name: '大型搜索碎片', title: '大烧货？', label: 'SEARCH', color: '#8fe3f2',
    hp: 520, size: 46, speed: 50, xp: 60,
    quip: '"搜遍了整个磁盘，也没找到你要的 dsh。"',
  },
  story: {
    pre: null, bossQuip: null, post: null,
    artPost: 'assets/image/dafeiyu-2.png',
    bossIntro: [
      { speaker: '大肥鱼', text: '思考中……' },
      { speaker: '大肥鱼', text: '这个dsh文件夹是什么，大烧货吗。' },
    ],
  },
  firstClearGold: 500,
};
