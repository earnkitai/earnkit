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
import {
  USAGE,
  cliErrorLine,
  fallbackProblem,
  operatorKeyProblem,
} from '../lib/earnkit/cli';
import { formatDeadline } from '../lib/earnkit/dates';
import { sql } from '../lib/earnkit/db';

/**
 * Admin for EarnKit's own campaigns (score|rank|payout <slug>) and for sponsor campaigns
 * (award|refund|sync <ref>; operator-only, local use). `pnpm campaign --help` lists every command
 * (lib/earnkit/cli.ts USAGE). Signing keys (PAYOUT_PRIVATE_KEY, OPERATOR_PRIVATE_KEY) live only in
 * the local shell, never on the server. Every error ends as one readable line and exit code 1.
 */
const [command, slug] = process.argv.slice(2);
const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? '');
};
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const COMMANDS = ['score', 'rank', 'payout', 'award', 'refund', 'sync'];
if (!command || ['help', '--help', '-h'].includes(command)) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}
if (!COMMANDS.includes(command))
  fail(`Unknown command "${command}".\n\n${USAGE}`);
if (!slug)
  fail(
    `pnpm campaign ${command} needs a campaign ${['score', 'rank', 'payout'].includes(command) ? 'slug' : 'ref'}.\n\n${USAGE}`,
  );

// Set inside the try, so a missing DATABASE_URL is a readable line too.
let db!: ReturnType<typeof sql>;
try {
  db = sql();
  await main();
} catch (err) {
  // One readable line, never a stack trace (the operator reads this, not a developer).
  fail(cliErrorLine(err));
}

