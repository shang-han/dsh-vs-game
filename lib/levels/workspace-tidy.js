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
  /** 布景：整理中的工作区——四象限色块对应四个文件夹，中央是 workspace 刷怪口 */
  map: {
    lane: false,
    zones: [
      { x: 140, y: 110, w: 560, h: 360, fill: 'rgba(120,180,140,0.05)' },
      { x: 2100, y: 110, w: 560, h: 360, fill: 'rgba(96,165,250,0.05)' },
      { x: 140, y: 1330, w: 560, h: 360, fill: 'rgba(251,191,36,0.05)' },
      { x: 2100, y: 1330, w: 560, h: 360, fill: 'rgba(148,163,184,0.05)' },
      { x: 1100, y: 620, w: 600, h: 560, fill: 'rgba(120,180,140,0.05)', line: 'rgba(120,180,140,0.25)' },
    ],
    props: [
      { kind: 'plant', x: 90, y: 90 }, { kind: 'plant', x: 2710, y: 90, v: 1 }, { kind: 'plant', x: 90, y: 1710, v: 2 }, { kind: 'plant', x: 2710, y: 1710 },
      { kind: 'shelf', x: 900, y: 120, v: 1 }, { kind: 'shelf', x: 1900, y: 120 }, { kind: 'shelf', x: 900, y: 1680, v: 2 }, { kind: 'shelf', x: 1900, y: 1680, v: 1 },
      { kind: 'chair', x: 700, y: 900 }, { kind: 'chair', x: 2100, y: 860, v: 1 },
      { kind: 'cable', x: 1500, y: 400, s: 2 }, { kind: 'cable', x: 1200, y: 1500, s: 1.7, v: 1 },
      { kind: 'papers', x: 1750, y: 1250, v: 2 }, { kind: 'papers', x: 950, y: 550 },
      { kind: 'bin', x: 2650, y: 920 }, { kind: 'cooler', x: 150, y: 900 },
    ],
  },
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
    /** Boss 房主题：临时堆放场——纸堆山 + 待清理 */
    map: {
      zones: [
        { x: 190, y: 110, w: 460, h: 320, fill: 'rgba(111,143,122,0.09)' },
        { x: 0, y: 440, w: 840, h: 80, fill: 'rgba(111,143,122,0.05)' },
      ],
      props: [
        { kind: 'pile', x: 110, y: 440, s: 1.3 }, { kind: 'pile', x: 730, y: 130, v: 1 }, { kind: 'pile', x: 740, y: 440, s: 1.2, v: 2 }, { kind: 'pile', x: 100, y: 120, v: 3 },
        { kind: 'bin', x: 55, y: 300 }, { kind: 'bin', x: 785, y: 310, v: 1 },
        { kind: 'cart', x: 300, y: 490 }, { kind: 'papers', x: 440, y: 470, v: 1 },
        { kind: 'sign', x: 560, y: 492, text: '🗑 待清理' },
        { kind: 'plant', x: 790, y: 80, v: 1 },
      ],
    },
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
