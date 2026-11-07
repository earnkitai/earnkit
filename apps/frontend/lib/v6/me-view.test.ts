import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { getRecord, saveRecord, upsertBuilder } from './builders';
import { approvalPathOf, csrfToken, meData, verifyCsrf } from './me-view';
import { APPROVABLE, mergeRecord } from './record';

after(() => sql().end());
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
  const d = await meData(b, NOW);
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
  assert.ok(verifyCsrf(csrfToken(7, day(0), SECRET), 7, NOW, SECRET));
  assert.ok(verifyCsrf(csrfToken(7, day(DAYMS), SECRET), 7, NOW, SECRET));
  assert.ok(!verifyCsrf(csrfToken(7, day(2 * DAYMS), SECRET), 7, NOW, SECRET));
  assert.ok(!verifyCsrf(csrfToken(8, day(0), SECRET), 7, NOW, SECRET));
  assert.ok(!verifyCsrf(csrfToken(7, day(0), 'another-secret-0123456789abcdef'), 7, NOW, SECRET));
  assert.ok(!verifyCsrf('', 7, NOW, SECRET));
  assert.match(csrfToken(7, day(0), SECRET), /^[A-Za-z0-9_-]{43}$/);
});
