import './env.mts';
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, foundry } from 'viem/chains';
import {
  minScore,
  scoreEntry,
  type CampaignConfig,
} from '../lib/earnkit/campaigns';
import { sql } from '../lib/earnkit/db';

/**
 * Admin for EarnKit's own campaigns (run by Claude Code or you):
 *   pnpm campaign score  <slug>                      update every entry's score from Base data
 *   pnpm campaign rank   <slug>                      leaderboard with evidence, for review
 *   pnpm campaign payout <slug> --winners 12,7,3,... dry run: who gets what
 *   pnpm campaign payout <slug> --winners ... --execute
 *        sends the prize from PAYOUT_PRIVATE_KEY (local only, never on the server)
 *
 * Admin for sponsor campaigns (escrowed onchain; operator-only, local use):
 *   pnpm campaign sync   <ref>                        compare the DB state to the chain state
 *   pnpm campaign refund <ref> --reason no-eligible|takedown --execute
 *        refunds the sponsor from OPERATOR_PRIVATE_KEY (local only, never on the server)
 *   pnpm campaign award  <ref> --winners id:amount:reason,... --execute
 *        operator fallback award after the sponsor misses the 7-day grace period
 */
const [command, slug] = process.argv.slice(2);
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? '');
};
const db = sql();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (['award', 'refund', 'sync'].includes(command)) {
  const { loadCampaign, confirmAward } = await import('../lib/earnkit/sponsor');
  const { planAward, splitUnits } = await import('../lib/earnkit/sponsor-rules');
  const { escrowConfig, escrowClient } = await import('../lib/earnkit/escrow');
  const { campaignAbi } = await import('../lib/earnkit/escrow-abi');
  const row = await loadCampaign(slug);
  const escrow = row.escrow_address as `0x${string}`;
  if (!escrow) fail(`Campaign ${slug} isn't funded (state ${row.state}).`);
  const chainState = await escrowClient().readContract({
    address: escrow,
    abi: campaignAbi,
    functionName: 'state',
  });
  console.log(
    `${row.draft.title} · ${row.state} · onchain state ${chainState} · escrow ${escrow}`,
  );

  const signer = () => {
    const key = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
    if (!key) fail('Set OPERATOR_PRIVATE_KEY in your local shell.');
    const { chain, rpcUrl } = escrowConfig();
    const viemChain = { base, 'base-sepolia': baseSepolia, local: foundry }[chain];
    return createWalletClient({
      account: privateKeyToAccount(key),
      chain: viemChain,
      transport: http(rpcUrl),
    });
  };

  if (command === 'sync') {
    const map = ['none', 'live', 'awarded', 'refunded'] as const;
    console.log(`database: ${row.state}; chain says: ${map[Number(chainState)]}`);
  } else if (command === 'refund') {
    const reason = flag('reason');
    if (reason !== 'no-eligible' && reason !== 'takedown')
      fail('--reason no-eligible|takedown');
    if (!process.argv.includes('--execute'))
      console.log('Dry run. Add --execute to refund the sponsor.');
    else {
      const hash = await signer().writeContract({
        address: escrow,
        abi: campaignAbi,
        functionName: 'refund',
      });
      await escrowClient().waitForTransactionReceipt({ hash });
      await db`UPDATE sponsor_campaigns SET state = ${reason === 'takedown' ? 'taken_down' : 'refunded'} WHERE ref = ${slug}`;
      if (row.program_id)
        await db`UPDATE programs SET status = 'closed' WHERE id = ${row.program_id}`;
      console.log(`refunded: ${hash}`);
    }
  } else {
    // award: --winners id:amount:reason,... (fallback after the 7-day grace)
    const spec = (flag('winners') ?? '')
      .split(',')
      .filter(Boolean)
      .map((w) => {
        const [id, amount, ...reason] = w.split(':');
        return {
          entry_id: Number(id),
          amount,
          reason: reason.join(':') || 'Top entry (EarnKit fallback)',
        };
      });
    const entries = await db<{ id: number; payout_wallet: string }[]>`
      SELECT id, payout_wallet FROM projects WHERE program_id = ${row.program_id} AND payout_wallet IS NOT NULL`;
    const { prize } = splitUnits(parseUnits(row.amount, row.token_decimals));
    const { wallets, amountsUnits, plan } = planAward({
      winners: spec,
      entries,
      prizeUnits: prize,
      decimals: row.token_decimals,
    });
    for (const p of plan)
      console.log(`  #${p.entry_id} ${p.wallet} ${p.amount} ${row.token_symbol}: ${p.reason}`);
    if (!process.argv.includes('--execute'))
      console.log('Dry run. Add --execute to award (operator, after the grace period).');
    else {
      await db`UPDATE sponsor_campaigns SET award_plan = ${db.json(plan as never)} WHERE ref = ${slug}`;
      const hash = await signer().writeContract({
        address: escrow,
        abi: campaignAbi,
        functionName: 'award',
        args: [wallets as `0x${string}`[], amountsUnits],
      });
      await escrowClient().waitForTransactionReceipt({ hash });
      console.log(`awarded: ${hash}`, await confirmAward(slug, hash));
    }
  }
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
  fail('Usage: pnpm campaign <score|rank|payout> <campaign slug>');
const campaign = program.campaign;
if (campaign.kind !== 'earnkit' && (command === 'payout' || command === 'rank'))
  fail('Sponsor campaigns: use award/refund/sync (see --help).');

type Entry = {
  id: number;
  name: string;
  contracts: string[];
  payout_wallet: string;
  score: number | null;
  prize_tx: string | null;
  repo_url: string | null;
  live_url: string | null;
};
const entries = () => db<Entry[]>`
  SELECT id, name, contracts, payout_wallet, score, prize_tx, repo_url, live_url FROM projects
  WHERE program_id = ${program.id} AND contracts IS NOT NULL
  ORDER BY score DESC NULLS LAST, submitted_at`;

if (command === 'score') {
  const until = new Date(Math.min(Date.now(), program.ends_at.getTime()));
  for (const e of await entries()) {
    const r = await scoreEntry(e.contracts, program.starts_at, until);
    await db`UPDATE projects SET score = ${r.score}, scored_at = now() WHERE id = ${e.id}`;
    console.log(`${e.name}: ${r.score} wallets counted (${r.seen} seen)`);
  }
} else if (command === 'rank') {
  const list = await entries();
  console.log(
    `${program.title}: ${list.length} entries, top ${campaign.winners} win, min ${minScore(campaign)}\n`,
  );
  list.forEach((e, i) =>
    console.log(
      `#${i + 1}  id ${e.id}  ${e.name}  score ${e.score ?? '-'}${(e.score ?? 0) < minScore(campaign) ? ' (below min)' : ''}` +
        `${e.prize_tx ? `  PAID ${e.prize_tx}` : ''}\n      contracts ${e.contracts.join(', ')}  payout ${e.payout_wallet}` +
        `\n      ${[e.live_url, e.repo_url].filter(Boolean).join('  ')}`,
    ),
  );
} else if (command === 'payout') {
  // Guarded above for non-'earnkit' kinds; re-checked here so TS narrows `campaign` below.
  if (campaign.kind !== 'earnkit')
    fail('Sponsor campaigns: use award/refund/sync (see --help).');
  const ids = (flag('winners') ?? '').split(',').map(Number).filter(Boolean);
  if (ids.length === 0)
    fail('Name the approved winners: --winners <project id>,<project id>,...');
  if (ids.length > campaign.winners)
    fail(`This campaign has ${campaign.winners} winners; got ${ids.length}.`);
  if (Date.now() < program.ends_at.getTime())
    fail(`The campaign runs until ${program.ends_at.toISOString()}.`);

  const all = await entries();
  const winners = ids.map(
    (id) =>
      all.find((e) => e.id === id) ??
      fail(`Project ${id} isn't an entry in ${program.id}.`),
  );
  for (const w of winners) {
    if ((w.score ?? 0) < minScore(campaign))
      fail(
        `${w.name} scored ${w.score ?? 0}, below the minimum ${minScore(campaign)}.`,
      );
    if (w.prize_tx) fail(`${w.name} was already paid: ${w.prize_tx}`);
  }

  const amount = parseUnits(campaign.amount_each, campaign.prize.decimals);
  const token = campaign.prize.token as `0x${string}`;
  const reader = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL),
  });
  console.log(
    `Paying ${campaign.amount_each} ${campaign.prize.symbol} each on Base:`,
  );
  for (const w of winners)
    console.log(`  id ${w.id} ${w.name} → ${w.payout_wallet}`);

  if (!process.argv.includes('--execute')) {
    console.log('\nDry run. Add --execute to send.');
  } else {
    const key = process.env.PAYOUT_PRIVATE_KEY as `0x${string}` | undefined;
    if (!key)
      fail(
        'Set PAYOUT_PRIVATE_KEY in your local shell (the wallet holding the prize).',
      );
    const account = privateKeyToAccount(key);
    const balance = await reader.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    });
    if (balance < amount * BigInt(winners.length))
      fail(`${account.address} doesn't hold enough ${campaign.prize.symbol}.`);
    const wallet = createWalletClient({
      account,
      chain: base,
      transport: http(process.env.BASE_RPC_URL),
    });
    for (const w of winners) {
      const hash = await wallet.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [w.payout_wallet as `0x${string}`, amount],
      });
      const receipt = await reader.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success')
        fail(`Transfer to ${w.name} failed: ${hash}`);
      await db`UPDATE projects SET prize_tx = ${hash}, prize_paid_at = now(), prize_amount = ${campaign.amount_each} WHERE id = ${w.id}`;
      console.log(`  paid ${w.name}: ${hash}`);
    }
  }
} else {
  fail('Usage: pnpm campaign <score|rank|payout> <campaign slug>');
}
await db.end();
