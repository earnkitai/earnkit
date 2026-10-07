import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIRMATION_ASK, ENTRY_LINK_ASK, submitKit, type KitProgram } from './submit-kit';
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
