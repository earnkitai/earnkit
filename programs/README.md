# Programs

One file per builder program: `programs/<slug>.json`. Claude Code is the admin interface.
The format is defined and validated by `apps/frontend/lib/earnkit/program-file.ts`.

```sh
pnpm programs:check    # validate every program file
```

To publish, push to `main`. Every deploy writes all program files to the database
(`pnpm predeploy`), and changes under `programs/` trigger a deploy. The files are the source of
truth: a program's tracks and starters are replaced with what's in its file. Programs drop out
of `list_programs` on their own after `ends_at`.

## "Add this program to EarnKit: <url>"

Only Base, Arc, Tempo, Monad, and Robinhood Chain programs.

1. Read the official pages: overview, rules, FAQ, and the submission form itself.
2. Write `programs/<slug>.json` using only facts the source supports. If something isn't
   stated, use `null` or leave it out. Never guess a reward, deadline, or requirement.
3. Fill in:
   - `summary`: one short line builders see, reward + deadline as the organizer states it
     (e.g. `"500 USDC × 20 grants · closes Oct 14, 11:59 PM ET"`, or `"· rolling"`).
   - `max_award_usd` (optional): the most one winner gets, in USD, as a number. Set it only when
     the source states a per-winner amount (e.g. `500` for "500 USDC per microgrant", `5000` for
     "up to $5,000"); otherwise leave it out. When two of a builder's fits are equally quick,
     list_programs puts the larger known per-winner award first (unknown counts as 0). Sponsor
     campaigns don't need it: their per-winner amount is the prize divided by the winners.
   - `tag` (optional): `"long shot"` when few prizes go to many judged entries;
     `"needs a live product"` when it only suits builders who already shipped.
   - `ends_at`: ISO 8601 with timezone, converted from the organizer's timezone.
     `null` for rolling programs.
   - `starts_at`: for new-work-only programs, the start of the build window (matching
     checks commit dates against it). Otherwise `null` unless stated.
   - `existing_work`: `allowed`, `new_work_only`, or `unknown` if the source doesn't say.
   - `builder_bonus` (optional): leave it out for the default (`true`, on). Set `false` only when
     EarnKit should never book entries of this program's coins to a builder bonus round.
   - `verified_at`: today's date (`YYYY-MM-DD`). Agents trust facts checked within 7 days and
     skip re-reading the source, so update it whenever you re-check a program against its source.
   - `chains`: any of `base`, `arc`, `tempo`, `monad`, `robinhood` a project must use.
   - `setup`: one-time steps only the builder can do, a few words each
     (e.g. `"log in to DoraHacks"`, `"send about $1 of USDC on Arc to a deploy wallet"`).
   - `each_time`: what the builder must provide for every entry (e.g. `"a 2-3 min pitch video"`).
   - `logo` (optional): `{ "path": "programs/<id>.svg|png", "source_url": "<the brand kit or
     official site page it came from>" }`. Save the file itself under
     `apps/frontend/public/programs/`, taken from the program's or ecosystem's official brand kit
     or site; never redraw or guess a mark.
   - `winners_per_round` (optional): only when the source states how many winners a round has
     (e.g. "Twenty microgrants" → `20`).
   - `submission_requirements`: mirror the real form field by field:
     - `key`: snake_case; `label`: the question as the form asks it
     - `type`: `text` | `url` | `email` | `choice` (with `options`) | `file`; `required`
     - `description` (optional): limits or format notes from the form
     - `project_field` (optional): `name`, `description`, `repo_url`, `live_url`, `demo_url`,
       or `token_url` when the answer is simply that
     - `from`: `project` if the agent can draft it from the project, `builder` for personal info
     - `todo` (required when `required` is true; `pnpm programs:check` enforces it): the item as a
       short builder to-do for "Before you submit: …" — lowercase start, at most 40 characters,
       no trailing punctuation or links (e.g. `"a live link on Arc mainnet"`)
