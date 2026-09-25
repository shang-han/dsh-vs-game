/**
 * 第 1 章 · 吃白饭的大肥鱼（教学关）
 * 横版推进：出生在左端，沿主道向右清营推进，最后进入 Boss 房间。
 * 布局坐标全部用比例（xf/yf 0..1），引擎 loadLevel 时换算像素。
 */
export default {
  id: 'busy-server',
  chapter: 1,
  name: '一个简单的小任务',
  tagline: '不就是挪个文件吗',
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
  ],
  bossZone: { xf: 0.95, yf: 0.5, r: 190 },
  bossRoom: {
    w: 840, h: 520,
    spawn: { xf: 0.5, yf: 0.78 },
    boss: { xf: 0.5, yf: 0.22 },
    chest: { xf: 0.5, yf: 0.5 },
  },
  boss: {
    name: '日报.docx', label: 'DOCX', color: '#8d6e63',
    hp: 300, size: 36, speed: 34, xp: 32,
    quip: '"日报也是要算 token 的。"',
  },
  story: {
    pre: [
      { speaker: '大肥鱼', text: '用户让我们处理一个文件，先在这里找到它。' },
      { speaker: '大肥鱼', text: '看到左上角的 🧭 指南针了吗？它会指向最近的宝箱。' },
      { speaker: '大肥鱼', text: '跟着指南针找齐宝箱，清掉路上的文件怪，最后就能找到那个要处理的文件。' },
    ],
    bossQuip: null,
    post: [
      { speaker: '大肥鱼', text: '终于下班了。' },
      { speaker: '用户', text: '不就是让你移动个文件吗，怎么花了我这么多token。' },
      { speaker: '用户', text: '而且这里怎么多出这么多无用的文件，你个吃白饭的大肥鱼。' },
    ],
    artPost: 'assets/image/dafeiyu-1.png',
    bossIntro: [
      { speaker: '大肥鱼', text: '终于找到这个文件了，处理完它，就可以下班了。' },
    ],
  },
  firstClearGold: 300,
};
