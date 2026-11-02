import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProgramFile } from './program-file';
import {
  AGENT_FILL_STEPS,
  continuesLine,
  possessive,
  GOOGLE_EMAIL_SIGN_IN,
  CONFIRMATION_ASK,
  ENTRY_LINK_ASK,
  ENTRY_LINK_HOSTS,
  HOST_MODES,
  MAX_PREFILL_URL,
  airtablePrefill,
  googlePrefill,
  hostOf,
  kitAgentNote,
  submitKit,
  submitModeFor,
  tallyPrefill,
  type KitProgram,
  type ProgramForm,
} from './submit-kit';
import type { SubmissionRequirement } from './program-file';
import { todoOf } from './entry-text';

const reqs: SubmissionRequirement[] = [
  { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'builder' },
  { key: 'repo_url', label: 'GitHub repo', type: 'url', required: true, from: 'builder' },
  { key: 'notes', label: 'Anything else?', type: 'text', required: false, from: 'builder' },
  { key: 'description', label: 'What does it do?', type: 'text', required: true, from: 'builder' },
] as SubmissionRequirement[];
const program = (submission_url: string, extra: Partial<KitProgram> = {}): KitProgram => ({
  title: 'Arc Microgrants',
  submission_url,
  submission_requirements: reqs,
  ...extra,
});
const answers = { description: 'Tips for creators', project_name: 'Tip Jar', repo_url: 'https://github.com/alice/tipjar' };

test('Part E, Task 8: copy_paste lists every answer in the form order, with the form labels', () => {
  const kit = submitKit(program('https://dorahacks.io/hackathon/arc/buidl'), answers, { browser: true });
  assert.equal(kit.mode, 'copy_paste');
  assert.equal(kit.url, 'https://dorahacks.io/hackathon/arc/buidl');
  assert.deepEqual(kit.fields, [
    { key: 'project_name', label: 'Project name', answer: 'Tip Jar' },
    { key: 'repo_url', label: 'GitHub repo', answer: 'https://github.com/alice/tipjar' },
    { key: 'description', label: 'What does it do?', answer: 'Tips for creators' },
  ]);
  assert.deepEqual(kit.paste, kit.fields);
  assert.ok(!('prefilled_url' in kit) && !('agent_steps' in kit) && !('api' in kit));
});

test('Ruling 28 (plan): proof is the entry link on DoraHacks, the confirmation on a plain form', () => {
  assert.deepEqual(submitKit(program('https://dorahacks.io/x'), answers, { browser: false }).proof, { kind: 'entry_link', ask: ENTRY_LINK_ASK });
  assert.deepEqual(submitKit(program('https://forms.gle/abc'), answers, { browser: false }).proof, { kind: 'confirmation', ask: CONFIRMATION_ASK });
  // submit_host overrides the link's host.
  assert.equal(submitKit(program('https://forms.gle/abc', { submit_host: 'devfolio.co' }), answers, { browser: false }).proof.kind, 'entry_link');
});

test('Part E: the builder text starts with the program and ends with the proof ask; no tool or field names', () => {
  const t = submitKit(program('https://dorahacks.io/x'), answers, { browser: false }).show_to_builder;
  assert.ok(t.startsWith('Ready for Arc Microgrants. Paste each answer into the form:'), t);
  assert.ok(t.endsWith(ENTRY_LINK_ASK), t);
  assert.ok(t.includes('Form: https://dorahacks.io/x'));
  assert.ok(t.includes('Project name\nTip Jar\n\nGitHub repo\nhttps://github.com/alice/tipjar\n\nWhat does it do?\nTips for creators'), t);
  assert.doesNotMatch(t, /project_name|repo_url|record_submission|confirm_entry|\p{Extended_Pictographic}|—/u);
  assert.ok(submitKit(program('https://forms.gle/abc'), answers, { browser: false }).show_to_builder.endsWith(CONFIRMATION_ASK));
});

