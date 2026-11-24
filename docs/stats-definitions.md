# EarnKit counts: definitions (v3.8)

What each `/api/stats` count and each new `owner_people` column means. Source: `apps/frontend/lib/v5/stats.ts` and
`apps/frontend/db/schema.sql`. Plan: power-user plan v3.8 section 19 and decision 15.

**Words used below**

- **Person**: a `people` row with an installation or a builder (an EarnKit account made by GitHub sign-in).
- **Flagged**: the person has a `test_reason`: `owner`, `dogfood`, `persona`, `repro` or `test` (env lists, the owner's
  built-in logins `jenil04` and `jenilt`, client-name patterns; `lib/v6/people.ts`). **Real** means not flagged. An
  installation with no person yet counts as real.
- **Verified**: real, and `people.verified_at` is set. It is set only when GitHub's OAuth callback succeeds for that
  person's account (`markVerified`), and moves on each later sign-in. No backfill sets it. A legacy X sign-in from v4
  (`x_user_id`, `identity_source = 'x_signin_legacy'`) is **not** verified. Deleting the account clears it. Verified
  means a verified account, not a proven unique human: one person can hold two accounts.
- **Owner of an application**: its owner key's person (`b:<builder>` is the builder's person, `i:<installation>` the
  installation's).
- **Week**: the 7 days before the read.

## The ladder (each rung is inside the one above)

| Key | Counts |
|---|---|
| `installs` | Every installation row, flagged or not (raw). |
| `installs_real` | Installations whose person is not flagged (unflagged). |
| `installs_verified` | Installations whose person is verified. |
| `people` / `people_real` | People, all / not flagged. |
| `people_verified` | Verified people. |
| `people_verified_active_7d` | Verified people with an installation seen this week (an agent call). A /me visit alone does not count. |
| `people_verified_applied` | Verified people with at least one send through EarnKit (an agent's send, or a builder's send of an EarnKit draft or after an EarnKit start, as `applications_via_earnkit`). Proof of the send is not stored yet (it lands with the track changes, E9); until then a recorded send counts. |
| `people_verified_won` | Verified people with at least one recorded win (this round's or an earlier round's). No proof is stored yet (E9). |

## Real activity, applications and wins (changed meaning in v3.8)

From v3.8 these count **real owners only** (an owner, dogfood, persona, repro or test person is left out):
`installs_active_7d`, `finds_7d`, `applications`, `applications_7d`, `applications_via_earnkit`, `won`, `won_usd`,
`won_other`, `won_without_amount`. A win still counts once per repo and program, now within its class (real, owner,
each test reason), so a test win never hides a real one.

| Key | Counts |
|---|---|
| `applications_owner` | Sends (applied or any result) by the owner's own person (`test_reason = 'owner'`). |
| `won_owner` | Wins by the owner's own person, once per repo and program. |

Applications and wins are therefore split: real (`applications`, `won`) and owner (`*_owner`). Other test classes are
in neither.

## Existing identity columns on `owner_people` (unchanged)

- `identity_source`: `github_signin` (a builder is linked: they once signed in with GitHub), `x_signin_legacy` (a v4 X
  sign-in carried over by the backfill), `github_claimed` (an unproven repo owner), or NULL.
- `identity_proven`: `github_signin` or `x_signin_legacy`. It counts the legacy X backfill and any past sign-in, so it
  is **not** "verified". Use `verified_by` / `verified_at`.

## Columns appended to `owner_people` (v3.8, after `test_reason`, in this order)

| Column | Meaning |
|---|---|
| `verified_by` | `github`, or NULL when not verified. X joins with E5. |
| `verified_at` | The last fresh OAuth sign-in. |
| `client_name` | The agent or client name of the person's most recently seen installation. |
| `record_blocks_filled` | How many of the record's six blocks hold anything (about you, a project, the company, documents, traction, answers; `completeness()` in `lib/v6/record.ts`). NULL with no account. |
| `account_age_band` | Age of the verified account (GitHub's own creation date), else of the legacy X account: `under_30d`, `30d_to_1y`, `1y_to_3y`, `3y_plus`, NULL when unknown. Computed at read time. |
| `review_mark` | The owner's own hand mark on a person, set by SQL (`UPDATE people SET review_mark = ...`). NULL is unreviewed. |

`is_test` and `test_reason` (owner or a test kind) are the real-vs-test columns. The owner's row is labelled `owner`
and is in no real count.
