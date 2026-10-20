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
  /** 布景（代码美术，画在实体下层）：办公室——主走廊 / 茶水间 / 关底机房 */
  map: {
    ground: 'office',
    accent: '#4f6ef7',
    zones: [
      { x: 0, y: 610, w: 1900, h: 180, fill: 'rgba(79,110,247,0.055)' },
      { x: 40, y: 500, w: 240, h: 400, fill: 'rgba(250,204,21,0.04)', label: '茶水间' },
      { x: 1910, y: 470, w: 330, h: 460, fill: 'rgba(255,95,86,0.05)', line: 'rgba(255,95,86,0.3)', label: '机房重地' },
      { x: 270, y: 240, w: 300, h: 220, fill: 'rgba(79,110,247,0.04)' },
      { x: 480, y: 1000, w: 300, h: 220, fill: 'rgba(79,110,247,0.04)' },
      { x: 1180, y: 220, w: 320, h: 220, fill: 'rgba(79,110,247,0.04)' },
      { x: 1400, y: 950, w: 320, h: 220, fill: 'rgba(79,110,247,0.04)' },
    ],
    props: [
      { kind: 'lamp', x: 420, y: 700 }, { kind: 'lamp', x: 1520, y: 700, accent: '190,210,255' },
      { kind: 'column', x: 1932, y: 492 }, { kind: 'column', x: 1932, y: 908 },
      { kind: 'clock', x: 1120, y: 60 }, { kind: 'calendar', x: 1420, y: 60 },
      { kind: 'desk', x: 360, y: 160 }, { kind: 'desk', x: 600, y: 160, v: 1 }, { kind: 'desk', x: 840, y: 160, v: 2 },
      { kind: 'desk', x: 1240, y: 1180, v: 1 }, { kind: 'desk', x: 1480, y: 1180, v: 3 },
      { kind: 'desk', x: 720, y: 430 }, { kind: 'desk', x: 960, y: 430, v: 1 }, { kind: 'desk', x: 720, y: 990, v: 2 }, { kind: 'desk', x: 960, y: 990, v: 3 },
      { kind: 'chair', x: 720, y: 485 }, { kind: 'chair', x: 960, y: 485, v: 1 },
      { kind: 'chair', x: 360, y: 215 }, { kind: 'chair', x: 600, y: 215, v: 1 }, { kind: 'chair', x: 1480, y: 1235 },
      { kind: 'plant', x: 1150, y: 470 }, { kind: 'plant', x: 1150, y: 1330, v: 1 },
      { kind: 'cooler', x: 150, y: 780 }, { kind: 'plant', x: 90, y: 120 }, { kind: 'plant', x: 1830, y: 130, v: 1 },
      { kind: 'plant', x: 120, y: 1300, v: 2 }, { kind: 'plant', x: 1650, y: 1330 },
      { kind: 'bin', x: 300, y: 700 }, { kind: 'bin', x: 1560, y: 640, v: 1 },
      { kind: 'papers', x: 760, y: 620 }, { kind: 'papers', x: 1010, y: 660, v: 1 }, { kind: 'papers', x: 1350, y: 730, v: 2 },
      { kind: 'papers', x: 600, y: 900, v: 3 }, { kind: 'papers', x: 1650, y: 520 }, { kind: 'papers', x: 1780, y: 1050, v: 1 },
      { kind: 'cable', x: 500, y: 795, s: 1.6 }, { kind: 'cable', x: 1200, y: 790, s: 2.2, v: 1 }, { kind: 'cable', x: 900, y: 470, s: 1.5, v: 2 },
      { kind: 'rack', x: 1975, y: 560 }, { kind: 'rack', x: 2065, y: 560, v: 1 }, { kind: 'rack', x: 2155, y: 560, v: 2 },
      { kind: 'rack', x: 1975, y: 840, v: 1 }, { kind: 'rack', x: 2155, y: 840 },
      { kind: 'sign', x: 2100, y: 440, text: '⌨ 服务器机房' },
    ],
  },
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
    /** Boss 房主题：日报编辑部——截稿日办公室 */
    map: {
      ground: 'office',
      accent: '#8d6e63',
      zones: [
        { x: 120, y: 130, w: 600, h: 330, fill: 'rgba(141,110,99,0.10)' },
        { x: 0, y: 0, w: 840, h: 56, fill: 'rgba(255,255,255,0.025)' },
      ],
      props: [
        { kind: 'lamp', x: 90, y: 250 }, { kind: 'lamp', x: 760, y: 270, accent: '190,210,255' },
        { kind: 'clock', x: 420, y: 34 }, { kind: 'calendar', x: 580, y: 34 },
        { kind: 'sign', x: 150, y: 34, text: '📅 日报截止：今天' },
        { kind: 'desk', x: 170, y: 140, s: 1.2 }, { kind: 'chair', x: 170, y: 205, s: 1.2 },
        { kind: 'plant', x: 50, y: 110 }, { kind: 'plant', x: 790, y: 110, v: 1 },
        { kind: 'plant', x: 50, y: 460, v: 2 }, { kind: 'plant', x: 790, y: 460 },
        { kind: 'bin', x: 720, y: 430 }, { kind: 'papers', x: 320, y: 430 }, { kind: 'papers', x: 540, y: 460, v: 1 },
        { kind: 'papers', x: 640, y: 300, v: 2 }, { kind: 'cable', x: 380, y: 490, s: 1.4 },
      ],
    },
  },
  boss: {
    name: '日报.docx', label: 'DOCX', color: '#8d6e63',
    hp: 3000, size: 36, speed: 34, xp: 32,
    quip: '"日报也是要算 token 的。"',
  },
  story: {
    pre: [
      { speaker: '大肥鱼', text: '这里就是所说的用户派发的任务吗？' },
      { speaker: '大肥鱼', text: '可是，完全不知道要处理的文件在什么地方。' },
      { speaker: '大肥鱼', text: '先找找线索吧。' },
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