test('Ruling C9: a required answer missing is never dropped: listed first and a marked blank; optional ones are left out', () => {
  const kit = submitKit(program('https://dorahacks.io/x'), { project_name: 'Tip Jar' }, { browser: false }, { problems: [] });
  assert.deepEqual(kit.missing, ['a GitHub repo', 'what does it do']);
  assert.deepEqual(
    kit.fields.map((f) => [f.key, f.answer, f.missing ?? false]),
    [['project_name', 'Tip Jar', false], ['repo_url', '', true], ['description', '', true]],
  );
  const t = kit.show_to_builder;
  assert.ok(t.startsWith('Before you submit: a GitHub repo, what does it do.\n\nFor Arc Microgrants, paste each answer into the form:'), t);
  assert.ok(t.includes('GitHub repo\n(still needed)') && t.includes('What does it do?\n(still needed)'));
  assert.doesNotMatch(t, /Anything else/);
  // A given but invalid answer is a blank, flagged to check.
  const bad = submitKit(program('https://dorahacks.io/x'), answers, { browser: false }, { problems: ['repo_url'] });
  assert.deepEqual(bad.missing, ['a GitHub repo (check it)']);
  assert.doesNotMatch(bad.show_to_builder, /github\.com\/alice/);
  // An optional answer given but not valid is a blank to check too, never dropped silently.
  const opt = submitKit(program('https://dorahacks.io/x'), answers, { browser: false }, { problems: ['notes'] });
  assert.deepEqual(opt.missing, [todoOf({ label: 'Anything else?' }, true)]);
  assert.ok(opt.show_to_builder.includes('Anything else?\n(still needed)'), opt.show_to_builder);
});

// ---- v2.8 Task 10: modes by host, prefilled links, proof.

const kp = (submission_url: string, extra: Partial<KitProgram> = {}): KitProgram => program(submission_url, extra);
const gform: ProgramForm = { url: 'https://docs.google.com/forms/d/e/1FAIpQ/viewform', fields: { project_name: 'entry.1' }, sign_in: false, read_at: '2026-10-07' };

test('10.1 Ruling 27: hostOf strips www. and submit_host wins over the URL', () => {
  assert.equal(hostOf({ submission_url: 'https://www.dorahacks.io/hackathon/x' }), 'dorahacks.io');
  assert.equal(hostOf({ submission_url: 'https://forms.gle/abc', submit_host: 'devfolio.co' }), 'devfolio.co');
  assert.equal(hostOf({ submission_url: 'https://x.example', submit_host: 'WWW.Taikai.Network' }), 'taikai.network');
  assert.equal(hostOf({ submission_url: 'not a url' }), '');
});

test('10.1 Ruling 27: submitModeFor by host, with the overrides', () => {
  const on = { browser: true };
  const off = { browser: false };
  // Their terms ban automated use: paste, even with a browser (and even with a form or the API flag).
  assert.equal(submitModeFor(kp('https://dorahacks.io/hackathon/arc'), on), 'copy_paste');
  assert.equal(submitModeFor(kp('https://circle.questbook.app/'), on), 'copy_paste');
  assert.equal(submitModeFor(kp('https://x.example', { submit_host: 'dorahacks.io', submit_api: true }), on), 'copy_paste');
  assert.equal(submitModeFor(kp('https://ethglobal.com/events/x'), on), 'agent_fills');
  assert.equal(submitModeFor(kp('https://ethglobal.com/events/x'), off), 'copy_paste');
  for (const h of ['devfolio.co', 'colosseum.com', 'arena.colosseum.org', 'hackathon.monad.xyz', 'app.akindo.io', 'taikai.network'])
    assert.equal(submitModeFor(kp(`https://${h}/x`), on), 'agent_fills', h);
  assert.equal(submitModeFor(kp('https://docs.google.com/forms/d/e/1FAIpQ/viewform', { form: gform }), off), 'prefilled_link');
  assert.equal(submitModeFor(kp('https://forms.gle/abc', { form: gform }), off), 'prefilled_link');
  assert.equal(submitModeFor(kp('https://forms.gle/abc', { form: { ...gform, sign_in: true } }), on), 'agent_fills');
  assert.equal(submitModeFor(kp('https://forms.gle/abc', { form: { ...gform, sign_in: true } }), off), 'copy_paste');
  assert.equal(submitModeFor(kp('https://forms.gle/abc'), on), 'copy_paste', 'no form data');
  assert.equal(submitModeFor(kp('https://superteam.fun/earn/listing/x', { submit_api: true }), off), 'api');
  assert.equal(submitModeFor(kp('https://earn.superteam.fun/listing/x', { submit_api: true }), off), 'api');
  assert.equal(submitModeFor(kp('https://gap.karmahq.xyz/x', { submit_api: true }), off), 'api');
  assert.equal(submitModeFor(kp('https://superteam.fun/earn/listing/x'), on), 'agent_fills');
  assert.equal(submitModeFor(kp('https://superteam.fun/earn/listing/x'), off), 'copy_paste');
  assert.equal(submitModeFor(kp('https://unknown.example/apply'), on), 'copy_paste');
  assert.equal(HOST_MODES['dorahacks.io'], 'copy_paste');
  assert.deepEqual([...ENTRY_LINK_HOSTS].sort(), ['app.akindo.io', 'arena.colosseum.org', 'colosseum.com', 'devfolio.co', 'dorahacks.io', 'ethglobal.com', 'gap.karmahq.xyz', 'taikai.network']);
});

