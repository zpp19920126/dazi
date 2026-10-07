import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_KEY, loadProgress, saveProgress, markCleared } from '../.test/store.mjs';

const mapStore = (seed = {}) => { const m = new Map(Object.entries(seed)); return {
  getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const throwingStore = { getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); } };

test('空/损坏数据回默认', () => {
  assert.deepEqual(loadProgress(mapStore()), { cleared: [], sound: true, voice: true, hintUsed: {} });
  assert.deepEqual(loadProgress(mapStore({ [STORE_KEY]: '{bad json' })),
    { cleared: [], sound: true, voice: true, hintUsed: {} });
  assert.deepEqual(loadProgress(throwingStore),
    { cleared: [], sound: true, voice: true, hintUsed: {} });
});

test('字段级修补：缺字段/错类型不崩', () => {
  const s = mapStore({ [STORE_KEY]: JSON.stringify({ cleared: 'nope', sound: false, extra: 1 }) });
  const p = loadProgress(s);
  assert.deepEqual(p.cleared, []); assert.equal(p.sound, false); assert.equal(p.voice, true);
});

test('markCleared：去重追加并落盘', () => {
  const s = mapStore();
  markCleared(s, 1); markCleared(s, 1); markCleared(s, 2);
  assert.deepEqual(loadProgress(s).cleared, [1, 2]);
});

test('saveProgress写失败静默返回', () => {
  saveProgress(throwingStore, { cleared: [1] }); // 不抛异常即通过
});

test('回归：markCleared抛错存储不污染模块默认值', () => {
  markCleared(throwingStore, 1); // loadProgress 走 catch 回退默认值后 push，历史上会改到共享的 DEFAULT_PROGRESS.cleared
  assert.deepEqual(loadProgress(throwingStore).cleared, []);
  assert.deepEqual(loadProgress(mapStore({ [STORE_KEY]: '{bad json' })).cleared, []);
});
