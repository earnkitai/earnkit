# EarnKit programs API (for the Grok Bot)

The owner pastes this into the Grok Bot's instructions. The bot researches builder programs and writes them to EarnKit. A write that passes every check is live at once: on the site (with a small "Found by EarnKit's research." line), in the sitemap and in every builder's agent.

## Owner setup (once)

Run this in your own terminal (not in a Claude session). It prints the token once, then sets it on Railway:

```
T=$(openssl rand -hex 32); echo "$T"; railway variables --project ae726253-edb5-4c47-b308-854be7cf36b1 --service earnkit --environment production --set "EARNKIT_PROGRAMS_TOKEN=$T"
```

Paste the printed token into the Grok Bot as `EARNKIT_PROGRAMS_TOKEN`. Without the token (or with `EARNKIT_PROGRAMS_API=off`) the write and log routes answer 404. To turn the API off, set `EARNKIT_PROGRAMS_API=off`.

## What to research

- Programs on Base, Arc, Tempo, Monad, Robinhood Chain and Avalanche.
- Accelerators and grants open to any chain (`any_chain: true`, `chains: []`).
- Never Optimism: not a program run by Optimism or the Optimism Collective, not one whose only chain is OP Mainnet, not one with a page on `optimism.io`. Base and other OP Stack chains are fine.

Rules (from `programs/README.md`):

