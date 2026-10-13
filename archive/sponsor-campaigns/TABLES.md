# Sponsor campaign tables (kept, commented `archived v2.12`, no writes while the flag is off)

Rows stay. Nothing is dropped.

## sponsor_campaigns

One row per sponsor campaign, keyed by `ref` (0x hash from create).

| Column | Meaning |
|---|---|
| `ref` | The campaign's id, from create |
| `installation_id` | The agent that created it (moved to the group root when installations link) |
| `state` | draft, live, awarded, refunded, expired, replaced or taken_down |
| `program_id` | The program row created when the campaign went live |
| `draft` | The sponsor's inputs (title, what to build, amount, winners, dates) as JSON |
| `sponsor_url`, `sponsor_wallet` | The sponsor's site and the wallet that funds the escrow |
| `escrow_address`, `chain_id` | The escrow contract and its chain |
| `award_plan`, `award_source`, `award_tx`, `award_onchain`, `award_winners`, `awarded_at` | How the award was planned and paid |
| `fallback_plan` | The operator's fallback payout plan, when set |
| `replaced_by` | The ref that corrected this draft |
| `created_at` | When the draft was made |

## sponsor_verifications

A cache of the earnkit.txt domain check per (`host`, `wallet`): `verified`, `checked_at`, `note`. A pass lasts 24 h, a failure 1 h.

## chain_checks

Rate-limit bookkeeping for the check route and status reads (who read the chain, when).
