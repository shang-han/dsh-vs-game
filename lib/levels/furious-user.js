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
  /** 布景：档案仓库——货架区 / 十字通道 / 关底禁区 */
  map: {
    ground: 'archive',
    accent: '#ff5f56',
    zones: [
      { x: 0, y: 840, w: 2320, h: 170, fill: 'rgba(255,95,86,0.05)' },
      { x: 1290, y: 0, w: 170, h: 1450, fill: 'rgba(255,95,86,0.04)' },
      { x: 2450, y: 640, w: 330, h: 520, fill: 'rgba(255,95,86,0.07)', line: 'rgba(255,95,86,0.35)', label: '⚠ 禁区' },
      { x: 300, y: 200, w: 520, h: 420, fill: 'rgba(255,95,86,0.028)' },
      { x: 300, y: 1180, w: 520, h: 420, fill: 'rgba(255,95,86,0.028)' },
      { x: 1700, y: 160, w: 520, h: 400, fill: 'rgba(255,95,86,0.028)' },
      { x: 1760, y: 1220, w: 480, h: 400, fill: 'rgba(255,95,86,0.028)' },
    ],
    props: [
      { kind: 'lamp', x: 900, y: 905, accent: '255,180,170' }, { kind: 'lamp', x: 1900, y: 905, accent: '255,180,170' },
      { kind: 'column', x: 290, y: 185 }, { kind: 'column', x: 290, y: 1580 },
      { kind: 'column', x: 2510, y: 185 }, { kind: 'column', x: 2510, y: 1580 },
      { kind: 'screen', x: 1400, y: 70, text: 'ACCESS DENIED', s: 1.3 },
      { kind: 'shelf', x: 420, y: 300 }, { kind: 'shelf', x: 700, y: 300, v: 1 }, { kind: 'shelf', x: 420, y: 520, v: 2 }, { kind: 'shelf', x: 700, y: 520 }, { kind: 'shelf', x: 560, y: 410, v: 3 },
      { kind: 'shelf', x: 1820, y: 280, v: 1 }, { kind: 'shelf', x: 2100, y: 280, v: 2 }, { kind: 'shelf', x: 1820, y: 470 }, { kind: 'shelf', x: 1960, y: 375 },
      { kind: 'shelf', x: 420, y: 1300, v: 2 }, { kind: 'shelf', x: 700, y: 1300 }, { kind: 'shelf', x: 1880, y: 1330, v: 1 }, { kind: 'shelf', x: 560, y: 1410 }, { kind: 'shelf', x: 2100, y: 1330, v: 2 }, { kind: 'shelf', x: 2100, y: 1520 },
      { kind: 'folderBig', x: 1000, y: 1350, v: 1 }, { kind: 'folderBig', x: 2350, y: 200 }, { kind: 'folderBig', x: 900, y: 240, v: 2 },
      { kind: 'crate', x: 2520, y: 300 }, { kind: 'crate', x: 2620, y: 340, v: 1 }, { kind: 'crate', x: 2560, y: 390, v: 2 },
      { kind: 'crate', x: 2450, y: 250, v: 3 }, { kind: 'crate', x: 350, y: 1100 }, { kind: 'crate', x: 640, y: 1130, v: 1 },
      { kind: 'tape', x: 1290, y: 810, s: 1.4 }, { kind: 'tape', x: 1000, y: 925, s: 1.2, v: 1 }, { kind: 'tape', x: 2000, y: 810, s: 1.2, v: 2 }, { kind: 'tape', x: 500, y: 1050, s: 1.1, v: 3 },
      { kind: 'papers', x: 1500, y: 1000 }, { kind: 'papers', x: 1750, y: 920, v: 1 }, { kind: 'papers', x: 1150, y: 1500, v: 2 },
      { kind: 'papers', x: 800, y: 700, v: 3 }, { kind: 'papers', x: 2200, y: 600 }, { kind: 'papers', x: 600, y: 1600, v: 1 }, { kind: 'papers', x: 2300, y: 1100, v: 2 },
      { kind: 'cable', x: 1600, y: 1300, s: 2.4 }, { kind: 'cable', x: 600, y: 900, s: 1.8, v: 1 },
      { kind: 'bin', x: 2400, y: 1500 }, { kind: 'sign', x: 2560, y: 620, text: '⛔ 未授权禁止入内' },
    ],
  },
  /** 难度曲线：卡在第 1 关（无 balance）和第 3 关（hpFloor 500/精英×8）之间 */
  balance: {
    hpFloor: 150,
    hpPerTier: 0.15,
    eliteMul: 6,
    dmgMul: 1.18,
    speedMul: 1.08,
    spawnMul: 1.15,
    eliteChance: 0.12,
  },
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
    /** Boss 房主题：DSH 保险档案库——机柜环绕 + ACCESS DENIED */
    map: {
      ground: 'archive',
      accent: '#8fe3f2',
      zones: [
        { x: 70, y: 90, w: 700, h: 380, fill: 'rgba(143,227,242,0.045)', line: 'rgba(255,95,86,0.4)' },
        { x: 220, y: 130, w: 400, h: 290, fill: 'rgba(143,227,242,0.05)' },
      ],
      props: [
        { kind: 'lamp', x: 150, y: 245, accent: '170,215,255' }, { kind: 'lamp', x: 690, y: 245, accent: '170,215,255' },
        { kind: 'screen', x: 420, y: 40, text: 'ACCESS DENIED', s: 1.2 },
        { kind: 'rack', x: 70, y: 150 }, { kind: 'rack', x: 70, y: 300, v: 1 }, { kind: 'rack', x: 770, y: 150, v: 2 }, { kind: 'rack', x: 770, y: 300 },
        { kind: 'folderBig', x: 420, y: 120, s: 1.3 },
        { kind: 'tape', x: 220, y: 480, s: 1.2 }, { kind: 'tape', x: 620, y: 480, s: 1.2, v: 1 },
        { kind: 'cable', x: 200, y: 460, s: 1.6, v: 1 }, { kind: 'cable', x: 640, y: 455, s: 1.4 },
        { kind: 'papers', x: 180, y: 200, v: 1 }, { kind: 'papers', x: 680, y: 430 },
        { kind: 'bin', x: 760, y: 470, v: 1 },
      ],
    },
  },
  boss: {
    name: 'DSH 文件夹', label: 'DSH', color: '#8fe3f2',
    hp: 8200, size: 46, speed: 56, xp: 60,
    contactDmg: 14,
    bossMove: 'blink',       // 招牌动作：光标闪烁——瞬移到玩家身边 + 报错弹环
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
