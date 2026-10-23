# EarnKit Cursor plugin (owner publish steps)

One listing in the Cursor Marketplace covers Cursor and Grok Bot (Grok Bot reads the same plugin catalog). Once it is
listed, the install sheet can offer a true one-click link for both. Nothing here is published yet.

The plugin is in `earnkit/`: `.cursor-plugin/plugin.json` (manifest), `mcp.json` (the remote server
https://earnkit.com/mcp), `skills/what-can-i-earn/SKILL.md`, `assets/logo.png` (the site's 180px app icon) and
`README.md` (what the listing shows). Format per https://cursor.com/docs/reference/plugins and
https://github.com/cursor/plugin-template (read 2026-10-23).

## Steps (owner only, needs your accounts)

| # | Step |
|---|---|
| 1 | Test locally: copy `earnkit/` to `~/.cursor/plugins/local/earnkit`, reload Cursor, open Customize, check the EarnKit server and the skill show, choose Authenticate, sign in with X, ask "What can I earn?" |
| 2 | Make a new public GitHub repo, e.g. `earnkitai/earnkit-cursor-plugin`, with the contents of `earnkit/` at its root (Cursor requires plugins to be open source; keep the MIT license or pick another) |
| 3 | Submit the repo at https://cursor.com/marketplace/publish (the plugin publisher application). Cursor reviews every plugin by hand, and every update again |
| 4 | Once approved, read the listing's numeric plugin id (the marketplace page data, e.g. 1Password's is 768) |
| 5 | Tell Claude the id: the Grok Bot tab can then link `https://cursor.com/grok-bot/link/v1/plugin/add?id=<id>` (opens Grok Bot's plugin pane on Add), and Cursor's tab can link the listing |

## Checks before submitting

- `name` is unique kebab-case (`earnkit`); `description` is one clear line.
- Every component has valid frontmatter; paths are relative (no `..`).
- `mcp.json` uses no `${VAR}` (EarnKit needs none: OAuth with dynamic client registration, so no client id or secret).
- In approval prompts the server shows as `plugin-earnkit-earnkit`.

## Not verified

- The listing id as the `?id=` of the Grok Bot add link is inferred from the marketplace page data, not documented.
- Whether Cursor's plugin install uses the same OAuth callbacks EarnKit trusts (`oauth.ts AGENT_REDIRECT_URIS`): if the
  sign-in shows "You're connecting EarnKit to ...", send Claude the redirect it names.
