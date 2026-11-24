/**
 * v3.8 E8 (plan item 5, cutover A3): private program rows. Saved through track's `add_private` with `private_rows` on,
 * visible to the owner who saved them only, never sent by an agent, and absent from every public and operator read
 * (the leak test). Off, track is unchanged.
 */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../v5/db';
import { track, trackAdvertised, trackDescription, TrackInput, PRIVATE_TRACK_TEXT } from '../v5/track';
import { getProgram, listListedPrograms, listOpenPrograms, programByName } from '../v5/programs';
import { programsListGet, readListedPrograms } from '../v5/programs-read';
import { applicationsGet, byProgramShown } from '../v5/programs-api';
import { ownerDigest } from '../v5/owner-digest';
import { find } from '../v5/find';
import { LLMS_TEXT } from '../v5/llms';
import { ProgramFile } from '../v5/program-file';
import { programFixture } from '../v5/fixtures/program';
import sitemap from '../../app/sitemap';
import { deleteBuilder, linkInstallation, upsertBuilder } from './builders';
import { LIMITS } from '../v5/rate-limit';
import { PRIVATE_LIMIT, privateIdOf, privateProgramOf, privatePrograms } from './private-programs';

after(() => sql().end());

const NOW = new Date('2026-11-24T09:00:00Z');
const TOKEN = 'p'.repeat(40);
beforeEach(() => {
  process.env.EARNKIT_FLAGS = 'private_rows';
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
});
afterEach(() => {
  delete process.env.EARNKIT_FLAGS;
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
});

let n = 0;
async function ctx(builderId: number | null = null) {
  const [r] = await sql()`INSERT INTO installations (token_hash, builder_id) VALUES (${'priv-' + Math.random()}, ${builderId}) RETURNING id`;
  return { installationId: r.id as number, builderId, now: NOW };
}
const uniqueTitle = () => `Zebrafinch Email Grant ${++n} ${Math.random().toString(36).slice(2, 8)}`;
const add = (title: string, over: Record<string, unknown> = {}) => ({
  action: 'add_private',
  private: { title, url: 'https://example.org/grant', organizer: 'Example Org', reward: 'Up to $2,000', ends_at: '2026-12-01T23:59:00+05:30', tz: 'Asia/Kolkata', ...over },
});

test('off: add_private is an unknown argument, nothing is saved, and the tool list is unchanged', async () => {
  delete process.env.EARNKIT_FLAGS;
  const c = await ctx();
  const r = await track(c, add(uniqueTitle()));
  assert.equal(r.refused, true);
  assert.equal(r.program_id, undefined);
  assert.equal((await privatePrograms(`i:${c.installationId}`)).length, 0);
  assert.equal(trackAdvertised({}), TrackInput);
  assert.equal(trackDescription({}).includes(PRIVATE_TRACK_TEXT), false);
  assert.equal(trackDescription({ EARNKIT_FLAGS: 'private_rows' }).endsWith(PRIVATE_TRACK_TEXT), true);
});

test('on: save, update by the same title, track by id and by title, the builder sends it', async () => {
  const c = await ctx();
  const title = uniqueTitle();
  const saved = await track(c, add(title));
  const id = privateIdOf(title);
  assert.equal(saved.program_id, id);
  assert.equal(saved.show_to_builder, `Saved ${title} for you only. It's on no public list, and only you send it.`);
  assert.match(saved.agent_note, /EarnKit never submits it/);
  const again = await track(c, add(title.toUpperCase(), { reward: 'Up to $3,000' }));
  assert.equal(again.program_id, id);
  assert.equal(again.show_to_builder, `Updated ${title.toUpperCase()}. It stays private to you.`);
  assert.equal((await privatePrograms(`i:${c.installationId}`)).length, 1);

  assert.equal((await track(c, { program_id: id, status: 'started' })).refused, undefined);
  // An agent's send is refused: a private program is never submitted by an agent.
  const agentSend = await track(c, { program_id: id, status: 'applied', submitted_by: 'agent' });
  assert.equal(agentSend.refused, true);
  assert.equal(agentSend.show_to_builder, `Only you can send ${title.toUpperCase()}. Tell me once it's in.`);
  assert.equal((await track(c, { program_id: id, status: 'applied' })).refused, true);
  const sent = await track(c, { program_id: title, status: 'applied', submitted_by: 'builder' });
  assert.equal(sent.show_to_builder, `Sent ${title.toUpperCase()}.`);
  const [row] = await sql()`SELECT status, submitted_by FROM applications WHERE owner = ${`i:${c.installationId}`} AND program_id = ${id}`;
  assert.deepEqual({ ...row }, { status: 'applied', submitted_by: 'builder' });
  assert.equal((await track(c, { program_id: id, status: 'won', amount_usd: 1500 })).show_to_builder, `Tracked: $1,500 from ${title.toUpperCase()}.`);
  // Gap steps belong to catalog items only.
  assert.equal((await track(c, { program_id: id, status: 'gap_done', item: 'users' })).refused, true);
});

test('a bad private program is refused with its field and nothing saved', async () => {
  const c = await ctx();
  const r = await track(c, add(uniqueTitle(), { url: 'http://example.org/plain', tz: 'Mars/Base' }));
  assert.equal(r.refused, true);
  assert.match(r.agent_note, /https link/);
  assert.equal((await privatePrograms(`i:${c.installationId}`)).length, 0);
});

