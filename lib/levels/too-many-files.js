/**
 * 第 4 章 · 积压如山
 * 和第 3 关同源（文件怪掉文件 → 放回对应文件夹），但工作量翻十倍：
 *   · 开局地上就摊着 30 个文件（不会消失），打怪还会继续掉
 *   · 需要归档 50 个
 *   · 一个人搬不完 → 左上角按钮派出 5 个子代理，它们自动捡文件送进文件夹
 * 布局坐标全部用比例（xf/yf 0..1），引擎 loadLevel 时换算像素。
 */
export default {
  id: 'too-many-files',
  chapter: 4,
  name: '积压如山',
  tagline: '一个人搬不完，得叫子代理',
  world: { w: 2800, h: 1900 },
  theme: { bg: '#101014', grid: 'rgba(140,190,150,0.045)', lane: 'rgba(140,190,150,0.08)' },
  /** 布景：积压仓库——四角积压区 + 子代理搬运主路（十字亮带） */
  map: {
    lane: false,
    zones: [
      { x: 0, y: 890, w: 2800, h: 190, fill: 'rgba(140,190,150,0.045)' },
      { x: 1300, y: 0, w: 190, h: 1900, fill: 'rgba(140,190,150,0.035)' },
      { x: 180, y: 150, w: 620, h: 480, fill: 'rgba(138,107,61,0.05)' },
      { x: 2020, y: 150, w: 620, h: 480, fill: 'rgba(138,107,61,0.05)' },
      { x: 180, y: 1300, w: 620, h: 460, fill: 'rgba(138,107,61,0.05)' },
      { x: 2020, y: 1300, w: 620, h: 460, fill: 'rgba(138,107,61,0.05)' },
    ],
    props: [
      { kind: 'kanban', x: 1400, y: 70 },
      { kind: 'sticky', x: 700, y: 80 }, { kind: 'sticky', x: 2100, y: 80, v: 1 },
      { kind: 'pile', x: 350, y: 300 }, { kind: 'pile', x: 600, y: 420, v: 1 }, { kind: 'pile', x: 300, y: 500, v: 2, s: 1.2 },
      { kind: 'pile', x: 2250, y: 320, v: 1 }, { kind: 'pile', x: 2500, y: 450 }, { kind: 'pile', x: 2200, y: 1520, v: 2 },
      { kind: 'pile', x: 450, y: 1450, v: 3, s: 1.1 }, { kind: 'pile', x: 2450, y: 1560 },
      { kind: 'crate', x: 800, y: 1500 }, { kind: 'crate', x: 900, y: 1560, v: 1 }, { kind: 'crate', x: 1900, y: 320, v: 2 },
      { kind: 'cart', x: 1150, y: 980 }, { kind: 'cart', x: 1750, y: 1700, v: 1 },
      { kind: 'papers', x: 1000, y: 800, v: 1 }, { kind: 'papers', x: 1600, y: 1100 }, { kind: 'papers', x: 2000, y: 900, v: 2 },
      { kind: 'bin', x: 2700, y: 940 }, { kind: 'calendar', x: 300, y: 80 },
    ],
  },
  spawn: { xf: 0.5, yf: 0.93 },
  /** 本关：小怪血量下限更高、刷得更凶，但精英率略降（要留出搬运时间） */
  balance: {
    hpFloor: 900,
    hpPerTier: 0.22,
    eliteMul: 8,
    dmgMul: 1.5,
    speedMul: 1.15,
    spawnMul: 1.6,
    eliteChance: 0.14,
  },
  /** 整理玩法：中央刷怪口 + 4 个归档文件夹 + 规则表；本关要 50 个，开局存量只有 30 个（不够，得打怪继续掉） */
  sort: {
    need: 50,
    dropTtl: 30,
    initialFiles: 30,
    folders: [
      { id: 'workspace', label: 'workspace/', xf: 0.5,  yf: 0.5,  gate: true },
      { id: 'src',    label: 'src/',    xf: 0.10, yf: 0.10 },
      { id: 'docs',   label: 'docs/',   xf: 0.90, yf: 0.10 },
      { id: 'config', label: 'config/', xf: 0.10, yf: 0.90 },
      { id: 'tmp',    label: '_tmp/',   xf: 0.90, yf: 0.90 },
    ],
    rules: [
      { exts: ['.ts', '.js', '.py', '.go', '.rs', '.html'], folder: 'src' },
      { exts: ['.md', '.txt'], folder: 'docs' },
      { exts: ['.json', '.yaml', '.toml'], folder: 'config' },
      { exts: ['.log', '.tmp', '.bak', '.cache'], folder: 'tmp' },
    ],
  },
  /** 子代理：5 个，速度是玩家的 0.72 倍，捡/放各要停一下 */
  agents: {
    count: 5,
    speedMul: 0.95,
    pickTime: 0.25,
    dropTime: 0.28,
  },
  bossZone: { xf: 0.5, yf: 0.5, r: 120 },
  bossRoom: {
    w: 840, h: 520,
    spawn: { xf: 0.5, yf: 0.78 },
    boss: { xf: 0.5, yf: 0.22 },
    chest: { xf: 0.5, yf: 0.5 },
    /** Boss 房主题：待办仓库——看板 + 便签墙 + 纸箱塔 */
    map: {
      zones: [
        { x: 150, y: 100, w: 540, h: 340, fill: 'rgba(138,107,61,0.09)' },
      ],
      props: [
        { kind: 'kanban', x: 420, y: 40, s: 1.1 },
        { kind: 'sticky', x: 160, y: 60 }, { kind: 'sticky', x: 680, y: 60, v: 1 },
        { kind: 'crate', x: 80, y: 180 }, { kind: 'crate', x: 80, y: 290, v: 1 }, { kind: 'crate', x: 760, y: 180, v: 2 }, { kind: 'crate', x: 760, y: 320 },
        { kind: 'pile', x: 200, y: 460 }, { kind: 'pile', x: 620, y: 470, v: 1 },
        { kind: 'cart', x: 420, y: 480 },
        { kind: 'calendar', x: 300, y: 40 }, { kind: 'papers', x: 350, y: 300, v: 1 }, { kind: 'papers', x: 500, y: 250, v: 2 },
      ],
    },
  },
  boss: {
    name: '积压的待办', label: 'BACKLOG', color: '#8a6b3d',
    hp: 15000, size: 56, speed: 30, xp: 160,
    quip: '"这一堆……都是上个月欠下的。"',
  },
  story: {
    pre: [
      { speaker: '大肥鱼', text: '（地上全是文件……）' },
      { speaker: '大肥鱼', text: '这堆东西靠我一个人搬不完。' },
      { speaker: '大肥鱼', text: '派几个子代理出来帮忙吧。' },
      { speaker: '大肥鱼', text: '左上角点「派出子代理」，它们会自己捡文件归档。' },
    ],
    bossQuip: null,
    post: [
      { speaker: '系统', text: '归档完成 50/50' },
      { speaker: '大肥鱼', text: '（终于……搬完了）' },
    ],
    artPost: 'assets/image/dafeiyu-4.png',
    bossIntro: [
      { speaker: '大肥鱼', text: '（这些是没做完的，还是没开始做的？）' },
    ],
  },
  firstClearGold: 1200,
};
