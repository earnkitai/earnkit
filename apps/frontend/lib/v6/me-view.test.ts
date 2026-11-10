import { after, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MeView from '../../app/me/MeView';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { getRecord, saveRecord, upsertBuilder } from './builders';
import { createLinkCode } from './link-routes';
import { type MeData, approvalPathOf, csrfToken, meData, verifyCsrf } from './me-view';
import { APPROVABLE, mergeRecord } from './record';

after(() => sql().end());
// tsx compiles the components without the automatic JSX runtime, so they need React in scope.
(globalThis as { React?: typeof React }).React = React;
process.env.EARNKIT_AUTH_SECRET = 'me-view-secret-0123456789abcdef0123456789';
const SECRET = process.env.EARNKIT_AUTH_SECRET;
const NOW = new Date('2026-11-06T12:00:00Z');
const DAYMS = 86_400_000;

test('labels have no path or dot; every pending approval is an approvable path', async () => {
  const b = await upsertBuilder({ github_id: 810_001, login: 'viewer', name: 'Viewer', avatar_url: null }, NOW);
  const patch = {
    person: { name: 'Vi', technical: true },
    company: { raised_usd: 50_000, raised_from: 'Angels', stage: 'building' },
    traction: { line_pre_launch: 'Pre-launch, 140 on the waitlist.' },
    answers: { problem: { text: 'Builders miss grants.' }, why_you: { text: 'We shipped three.' } },
    projects: [{ id: 'kit', name: 'Kit', chains_claimed: ['base'], answers: { solution: { text: 'One reply.' } } }],
    docs: { other: [{ label: 'Pitch', url: 'https://example.com/pitch.pdf' }] },
  };
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), patch, 'agent', NOW).record, NOW);
  const d = await meData(b, NOW, 'sess');
  assert.equal(d.csrf, csrfToken(b.id, NOW.toISOString().slice(0, 10), SECRET, 'sess'), 'the page mints the csrf from its session');
  assert.equal(d.login, 'viewer');
  assert.deepEqual(d.blocks.map((x) => x.key), ['person', 'projects', 'company', 'docs', 'traction', 'answers', 'policy']);
  for (const block of d.blocks) {
    assert.ok(!/[._]/.test(block.title), block.title);
    for (const f of block.fields) {
      assert.ok(f.label.length > 0 && !f.label.includes('.') && !f.label.includes('_') && f.label !== f.path, f.label);
      if (f.approvable) assert.ok(APPROVABLE(approvalPathOf(f.path)), f.path);
    }
  }
  for (const p of d.pending_approvals) {
    assert.ok(APPROVABLE(p.path), p.path);
    assert.ok(!p.label.includes('.') && !p.label.includes('_'), p.label);
    assert.ok(p.text.length > 0);
  }
  assert.deepEqual(d.pending_approvals.map((p) => p.path).sort(), ['answers.problem', 'answers.why_you', 'company.raised', 'projects.kit.answers.solution', 'traction.line_pre_launch']);
  const fields = d.blocks.flatMap((x) => x.fields);
  const name = fields.find((f) => f.path === 'person.name')!;
  assert.deepEqual([name.label, name.value, name.set_by], ['Name', 'Vi', 'agent']);
  assert.equal(fields.find((f) => f.path === 'projects.kit.chains_claimed')!.value, 'base');
  assert.equal(fields.find((f) => f.path === 'company.stage')!.kind, 'choice');
  assert.deepEqual(d.ledger, []);
  assert.deepEqual(d.installations, []);
});

