# Sign-in first (one-pager v1, step 2)

First run is "GitHub + X OAuth, nothing typed". Smallest diff; existing code reused.

## What changes

1. **Connect ask replaces the X gate.** While unclaimed, `benchView` (bench-find.ts) asks `kind: 'claim'`
   (no DB enum or step-key change; a decline still keeps it away 30 days) with `connectAsk(link)`
   (bench-reply.ts): "Connect GitHub and X to get ranked (two sign-ins, nothing to type): <link>". No question
   follows. `CLAIM_NOTE` and `CLAIM_YES_NOTE` say GitHub, then X. "Ways to get funded" is unchanged.
2. **Claim page: GitHub first, X second** (claim.ts `githubStep`, under the Bench flag).
   - App on: the button is an `app` verify link with the repo-agnostic key `connect/<builder>` (no migration:
     the nonce's `repo_key` is free text). GitHub's install screen is the repo picker (all or selected,
     public and private). Permissions stay Contents: read + Metadata: read. No OAuth scope is added anywhere;
     X scopes stay `users.read tweet.read`; the GitHub authorize URL carries no `scope`.
   - App off: the existing scopeless `claim` sign-in link, with one line: "Public work only."
3. **After install** (`github-app.ts appSetup` -> `github-connect.ts connectSetup`): the same nonce, cookie and
   OAuth-hop checks as a per-repo App link. The installation's repos are listed with an installation token
   minted per call (no `repositories` list, read-only permissions; never stored or logged). Only repos the
   signed-in login owns (the installation's account, or admin on an org's) are offered.
   - One repo: it gets the `via = 'app'` proof row (what `appTokenFor` reads, so week-facts / person-github /
     proof-branch read its commits with an installation token, private or not) and becomes
     `builder_profiles.main_project_key` (`setMainProject`). Then 303 to the claim page for X.
   - Several: a server-rendered picker (radio list, one button) POSTs to `/github/verify/app/pick`
     (`pickPost`): Origin check, per-page csrf cookie (`__Host-ekv-`), an HMAC-signed 15-minute token carrying
     the builder, installation and login, and the chosen repo re-checked against a fresh listing.
4. **Programs are optional in first run.** `chooseAsk` takes `firstRun` (project not confirmed, or no update
   posted: `weeks === 0`) and then never returns `enter` (which leads to `prepare`'s typed questions).
   Programs still show in "Ways to get funded". `prepare` is unchanged.

## Notes

- `page-joins.ts`: an open `connect/` or `claim/` verify link no longer blocks "fresh and empty", since the
  claim page now mints one on every view (it would otherwise break the reconnect join).
- `github-verify.ts`: `cookieHeaders` helper (keeps `Set-Cookie` literals out of the new module for the
  source-scan test), confirm page copy for a connect link.
- Not done: with the App off, the scopeless sign-in's result page does not link back to the claim page.
- Tests: `signin-github-first.test.ts`; old claim-first copy assertions updated.
