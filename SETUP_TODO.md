# setup todo

- fill in docs/startup-context/main.md
- this won't get filled immediately. maybe once you set up the entire arch this should be updated - docs/codebase-context/architecture-guide.md and docs/codebase-context/code-map.md
- both should get kept up to date as you go (mentioned in CLAUDE.md for the intended workflow. agents
are instructed to read these before starting work and update them after significant changes).
- once there's a backend, add a docs/codebase-context/client-backend.md.
- once there's an SDK, same idea - a docs/codebase-context/sdk.md.
- docs/design-docs-and-implementation-plans/ and docs/deferred-problems/ just need you to
  actually write into them as work happens.

## skills

they should always load on their own and you wouldn't likely have to specify each time.

i'd just recommend going through the feature-development skill once if its seems too bloated given this project's current complexity. the main idea it to always tell the agent to first build the skeleton which you must review meticulously -> create tests -> implement. in this way most things that could go wrong would be caught in step one and you'll likely never have to review the final code. that's the essence, if other stuff feels too bloated then feel free to trim.

also all of these skills are meant to be continuously updated as you use them. just start a new chat and tell the specific problem you're facing with the current skill and how you'd want it to be and ask it to update. make sure you read what it updates carefully everytime. skills and context > intelligence of model

# docs

should reference and update automatically.

## Must do

- **Rotate the leaked DB credential.** `.claude/settings.local.json` is tracked in git and has
  a plaintext Postgres `DATABASE_URL` (with password) committed to history, referencing
  `apps/dashboard` and `apps/earn-backend` — apps that don't exist in this trimmed repo anymore.
  Rotate that credential in Railway and scrub/replace the file (this is a live secret sitting
  in git history right now).