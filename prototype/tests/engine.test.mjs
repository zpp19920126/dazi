import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, POOL } from '../.test/engine.mjs';

test('LEVELS 共9关且与spec§3一致', () => {
  assert.equal(LEVELS.length, 9);
  assert.deepEqual(LEVELS.map(l => [l.rows, l.cols]),
    [[3,4],[3,4],[4,4],[4,4],[4,5],[4,5],[4,6],[5,6],[5,6]]);
  assert.deepEqual(LEVELS.map(l => l.rule),
    ['free','free','free','oneTurn','oneTurn','oneTurn','classic','classic','classic']);
  for (const l of LEVELS) assert.equal((l.rows * l.cols) % 2, 0, `第${l.id}关格数须为偶`);
  assert.deepEqual(LEVELS.slice(6).map(l => l.hint), [1, 1, 1]);
});

test('图案池12种，顺序按spec§6', () => {
  assert.deepEqual(POOL, ['🦄','🐰','🐱','🦊','🐼','🌈','⭐','🎀','🍓','🧁','🍭','🌸']);
});
