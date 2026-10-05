import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SponsorCampaignInput, tools } from './tools';
import { sql } from './db';
import { EntryError } from './campaigns';
import { earnkitTexts } from './campaign-text';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { setSanctionsOracle } from './sanctions';

const REF = `0x${'a'.repeat(64)}`;

test('SponsorCampaignInput accepts a valid create input', () => {
  const result = SponsorCampaignInput.safeParse({
    action: 'create',
    sponsor_wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    sponsor_name: 'Acme',
    title: 'Build on Acme',
    theme: 'Build something cool with the Acme SDK during the campaign.',
    criteria: 'Judged on creativity and polish.',
    chains: ['base'],
    token: 'USDC',
    amount: '5000',
    winners: 3,
    ends_at: '2026-12-01T00:00:00Z',
  });
  assert.equal(result.success, true);
});

test('SponsorCampaignInput accepts a valid status input', () => {
  const result = SponsorCampaignInput.safeParse({ action: 'status', ref: REF });
  assert.equal(result.success, true);
});

test('SponsorCampaignInput: status takes no tx hash any more', () => {
  assert.equal(
    SponsorCampaignInput.safeParse({
      action: 'status',
      ref: REF,
      tx: `0x${'b'.repeat(64)}`,
    }).success,
    false,
  );
});

test('SponsorCampaignInput: create needs sponsor_wallet', () => {
  const { success } = SponsorCampaignInput.safeParse({
    action: 'create',
    sponsor_name: 'Acme',
    title: 'Build on Acme',
    theme: 'Build something cool with the Acme SDK during the campaign.',
    criteria: 'Judged on creativity and polish.',
    chains: ['base'],
    token: 'USDC',
    amount: '5000',
    winners: 3,
    ends_at: '2026-12-01T00:00:00Z',
  });
  assert.equal(success, false);
});

test('SponsorCampaignInput accepts a valid award input', () => {
  const result = SponsorCampaignInput.safeParse({
    action: 'award',
    ref: REF,
    winners: [{ entry_id: 1, amount: '100', reason: 'Best use of the SDK' }],
  });
  assert.equal(result.success, true);
});

test('SponsorCampaignInput rejects an award whose winners is a number', () => {
  const result = SponsorCampaignInput.safeParse({
    action: 'award',
    ref: REF,
    winners: 3,
  });
  assert.equal(result.success, false);
});

// Against the local database when configured.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test('v2.4 §2: a failed entry uses none of the daily 20; a recorded one uses one', dbTest, async () => {
  const PAY = '0x' + 'a'.repeat(40);
  const C1 = '0x' + '1'.repeat(40);
  const f = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../programs/earnkit-campaign-1-base.json'), 'utf8'),
  );
  Object.assign(f, {
    id: `t4-limit-${process.pid}-${Date.now()}`,
    status: 'active',
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2099-01-01T00:00:00Z',
  });
  Object.assign(f, earnkitTexts(f));
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t4-limit-${process.pid}-${Date.now()}`}) RETURNING id`;
  const used = async () =>
    (
      await sql()<{ n: number }[]>`
        SELECT coalesce(sum(count), 0)::int AS n FROM rate_windows WHERE key = ${`recordSubmission:${id}`}`
    )[0].n;
  let deployer = '0x' + 'e'.repeat(40);
  const ctx = {
    installationId: id,
    entryDeps: {
      status: async () => 'during' as const,
      repoFacts: async () => ({ fork: false, created_at: '2026-10-01T00:00:00Z', pushed_at: '2026-10-06T00:00:00Z' }),
      fetchFile: async () => ({ status: 'ok' as const, text: `payout_wallet: ${PAY}\n` }),
      deployer: { creationTx: async () => '0xabc', txSender: async () => deployer },
    },
  };
  const project = { name: 'Tip Jar', description: 'Tips for creators', repo_url: 'https://github.com/alice/tipjar', live_url: 'https://tipjar.example' };
  const entry = {
    program_id: f.id,
    project,
    submission_data: { project_name: 'Tip Jar', description: 'Tips for creators', repo_url: project.repo_url, live_url: project.live_url, contracts: C1, payout_wallet: PAY },
    token: 'skip',
  };
  setSanctionsOracle({ chainId: async () => 8453, isSanctioned: async () => false });
  try {
    // Deployed by another wallet: refused, and the daily limit is untouched.
    await assert.rejects(tools.record_submission(entry, ctx), EntryError);
    assert.equal(await used(), 0);
    deployer = PAY;
    const r = (await tools.record_submission(entry, ctx)) as { recorded: boolean; show_to_builder?: string };
    assert.equal(r.recorded, true);
    assert.match(r.show_to_builder ?? '', /^\| Entered \| Tip Jar in /);
    assert.equal(await used(), 1);
  } finally {
    setSanctionsOracle(null);
  }
});

