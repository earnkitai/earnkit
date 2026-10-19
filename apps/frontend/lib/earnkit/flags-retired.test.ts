import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as flags from './builder-score-flag';
import { sql } from './db';
import { mcpCall, mcpListTools } from './fixtures/mcp-call';
import { connectInstallation, saveInstallation } from './installations';

const FRONTEND = join(import.meta.dirname, '..', '..');
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });

function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === '.next' || f === 'fixtures') continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx|mts)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
}

test('3.1 no source reads the two retired flags', () => {
  for (const file of ['lib', 'app', 'scripts'].flatMap((d) => sources(join(FRONTEND, d)))) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /builderScoreEnabled\(|benchEnabled\(|EARNKIT_BUILDER_SCORE|EARNKIT_BENCH\b/, file);
  }
});

test('3.2 the flag module keeps only archiveFlag, xSignInEnabled and raisingEnabled (EARNKIT_RAISING alone)', () => {
  assert.deepEqual(Object.keys(flags).sort(), ['RAISING_FLAG', 'archiveFlag', 'raisingEnabled', 'xSignInEnabled']);
  assert.equal(flags.raisingEnabled({}), false);
  assert.equal(flags.raisingEnabled({ EARNKIT_RAISING: 'on' }), true);
  assert.equal(flags.raisingEnabled({ EARNKIT_RAISING: 'yes' }), false);
});

test('3.3 the hidden code is gone', () => {
  for (const p of [
    'lib/earnkit/where-you-stand.ts', 'lib/earnkit/bonus-rounds.ts', 'lib/earnkit/bonus-board.ts', 'lib/earnkit/bonus-payout.ts',
    'app/bonus', 'app/admin/bonus', 'app/components/ui/BonusPill.tsx', 'app/leaderboard/LeaderboardView.tsx',
    'app/[handle]/ProfileView.tsx', 'app/[handle]/ProjectCards.tsx', 'lib/earnkit/llms/v212.txt',
  ]) assert.equal(existsSync(join(FRONTEND, p)), false, p);
  assert.equal(existsSync(join(FRONTEND, 'lib/earnkit/bonus-ledger.ts')), true, 'the fee engine stays');
});

test('3.4 R9: /bench is a permanent (308) redirect to /leaderboard', async () => {
  const { default: Bench } = await import('../../app/bench/page');
  await assert.rejects(async () => Bench(), (e: { digest?: string }) => /NEXT_REDIRECT/.test(String(e.digest)) && /\/leaderboard/.test(String(e.digest)) && /308/.test(String(e.digest)));
});

test('3.5 with no flag set, find through MCP is the Bench reply and no bonus word', db, async () => {
  const token = `ek_t3_${process.pid}_${Date.now()}`;
  await saveInstallation(token, undefined, false);
  const c = (await connectInstallation(token))!;
  const r = await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared }, 'find', {});
  const text = String(r.reply?.show_to_builder ?? '');
  assert.match(text, /Where you stand/);
  assert.match(text, /Ways to get funded/);
  assert.doesNotMatch(text, /bonus/i);
});

test('3.6 tools/list with no flag set: five tools, Bench descriptions, each under 800 characters', async () => {
  const tools = await mcpListTools({ installationId: 1 });
  assert.equal(tools.length, 5);
  for (const t of tools) assert.ok((t.description ?? '').length < 800, t.name);
  assert.match(tools.find((t) => t.name === 'find')!.description ?? '', /identity\.project/);
});
