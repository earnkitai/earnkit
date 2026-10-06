import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLogoFile } from './logo-check';

/** v2.7 fix round 1 (Finding 8): the read-and-check path `programs-sync.mts` runs, not just the
 * pure `logoFileProblem`. */

test('checkLogoFile: a missing file reads as not found, through the real fs read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'earnkit-logo-'));
  const problem = checkLogoFile(
    { path: 'programs/missing.svg', source_url: 'https://example.org/brand' },
    dir,
  );
  assert.match(problem!, /programs\/missing\.svg not found under apps\/frontend\/public/);
});

test('checkLogoFile: a present, safe file reads and passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'earnkit-logo-'));
  mkdirSync(join(dir, 'programs'), { recursive: true });
  writeFileSync(
    join(dir, 'programs', 'ok.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
  );
  const problem = checkLogoFile(
    { path: 'programs/ok.svg', source_url: 'https://example.org/brand' },
    dir,
  );
  assert.equal(problem, null);
});

test('checkLogoFile: a present, unsafe file reads and fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'earnkit-logo-'));
  mkdirSync(join(dir, 'programs'), { recursive: true });
  writeFileSync(join(dir, 'programs', 'bad.svg'), '<svg onload="x()"/>');
  const problem = checkLogoFile(
    { path: 'programs/bad.svg', source_url: 'https://example.org/brand' },
    dir,
  );
  assert.match(problem!, /scripts, event handlers or external links/);
});
