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
