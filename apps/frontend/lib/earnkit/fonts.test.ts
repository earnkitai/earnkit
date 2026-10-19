import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(import.meta.dirname, '..', '..', 'app');

test('10.1 the layout loads both fonts from local files, never Google', () => {
  const src = readFileSync(join(APP, 'layout.tsx'), 'utf8');
  assert.doesNotMatch(src, /next\/font\/google/);
  assert.match(src, /from 'next\/font\/local'/);
  assert.match(src, /--font-funnel-display/);
  assert.match(src, /--font-funnel-sans/);
  for (const f of ['funnel-display-latin-wght-normal.woff2', 'funnel-sans-latin-wght-normal.woff2']) {
    const p = join(APP, 'fonts', f);
    assert.ok(existsSync(p), f);
    assert.equal(readFileSync(p).subarray(0, 4).toString('latin1'), 'wOF2', `${f} is a woff2 file`);
    assert.ok(src.includes(`./fonts/${f}`), `${f} is used`);
  }
  assert.match(readFileSync(join(APP, 'fonts', 'OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/i);
});
