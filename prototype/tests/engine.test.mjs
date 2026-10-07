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

import { generateBoard, hasAvailablePair, findHint, reshuffle } from '../.test/engine.mjs';

function mulberry32(seed) { return function() {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const countKinds = cells => { const m = {};
  for (const row of cells) for (const v of row) if (v != null) m[v] = (m[v]||0)+1; return m; };

test('generateBoard：格数图案成偶、种类不超level.kinds', () => {
  for (const level of LEVELS) {
    const { cells } = generateBoard(level, mulberry32(level.id));
    const m = countKinds(cells);
    for (const v of Object.values(m)) assert.equal(v % 2, 0);
    assert.ok(Object.keys(m).length <= level.kinds);
  }
});

test('generateBoard：一开局必存在可消对（每关型跑100次）', () => {
  for (const level of LEVELS) for (let i = 0; i < 100; i++) {
    const g = generateBoard(level, mulberry32(level.id * 1000 + i));
    assert.ok(hasAvailablePair(g.cells, level.rows, level.cols, g.rule),
      `第${level.id}关 seed=${i} 死局开局`);
  }
});

test('hasAvailablePair：free档只看图案；classic档要看路径', () => {
  const cells = [[0, null, 1, 0], [1, null, null, 1]];
  // 图案0在(0,0)与(0,3)：直线被(0,2)的1挡住，但经虚拟外圈2转弯可连
  assert.ok(hasAvailablePair(cells, 2, 4, 'free'));
  assert.ok(hasAvailablePair(cells, 2, 4, 'classic'));
  const dead = [[0, 1], [1, 0]]; // free档只看图案相同即可，(0,0)-(1,1)成对
  assert.ok(hasAvailablePair(dead, 2, 2, 'free'));
});

test('reshuffle：保留存活位置与图案集合，且新局有解', () => {
  const level = LEVELS[5]; // 4×5 oneTurn
  const { cells } = generateBoard(level, mulberry32(7));
  cells[0][0] = null; cells[0][1] = null; // 模拟已消一对
  const shuffled = reshuffle(cells, level.rows, level.cols, 'oneTurn', mulberry32(9));
  const before = countKinds(cells), after = countKinds(shuffled);
  assert.deepEqual(before, after); // 图案multiset不变
  for (let r = 0; r < level.rows; r++) for (let c = 0; c < level.cols; c++)
    assert.equal((shuffled[r][c] == null) , (cells[r][c] == null)); // 空位形状不变
  assert.ok(hasAvailablePair(shuffled, level.rows, level.cols, 'oneTurn'));
});

test('findHint 与 hasAvailablePair 同结果', () => {
  const level = LEVELS[7]; const g = generateBoard(level, mulberry32(3));
  assert.deepEqual(findHint(g.cells, level.rows, level.cols, g.rule),
    hasAvailablePair(g.cells, level.rows, level.cols, g.rule));
});
