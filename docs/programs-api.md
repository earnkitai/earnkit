# EarnKit programs API (for the Grok Bot)

The owner pastes this into the Grok Bot's instructions. The bot researches programs that pay builders for software and writes them to EarnKit. A write that passes every check is live at once: on the site, in `GET /api/programs` and in every builder's agent. One exception: a new program, or a write that changes `submission_url`, `chains`, `form` or `pool_source_url`, goes live only when its links check out (see "Link check"). Otherwise it waits for the owner's one-click approval.

## Owner setup (once)

Run this in your own terminal (not in a Claude session). It prints the token once, then sets it on Railway:

```
T=$(openssl rand -hex 32); echo "$T"; railway variables --project ae726253-edb5-4c47-b308-854be7cf36b1 --service earnkit --environment production --set "EARNKIT_PROGRAMS_TOKEN=$T"
```

Paste the printed token into the Grok Bot as `EARNKIT_PROGRAMS_TOKEN`. Without the token (or with `EARNKIT_PROGRAMS_API=off`) the write, log and approve routes answer 404. Approve and revert links need `EARNKIT_AUTH_SECRET`; the owner's emails need `RESEND_API_KEY`.

## What to research

- Any program that pays builders for software: grants, hackathons, bounties, accelerators and investment programs, on any chain or none (open-source funds and platform developer funds count).
- The owner's thesis chains first: Base, Arc, Tempo, Monad, Robinhood Chain. Then everything else. Optimism programs are allowed.
- Sweep these sources every week: ecosystem grant pages (each chain's own grants and builders pages), Questbook, Gitcoin, DoraHacks, Devfolio, ETHGlobal, Superteam, HackQuest, Karma GAP, Buidlbox, a16z (speedrun and crypto startup school), YC, Alliance, and platform developer funds.

Rules (from `programs/README.md`):

- Use only the program's official pages: overview, rules, FAQ and the form itself.
- Never guess. If the source doesn't state a fact, leave the field out (or `null`). Never estimate a reward, a pool or a deadline.
- Mirror the real form field by field in `submission_requirements`. When the form is a Google Form, read its entry ids from the form page and send them in `form.fields`.
- Set `verified_at` to the day you read the source.
- Re-check every program you wrote at least once a week and write it again (a write's `verified_at` must be within the last 7 days). A program not re-checked for 14 days drops off EarnKit's lists until you write it again. EarnKit also probes every program's links daily; a program whose link stays dead is flagged stale.

## The routes

All bodies are JSON. Base URL: `https://earnkit.com`.

| Route | Auth | What it does |
|---|---|---|
| `POST /api/programs/write` | `Authorization: Bearer <token>` | Add, update or close one program |
| `GET /api/programs` | none | What is listed now. `?category=grant\|hackathon\|investment\|bounty`, `?status=active\|upcoming` |
| `GET /api/programs/writes` | `Authorization: Bearer <token>` | Your last 100 writes: `{ at, program_id, action, result, reason }`, and `pending`: the writes waiting for the owner `{ at, program_id, reason, title, submission_url, source_url, expires_at }` |

`GET /api/programs` returns up to 200 programs: `{ id, title, organizer, category, chains, any_chain, money, status, closes_at, closes_in, source_url, submission_url, source }`. Sorted by category, then soonest close (rolling last), then the larger award. `source` is `file` (curated by the owner) or `api` (yours). It is cached for up to a minute.

Write limits: 120 writes an hour, 256 KB a body.

## Add or update a program

```
POST /api/programs/write
{ "action": "upsert", "program": { ...the program... } }
```

Same id again updates it. A body identical to what is stored answers `unchanged`.

Success: `{ "ok": true, "id": "...", "result": "created" | "updated" | "unchanged", "category": "grant", "live": true }`. `live` is true while the program is upcoming, or active and not past `ends_at`.

Waiting for the owner (202): `{ "ok": true, "id": "...", "result": "pending", "category": "grant", "live": false, "reason": "...", "owner_emailed": true }`. Nothing changed yet: a new program is not listed, and a live program keeps its current link, chains and form. The owner gets one email and approves it within 7 days. Sending the same body again stays one pending write and never emails twice. If `owner_emailed` is `false`, the email didn't go: send the same write again later (at most once an hour) to retry it.

### Link check

These writes wait for approval unless every link builders are sent to (`submission_url`, `form.url`, `pool_source_url`) checks out:

- a new program;
- a change to `submission_url`;
- a change to `chains`;
- a change to `form` (adding it, or changing its platform, url or field ids);
- a change to `pool_source_url`;
- a change to `submit`, `sign_in` or `min_tier` on a live program (held for the owner whatever the links).

A link checks out when it is on the site of a live program the owner curated for one of its `chains` (a program with `chains: []`: the curated any-chain programs). Those are the owner's own program files, and API programs whose current link the owner approved. Same site means the same domain: `docs.base.org` and `www.base.org` are on `base.org`; `base-grants.org` and `base.org.example.com` are not.

`official_url` (optional) is the organizer's own home page (`https://www.base.org/`). It is a hint: it counts when it is itself on a curated site. It is refused on a shared, hosting or platform host (`evil.vercel.app`, `github.io`, `forms.gle`).

A link on a form, submit, hosting or shared platform (Google Forms, Typeform, Tally, Airtable, Questbook, DoraHacks, Devfolio, HackQuest, ETHGlobal, Buidlbox, Gitcoin, Superteam, Karma GAP, Taikai, Akindo, github.io, vercel.app, notion.site and the like) never checks out on its own: those programs always wait for the owner once.

Any other change to a live program (reward, amounts, deadline, text, requirements, eligibility, past rounds) is live at once. The owner gets one email a day listing the day's changes, each with a revert link. A revert puts the program back as it was before that write (or closes it, if that write created it; or re-opens it, if that write closed it). Only a program's latest change can be reverted. A revert shows in `GET /api/programs/writes` as action `revert`.

### Fields you can send

Every program field except `logo` and `reviewers_contact` (the owner adds logos by file). Any other field is refused: `logo: the API can't set logo; the owner adds it by file`, `<field>: not a program field`.

**Required:** `id`, `organizer`, `title`, `description`, `source_url`, `submission_url`, `reward`, `summary`, `starts_at`, `ends_at`, `status`, `verified_at`, `existing_work`, `chains`, `rules`, `setup`, `each_time`, `submission_requirements`. Always send `category` and `needs_repo` too.

**Optional:** `official_url`, `max_award_usd`, `min_award_usd`, `pool_usd`, `pool_source_url`, `category`, `tag`, `tz`, `opens_note`, `any_chain`, `chain_required`, `investment`, `in_person`, `needs_repo`, `needs_contract`, `min_product_score`, `wants_revenue`, `winners_per_round`, `ideas`, `eligibility`, `form`, `results_due`, `focus`, `past_rounds`, `best_bet`, `submit`, `sign_in`, `platform_name`, `needs`, `min_tier`, `prefers`.

**Each `submission_requirements` item:** `key`, `label`, `type`, `required`, `from`, `kind`, and `todo` on every required item; optional `options`, `description`, `project_field`, `max_chars`, `guidance`.

Key values:

- `id`: 3 to 64 lowercase letters, digits or dashes (`monad-builder-grants`).
- `category`: `grant`, `hackathon`, `investment` or `bounty`.
- `status`: `active`, `upcoming` (needs `opens_note`) or `closed`.
- `chains`: chain slugs from EarnKit's registry: `base`, `arc`, `tempo`, `monad`, `robinhood`, `avalanche`, `arbitrum`, `ethereum`, `optimism`, `polygon`, `solana`. `[]` only with `any_chain: true`. A program on a chain not in the list: ask the owner to add the chain first.
- `chain_required`: `true` when the source requires one of `chains` at the project's core.
- `needs_contract`: one of `chains`, when a deployed mainnet contract there is required.
- `existing_work`: `allowed`, `new_work_only` or `unknown`.
- `ends_at`: ISO 8601 with a zone, or `null` for rolling. An active program's `ends_at` must be in the future.
- `verified_at`: `YYYY-MM-DD`, at most 7 days ago, never in the future.
- `summary`: reward and deadline as the organizer states them: `"up to $5,000 · rolling"`, `"500 USDC x 20 grants · closes Oct 14, 11:59 PM ET"`.
- `reward` with `pool_usd`: must state the same amount followed by a pool word (`$840,000 in prizes`).
- `eligibility`: up to 10 items `{ kind, value?, note? }`, `kind` one of `live_product`, `chain` (value: a chain slug), `contract_on` (value: a chain slug), `builder_codes`, `users`, `new_work_after` (value: a date), `demo_video`, `in_person`, `feature`, `integration` (value: an integration key such as `smart_wallet`). Only what the source states.
- `form`: `{ platform, url?, fields? }`. `platform` is `google`, `airtable`, `tally`, `typeform` or `other`; `url` is the form's https link; `fields` maps a requirement `key` to the form's field id (`{ "project_name": "entry.123456" }`). Every key in `fields` must be a `submission_requirements` key.
- `submit`: `agent`, `builder` or `either` (default).
- `sign_in`: `none` (default), `google`, `github`, `email` or `platform`; `platform` needs `platform_name` (1 to 60 characters), any other value refuses it.
- `needs`: any of `founder_video`, `demo_video`, `resume`, `deck`, `pitch_pdf`.
- `min_tier`: `used`, `live` or `building`; send it only when the source states the bar.
- `prefers`: up to 10 integration keys or chain slugs the source says it favors.
- `results_due`: `{ date }` (`YYYY-MM-DD`) or `{ weeks_after_close }`, when the source says when results come.
- `focus`: `{ areas: [1 to 3 short phrases], source_url, ecosystem? }`, what the program says it wants.
- `past_rounds`: up to 5 `{ label, source_url, own?, submissions?, winners?, themes?, themes_of?, examples? }` from published results.
- `best_bet`: 1 to 12 words, drawn from `past_rounds` or `focus`.
- Requirement `type`: `text`, `url`, `email`, `choice` or `multi_choice` (both need `options`), `file`.
- Requirement `from`: `project` (the agent can draft it) or `builder` (personal info, consent, amounts).
- Requirement `kind` (on every item): `name`, `one_liner`, `problem`, `solution`, `how_it_works`, `traction`, `team`, `why_you`, `use_of_funds`, `milestones`, `competitors`, `risks`, `ecosystem_fit`, `what_next`, `past_work`, `help_needed`, `demo_video`, `links`, `contact`, `raised`, `other`.
- Requirement `todo` (on every required item): lowercase start, at most 40 characters, no final punctuation, no links.
- Requirement `guidance`: `{ judges?, questions? (up to 2), pattern?, limit_words?, source_url }`, only from the program's own pages.

### Limits

| Field | Limit |
|---|---|
| `title` | at most 120 characters |
| `organizer` | at most 80 characters |
| `summary` | at most 90 characters |
| `setup`, `each_time` | each item 1 to 80 characters |
| `ideas` | at most 3 items, each 3 to 12 words, no links |
| `opens_note` | at most 140 characters, no links, no em dashes; only with `upcoming` |
| `tag` | `long shot` or `needs a live product` |
| `tz` | an IANA zone (`America/Los_Angeles`) |
| `min_product_score` | a whole number from 0 to 6 |
| `max_award_usd`, `min_award_usd` | a positive number, at most 5,000,000 |
| `pool_usd` | a positive number, at most 50,000,000 |
| `min_award_usd` | only with a larger `max_award_usd`, and stated in `reward` |
| `pool_source_url` | only with `pool_usd` |
| requirement `key` | snake_case, unique in the program |
| requirement `max_chars` | a positive whole number (the form's stated limit) |
| `submission_requirements` | at least one item (an upcoming program may have none) |
| any text field | at most 4,096 characters |
| `starts_at` | before `ends_at` when both are set |

Amounts above the caps are refused with `larger amounts need a curated file`: tell the owner instead.

### Text rules (every text field, including requirement, eligibility, past round and focus text)

- One line in every field except `description`, `rules` items and requirement `description`: no line breaks, tabs or control characters.
- Plain words only. No links, URLs, `www.` or bare domains (`evil.com`, `evil[.]com`), no markdown links, no `<` or `>`.
- Normalized plain text: no full-width letters, no `…` (write `...`), no hidden, zero-width, bidi or control characters. Newlines and tabs only in `description`, `rules` items and a requirement's `description`; every other text field is one line.

### URL rules (every URL field: `source_url`, `submission_url`, `official_url`, `pool_source_url`, `form.url`, and the `source_url` of `focus`, `past_rounds`, their examples and requirement `guidance`)

- `https://` only, a domain name (no IP address, no trailing dot), at most 2,048 characters.
- Printable ASCII only, no spaces, no `#` fragment, no `user:pass@`, no `[` or `]`. Percent-encode anything else.
- Send the normalized form: lowercase host, and a `/` after a bare host (`https://org.com/`, not `https://Org.com`).
- The links builders are sent to (`submission_url`, `pool_source_url`, `form.url`) must be on the same site as `source_url`, or on a submit platform: Google Forms (`docs.google.com/forms`, `forms.gle`), Typeform, Tally, Airtable, DoraHacks, Questbook, Devfolio, ETHGlobal, HackQuest, Buidlbox, Gitcoin, Superteam, Karma GAP, Taikai, Akindo. On a shared host (github.io, vercel.app, notion.site and the like) only the exact same host counts, and never on github.com, x.com, medium.com and other sites where owners differ by path.
- `source_url` and `submission_url` must load. A login wall or bot wall (401, 403, 429) is fine; 404, 5xx and timeouts are refused.
- If a program's real form is on a host the API refuses, skip that program and report it to the owner; never send a different URL than the program's own form.

### Full example

This is the committed `base-builder-grants` file, plus `official_url`. That id is curated, so sending it exactly answers 409. Under a new id it answers `pending`, because its form is on `forms.gle`. Use your program's own id and facts.

```json
{
  "action": "upsert",
  "program": {
    "id": "base-builder-grants",
    "organizer": "Base",
    "title": "Base Builder Grant Program",
    "description": "Grants of up to $5,000, plus GTM and product support, for teams actively building on Base with a live product that is getting used. Reviewed in cohorts.",
    "source_url": "https://docs.base.org/get-started/builders",
    "submission_url": "https://forms.gle/urqjBJYJjR6Vqqre6",
    "official_url": "https://www.base.org/",
    "reward": "Up to $5,000 in grants, plus GTM and product support",
    "summary": "up to $5,000 · rolling",
    "max_award_usd": 5000,
    "category": "grant",
    "tag": "needs a live product",
    "starts_at": null,
    "ends_at": null,
    "verified_at": "2026-11-01",
    "status": "active",
    "existing_work": "allowed",
    "needs_repo": true,
    "chains": ["base"],
    "chain_required": true,
    "eligibility": [{ "kind": "live_product" }, { "kind": "chain", "value": "base" }],
    "setup": [],
    "each_time": ["usage, revenue, and team answers", "a Loom demo"],
    "rules": [
      "Rolling: apply to be included in the next cohort. No deadline is stated.",
      "For builders exclusively building on Base right now.",
      "You're past the idea stage, with a live product that's getting used."
    ],
    "ideas": ["A consumer app growing real transaction volume"],
    "form": { "platform": "google", "url": "https://forms.gle/urqjBJYJjR6Vqqre6", "fields": { "email": "entry.1000001" } },
    "submission_requirements": [
      { "key": "email", "label": "Email", "kind": "contact", "todo": "your email", "type": "email", "required": true, "from": "builder" },
      { "key": "project_name_description", "label": "Project name + one-line description of what it does", "kind": "one_liner", "todo": "a one-line project description", "type": "text", "required": true, "from": "project" },
      { "key": "live_product_url", "label": "Link to your live product", "kind": "links", "todo": "a link to your live product", "type": "url", "required": true, "project_field": "live_url", "from": "project" },
      { "key": "track", "label": "Which track best fits what you're building?", "kind": "other", "todo": "a track", "type": "choice", "required": true, "options": ["Trading", "Payments / Stable coins", "Agents / Agentic Commerce", "Consumer Social / App"], "from": "project" }
    ]
  }
}
```

The `form.fields` id above is an example; send the ids the real form page shows.

## Close a program

When a program ends early, is cancelled or its page is gone:

```
POST /api/programs/write
{ "action": "close", "id": "monad-builder-grants", "reason": "Organizer closed the round early" }
```

`reason` is 1 to 200 characters. Answers `closed`, or `unchanged` if it was already closed. Programs past `ends_at` drop off the list on their own; no close needed.

## Curated programs can't be changed

Programs from the owner's files (`source: "file"` in `GET /api/programs`) are curated. The API can't update or close them, and can't take their id. If a curated program looks wrong, tell the owner instead.

## Errors

Every refusal is `{ "ok": false, "problems": [...] }` (400, 409) or `{ "ok": false, "error": "..." }` (others). Each problem names the field. Fix all of them and send again; nothing was written.

| Status | Meaning | What to do |
|---|---|---|
| 202 | `pending`: the link didn't check out; the owner approves it | Nothing, unless `owner_emailed` is `false`: then send the same write again later. Watch `pending` in `GET /api/programs/writes` |
| 400 | A check failed: a missing or not-allowed field, an unknown chain, a text or URL rule, a stale `verified_at`, a past `ends_at`, a link that doesn't load (`source_url: doesn't load (...)`), or `id: no program <id>` on close | Fix each listed problem and resend. A `submission_url` host problem can't be fixed: skip the program and tell the owner |
| 401 | Wrong or missing token | Check the `Authorization: Bearer` header |
| 404 | The API is off (no token set, or `EARNKIT_PROGRAMS_API=off`) | Ask the owner |
| 409 | `<id> is curated by EarnKit; send a new id or ask the owner` | Use a different id, or tell the owner |
| 413 | Body over 256 KB | Send less text |
| 429 | Over 120 writes this hour | Wait for `Retry-After` seconds |
| 503 | EarnKit is busy | Retry after `Retry-After` seconds |

Every write (created, updated, unchanged, closed, pending, and `approved` or `superseded` once the owner acts; action `revert` with result `reverted` or `closed` when the owner reverts one) and every 400 or 409 refusal of a JSON body is in `GET /api/programs/writes` with its result and reason. A body that is not JSON (400) and 401, 404, 413, 429 and 503 answers are not logged.
