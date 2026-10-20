# v3 Stage 1: owner runbook

For the owner. No coding. Do the steps in order. Each step says what you should see and what to do if you do not.

## 1. Set the email key

Resend sends the Monday email. The key never goes in the repo.

1. Open the Railway dashboard, project EarnKit, service `earnkit`, tab Variables.
2. Add `RESEND_API_KEY` with your Resend key. Save.

You should see: Railway offers to redeploy. Say yes (or do step 2, which redeploys anyway).
If it fails: without the key nothing breaks; the email question is simply never asked. You can add the key later.

## 2. Deploy

The branch is `v3-power-user`. Merge it to main the way you normally do, then watch Railway.

You should see: a new deploy of `earnkit` that ends "Active". Each deploy runs `pnpm db:migrate` first (safe to
repeat). To check from your terminal:

```bash
cd /Users/jenil/earnkit
railway logs --service earnkit
```

If it fails: open the failed deploy's logs in Railway and send me the last 30 lines. Do not run anything else yet.

## 3. Rewrite the four existing weeks' points

```bash
cd /Users/jenil/earnkit
railway run --service earnkit -- pnpm feed:rank
```

You should see: one line like `{"rows":4}` (the number of week rows it rewrote), then it exits with no error.
If it fails: run it again once. If it prints `{"rows":0}`, your weeks are older than 12 weeks or not stored; send me
the output. If it fails twice, send me the output.

## 4. Check the site

1. Open https://earnkit.com/feed. You should see your weeks as cards, each with points.
2. Open https://earnkit.com/jenilt. You should see the same weeks, each marked "Not yet confirmed". There is no points
   line yet: it appears only after your first yes in step 6.

If it fails: a blank feed means step 3 did not run; run it again and refresh.

## 5. Connect Grok Bot

1. In Grok Bot, add the MCP connector `https://earnkit.com/mcp`.
2. A browser window opens. Sign in with X there and approve.

Do not ask anything yet.
If it fails: if the browser never opens, remove the connector and add it again.

## 6. Install the App, then ask and say yes

1. Install the EarnKit GitHub App on `earnkitai/earnkit` (GitHub, Settings, Applications, Install; pick that repo). Do
   this before you ask: without the App, EarnKit cannot count the repo, and the reply asks you to install it (with a
   link) instead of showing your weeks.
2. Wait a minute (the App's first read writes your weeks), then in Grok Bot type: `where do I stand`

You should see: the reply starts with "Your last 4 weeks:" (the count is how many of your weeks are not confirmed),
then one line a week such as "Week of Oct 5: 2 commits", then "Where you stand" with your rank and your page link,
and it ends with "Does this look right? Yes posts them."

3. Say `yes`.

You should see: "Done. Your page is live: https://earnkit.com/jenilt". If the email key from step 1 is set, the next
line is "Want the Monday summary by email? Reply with the address." (that is step 8). Your points are not in this
reply: ask `where do I stand` again and the reply carries "Points: N. They convert to $EARN at launch, in proportion to
all points earned."

If it fails: if Grok Bot shows a "Sign in with X" link instead, open it and sign in, then ask again. If the reply
asks you to install the GitHub App (with a link), the install did not take: open that link, install, and ask again.
If the reply has no "Your last" lines, your weeks may still be loading after the install: ask again in an hour. If `yes` gets only "Okay.", the question was already
answered; send me the reply.

## 7. Check the page again

Reload https://earnkit.com/jenilt and https://earnkit.com/feed.

You should see: "Not yet confirmed" gone from the weeks you approved, and your points total under Originality on the
page ("N points", with a small line that points convert to $EARN when it launches).

## 8. Give your email address

Grok Bot asks "Want the Monday summary by email? Reply with the address." Reply with your address.

You should see: "Done. Every Monday, once your week is written."
If it never asks: the key in step 1 is missing, or you are already subscribed. Either way you can say it directly:
tell the agent `send the Monday summary to you@example.com` (with your address). The agent calls tell with
weekly_email { answer: 'yes', email }, which works whether or not you were asked, and EarnKit replies "Done. Every
Monday, once your week is written."

## 9. Monday

From 16:15 UTC on Monday (the email goes out after the weekly facts are written):

1. Open the email with the subject "Your week on EarnKit: Shipping N · #R of T builders". It starts with "Last week you
   finished at Shipping N, #R." and lists last week's lines, then a "Looks right:" link and a "Hide this week:" link.
2. Click the "Looks right" link. A page titled "Your week on EarnKit" opens with one "Looks right" button; click it.

You should see: "Confirmed. Your page shows it." and a "See your page" link. On your page the week loses "Not yet
confirmed" and your points total goes up. "Hide this week" does the opposite: "Hidden. Your page no longer shows this
week." Links work for the last finished week and the one before (two weeks); an older link shows "This link has
expired."
If the email has no links: that week was already confirmed (for example by a yes in Grok Bot). That is fine.
If no email arrives by 17:00 UTC: check spam, then confirm step 1 and step 8, and tell me.

## Test in Claude Code too

```bash
claude mcp add --transport http --scope user earnkit https://earnkit.com/mcp
```

Then open Claude Code, type `/mcp`, pick earnkit, choose Authenticate, sign in with X, and ask "where do I stand".

## Stage 2 go-live

Read this before you set `EARNKIT_RAISING=on`.

1. **The backing offer.** With `EARNKIT_RAISING=on`, the backing offer is the one question of the first reply for
   every ranked builder who has an approved week with code, a confirmed public repo and no coin. That includes your
   own test repos that are not EarnKit's (only `earnkitai/earnkit` itself is excluded). A no is remembered: the offer
   is never asked again for that project.
2. **Backers and Earned.** The backers indexer and the Earned (creator fees) indexer run inside the bonus ledger, so
   they need `CAMPAIGN_PAYOUT_PRIVATE_KEY` (already set). They read Base through the public Base RPC unless
   `BASE_RPC_URL` is set. On the public RPC the first catch-up is slow; the numbers fill in over the next runs.
3. **The outcome ask.** Existing `applied` rows for programs that have closed trigger the one outcome question
   ("Did <program> come back on <project>?") 14 days after the program's deadline, so expect the first ones from about
   Oct 27.
4. **Stats for jenil.ai.** `/api/stats` has four new keys for `get_funnel`: `applications`, `backing_open`, `backers`
   and `earned_usd`. `backing_open` and `backers` read 0 while `EARNKIT_RAISING` is off.
