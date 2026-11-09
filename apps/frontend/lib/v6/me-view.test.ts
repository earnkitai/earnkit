import { after, test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MeView from '../../app/me/MeView';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { getRecord, saveRecord, upsertBuilder } from './builders';
import { createLinkCode } from './link-routes';
import { approvalPathOf, csrfToken, meData, verifyCsrf } from './me-view';
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
  const text = 'The agent calling itself Claude <Code>, first seen Nov 6, asked for this link. Only link an agent running on your own computer. If someone sent you this link, choose Not me.';
  assert.deepEqual(d.link, { code, text });
  const html = renderToStaticMarkup(MeView({ data: d, problem: null }));
  assert.ok(html.includes('Link an agent to this account?'), html);
  assert.ok(html.includes(text.replace('<Code>', '&lt;Code&gt;')));
  assert.ok(!html.includes('<Code>'));
  for (const action of ['link', 'deny']) {
    const form = html.match(new RegExp(`<form action="/me/link" method="post">(?:(?!</form>).)*value="${action}"(?:(?!</form>).)*</form>`))?.[0] ?? '';
    assert.ok(form.includes(`name="code" value="${code}"`), action);
    assert.ok(form.includes(`name="csrf" value="${d.csrf}"`), action);
  }
  assert.ok(html.includes('>Link this agent</button>'));
  assert.ok(html.includes('>Not me</button>'));
  assert.ok(html.indexOf('Link an agent to this account?') < html.indexOf('id="person"'));

  const unnamed = await createLinkCode(await inst(null), NOW);
  assert.equal((await meData(b, NOW, 'sess', unnamed)).link?.text, 'Your agent, first seen Nov 6, asked for this link. Only link an agent running on your own computer. If someone sent you this link, choose Not me.');

  for (const dead of [await meData(b, new Date(NOW.getTime() + 16 * 60_000), 'sess', code), await meData(b, NOW, 'sess', 'not-a-code')]) {
    assert.deepEqual(dead.link, { code: null, text: 'This link has expired. Ask your agent for a new one.' });
    const page = renderToStaticMarkup(MeView({ data: dead, problem: null }));
    assert.ok(page.includes('This link has expired. Ask your agent for a new one.'));
    assert.ok(!page.includes('/me/link'));
    assert.ok(!page.includes('Link this agent'));
  }
  assert.equal((await meData(b, NOW, 'sess')).link, null);
  assert.ok(!renderToStaticMarkup(MeView({ data: await meData(b, NOW, 'sess'), problem: null })).includes('Link an agent to this account?'));
});
