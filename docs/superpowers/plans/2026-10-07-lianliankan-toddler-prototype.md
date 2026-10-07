# 幼儿连连看可交互HTML原型 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付单文件可交互手机原型 `prototype/lianliankan-prototype.html`——3 岁女孩可独立操作的 9 关分阶连连看（粉色童话风）。

**Architecture:** 单 HTML 文件内按 `LEVELS/ENGINE → STORE → VIEW → AUDIO → APP` 五段组织（spec §7）；ENGINE 与 STORE 是零 DOM 的纯函数段，通过 `prototype/tools/extract.mjs` 从 HTML 中切出为 ESM 供 `node --test` 单测；VIEW/AUDIO/APP 段用浏览器手工清单验收。

**Tech Stack:** 原生 HTML/CSS/JS（无框架、无构建、无网络请求）、SVG 连线覆盖层、Web Audio 合成音效、speechSynthesis（zh-CN）、localStorage、node:test。

**Spec:** `docs/superpowers/specs/2026-10-07-lianliankan-toddler-design.md`（本计划逐节实现该 spec，冲突以 spec 为准）

## Global Constraints

（逐条抄自 spec，每个任务的隐含需求）

- 单文件、零第三方依赖、零网络请求，断网可玩（spec §10.4）。
- 竖屏，基准 375×812，`vw/vh` 弹性适配，处理 `env(safe-area-inset-*)`（spec §6）。
- 无失败态：不出现 ✗、红色警告、倒计时、"游戏结束"（spec §2）。
- 配对失败仅"摇头弹回 + 泡泡音 + 再找一个试试"；成功鼓励语轮换集合固定为「真棒! / 就是这样! / 好厉害呀!」（spec §5）。
- 图案池 12 种 Emoji，顺序固定：🦄 🐰 🐱 🦊 🐼 🌈 ⭐ 🎀 🍓 🧁 🍭 🌸（spec §6）。
- 背景渐变 `#FFE4F0`→`#F3E8FF`；卡片白底、2px `#FFB6D9` 边、圆角 22%、阴影 `0 4px 12px rgba(255,150,200,.35)`；选中 `#FFD700` 发光 scale 1.15；连线 3px 彩虹渐变圆头（spec §6）。
- 语音：`speechSynthesis`，`zh-CN`，rate 0.9、pitch 1.3；AudioContext 首次触摸后初始化；不可用一律静默降级（spec §7/§8）。
- 死局救援：洗牌重试上限 50 次，仍失败降级 free 档布局；孩子无感知（spec §7/§8）。
- 游戏界面任何文字 ≥16px、按钮 ≥22px；仅家长设置页允许小字（spec §6）。
- 禁用双击/双指缩放与长按选中：`touch-action: manipulation` + `user-select: none`（spec §4③）。
- 提交信息用中文 conventional 风格，scope 统一 `llk`（如 `feat(llk): …`）。

## 文件结构

| 文件 | 职责 | 创建任务 |
|---|---|---|
| `prototype/lianliankan-prototype.html` | 唯一交付物。内含带注释分隔的 5 段：`LEVELS+ENGINE`、`STORE`、`VIEW`、`AUDIO`、`APP`，加 `<style>` 与 5 个 `<section>` 屏 | T1 起持续修改 |
| `prototype/tools/extract.mjs` | 从 HTML 切出 ENGINE/STORE 段 → `prototype/.test/*.mjs`（追加 export 白名单） | T1 |
| `prototype/tests/engine.test.mjs` | ENGINE 段单测（node:test） | T2-T4 |
| `prototype/tests/store.test.mjs` | STORE 段单测 | T5 |
| `prototype/tools/run-tests.sh` | `node tools/extract.mjs && node --test tests/` | T1 |

坐标约定（全计划统一）：棋盘格坐标 `{r, c}`，`r∈[0,rows) c∈[0,cols)`；路径点可越出棋盘到虚拟外圈 `r∈[-1,rows] c∈[-1,cols]`。`alive(r,c)` 返回该格是否有未消除卡片。board 表示：`cells[r][c] = 图案索引|null`。

---

### Task 1: 骨架与测试通道

