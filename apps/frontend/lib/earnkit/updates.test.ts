import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { EVENT_LOG_FLAG } from './events';
import { HELD_NOTE, HIDE_DATE_NOTE, HIDE_NONE_NOTE, NOT_CONFIRMED_NOTE, TITLES_NO_APP_NOTE, UPDATE_LINES, hideUpdate, ownLinks, postUpdate, setShipTitles } from './updates';
import { UPDATE_LINK_NOTE } from './update-text';
import { tools } from './tools';

process.env[EVENT_LOG_FLAG] = 'on';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = randomBytes(3).toString('hex');

/**
 * A person whose one project is a GitHub repo key. confirmed (default): the project row is confirmed
 * and the repo is a verified source with a confirmed proof (the Bench gate); `proof: false` keeps the
 * row confirmed but without that repo proof. `key` shares a repo with another person.
 */
async function person(o: { confirmed?: boolean; proof?: boolean; handle?: string | null; key?: string } = {}): Promise<{ id: number; key: string }> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-upd-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = o.key ?? `maya${RUN}/r${id}`;
  const confirmed = o.confirmed ?? true;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key, x_user_id, x_handle) VALUES (${id}, ${`v213u-${id}`}, ${key},
    ${o.handle ? `x${id}` : null}, ${o.handle ?? null})`;
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, link, kind, confirmed, shipped)
    VALUES (${id}, ${key}, 'Recipe planner', 'https://recipes.app', 'app', ${confirmed}, true)`;
  if (confirmed && o.proof !== false)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
      VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
  return { id, key };
}
const rows = async (key: string) => sql()<{ week: string; text: string | null; hidden: boolean; edited_at: Date | null; builder_id: number }[]>`
  SELECT week::text, text, hidden, edited_at, builder_id FROM project_updates WHERE project_key = ${key} ORDER BY week`;

test('5.5 a post lands on this week\'s row with the facts EarnKit checked, and one update_posted event', dbTest, async () => {
  const { id, key } = await person({ handle: `maya_${RUN}` });
  const r = await postUpdate(id, 'Added fridge photo import.', new Date('2026-10-14T10:00:00Z'));
  assert.equal(r.show_to_builder, UPDATE_LINES.postedAt(`https://earnkit.com/maya_${RUN}`));
  assert.deepEqual((await rows(key)).map((x) => [x.week, x.text]), [['2026-10-12', 'Added fridge photo import.']]);
  assert.equal((await sql()`SELECT 1 FROM builder_events WHERE dedupe_key = ${`update_posted:${key}:2026-W42`}`).length, 1);
});

test('5.6 a second post in the same ISO week replaces the text; Sunday 23:59 and Monday 00:00 are two weeks (review focus 2, 5)', dbTest, async () => {
  const { id, key } = await person();
  await postUpdate(id, 'First.', new Date('2026-10-12T00:00:00Z'));
  const again = await postUpdate(id, 'Second.', new Date('2026-10-18T23:59:59Z'));
  assert.equal(again.show_to_builder, UPDATE_LINES.changed);
  let r = await rows(key);
  assert.equal(r.length, 1);
  assert.equal(r[0].text, 'Second.');
  assert.ok(r[0].edited_at);
  await postUpdate(id, 'Next week.', new Date('2026-10-19T00:00:00Z'));
  r = await rows(key);
  assert.deepEqual(r.map((x) => x.week), ['2026-10-12', '2026-10-19']);
  const bad = await postUpdate(id, 'see https://evil.example', new Date('2026-10-19T01:00:00Z'));
  assert.deepEqual(bad, { show_to_builder: '', agent_note: UPDATE_LINK_NOTE });
  assert.equal((await rows(key))[1].text, 'Next week.', 'a refused post changes nothing');
});

