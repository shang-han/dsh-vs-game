/**
 * 元进度单测：金币经济 / 翻卡计费 / 发牌奖池 / 存档净化
 * node --test test/meta.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  passiveUpgradeCost, rollFlipCards, toCharacter, sanitizeGlobal,
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

test('存档净化：未用技能书 → 保证包内有一本且未学会技能', () => {
  const g = sanitizeGlobal({ ...structuredClone(DEFAULT_GLOBAL), inventory: [], skillBookUsed: false, activeSkill: 'strike' });
  assert.ok(g.inventory.includes('skill-book'));
  assert.equal(g.activeSkill, null);
});

test('存档净化：已用技能书 → 包内不再有技能书', () => {
  const g = sanitizeGlobal({ ...structuredClone(DEFAULT_GLOBAL), inventory: ['skill-book'], skillBookUsed: true, activeSkill: 'strike' });
  assert.ok(!g.inventory.includes('skill-book'));
  assert.equal(g.activeSkill, 'strike');
});

test('存档净化：未开礼包 → 保证有一本新手礼包', () => {
  const g = sanitizeGlobal({ ...structuredClone(DEFAULT_GLOBAL), inventory: [], giftOpened: false });
  assert.equal(g.inventory[0], 'newbie-gift');
  // 已开 → 不重发
  const g2 = sanitizeGlobal({ ...structuredClone(DEFAULT_GLOBAL), inventory: [], giftOpened: true });
  assert.ok(!g2.inventory.includes('newbie-gift'));
});