const freqs: SubmissionRequirement[] = [
  { key: 'name', label: 'Project name', type: 'text', required: true, from: 'project' },
  { key: 'why', label: 'Why this', type: 'text', required: true, from: 'project' },
  { key: 'track', label: 'Track', type: 'choice', options: ['Trading', 'Payments / Stable coins'], required: true, from: 'project' },
  { key: 'deck', label: 'Deck', type: 'file', required: false, from: 'builder' },
] as SubmissionRequirement[];

test('10.2 Google: entry ids in the URL, encoded; nothing left', () => {
  const form = { url: 'https://docs.google.com/forms/d/e/1FAIpQ/viewform', fields: { name: 'entry.111', why: 'entry.222', track: 'entry.333' }, sign_in: false, read_at: '2026-10-07' };
  const { url, left } = googlePrefill(form, freqs, { name: 'Tip Jar', why: 'Fast & cheap', track: 'Payments / Stable coins' });
  assert.equal(url, 'https://docs.google.com/forms/d/e/1FAIpQ/viewform?usp=pp_url&entry.111=Tip%20Jar&entry.222=Fast%20%26%20cheap&entry.333=Payments%20%2F%20Stable%20coins');
  assert.deepEqual(left, []);
});

test('10.3/10.4: no entry id, a choice not in the options, a stale form and a file all go to left, in requirement order', () => {
  const form = { url: 'https://docs.google.com/forms/d/e/1FAIpQ/viewform', fields: { why: 'entry.222', track: 'entry.333', deck: 'entry.444' }, sign_in: false, read_at: '2026-10-07' };
  const r = googlePrefill(form, freqs, { track: 'payments', why: 'Fast', name: 'Tip Jar', deck: 'deck.pdf' });
  assert.equal(r.url, 'https://docs.google.com/forms/d/e/1FAIpQ/viewform?usp=pp_url&entry.222=Fast');
  assert.deepEqual(r.left, ['name', 'track', 'deck']);
  // A stale form: the answer's key is no longer in fields.
  const stale = googlePrefill({ ...form, fields: { why: 'entry.222' } }, freqs, { why: 'Fast', track: 'Trading' });
  assert.deepEqual(stale.left, ['track']);
  assert.doesNotMatch(stale.url, /Trading/);
});

test('10.5/10.6 Airtable and Tally', () => {
  const at = airtablePrefill({ url: 'https://airtable.com/appX/shrY', fields: { name: 'Project Name' }, sign_in: false, read_at: '2026-10-07' }, freqs, { name: 'Tip Jar' });
  assert.equal(at.url, 'https://airtable.com/appX/shrY?prefill_Project%20Name=Tip%20Jar');
  const ty = tallyPrefill({ url: 'https://tally.so/r/abc', fields: { name: 'project' }, sign_in: false, read_at: '2026-10-07' }, freqs, { name: 'Tip Jar' });
  assert.equal(ty.url, 'https://tally.so/r/abc?project=Tip%20Jar');
  assert.deepEqual([at.left, ty.left], [[], []]);
});

test('10.7: the URL never passes MAX_PREFILL_URL; what does not fit is left to paste', () => {
  const form = { url: 'https://docs.google.com/forms/d/e/1FAIpQ/viewform', fields: { name: 'entry.1', why: 'entry.2', track: 'entry.3' }, sign_in: false, read_at: '2026-10-07' };
  const r = googlePrefill(form, freqs, { name: 'Tip Jar', why: 'x'.repeat(MAX_PREFILL_URL), track: 'Trading' });
  assert.ok(r.url.length <= MAX_PREFILL_URL);
  assert.deepEqual(r.left, ['why']);
  assert.match(r.url, /entry\.1=Tip%20Jar&entry\.3=Trading$/);
  // Encoding counts: 3000 "&" become 9000 characters.
  const enc = googlePrefill(form, freqs, { name: '&'.repeat(3000) });
  assert.deepEqual(enc.left, ['name']);
  assert.equal(enc.url, `${form.url}?usp=pp_url`);
});

