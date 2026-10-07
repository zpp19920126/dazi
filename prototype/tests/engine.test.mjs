import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, POOL, MAXTURNS, findPath } from '../.test/engine.mjs';

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

test('MAXTURNS 规则映射与各级kinds序列受保护', () => {
  assert.deepEqual(LEVELS.map(l => l.kinds), [4,5,6,6,7,8,9,10,10]);
  assert.deepEqual(MAXTURNS, { free:null, oneTurn:1, classic:2 });
});

const mk = (rows, cols, on) => { const s = new Set(on.map(([r,c]) => r+','+c));
  return { alive: (r,c) => s.has(r+','+c), rows, cols }; };

test('findPath 直线0转弯', () => {
  const { alive, rows, cols } = mk(1, 3, [[0,0],[0,2]]);
  const p = findPath(rows, cols, alive, {r:0,c:0}, {r:0,c:2}, 0);
  assert.deepEqual(p, [{r:0,c:0},{r:0,c:2}]); // 中间(0,1)空，共线压缩
});

test('findPath 一转弯', () => {
  const { alive, rows, cols } = mk(3, 3, [[0,0],[2,2]]);
  assert.equal(findPath(rows, cols, alive, {r:0,c:0}, {r:2,c:2}, 0), null);
  const p = findPath(rows, cols, alive, {r:0,c:0}, {r:2,c:2}, 1);
  assert.equal(p.length, 3); assert.deepEqual(p[0], {r:0,c:0});
  assert.deepEqual(p.at(-1), {r:2,c:2});
});

test('findPath 借外圈绕行：满隔断两卡仍可2转弯相连', () => {
  // 一行4格全占，端点配对需绕外圈（上或下），转弯数=2
  const { alive, rows, cols } = mk(1, 4, [[0,0],[0,1],[0,2],[0,3]]);
  assert.equal(findPath(rows, cols, alive, {r:0,c:0}, {r:0,c:3}, 1), null);
  const p = findPath(rows, cols, alive, {r:0,c:0}, {r:0,c:3}, 2);
  assert.ok(p && p.length === 4); // [a,上圈,上圈,b] 压缩后4点
});

test('findPath 完全堵死返回null', () => {
  const on = [[0,1],[1,0],[1,1],[0,2]]; // (0,0)与(1,2)? 构造a孤立方
  const { alive, rows, cols } = mk(2, 4, on.concat([[1,3]]));
  assert.equal(findPath(rows, cols, alive, {r:0,c:0}, {r:1,c:2}, 2), null);
});
