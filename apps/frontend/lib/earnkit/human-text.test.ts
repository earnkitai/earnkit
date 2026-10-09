import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EM_DASH, humanStrings, humanTextFiles, notHumanText } from './human-text';
import { NO_CELL } from './no-cell';
import { NO_CELL as PRESENT_NO_CELL } from './present';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

test('Ruling 16 (plan): humanStrings finds literals, template parts and JSX text, and skips comments', () => {
  const src = [
    '// a comment — fine',
    '/** doc — fine */',
    "const a = 'one — two';",
    'const b = `x ${y} three — four`;',
    'const c = <p>five — six</p>;',
  ].join('\n');
  const found = humanStrings('x.tsx', src);
  assert.deepEqual(
    found.filter((s) => s.text.includes(EM_DASH)).map((s) => s.text),
    ['one — two', ' three — four', 'five — six'],
  );
  assert.deepEqual(
    found.filter((s) => s.text.includes(EM_DASH)).map((s) => s.line),
    [3, 4, 5],
  );
});

test('Ruling 16 (plan): no em dash in any human text', () => {
  const hits: string[] = [];
  for (const path of humanTextFiles(ROOT)) {
    const source = readFileSync(join(ROOT, path), 'utf8');
    if (/\.(ts|tsx|mts)$/.test(path)) {
      for (const s of humanStrings(path, source)) if (s.text.includes(EM_DASH)) hits.push(`${path}:${s.line}`);
    } else {
      source.split('\n').forEach((l, i) => l.includes(EM_DASH) && hits.push(`${path}:${i + 1}`));
    }
  }
  assert.deepEqual(hits, []);
});

test('Ruling 16 (plan): the scan is not vacuous', () => {
  const files = humanTextFiles(ROOT);
  // Every scanned root contributes files, so a root dropped from the scan can't hide behind the
  // total; the total stays close to the real count (149 at v2.8 Task 2).
  for (const [root, min] of [['apps/frontend/app/', 50], ['apps/frontend/lib/', 55], ['apps/frontend/scripts/', 8], ['programs/', 6], ['apps/frontend/public/', 1]] as const) {
    const n = files.filter((f) => f.startsWith(root)).length;
    assert.ok(n >= min, `${root}: only ${n} files`);
  }
  assert.ok(files.includes('apps/frontend/scripts/programs-sync.mts'), 'scripts');
  assert.ok(files.length >= 140, `only ${files.length} files`);
  for (const f of ['apps/frontend/public/llms.txt', 'programs/arc-microgrants.json', 'programs/README.md', 'apps/frontend/app/page.tsx', 'apps/frontend/app/components/sections/Hero.tsx'])
    assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => /\.test\.tsx?$/.test(f) || f.includes('/fixtures/') || f.endsWith('/human-text.ts')));
});

test('final review M1: .test.mts files are not human text, like .test.ts and .test.tsx', () => {
  for (const p of ['apps/frontend/scripts/x.test.mts', 'apps/frontend/lib/a.test.ts', 'apps/frontend/app/b.test.tsx'])
    assert.ok(notHumanText(p), p);
  for (const p of ['apps/frontend/scripts/x.mts', 'apps/frontend/lib/a.ts', 'apps/frontend/lib/testing.ts'])
    assert.ok(!notHumanText(p), p);
});

test('final review M1: humanTextFiles never enters a fixtures directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'human-text-'));
  const locked = join(root, 'apps/frontend/lib/fixtures');
  try {
    for (const d of ['apps/frontend/app', 'apps/frontend/scripts', 'programs', 'apps/frontend/lib/fixtures'])
      mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, 'apps/frontend/lib/a.ts'), "export const a = 'a';");
    writeFileSync(join(locked, 'f.ts'), "export const f = 'f';");
    // Unreadable: entering it would throw.
    chmodSync(locked, 0o000);
    const files = humanTextFiles(root);
    assert.ok(files.includes('apps/frontend/lib/a.ts'));
    assert.ok(!files.some((f) => f.includes('fixtures')));
  } finally {
    chmodSync(locked, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test('final review M1: the client card shares NO_CELL with the agent tables (one empty-cell sentinel)', () => {
  assert.equal(PRESENT_NO_CELL, NO_CELL);
  const card = readFileSync(join(ROOT, 'apps/frontend/app/components/sections/ProgramCard.tsx'), 'utf8');
  assert.match(card, /import \{ NO_CELL \} from '..\/..\/..\/lib\/earnkit\/no-cell';/);
  assert.match(card, /t\.difficulty !== NO_CELL/);
  assert.doesNotMatch(card, /!== ''/);
});

test('11.3 (F21): no hard-coded money total in human text; openFigure and poolTotalText stay inside pool.ts', () => {
  const hits: string[] = [];
  const banned = ['$1.3M', '1,170,500', '1170500'];
  for (const path of humanTextFiles(ROOT)) {
    const source = readFileSync(join(ROOT, path), 'utf8');
    const texts = /\.(ts|tsx|mts)$/.test(path) ? humanStrings(path, source).map((s) => ({ text: s.text, line: s.line })) : source.split('\n').map((text, i) => ({ text, line: i + 1 }));
    for (const t of texts) for (const b of banned) if (t.text.includes(b)) hits.push(`${path}:${t.line} ${b}`);
  }
  assert.deepEqual(hits, []);
  // Source scan: every .ts/.tsx under app/ and lib/ (tests included) but pool.ts and its test.
  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (name === 'node_modules' || name === '.next') continue;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mts)$/.test(name) && !/\/pool(\.test)?\.ts$/.test(rel) && /import\s*\{[^}]*\b(openFigure|poolTotalText)\b[^}]*\}\s*from/.test(readFileSync(join(ROOT, rel), 'utf8')))
        importers.push(rel);
    }
  };
  ['apps/frontend/app', 'apps/frontend/lib', 'apps/frontend/scripts'].forEach(walk);
  assert.deepEqual(importers, []);
});
