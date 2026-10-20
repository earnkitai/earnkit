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

You should see: a short list of weeks being ranked, then it exits with no error.
If it fails: run it again once. If it fails twice, send me the output.

## 4. Check the site

1. Open https://earnkit.com/feed. You should see your weeks as cards, each with points.
2. Open https://earnkit.com/jenilt. You should see the same weeks, a points line, and "Not yet confirmed" on weeks you
   have not approved.

If it fails: a blank feed means step 3 did not run; run it again and refresh.

## 5. Connect through Grok Bot

1. In Grok Bot, add the MCP connector `https://earnkit.com/mcp`.
2. A browser window opens. Sign in with X there and approve.
3. Back in Grok Bot, type: `where do I stand`

You should see: your standing and your last weeks, then the line "Does this look right? Yes posts them."
If it fails: if Grok Bot shows a "Sign in with X" link instead, open it and sign in, then ask again. If the browser
never opens, remove the connector and add it again.

## 6. Install the App and say yes

1. Install the EarnKit GitHub App on `earnkitai/earnkit` (GitHub, Settings, Applications, Install; pick that repo).
2. In Grok Bot, say `yes`.

You should see: the weeks are posted, and a "Points:" line appears with your total.
If it fails: say `where do I stand` again. If it still asks the same question, send me the reply.

## 7. Check the page again

Reload https://earnkit.com/jenilt and https://earnkit.com/feed.

You should see: "Not yet confirmed" gone from the weeks you approved, and your points total on the page.

## 8. Give your email address

Grok Bot asks "Want the Monday summary by email? Reply with the address." Reply with your address.

You should see: a one-line confirmation.
If it never asks: the key in step 1 is missing, or you already answered once.

## 9. Monday

From 16:15 UTC on Monday (the email goes out after the weekly facts are written):

1. Open the email "Last week". It lists last week's lines.
2. Click "Looks right". A page opens with one button; click it.

You should see: a confirmation page, and the week on your page loses "Not yet confirmed" and earns its points.
"Hide this week" does the opposite: the week disappears from the public page. Links work for 14 days.
If no email arrives by 17:00 UTC: check spam, then confirm step 1 and step 8, and tell me.

## Test in Claude Code too

```bash
claude mcp add --transport http --scope user earnkit https://earnkit.com/mcp
```

Then open Claude Code, type `/mcp`, pick earnkit, choose Authenticate, sign in with X, and ask "where do I stand".
