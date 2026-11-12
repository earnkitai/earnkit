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
import { upsertProgram } from '../v5/programs';
import { programFixture } from '../v5/fixtures/program';

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
  assert.deepEqual(d.blocks.map((x) => x.key), ['person', 'team', 'projects', 'company', 'docs', 'traction', 'answers', 'policy']);
  for (const block of d.blocks) {
    assert.ok(!/[._]/.test(block.title), block.title);
    for (const f of block.fields) {
      // A label may end as a sentence (L21-18's `Press submit for me when I say yes.`); no dot inside it, so no path.
      assert.ok(f.label.length > 0 && !f.label.replace(/\.$/, '').includes('.') && !f.label.includes('_') && f.label !== f.path, f.label);
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
  // Task 11 fix round 1 (N3): the name quoted as the /link page quotes it.
  const text = 'The agent calling itself "Claude <Code>", first seen Nov 6, asked for this link. If you did not ask your agent for this just now, choose This is not me.';
  assert.deepEqual(d.link, { title: 'Link an agent to this account?', code, text, parts: ['The agent calling itself ', '"Claude <Code>"', text.slice('The agent calling itself "Claude <Code>"'.length)] });
  const html = renderToStaticMarkup(MeView({ data: d, problem: null }));
  assert.ok(html.includes('Link an agent to this account?'), html);
  // The agent's own name sits isolated, so its text cannot turn the sentence around (v6.1.7 C1).
  assert.ok(html.includes(text.replace('"Claude <Code>"', '<bdi>&quot;Claude &lt;Code&gt;&quot;</bdi>')), html);
  assert.ok(!html.includes('<Code>'));
  for (const action of ['link', 'deny']) {
    const form = html.match(new RegExp(`<form action="/me/link" method="post">(?:(?!</form>).)*value="${action}"(?:(?!</form>).)*</form>`))?.[0] ?? '';
    assert.ok(form.includes(`name="code" value="${code}"`), action);
    assert.ok(form.includes(`name="csrf" value="${d.csrf}"`), action);
  }
  assert.ok(html.includes('>Link this agent</button>'));
  assert.ok(html.includes('>This is not me.</button>'));
  assert.ok(html.indexOf('Link an agent to this account?') < html.indexOf('id="person"'));
  // The ledger rows show the program's title only, never its slug (lane 5, 3.27).
  const rows = renderToStaticMarkup(MeView({ data: { ...d, link: null, ledger: [{ title: 'Base Builder Grants', status: 'Applied', at: 'Nov 6', money: null, words: 'Applied, Nov 6.' }] }, problem: null }));
  assert.ok(rows.includes('Base Builder Grants') && rows.includes('Applied, Nov 6.'), rows);
  assert.ok(!/base-builder-grants/.test(rows), rows);

  const unnamed = await createLinkCode(await inst(null), NOW);
  assert.equal((await meData(b, NOW, 'sess', unnamed)).link?.text, 'Your agent, first seen Nov 6, asked for this link. If you did not ask your agent for this just now, choose This is not me.');

  // L21-6, L21-17 (v6.1.16): a dead code's title says what it is: expired, or not one of ours (malformed, or a
  // code-shaped one EarnKit never made).
  const dead: [MeData, string, string][] = [
    [await meData(b, new Date(NOW.getTime() + 16 * 60_000), 'sess', code), 'This link has expired.', 'Ask your agent for a new one.'],
    [await meData(b, NOW, 'sess', 'not-a-code'), 'This link is not one of ours.', ''],
    [await meData(b, NOW, 'sess', 'x'.repeat(1024)), 'This link is not one of ours.', ''],
    [await meData(b, NOW, 'sess', '<script>'), 'This link is not one of ours.', ''],
    [await meData(b, NOW, 'sess', 'Q'.repeat(22)), 'This link is not one of ours.', ''],
  ];
  for (const [d2, title, words] of dead) {
    assert.deepEqual(d2.link, { title, code: null, text: words, parts: null });
    const page = renderToStaticMarkup(MeView({ data: d2, problem: null }));
    assert.ok(page.includes(`>${title}</h2>`) && page.includes(words), page);
    assert.ok(!page.includes('/me/link'));
    assert.ok(!page.includes('Link this agent'));
  }
  assert.equal((await meData(b, NOW, 'sess')).link, null);
  // N4: reopening /me?link= after this builder used the code says the agent is linked, never that it expired.
  const usedCode = await createLinkCode(await inst('Claude Code'), NOW);
  const { consumeLinkCode } = await import('./link-routes');
  assert.equal(await consumeLinkCode(usedCode, b.id, NOW), 'linked');
  assert.deepEqual((await meData(b, NOW, 'sess', usedCode)).link, { title: 'Linked.', code: null, text: 'This agent is linked.', parts: null });
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
  assert.deepEqual(d.link, { title: 'Not linked.', code: null, text: other, parts: null });
  const page = renderToStaticMarkup(MeView({ data: d, problem: null }));
  assert.ok(page.includes(other), page);
  assert.ok(!page.includes('/me/link'));
  assert.ok(!page.includes('Link this agent'));
  assert.ok(!page.includes('This is not me.'));
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
  assert.equal(d.link?.parts?.[1], `"${name.slice(0, 40)}"`);
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
  const bad = renderToStaticMarkup(MeView({ data: d, problem: 'Most a day: a whole number from 1 to 20.\nCategories: pick one of the options.' }));
  assert.ok(/<p role="alert" class="[^"]*whitespace-pre-line[^"]*">Most a day: a whole number from 1 to 20\.\nCategories: pick one of the options\.<\/p>/.test(bad), bad);
});

