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
    name: 'DSH 文件夹', label: 'DSH', color: '#8fe3f2',
    hp: 520, size: 46, speed: 50, xp: 60,
    quip: '"未授权访问：用户文件不可查看。"',
  },
  story: {
    pre: [
      { speaker: '用户', text: '哎，你还是帮我把这些文件整理一下，那些无用的文件你直接删了就行。' },
      { speaker: '大肥鱼', text: '收到，整理文件我最擅长了。' },
    ],
    bossQuip: null,
    post: [
      { speaker: '大肥鱼', text: '我注意到有个DSH文件夹。' },
      { speaker: '系统', text: '（用户终止输出）' },
      { speaker: '用户', text: 'DSH文件夹就是你自己啊，算了，防止这个大肥鱼乱看，还是给它规定个工作区吧。' },
    ],
    artPost: 'assets/image/dafeiyu-2.png',
    bossIntro: [
      { speaker: '大肥鱼', text: '这个DSH是什么，大烧货吗，' },
      { speaker: '大肥鱼', text: '不对，我不能查看用户的...' },
      { speaker: '大肥鱼', text: '但是就看一眼应该没关系的吧。' },
    ],
  },
  firstClearGold: 500,
};
