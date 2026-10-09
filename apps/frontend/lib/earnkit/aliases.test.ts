import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALIASES_UNTIL, OLD_TOOL_NAMES, aliasCall, rewriteAliases } from './aliases';

// v2.10 item 4 (Review Focus 2): old tool calls in their v2.9 shapes reach the new tool with the same meaning.
const NOW = new Date('2026-10-10T00:00:00Z');
const program_id = 'arc-microgrants';
const project = { name: 'TipJar', repo_url: 'https://github.com/lee/TipJar' };
const answers = { description: 'Tips for creators' };
const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';

test('9.4 confirm_entry: go is yes; skip is skip_token; a skip without builder_confirmed is only the offer (Pre-flight P15a)', () => {
  assert.deepEqual(aliasCall('confirm_entry', { program_id, project, answers, builder_confirmed: true, decision: 'skip' }, NOW), {
    name: 'confirm',
    args: { program_id, project, answers, skip_token: true },
  });
  assert.deepEqual(aliasCall('confirm_entry', { program_id, project, answers, builder_confirmed: true, decision: 'go', wallet: W, token: { symbol: 'TIP' }, check_back: true }, NOW), {
    name: 'confirm',
    args: { program_id, project, answers, wallet: W, token: { symbol: 'TIP' }, yes: true, check: true },
  });
  // v2.9: a skip without the yes showed the offer; it still does (no skip_token, no yes).
  assert.deepEqual(aliasCall('confirm_entry', { program_id, project, answers, decision: 'skip' }, NOW), {
    name: 'confirm',
    args: { program_id, project, answers },
  });
});

test('9.4 record_submission: builder_submitted is tell.submitted; builder_confirmed is confirm with answers from submission_data and yes', () => {
  const url = 'https://dorahacks.io/buidl/1';
  assert.deepEqual(
    aliasCall('record_submission', { program_id, project, submission_data: { ...answers, chains: ['base', 'arc'] }, builder_submitted: true, external_submission_url: url }, NOW),
    {
      name: 'tell',
      args: { submitted: { program_id, external_submission_url: url, project, submission_data: { ...answers, chains: ['base', 'arc'] } } },
    },
  );
  assert.deepEqual(
    aliasCall('record_submission', { program_id, project, submission_data: { ...answers, chains: ['base', 'arc'], none: null }, builder_confirmed: true, payout_wallet: W, contracts: ['0xab'], signed_in: 'CODE' }, NOW),
    {
      name: 'confirm',
      args: { program_id, project, contracts: ['0xab'], signed_in: 'CODE', answers: { ...answers, chains: 'base, arc' }, wallet: W, yes: true },
    },
  );
  // token 'skip': no token; the builder's confirmed name and ticker are carried as confirm's token.
  assert.deepEqual(aliasCall('record_submission', { program_id, project, submission_data: {}, token: 'skip' }, NOW)?.args, {
    program_id,
    project,
    answers: {},
    skip_token: true,
  });
  assert.deepEqual(
    aliasCall('record_submission', { program_id, project, submission_data: {}, builder_confirmed: true, token: { name: 'Tip Jar', symbol: 'TIP', image_url: 'https://x.dev/a.png', image: 'mark' } }, NOW)?.args,
    { program_id, project, answers: {}, token: { name: 'Tip Jar', symbol: 'TIP' }, image_url: 'https://x.dev/a.png', yes: true },
  );
  // Pre-flight P15b: both flags confirm the entry and mark it submitted, as v2.9 did in one call.
  assert.deepEqual(
    aliasCall('record_submission', { program_id, project, submission_data: answers, builder_confirmed: true, builder_submitted: true, external_submission_url: url }, NOW),
    { name: 'confirm', args: { program_id, project, answers, yes: true, submitted: { external_submission_url: url } } },
  );
});

test('9.4 launch_token: project_id is confirm with project_id and yes; an offer is confirm with the program, the project and no answers', () => {
  assert.deepEqual(aliasCall('launch_token', { project_id: 7, builder_confirmed: true }, NOW), { name: 'confirm', args: { project_id: 7, yes: true } });
  assert.deepEqual(
    aliasCall('launch_token', { project_id: 7, builder_confirmed: true, creator_wallet: W, symbol: 'TIP', live_url: 'https://tip.xyz', image_data: 'data:x', check_back: true }, NOW),
    { name: 'confirm', args: { project_id: 7, token: { symbol: 'TIP' }, image_data: 'data:x', project: { live_url: 'https://tip.xyz' }, wallet: W, yes: true, check: true } },
  );
  assert.deepEqual(
    aliasCall('launch_token', { offer: { program_id, repo_url: project.repo_url, project_name: 'TipJar' }, decision: 'go', builder_confirmed: true, creator_wallet: W }, NOW),
    { name: 'confirm', args: { wallet: W, yes: true, program_id, project: { name: 'TipJar', repo_url: project.repo_url }, answers: {} } },
  );
  // A v2.9 offer skip (no builder_confirmed) records nothing: the offer again (Pre-flight P15a).
  assert.deepEqual(aliasCall('launch_token', { offer: { program_id, repo_url: project.repo_url, project_name: 'TipJar' }, decision: 'skip' }, NOW)?.args, {
    program_id,
    project: { name: 'TipJar', repo_url: project.repo_url },
    answers: {},
  });
});

