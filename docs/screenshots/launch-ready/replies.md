# Agent replies (launch ready UX pass)

Rendered through the real MCP layer (fixtures/mcp-call.ts mcpCall) on a local database, clock fixed at Wed 2026-10-14 12:00 UTC. Only show_to_builder is shown; run suffixes removed.

## 1. Signed out (first find)

`find {}`

```
Where you stand
You're not on the leaderboard yet.

Ways to get funded
Circle Developer Grants: up to $100K for an Arc app, once it's live.
Avalanche Team1 Mini Grants: up to $10K for an Avalanche app.

How to move up
Sign in with X to get your page (one click): https://earnkit.com/signin/cIHreu3OKIKkh5WKdmUQnw
Want me to put your work on the leaderboard once you're in?
```

## 2. Signed in, no project (repo picker), first reply after sign-in

`find {}`

```
Signed in as @ana.

Where you stand
You're not on the leaderboard yet.
Your page: earnkit.com/ana

Ways to get funded
Circle Developer Grants: up to $100K for an Arc app, once it's live.
Avalanche Team1 Mini Grants: up to $10K for an Avalanche app.

How to move up
Install the read-only EarnKit app on the repo you want ranked (one click): https://earnkit.com/github/verify?n=5u9D4mz_Gxmg1Emy9-u25weot82-tuwdg4jZYRgp0Gc
Want me to rank it once that's done?
```

## 3. Not counted (repo named, App not installed)

`find { identity: { project: { name: "Recipes", repo } } }`

```
Signed in as @ben.

Where you stand
Recipes isn't counted yet.
Your page: earnkit.com/ben

Ways to get funded
Circle Developer Grants: up to $100K for an Arc app, once it's live.
Avalanche Team1 Mini Grants: up to $10K for an Avalanche app.

How to move up
Install the read-only EarnKit app on it (one click): https://earnkit.com/github/verify?n=3_XcGXAgum8PZOtfwurMskKVYmF2QZGL-KfUQHPAhow
Want me to count it once that's done?
```

## 4. Ranked, mid-week, nothing shipped yet

`find {}`

```
Where you stand
Recipes: Shipping 35 · #2 of 3 builders this week.
Code in 3 of the last 12 weeks, 3 of the last 4.
Your page: https://earnkit.com/uxme

Ways to get funded
No open program fits Recipes yet. I'll look again next week.

How to move up
Ship code this week: +13 points, enough to pass #1.
```

## 5. Ranked, after shipping this week

`score {}`

```
Where you stand
Recipes: Shipping 48 · #1 of 3 builders this week.
Code in 4 of the last 12 weeks, 4 of the last 4.
Your page: https://earnkit.com/uxme

Ways to get funded
No open program fits Recipes yet. I'll look again next week.

How to move up
Done this week: +13 points. Next week adds up to 14 more.
```

## 6. The weekly moment (first find of the week)

`find {}`

```
Last week you finished at Shipping 50 (+6), #2 (up 1).
Add dark mode · Fix the login loop
This week starts at Shipping 35: ship code to add +13 points, 5 short of #1.

Where you stand
Recipes: Shipping 35 · #2 of 3 builders this week.
Code in 3 of the last 12 weeks, 3 of the last 4.
Your page: earnkit.com/uxmme

Ways to get funded
No open program fits Recipes yet. I'll look again next week.

How to move up
Share your week on X: https://x.com/intent/post?text=My+week+on+EarnKit%3A+Shipping+50+%C2%B7+%232+of+3+builders&url=https%3A%2F%2Fearnkit.com%2Fuxmme
Does last week look right?
```

## 7. Yes to the share offer

`tell { move_up: { kind: 'share', answer: 'yes' } }`

```
Thanks. Last week is confirmed.
```

## 8a. App setup page after the picker (text)

```
Done. EarnKit now ranks github.com/jon/beta on earnkit.com/jon.
Go back to your agent and say yes. To rank a different repo, tell your agent.
Not your page? Remove the EarnKit app from these repos in your GitHub settings: https://github.com/settings/installations
```

## 8b. find right after the picker setup

`find {}`

```
Where you stand
Beta: Shipping 27 · #3 of 4 builders this week.
Code in 2 of the last 12 weeks, 2 of the last 4.
Your page: https://earnkit.com/jon

Ways to get funded
No open program fits Beta yet. I'll look again next week.

How to move up
Done this week: +14 points. Next week adds up to 14 more.
```

## 8c. tell main_project: switch to another proven repo

`tell { main_project: "github.com/jon/alpha" }`

```
EarnKit now ranks github.com/jon/alpha.
```

## 8d. tell main_project: a repo not connected yet

`tell { main_project: "jon/gamma" }`

```
github.com/jon/gamma isn't connected yet. Install the read-only EarnKit app on it (one click): https://earnkit.com/github/verify?n=oT-B3kIzfGJfaQTkH7hfOVickCdF8y8mv1k5WiKC8U8
Want me to rank it once that's done?
```

## 9. Asking about a token (launches off here)

`tell { token: 'ask' }`

```
A token isn't available for Alpha right now.
```

## 10. find with programs that fit (one dated, two rolling)

`find {}`

```
Where you stand
Kit: Shipping 0 · #5 of 5 builders this week.
No code in the last 12 weeks.
Your page: https://earnkit.com/kit

Ways to get funded
Dated Hackathon: up to $25K, closes Nov 20. You deployed on Monad.
Circle Developer Grants: up to $100K, rolling. Your app is live.
Base Builder Grant Program: up to $5K, rolling. You deployed on Base and your app is live.

How to move up
Ship code this week: +14 points, enough to pass #4.
```