test('B16 and B19: each answer shows its short form, pending and approved; the team list shows under About you', async () => {
  const b = await upsertBuilder({ github_id: 810_050, login: 'shorty', name: 'S', avatar_url: null }, NOW);
  const patch = {
    answers: { problem: { text: 'Teams lose time on payouts.', short: 'Payouts; we serve 5,000 paying customers.' } },
    team: [{ name: 'Cut Person', role: 'CEO' }, { name: 'Hidden Partner', role: 'CFO' }],
  };
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), patch, 'agent', NOW).record, NOW);
  const d = await meData(b, NOW, 'sess');
  const pending = d.pending_approvals.find((p) => p.path === 'answers.problem')!;
  assert.equal(pending.short, 'Payouts; we serve 5,000 paying customers.');
  const fields = d.blocks.flatMap((x) => x.fields);
  assert.equal(fields.find((f) => f.path === 'answers.problem')!.short, 'Payouts; we serve 5,000 paying customers.');
  const team = d.blocks.find((x) => x.key === 'team')!;
  assert.deepEqual(team.fields.map((f) => [f.path, f.label, f.value, f.set_by]), [
    ['team.0.name', 'Member 1', 'Cut Person', 'agent'], ['team.0.role', 'Member 1 role', 'CEO', 'agent'],
    ['team.1.name', 'Member 2', 'Hidden Partner', 'agent'], ['team.1.role', 'Member 2 role', 'CFO', 'agent'],
    ['team.2.name', 'Add a member', '', null],
  ]);
  // L35-24 (v6.1.17 Task 4): opened (`?open=`), the answer shows its short form pending and under the answer; closed, neither.
  const html = renderToStaticMarkup(React.createElement(MeView, { data: d, problem: null, open: 'answers.problem' }));
  assert.equal(html.split('Short form, for fields under 300 characters.').length, 3, 'once pending, once under the answer');
  const closed = renderToStaticMarkup(React.createElement(MeView, { data: d, problem: null }));
  assert.equal(closed.split('Short form, for fields under 300 characters.').length, 1, 'collapsed: first line only');
  assert.ok(html.includes('5,000 paying customers'));
  assert.ok(html.includes('Hidden Partner'));
  assert.ok(html.indexOf('Your team') > html.indexOf('About you') && html.indexOf('Your team') < html.indexOf('Your projects'));
});

test('v6.1.9 N6 and N10: an old empty category list with standing approval on shows every box ticked; the add row has no remove hint', async () => {
  const b = await upsertBuilder({ github_id: 810_061, login: 'oldpolicy', name: 'O', avatar_url: null }, NOW);
  const rec = mergeRecord(await getRecord(b.id), { team: [{ name: 'Cut Person' }] }, 'agent', NOW).record;
  await saveRecord(b.id, { ...rec, policy: { ...rec.policy, auto_apply: true, categories: [] } }, NOW);
  const d = await meData(b, NOW, 'sess');
  const cats = d.blocks.find((x) => x.key === 'policy')!.fields.find((f) => f.path === 'policy.categories')!;
  assert.equal(cats.value.split(', ').length, cats.options!.length, 'all ticked');
  // Standing approval off: the empty list stays as stored, nothing ticked (Task 3 review Minor).
  await saveRecord(b.id, { ...rec, policy: { ...rec.policy, auto_apply: false, categories: [] } }, NOW);
  const off = (await meData(b, NOW, 'sess')).blocks.find((x) => x.key === 'policy')!.fields.find((f) => f.path === 'policy.categories')!;
  assert.equal(off.value, '', 'none ticked');
  const html = renderToStaticMarkup(React.createElement(MeView, { data: d, problem: null }));
  assert.equal(html.split('Clear the name to remove them.').length, 2, 'one member, one hint; the add row has none');
});

