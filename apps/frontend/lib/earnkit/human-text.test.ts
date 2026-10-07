import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EM_DASH, humanStrings, humanTextFiles } from './human-text';

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
  assert.ok(files.length >= 150, `only ${files.length} files`);
  for (const f of ['apps/frontend/public/llms.txt', 'programs/arc-microgrants.json', 'programs/README.md', 'apps/frontend/app/page.tsx'])
    assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => /\.test\.tsx?$/.test(f) || f.includes('/fixtures/') || f.endsWith('/human-text.ts')));
});