**Files:**
- Create: `prototype/lianliankan-prototype.html`
- Create: `prototype/tools/extract.mjs`
- Create: `prototype/tools/run-tests.sh`
- Create: `prototype/tests/engine.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: HTML 内注释锚 `/* === ENGINE START === */ … /* === ENGINE END === */` 与 `/* === STORE START === */ … /* === STORE END === */`；`LEVELS: Array<{id,rows,cols,kinds,rule:'free'|'oneTurn'|'classic',hint?:number}>`（9 项）；`POOL: string[]`（12 Emoji）。extract 产出 `prototype/.test/engine.mjs`、`prototype/.test/store.mjs`。

- [ ] **Step 1: 写失败测试** `prototype/tests/engine.test.mjs`

```js
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
```

- [ ] **Step 2: 写 extract 工具** `prototype/tools/extract.mjs`

```js
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const html = readFileSync(new URL('lianliankan-prototype.html', root), 'utf8');
const EXPORTS = {
  engine: 'LEVELS, POOL, MAXTURNS, findPath, generateBoard, hasAvailablePair, findHint, reshuffle, attempt',
  store: 'STORE_KEY, loadProgress, saveProgress, markCleared',
};
mkdirSync(new URL('.test/', root), { recursive: true });
for (const [name, exports] of Object.entries(EXPORTS)) {
  const UP = name.toUpperCase();
  const m = html.match(new RegExp(`/\\* === ${UP} START === \\*/([\\s\\S]*?)/\\* === ${UP} END === \\*/`));
  if (!m) throw new Error(`未找到 ${UP} 锚段`);
  writeFileSync(new URL(`.test/${name}.mjs`, root), m[1] + `\nexport { ${exports} };\n`);
}
console.log('extracted: engine.mjs store.mjs');
```

注意：STORE 段在 T1 还不存在，extract 会抛错——这正是要先失败的事；为让 T1 绿灯，本步在 HTML 里放一个只含 `const STORE_KEY='llk-toddler-v1'; const loadProgress=()=>({cleared:[],sound:true,voice:true,hintUsed:{}}); const saveProgress=()=>{}; const markCleared=()=>{};` 的占位 STORE 段（Task 5 会真正实现并单测，占位不算交付逻辑）。

- [ ] **Step 3: 写 run-tests 脚本** `prototype/tools/run-tests.sh`

```bash
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
node tools/extract.mjs
node --test tests/
```

- [ ] **Step 4: 写 HTML 骨架** `prototype/lianliankan-prototype.html`

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1,
  user-scalable=no, viewport-fit=cover">
<title>连连看小公主</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-user-select:none;
      user-select:none; -webkit-tap-highlight-color:transparent; }
  html,body { height:100%; touch-action:manipulation; overscroll-behavior:none; }
  body { font-family:-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif;
    background:linear-gradient(180deg,#FFE4F0,#F3E8FF); overflow:hidden; }
  #app { height:100dvh; padding:env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left); }
  section { display:none; height:100%; }
  section.on { display:flex; flex-direction:column; }
</style>
</head>
<body>
<div id="app">
  <section id="scr-open"></section>
  <section id="scr-map"></section>
  <section id="scr-game"></section>
  <section id="scr-win"></section>
  <section id="scr-parent"></section>
</div>
<script>
/* === ENGINE START === */
const POOL = ['🦄','🐰','🐱','🦊','🐼','🌈','⭐','🎀','🍓','🧁','🍭','🌸'];
const MAXTURNS = { free:null, oneTurn:1, classic:2 };
const LEVELS = [
  { id:1, rows:3, cols:4, kinds:4,  rule:'free' },
  { id:2, rows:3, cols:4, kinds:5,  rule:'free' },
  { id:3, rows:4, cols:4, kinds:6,  rule:'free' },
  { id:4, rows:4, cols:4, kinds:6,  rule:'oneTurn' },
  { id:5, rows:4, cols:5, kinds:7,  rule:'oneTurn' },
  { id:6, rows:4, cols:5, kinds:8,  rule:'oneTurn' },
  { id:7, rows:4, cols:6, kinds:9,  rule:'classic', hint:1 },
  { id:8, rows:5, cols:6, kinds:10, rule:'classic', hint:1 },
  { id:9, rows:5, cols:6, kinds:10, rule:'classic', hint:1 },
];
function findPath(){ return null; } function generateBoard(){ return null; }
function hasAvailablePair(){ return false; } function findHint(){ return null; }
function reshuffle(){ return null; } function attempt(){ return null; }
/* === ENGINE END === */
/* === STORE START === */
const STORE_KEY = 'llk-toddler-v1';
function loadProgress(){ return { cleared:[], sound:true, voice:true, hintUsed:{} }; }
function saveProgress(){} function markCleared(){}
/* === STORE END === */
</script>
</body>
</html>
```

- [ ] **Step 5: 跑测试确认失败→通过**

Run: `bash prototype/tools/run-tests.sh`
Expected: 首次即 PASS（LEVELS/POOL 已在骨架中实现；若 FAIL 按报错修数据）。再故意改坏 `POOL` 顺序跑一次确认测试真的在断言，改回。

- [ ] **Step 6: Commit**

```bash
git add prototype/
git commit -m "feat(llk): 原型骨架与引擎测试通道（LEVELS/图案池/extract工具）"
```

---

### Task 2: ENGINE — findPath 路径校验（0/1/2 转弯 BFS）

**Files:**
- Modify: `prototype/lianliankan-prototype.html`（ENGINE 段，替换桩函数 `findPath`）
- Modify: `prototype/tests/engine.test.mjs`（追加用例）

**Interfaces:**
- Consumes: 坐标约定（见文件结构节）
- Produces: `findPath(rows, cols, alive, a, b, maxTurns) → Array<{r,c}> | null`。返回折线顶点序列（含首尾，已消除共线中间点），供 view 画线与引擎自校验共用。`alive(r,c)` 由调用方提供；a、b 两点本身视为可进出。