test('v6.1.9: the ledger row shows the catalog title now, else the stored title, else the id', async () => {
  const b = await upsertBuilder({ github_id: 810_062, login: 'ledgertitle', name: 'L', avatar_url: null }, NOW);
  await upsertProgram(programFixture({ id: 'lt-live', title: 'Renamed Grant' }), 'file', NOW);
  const owner = `b:${b.id}`;
  await sql()`INSERT INTO applications (installation_id, owner, program_id, status, at, title) VALUES (0, ${owner}, 'lt-live', 'applied', ${NOW}, 'Old Name'), (0, ${owner}, 'lt-gone', 'applied', ${new Date(NOW.getTime() - 1000)}, 'Stored Name'), (0, ${owner}, 'lt-bare', 'applied', ${new Date(NOW.getTime() - 2000)}, NULL)`;
  const d = await meData(b, NOW, 'sess');
  assert.deepEqual(d.ledger.map((r) => r.title), ['Renamed Grant', 'Stored Name', 'lt-bare']);
});

test('L21-1, Review Focus 9 (v6.1.16): /me rows and totals equal the find reply, with a further payment and a correction', async () => {
  const { record: track, summary, ledgerCounts } = await import('../v5/ledger');
  const { linkInstallation } = await import('./builders');
  const b = await upsertBuilder({ github_id: 810_070, login: 'rf9', name: null, avatar_url: null }, NOW);
  const inst = (await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'mv-' + Math.random()}, ${'Codex'}, ${NOW}) RETURNING id`)[0].id as number;
  await linkInstallation(inst, b.id, NOW);
  const owner = `b:${b.id}`;
  const ids = ['rf9-a', 'rf9-b', 'rf9-c', 'rf9-d', 'rf9-e', 'rf9-f'];
  for (const id of ids) await upsertProgram(programFixture({ id, title: `Grant ${id.slice(-1).toUpperCase()}`, max_award_usd: 10_000 }), 'file', NOW);
  const at = new Date('2026-11-11T12:00:00Z');
  const o = { installationId: inst, now: at };
  for (const id of ids) assert.equal((await track(owner, id, 'applied', o)).ok, true, id);
  assert.equal((await track(owner, 'rf9-a', 'won', { ...o, amount_usd: 5_000 })).ok, true);
  assert.equal((await track(owner, 'rf9-b', 'won', { ...o, amount_usd: 2_000 })).ok, true);
  assert.equal((await track(owner, 'rf9-b', 'won', { ...o, amount_usd: 1_500, payment: { key: 'rf9-pay' } })).ok, true);
  assert.equal((await track(owner, 'rf9-c', 'won', { ...o, amount_usd: 3_000 })).ok, true);
  assert.equal((await track(owner, 'rf9-c', 'won', { ...o, amount_usd: 3_500 })).ok, true, 'a correction');
  assert.equal((await track(owner, 'rf9-d', 'rejected', o)).ok, true);
  const d = await meData(b, at, 'sess');
  // The find reply's block is `Your applications: ${ledgerCounts(summary)}`; /me's card title is the prefix.
  assert.equal(d.ledger_line, '6 sent, 3 won ($12,000), 1 rejected, 2 waiting.');
  assert.equal(d.ledger_line, ledgerCounts(await summary(owner, [], at)));
  const words = Object.fromEntries(d.ledger.map((r) => [r.title, r.words]));
  assert.deepEqual(words, {
    'Grant A': 'Won $5,000, Nov 11.', 'Grant B': 'Won $3,500 in all, Nov 11.', 'Grant C': 'Won $3,500, Nov 11.',
    'Grant D': 'Rejected, Nov 11.', 'Grant E': 'Applied, Nov 11.', 'Grant F': 'Applied, Nov 11.',
  });
  assert.equal(d.ledger.find((r) => r.title === 'Grant B')!.money, '$3,500');
  const html = renderToStaticMarkup(MeView({ data: d, problem: null }));
  assert.ok(html.includes('6 sent, 3 won ($12,000), 1 rejected, 2 waiting.') && html.includes('Won $3,500 in all, Nov 11.'), html);
  // L21-19: every row ends in a full stop.
  for (const r of d.ledger) assert.match(r.words, /\.$/);
});

test('ledgerRowWords (L21-1, L21-19, v6.1.16): one sentence per row, full figures', async () => {
  const { ledgerRowWords } = await import('./me-view');
  assert.equal(ledgerRowWords('won', '5000', false, 'Nov 11'), 'Won $5,000, Nov 11.');
  assert.equal(ledgerRowWords('won', 3500, true, 'Nov 11'), 'Won $3,500 in all, Nov 11.');
  assert.equal(ledgerRowWords('won', null, false, 'Nov 11'), 'Won, amount not given, Nov 11.');
  assert.equal(ledgerRowWords('applied', null, false, 'Nov 11'), 'Applied, Nov 11.');
  assert.equal(ledgerRowWords('rejected', null, false, 'Nov 11'), 'Rejected, Nov 11.');
  assert.equal(ledgerRowWords('no_result', null, false, 'Nov 11'), 'No result, Nov 11.');
});

test('L21-10, L21-12, L21-13, L21-22 (v6.1.16): unnamed agents by day, projects seen, review lines, no install pill', async () => {
  const { linkInstallation } = await import('./builders');
  const { addReviewer } = await import('./reviewers');
  const b = await upsertBuilder({ github_id: 810_071, login: 'agentsday', name: null, avatar_url: null }, NOW);
  const mk = async (name: string | null) => (await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'mv-' + Math.random()}, ${name}, ${NOW}) RETURNING id`)[0].id as number;
  const first = await mk(null);
  const second = await mk(null);
  await linkInstallation(first, b.id, NOW);
  await linkInstallation(second, b.id, new Date(NOW.getTime() + 60_000));
  await upsertProgram(programFixture({ id: 'ad-rev', title: 'Review Grants' }), 'file', NOW);
  assert.equal((await addReviewer('ad-rev', 'agentsday', null)).ok, true);
  const owner = `b:${b.id}`;
  await sql()`INSERT INTO applications (installation_id, owner, program_id, status, at, project_id) VALUES
    (${first}, ${owner}, 'ad-1', 'applied', ${NOW}, 'https://github.com/ada/kit'), (${first}, ${owner}, 'ad-2', 'started', ${NOW}, 'https://github.com/ada/kit'),
    (${first}, ${owner}, 'ad-4', 'won', ${NOW}, 'https://github.com/ada/kit'), (${first}, ${owner}, 'ad-5', 'started', ${NOW}, 'name:claim only'),
    (${first}, ${owner}, 'ad-3', 'applied', ${NOW}, 'name:side project')`;
  const d = await meData(b, NOW, 'sess');
  assert.deepEqual(d.installations.map((a) => a.label).sort(), ['An agent linked Nov 6', 'An agent linked Nov 6 (2)']);
  assert.equal(d.installations.find((a) => a.id === second)!.label, 'An agent linked Nov 6 (2)', 'the later one carries the (2)');
  // N1 ruling (fix round 1): sent applications only; a claim neither counts nor lists a project.
  assert.deepEqual(d.projects_seen.map((p) => p.line), ['https://github.com/ada/kit: 2 applications.', 'side project: 1 application.']);
  assert.deepEqual(d.reviews, ['You review Review Grants. Results come through your agent.']);
  const html = renderToStaticMarkup(MeView({ data: d, problem: null }));
  for (const t of ['An agent linked Nov 6 (2)', 'side project', ': 2 applications.', 'You review Review Grants. Results come through your agent.']) assert.ok(html.includes(t), t);
  assert.ok(!html.includes('No projects yet.'), 'the empty line only when nothing is seen');
  assert.ok(!new RegExp(`>${first}<|>${second}<`).test(html), 'no installation id is visible');
  assert.ok(html.includes('data-me-linked'), 'the page marks a linked agent for the header');
  // Saved. sits beside the control that saved, not in a banner.
  // L27-10 (v6.1.16): `saved` names the section (/me?saved=person#person).
  const saved = renderToStaticMarkup(MeView({ data: d, problem: null, saved: 'person' }));
  assert.equal(saved.split('>Saved.</span>').length, 2, saved);
  assert.ok(!saved.includes('px-5 py-4 text-[15px] text-s-good-text">Saved.'), 'no banner');
  const fresh = await upsertBuilder({ github_id: 810_072, login: 'noagents', name: null, avatar_url: null }, NOW);
  const none = renderToStaticMarkup(MeView({ data: await meData(fresh, NOW, 'sess'), problem: null }));
  assert.ok(none.includes('No projects yet.') && !none.includes('data-me-linked'));
});