test("another owner never sees or tracks a private row: it reads as an unknown program", async () => {
  const mine = await ctx();
  const other = await ctx();
  const title = uniqueTitle();
  const id = (await track(mine, add(title))).program_id!;
  assert.equal(await privateProgramOf(`i:${other.installationId}`, id), null);
  assert.equal(await privateProgramOf(`i:${other.installationId}`, title), null);
  const theirs = await track(other, { program_id: id, status: 'started' });
  assert.equal(theirs.refused, true);
  assert.equal(theirs.show_to_builder.includes(title), false);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${`i:${other.installationId}`}`)[0].n, 0);
});

test('new private rows are limited per owner a day; an update is free', async () => {
  const c = await ctx();
  const titles = Array.from({ length: LIMITS.privateRows.limit }, uniqueTitle);
  for (const t of titles) assert.equal((await track(c, add(t))).refused, undefined);
  const over = await track(c, add(uniqueTitle()));
  assert.equal(over.refused, true);
  assert.equal(over.show_to_builder, PRIVATE_LIMIT);
  assert.equal((await track(c, add(titles[0], { note: 'still open' }))).refused, undefined);
  assert.equal((await privatePrograms(`i:${c.installationId}`)).length, LIMITS.privateRows.limit);
});

test('the leak test: no public or operator read names a private row', async () => {
  const b = await upsertBuilder({ github_id: 880_000 + Math.floor(Math.random() * 100_000), login: 'privtest', name: null, avatar_url: null }, NOW);
  const c = await ctx(b.id);
  const title = uniqueTitle();
  const id = (await track(c, add(title))).program_id!;
  await track(c, { program_id: id, status: 'applied', submitted_by: 'builder' });
  await track(c, { program_id: id, status: 'won', amount_usd: 900 });
  const clean = (what: string, text: string) => {
    assert.equal(text.includes(title), false, `${what} names the private title`);
    assert.equal(text.includes(id), false, `${what} holds the private id`);
  };
  const later = new Date(NOW.getTime() + 86_400_000);
  clean('listListedPrograms', JSON.stringify(await listListedPrograms(NOW)));
  clean('listOpenPrograms', JSON.stringify(await listOpenPrograms(NOW)));
  clean('readListedPrograms', JSON.stringify(await readListedPrograms(NOW)));
  clean('GET /api/programs', await (await programsListGet(new Request('https://earnkit.com/api/programs'), () => readListedPrograms(NOW), NOW)).text());
  assert.equal(await getProgram(id), null);
  assert.equal((await programByName(title, NOW)).row, null);
  clean('sitemap', JSON.stringify(await sitemap()));
  clean('llms.txt', LLMS_TEXT);
  clean('find', JSON.stringify(await find(await ctx(), {})));
  const digest = JSON.stringify(await ownerDigest(later));
  clean('owner digest', digest);
  assert.match(digest, /Private programs/, 'the digest counts it, unnamed');
  const apps = await applicationsGet(new Request('https://earnkit.com/api/programs/applications?limit=500', { headers: { authorization: `Bearer ${TOKEN}` } }));
  assert.equal(apps.status, 200);
  const appsText = await apps.text();
  clean('GET /api/programs/applications', appsText);
  assert.match(appsText, /"program_id":"private","title":"Private programs"/);
  // The owner still reads their own.
  assert.equal((await privateProgramOf(`b:${b.id}`, id))?.title, title);
});

test('only private-programs.ts and the account moves read the private_programs table', () => {
  const root = join(__dirname, '..', '..');
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts)$/.test(name) && !name.endsWith('.test.ts') && /private_programs/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length + 1));
    }
  };
  for (const d of ['app', 'lib', 'scripts']) walk(join(root, d));
  assert.deepEqual(hits.sort(), ['lib/v6/builders.ts', 'lib/v6/private-programs.ts']);
});

test('the operator reads count private programs under one unnamed entry', () => {
  assert.deepEqual(byProgramShown([
    { program_id: 'base-grants', title: 'Base Grants', sent: '3' },
    { program_id: 'private-a', title: 'A', sent: '2' },
    { program_id: 'private-b', title: 'B', sent: 1 },
  ]), [
    { program_id: 'base-grants', title: 'Base Grants', sent: 3 },
    { program_id: 'private', title: 'Private programs', sent: 3 },
  ]);
});

test('a linked install brings its private rows; delete removes them', async () => {
  const b = await upsertBuilder({ github_id: 990_000 + Math.floor(Math.random() * 9_000), login: 'privmove', name: null, avatar_url: null }, NOW);
  const c = await ctx();
  const title = uniqueTitle();
  await track(c, add(title));
  await linkInstallation(c.installationId, b.id, NOW);
  assert.equal((await privatePrograms(`b:${b.id}`)).length, 1);
  assert.equal((await privatePrograms(`i:${c.installationId}`)).length, 0);
  await deleteBuilder(b.id, NOW);
  assert.equal((await privatePrograms(`b:${b.id}`)).length, 0);
});

test('program flags parse; a catalog id may not start with private-', () => {
  const p = programFixture({ id: 'flags-x' });
  const ok = ProgramFile.safeParse({ ...p, reward_kind: 'credits', application_kyc: false, payout_kyc: true, wallet_prompt: false, attestation: true, no_automation: true });
  assert.equal(ok.success, true);
  assert.equal(ProgramFile.safeParse({ ...p, reward_kind: 'tokens' }).success, false);
  const bad = ProgramFile.safeParse({ ...p, id: 'private-x' });
  assert.equal(bad.success, false);
  assert.match(JSON.stringify(bad.error?.issues), /private program id/);
});
