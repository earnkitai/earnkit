import './env.mts';
import {
  createWalletClient,
  encodeAbiParameters,
  http,
  isAddress,
  keccak256,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, foundry } from 'viem/chains';
import type { CampaignConfig } from '../lib/earnkit/campaigns';
import {
  FALLBACK_REASON,
  USAGE,
  cliErrorLine,
  executeProblem,
  fallbackProblem,
  guardianKeyProblem,
  operatorKeyProblem,
  parseFallbackPicks,
} from '../lib/earnkit/cli';
import { formatDeadline } from '../lib/earnkit/dates';
import { sql } from '../lib/earnkit/db';
import type { FrozenTerms } from '../lib/earnkit/payout';

/**
 * Admin for EarnKit's own campaigns (golive, and the read-only rank|payout|veto-link <slug>: the
 * cron scores and pays them) and for sponsor campaigns (fallback|refund|sync <ref>; local use).
 * `pnpm campaign --help` lists every command (lib/earnkit/cli.ts USAGE). Sponsor signing keys
 * (OPERATOR_PRIVATE_KEY, GUARDIAN_PRIVATE_KEY) live only in the local shell, never on the server. Every error ends as one
 * readable line and exit code 1.
 */
const args = process.argv.slice(2);
const command = args[0];
const sub = command === 'fallback' ? args[1] : undefined;
const positional = args[command === 'fallback' ? 2 : 1];
const slug = positional?.startsWith('--') ? undefined : positional;
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? '');
};
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const COMMANDS = ['golive', 'rank', 'payout', 'veto-link', 'fallback', 'refund', 'sync'];
const FALLBACK = ['propose', 'execute', 'veto'];
if (!command || ['help', '--help', '-h'].includes(command)) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}
if (!COMMANDS.includes(command))
  fail(`Unknown command "${command}".\n\n${USAGE}`);
if (command === 'fallback' && !FALLBACK.includes(sub ?? ''))
  fail(`pnpm campaign fallback needs propose, execute or veto.\n\n${USAGE}`);
// v2.4: the cron pays EarnKit campaigns from CAMPAIGN_PAYOUT_PRIVATE_KEY; a manual payout beside it
// could pay twice, so there is none.
if (command === 'payout' && (process.argv.includes('--execute') || process.argv.includes('--winners')))
  fail('pnpm campaign payout is a dry run only: the cron pays the winners after the 48-hour review.');
if (!slug && command !== 'sync')
  fail(
    `pnpm campaign ${command}${sub ? ` ${sub}` : ''} needs a campaign ${['golive', 'rank', 'payout', 'veto-link'].includes(command) ? 'slug' : 'ref'}.\n\n${USAGE}`,
  );

// Set inside main(), only for commands that need it: golive edits the program file directly and
// must work with no DATABASE_URL (it runs before the owner provisions anything, v2.4 ruling 2).
let db!: ReturnType<typeof sql>;
try {
  await main();
} catch (err) {
  // One readable line, never a stack trace (the operator reads this, not a developer).
  fail(cliErrorLine(err));
}

