# Programs

One file per program that pays builders for software: `programs/<slug>.json`. The format is
`apps/frontend/lib/v5/program-file.ts` (`ProgramFile`); unknown keys are dropped.

```sh
pnpm programs:check    # validate every file
pnpm programs:sync     # validate, then write every file to the database (runs before each deploy)
```

Push to `main` to publish. Files are the owner's override: a file wins over an API row with the
same id. The other source is the programs write API (`POST /api/programs/write`,
`docs/programs-api.md`), which the research bot uses; its rows carry `source: "api"`.

## Which programs

Any program that pays builders for software, on any chain or none: ecosystem grants, hackathons,
accelerators, open-source funds, platform developer funds. There is no chain allowlist. `chains`
takes any slug registered in `apps/frontend/lib/v5/chains.ts` (`base`, `arc`, `tempo`, `monad`,
`robinhood`, `avalanche`, `arbitrum`, `ethereum`, `optimism`, `polygon`, `solana`); a new chain is
added there by the owner first. A program tied to no chain sets `"any_chain": true` and lists none.

## Adding a program

Read the official pages (overview, rules, FAQ and the form itself). Write only what the source
states; leave out what it does not. Never guess a reward, a deadline or a requirement.

| Field | What goes in it |
|---|---|
| `id` | lowercase slug; the file is `<id>.json` |
| `organizer`, `title`, `description` | as the source names and describes it |
| `source_url`, `submission_url` | the program page and where builders apply; `official_url` when the organizer's site is neither |
| `reward` | the reward in the source's words |
| `summary` | one line, at most 90 characters: reward and deadline (`"Up to $5,000 · rolling"`) |
| `max_award_usd` | the most one winner gets, only when stated; `min_award_usd` only for a stated range |
| `pool_usd` | the total pool, only when stated; `reward` must state it followed by a pool word (`"$840,000 in prizes"`); `pool_source_url` when that is not `source_url` |
| `starts_at`, `ends_at` | ISO 8601 with offset; `ends_at: null` is rolling. `tz` (IANA) when the summary's suffix does not name the zone |
| `status` | `active`, `upcoming` (needs `opens_note`: one line, no links) or `closed` |
| `verified_at` | the day the facts were checked (`YYYY-MM-DD`), never ahead of today |
| `existing_work` | `allowed`, `new_work_only` or `unknown` |
| `needs_repo` | whether entering needs a repo or a live product |
| `chains`, `any_chain` | registered chain slugs, or `any_chain: true` and none |
| `chain_required` | `true` only when the source requires one of `chains` at the project's core |
| `needs_contract` | a chain (one of `chains`) where a deployed mainnet contract is required |
| `tag` | `"long shot"` or `"needs a live product"` |
| `in_person`, `investment`, `category` | attended in person; the award is an investment; `grant`, `hackathon`, `investment` or `bounty` (derived when left out) |
| `setup`, `each_time` | what only the builder can do once, and for every entry |
| `rules` | the program's rules in short sentences (shown in the guide) |
| `submission_requirements` | the form, field by field (below); none only on an `upcoming` program |
| `submit` | who submits: `agent`, `builder` (needs the builder's own click) or `either` (default) |
| `sign_in` | what the form asks the builder to sign in with: `none` (default), `google`, `github`, `email` or `platform` |
| `platform_name` | the platform's name (1 to 60 characters); required with `sign_in: platform`, refused otherwise |
| `needs` | extra material beyond the form's fields: `founder_video`, `demo_video`, `resume`, `deck`, `pitch_pdf` |
| `min_tier` | the lowest standing of work the source accepts: `used`, `live` or `building`; leave out when it states none |
| `prefers` | up to 10 integration keys (`lib/v6/integrations.ts`) or chain slugs the source says it favors |
| `reviewers_contact` | owner only, 1 to 200 characters: where a reviewer is reached; never listed, guided or replied |
| `logo`, `focus`, `past_rounds`, `best_bet`, `ideas`, `winners_per_round` | guide facts, each with its source; never invented |

### `submission_requirements`

One item per form field: `key` (snake_case), `label` (the question as asked), `type` (`text`,
`url`, `email`, `choice` or `multi_choice` with `options`, `file`), `required`, `from` (`project`:
drafted from the project; `builder`: only the builder can answer) and `kind` (`name`,
`one_liner`, `problem`, `solution`, `how_it_works`, `traction`, `team`, `why_you`,
`use_of_funds`, `milestones`, `competitors`, `risks`, `ecosystem_fit`, `what_next`, `past_work`,
`help_needed`, `demo_video`, `links`, `contact`, `raised`, `other`). A required item
also needs `todo`: a short builder to-do, lowercase start, at most 40 characters, no trailing
punctuation or links (`"a live link on Arc mainnet"`). Optional: `description`, `project_field`,
`max_chars` (only a stated limit), `guidance` (the program's own advice, with `source_url`).

### `eligibility`

What EarnKit can check before a builder applies. Optional: when left out it is derived
(`tag: "needs a live product"` gives `live_product`; each chain of a `chain_required` program
gives `chain`, any one of which satisfies; `needs_contract` gives `contract_on`; `new_work_only`
with `starts_at` gives `new_work_after`; `in_person` gives `in_person`). Set it when the source
states something the fields above cannot say:

```json
"eligibility": [
  { "kind": "live_product" },
  { "kind": "chain", "value": "base" },
  { "kind": "users", "note": "at least 100 monthly users" }
]
```

Kinds: `live_product`, `chain`, `contract_on`, `builder_codes`, `users`, `new_work_after`,
`demo_video`, `in_person`, `feature`, `integration`. `value` (a chain slug, a date or, for `integration`, an integration key like `smart_wallet`) and `note` (at most 140
characters) are optional.

### `form`

The application form, so a draft can be pre-filled: `platform` (`google`, `airtable`, `tally`,
`typeform` or `other`), and when readable, `url` (the full form link) and `fields` (requirement
key to the form's field id, e.g. `"email": "entry.567744978"` for Google). Every `fields` key is a
`submission_requirements` key. A platform that exposes no ids gets `platform` only.

### `results_due`

When results are announced: `{ "date": "YYYY-MM-DD" }`, or `{ "weeks_after_close": 4 }` for a
rolling program. Only when the source says.

## Keeping programs fresh

In-person programs: close the file (`"status": "closed"`) once the attend-by date passes, even if the hackathon's own end date is later.

A daily probe reads every program's `source_url` and `submission_url`. A link that fails two days
running marks the program stale; an open list leaves out a program stale for more than 14 days, and
an API program not verified in 14 days. A passed `ends_at` closes an active program (the probe does
it daily, and `pnpm programs:sync` writes an active file past its `ends_at` as closed, with a warning
that `pnpm programs:check` prints too; set `"status": "closed"` in the file). A source page counts as
changed when fewer than 80% of its words (lowercased, deduplicated) are shared with the text stored
the day before; a change is listed in the owner's daily digest to re-read, and never marks the
program stale. To re-verify a file program, re-read its source, update what changed and
`verified_at`, run `pnpm programs:check` and push.