- [ ] **Step 1: 写失败测试**（追加到 `engine.test.mjs`；import 行加 `findPath`）

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bash prototype/tools/run-tests.sh`
Expected: 新用例 FAIL（桩函数返回 null 碰巧过两条——同时保留，实现后必须 4 条全绿；`直线0转弯` 与 `一转弯` 先行失败即可推进）。

- [ ] **Step 3: 实现 findPath**（替换 ENGINE 段桩函数）

```js
function findPath(rows, cols, alive, a, b, maxTurns) {
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
  const key = (r,c) => r + ',' + c;
  const canPass = (r,c) => {
    if (r < -1 || r > rows || c < -1 || c > cols) return false;      // 只允许一圈虚拟外圈
    if (r === b.r && c === b.c) return true;                          // 终点卡可进入
    if (r < 0 || r >= rows || c < 0 || c >= cols) return true;        // 外圈恒空
    return !alive(r,c);
  };
  const parent = new Map([[key(a.r,a.c), null]]);
  let frontier = [[a.r, a.c, -1]];
  for (let turn = 0; turn <= maxTurns && frontier.length; turn++) {
    const next = [];
    for (const [r0,c0,d0] of frontier) {
      for (let d = 0; d < 4; d++) {
        if (d0 >= 0 && (d === d0 || d === (d0 + 2) % 4)) continue; // 直线已在射线内覆盖；不走回头
        let r = r0, c = c0;
        while (canPass(r + DIRS[d][0], c + DIRS[d][1])) {
          r += DIRS[d][0]; c += DIRS[d][1];
          const k = key(r,c);
          if (!parent.has(k)) {
            parent.set(k, [r0, c0]); // 折点记录线段起点，重建后压缩共线
            if (!(r === b.r && c === b.c)) next.push([r, c, d]);
          }
          if (r === b.r && c === b.c) break;
        }
      }
    }
    frontier = next;
  }
  if (!parent.has(key(b.r,b.c))) return null;
  const pts = []; // 从b回溯到a
  let cur = [b.r,b.c];
  while (cur) { pts.push({ r:cur[0], c:cur[1] });
    const p = parent.get(key(cur[0],cur[1])); cur = p; }
  pts.reverse();
  // 等距射线重建：parent记的是线段起点，两点间还需展开直线中间点吗？不需要——view只需折线顶点
  const out = []; // 共线压缩
  for (const p of pts) {
    const n = out.length;
    if (n >= 2) { const [a1,a2] = [out[n-2],out[n-1]];
      const collinear = (a1.r===a2.r && a2.r===p.r) || (a1.c===a2.c && a2.c===p.c);
      if (collinear) { out[n-1] = p; continue; } }
    out.push(p);
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bash prototype/tools/run-tests.sh`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add prototype/
git commit -m "feat(llk): BFS路径校验findPath（0/1/2转弯+虚拟外圈）"
```

---

### Task 3: ENGINE — 生成必可解棋盘 / 死局检测 / 提示 / 洗牌

**Files:**
- Modify: `prototype/lianliankan-prototype.html`（ENGINE 段）
- Modify: `prototype/tests/engine.test.mjs`

**Interfaces:**
- Consumes: `findPath`（T2）、`LEVELS`（T1）
- Produces:
  - `generateBoard(level, rand) → { cells, rule, degraded }`；`cells[r][c] = 图案索引(0..11) | null`；`rule` 正常等于 `level.rule`，50 次重试失败时降为 `'free'` 且 `degraded:true`。
  - `hasAvailablePair(cells, rows, cols, rule) → [{r,c},{r,c}] | null`（返回找到的第一对）。
  - `findHint(cells, rows, cols, rule) → pair | null`（= hasAvailablePair）。
  - `reshuffle(cells, rows, cols, rule, rand) → 新cells`（存活卡图案重排，保证成对；重试 ≤50）。
  - 测试用确定性随机：`mulberry32(seed)` 在测试文件里定义。

- [ ] **Step 1: 写失败测试**

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bash prototype/tools/run-tests.sh`，Expected: FAIL（桩返回 null/false）。

- [ ] **Step 3: 实现**（替换桩；`pairsOf` 内部收集同图案格）

```js
function aliveFn(cells) { return (r,c) => cells[r][c] != null; }
function pairsOf(cells, rows, cols) {
  const byKind = new Map();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = cells[r][c]; if (v == null) continue;
    if (!byKind.has(v)) byKind.set(v, []); byKind.get(v).push({ r, c });
  }
  const pairs = [];
  for (const list of byKind.values())
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
      pairs.push([list[i], list[j]]);
  return pairs;
}
function hasAvailablePair(cells, rows, cols, rule) {
  if (rule === 'free') { const p = pairsOf(cells, rows, cols); return p[0] || null; }
  const mt = MAXTURNS[rule], alive = aliveFn(cells);
  for (const [a, b] of pairsOf(cells, rows, cols))
    if (findPath(rows, cols, alive, a, b, mt)) return [a, b];
  return null;
}
const findHint = hasAvailablePair;
function shuffleArr(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr;
}
function generateBoard(level, rand) {
  const pool = shuffleArr([...POOL.keys()], rand).slice(0, level.kinds);
  const total = level.rows * level.cols, bag = [];
  for (let i = 0; i < total / 2; i++) { const k = pool[i % pool.length]; bag.push(k, k); }
  const cells = [];
  for (let t = 0; t <= 50; t++) {
    shuffleArr(bag, rand);
    const g = Array.from({ length: level.rows }, (_, r) =>
      bag.slice(r * level.cols, (r + 1) * level.cols);
    let rule = level.rule;
    if (t === 50) rule = 'free'; // spec§8 降级：不再校验可解性
    else if (rule !== 'free' && !hasAvailablePair(g, level.rows, level.cols, rule)) continue;
    return { cells: g, rule, degraded: t === 50 };
  }
}
function reshuffle(cells, rows, cols, rule, rand) {
  const pos = [], vals = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    if (cells[r][c] != null) { pos.push([r, c]); vals.push(cells[r][c]); }
  for (let t = 0; t <= 50; t++) {
    shuffleArr(vals, rand);
    const g = cells.map(row => row.map(() => null));
    pos.forEach(([r, c], i) => { g[r][c] = vals[i]; });
    if (rule === 'free' || hasAvailablePair(g, rows, cols, rule)) return g;
  }
  return cells; // 理论上到不了：free保底已在循环内；全失败则原样返回由view静默重试
}
```

注意 `generateBoard` 中 `Array.from` 的括号以可编译为准。`reshuffle` 的保底路径：50 次仍无解的概率在同"成对+有空位重排"约束下趋近于零，返回原样即可（view 不感知）。

- [ ] **Step 4: 跑测试确认通过**

Run: `bash prototype/tools/run-tests.sh`，Expected: 全 PASS。若 `hasAvailablePair` 用例中 2×2 classic 断言与算法实际不符，以 T2 算法定义为准修正测试预期（不得反向改算法迁就错测试——改前先在 spec §3 复核规则语义）。

- [ ] **Step 5: Commit**

```bash
git add prototype/
git commit -m "feat(llk): 必可解棋盘生成/死局检测/提示/洗牌救援"
```

---

### Task 4: ENGINE — attempt 配对判定（含 free 档旁路）

**Files:**
- Modify: `prototype/lianliankan-prototype.html`（ENGINE 段）
- Modify: `prototype/tests/engine.test.mjs`

**Interfaces:**
- Consumes: `findPath`、`MAXTURNS`
- Produces: `attempt(cells, rows, cols, rule, a, b) → {type:'match', path} | {type:'diff'} | {type:'blocked'}`。`diff`=图案不同；`blocked`=同图案路径不通；free 档永不 blocked（同图案即 match，`path=[a,b]`）。

- [ ] **Step 1: 写失败测试**

```js
test('attempt：异图案diff；同图案free即match；classic不通blocked', () => {
  const cells = [[0, 1], [2, 0]]; // (0,0)(1,1)都是图案0
  assert.deepEqual(attempt(cells, 2, 2, 'free', {r:0,c:0}, {r:1,c:1}).type, 'match');
  assert.equal(attempt(cells, 2, 2, 'free', {r:0,c:0}, {r:0,c:1}).type, 'diff');
  // classic：(0,0)与(1,1)对角，2×2内无外圈时1转弯可达（外圈允许则也可达）→ 用大棋盘构造真不通
  const big = [[0,1,1,1],[1,1,1,1],[1,1,1,0]]; // 图案0在(0,0)与(2,3)，中间全占
  const res = attempt(big, 3, 4, 'classic', {r:0,c:0}, {r:2,c:3});
  assert.equal(res.type, 'blocked'); // 需≥3转弯，外圈仅1层救不回
  const ok = attempt([[0, null, 0]], 1, 3, 'classic', {r:0,c:0}, {r:0,c:2});
  assert.equal(ok.type, 'match'); assert.deepEqual(ok.path, [{r:0,c:0},{r:0,c:2}]);
});
```

- [ ] **Step 2: 跑测试确认失败** — `bash prototype/tools/run-tests.sh`，Expected: FAIL。

- [ ] **Step 3: 实现**

```js
function attempt(cells, rows, cols, rule, a, b) {
  if (a.r === b.r && a.c === b.c) return { type: 'diff' };          // 点同一格按无效对待
  if (cells[a.r][a.c] !== cells[b.r][b.c]) return { type: 'diff' };
  if (rule === 'free') return { type: 'match', path: [a, b] };
  const path = findPath(rows, cols, aliveFn(cells), a, b, MAXTURNS[rule]);
  return path ? { type: 'match', path } : { type: 'blocked' };
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: 全 PASS。

- [ ] **Step 5: Commit** — `git commit -am "feat(llk): attempt配对判定（free旁路/classic路径）"`（先 `git add prototype/`）

---

### Task 5: STORE — 进度持久化（可注入 storage + 降级）

**Files:**
- Modify: `prototype/lianliankan-prototype.html`（STORE 段替换占位）
- Create: `prototype/tests/store.test.mjs`

**Interfaces:**
- Consumes: T1 锚段与导出白名单（`STORE_KEY, loadProgress, saveProgress, markCleared`）
- Produces:
  - `loadProgress(storage) → { cleared:number[], sound:boolean, voice:boolean, hintUsed:{[levelId]:number} }`，任何异常回默认值。
  - `saveProgress(storage, p) → void`，写失败静默（spec §8 无痕模式）。
  - `markCleared(storage, levelId) → 新progress`（去重追加 + 落盘）。
  - `storage` 参数是鸭子接口 `{getItem,setItem}`；APP 传 `localStorage` 包 try 的安全壳，测试传 Map 壳。

- [ ] **Step 1: 写失败测试** `prototype/tests/store.test.mjs`

```js
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
```

- [ ] **Step 2: 跑测试确认失败** — `bash prototype/tools/run-tests.sh`，Expected: store 用例 FAIL（占位实现忽略入参）。

- [ ] **Step 3: 实现**（替换 STORE 占位段）

```js
const STORE_KEY = 'llk-toddler-v1';
const DEFAULT_PROGRESS = { cleared: [], sound: true, voice: true, hintUsed: {} };
function loadProgress(storage) {
  try {
    const d = JSON.parse(storage.getItem(STORE_KEY) || '{}');
    return {
      cleared: Array.isArray(d.cleared) ? d.cleared.filter(n => Number.isInteger(n) && n >= 1 && n <= 9) : [],
      sound: d.sound !== false, voice: d.voice !== false,
      hintUsed: d.hintUsed && typeof d.hintUsed === 'object' ? d.hintUsed : {},
    };
  } catch (e) { return { ...DEFAULT_PROGRESS }; }
}
function saveProgress(storage, p) {
  try { storage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* 无痕模式静默 */ }
}
function markCleared(storage, levelId) {
  const p = loadProgress(storage);
  if (!p.cleared.includes(levelId)) p.cleared.push(levelId);
  saveProgress(storage, p); return p;
}
```

- [ ] **Step 4: 跑测试确认通过** — Expected: engine+store 全 PASS。

- [ ] **Step 5: Commit** — `git commit -m "feat(llk): STORE进度持久化（注入式storage+损坏回退）"`

---

### Task 6: VIEW — 视觉基座与棋盘网格渲染

纯 DOM/CSS，无 node 可测部分；用 browser-use MCP（或人工）截图对照 spec §4/§6 验收。

**Files:**
- Modify: `prototype/lianliankan-prototype.html`（`<style>` 与 `#scr-game` 结构、新增 VIEW 锚段 `<script>` 块）

**Interfaces:**
- Consumes: `generateBoard`（T3）、LEVELS
- Produces: `View.buildGame(level)` → 渲染 5×6 最大网格自适应容器；`View.cellEl(r,c)`；`View.setSelected(cellEl|null)`；`View.shake(cellEl)`；`View.vanish(cellEl)`（CSS 类：`.sel` `.shake` `.pop`）；棋盘容器 `#board`（CSS grid，`--gap:2.5vw`），连线层 `<svg id="lines">` 绝对定位覆盖 `#board`。

- [ ] **Step 1: 写 CSS**（追加进 `<style>`，值按 Global Constraints）

```css
.bg-deco { position:fixed; inset:0; pointer-events:none; overflow:hidden; }
.cloud { position:absolute; width:26vw; height:10vw; border-radius:50%;
  background:rgba(255,255,255,.5); animation:drift 60s linear infinite; }
@keyframes drift { from{transform:translateX(-30vw)} to{transform:translateX(110vw)} }
#scr-game { padding:2vw; }
.topbar { display:flex; align-items:center; height:6vh; font-size:16px; }
#board-wrap { position:relative; flex:1; display:flex; align-items:center; justify-content:center; }
#board { display:grid; gap:var(--gap,2.5vw); width:100%; max-width:92vw;
  grid-template-columns:repeat(var(--cols),1fr); }
.card { aspect-ratio:1; background:#fff; border:2px solid #FFB6D9; border-radius:22%;
  box-shadow:0 4px 12px rgba(255,150,200,.35); display:flex; align-items:center;
  justify-content:center; font-size:clamp(28px,9vw,64px); transition:transform .15s; }
.card.sel { border-color:#FFD700; box-shadow:0 0 16px #FFD700; transform:scale(1.15); }
.card.shake { animation:shake .4s; }
@keyframes shake { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-6deg)}
  75%{transform:rotate(6deg)} }
.card.pop { animation:pop .35s forwards; }
@keyframes pop { 60%{transform:scale(1.2);opacity:1} 100%{transform:scale(0);opacity:0} }
#lines { position:absolute; inset:0; pointer-events:none; }
```

- [ ] **Step 2: 写 VIEW 段 JS**（`/* === VIEW START/END === */` 锚，IIFE 挂 `globalThis.View`）

```js
const View = (() => {
  const $ = s => document.querySelector(s);
  function buildGame(level) {
    $('#scr-game').innerHTML = `
      <div class="topbar"><button class="back">←</button>
        <span class="stars"></span><button class="hint" hidden>💡</button></div>
      <div id="board-wrap"><div id="board"></div><svg id="lines"></svg></div>`;
    const b = $('#board');
    b.style.setProperty('--cols', level.cols);
    const minShare = 15 / level.cols; // spec§4③ 最小卡宽15%屏宽→cols>6时收窄gap
    b.style.setProperty('--gap', (level.cols <= 5 ? 2.5 : 1.5) + 'vw');
    return b;
  }
  function renderBoard(cells, onTap) {
    const b = $('#board'); b.innerHTML = '';
    cells.forEach((row, r) => row.forEach((v, c) => {
      const d = document.createElement('div');
      d.className = 'card'; d.dataset.r = r; d.dataset.c = c;
      d.textContent = v == null ? '' : POOL[v];
      if (v == null) { d.style.visibility = 'hidden'; }
      d.addEventListener('pointerdown', () => onTap({ r, c }));
      b.appendChild(d);
    }));
  }
  const cellEl = (r, c) => document.querySelector(
    `#board .card[data-r="${r}"][data-c="${c}"]`);
  const setSelected = (el, on) => el && el.classList.toggle('sel', on);
  const shake = el => { el.classList.remove('shake'); void el.offsetWidth;
    el.classList.add('shake'); };
  const vanish = el => { el.classList.add('pop'); setTimeout(
    () => { el.style.visibility = 'hidden'; el.classList.remove('pop'); }, 350); };
  return { buildGame, renderBoard, cellEl, setSelected, shake, vanish };
})();
```

- [ ] **Step 3: 浏览器验收**

Run: `open prototype/lianliankan-prototype.html`（或 browser-use `navigate_page` 到 `file://` + `take_screenshot` 375×812）。
Expected 清单：3×4 与 5×6 两种棋盘截图；卡片为白底粉边圆角大块、Emoji 清晰；选中态金边放大；背景粉色渐变+飘云；无横向滚动；`doubletap`/`pinch` 不触发缩放。

- [ ] **Step 4: Commit** — `git commit -m "feat(llk): VIEW视觉基座与大卡片网格"`

---

### Task 7: VIEW — 彩虹连线、庆祝与撒花动画

**Files:**
- Modify: `prototype/lianliankan-prototype.html`（VIEW 段 + `<style>`）

**Interfaces:**
- Consumes: `View.cellEl`、engine 返回的 `path`（折线顶点，含外圈负坐标）
- Produces: `View.drawPath(path)` → SVG polyline（外圈点 clamp 到 board 外沿），400ms 流动后淡出；`View.celebrate(kind)`：`kind='pair'` 在两点处星星粒子；`kind='win'` 全屏撒花；`View.centerOf({r,c}) → {x,y}`。

- [ ] **Step 1: 实现坐标换算与画线**

```js
function centerOf(p) {
  const wrap = $('#board').getBoundingClientRect(), one = wrap.width / parseFloat(
    getComputedStyle($('#board')).getPropertyValue('--cols'));
  // 外圈(-1/rows/cols)clamp到板外一半个格子
  const clamp = (v, max) => Math.max(-0.4, Math.min(max + 0.4, v));
  return { x: (clamp(p.c, colsN - 1) + 0.5) * one, y: (clamp(p.r, rowsN - 1) + 0.5) * one };
}
function drawPath(path) {
  const svg = $('#lines'); svg.setAttribute('viewBox',
    `0 0 ${$('#board').clientWidth} ${$('#board').clientHeight}`);
  const pts = path.map(centerOf).map(p => `${p.x},${p.y}`).join(' ');
  const grad = `<defs><linearGradient id="rg" x1="0" x2="1">
    <stop offset="0" stop-color="#FF7AB6"/><stop offset=".5" stop-color="#FFD700"/>
    <stop offset="1" stop-color="#8ED6FF"/></linearGradient></defs>`;
  svg.innerHTML = grad + `<polyline points="${pts}" fill="none" stroke="url(#rg)"
    stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
    class="flow"/>`;
  setTimeout(() => svg.innerHTML = '', 420);
}
```

（`colsN/rowsN` 由 `buildGame` 时记入闭包变量；`flow` 类 CSS：`stroke-dasharray:12 8; animation: dash .4s linear;` + `@keyframes dash { from{stroke-dashoffset:20} to{stroke-dashoffset:0} }`）

- [ ] **Step 2: 星星粒子与撒花**（纯 CSS 类 + 生成器，元素数封顶：单对 6 星、撒花 40 片，350ms/2s 后 remove）

```js
function burst(el) { const b = el.getBoundingClientRect(), host = $('#app');
  for (let i = 0; i < 6; i++) { const s = document.createElement('span');
    s.className = 'spark'; s.textContent = '⭐';
    s.style.left = b.left + b.width / 2 + 'px'; s.style.top = b.top + b.height / 2 + 'px';
    s.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
    s.style.setProperty('--dy', (Math.random() * -80 - 10) + 'px');
    host.appendChild(s); setTimeout(() => s.remove(), 600); } }
function confetti() { const host = $('#scr-win');
  for (let i = 0; i < 40; i++) { const s = document.createElement('span');
    s.className = 'conf'; s.textContent = ['🎉','✨','🌸','💗'][i % 4];
    s.style.left = Math.random() * 100 + 'vw'; s.style.animationDelay = Math.random() + 's';
    host.appendChild(s); setTimeout(() => s.remove(), 2500); } }
```

CSS：`.spark{position:fixed;font-size:18px;animation:fly .6s forwards}
@keyframes fly{to{transform:translate(var(--dx),var(--dy));opacity:0}}`；
`.conf{position:absolute;top:-5vh;animation:fall 2s linear forwards}
@keyframes fall{to{transform:translateY(110vh) rotate(360deg)}}`。

- [ ] **Step 3: 浏览器验收**

在 devtools console 手工注入一对坐标调 `drawPath` + `burst` + `confetti`；截图确认彩虹线沿折点走向正确、外圈绕行点不被裁切、撒花全屏飘落。

- [ ] **Step 4: Commit** — `git commit -m "feat(llk): SVG彩虹连线/星星粒子/庆祝撒花"`

---

### Task 8: AUDIO — Web Audio 合成音效 + 中文鼓励语音

**Files:**
- Modify: `prototype/lianliankan-prototype.html`（`/* === AUDIO START/END === */` 锚段）

**Interfaces:**
- Consumes: `store.sound / store.voice` 开关（T5）
- Produces: `Audio.play(name)`，`name ∈ {'ding','pop','cheer','windchime'}`；`Audio.say(text)`（同义句去抖：1.5s 内相同文本不重播）；`Audio.init()`（首次 `pointerdown` 调用，建 AudioContext）。全部静默降级：构造失败 → 空操作（spec §8）。

- [ ] **Step 1: 实现**

```js
const Audio = (() => {
  let ctx = null, ok = true, lastSay = { t: 0, text: '' };
  let flags = { sound: true, voice: true };
  function init() { if (ctx || !ok) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { ok = false; } }
  function tone(freq, ms, type = 'sine', gain = .15) {
    if (!ok || !ctx || !flags.sound) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = gain;
    o.connect(g).connect(ctx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + ms / 1000);
    o.stop(ctx.currentTime + ms / 1000 + .02);
  }
  function play(n) {
    if (n === 'ding') { tone(1318, 180); tone(1760, 120); }
    if (n === 'pop') tone(523, 120, 'triangle');
    if (n === 'cheer') [880, 1108, 1318].forEach((f, i) => setTimeout(() => tone(f, 250), i * 120));
    if (n === 'windchime') [1568, 2093].forEach((f, i) => setTimeout(() => tone(f, 200, 'sine', .08), i * 90));
  }
  function say(text) {
    if (!flags.voice || !('speechSynthesis' in window)) return;
    const now = Date.now();
    if (text === lastSay.text && now - lastSay.t < 1500) return;
    lastSay = { t: now, text };
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = .9; u.pitch = 1.3;
    speechSynthesis.speak(u); // 不可用时浏览器静默
  }
  function setFlags(f) { flags = f; }
  window.addEventListener('pointerdown', init, { once: true });
  return { play, say, setFlags };
})();
```

- [ ] **Step 2: 浏览器验收**

真机或桌面 Chrome：console 调 `Audio.say('真棒!')` 听到甜美女声（无中文音色时接受系统默认，记录为已知限制）；静音开关置 false 后 `play('ding')` 无声；`Audio` 在未 init 前调用不抛错。

- [ ] **Step 3: Commit** — `git commit -m "feat(llk): WebAudio音效与zh-CN鼓励语音"`

---

### Task 9: APP — 五屏接线（开场/地图/游戏/庆祝/家长）+ 分阶规则流程

**Files:**
- Modify: `prototype/lianliankan-prototype.html`（`/* === APP START/END === */` 段 + `#scr-open/#scr-map/#scr-win/#scr-parent` 结构与 CSS）

**Interfaces:**
- Consumes: `LEVELS/generateBoard/attempt/reshuffle/hasAvailablePair`、`View.*`、`Audio.*`、`loadProgress/saveProgress/markCleared`
- Produces: 全局 `App = { go(screen), startLevel(id), tapCell(rc), win(), useHint() }`；屏幕切换用 `.on` 类；localStorage 经安全壳 `safeStorage`（getItem/setItem 各包 try，失败回内存 Map——满足 spec §8 无痕可玩）。

状态机要点（全部写进此任务的实现）：

1. **tapCell**：`sel` 为空 → 选中（View.setSelected + Audio 'ding'）；点同格 → 取消；第二格 → `attempt`：
   - `match`：`View.drawPath` → 400ms 后两卡 `View.vanish + View.burst` → `Audio.say(轮换鼓励语)` → `navigator.vibrate?.(30)` → cells 置 null → 若棋盘清空 → `win()`；否则若该档非 free 且 `!hasAvailablePair` → `reshuffle` + `Audio.say('老师帮你重新摆好啦，继续!')` + `Audio.play('windchime')` + 重渲染（卡面翻转动画=对每张卡加 `.reshuffle` 类做 360°Y 转）。
   - `diff/blocked`：两卡 `View.shake` + `Audio.play('pop')` + `Audio.say('再找一个试试')`，sel 清空。
2. **win**：`markCleared(safeStorage, level.id)` → `go('win')` → `View.confetti()` + `Audio.play('cheer')` + `Audio.say('太棒啦!第'+level.id+'关完成!')` → 3s 定时自动去下一关（第 9 关后：若 `cleared.length===9` 开场页语音改为"你已经是个连连看小高手啦!"并回到第 1 关重玩；地图页可重复挑战任意已解锁关）。
3. **新规则讲解**（进入 level 4/7 时一次，`hintUsed` 里记 `taught:4/7` 标记）：棋盘上盖半透明 `#teach` 层，演示高亮两卡+画一条示例线，语音一句规则口语（4 关："这次要找能连成线的哦"；7 关："线最多拐两个弯!"），3s 后或点击淡出。
4. **提示灯**（7-9 关）：`store.hintUsed[levelId] < level.hint` 才亮；点击 → `findHint` 选中那对（两卡加 `.sel` 呼吸类 `.breathe`），计数 +1 落盘；用完 `💡` 置灰。
5. **长按家长门**：开场页 Logo `pointerdown` 起 3s 计时器，`pointermove>10px` 或 `pointerup` 提前取消 → 满 3s `go('parent')`。家长页：两个 checkbox（音效/语音）即时 `saveProgress`，"重置进度"按钮二次确认（连点两次确认文案）清 localStorage 回开场。
6. **地图页**：9 节点之字形布局（CSS 定位表 9 组 `left/top%`），状态=已通（亮+⭐）/当前（`.breathe`+发光）/未锁（`opacity:.45` 仍可点——幼儿游戏不设惩罚锁，点击未解锁关则语音说"先过前面的关卡吧"并保持不可进）。当前关 = `max(cleared)+1`（≤9）。

- [ ] **Step 1: 写屏结构与 CSS**（`#scr-open` 大按钮、`#scr-map` 节点表、`#scr-win` 大字、`#scr-parent` 开关；全部按 spec §4 线框）

```css
.big-btn { width:40vw; height:40vw; border-radius:50%; border:none; font-size:24px;
  background:radial-gradient(circle at 35% 30%,#FFC6DD,#FF7AB6); color:#fff;
  box-shadow:0 8px 24px rgba(255,122,182,.5); margin:auto; }
.breathe { animation:breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50%{transform:scale(1.08);box-shadow:0 0 20px #FFD700} }
.node { position:absolute; width:13vw; height:13vw; border-radius:50%; background:#fff;
  border:3px solid #FFB6D9; display:flex; align-items:center; justify-content:center;
  font-size:22px; }
.node.done { border-color:#FFD700; } .node.locked { opacity:.45; }
#teach { position:absolute; inset:0; background:rgba(255,228,240,.75); display:flex;
  align-items:center; justify-content:center; font-size:22px; color:#B0447A; }
.reshuffle { animation:flip .8s; } @keyframes flip { 50%{transform:rotateY(180deg) scale(1.1)} }
```

- [ ] **Step 2: 实现 App 状态机**（按上面 6 条要点逐一落码；轮换鼓励语数组 `PRAISE=['真棒!','就是这样!','好厉害呀!']` 全局游标递增取模）

- [ ] **Step 3: 逐关手工走查**

浏览器 375×812 从第 1 关打到第 9 关。检查：free 档点两张同图案必消；4 关讲解层出现且只出现一次（重进不再弹）；4-6 关 blocked 只摇头；人为在 console 构造死局触发洗牌救援语音；7 关起提示灯可用一次后变暗；庆祝页 3s 自动推进；长按 Logo 3s 进家长页，两个开关即时生效；无痕模式全流程不报错。

- [ ] **Step 4: 跑回归测试** — `bash prototype/tools/run-tests.sh`，Expected: engine+store 全 PASS（APP 段不进测试通道，但改动如触碰 ENGINE/STORE 锚必须保持绿灯）。

- [ ] **Step 5: Commit** — `git commit -m "feat(llk): 五屏App流程/家长入口/教学层/提示与洗牌救援"`

---

### Task 10: 终验与交付

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-lianliankan-toddler-design.md`（状态行改为"已实现并验收"）
- Create: `prototype/README.md`（如何打开、如何测试、真人口径）

- [ ] **Step 1: 真机验收清单**（spec §9 手工清单逐项打钩，写入 README）
  1. iOS Safari：加到主屏幕、竖屏无缩放、9 关通关、语音正常。
  2. Android Chrome：同上 + `navigator.vibrate` 生效或静默。
  3. 断网飞行模式重开：全功能（spec §10.4）。
  4. 无痕模式：进度不保存但不崩（spec §8）。
- [ ] **Step 2: 真人试玩**（spec §10 成功标准 1/2：孩子 ≤2 分钟主动配对、无受挫弃玩；把观察结果记入 README 的"验证记录"节，未达标项列 issue 不阻塞本计划）
- [ ] **Step 3: 更新 spec 状态并提交**

```bash
git add docs prototype/README.md
git commit -m "docs(llk): 原型终验清单与真人试玩记录模板；spec标记已实现"
```

**不在本计划**（spec §11 演进，届时另立计划）：SVG 定制美术、Capacitor APK 工程（先检查本机 Android SDK）、照片卡面、iOS 打包。

---

## Self-Review 结论

1. **Spec 覆盖**：§3 玩法表→T1 LEVELS+T2/T3 规则；§4 五屏→T6/T9；§5 反馈矩阵→T6/7/8/9；§6 视觉→T6/7 CSS；§7 架构→T1-T9 模块与锚；§8 降级→T3(50次)/T5(损坏)/T8(静默)/T9(safeStorage)；§9 测试→T2-T5 node + T9/T10 手工；§10 验收→T10。无缺口。
2. **占位符**：无 TBD；T2/T3 代码中两处标注了"实现时以可编译为准"的括号级细节，逻辑完整。
3. **类型一致性**：`{r,c}` 格点、`cells[r][c]`、`{type:'match',path}`、`loadProgress→{cleared,sound,voice,hintUsed}` 全程一致；`findHint = hasAvailablePair` 别名已声明。