async function main() {
  if (command === 'golive') {
    await goLiveCommand();
    process.exit(0);
  }

  db = sql();
  if (['fallback', 'refund', 'sync'].includes(command)) {
    await sponsorCommand();
    await db.end();
    process.exit(0);
  }

  const [program] = await db<
    {
      id: string;
      title: string;
      starts_at: Date;
      ends_at: Date;
      campaign: CampaignConfig | null;
    }[]
  >`SELECT id, title, starts_at, ends_at, campaign FROM programs WHERE id = ${slug ?? ''}`;
  if (!program?.campaign)
    fail(`No campaign program "${slug}". Run pnpm campaign --help.`);
  const campaign = program.campaign;
  if (campaign.kind !== 'earnkit') fail('Sponsor campaigns: use fallback/refund/sync (see --help).');

  if (command === 'veto-link') {
    const { vetoLink } = await import('../lib/earnkit/veto');
    const link = vetoLink(process.env.EARNKIT_URL ?? 'https://earnkit.com', program.id);
    if (!link) fail('Set ADMIN_VETO_SECRET in your local shell (the same value as on Railway, 32+ characters).');
    console.log(link);
  } else if (command === 'rank' || command === 'payout') {
    // Read-only (v2.4 §6): the cron scores, freezes and pays; this shows what it sees.
    const { reviewRows, payingCampaign } = await import('../lib/earnkit/leaderboard');
    const [run] = await db<{ state: string; terms: FrozenTerms | null }[]>`
      SELECT state, terms FROM campaign_runs WHERE program_id = ${program.id}`;
    const terms = payingCampaign(campaign, run?.terms);
    const { ranked, picks, skipped } = await reviewRows(program.id, campaign);
    if (command === 'rank') {
      console.log(
        `${program.title}: ${ranked.length} scored entries, top ${terms.winners} win, min ${terms.min_score}` +
          ` (${run?.state ?? 'running'}${run?.terms ? ', terms frozen' : ''})\n`,
      );
      for (const e of ranked)
        console.log(
          `#${e.rank}  id ${e.id}  ${e.name}  ${e.score} users (${e.counted} counted, ${e.smart} smart, ${e.shared} shared)` +
            `${e.code_share === null ? '' : `  code ${Math.round(e.code_share * 100)}%`}` +
            `${e.score_partial ? '  CAPPED READ (may be low; still pays)' : ''}` +
            `${picks.some((p) => p.id === e.id) ? '  WINS' : ''}${e.vetoed_at ? `  REMOVED (${e.veto_reason})` : ''}` +
            `${e.score_error ? `  score error: ${e.score_error}` : ''}${e.prize_tx ? `  PAID ${e.prize_tx}` : ''}` +
            `\n      contracts ${e.contracts.join(', ')}  deployers ${(e.deployers ?? []).join(', ')}  payout ${e.payout_wallet}` +
            `\n      ${[e.live_url, e.repo_url].filter(Boolean).join('  ')}`,
        );
      for (const s of skipped) console.log(`skipped id ${s.id}: ${s.reason}`);
    } else {
      // The cron screens each winner before paying; a listed wallet is refused and the next entry
      // moves up. Same here, without sending anything.
      const { screenedWallets, BASE_MAINNET } = await import('../lib/earnkit/sanctions');
      const { pickWinners } = await import('../lib/earnkit/winners');
      const eligible = ranked.filter((e) => (e.score ?? 0) >= terms.min_score && !e.prize_tx);
      const screen = await screenedWallets(eligible.map((e) => e.payout_wallet), BASE_MAINNET);
      const listed = new Set(screen.listed);
      const screened = ranked.map((e) =>
        listed.has(e.payout_wallet.toLowerCase()) ? { ...e, payout_status: 'refused' } : e,
      );
      const plan = pickWinners(screened, terms.winners, terms.min_score);
      console.log(
        `The cron pays ${terms.amount_each} ${terms.prize.symbol} each, in this order, after the review` +
          ` (now: ${run?.state ?? 'running'}):`,
      );
      for (const w of plan.winners)
        console.log(`  #${w.rank} id ${w.id} ${w.name} -> ${w.payout_wallet}${w.prize_tx ? ` (paid ${w.prize_tx})` : ''}`);
      if (plan.winners.length === 0) console.log('  nobody yet: no entry reached the minimum.');
      for (const s of plan.skipped) console.log(`  skipped id ${s.id}: ${s.reason}`);
      if (!screen.screened)
        console.log('\nSanctions not screened (the Base RPC could not be read); the cron screens each winner before paying.');
      console.log('\nDry run: nothing is sent from here.');
    }
  }
  await db.end();
}

