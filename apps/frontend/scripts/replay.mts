/**
 * pnpm -s tsx apps/frontend/scripts/replay.mts <fixture> [--monday] [--linked]
 * Runs find, track applied, find on a scratch database with a recorded repo and prints what the builder and
 * the agent see. --monday: the clock moves to the next Monday 09:00 UTC after a ready program's deadline is
 * brought within a week, so the "Since" line shows. --linked: a builder with the record in
 * fixtures/record-owner.json (own evidence faked as a site that loads): find, track started, track applied by
 * the agent, find the next morning. The scratch database is dropped on exit.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const args = process.argv.slice(2);
const monday = args.includes('--monday');
const linked = args.includes('--linked');
const slug = args.find((a) => !a.startsWith('--'));
if (!slug) throw new Error('usage: replay.mts <fixture> [--monday]   (earnkit, onchain-reaction, nextjs-dashboard, saber-distributor)');

const admin = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/earnkit_test';
const fx = join(import.meta.dirname, '..', 'lib', 'v5', 'fixtures');
const name = `ek_t_0123456789_${process.pid}`;
execFileSync(process.execPath, [join(fx, 'test-db-create.mjs'), admin, name], { stdio: 'inherit' });
const url = new URL(admin);
url.pathname = `/${name}`;
process.env.DATABASE_URL = url.toString();

const { sql } = await import('../lib/v5/db');
const { getProgram, upsertProgram } = await import('../lib/v5/programs');
const { replayFetch } = await import('../lib/v5/fixtures/github');
const { mcpCall } = await import('../lib/v5/fixtures/mcp-call');
const { linkInstallation, saveRecord, upsertBuilder } = await import('../lib/v6/builders');
const { parseRecord } = await import('../lib/v6/record');
const { evidence, liveRows } = await import('../lib/v6/fixtures/evidence-builder');
const { readFileSync } = await import('node:fs');

try {
  const [inst] = await sql()`INSERT INTO installations (token_hash) VALUES (${'replay-' + Math.random()}) RETURNING id`;
  const rec = replayFetch(slug);
  // The honest run: no live link or users claim the repo itself does not show.
  const project = { name: slug, description: 'An app.', repo_url: `https://github.com/${rec.repo}` };
  let now = new Date('2026-11-04T12:00:00Z');
  let builderId: number | null = null;
  if (linked) {
    const b = await upsertBuilder({ github_id: 1, login: 'owner', name: 'Owner', avatar_url: null }, now);
    await linkInstallation(inst.id as number, b.id, now);
    const record = parseRecord(JSON.parse(readFileSync(join(fx, 'record-owner.json'), 'utf8')));
    if (record.projects[0]) record.projects[0].repo_url = `https://github.com/${rec.repo}`;
    await saveRecord(b.id, record, now);
    builderId = b.id;
  }
  // Never the network: the builder's own evidence is a site that loads (live, no verified usage).
  const ownEvidence = async () => evidence({ live: liveRows({ url: 'https://earnkit.com', url_ok: true }), read_at: now.toISOString() });
  const call = async (tool: string, a: Record<string, unknown>) => {
    const r = await mcpCall({ installationId: inst.id as number, builderId, now, gh: rec.fetch, evidence: ownEvidence }, tool, a);
    console.log(`\n== ${tool} ${JSON.stringify(a.status ?? '')} at ${now.toISOString()}${r.isError ? ' (error)' : ''}`);
    console.log('-- show_to_builder\n' + (r.reply?.show_to_builder ?? r.text));
    console.log('-- agent_note\n' + (r.reply?.agent_note ?? ''));
    return r.reply;
  };
  const first = await call('find', { project });
  const top = (first?.ready as { program_id: string }[] | undefined)?.[0]?.program_id;
  if (top && linked) {
    await call('track', { program_id: top, status: 'started', project_id: 'earnkit' });
    now = new Date(now.getTime() + 3_600_000);
    await call('track', { program_id: top, status: 'applied', submitted_by: 'agent', fields_used: ['email', 'problem'], project_id: 'earnkit' });
    now = new Date('2026-11-05T08:00:00Z');
  } else if (top) await call('track', { program_id: top, status: 'applied' });
  if (monday) {
    const next = (first?.ready as { program_id: string }[] | undefined)?.[1]?.program_id ?? top;
    if (next) {
      const p = (await getProgram(next))!.file;
      await upsertProgram({ ...p, ends_at: '2026-11-12T23:59:59Z' }, 'file', new Date(now.getTime() + 3_600_000));
    }
    now = new Date('2026-11-09T09:00:00Z');
  }
  await call('find', { project });
} finally {
  await sql().end();
  execFileSync(process.execPath, [join(fx, 'test-db-drop.mjs'), admin, name], { stdio: 'inherit' });
}
