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

Only Base, Arc, Tempo, Monad, Robinhood Chain and Avalanche programs, plus programs not tied to
one chain (`any_chain`, below). Never Optimism. An Optimism program is one whose only chain is
OP Mainnet, or one run by Optimism or the Optimism Collective (OP Atlas, Retro Funding, Superchain
grants), or one whose source or submission page is on `optimism.io`. None is listed, and
`programs:check` refuses a file whose `source_url` or `submission_url` is on `optimism.io` or any
`*.optimism.io` host. Base programs, and programs for Base or any other chain that happens to be
built on the OP Stack, are not Optimism programs: never close them under this rule. A multi-chain
program is never closed under it either.

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
   - `pool_usd` (optional): the program's total prize pool in USD, as a number. Set it only when
     the source states a pool (e.g. `840000` for "$840,000 in prizes", `10000` for "10,000 USDC
     pool"); leave it out when none is published. `reward` must state the same amount followed by
     a pool word (`$840,000 in prizes`, `$250,000+ prize pool`, `10,000 USDC pool`, `$200K
     available`; `programs:check` refuses it otherwise), and a `+`
     right after it there ("$250,000+") shows on the page. The landing page's "$X open right now"
     is the sum of the open programs' pools, with "+" when any lacks one. The landing and
     /programs sort cards with a pool first, by pool, then the rest by `max_award_usd`.
   - `min_award_usd` (optional): the smallest award, only when the source states a range ("from
     $5,000 to $100,000"); needs a larger `max_award_usd` and must be stated in `reward`. The card
     then reads "$5K–$100K per grant" (grant programs say "per grant", others "per winner").
   - `pool_source_url` (optional, only with `pool_usd`): where the pool is stated when that isn't
     `source_url` (e.g. Circle's Cohort 2 total on its grants portal).
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
   - `chains`: any of `base`, `arc`, `tempo`, `monad`, `robinhood`, `avalanche` a project must use
     (at least one).
   - `investment` (optional): `true` when the award is an investment in the company (an
     accelerator), not a prize or grant. The card then reads "up to $1M investment", never
     "per winner".
   - `any_chain` (optional): `true` only when the program isn't tied to one chain (e.g. an
     accelerator that funds any startup). Then `chains` is `[]`, the program fits any repo (the
     chain and mainnet checks are skipped; existing work, the tag and the live link still apply),
     and its guide page says "Any chain".
   - `setup`: one-time steps only the builder can do, a few words each
     (e.g. `"log in to DoraHacks"`, `"send about $1 of USDC on Arc to a deploy wallet"`).
   - `each_time`: what the builder must provide for every entry (e.g. `"a 2-3 min pitch video"`).
   - `logo` (optional): `{ "path": "programs/<id>.svg|png", "source_url": "<the brand kit or
     official site page it came from>" }`. Save the file itself under
     `apps/frontend/public/programs/`, taken from the program's or ecosystem's official brand kit
     or site; never redraw or guess a mark.
   - `winners_per_round` (optional): only when the source states how many winners a round has
     (e.g. "Twenty microgrants" → `20`).
   - `results` (optional): `{ "url", "expected" }`, only when the source states when results are
     announced (`expected` is that date, `YYYY-MM-DD`; Arc's "all decisions by October 21, 2026"
     is `2026-10-21`). `url` is the https page where they will appear (the program page when it
     names no other). After `expected`, EarnKit asks each builder once whether they won.
   - `submission_requirements`: mirror the real form field by field:
     - `key`: snake_case; `label`: the question as the form asks it
     - `type`: `text` | `url` | `email` | `choice` (with `options`) | `file`; `required`
     - `description` (optional): limits or format notes from the form
     - `project_field` (optional): `name`, `description`, `repo_url`, `live_url`, `demo_url`,
       or `token_url` when the answer is simply that
     - `from`: `project` if the agent can draft it from the project, `builder` for personal info
     - `todo` (required when `required` is true; `pnpm programs:check` enforces it): the item as a
       short builder to-do for "Before you submit: …": lowercase start, at most 40 characters,
       no trailing punctuation or links (e.g. `"a live link on Arc mainnet"`)
     - `kind` (required on every item; `pnpm programs:check` enforces it): what the field is for,
       so the application coach can guide the agent and reuse the builder's answers across
       programs. One of `name`, `one_liner`, `problem`, `solution`, `how_it_works`, `traction`,
       `team`, `why_you`, `use_of_funds`, `milestones`, `demo_video`, `links`, `contact`, `other`.
       Use `contact` for the builder's own name, email and handles (they fold into one question),
       `links` for project links, and `other` for anything program-specific (a track, a consent box,
       a builder code); `other` answers are never reused for another program. Set `from: "builder"`
       on anything only the builder can answer (consent, an amount, revenue): the coach asks it and
       the agent never drafts it.
     - `max_chars` (optional): the form's character limit, when it states one (e.g. "max 280
       characters" → `280`). Only stated limits are checked; the agent trims to them.
     - `guidance` (optional): this program's own advice for the field, only from its rubric, FAQ
       or past winners: `{ "judges", "questions" (at most 2), "pattern", "limit_words",
       "source_url" }`, every part optional except `source_url`. Each part replaces the kind's
       built-in default. Leave it out when the source says nothing specific; the defaults work on
       their own.
   - `judging` (optional): only when the source states how entries are judged (e.g. Arc's "Judged
     on relevance to Arc, technical credibility, …"). `{ "criteria": [{ "text" }], "source_url" }`:
     1 to 5 criteria in the source's words (`text`, 1 to 12 words). The agent drafts toward them;
     they are never matched by keywords. A criterion shows the builder a fix only when you write
     one by hand: `"fix": { "kind", "needs", "add" }`, the field kind it belongs in, what that answer
     must hold (`link`, `number` or `date`) and the exact thing to add, lowercase, no final period
     (e.g. `{ "kind": "solution", "needs": "link", "add": "link the contract on the Arc explorer" }`,
     shown as "<that field>: link the contract on the Arc explorer."). Never invent a criterion.
   - How the entry is submitted (the submit kit, which only comes after the builder confirms):
     the mode follows the form's host. Google Forms, Airtable and Tally get a prefilled link;
     ETHGlobal, Devfolio, Colosseum, Monad's hackathon site, Akindo and TAIKAI are filled in the
     builder's own browser by an agent that has a browser tool (it stops at login, captcha, wallet
     signing and file uploads; the builder clicks submit); DoraHacks and Questbook are always a
     paste list (their terms ban automated filling); Superteam Earn and Karma GAP can use their
     agent API. Any other host is a paste list.
     - `submit_host` (optional): the form's bare host (e.g. `"dorahacks.io"`) when it isn't
       `submission_url`'s host.
     - `submit_api` (optional): `true` only on Superteam Earn or Karma GAP, and only when the
       listing itself allows agents to submit (Superteam: `agentAccess` AGENT_ALLOWED or
       AGENT_ONLY). `programs:check` refuses it on any other host.
     - `form` (Google Forms, Airtable or Tally only): read the public form once, here, and store its
       field ids. Never submit it, never fill it in, never sign in to read it.
       - Google Forms: resolve a `forms.gle` link first (`curl -sIL <link>`, take the last
         `location`). `url` is the full `https://docs.google.com/forms/d/e/<id>/viewform`, with no
         query string. GET that page (read only) and read `FB_PUBLIC_LOAD_DATA_` with a small
         throwaway script (not committed): each question is `[id, title, description, type,
         [[entry_id, options, required]]]`. Match each question title to its requirement and write
         `"<key>": "entry.<entry_id>"`. Leave out a checkbox question (type 4) whose requirement is
         free text, a grid, and any question you can't match: they stay in the paste list.
       - Airtable: `fields` maps keys to the form's field names (sent as `prefill_<Field Name>`).
       - Tally: `fields` maps keys to the form's URL parameter names.
       - `sign_in`: `false` when the form needs no sign-in. `"email_only"` (Google only) when its
         only sign-in cause is verified email collection: `FB_PUBLIC_LOAD_DATA_[1][10][6]` is `2`
         (VERIFIED; `3` is a typed email box, which needs no sign-in) and there is no file question
         (type 13). The prefilled link stays, and the builder's first item is to sign in to Google
         and tick "Record my email address". `true` for a file question, one response per person,
         or any other sign-in cause: the form is then filled in the builder's browser instead.
       - `read_at`: today's date (`YYYY-MM-DD`).
4. Past winners and focus (the program guide page and `get_program`'s "best bet"):
   1. Research past rounds on the program's own winner announcements, DoraHacks, Colosseum,
      Devfolio, and the ecosystem's blog or X.
      - Predecessor rounds are allowed when the label names the real event (e.g. the
        ecosystem's prior hackathon, season, or cohort, if this program has no past round of
        its own yet), never attribute it to this program.
      - Set `"own": true` only on a round of this program itself. Leave it out for a predecessor
        event (the default): the guide then names the event ("in <label>", "What won before")
        instead of saying "last round", so write the label to read well after "in ".
      - Never use counts from a different kind of program (for example, an accelerator's counts
        for a grants program) for the odds: write `submissions`/`winners` as `null` instead of
        borrowing them.
      - `submissions` counts entries submitted to that round only, never registrations,
        projects deployed, or applicants to a different stage (e.g. Monad's "101 projects
        deployed" is not a submissions count). Write `null` when the only published number is a
        different metric.
      - One rule for unknown counts: when `submissions` or `winners` isn't sourced (unpublished,
        borrowed from elsewhere, or a different metric), write it as `null`. Don't omit the key:
        a `null` says "checked, not stated"; a missing key just looks unfinished.
      - Omit anything else you can't source (`why`, `themes`, `examples`, `focus`, `logo`,
        `winners_per_round`, the whole round). Never invent a count, a theme, or a "why".
   2. Record only what a source states: `past_rounds` (newest first, at most 5); `submissions`
      and `winners` as published, or `null` per the rule above. Themes: at most 3, counted only
      from winners you can list by name on the source. When the source describes only some of
      the winners, set `themes_of` to how many it describes (at most `winners`): the guide then
      shows the theme counts without "of N". Examples: 1–2, with `what` they did; `why`
      only when a judge or organizer stated a reason; omit it otherwise, never invent one. Every
      example carries its own `source_url`.
   3. `focus`: up to 3 areas from the program's current tracks or the ecosystem's published
      priorities, plus `source_url` and optionally `ecosystem`.
   4. `best_bet`: one line combining themes and focus, never a new fact. It needs at least one of
      `past_rounds` or `focus` to draw from (`pnpm programs:check` enforces this).
   5. `difficulty_override` only when the organizer publishes odds another way than a past
      round's winners ÷ submissions: `{ "level", "basis", "source_url" }`. Add `"estimate": true`
      when the level is EarnKit's estimate rather than the organizer's figure (it shows as
      "Hard (estimate)" with its basis).
   6. The EarnKit rating: when the owner rates a program Easy, write
      `{ "level": "Easy", "rated_by": "earnkit", "source_url": "<the file's source_url>" }`. Only
      the owner gives this rating, and only `Easy`. Builders see just "Easy": no basis, no stat,
      no "rated by" label. Never add a `basis` to it.
5. Do not add starters. The owner decides those.
6. Run `pnpm programs:check`, then push.

## Weekly re-verification

Once a week, for every active program:

0. Skip and close (`"status": "closed"`) any Optimism program as defined above (only chain OP
   Mainnet, or run by Optimism or the Optimism Collective); never list a new one. Never close a
   Base or multi-chain program under this step.
1. Re-read `source_url` and the focus source; update `focus` and `verified_at`.
2. When a round's winners are announced, add it as the first `past_rounds` entry (newest first),
   following step 4 above (same sourcing rules, including the predecessor-round and
   different-kind-of-program limits).
3. Re-check that `best_bet` still follows from the facts.
4. Refresh any live count in a `difficulty_override` from its `source_url` (Circle Developer
   Grants: the accepted and submitted proposal counts on circle.questbook.app move every week).
   If it can't be re-confirmed, remove the override. Leave an EarnKit rating (`rated_by`) as it
   is: it is the owner's, not a count.
5. Re-read a program's `form` the same way as at listing (Google: resolve the link, read
   `FB_PUBLIC_LOAD_DATA_` again). Update the entry ids, `sign_in` and `read_at`. Remove a field
   whose question is gone; if the form moved to a host without prefill, remove `form`. A stale id
   never breaks an entry: that answer just moves to the paste list.
6. Results: for each program whose `results.expected` has passed (or that announced early), read
   `results.url`. When it names results, write `programs/outcomes/<program-id>.json` (format and
   example: `programs/outcomes/README.md`): the round's label, the announcement's https link,
   today as `captured_at`, `complete`, the round's window (`entries_until`, the round's deadline
   as a date, required when `complete` is true; `entries_from`, the round's first day, when the
   source states it), and one result per named project, by its repo, name or live link exactly as
   the announcement gives it. Only entries submitted inside the window are labelled for the round. `complete: true` only when the announcement
   names every winner of the round (then every other EarnKit entry is labelled `not_selected`);
   otherwise `false` (the others are labelled `unknown`, which never counts). Only what the
   announcement states: never a builder's own report, never a guessed match, `prize_usd` only
   when stated. Never change a committed `round_label`: a new label is a new round. Then add the
   round to `past_rounds` (step 2). When results are late, update `results.expected` only if the
   source gives a new date; otherwise leave it.
7. Builders' own reports ("Did TipJar win anything in Arc Microgrants?") are stored privately and
   never count. They are only a hint to look harder at that program's announcement; only step 6
   labels an entry.
8. Run `pnpm programs:check`, then push. Deploy runs `pnpm programs:sync`, which writes the
   outcome files to the database and prints only counts (`Outcomes arc-microgrants.json: 3
   matched, 1 unmatched, 12 others labelled`).

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
    { "key": "project_name", "label": "Project name", "kind": "name", "todo": "a project name", "type": "text", "required": true, "project_field": "name", "from": "project" },
    { "key": "github", "label": "GitHub repository", "kind": "links", "todo": "a GitHub repo link", "type": "url", "required": true, "project_field": "repo_url", "from": "project" },
    { "key": "contact_email", "label": "Email", "kind": "contact", "todo": "your email", "type": "email", "required": true, "from": "builder" }
  ],
  "tracks": [],
  "starters": []
}
```