async function main() {
  if (['award', 'refund', 'sync'].includes(command)) {
    const { loadCampaign, confirmAward, confirmTx } = await import(
      '../lib/earnkit/sponsor'
    );
    const { planAward, splitUnits } = await import(
      '../lib/earnkit/sponsor-rules'
    );
    const { escrowConfig, escrowClient } = await import(
      '../lib/earnkit/escrow'
    );
    const { campaignAbi, campaignsAbi } = await import(
      '../lib/earnkit/escrow-abi'
    );
    const { formatExact } = await import('../lib/earnkit/format-units');
    const { isAddress } = await import('viem');
    const STATES = ['none', 'live', 'awarded', 'refunded'] as const;
    const chainStateOf = async (address: `0x${string}`) =>
      STATES[
        Number(
          await escrowClient().readContract({
            address,
            abi: campaignAbi,
            functionName: 'state',
          }),
        )
      ];
    // Signing needs a well-formed key; check it before reading anything else.
    const execute = process.argv.includes('--execute');
    if (execute && command !== 'sync') {
      const problem = operatorKeyProblem(process.env.OPERATOR_PRIVATE_KEY);
      if (problem) fail(problem);
    }
    let row = await loadCampaign(slug);

    if (command === 'sync') {
      // sync <ref> --tx <hash>: repair. Confirms that funding (including the rescue of a funded
      // draft that lazily expired) or award transaction exactly as the status tool would, then
      // prints the DB vs chain state like plain sync.
      const tx = flag('tx');
      if (tx !== undefined) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(tx))
          fail('--tx must be a transaction hash');
        const before = row.state;
        const result = await confirmTx(slug, tx as `0x${string}`).catch((err) =>
          fail(`sync --tx: ${cliErrorLine(err)}`),
        );
        row = await loadCampaign(slug);
        console.log(
          `repaired: ${result.confirmed} confirmed (database ${before} -> ${row.state})`,
          JSON.stringify(result),
        );
      }
      if (!row.escrow_address) {
        console.log(
          `${row.draft.title} · ${row.state} · no escrow recorded\n` +
            `database: ${row.state}; chain says: unknown (pass --tx <funding hash> to confirm a deposit)`,
        );
        await db.end();
        process.exit(0);
      }
    }

    // refund --escrow <address>: refund a specific escrow for this ref, e.g. a second deposit made
    // for an already-funded draft from another wallet (refs are unique per sender onchain). It must
    // be a clone of our factory that the factory records for this ref.
    const escrowFlag = command === 'refund' ? flag('escrow') : undefined;
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
    const chainState = await chainStateOf(escrow);
    console.log(
      `${row.draft.title} · ${row.state} · onchain state ${STATES.indexOf(chainState)} · escrow ${escrow}`,
    );

    const signer = () => {
      const key = process.env.OPERATOR_PRIVATE_KEY;
      const problem = operatorKeyProblem(key);
      if (problem) fail(problem);
      const { chain, rpcUrl } = escrowConfig();
      const viemChain = { base, 'base-sepolia': baseSepolia, local: foundry }[
        chain
      ];
      return createWalletClient({
        account: privateKeyToAccount(key as `0x${string}`),
        chain: viemChain,
        transport: http(rpcUrl),
      });
    };

    if (command === 'sync') {
      console.log(`database: ${row.state}; chain says: ${chainState}`);
    } else if (command === 'refund') {
      const reason = flag('reason');
      if (reason !== 'no-eligible' && reason !== 'takedown')
        fail('--reason no-eligible|takedown');
      // Only a Funded escrow can be refunded; say who gets the money before anything is signed.
      if (chainState !== 'live')
        fail(
          `The escrow isn't Funded onchain (chain says: ${chainState}); nothing to refund.`,
        );
      const readEscrow = (functionName: 'sponsor' | 'prize' | 'fee') =>
        escrowClient().readContract({
          address: escrow,
          abi: campaignAbi,
          functionName,
        });
      const [to, prize, fee] = await Promise.all([
        readEscrow('sponsor') as Promise<string>,
        readEscrow('prize') as Promise<bigint>,
        readEscrow('fee') as Promise<bigint>,
      ]);
      console.log(
        `Refund: ${formatExact(prize + fee, row.token_decimals)} ${row.token_symbol} (fee included) goes back to the sponsor ${to}.`,
      );
      if (!execute)
        console.log('Dry run. Add --execute to refund the sponsor.');
      else {
        const hash = await signer().writeContract({
          address: escrow,
          abi: campaignAbi,
          functionName: 'refund',
        });
        const receipt = await escrowClient().waitForTransactionReceipt({
          hash,
        });
        if (receipt.status !== 'success') fail(`refund reverted: ${hash}`);
        if (untracked) {
          // A second deposit was never part of the campaign: the tracked campaign is unchanged.
          console.log(
            `refunded untracked escrow ${escrow} (database unchanged): ${hash}`,
          );
        } else {
          await db`UPDATE sponsor_campaigns SET state = ${reason === 'takedown' ? 'taken_down' : 'refunded'} WHERE ref = ${slug}`;
          if (row.program_id)
            await db`UPDATE programs SET status = 'closed' WHERE id = ${row.program_id}`;
          console.log(`refunded: ${hash}`);
        }
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
        console.log(
          `  #${p.entry_id} ${p.wallet} ${p.amount} ${row.token_symbol}: ${p.reason}`,
        );
      if (chainState !== 'live')
        fail(
          `The escrow isn't Funded onchain (chain says: ${chainState}); nothing to award.`,
        );
      // The escrow lets the operator award only once endsAt + AWARD_GRACE (7 days) has passed.
      const [endsAt, grace, block] = await Promise.all([
        escrowClient().readContract({
          address: escrow,
          abi: campaignAbi,
          functionName: 'endsAt',
        }),
        escrowClient().readContract({
          address: escrow,
          abi: campaignAbi,
          functionName: 'AWARD_GRACE',
        }),
        escrowClient().getBlock(),
      ]);
      const notYet = fallbackProblem(
        BigInt(endsAt as bigint),
        BigInt(grace as bigint),
        block.timestamp,
      );
      if (!execute)
        console.log(
          `Dry run. Add --execute to award (operator, after the grace period).${notYet ? ` ${notYet}` : ''}`,
        );
      else if (notYet) fail(notYet);
      else {
        // 1. planAward already validated the winners above. 2. Build the signer now, so a missing
        // OPERATOR_PRIVATE_KEY fails before anything is sent or stored. 3-4. Send the tx and require
        // a successful receipt. 5. Only then persist the plan and record via confirmAward — the
        // sponsor's stored plan must never be overwritten by a tx that never lands.
        const wallet = signer();
        const hash = await wallet.writeContract({
          address: escrow,
          abi: campaignAbi,
          functionName: 'award',
          args: [wallets as `0x${string}`[], amountsUnits],
        });
        const receipt = await escrowClient().waitForTransactionReceipt({
          hash,
        });
        if (receipt.status !== 'success') fail(`award reverted: ${hash}`);
        await db`UPDATE sponsor_campaigns SET award_plan = ${db.json(plan as never)} WHERE ref = ${slug}`;
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
    fail(`No campaign program "${slug}". Run pnpm campaign --help.`);
  const campaign = program.campaign;
  if (
    campaign.kind !== 'earnkit' &&
    (command === 'payout' || command === 'rank')
  )
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
      fail(
        'Name the approved winners: --winners <project id>,<project id>,...',
      );
    if (ids.length > campaign.winners)
      fail(`This campaign has ${campaign.winners} winners; got ${ids.length}.`);
    if (Date.now() < program.ends_at.getTime())
      fail(`The campaign runs until ${formatDeadline(program.ends_at)}.`);

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
        fail(
          `${account.address} doesn't hold enough ${campaign.prize.symbol}.`,
        );
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
    fail(USAGE);
  }
  await db.end();
}