const kitAnswers = { project_name: 'Tip Jar', repo_url: 'https://github.com/alice/tipjar', description: 'Tips for creators' };

test('10.8 prefilled_link: open, check, click submit; the answers that are not in the link are pasted; the proof ask last', () => {
  const p = kp('https://forms.gle/abc', { title: 'Base Builder Grants', form: { ...gform, fields: { project_name: 'entry.1', repo_url: 'entry.2' } } });
  const kit = submitKit(p, kitAnswers, { browser: false });
  assert.equal(kit.mode, 'prefilled_link');
  assert.equal(kit.prefilled_url, 'https://docs.google.com/forms/d/e/1FAIpQ/viewform?usp=pp_url&entry.1=Tip%20Jar&entry.2=https%3A%2F%2Fgithub.com%2Falice%2Ftipjar');
  assert.deepEqual(kit.paste.map((f) => f.key), ['description']);
  assert.equal(
    kit.show_to_builder,
    `Ready for Base Builder Grants. Open this, check it, and click submit:\n${kit.prefilled_url}\n\nYou add these yourself:\nWhat does it do?\nTips for creators\n\n${CONFIRMATION_ASK}`,
  );
  // Everything in the link: no paste list.
  const all = submitKit({ ...p, form: { ...gform, fields: { project_name: 'entry.1', repo_url: 'entry.2', description: 'entry.3' } } }, kitAnswers, { browser: false });
  assert.deepEqual(all.paste, []);
  assert.doesNotMatch(all.show_to_builder, /You add these yourself/);
  assert.ok(all.show_to_builder.endsWith(`click submit:\n${all.prefilled_url}\n\n${CONFIRMATION_ASK}`), all.show_to_builder);
});

test('10.8 C9 prefilled_link: what is missing first; blanks are marked in the paste list, never in the link', () => {
  const p = kp('https://forms.gle/abc', { form: { ...gform, fields: { project_name: 'entry.1', repo_url: 'entry.2', description: 'entry.3' } } });
  const kit = submitKit(p, { project_name: 'Tip Jar' }, { browser: false });
  assert.equal(kit.prefilled_url, 'https://docs.google.com/forms/d/e/1FAIpQ/viewform?usp=pp_url&entry.1=Tip%20Jar');
  assert.ok(kit.show_to_builder.startsWith('Before you submit: a GitHub repo, what does it do.\n\nFor Arc Microgrants, open this, check it, and click submit once the blanks are in:\n'), kit.show_to_builder);
  assert.ok(kit.show_to_builder.includes('You add these yourself:\nGitHub repo\n(still needed)\n\nWhat does it do?\n(still needed)'));
});

