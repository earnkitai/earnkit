# EarnKit

Monetization platform for AI agents. Developers register an agent, configure
pricing (free tier or credit-based), and ship. End users pay on Base; credits
land in their balance; developers withdraw to any wallet.

## Repo layout

```
apps/
  earn-backend/     API server (track/capture/release, top-up, payment intents,
                    verification worker). Read PAYMENTS.md before changing
                    money-handling code.
  dashboard/        Next.js dev dashboard. Mints EIP-712 withdrawal sigs.
  contracts/        EarnKitEscrow.sol — per-agent ETH + ERC-20 custody.
  packages/earn/    The @earnkit/earn npm SDK (TypeScript).
  agent-backend/    Agent runtime (separate concern from billing).
  earny-app/, earny-home/, blogs/, frontend/   Marketing + apps.
scripts/            One-shot operational scripts. All take secrets via env.
```

## Where to start

| If you're… | Read |
|---|---|
| Integrating the SDK | [`apps/packages/earn/README.md`](apps/packages/earn/README.md) |
| Touching anything that moves money | **[`apps/earn-backend/PAYMENTS.md`](apps/earn-backend/PAYMENTS.md)** |
| Working on the API server | [`apps/earn-backend/README.md`](apps/earn-backend/README.md) |
| Working on the dashboard | [`apps/dashboard/README.md`](apps/dashboard/README.md) |
| Deploying / configuring envs | [`apps/DEPLOY.md`](apps/DEPLOY.md) |
| Reading the on-chain logic | [`apps/contracts/contracts/EarnKitEscrow.sol`](apps/contracts/contracts/EarnKitEscrow.sol) |

## Local setup

```bash
pnpm install
pnpm --filter earn-backend dev    # API on :3000
pnpm --filter dashboard   dev     # UI  on :3000 (separate terminal/port)
```

`.env` files are not committed. Copy from `apps/DEPLOY.md`'s reference block.

## Hard rules for money-handling code

These come up over and over. Every one has hit production at least once.

1. **Never** hardcode an ETH price fallback (`ethPrice = 3000` etc.). If the
   feed is down, fail-closed.
2. **Never** add a second escrow address default in a new file. The live
   address is `0xCAeB6A62D04C52E1e196E5Bdce63e43f45582aA2`. Any other value
   in the codebase is stale.
3. **Never** recompute historical earnings from a live ETH price. Use the
   `amountInUSD` captured at verify time.
4. **Always** use atomic Prisma operations (`increment`, `decrement` with a
   guarded `where`) when crediting or deducting balances. Read-then-write is
   a money bug.
5. **Always** guard credit-granting with a conditional status update so a
   re-run can't double-credit.
6. **Never** commit secrets — DB URLs, private keys, plaintext API keys.
   `scripts/` reads everything from env for this reason.

If a change you're making seems to require breaking one of these rules, stop
and ask in PR review.