test('9.4 the rest: list_programs, get_program, prepare_submission, tell_earnkit and pick_up_entries; new and unknown names are null', () => {
  assert.deepEqual(aliasCall('list_programs', { repos: ['lee/TipJar'], more: true }, NOW), { name: 'find', args: { repos: ['lee/TipJar'], more: true } });
  assert.deepEqual(aliasCall('get_program', { program_id, repo: 'lee/TipJar' }, NOW), { name: 'find', args: { program_id, repo: 'lee/TipJar' } });
  assert.deepEqual(aliasCall('prepare_submission', { program_id, project, coach_asked: true }, NOW), { name: 'prepare', args: { program_id, project, coach_asked: true } });
  const told = { program_status: [{ program_id, status: 'applied' }] };
  assert.deepEqual(aliasCall('tell_earnkit', told, NOW), { name: 'tell', args: told });
  assert.deepEqual(aliasCall('pick_up_entries', { answer: 'yes' }, NOW), { name: 'tell', args: { pickup: 'yes' } });
  assert.deepEqual(aliasCall('pick_up_entries', { answer: ' No ' }, NOW), { name: 'tell', args: { pickup: 'no' } });
  for (const n of ['find', 'prepare', 'confirm', 'tell', 'sponsor_campaign', 'report_outcome', 'nope'])
    assert.equal(aliasCall(n, { program_id }, NOW), null, n);
});

test('9.5 after ALIASES_UNTIL every old name is null (the SDK then answers an unknown tool)', () => {
  assert.equal(ALIASES_UNTIL.toISOString(), '2026-11-09T00:00:00.000Z');
  assert.deepEqual([...OLD_TOOL_NAMES], ['list_programs', 'get_program', 'prepare_submission', 'confirm_entry', 'record_submission', 'launch_token', 'tell_earnkit', 'pick_up_entries']);
  for (const n of OLD_TOOL_NAMES) {
    assert.notEqual(aliasCall(n, { program_id, project, answers, submission_data: {}, project_id: 1 }, new Date(ALIASES_UNTIL.getTime() - 1)), null, n);
    assert.equal(aliasCall(n, { program_id, project, answers, submission_data: {}, project_id: 1 }, ALIASES_UNTIL), null, n);
    assert.equal(aliasCall(n, { program_id }, new Date('2027-01-01T00:00:00Z')), null, n);
  }
});

test('9.6 rewriteAliases: a batch rewrites only the old call, logs it once by name only, and leaves the rest byte-equal', async () => {
  const old = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'confirm_entry', arguments: { program_id, project, answers, builder_confirmed: true, decision: 'go', wallet: W } } };
  const fresh = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'confirm', arguments: { program_id, project, answers, yes: true } } };
  const list = { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} };
  const logged: [string, string][] = [];
  const out = await rewriteAliases([old, fresh, list], NOW, (a, b) => void logged.push([a, b]));
  assert.equal(out.changed, true);
  assert.deepEqual(logged, [['confirm_entry', 'confirm']]);
  const [o, f, l] = out.body as Record<string, unknown>[];
  assert.deepEqual(o, { ...old, params: { name: 'confirm', arguments: { program_id, project, answers, wallet: W, yes: true } } });
  assert.equal(JSON.stringify(f), JSON.stringify(fresh));
  assert.equal(JSON.stringify(l), JSON.stringify(list));
  // A single message, a new name, a notification, odd shapes and after the window: unchanged.
  assert.deepEqual(await rewriteAliases(fresh, NOW), { body: fresh, changed: false });
  assert.deepEqual(await rewriteAliases(old, ALIASES_UNTIL), { body: old, changed: false });
  for (const odd of [null, 'x', 42, [], { method: 'tools/call' }, { method: 'tools/call', params: { name: 'get_program', arguments: 'x' } }])
    assert.equal((await rewriteAliases(odd, NOW)).changed, false, JSON.stringify(odd));
  const single = await rewriteAliases({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_program', arguments: { program_id } } }, NOW);
  assert.deepEqual(single, { body: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'find', arguments: { program_id } } }, changed: true });
});