test('v2.4 §6 (audit C22): prepare_submission on a closed program has no token block', dbTest, async () => {
  const f = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../programs/arc-microgrants.json'), 'utf8'),
  );
  Object.assign(f, { id: `t9-closed-${process.pid}-${Date.now()}`, status: 'closed' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t9-closed-${process.pid}-${Date.now()}`}) RETURNING id`;
  const result = (await tools.prepare_submission(
    { program_id: f.id, project: { name: 'Tip Jar' } },
    { installationId: id },
  )) as Record<string, unknown>;
  assert.equal(result.warning, 'This program is closed or past its deadline.');
  assert.ok(!('token' in result));
});

test('I8: prepare_submission asks about the remembered payout wallet in full and never prefills it', dbTest, async () => {
  const W = '0x' + 'b'.repeat(39) + '7';
  const f = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../programs/earnkit-campaign-1-base.json'), 'utf8'),
  );
  Object.assign(f, {
    id: `i8-wallet-${process.pid}-${Date.now()}`,
    status: 'active',
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2099-01-01T00:00:00Z',
  });
  Object.assign(f, earnkitTexts(f));
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, payout_wallet) VALUES (${`i8-${process.pid}-${Date.now()}`}, ${W}) RETURNING id`;
  const r = (await tools.prepare_submission(
    { program_id: f.id, project: { name: 'Tip Jar', repo_url: 'https://github.com/alice/tipjar' } },
    { installationId: id },
  )) as { show_to_builder: string; payout_wallet_note?: string; missing: { key: string }[]; ready: boolean; sign_to_enter?: unknown };
  assert.match(r.show_to_builder, new RegExp(`Pay prizes to ${W}\\? It is the wallet from your last entry\\.`));
  assert.match(r.show_to_builder, /paid to your wallet by /);
  assert.match(r.payout_wallet_note ?? '', new RegExp(`^Pay prizes to ${W}\\? Confirm with the builder\\.`));
  assert.ok(r.missing.some((m) => m.key === 'payout_wallet'), 'still missing until the builder confirms');
  assert.equal(r.ready, false);
  // Once the builder confirms, the agent passes it: shown in full in the Prize row, no question.
  const ok = (await tools.prepare_submission(
    { program_id: f.id, project: { name: 'Tip Jar' }, answers: { payout_wallet: W } },
    { installationId: id },
  )) as { show_to_builder: string; payout_wallet_note?: string };
  assert.match(ok.show_to_builder, new RegExp(`paid to ${W} by `));
  assert.doesNotMatch(ok.show_to_builder, /Pay prizes to/);
  assert.equal(ok.payout_wallet_note, undefined);
});

test('campaign fee wallet: only a payout wallet given in this call, never the remembered one; other programs keep it', dbTest, async () => {
  const W = '0x' + 'c'.repeat(39) + '7';
  const GIVEN = '0x' + 'd'.repeat(39) + '1';
  const stamp = `${process.pid}-${Date.now()}`;
  const camp = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../programs/earnkit-campaign-1-base.json'), 'utf8'),
  );
  Object.assign(camp, { id: `fee-camp-${stamp}`, status: 'active', starts_at: '2026-09-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  Object.assign(camp, earnkitTexts(camp));
  await upsertProgram(ProgramFile.parse(camp));
  const plain = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/arc-microgrants.json'), 'utf8'));
  Object.assign(plain, { id: `fee-plain-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(plain));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, payout_wallet) VALUES (${`fee-${stamp}`}, ${W}) RETURNING id`;
  // Token launches on, the ticker check unreachable (no network in tests).
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const realFetch = globalThis.fetch;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
  type Token = { creator_wallet: string | null; note: string; say_to_builder: string };
  const prep = async (program_id: string, answers?: Record<string, string>) =>
    ((await tools.prepare_submission({ program_id, project: { name: 'Tip Jar' }, ...(answers && { answers }) }, { installationId: id })) as {
      token?: Token;
    }).token!;
  try {
    const none = await prep(camp.id);
    assert.equal(none.creator_wallet, null, 'the remembered wallet is never the fee wallet in a campaign');
    assert.match(none.note, /Ask the builder for the wallet that receives creator fees\./);
    assert.ok(!none.say_to_builder.includes(W) && !none.note.includes(W));
    const given = await prep(camp.id, { payout_wallet: GIVEN });
    assert.equal(given.creator_wallet, GIVEN);
    assert.doesNotMatch(given.note, /Ask the builder for the wallet/);
    // Not a campaign: v2.3 unchanged, the remembered wallet is the fee wallet.
    assert.equal((await prep(plain.id)).creator_wallet, W);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
});

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('v2.5 §1: list_programs reads the builder bonus pool only where entries are provable; no repo shows ideas', dbTest, async () => {
  const file = (name: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, `../../../../programs/${name}.json`), 'utf8'));
  const run = `${process.pid}-${Date.now()}`;
  const proof = Object.assign(file('arc-microgrants'), {
    id: `v25-proof-${run}`, title: `Proof ${run}`, status: 'active', ends_at: '2099-01-01T00:00:00Z', max_award_usd: 9_999_999,
  });
  const noProof = Object.assign(file('base-builder-grants'), {
    id: `v25-noproof-${run}`, title: `No proof ${run}`, status: 'active', ends_at: '2099-01-01T00:00:00Z', max_award_usd: 9_999_998,
  });
  assert.ok(proof.submission_proof && noProof.submission_proof === null);
  await upsertProgram(ProgramFile.parse(proof));
  await upsertProgram(ProgramFile.parse(noProof));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`v25-pool-${run}`}) RETURNING id`;
  const asked: string[] = [];
  const r = (await tools.list_programs({}, {
    installationId: id,
    roundPoolWei: async (programId) => {
      asked.push(programId);
      return programId === proof.id ? 42n * 10n ** 16n : null;
    },
  })) as { show_to_builder: string };
  const text = r.show_to_builder;
  assert.match(text, new RegExp(`\\| Proof ${run} \\| [^|]+ \\| 0\\.42 ETH so far \\|`));
  assert.match(text, new RegExp(`\\| No proof ${run} \\| [^|]+ \\| not available \\|`));
  assert.ok(asked.includes(proof.id) && !asked.includes(noProof.id), asked.join());
  assert.match(text, /\n\nBuilder bonus: paid by EarnKit from coin fees\. EarnKit isn't affiliated with or endorsed by any program's organizer\. Details: earnkit\.com\/policy\n\n/);
  assert.match(text, /\n\nIdeas that fit these programs:\n- /);
  assert.ok(text.includes(`\n- Proof ${run}: ${proof.ideas[0]}\n`) && text.includes(`\n- No proof ${run}: ${noProof.ideas[0]}\n`), text);
  // Without injection: no pool yet, so the provable program opens with the builder's entry.
  const plain = (await tools.list_programs({}, { installationId: id })) as { show_to_builder: string };
  assert.match(plain.show_to_builder, new RegExp(`\\| Proof ${run} \\| [^|]+ \\| opens with your entry \\|`));
  await sql()`UPDATE programs SET status = 'closed' WHERE id IN ${sql()([proof.id, noProof.id])}`;
});
