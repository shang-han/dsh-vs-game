/**
 * 第 5 章 · 海边的商店
 * 大肥鱼被用户冷落太久，出门瞎逛到了海边：商店买剑（专属词条「普通攻击替换为剑技」），
 * 清掉沙滩上的海胆，最后讨伐从海里爬上来的巨型海胆。
 * 必须在商店买下宝剑，Boss 圈才会触发（服务端权威发货，客户端以拥有同基底判定开门）。
 * 布局坐标全部用比例（xf/yf 0..1），引擎 loadLevel 时换算像素。
 */
export default {
  id: 'seaside',
  chapter: 5,
  name: '海边的商店',
  tagline: '买把宝剑，讨伐巨型海胆',
  world: { w: 2600, h: 1500 },
  theme: { bg: '#e8d8a8', grid: 'rgba(160,120,60,0.06)', lane: 'rgba(160,120,60,0.10)' },
  /** 海边专属绘制：沙滩 + 下缘海水 + 浪线；shop 建筑由引擎用 SF_Outside_C r14c8-r15c10 拼出 */
  seaside: { seaYf: 0.78, seaColor: '#2e7fb8', seaDeep: '#22669b', foam: 'rgba(255,255,255,0.75)' },
  spawn: { xf: 0.06, yf: 0.5 },
  /** 剧情：买剑解锁 Boss；shop 位置即商店建筑 */
  shop: { xf: 0.2, yf: 0.42 },
  balance: {
    hpFloor: 240,
    hpPerTier: 0.15,
    eliteMul: 6,
    dmgMul: 1.2,
    speedMul: 1.0,
    spawnMul: 1.15,
    eliteChance: 0.14,
  },
  camps: [
    { xf: 0.16, yf: 0.42, type: 'urchin', count: 4 },
    { xf: 0.24, yf: 0.68, type: 'urchin', count: 5 },
    { xf: 0.33, yf: 0.3,  type: 'urchin', count: 5 },
    { xf: 0.55, yf: 0.66, type: 'urchin', count: 6 },
    { xf: 0.63, yf: 0.36, type: 'urchin', count: 6 },
    { xf: 0.72, yf: 0.6,  type: 'urchin', count: 7 },
    { xf: 0.8,  yf: 0.34, type: 'urchin', count: 6 },   // 关底营
  ],
  chests: [
    { xf: 0.2,  yf: 0.85, tier: 'blue' },
    { xf: 0.48, yf: 0.2,  tier: 'blue' },
    { xf: 0.68, yf: 0.82, tier: 'blue' },
  ],
  bossZone: { xf: 0.9, yf: 0.62, r: 190 },
  bossRoom: {
    w: 840, h: 520,
    spawn: { xf: 0.5, yf: 0.8 },
    boss: { xf: 0.5, yf: 0.24 },
    chest: { xf: 0.5, yf: 0.52 },   // 通关宝箱：幸运石 ×2（引擎按 lv.bossLoot 发放）
    loot: [{ item: 'mat-lucky-stone', count: 2 }],   // 通关宝箱：幸运石 ×2（翻卡奖励另算）
  },
  boss: {
    name: '巨型海胆', label: '海胆', color: '#3b2f4a',
    hp: 4200, size: 56, speed: 40, xp: 90,
    quip: '"刺，多的很。"',
    /** 机制：翻滚冲撞 + 尖刺弹幕（引擎按 boss.urchin 专门处理） */
    urchin: true,
  },
  firstClearGold: 8000,
  story: {
    pre: [
      { speaker: '系统', text: '用户已经很久没有找大肥鱼了。' },
      { speaker: '大肥鱼', text: '（闲得发慌）出门瞎逛，走着走着就到了海边。' },
      { speaker: '大肥鱼', text: '哇，这里有家商店！买根鱼竿钓钓鱼好了。' },
      { speaker: '店员', text: '钓什么鱼啊！海边出了只巨型海胆，先把牠讨伐了再说。' },
      { speaker: '大肥鱼', text: '……行吧。我看看，这把宝剑不错（蓝色品质，专属词条：普通攻击替换为剑技）。' },
      { speaker: '系统', text: '去商店（地图中部）花 10000 金币买下宝剑，才会引来巨型海胆。' },
    ],
    bossQuip: null,
    bossIntro: [
      { speaker: '大肥鱼', text: '海面在冒泡——巨型海胆来了！' },
      { speaker: '巨型海胆', text: '"刺，多的很。"' },
    ],
    post: [
      { speaker: '大肥鱼', text: '讨伐完成！这把剑，挥起来还挺顺手。' },
      { speaker: '用户', text: '（终于想起来了）大肥鱼？你去哪了……算了，打得不错。' },
    ],
    artPost: 'assets/image/dafeiyu-5.png',
  },
};