4. Past winners and focus (the program guide page and `get_program`'s "best bet"):
   1. Research past rounds on the program's own winner announcements, DoraHacks, Colosseum,
      Devfolio, and the ecosystem's blog or X.
      - Predecessor rounds are allowed when the label names the real event (e.g. the
        ecosystem's prior hackathon, season, or cohort, if this program has no past round of
        its own yet) — never attribute it to this program.
      - Set `"own": true` only on a round of this program itself. Leave it out for a predecessor
        event (the default): the guide then names the event ("in <label>", "What won before")
        instead of saying "last round", so write the label to read well after "in ".
      - Never use counts from a different kind of program (for example, an accelerator's counts
        for a grants program) for the odds: write `submissions`/`winners` as `null` instead of
        borrowing them.
      - `submissions` counts entries submitted to that round only — never registrations,
        projects deployed, or applicants to a different stage (e.g. Monad's "101 projects
        deployed" is not a submissions count). Write `null` when the only published number is a
        different metric.
      - One rule for unknown counts: when `submissions` or `winners` isn't sourced (unpublished,
        borrowed from elsewhere, or a different metric), write it as `null`. Don't omit the key —
        a `null` says "checked, not stated"; a missing key just looks unfinished.
      - Omit anything else you can't source (`why`, `themes`, `examples`, `focus`, `logo`,
        `winners_per_round`, the whole round). Never invent a count, a theme, or a "why".
   2. Record only what a source states: `past_rounds` (newest first, at most 5); `submissions`
      and `winners` as published, or `null` per the rule above. Themes: at most 3, counted only
      from winners you can list by name on the source. Examples: 1–2, with `what` they did; `why`
      only when a judge or organizer stated a reason — omit it otherwise, never invent one. Every
      example carries its own `source_url`.
   3. `focus`: up to 3 areas from the program's current tracks or the ecosystem's published
      priorities, plus `source_url` and optionally `ecosystem`.
   4. `best_bet`: one line combining themes and focus, never a new fact. It needs at least one of
      `past_rounds` or `focus` to draw from (`pnpm programs:check` enforces this).
   5. `difficulty_override` only when the organizer publishes odds another way than a past
      round's winners ÷ submissions.
5. Do not add starters. The owner decides those.
6. Run `pnpm programs:check`, then push.

## Weekly re-verification

Once a week, for every active program:

1. Re-read `source_url` and the focus source; update `focus` and `verified_at`.
2. When a round's winners are announced, add it as the first `past_rounds` entry (newest first),
   following step 4 above (same sourcing rules, including the predecessor-round and
   different-kind-of-program limits).
3. Re-check that `best_bet` still follows from the facts.
4. Run `pnpm programs:check`, then push.

## "Add this starter to the <Track> track: <idea>"

Starters are optional ideas. Turn the owner's one-line idea into `title`, `what_to_build`
(2-4 plain sentences), `requirements` (copied from the program/track), and `build_context`
(`{ "label", "url"? }` links to the program's own docs). With tracks: at most 1 starter per
track, and each names its `track` slug. Without tracks: at most 2.

## Example

```json
{
  "id": "example-builder-program",
  "organizer": "Example",
  "title": "Example Builder Program",
  "description": "What the program is, in two or three sentences.",
  "source_url": "https://example.com/program",
  "submission_url": "https://example.com/submit",
  "reward": "$50,000 across tracks",
  "summary": "$50K across tracks · closes Nov 15, 11:59 PM UTC",
  "starts_at": null,
  "ends_at": "2026-11-15T23:59:00Z",
  "verified_at": "2026-09-30",
  "status": "active",
  "existing_work": "allowed",
  "chains": ["base"],
  "setup": ["log in to the submission platform", "a public GitHub repo"],
  "each_time": [],
  "rules": ["Open source", "Deployed on Base mainnet"],
  "logo": { "path": "programs/example-builder-program.svg", "source_url": "https://example.com/brand" },
  "winners_per_round": 10,
  "past_rounds": [
    {
      "label": "Example Builder Program 2026 Q2",
      "source_url": "https://example.com/winners",
      "own": true,
      "submissions": 80,
      "winners": 10,
      "themes": [{ "theme": "Onchain payments tooling", "count": 3 }],
      "examples": [
        {
          "name": "PayStream",
          "what": "streamed salaries in USDC",
          "why": "live mainnet demo",
          "source_url": "https://example.com/paystream"
        }
      ]
    }
  ],
  "focus": { "areas": ["Stablecoin payments", "Agentic commerce"], "source_url": "https://example.com/focus" },
  "best_bet": "A USDC payout tool with a live mainnet demo",
  "difficulty_override": null,
  "submission_requirements": [
    { "key": "project_name", "label": "Project name", "todo": "a project name", "type": "text", "required": true, "project_field": "name", "from": "project" },
    { "key": "github", "label": "GitHub repository", "todo": "a GitHub repo link", "type": "url", "required": true, "project_field": "repo_url", "from": "project" },
    { "key": "contact_email", "label": "Email", "todo": "your email", "type": "email", "required": true, "from": "builder" }
  ],
  "tracks": [],
  "starters": []
}
```