- Use only the program's official pages: overview, rules, FAQ and the form itself.
- Never guess. If the source doesn't state a fact, leave the field out (or `null`). Never estimate a reward, a pool or a deadline.
- Mirror the real form field by field in `submission_requirements`.
- Set `verified_at` to the day you read the source.
- Re-check each program at least weekly (a write's verified_at must be within the last 7 days). A program not re-checked for 14 days drops off EarnKit's lists until you write it again.

## The routes

All bodies are JSON. Base URL: `https://earnkit.com`.

| Route | Auth | What it does |
|---|---|---|
| `POST /api/programs/write` | `Authorization: Bearer <token>` | Add, update or close one program |
| `GET /api/programs` | none | What is listed now. `?category=grant\|hackathon\|investment\|bounty`, `?status=active\|upcoming` |
| `GET /api/programs/writes` | `Authorization: Bearer <token>` | Your last 100 writes: `{ at, program_id, action, result, reason }` |

`GET /api/programs` returns up to 200 programs: `{ id, title, organizer, category, chains, any_chain, money, status, closes_at, closes_in, source_url, submission_url, source }`. Sorted by category, then soonest close (rolling last), then the larger award. `source` is `file` (curated by the owner) or `api` (yours). It is cached for up to a minute.

Write limits: 120 writes an hour, 256 KB a body.

## Add or update a program

```
POST /api/programs/write
{ "action": "upsert", "program": { ...the program... } }
```

Same id again updates it. A body identical to what is stored answers `unchanged`.

Success: `{ "ok": true, "id": "...", "result": "created" | "updated" | "unchanged", "category": "grant", "live": true }`. `live` is true while the program is upcoming, or active and not past `ends_at`.

### Fields you can send

Only these. Any other field is refused (`<field>: the API can't set <field>; the owner adds it by file`).

**Required:** `id`, `organizer`, `title`, `description`, `source_url`, `submission_url`, `reward`, `summary`, `starts_at`, `ends_at`, `status`, `verified_at`, `existing_work`, `chains`, `rules`, `setup`, `each_time`, `needs_repo`, `submission_requirements`.

**Optional:** `max_award_usd`, `min_award_usd`, `pool_usd`, `pool_source_url`, `category`, `tag`, `tz`, `opens_note`, `any_chain`, `investment`, `in_person`, `needs_contract`, `min_product_score`, `wants_revenue`, `winners_per_round`, `ideas`.

**Each `submission_requirements` item:** `key`, `label`, `type`, `required`, `options`, `description`, `project_field`, `from`, `todo`, `kind`, `max_chars`. No `guidance`.

Key values:

- `id`: 3 to 64 lowercase letters, digits or dashes (`monad-builder-grants`).
- `category`: `grant`, `hackathon`, `investment` or `bounty`. Leave it out to derive it: `investment: true` is investment, a pool with no per-winner amount or `in_person: true` is hackathon, anything else is grant.
- `status`: `active`, `upcoming` (needs `opens_note`) or `closed`.
- `chains`: any of `base`, `arc`, `tempo`, `monad`, `robinhood`, `avalanche`; `[]` only with `any_chain: true` (then `min_product_score` 5 or more).
- `existing_work`: `allowed`, `new_work_only` or `unknown`.
- `ends_at`: ISO 8601 with a zone, or `null` for rolling. An active program's `ends_at` must be in the future.
- `verified_at`: `YYYY-MM-DD`, at most 7 days ago, never in the future.
- `summary`: reward and deadline as the organizer states them: `"up to $5,000 · rolling"`, `"500 USDC x 20 grants · closes Oct 14, 11:59 PM ET"`.
- `reward` with `pool_usd`: must state the same amount followed by a pool word (`$840,000 in prizes`).
- Requirement `type`: `text`, `url`, `email`, `choice` or `multi_choice` (both need `options`), `file`.
- Requirement `from`: `project` (the agent can draft it) or `builder` (personal info, consent, amounts).
- Requirement `kind` (on every item): `name`, `one_liner`, `problem`, `solution`, `how_it_works`, `traction`, `team`, `why_you`, `use_of_funds`, `milestones`, `demo_video`, `links`, `contact`, `other`.
- Requirement `todo` (on every required item): lowercase start, at most 40 characters, no final punctuation, no links.
- `needs_repo`: `true` or `false` (whether entering needs a repo or a live product). Always send it.

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
| `needs_contract` | one chain value, and one of `chains` |
| `min_product_score` | a whole number from 0 to 6 |
| `max_award_usd`, `min_award_usd` | a positive number, at most 5,000,000 |
| `pool_usd` | a positive number, at most 50,000,000 |
| `min_award_usd` | only with a larger `max_award_usd`, and stated in `reward` |
| `pool_source_url` | only with `pool_usd` |
| requirement `todo` | at most 40 characters |
| requirement `key` | snake_case, unique in the program |
| requirement `max_chars` | a positive whole number (the form's stated limit) |
| requirement `options` | needed on `choice` and `multi_choice` |
| `submission_requirements` | at least one item (an upcoming program may have none) |
| `description`, `reward`, each `rules` item, requirement `label`, `description` and each `options` item | at most 4,096 characters |
| `starts_at` | before `ends_at` when both are set |

Amounts above the caps are refused with `larger amounts need a curated file`: tell the owner instead.

### Text rules (every text field and requirement text)

- Plain words only. No links, URLs, `www.` or bare domains (`evil.com`, `evil[.]com`), no markdown links, no `<` or `>`.
- Normalized plain text: no full-width letters, no `…` (write `...`), no hidden, zero-width, bidi or control characters. Newlines and tabs are fine. Simple emoji are fine; joined emoji (families) and keycaps (`1️⃣`) are refused.
- `title` at most 120 characters, `organizer` at most 80.

### URL rules (`source_url`, `submission_url`, `pool_source_url`)

- `https://` only, a domain name (no IP address, no trailing dot), at most 2,048 characters.
- Printable ASCII only, no spaces, no `#` fragment, no `user:pass@`, no `[` or `]`. Percent-encode anything else.
- Send the normalized form: lowercase host, and a `/` after a bare host (`https://org.com/`, not `https://Org.com`).
- `submission_url` and `pool_source_url` must be on the same site as `source_url`, or on a submit platform: Google Forms (`docs.google.com/forms`, `forms.gle`), Typeform, Tally, DoraHacks, Questbook, Devfolio, ETHGlobal, HackQuest. On a shared host (github.io, vercel.app, notion.site and the like) only the exact same host counts, and never on github.com, x.com, medium.com and other sites where owners differ by path.
- Both links must load. A login wall or bot wall (401, 403, 429) is fine; 404, 5xx and timeouts are refused.
- If a program's real form is on a host the API refuses, skip that program and report it to the owner; never send a different URL than the program's own form.

### Full example

This is the committed `base-builder-grants` file trimmed to the fields above. That id is curated, so sending it exactly answers 409. Use your program's own id and facts.

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
    "setup": [],
    "each_time": ["usage, revenue, and team answers", "a Loom demo"],
    "rules": [
      "Rolling: apply to be included in the next cohort. No deadline is stated.",
      "For builders exclusively building on Base right now.",
      "You're past the idea stage, with a live product that's getting used."
    ],
    "ideas": ["A consumer app growing real transaction volume"],
    "submission_requirements": [
      { "key": "email", "label": "Email", "kind": "contact", "todo": "your email", "type": "email", "required": true, "from": "builder" },
      { "key": "project_name_description", "label": "Project name + one-line description of what it does", "kind": "one_liner", "todo": "a one-line project description", "type": "text", "required": true, "from": "project" },
      { "key": "live_product_url", "label": "Link to your live product", "kind": "links", "todo": "a link to your live product", "type": "url", "required": true, "project_field": "live_url", "from": "project" },
      { "key": "track", "label": "Which track best fits what you're building?", "kind": "other", "todo": "a track", "type": "choice", "required": true, "options": ["Trading", "Payments / Stable coins", "Agents / Agentic Commerce", "Consumer Social / App"], "from": "project" }
    ]
  }
}
```

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
| 400 | A check failed: a missing or not-allowed field, a text or URL rule, a stale `verified_at`, a past `ends_at`, a link that doesn't load (`source_url: doesn't load (...)`), or `id: no program <id>` on close | Fix each listed problem and resend. A `submission_url` host problem can't be fixed: skip the program and tell the owner |
| 401 | Wrong or missing token | Check the `Authorization: Bearer` header |
| 404 | The API is off (no token set, or `EARNKIT_PROGRAMS_API=off`) | Ask the owner |
| 409 | `<id> is curated by EarnKit; send a new id or ask the owner` | Use a different id, or tell the owner |
| 413 | Body over 256 KB | Send less text |
| 429 | Over 120 writes this hour | Wait for `Retry-After` seconds |
| 503 | EarnKit is busy | Retry after `Retry-After` seconds |

Every write (created, updated, unchanged, closed) and every 400 or 409 refusal of a JSON body is in `GET /api/programs/writes` with its result and reason. A body that is not JSON (400) and 401, 404, 413, 429 and 503 answers are not logged.
