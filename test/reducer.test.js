/**
 * game-reducer 单测：node --test test/reducer.test.js
 * 喂模拟 session/event，断言输出的燃料消息。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameReducer } from '../lib/game-reducer.js';

const S = {}; // session 对象在 reducer 里基本不参与逻辑
const ev = (type, data = {}) => ({ type, data });

test('token 经验回合内只累积，turn 结束统一清场结算', () => {
  const r = new GameReducer();
  // turn 内：只攒不掉
  assert.deepEqual(r.handle(S, ev('assistant/message', {
    usage: { inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 0 },
  })), []);
  // turn 结束：全屏清怪 + 一次性经验雨（总经验 ≈ 3000/100 = 30）
  const out = r.handle(S, ev('turn/end', { reason: { kind: 'completed' } }));
  assert.equal(out[0].kind, 'screen-nuke');
  const drop = out.find((m) => m.kind === 'drop-xp');
  assert.ok(drop, 'should settle xp');
  const totalXp = drop.gems * drop.value;
  assert.ok(totalXp >= 25 && totalXp <= 35, `totalXp=${totalXp}`);
  // 结算后清零：下一个空 turn 结束不再掉经验
  r.handle(S, ev('turn/start'));
  const out2 = r.handle(S, ev('turn/end', { reason: { kind: 'completed' } }));
  assert.ok(!out2.some((m) => m.kind === 'drop-xp'));
});

test('assistant/message 无 usage 不累积', () => {
  const r = new GameReducer();
  assert.deepEqual(r.handle(S, ev('assistant/message', {})), []);
  assert.equal(r.pendingXp, 0);
});

test('tool/call 文件工具按扩展名刷怪', () => {
  const r = new GameReducer();
  const out = r.handle(S, ev('tool/call', {
    name: 'read', arguments: JSON.stringify({ file_path: 'src/foo.ts' }),
  }));
  assert.deepEqual(out, [{ kind: 'spawn', enemy: 'ts', count: 1, elite: false }]);
});

test('tool/call 未知扩展名 → 杂鱼', () => {
  const r = new GameReducer();
  const out = r.handle(S, ev('tool/call', {
    name: 'write', arguments: JSON.stringify({ file_path: 'noext' }),
  }));
  assert.equal(out[0].enemy, 'misc');
});

test('tool/call bash → 终端怪；grep → 搜索碎片×3', () => {
  const r = new GameReducer();
  const a = r.handle(S, ev('tool/call', { name: 'bash', arguments: '{}' }));
  assert.equal(a[0].enemy, 'term');
  const b = r.handle(S, ev('tool/call', { name: 'grep', arguments: '{}' }));
  assert.equal(b[0].enemy, 'search');
  assert.equal(b[0].count, 3);
});

test('tool/result 报错 → 上次文件类型的精英怪', () => {
  const r = new GameReducer();
  r.handle(S, ev('tool/call', { name: 'edit', arguments: JSON.stringify({ file_path: 'a.py' }) }));
  const out = r.handle(S, ev('tool/result', { error: 'SyntaxError: bad' }));
  assert.deepEqual(out, [{ kind: 'spawn', enemy: 'py', count: 1, elite: true }]);
});

test('turn 生命周期：小回合清场无 boss，大回合清场 + boss', () => {
  const r = new GameReducer();
  r.handle(S, ev('turn/start'));
  let out = r.handle(S, ev('turn/end', { reason: { kind: 'completed' } }));
  assert.equal(out[0].kind, 'screen-nuke');
  assert.ok(!out.some((m) => m.kind === 'boss-spawn'));

  r.handle(S, ev('turn/start'));
  r.handle(S, ev('assistant/message', { usage: { inputTokens: 12000, outputTokens: 1000 } }));
  out = r.handle(S, ev('turn/end', { reason: { kind: 'completed' } }));
  const boss = out.find((m) => m.kind === 'boss-spawn');
  assert.ok(boss, 'big turn should spawn boss');
  assert.ok(boss.hp >= 50);
});

test('turn/end aborted → screen-nuke；blocked → shield', () => {
  const r = new GameReducer();
  assert.equal(r.handle(S, ev('turn/end', { reason: { kind: 'aborted' } }))[0].kind, 'screen-nuke');
  assert.deepEqual(r.handle(S, ev('turn/end', { reason: { kind: 'blocked' } }))[0], { kind: 'buff', buff: 'shield', duration: 5 });
});

test('approval/asked → freeze；llm/retry → chaos', () => {
  const r = new GameReducer();
  assert.equal(r.handle(S, ev('approval/asked'))[0].buff, 'freeze');
  assert.equal(r.handle(S, ev('llm/retry'))[0].buff, 'chaos');
});

test('畸形事件静默降级为空数组', () => {
  const r = new GameReducer();
  assert.deepEqual(r.handle(S, undefined), []);
  assert.deepEqual(r.handle(S, { type: 'assistant/message', data: null }), []);
  assert.deepEqual(r.handle(S, ev('assistant/message', { usage: { inputTokens: 'NaN-string' } })), []);
  assert.deepEqual(r.handle(S, ev('unknown/event', { weird: true })), []);
});
