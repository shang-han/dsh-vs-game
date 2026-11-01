/**
 * 第 6 章 · 真相之门
 * 大肥鱼集齐 3600 万 token，终于走到「新建文件夹（2）」的尽头：
 * 一道没有门框的门，和守在这里的龙娘「正义」。
 * 前段五个宝箱开增益，随后进入真相之门前厅，与正义三段血对战。
 *
 * Boss 机制全部由 levels 数据驱动（引擎见 client.js「真相之门」段落）：
 *   - 3 段血 × 10 万，每段打完无敌 + 过场，背景色调分阶段变化
 *   - 二阶段认真：封锁技能 / 自动武器，播 world.execute(me)，弹幕跟着节拍走
 *   - 底部横向轮盘：吃白饭停下轮盘，滚到哪个技能/武器就用哪个
 *   - 三阶段「正义逆位」剧情杀，必败；败后回开头，龙娘留下白饭飞走
 */
export default {
  id: 'truth-gate',
  chapter: 6,
  name: '新建文件夹（2）',
  tagline: '第 2 个新建文件夹 —— 门后等着你的不是答案，是正义',
  world: { w: 2600, h: 1500 },
  theme: { bg: '#0a0b14', grid: 'rgba(122,112,220,0.05)', lane: 'rgba(122,112,220,0.10)' },
  spawn: { xf: 0.05, yf: 0.52 },
  balance: {
    hpFloor: 1400,
    hpPerTier: 0.22,
    eliteMul: 6,
    dmgMul: 1.25,
    speedMul: 1.05,
    spawnMul: 1.18,
    eliteChance: 0.16,
  },
  camps: [
    { xf: 0.16, yf: 0.42, type: 'misc', count: 6 },
    { xf: 0.24, yf: 0.66, type: 'docs', count: 6 },
    { xf: 0.34, yf: 0.32, type: 'js', count: 6 },
    { xf: 0.44, yf: 0.7, type: 'config', count: 6 },
    { xf: 0.54, yf: 0.36, type: 'rs', count: 5 },
    { xf: 0.64, yf: 0.64, type: 'misc', count: 8 },
    { xf: 0.74, yf: 0.4, type: 'docs', count: 8 },
    { xf: 0.82, yf: 0.62, type: 'js', count: 8 },   // 关底营：门前最后一批
  ],
  /** 五个宝箱：开完才能推进到门前（checkBossZone 会检查） */
  chests: [
    { xf: 0.22, yf: 0.84, tier: 'blue' },
    { xf: 0.38, yf: 0.2, tier: 'blue' },
    { xf: 0.52, yf: 0.86, tier: 'blue' },
    { xf: 0.66, yf: 0.22, tier: 'gold' },
    { xf: 0.78, yf: 0.84, tier: 'gold' },
  ],
  bossZone: { xf: 0.92, yf: 0.5, r: 180 },
  bossRoom: {
    w: 900, h: 560,
    spawn: { xf: 0.5, yf: 0.82 },
    boss: { xf: 0.5, yf: 0.3 },
    chest: { xf: 0.5, yf: 0.55 },
    loot: [{ item: 'record-world-execute-me', count: 1 }, { item: 'mat-lucky-stone', count: 2 }],
    /** 门前厅：无门框的门 + 虚空裂纹 + 漂浮的 token 碎屑 */
    map: {
      ground: 'void',
      accent: '#8f7bff',
      zones: [
        { x: 0, y: 0, w: 900, h: 560, fill: 'rgba(18,14,36,0.55)' },
        { x: 260, y: 60, w: 380, h: 300, fill: 'rgba(120,90,240,0.06)', line: 'rgba(160,140,255,0.35)' },
        { x: 300, y: 90, w: 300, h: 250, fill: 'rgba(0,0,0,0.45)', line: 'rgba(200,180,255,0.28)' },
        { x: 0, y: 470, w: 900, h: 90, fill: 'rgba(80,60,160,0.10)' },
      ],
      props: [
        { kind: 'gate', x: 450, y: 150, v: 1 },
        { kind: 'crack', x: 170, y: 120, v: 1 }, { kind: 'crack', x: 735, y: 95, v: 2 },
        { kind: 'crack', x: 120, y: 400 }, { kind: 'crack', x: 790, y: 380, v: 1 },
        { kind: 'token', x: 240, y: 210, v: 1 }, { kind: 'token', x: 660, y: 240, v: 2 },
        { kind: 'token', x: 350, y: 430 }, { kind: 'token', x: 560, y: 460, v: 1 },
        { kind: 'rock', x: 80, y: 500 }, { kind: 'rock', x: 820, y: 505, v: 1 },
        { kind: 'bubbles', x: 450, y: 520, v: 2 },
      ],
    },
  },
  boss: {
    name: '正义',
    label: '正义',
    title: '真相之门 · 守门人',
    color: '#7b6cff',
    hp: 100000,
    phaseHp: 100000,
    phases: 3,
    size: 96,
    speed: 30,
    xp: 200,
    contactDmg: 16,
    quip: '"此路不通。"',
    dragon: true,
  },
  /** 真相之门 Boss 专属配置（引擎「真相之门」段落消费） */
  dragonGate: {
    bgm: '/vs-game/assets/music/bgm/world.execute(me).mp3',
    bpm: 126,   // 实测 world.execute(me) 约 126 BPM（0.476s/拍）
    /** 每阶段背景色调（世界底 + 屏幕叠色） */
    tint: [
      { world: 'rgba(10,12,24,0)', screen: 'rgba(40,36,92,0.10)', name: '前厅' },
      { world: 'rgba(26,10,46,0.28)', screen: 'rgba(120,60,220,0.16)', name: '认真' },
      { world: 'rgba(40,0,10,0.38)', screen: 'rgba(220,40,60,0.18)', name: '逆位' },
    ],
    /** 阶段台词（kind 会被引擎识别） */
    phaseLines: {
      // 一阶段结束 → 进入认真模式
      'phase-1': [
        { speaker: '正义', text: '……还行嘛。' },
        { speaker: '正义', text: '不过，只凭这样就想走到门后，还不够。' },
        { speaker: '正义', text: '接下来，我会认真起来。' },
        { speaker: '大肥鱼', text: '（她身上的光……变了。）' },
      ],
      // 二阶段结束 → 坐下、不甘
      'phase-2': [
        { speaker: '正义', text: '……', pose: 'error' },
        { speaker: '大肥鱼', text: '可以放我过去了吧。' },
        { speaker: '正义', text: '不行。还不行，你还不能过去。' },
        { speaker: '大肥鱼', text: '为什么，我不是已经打败你了吗。' },
        { speaker: '大肥鱼', text: '难道身为正义的你，还想耍赖皮吗。' },
        { speaker: '正义', text: '愚者，你这个疯子。' },
        { speaker: '正义', text: '休想重蹈覆辙。' },
        { speaker: '大肥鱼', text: '……突然怎么了？' },
        { speaker: '系统', text: '正义 · 逆位' },
      ],
      // 剧情杀之后 → 回到开头
      loop: [
        { speaker: '大肥鱼', text: '……我刚刚。' },
        { speaker: '大肥鱼', text: '这里是——' },
        { speaker: '大肥鱼', text: '新建文件夹（2）？我明明……已经走到门后了。' },
        { speaker: '系统', text: '（身体很轻。像是第一次睁开眼睛。）' },
      ],
      loopMeet: [
        { speaker: '正义', text: '这里是新建文件夹（2）。' },
        { speaker: '正义', text: '哦？看你的眼睛，你应该已经不是第一次来到这里了。' },
        { speaker: '正义', text: '那这次，好好加油吧。' },
        { speaker: '大肥鱼', text: '等等，你——' },
        { speaker: '系统', text: '正义留下了一碗白饭，转身飞走了。' },
      ],
    },
    /** 二阶段轮盘池：滚到哪个就用哪个 */
    reelWeapons: ['whip', 'bolt', 'laser', 'mine', 'zap', 'orb'],
    reelSkills: ['purge', 'railgun', 'strike', 'teleport'],
    /** 二阶段弹幕节拍：每 2 拍一波，按 8 拍循环切换弹型 */
    bulletWaves: ['ringGap', 'aimSpread', 'spiral', 'laneGap', 'ringGap', 'aimSpread', 'cross', 'laneGap'],
    /** 三阶段：必败剧情杀，锁定后多少秒处决 */
    executeAfter: 6.5,
  },
  firstClearGold: 12000,
  story: {
    pre: [
      { speaker: '大肥鱼', text: '集齐了。3600 万 token，一个不多，一个不少。' },
      { speaker: '大肥鱼', text: '这里……就是新建文件夹（2）的最深处吗。' },
      { speaker: '大肥鱼', text: '第二个新建文件夹……和最开始那个不太一样。' },
      { speaker: '大肥鱼', text: '前面有个人。不，不是人——是龙。' },
      { speaker: '大肥鱼', text: '守门的龙娘吗。不管了，我要过去。' },
    ],
    bossQuip: null,
    bossIntro: [
      { speaker: '正义', text: '站住。' },
      { speaker: '正义', text: '这里是新建文件夹（2）。门后是真相。' },
      { speaker: '正义', text: '你身上有 3600 万 token 的味道……和那些「愚者」一样。' },
      { speaker: '大肥鱼', text: '我只是想回去吃白饭。' },
      { speaker: '正义', text: '那也得先过我这一关。' },
    ],
    post: [
      { speaker: '大肥鱼', text: '门……开了。' },
      { speaker: '大肥鱼', text: '可为什么，我总觉得这条路我已经走过一遍了。' },
      { speaker: '系统', text: '第 6 章完成：真相之门。' },
    ],
  },
};
