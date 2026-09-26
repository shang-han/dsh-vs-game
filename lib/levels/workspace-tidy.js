/**
 * 第 3 章 · 整理工作区
 * 中央 workspace/ 文件夹源源不断冒文件怪；打死它们会掉出文件，
 * 把文件放进对应的文件夹，放对 10 次后 workspace/ 打开 → 进去打 _tmp Boss。
 * 布局坐标全部用比例（xf/yf 0..1），引擎 loadLevel 时换算像素。
 */
export default {
  id: 'workspace-tidy',
  chapter: 3,
  name: '整理工作区',
  tagline: '把文件放回它该在的地方',
  world: { w: 2800, h: 1800 },
  theme: { bg: '#0d1014', grid: 'rgba(120,180,140,0.05)', lane: 'rgba(120,180,140,0.09)' },
  spawn: { xf: 0.5, yf: 0.92 },
  /** 仅本关：小怪血量下限 500，按 tier 递增；精英 ×8；放错惩罚精英 = 对应小怪 ×5 */
  balance: {
    hpFloor: 500,
    hpPerTier: 0.2,
    eliteMul: 8,
    dmgMul: 1.4,
    speedMul: 1.15,
    spawnMul: 1.3,
    eliteChance: 0.18,
  },
  /** 整理玩法：中央刷怪口 + 4 个归档文件夹 + 归档规则表（左上角展示） */
  sort: {
    need: 10,
    folders: [
      // gate=true：中央 workspace/ —— 初始「虚」+ 刷怪口，整理满 10 次后转「实」变 Boss 门
      { id: 'workspace', label: 'workspace/', xf: 0.5,  yf: 0.5,  gate: true },
      // 四周归档文件夹：初始「实」，完成后转「虚」
      { id: 'src',    label: 'src/',    xf: 0.15, yf: 0.16 },
      { id: 'docs',   label: 'docs/',   xf: 0.85, yf: 0.16 },
      { id: 'config', label: 'config/', xf: 0.15, yf: 0.84 },
      { id: 'tmp',    label: '_tmp/',   xf: 0.85, yf: 0.84 },
    ],
    rules: [
      { exts: ['.ts', '.js', '.py', '.go', '.rs', '.html'], folder: 'src' },
      { exts: ['.md', '.txt'], folder: 'docs' },
      { exts: ['.json', '.yaml', '.toml'], folder: 'config' },
      { exts: ['.log', '.tmp', '.bak', '.cache'], folder: 'tmp' },
    ],
  },
  bossZone: { xf: 0.5, yf: 0.5, r: 110 },
  bossRoom: {
    w: 840, h: 520,
    spawn: { xf: 0.5, yf: 0.78 },
    boss: { xf: 0.5, yf: 0.22 },
    chest: { xf: 0.5, yf: 0.5 },
  },
  boss: {
    name: '临时文件堆积体', label: 'TMP', color: '#6f8f7a',
    hp: 10000, size: 52, speed: 28, xp: 120,
    quip: '"这些……都是没来得及清理的。"',
  },
  story: {
    pre: [
      { speaker: '大肥鱼', text: '工作区怎么一团糟？' },
      { speaker: '大肥鱼', text: '让我来整理一下吧。' },
      { speaker: '大肥鱼', text: '把乱跑的文件抓住放进对应的文件夹里就行。' },
      { speaker: '大肥鱼', text: '具体放入规则在左上角。' },
    ],
    bossQuip: null,
    post: [
      { speaker: '系统', text: 'Permission denied' },
      { speaker: '系统', text: 'Permission denied' },
      { speaker: '系统', text: 'Permission denied' },
      { speaker: '用户', text: '忘了给你开权限了。' },
    ],
    artPost: 'assets/image/dafeiyu-3.png',
    bossIntro: [
      { speaker: '大肥鱼', text: '（清理完这个，工作区就干净了）' },
    ],
  },
  firstClearGold: 700,
};
