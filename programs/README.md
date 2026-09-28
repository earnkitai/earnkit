# Programs

One file per builder program: `programs/<slug>.json`. Claude Code is the admin interface.
The format is defined and validated by `apps/frontend/lib/earnkit/program-file.ts`.

```sh
pnpm program:upsert programs/<slug>.json --check   # validate only
pnpm program:upsert programs/<slug>.json           # validate + write to the database
```

Publishing: every deploy runs `pnpm predeploy` (migrate + `pnpm programs:sync`), which writes
all program files to the database, and a change under `programs/` triggers a deploy. So merging
to `main` is how a program change goes live. To write immediately without a deploy (Railway
CLI, repo linked to the EarnKit project):

```sh
railway run -s Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm program:upsert programs/<slug>.json'
```

Upsert replaces the program, its tracks, and its starters with what is in the file.
The file is the source of truth. Edit it, then upsert again.

## "Add this program to EarnKit: <url>"

1. Read the official program pages (overview, rules, FAQ, the submission form itself).
2. Write `programs/<slug>.json` using only facts the source supports. If something is
   not stated (e.g. no start date), use `null` or leave it out. Never guess a reward,
   deadline, or requirement.
3. `key_requirement`: the one requirement that decides fit, in a few words
   (e.g. "Deployed and working on Arc mainnet"). `existing_work`: `allowed` if already-built
   projects can be submitted, `new_work_only` if only work done during the program counts,
   `unknown` if the source doesn't say. `verified_at`: today's date (YYYY-MM-DD). Update it
   whenever you re-check the file against the official sources, even if nothing changed.
   `chains`: which of `base`, `arc`, `tempo`, `monad`, `robinhood` a project must use (used to
   match builders' repos). For new-work-only programs, set `starts_at` to the start of the build
   window so matching can check commit dates.
4. `builder_steps`: only what the builder must do themselves, from the forms and rules:
   `{ "kind": "github" | "hosting" | "wallet" | "login" | "video" | "info", "detail": "a few words" }`
   (e.g. `wallet` / "about $1 of USDC on Arc", `login` / "DoraHacks"). Add `"each_entry": true`
   only for steps needed every time (a pitch video, program-specific answers); everything else is
   one-time setup that carries over. The agent drops what's already done, so keep details short.
5. `summary`: one short line the builder sees, reward + deadline as the organizer states it
   (e.g. "500 USDC × 20 grants · closes Oct 14, 11:59 PM ET", or "· rolling"). `tag` (optional):
   `"long shot"` when few prizes go to many judged entries, `"needs a live product"` when the
   program only suits builders who already shipped.
6. `submission_requirements` must mirror the real submission form, field by field:
   - `key`: snake_case, stable
   - `label`: the question as the form asks it
   - `type`: `text` | `url` | `email` | `choice` (with `options`) | `file`
   - `required`: as the form marks it
   - `description`: limits or format notes from the form (optional)
   - `project_field`: set when the answer is simply the project's `name`,
     `description`, `repo_url`, `live_url`, `demo_url`, or `token_url`
   - `from`: `project` if the agent can draft it from the project itself,
     `builder` for personal info (name, email, wallet, socials, team, country…)
7. Do not add starters. The owner decides those.
8. Run `--check`, fix any errors, then upsert.

Rolling programs (no deadline, e.g. cohort-based grants) use `"ends_at": null`.
Dates are ISO 8601 with a timezone (`2026-10-31T23:59:00Z`). Convert the organizer's
stated timezone. Set `"status": "closed"` to hide a program early.

## "Add this starter to the <Track> track: <idea>"

Starters are optional ideas, never required. Turn the owner's one-line idea into:

- `title`: short
- `what_to_build`: 2-4 plain sentences
- `requirements`: the program/track requirements this idea must satisfy (copied from the file)
- `build_context`: `{ "label", "url"? }` links to the program's own docs, APIs, or examples

Limits (enforced by validation): with tracks, at most 1 starter per track, and
every starter names its `track` slug. Without tracks, at most 2 starters.

## Example shape

```json
{
  "id": "example-builder-program",
  "organizer": "Example",
  "title": "Example Builder Program",
  "description": "What the program is, in two or three sentences.",
  "source_url": "https://example.com/program",
  "submission_url": "https://example.com/submit",
  "reward": "$50,000 across tracks",
  "starts_at": null,
  "ends_at": "2026-11-15T23:59:00Z",
  "status": "active",
  "key_requirement": "Deployed on Example mainnet",
  "existing_work": "allowed",
  "chains": ["base"],
  "verified_at": "2026-09-28",
  "builder_steps": [
    { "kind": "login", "detail": "the submission platform" },
    { "kind": "github", "detail": "a public repo" }
  ],
  "summary": "$50K across tracks · closes Nov 15, 11:59 PM UTC",
  "rules": ["Open source", "Built during the program"],
  "submission_requirements": [
    { "key": "project_name", "label": "Project name", "type": "text", "required": true, "project_field": "name", "from": "project" },
    { "key": "github", "label": "GitHub repository", "type": "url", "required": true, "project_field": "repo_url", "from": "project" },
    { "key": "contact_email", "label": "Email", "type": "email", "required": true, "from": "builder" }
  ],
  "tracks": [
    { "slug": "payments", "name": "Payments", "description": "…", "requirements": ["…"] }
  ],
  "starters": []
}
```