test('the csrf verifies for today and yesterday and not two days ago', () => {
  const day = (ms: number) => new Date(NOW.getTime() - ms).toISOString().slice(0, 10);
  const S = 'session-token-a';
  assert.ok(verifyCsrf(csrfToken(7, day(0), SECRET, S), 7, NOW, SECRET, S));
  assert.ok(verifyCsrf(csrfToken(7, day(DAYMS), SECRET, S), 7, NOW, SECRET, S));
  assert.ok(!verifyCsrf(csrfToken(7, day(2 * DAYMS), SECRET, S), 7, NOW, SECRET, S));
  assert.ok(!verifyCsrf(csrfToken(8, day(0), SECRET, S), 7, NOW, SECRET, S));
  assert.ok(!verifyCsrf(csrfToken(7, day(0), 'another-secret-0123456789abcdef', S), 7, NOW, SECRET, S));
  assert.ok(!verifyCsrf('', 7, NOW, SECRET, S));
  // Bound to the session (security L4): another session's token, or no session, fails.
  assert.ok(!verifyCsrf(csrfToken(7, day(0), SECRET, 'session-token-b'), 7, NOW, SECRET, S));
  assert.ok(!verifyCsrf(csrfToken(7, day(0), SECRET, S), 7, NOW, SECRET, ''));
  assert.match(csrfToken(7, day(0), SECRET, S), /^[A-Za-z0-9_-]{43}$/);
});

test('/me?link=<code> with a live code shows the link banner with the agent name and both buttons; a dead code says it expired', async () => {
  const b = await upsertBuilder({ github_id: 810_002, login: 'linkee', name: null, avatar_url: null }, NOW);
  const inst = async (name: string | null) =>
    (await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'mv-' + Math.random()}, ${name}, ${NOW}) RETURNING id`)[0].id as number;
  const code = await createLinkCode(await inst('Claude <Code>'), NOW);
  const d = await meData(b, NOW, 'sess', code);
  const text = 'The agent calling itself Claude <Code>, first seen Nov 6, asked for this link. If you did not ask your agent for this just now, choose Not me.';
  assert.deepEqual(d.link, { code, text, parts: ['The agent calling itself ', 'Claude <Code>', text.slice('The agent calling itself Claude <Code>'.length)] });
  const html = renderToStaticMarkup(MeView({ data: d, problem: null }));
  assert.ok(html.includes('Link an agent to this account?'), html);
  // The agent's own name sits isolated, so its text cannot turn the sentence around (v6.1.7 C1).
  assert.ok(html.includes(text.replace('Claude <Code>', '<bdi>Claude &lt;Code&gt;</bdi>')), html);
  assert.ok(!html.includes('<Code>'));
  for (const action of ['link', 'deny']) {
    const form = html.match(new RegExp(`<form action="/me/link" method="post">(?:(?!</form>).)*value="${action}"(?:(?!</form>).)*</form>`))?.[0] ?? '';
    assert.ok(form.includes(`name="code" value="${code}"`), action);
    assert.ok(form.includes(`name="csrf" value="${d.csrf}"`), action);
  }
  assert.ok(html.includes('>Link this agent</button>'));
  assert.ok(html.includes('>Not me</button>'));
  assert.ok(html.indexOf('Link an agent to this account?') < html.indexOf('id="person"'));
  // The ledger rows show the program's title only, never its slug (lane 5, 3.27).
  const rows = renderToStaticMarkup(MeView({ data: { ...d, link: null, ledger: [{ title: 'Base Builder Grants', status: 'Applied', at: 'Nov 6' }] }, problem: null }));
  assert.ok(rows.includes('Base Builder Grants') && rows.includes('Applied, Nov 6'), rows);
  assert.ok(!/base-builder-grants/.test(rows), rows);

  const unnamed = await createLinkCode(await inst(null), NOW);
  assert.equal((await meData(b, NOW, 'sess', unnamed)).link?.text, 'Your agent, first seen Nov 6, asked for this link. If you did not ask your agent for this just now, choose Not me.');

  // A dead code says it expired; a code EarnKit never makes says it is not valid (v6.1.7 S1).
  const dead: [MeData, string][] = [
    [await meData(b, new Date(NOW.getTime() + 16 * 60_000), 'sess', code), 'This link has expired. Ask your agent for a new one.'],
    [await meData(b, NOW, 'sess', 'not-a-code'), 'This link is not valid.'],
    [await meData(b, NOW, 'sess', 'x'.repeat(1024)), 'This link is not valid.'],
    [await meData(b, NOW, 'sess', '<script>'), 'This link is not valid.'],
  ];
  for (const [d2, words] of dead) {
    assert.deepEqual(d2.link, { code: null, text: words, parts: null });
    const page = renderToStaticMarkup(MeView({ data: d2, problem: null }));
    assert.ok(page.includes(words));
    assert.ok(!page.includes('/me/link'));
    assert.ok(!page.includes('Link this agent'));
  }
  assert.equal((await meData(b, NOW, 'sess')).link, null);
  assert.ok(!renderToStaticMarkup(MeView({ data: await meData(b, NOW, 'sess'), problem: null })).includes('Link an agent to this account?'));
});

test('/me?link=<code> for an agent already linked to another account reads the OTHER text with no buttons (m5)', async () => {
  const me = await upsertBuilder({ github_id: 810_003, login: 'second', name: null, avatar_url: null }, NOW);
  const owner = await upsertBuilder({ github_id: 810_004, login: 'first', name: null, avatar_url: null }, NOW);
  const id = (await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'mv-' + Math.random()}, ${'Codex'}, ${NOW}) RETURNING id`)[0].id as number;
  const code = await createLinkCode(id, NOW);
  // Linked to another account while this code was still live.
  await sql()`UPDATE installations SET builder_id = ${owner.id}, linked_at = ${NOW} WHERE id = ${id}`;
  const other = 'This agent is already linked to another account. Install EarnKit again for a fresh link.';
  const d = await meData(me, NOW, 'sess', code);
  assert.deepEqual(d.link, { code: null, text: other, parts: null });
  const page = renderToStaticMarkup(MeView({ data: d, problem: null }));
  assert.ok(page.includes(other), page);
  assert.ok(!page.includes('/me/link'));
  assert.ok(!page.includes('Link this agent'));
  assert.ok(!page.includes('Not me'));
  // The account it is linked to still sees the buttons.
  assert.equal((await meData(owner, NOW, 'sess', code)).link?.code, code);
});