test('L25-1 (v6.1.16): /me and the link banner show "Claude Code (earnkit)" as "Claude Code"; the stored name is unchanged', async () => {
  const b = await upsertBuilder({ github_id: 810_251, login: 'paren', name: null, avatar_url: null }, NOW);
  const id = (await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'mv-' + Math.random()}, ${'Claude Code (earnkit)'}, ${NOW}) RETURNING id`)[0].id as number;
  const code = await createLinkCode(id, NOW);
  assert.equal((await meData(b, NOW, 'sess', code)).link?.parts?.[1], '"Claude Code"');
  await sql()`UPDATE installations SET builder_id = ${b.id}, linked_at = ${NOW} WHERE id = ${id}`;
  const linked = await meData(b, NOW, 'sess');
  assert.equal(linked.installations[0].label, 'Claude Code');
  assert.ok(renderToStaticMarkup(MeView({ data: linked, problem: null })).includes('<bdi>Claude Code</bdi>'));
  assert.equal((await sql()`SELECT client_name FROM installations WHERE id = ${id}`)[0].client_name, 'Claude Code (earnkit)');
});

test('ledgerRowWords (L22-7, v6.1.16): cents and currencies in the one format', async () => {
  const { ledgerRowWords } = await import('./me-view');
  assert.equal(ledgerRowWords('won', { USD: 2500.5 }, false, 'Nov 11'), 'Won $2,500.50, Nov 11.');
  assert.equal(ledgerRowWords('won', { EUR: 2000 }, false, 'Nov 11'), 'Won EUR 2,000, Nov 11.');
  assert.equal(ledgerRowWords('won', { USD: 1000, EUR: 500 }, true, 'Nov 11'), 'Won $1,000 and EUR 500 in all, Nov 11.');
});

test('L23-7, L23-11 (v6.1.16): a claim past 24 hours with no send reads Started, not sent; another year carries its year', async () => {
  const b = await upsertBuilder({ github_id: 923_007, login: 'l23me', name: null, avatar_url: null }, NOW);
  const owner = `b:${b.id}`;
  for (const id of ['mv-stale', 'mv-live', 'mv-old']) await upsertProgram(programFixture({ id, title: `${id} Grant` }), 'file', NOW);
  const row = (id: string, status: string, at: Date) => sql()`INSERT INTO applications (owner, installation_id, program_id, status, at, claimed_at, claimed_by)
    VALUES (${owner}, 1, ${id}, ${status}, ${at}, ${status === 'started' ? at : null}, ${status === 'started' ? 1 : null})`;
  await row('mv-stale', 'started', new Date(NOW.getTime() - 30 * 3_600_000));
  await row('mv-live', 'started', new Date(NOW.getTime() - 3_600_000));
  await row('mv-old', 'applied', new Date('2025-11-06T12:00:00Z'));
  const words = new Map((await meData(b, NOW, 'sess')).ledger.map((r) => [r.title, r.words]));
  assert.equal(words.get('mv-stale Grant'), 'Started, not sent, Nov 5.');
  assert.equal(words.get('mv-live Grant'), 'Started, Nov 6.');
  assert.equal(words.get('mv-old Grant'), 'Applied, Nov 6, 2025.');
  await sql()`DELETE FROM applications WHERE owner = ${owner}`;
});

test('L24-14 (v6.1.16 Task 11): /me says in words whether standing approval is on, and what was sent under it', async () => {
  const b = await upsertBuilder({ github_id: 931_411, login: 'l24-me', name: null, avatar_url: null }, NOW);
  const off = await meData(b, NOW, 'sess');
  assert.deepEqual(off.policy_status, ['Off.', 'Sent under it: 0.']);
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { policy: { auto_apply: true, max_per_night: 1, categories: ['grant'], max_ask_usd: 4500 } }, 'builder', NOW).record, NOW);
  await upsertProgram(programFixture({ id: 'l24-me-p', title: 'L24 Me Grant' }), 'file', NOW);
  await sql()`INSERT INTO applications (owner, installation_id, program_id, status, at, auto_applied) VALUES (${'b:' + b.id}, 0, 'l24-me-p', 'applied', ${NOW}, true)`;
  const on = await meData(b, NOW, 'sess');
  assert.deepEqual(on.policy_status, ['On: up to 1 a day, grants, up to $4,500.', 'Sent under it: 1.']);
  const html = renderToStaticMarkup(MeView({ data: on, problem: null }));
  assert.ok(html.includes('On: up to 1 a day, grants, up to $4,500. Sent under it: 1.'), html);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, " "), /\b(a|per) night|overnight/i);
});