test('10.8 agent_fills: the builder logs in, checks and submits; the steps stop at login, captcha, signing and uploads, never submit', () => {
  const p = kp('https://colosseum.com/arena', { title: 'Colosseum' });
  const kit = submitKit(p, kitAnswers, { browser: true });
  assert.equal(kit.mode, 'agent_fills');
  assert.deepEqual(kit.agent_steps, AGENT_FILL_STEPS);
  assert.equal(kit.show_to_builder, `Ready for Colosseum. I'll fill the form in your browser. You log in, check it and click submit.\n\n${ENTRY_LINK_ASK}`);
  const steps = AGENT_FILL_STEPS.join(' ');
  assert.match(steps, /builder's own logged-in browser/);
  assert.match(steps, /kit\.fields/);
  for (const w of [/login/, /captcha/, /wallet signature/, /file upload/, /Never click submit/, /ready for them to check and submit/]) assert.match(steps, w);
  assert.match(kitAgentNote(kit, p), /Never click submit/);
  // A file field: the builder uploads it.
  const withFile = submitKit(
    { ...p, submission_requirements: [...reqs, { key: 'logo', label: 'Logo', type: 'file', required: true, from: 'builder' } as SubmissionRequirement] },
    { ...kitAnswers, logo: 'logo.png' },
    { browser: true },
  );
  assert.deepEqual(withFile.paste.map((f) => f.key), ['logo']);
  assert.match(withFile.show_to_builder, /\n\nYou add these yourself:\nLogo\nlogo\.png\n\n/);
  // No browser: paste.
  assert.equal(submitKit(p, kitAnswers, { browser: false }).mode, 'copy_paste');
});

test('10.8 copy_paste on DoraHacks keeps Task 8 text; the agent is told the terms ban filling', () => {
  const p = kp('https://dorahacks.io/hackathon/arc-microgrants');
  const kit = submitKit(p, kitAnswers, { browser: true });
  assert.equal(kit.mode, 'copy_paste');
  assert.ok(kit.show_to_builder.startsWith('Ready for Arc Microgrants. Paste each answer into the form:\nForm: https://dorahacks.io/hackathon/arc-microgrants\n\n'));
  assert.ok(!('agent_steps' in kit) && !('prefilled_url' in kit));
  assert.match(kitAgentNote(kit, p), /terms ban automated use: never fill or submit/);
  assert.match(kitAgentNote(submitKit(kp('https://circle.questbook.app/'), kitAnswers, { browser: true }), kp('https://circle.questbook.app/')), /terms ban/);
});

test('10.8 api: the platform agent API with the builder key; payload maps keys to answers; no key or secret anywhere', () => {
  const p = kp('https://superteam.fun/earn/listing/x', { title: 'Superteam Bounty', submit_api: true });
  const kit = submitKit(p, kitAnswers, { browser: false });
  assert.equal(kit.mode, 'api');
  assert.deepEqual(kit.api, { platform: 'superteam', payload: kitAnswers });
  assert.equal(kit.show_to_builder, `Ready for Superteam Bounty. I'll send it to Superteam Earn for you, then you confirm it there.\n\n${CONFIRMATION_ASK}`);
  const keys = (v: unknown): string[] => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
  for (const k of keys(kit)) assert.doesNotMatch(k, /api_?key|apikey|secret|password|authorization|bearer/i, k);
  assert.equal(submitKit(kp('https://gap.karmahq.xyz/p', { submit_api: true }), kitAnswers, { browser: false }).api?.platform, 'karma');
  assert.equal(submitKit(kp('https://gap.karmahq.xyz/p', { submit_api: true }), kitAnswers, { browser: false }).proof.kind, 'entry_link');
});

test('10.8: every mode ends with the proof ask and names no field keys or tools', () => {
  const kits = [
    submitKit(kp('https://forms.gle/abc', { form: gform }), kitAnswers, { browser: false }),
    submitKit(kp('https://colosseum.com/arena'), kitAnswers, { browser: true }),
    submitKit(kp('https://dorahacks.io/x'), kitAnswers, { browser: true }),
    submitKit(kp('https://superteam.fun/earn/x', { submit_api: true }), kitAnswers, { browser: true }),
  ];
  assert.deepEqual(kits.map((k) => k.mode), ['prefilled_link', 'agent_fills', 'copy_paste', 'api']);
  for (const k of kits) {
    assert.ok(k.show_to_builder.endsWith(k.proof.ask), k.mode);
    assert.doesNotMatch(k.show_to_builder, /project_name|repo_url|kit\.|record_submission|confirm_entry|\p{Extended_Pictographic}|—|\bcoins?\b/u, k.mode);
  }
});

test('C19: a Google form whose only sign-in is verified email keeps the link; the sign-in is the first own item; never emailAddress=', () => {
  const p = kp('https://forms.gle/abc', { title: 'Base Builder Grants', form: { ...gform, sign_in: 'email_only', fields: { project_name: 'entry.1', repo_url: 'entry.2' } } });
  for (const browser of [false, true]) {
    const kit = submitKit(p, kitAnswers, { browser });
    assert.equal(kit.mode, 'prefilled_link', String(browser));
    assert.deepEqual(kit.builder_steps, [GOOGLE_EMAIL_SIGN_IN]);
    assert.doesNotMatch(kit.prefilled_url ?? '', /emailAddress/);
    assert.equal(
      kit.show_to_builder,
      `Ready for Base Builder Grants. Open this, check it, and click submit:\n${kit.prefilled_url}\n\nYou add these yourself:\nSign in to Google and tick Record my email address.\n\nWhat does it do?\nTips for creators\n\n${CONFIRMATION_ASK}`,
    );
  }
  // Every answer in the link: the sign-in is still the one own item.
  const all = submitKit({ ...p, form: { ...p.form!, fields: { project_name: 'entry.1', repo_url: 'entry.2', description: 'entry.3' } } }, kitAnswers, { browser: false });
  assert.ok(all.show_to_builder.endsWith(`\n\nYou add these yourself:\n${GOOGLE_EMAIL_SIGN_IN}\n\n${CONFIRMATION_ASK}`), all.show_to_builder);
  // Driven by the form data: no sign-in, no step; a full sign-in (a file question) is the browser.
  assert.ok(!('builder_steps' in submitKit({ ...p, form: { ...p.form!, sign_in: false } }, kitAnswers, { browser: false })));
  assert.equal(submitModeFor({ ...p, form: { ...p.form!, sign_in: true } }, { browser: true }), 'agent_fills');
  assert.equal(submitModeFor({ ...p, form: { ...p.form!, sign_in: true } }, { browser: false }), 'copy_paste');
  // Not a Google form: no Google step even if the data says email_only.
  const tally = submitKit(kp('https://tally.so/r/abc', { form: { url: 'https://tally.so/r/abc', fields: { project_name: 'project' }, sign_in: 'email_only', read_at: '2026-10-07' } }), kitAnswers, { browser: false });
  assert.ok(!('builder_steps' in tally));
  assert.match(kitAgentNote(submitKit(p, kitAnswers, { browser: false }), p), /kit\.builder_steps/);
});

test('review Minor 6: the api note tells the agent to map the answers to the platform fields', () => {
  const p = kp('https://superteam.fun/earn/listing/x', { submit_api: true });
  assert.match(kitAgentNote(submitKit(p, kitAnswers, { browser: false }), p), /map each answer to the platform's own submission fields/);
});

test('v2.8.1 §C14: the speedrun kit says the application continues on a16z\'s site after the email step', () => {
  const dir = join(import.meta.dirname, '../../../../programs');
  const speedrun = ProgramFile.parse(JSON.parse(readFileSync(join(dir, 'a16z-speedrun.json'), 'utf8')));
  const kit = submitKit({ ...speedrun, title: speedrun.title }, { email: 'erin@example.com' }, { browser: false });
  assert.equal(continuesLine(speedrun), "After the email step, the application continues on a16z's site.");
  assert.equal(
    kit.show_to_builder,
    [
      'Ready for a16z speedrun SR008. Paste each answer into the form:',
      'Form: https://speedrun.a16z.com/apply',
      '\nEmail\nerin@example.com',
      "\nAfter the email step, the application continues on a16z's site.",
      `\n${CONFIRMATION_ASK}`,
    ].join('\n'),
  );
  // v3 Stage 2: Alliance's application also starts with one email; every other committed program: no such line.
  const alliance = ProgramFile.parse(JSON.parse(readFileSync(join(dir, 'alliance-all19.json'), 'utf8')));
  assert.equal(continuesLine(alliance), "After the email (1st founder) step, the application continues on Alliance's site.");
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'a16z-speedrun.json' && x !== 'alliance-all19.json')) {
    const p = ProgramFile.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    assert.equal(continuesLine(p), null, f);
  }
});

test('v4.8.3: an investment whose form is the whole application gets no continues line; a name ending in "s" takes the apostrophe alone', () => {
  const email = { key: 'email', label: 'Email', type: 'email' as const, required: true, from: 'builder' as const };
  const name = { key: 'name', label: 'Name', type: 'text' as const, required: true, from: 'builder' as const };
  assert.equal(continuesLine({ investment: true, organizer: 'Circle Ventures', submission_requirements: [email] }), "After the email step, the application continues on Circle Ventures' site.");
  assert.equal(continuesLine({ investment: true, organizer: 'Circle Ventures', submission_requirements: [email, name] }), null);
  assert.equal(continuesLine({ investment: true, organizer: 'Z Fellows', submission_requirements: [] }), null);
  assert.deepEqual(['a16z', 'Alliance', 'Z Fellows', 'Avalanche Team1 Mini Grants'].map(possessive), ["a16z's", "Alliance's", "Z Fellows'", "Avalanche Team1 Mini Grants'"]);
});