test('5.6b the first real post on a week facts row already started is "posted", not "changed"', dbTest, async () => {
  const { id, key } = await person();
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${id}, ${key}, '2026-10-12', ${sql().json({ started: { name: 'x' } } as never)})`;
  assert.equal((await postUpdate(id, 'First.', new Date('2026-10-13T00:00:00Z'))).show_to_builder, UPDATE_LINES.posted);
  const [r] = await rows(key);
  assert.equal(r.text, 'First.');
  assert.equal(r.edited_at, null);
});

test('5.7 no post for a project not confirmed as theirs (review focus 3)', dbTest, async () => {
  const { id, key } = await person({ confirmed: false });
  assert.deepEqual(await postUpdate(id, 'Shipped.', new Date()), { show_to_builder: '', agent_note: NOT_CONFIRMED_NOTE });
  assert.equal((await rows(key)).length, 0);
});

test('5.7b a confirmed row without the repo\'s own proof fails the Bench gate: nothing stored (F2)', dbTest, async () => {
  const { id, key } = await person({ proof: false });
  assert.deepEqual(await postUpdate(id, 'Shipped.', new Date()), { show_to_builder: '', agent_note: NOT_CONFIRMED_NOTE });
  assert.equal((await rows(key)).length, 0);
});

test('5.7c a week another builder holds for a shared repo is refused and left alone (F2)', dbTest, async () => {
  const first = await person();
  const second = await person({ key: first.key });
  const now = new Date('2026-10-14T10:00:00Z');
  await postUpdate(first.id, 'Mine.', now);
  assert.deepEqual(await postUpdate(second.id, 'Theirs.', now), { show_to_builder: '', agent_note: HELD_NOTE });
  const r = await rows(first.key);
  assert.deepEqual(r.map((x) => [x.builder_id, x.text]), [[first.id, 'Mine.']]);
  assert.deepEqual(await hideUpdate(second.id, '2026-10-14'), { show_to_builder: '', agent_note: HIDE_NONE_NOTE });
  assert.equal((await rows(first.key))[0].hidden, false);
});

test('5.7d own links: confirmed sites, the hosted site and the confirmed repo only; never the project link or a registry (fix round 1, review 5)', dbTest, async () => {
  const { id, key } = await person();
  // v2.13.3 review (I1): the repo link only while the repo was read public.
  assert.deepEqual(await ownLinks(id), { sites: [], repo: null });
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${id} AND kind = 'repo'`;
  // builder_projects.link is https://recipes.app, but no site source proves it.
  assert.deepEqual(await ownLinks(id), { sites: [], repo: key });
  const now = new Date('2026-10-14T10:00:00Z');
  assert.deepEqual(await postUpdate(id, 'Live at https://recipes.app/x', now), { show_to_builder: '', agent_note: UPDATE_LINK_NOTE });
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'site', 'https://recipes.app', ${key}, 'verified', 'earnkit_txt', 'agent'),
           (${id}, 'site', ${`https://proved${id}.example`}, ${key}, 'verified', 'repo_link', 'server'),
           (${id}, 'package_npm', 'recipes', ${key}, 'verified', 'repo_link', 'server')`;
  await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status)
    VALUES (${`v213u${id}`}, 'maya', ${key}, ${id}, 1, 1, 'live')`;
  const own = await ownLinks(id);
  assert.deepEqual(own.sites.sort(), [`https://proved${id}.example`, `https://v213u${id}.earnkit.com`].sort(), 'an earnkit_txt site is not confirmed');
  assert.deepEqual(await postUpdate(id, 'Live at https://recipes.app/x', now), { show_to_builder: '', agent_note: UPDATE_LINK_NOTE });
  assert.deepEqual(await postUpdate(id, 'On npm: https://www.npmjs.com/package/recipes', now), { show_to_builder: '', agent_note: UPDATE_LINK_NOTE });
  assert.equal((await postUpdate(id, `Live at https://v213u${id}.earnkit.com/`, now)).show_to_builder, UPDATE_LINES.posted);
  assert.equal((await rows(key))[0].text, `Live at https://v213u${id}.earnkit.com/`);
});

test('5.8 hide takes any day of the week; a bad date or an empty week is a note (review focus 5)', dbTest, async () => {
  const { id, key } = await person();
  await postUpdate(id, 'Shipped.', new Date('2026-10-13T10:00:00Z'));
  assert.equal((await hideUpdate(id, '2026-10-14')).show_to_builder, UPDATE_LINES.hidden);
  assert.equal((await rows(key))[0].hidden, true);
  assert.equal((await sql()`SELECT 1 FROM builder_events WHERE dedupe_key = ${`update_hidden:${key}:2026-W42`}`).length, 1);
  assert.deepEqual(await hideUpdate(id, 'last week'), { show_to_builder: '', agent_note: HIDE_DATE_NOTE });
  assert.deepEqual(await hideUpdate(id, '2026-02-30'), { show_to_builder: '', agent_note: HIDE_DATE_NOTE });
  assert.deepEqual(await hideUpdate(id, '2025-01-01'), { show_to_builder: '', agent_note: HIDE_NONE_NOTE });
});

test('5.9 v2.14 spec 3: updates { titles } turns a private repo\'s titles on and off; { on } is answered and changes nothing', dbTest, async () => {
  const { id } = await person();
  const at = async () => (await sql()<{ t: Date | null }[]>`SELECT ship_titles_at AS t FROM builder_profiles WHERE builder_id = ${id}`)[0].t;
  // T8 fix round 1: titles on needs a repo the App proves (a proof line is not enough).
  assert.deepEqual(await setShipTitles(id, { titles: true }, new Date()), { show_to_builder: '', agent_note: TITLES_NO_APP_NOTE });
  assert.equal(await at(), null);
  await sql()`UPDATE builder_sources SET proof = 'github_app', app_checked_at = now() WHERE builder_id = ${id} AND kind = 'repo'`;
  assert.deepEqual(await setShipTitles(id, { titles: true }, new Date()), { show_to_builder: UPDATE_LINES.titlesOn });
  assert.ok(await at());
  assert.deepEqual(await setShipTitles(id, { on: true }, new Date()), { show_to_builder: UPDATE_LINES.auto });
  assert.ok(await at(), 'an older agent\'s { on } changes nothing');
  assert.deepEqual(await setShipTitles(id, { titles: false }, new Date()), { show_to_builder: UPDATE_LINES.titlesOff });
  assert.equal(await at(), null);
});

test('5.10 through the tool: tell update and updates under the flag; a shared client gets the shared note', dbTest, async () => {
  const { id, key } = await person();
  const r = (await tools.tell({ update: { text: 'Shipped search.' }, updates: { on: true } }, { installationId: id } as never)) as { show_to_builder: string; schedule_weekly_update?: string };
  assert.match(r.show_to_builder, /Posted this week's update\./);
  assert.match(r.show_to_builder, /writes itself every Monday/);
  assert.equal(r.schedule_weekly_update, undefined);
  assert.equal((await rows(key)).length, 1);
  const shared = (await tools.tell({ update: { text: 'x' } }, { installationId: id, sharedClient: true } as never)) as { agent_note?: string };
  assert.ok(shared.agent_note);
});