/** golive <slug>: edits programs/<slug>.json only (no database); the owner commits and pushes it. */
async function goLiveCommand() {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ProgramFile } = await import('../lib/earnkit/program-file');
  const { earnkitTexts, goLive } = await import('../lib/earnkit/campaign-text');
  const path = join(import.meta.dirname, '..', '..', '..', 'programs', `${slug}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (raw.campaign?.kind !== 'earnkit') fail(`${slug} isn't an EarnKit campaign.`);
  let next: typeof raw;
  if (process.argv.includes('--texts-only')) {
    next = { ...raw, ...earnkitTexts(raw) };
  } else {
    const days = Number(flag('days') ?? 14);
    if (!Number.isInteger(days) || days < 1 || days > 60)
      fail('--days must be a whole number from 1 to 60.');
    const { llamaPrice } = await import('../lib/earnkit/prices');
    const { price } = await llamaPrice(`base:${raw.campaign.prize.token}`);
    next = goLive(raw, { now: new Date(), price, days });
    const c = next.campaign;
    const total = BigInt(c.amount_each) * BigInt(c.winners);
    console.log(
      `${next.title}\n  ${next.starts_at} -> ${next.ends_at}\n` +
        `  ${c.prize.symbol} at $${price}: ${Number(c.amount_each).toLocaleString('en-US')} each\n` +
        `  Fund the payout wallet with ${total.toLocaleString('en-US')} ${c.prize.symbol} plus a little ETH for gas.`,
    );
  }
  const parsed = ProgramFile.safeParse(next);
  if (!parsed.success)
    fail(`The new file isn't valid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  if (!process.argv.includes('--write')) {
    console.log('\nDry run. Add --write to update the file, then commit and push it.');
    return;
  }
  // The raw object, not the parsed one: parsing adds defaults (token_policy) the file leaves out.
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
  console.log(`\nWrote programs/${slug}.json. Commit and push it to go live.`);
}

/** fallback | refund | sync: sponsor campaigns, by ref. */
async function sponsorCommand() {
  const { loadCampaign, checkChain, excludedWinners } = await import(
    '../lib/earnkit/sponsor'
  );
  const { planAward, resolvePicks, splitUnits } = await import(
    '../lib/earnkit/sponsor-rules'
  );
  const { screenWinners } = await import('../lib/earnkit/sanctions');
  const { escrowConfig, escrowClient, readEscrow } = await import(
    '../lib/earnkit/escrow'
  );
  const { campaignAbi, campaignsAbi } = await import(
    '../lib/earnkit/escrow-abi'
  );
  const { formatExact } = await import('../lib/earnkit/format-units');
  const { quoted } = await import('../lib/earnkit/untrusted-text');
  const { sponsorIdentity } = await import('../lib/earnkit/sponsor-verify');
  const { sponsorLabel } = await import('../lib/earnkit/sponsor-identity');

  // Signing needs a well-formed key; check it before reading anything else.
  const execute = process.argv.includes('--execute');
  const keyName =
    sub === 'veto' ? 'GUARDIAN_PRIVATE_KEY' : 'OPERATOR_PRIVATE_KEY';
  const keyProblem = () =>
    (sub === 'veto' ? guardianKeyProblem : operatorKeyProblem)(
      process.env[keyName],
    );
  if (execute && command !== 'sync') {
    const problem = keyProblem();
    if (problem) fail(problem);
  }
  const signer = () => {
    const problem = keyProblem();
    if (problem) fail(problem);
    const { chain, rpcUrl } = escrowConfig();
    return createWalletClient({
      account: privateKeyToAccount(process.env[keyName] as `0x${string}`),
      chain: { base, 'base-sepolia': baseSepolia, local: foundry }[chain],
      transport: http(rpcUrl),
    });
  };
  const send = async (
    what: string,
    write: (w: ReturnType<typeof signer>) => Promise<`0x${string}`>,
  ) => {
    const hash = await write(signer());
    const receipt = await escrowClient().waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') fail(`${what} reverted: ${hash}`);
    return hash;
  };
  const chainNow = async () => (await escrowClient().getBlock()).timestamp;
  const seconds = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));

  if (command === 'sync') {
    // One campaign, or every one that can still change onchain.
    const refs = slug
      ? [slug]
      : (
          await db<{ ref: string }[]>`
          SELECT ref FROM sponsor_campaigns
          WHERE state IN ('draft', 'live')
            OR (state IN ('expired', 'replaced') AND (draft->>'ends_at')::timestamptz > now() - interval '30 days')
          ORDER BY created_at`
        ).map((r) => r.ref);
    if (refs.length === 0)
      console.log('No draft, expired, replaced or live sponsor campaigns.');
    let failed = 0;
    for (const ref of refs) {
      const before = await loadCampaign(ref);
      try {
        const found = await checkChain(before, { fresh: true });
        const after = await loadCampaign(ref);
        const chain = after.escrow_address
          ? (await readEscrow(after.escrow_address)).state
          : 'no deposit from the sponsor wallet';
        // Refreshes the domain-verification cache that list_programs and get_program read (they
        // never fetch). Only funded campaigns have an identity.
        const identity = await sponsorIdentity(after);
        console.log(
          `${ref} · ${quoted(after.draft.title)} · database ${before.state}` +
            (after.state !== before.state ? ` -> ${after.state}` : '') +
            ` · chain says: ${chain}` +
            (found.fallbackExecutesAt
              ? ` · fallback pending, executable from ${formatDeadline(found.fallbackExecutesAt)}`
              : '') +
            (found.fundingProblem
              ? ` · refused: ${found.fundingProblem}`
              : '') +
            (found.strayEscrow
              ? ` · refund it: pnpm campaign refund ${ref} --escrow ${found.strayEscrow} --reason no-eligible --execute`
              : '') +
            (after.replaced_by ? ` · replaced by ${after.replaced_by}` : '') +
            (found.chainNote ? ` · ${found.chainNote}` : '') +
            (after.state === 'live' ? ` · ${sponsorLabel(identity)}` : ''),
        );
      } catch (err) {
        failed++;
        console.log(`${ref} · check failed: ${cliErrorLine(err)}`);
      }
    }
    if (failed) fail(`${failed} campaign(s) could not be checked.`);
    return;
  }

  const row = await loadCampaign(slug!);

  if (command === 'refund') {
    const reason = flag('reason');
    if (reason !== 'no-eligible' && reason !== 'takedown')
      fail('--reason no-eligible|takedown');
    // --escrow <address>: a stray escrow for this ref that EarnKit doesn't track (another wallet's
    // deposit, or the sponsor wallet's deposit with terms that differ from the draft). It must be a
    // clone of our factory that the factory records for this ref.
    const escrowFlag = flag('escrow');
    let escrow = row.escrow_address as `0x${string}` | null;
    let untracked = false;
    if (escrowFlag !== undefined) {
      if (!isAddress(escrowFlag, { strict: false }))
        fail('--escrow must be an address');
      const target = escrowFlag.toLowerCase() as `0x${string}`;
      if (target !== escrow?.toLowerCase()) {
        const { factory } = escrowConfig();
        const read = (functionName: 'factory' | 'sponsor') =>
          escrowClient()
            .readContract({ address: target, abi: campaignAbi, functionName })
            .catch(() =>
              fail(`${target} isn't an EarnKit campaign escrow.`),
            ) as Promise<string>;
        if ((await read('factory')).toLowerCase() !== factory.toLowerCase())
          fail(
            `${target} wasn't created by this EarnKit factory (${factory}).`,
          );
        const sponsor = (await read('sponsor')) as `0x${string}`;
        const recorded = (await escrowClient().readContract({
          address: factory,
          abi: campaignsAbi,
          functionName: 'campaignOf',
          args: [sponsor, slug as `0x${string}`],
        })) as string;
        if (recorded.toLowerCase() !== target)
          fail(`${target} isn't an escrow for campaign ${slug}.`);
        untracked = true;
        console.log(
          `untracked escrow ${target} (sponsor ${sponsor}) for this ref`,
        );
      }
      escrow = target;
    }
    if (!escrow) fail(`Campaign ${slug} isn't funded (state ${row.state}).`);
    const chainState = (await readEscrow(escrow)).state;
    console.log(
      `${quoted(row.draft.title)} · ${row.state} · onchain ${chainState} · escrow ${escrow}`,
    );
    // Only a Funded escrow can be refunded; say who gets the money before anything is signed.
    if (chainState !== 'funded')
      fail(
        `The escrow isn't Funded onchain (chain says: ${chainState}); nothing to refund.`,
      );
    const readEscrowField = (functionName: 'sponsor' | 'prize' | 'fee') =>
      escrowClient().readContract({
        address: escrow,
        abi: campaignAbi,
        functionName,
      });
    const [to, prize, fee] = await Promise.all([
      readEscrowField('sponsor') as Promise<string>,
      readEscrowField('prize') as Promise<bigint>,
      readEscrowField('fee') as Promise<bigint>,
    ]);
    console.log(
      `Refund: ${formatExact(prize + fee, row.token_decimals)} ${row.token_symbol} (fee included) goes back to the sponsor ${to}.`,
    );
    if (!execute) {
      console.log('Dry run. Add --execute to refund the sponsor.');
      return;
    }
    const hash = await send('refund', (w) =>
      w.writeContract({
        address: escrow,
        abi: campaignAbi,
        functionName: 'refund',
      }),
    );
    if (untracked) {
      // A stray escrow was never part of the campaign: the tracked campaign is unchanged.
      console.log(
        `refunded untracked escrow ${escrow} (database unchanged): ${hash}`,
      );
      return;
    }
    await db`UPDATE sponsor_campaigns SET state = ${reason === 'takedown' ? 'taken_down' : 'refunded'} WHERE ref = ${slug}`;
    if (row.program_id)
      await db`UPDATE programs SET status = 'closed' WHERE id = ${row.program_id}`;
    console.log(`refunded: ${hash}`);
    return;
  }

  // fallback propose | execute | veto
  const escrow = row.escrow_address as `0x${string}` | null;
  if (row.state !== 'live' || !escrow)
    fail(`Campaign ${slug} isn't live (state ${row.state}).`);
  const chain = await readEscrow(escrow);
  console.log(
    `${quoted(row.draft.title)} · ${row.state} · onchain ${chain.state} · escrow ${escrow}`,
  );
  if (chain.state !== 'funded')
    fail(
      `The escrow isn't Funded onchain (chain says: ${chain.state}); run pnpm campaign sync ${slug}.`,
    );
  const readField = (
    functionName: 'endsAt' | 'AWARD_GRACE' | 'fallbackVetoed',
  ) =>
    escrowClient().readContract({
      address: escrow,
      abi: campaignAbi,
      functionName,
    });

  if (sub === 'propose') {
    if (await readField('fallbackVetoed'))
      fail(
        "The guardian vetoed the fallback on this campaign; only the sponsor's award or a refund remain.",
      );
    let picks: ReturnType<typeof parseFallbackPicks>;
    try {
      picks = parseFallbackPicks(flag('winners'), flag('split'));
    } catch (err) {
      fail((err as Error).message);
    }
    const entries = await db<{ id: number; payout_wallet: string }[]>`
      SELECT id, payout_wallet FROM projects WHERE program_id = ${row.program_id} AND payout_wallet IS NOT NULL`;
    const { prize } = splitUnits(parseUnits(row.amount, row.token_decimals));
    // A ranking gets exact shares (the remainder to first place), checked by planAward like any picks.
    const { wallets, amountsUnits, plan } = planAward({
      winners: resolvePicks(picks, {
        prizeUnits: prize,
        decimals: row.token_decimals,
        defaultReason: FALLBACK_REASON,
      }),
      entries,
      prizeUnits: prize,
      decimals: row.token_decimals,
      excluded: await excludedWinners(row, db),
    });
    await screenWinners(plan, row.chain_id);
    for (const p of plan)
      console.log(
        `  #${p.entry_id} ${p.wallet} ${p.amount} ${row.token_symbol}: ${p.reason}`,
      );
    // The escrow takes proposals only once endsAt + AWARD_GRACE (7 days) has passed.
    const [endsAt, grace, now] = await Promise.all([
      readField('endsAt') as Promise<bigint>,
      readField('AWARD_GRACE') as Promise<bigint>,
      chainNow(),
    ]);
    const notYet = fallbackProblem(BigInt(endsAt), BigInt(grace), now);
    if (!execute) {
      console.log(
        `Dry run. Add --execute to propose (operator; payable 72 hours later unless vetoed).${notYet ? ` ${notYet}` : ''}`,
      );
      return;
    }
    if (notYet) fail(notYet);
    const hash = await send('proposeFallback', (w) =>
      w.writeContract({
        address: escrow,
        abi: campaignAbi,
        functionName: 'proposeFallback',
        args: [wallets as `0x${string}`[], amountsUnits],
      }),
    );
    // Stored only once the proposal is onchain: `execute` sends exactly this list, and the award
    // is matched back to it.
    await db`UPDATE sponsor_campaigns SET fallback_plan = ${db.json(plan as never)} WHERE ref = ${slug}`;
    const { fallbackExecutesAt } = await readEscrow(escrow);
    console.log(
      `proposed: ${hash}\nExecutable from ${formatDeadline(fallbackExecutesAt!)} ` +
        '(pnpm campaign fallback execute), unless the guardian vetoes or the sponsor awards first.',
    );
    return;
  }

  if (!chain.fallbackExecutesAt)
    fail('No fallback is pending onchain for this campaign.');

  if (sub === 'veto') {
    if (!execute) {
      console.log(
        'Dry run. Add --execute to veto (guardian). After a veto the fallback is closed on this campaign.',
      );
      return;
    }
    const hash = await send('vetoFallback', (w) =>
      w.writeContract({
        address: escrow,
        abi: campaignAbi,
        functionName: 'vetoFallback',
      }),
    );
    await db`UPDATE sponsor_campaigns SET fallback_plan = NULL WHERE ref = ${slug}`;
    console.log(`vetoed: ${hash}. The fallback is closed on this campaign.`);
    return;
  }

  // execute: anyone may, once the delay has passed; this CLI signs with the operator key.
  const plan = row.fallback_plan;
  if (!plan)
    fail('EarnKit has no record of the proposed winners for this campaign.');
  const wallets = plan.map((p) => p.wallet as `0x${string}`);
  const amounts = plan.map((p) => parseUnits(p.amount, row.token_decimals));
  const hashOf = keccak256(
    encodeAbiParameters(
      [{ type: 'address[]' }, { type: 'uint256[]' }],
      [wallets, amounts],
    ),
  );
  if (hashOf !== chain.fallbackHash)
    fail(
      "The stored fallback winners differ from the onchain proposal; don't execute.",
    );
  for (const p of plan)
    console.log(
      `  #${p.entry_id} ${p.wallet} ${p.amount} ${row.token_symbol}: ${p.reason}`,
    );
  // A winner listed since the proposal: refuse to sign (the guardian should veto).
  await screenWinners(plan, row.chain_id).catch((err) =>
    fail(`${cliErrorLine(err)} Veto this fallback (guardian) instead.`),
  );
  const notYet = executeProblem(
    seconds(chain.fallbackExecutesAt),
    await chainNow(),
  );
  if (!execute) {
    console.log(
      `Dry run. Add --execute to pay these winners.${notYet ? ` ${notYet}` : ''}`,
    );
    return;
  }
  if (notYet) fail(notYet);
  const hash = await send('executeFallback', (w) =>
    w.writeContract({
      address: escrow,
      abi: campaignAbi,
      functionName: 'executeFallback',
      args: [wallets, amounts],
    }),
  );
  await checkChain(row, { fresh: true });
  console.log(
    `executed: ${hash} (database ${row.state} -> ${(await loadCampaign(slug!)).state})`,
  );
}
