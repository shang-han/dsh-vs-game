/**
 * 元进度单测：金币经济 / 翻卡计费 / 发牌奖池 / 存档净化
 * node --test test/meta.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  passiveUpgradeCost, rollFlipCards, toCharacter, sanitizeGlobal, openBagItem,
  flipCharge, FLIP_EXTRA_COST, FLIP_ACC_POOL, FLIP_MAT_POOL, DEFAULT_GLOBAL,
} from '../lib/index.js';

test('被动升级费用曲线 100/200/300/400/500', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(passiveUpgradeCost), [100, 200, 300, 400, 500]);
});

test('翻卡计费：首张免费、第二张付金币、第三张拒', () => {
  assert.equal(flipCharge(0).gold, 0);
  assert.equal(flipCharge(1).gold, FLIP_EXTRA_COST);
  assert.equal(flipCharge(2), null);
  assert.equal(flipCharge(3), null);
});

test('发牌恒为 3 张且全部落在白名单奖池', () => {
  for (let round = 0; round < 60; round++) {
    const cards = rollFlipCards();
    assert.equal(cards.length, 3);
    for (const c of cards) {
      if (c.kind === 'acc') assert.ok(FLIP_ACC_POOL.includes(c.item), c.item);
      else if (c.kind === 'mat') assert.ok(FLIP_MAT_POOL.includes(c.item), c.item);
      else if (c.kind === 'gold') {
        assert.ok(Number.isInteger(c.amount) && c.amount >= 120 && c.amount <= 300, 'gold ' + c.amount);
      } else {
        assert.fail('未知卡型 ' + c.kind);
      }
    }
  }
});

test('toCharacter 带 clearedLevels（缺省空数组）', () => {
  const c = toCharacter({ ...DEFAULT_GLOBAL, clearedLevels: undefined });
  assert.deepEqual(c.clearedLevels, []);
  const c2 = toCharacter({ ...DEFAULT_GLOBAL, clearedLevels: ['busy-server'] });
  assert.deepEqual(c2.clearedLevels, ['busy-server']);
});

test('存档净化：清理演示药水/宝石', () => {
  const g = sanitizeGlobal({
    ...structuredClone(DEFAULT_GLOBAL),
    inventory: ['potion-red', 'potion-blue', 'gem-ruby', 'gem-emerald'],
    skillBookUsed: false, giftOpened: true,
  });
  assert.ok(!g.inventory.some((x) => x.startsWith('potion-') || x.startsWith('gem-')));
});

test('存档净化：未用技能书时不强制补发，技能被清空', () => {
  const g = sanitizeGlobal({ ...structuredClone(DEFAULT_GLOBAL), inventory: [], skillBookUsed: false, activeSkill: 'strike' });
  assert.ok(!g.inventory.includes('skill-book'));
  assert.equal(g.activeSkill, null);
});

test('第一关翻卡固定包含一张技能书碎片', () => {
  const cards = rollFlipCards('busy-server');
  assert.equal(cards.length, 3);
  assert.ok(cards.some((c) => c.kind === 'fragment' && c.item === 'skill-fragment'));
});

test('存档净化：已用技能书 → 包内不再有技能书', () => {
  const g = sanitizeGlobal({ ...structuredClone(DEFAULT_GLOBAL), inventory: ['skill-book'], skillBookUsed: true, activeSkill: 'strike' });
  assert.ok(!g.inventory.includes('skill-book'));
  assert.equal(g.activeSkill, 'strike');
});

test('新存档默认带一个新手礼包，净化不再补发', () => {
  const fresh = structuredClone(DEFAULT_GLOBAL);
  assert.equal(fresh.inventory.filter((x) => x === 'newbie-gift').length, 1);

  const emptied = sanitizeGlobal({ ...fresh, inventory: [], giftOpened: false });
  assert.ok(!emptied.inventory.includes('newbie-gift'));
});

test('存档净化：礼包放进合成台后不会在背包里补发复制', () => {
  const g = sanitizeGlobal({
    ...structuredClone(DEFAULT_GLOBAL),
    inventory: [],
    craftingStorage: ['newbie-gift'],
    giftOpened: false,
  });
  assert.ok(!g.inventory.includes('newbie-gift'));
  assert.deepEqual(g.craftingStorage, ['newbie-gift']);
});

test('新手礼包：一次只打开一个，每个 +1000 金币', () => {
  const g = sanitizeGlobal({
    ...structuredClone(DEFAULT_GLOBAL),
    inventory: ['newbie-gift', 'newbie-gift', 'newbie-gift'],
    giftOpened: false,
  });

  const first = openBagItem(g, 'newbie-gift');
  assert.equal(first.gold, g.gold + 1000);
  assert.equal(first.inventory.filter((x) => x === 'newbie-gift').length, 2);
  assert.equal(first.giftOpened, true);

  const second = openBagItem(first, 'newbie-gift');
  assert.equal(second.gold, g.gold + 2000);
  assert.equal(second.inventory.filter((x) => x === 'newbie-gift').length, 1);
});

test('技能书：叠放时一次只使用一本', () => {
  const g = sanitizeGlobal({
    ...structuredClone(DEFAULT_GLOBAL),
    inventory: ['skill-book', 'skill-book'],
    skillBookUsed: false,
  });

  const used = openBagItem(g, 'skill-book');
  assert.equal(used.activeSkill, 'strike');
  assert.equal(used.skillBookUsed, true);
  assert.equal(used.inventory.filter((x) => x === 'skill-book').length, 1);
});