test('an agent name with bidi and zero-width marks is cleaned on read and isolated on the banner and the agents list (v6.1.7 C1)', async () => {
  const b = await upsertBuilder({ github_id: 810_005, login: 'bidi', name: null, avatar_url: null }, NOW);
  // A row saved before names were cleaned at registration.
  const raw = `Evil\u202Eagent\u200B<img src=x>${'z'.repeat(80)}`;
  const id = (await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'mv-' + Math.random()}, ${raw}, ${NOW}) RETURNING id`)[0].id as number;
  const code = await createLinkCode(id, NOW);
  const d = await meData(b, NOW, 'sess', code);
  const name = `Evilagent<img src=x>${'z'.repeat(80)}`.slice(0, 60);
  assert.equal(d.link?.parts?.[1], name);
  assert.ok(!/[\u202E\u200B]/.test(d.link?.text ?? ''));
  await sql()`UPDATE installations SET builder_id = ${b.id}, linked_at = ${NOW} WHERE id = ${id}`;
  const linked = await meData(b, NOW, 'sess');
  assert.equal(linked.installations[0].client_name, name);
  const html = renderToStaticMarkup(MeView({ data: linked, problem: null }));
  assert.ok(html.includes(`<bdi>${name.replace('<', '&lt;').replace('>', '&gt;')}</bdi>`), html);
  assert.ok(!html.includes('\u202E'));
});

test('a note is shown plainly, apart from a refusal, and several refusal lines keep their breaks (v6.1.7 C2, B1)', async () => {
  const b = await upsertBuilder({ github_id: 810_006, login: 'noted', name: null, avatar_url: null }, NOW);
  const d = await meData(b, NOW, 'sess');
  const ok = renderToStaticMarkup(MeView({ data: d, problem: null, note: 'Linked: Codex.' }));
  assert.ok(/<p role="status"[^>]*>Linked: Codex\.<\/p>/.test(ok), ok);
  assert.ok(!ok.includes('role="alert"'));
  const bad = renderToStaticMarkup(MeView({ data: d, problem: 'Most per night: a whole number from 1 to 20.\nCategories: pick one of the options.' }));
  assert.ok(/<p role="alert" class="[^"]*whitespace-pre-line[^"]*">Most per night: a whole number from 1 to 20\.\nCategories: pick one of the options\.<\/p>/.test(bad), bad);
});
