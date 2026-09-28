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
   - `tag` (optional): `"long shot"` when few prizes go to many judged entries;
     `"needs a live product"` when it only suits builders who already shipped.
   - `ends_at`: ISO 8601 with timezone, converted from the organizer's timezone.
     `null` for rolling programs.
   - `starts_at`: for new-work-only programs, the start of the build window (matching
     checks commit dates against it). Otherwise `null` unless stated.
   - `existing_work`: `allowed`, `new_work_only`, or `unknown` if the source doesn't say.
   - `chains`: any of `base`, `arc`, `tempo`, `monad`, `robinhood` a project must use.
   - `setup`: one-time steps only the builder can do, a few words each
     (e.g. `"log in to DoraHacks"`, `"send about $1 of USDC on Arc to a deploy wallet"`).
   - `each_time`: what the builder must provide for every entry (e.g. `"a 2-3 min pitch video"`).
   - `submission_requirements`: mirror the real form field by field:
     - `key`: snake_case; `label`: the question as the form asks it
     - `type`: `text` | `url` | `email` | `choice` (with `options`) | `file`; `required`
     - `description` (optional): limits or format notes from the form
     - `project_field` (optional): `name`, `description`, `repo_url`, `live_url`, `demo_url`,
       or `token_url` when the answer is simply that
     - `from`: `project` if the agent can draft it from the project, `builder` for personal info
4. Do not add starters. The owner decides those.
5. Run `pnpm programs:check`, then push.

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
  "status": "active",
  "existing_work": "allowed",
  "chains": ["base"],
  "setup": ["log in to the submission platform", "a public GitHub repo"],
  "each_time": [],
  "rules": ["Open source", "Deployed on Base mainnet"],
  "submission_requirements": [
    { "key": "project_name", "label": "Project name", "type": "text", "required": true, "project_field": "name", "from": "project" },
    { "key": "github", "label": "GitHub repository", "type": "url", "required": true, "project_field": "repo_url", "from": "project" },
    { "key": "contact_email", "label": "Email", "type": "email", "required": true, "from": "builder" }
  ],
  "tracks": [],
  "starters": []
}
```
