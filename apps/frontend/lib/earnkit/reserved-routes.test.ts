import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RESERVED_ROUTES, isReserved, pagePath, pageUrl } from './reserved-routes';

const FRONTEND = join(import.meta.dirname, '..', '..');

test('1.1 every top-level app route and public file name is reserved (a new route fails here until added)', () => {
  const app = join(FRONTEND, 'app');
  for (const name of readdirSync(app)) {
    if (name.startsWith('[') || name.startsWith('(')) continue;
    // A route file's directory (app/llms.txt) is its name without the extension, as a public file's.
    if (statSync(join(app, name)).isDirectory()) assert.ok(isReserved(name.replace(/(?<=.)\.[^.]+$/, '')), `app/${name} is not in RESERVED_ROUTES`);
  }
  for (const file of ['favicon.ico', 'sitemap.ts']) assert.ok(isReserved(file.replace(/\..*$/, '')), file);
  for (const name of readdirSync(join(FRONTEND, 'public'))) assert.ok(isReserved(name.replace(/(?<=.)\.[^.]+$/, '')), `public/${name}`);
});

test('1.2 reserved checks ignore case', () => {
  assert.equal(isReserved('Terms'), true);
  assert.equal(isReserved('LEADERBOARD'), true);
  assert.equal(isReserved('lee_builds'), false);
  assert.ok(RESERVED_ROUTES.has('x') && RESERVED_ROUTES.has('claim') && RESERVED_ROUTES.has('b'));
});

test('1.3 a reserved handle lives under /b/, every other at the root, in its own case', () => {
  assert.equal(pagePath('Lee_Builds'), '/Lee_Builds');
  assert.equal(pagePath('terms'), '/b/terms');
  assert.equal(pagePath('Admin'), '/b/Admin');
  assert.equal(pageUrl('Lee_Builds'), 'earnkit.com/Lee_Builds');
  assert.equal(pageUrl('mcp'), 'earnkit.com/b/mcp');
});
