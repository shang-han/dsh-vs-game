/**
 * 第 4 章 · 积压如山
 * 和第 3 关同源（文件怪掉文件 → 放回对应文件夹），但工作量翻十倍：
 *   · 开局地上就摊着 60 个文件（不会消失），打怪还会继续掉
 *   · 需要归档 100 个
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
  /** 整理玩法：中央刷怪口 + 4 个归档文件夹 + 规则表；本关要 100 个，开局有 60 个存量 */
  sort: {
    need: 100,
    dropTtl: 30,
    initialFiles: 60,
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
      { speaker: '系统', text: '归档完成 100/100' },
      { speaker: '大肥鱼', text: '（终于……搬完了）' },
    ],
    artPost: 'assets/image/dafeiyu-4.png',
    bossIntro: [
      { speaker: '大肥鱼', text: '（这些是没做完的，还是没开始做的？）' },
    ],
  },
  firstClearGold: 1200,
};
