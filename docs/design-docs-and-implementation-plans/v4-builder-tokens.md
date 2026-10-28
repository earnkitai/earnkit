# EarnKit v4: builder tokens and the tokens.fun rail (2026-10-28)

Owner-approved in one session (2026-10-28). tokens.fun's side: `minidevai/tokens.fun` branch `v3-earnkit-revamp`,
`docs/v3-earnkit-revamp.md`.

## Rulings

- EarnKit gets builders paid for building: grants and programs are the value. The token is a feature, never the pitch.
- One token per builder (per X account), named after the builder, ticker from their X handle. Base, Clanker v4, paired
  with WETH. Fees after Clanker's 20%: builder 40, EarnKit Safe 60. MINI's 10% ended.
- Default opt-in, asked once inside setup step 3 together with the wallet. Signing the wallet launches the token
  immediately; "no" means never again. Skipping the wallet skips the token; "launch my token" later works.
- The wallet is asked of everyone in setup (where grants and community support get paid), before the token, so the
  reward recipient is set at launch.
- Claims are sponsored: EarnKit's hourly ledger claims for builders (anyone may pay the gas). Builders hear the amount
  in plain words, never the token's name.
- Words: "token", never "coin"; "back" and "holders" (launchpad-standard); never "bet". No jargon, never sell the tech.
- The Token card on the builder page is the approved navy TokenCard, with "Trade"/"holders" wording and the builder's
  X photo in the circle.
- Safe cash-out is money-bound: at >= $5,000 the owner gets one email with a ready WETH to USDC Safe transaction.
- Replies render rich markdown (tables, lists, bold) on Grok Bot and plain "Label: value" lines on WhatsApp agents.
- Tone: a friendly, encouraging mentor. Warm, informal, never cold statements, never over the top.

## Approved copy

1. Before sign-in

```
**EarnKit gets you paid for building.**

Every week I read what you ship, rank you against other builders, and find grants and programs you qualify for. Up to $5,000 is open from Base right now.

Setup takes about a minute:
1. Sign in with X: {link}
2. Connect your code
3. Add your wallet

Done with step 1?
```

2. After sign-in (the Lovable/Bolt line only when they have no GitHub; never assumed)

```
You're in, @maya. Really glad you're here.

**Step 2 of 3:** connect your app's code on GitHub so I can match you to the right programs. Read-only, one click: {link}

[no GitHub only] Built it in Lovable or Bolt? Connect GitHub there first (Lovable: Project settings, then Git. Bolt: the GitHub icon, top right).

Done?
```

3. Wallet and token

```
MealMate is connected. One last step.

**Step 3 of 3:** sign with your wallet. It's where your grants and community support get paid. One signature, no fee: {link}

Once you sign, your token goes live so people who believe in your work can back it, and 40% of every trade's fee goes straight to you. Rather skip the token? Just say no.

Done?
```

4. Setup done
- Signed: "You're all set, Maya. Your community can now back what you're building." + "Here's what's open for you right now:" + program table (Program | Up to | Closes) + "Base looks like your best fit. Want me to draft it?"
- Said no: "No problem, no token. Here's what's open for you right now:" + the same.
- Skipped the wallet: "No worries, add it whenever you're ready. Here's what's open for you right now:" + the same.

5. Every Monday (agent routine and email)

```
Your week is ready, Maya. You shipped the new meal planner. Nice work.

| | This week |
|---|---|
| Shipping score | 82, up 4 |
| Streak | 5 weeks |
| From your community | $46, already in your wallet |

Your post is ready to share: {link}

Looks right?
```

Community row: none at $0; "$12, already in your wallet." when small; at $100+ or double last week, add under the
table "People really believe in what you're shipping."

6. Nudges (at most one a week)

| When | Line |
|---|---|
| Nothing shipped by Friday | Quiet week? No stress. Ship anything small by Sunday and your 5-week streak stays alive. |
| A program closes within 3 days | Heads up, Arc Builders closes Friday. Your draft is ready. Want to send it? |
| Milestone | MealMate just passed 100 users. That's real traction, and it makes your Base application a lot stronger. |
| Accepted or funded | You got into Arc Builders. Huge, well earned. Want to share it? {link} |

Open: the one-time risk line ("Prices move and can go to zero.") under "You're all set", owner's call.

## Build

- E1 the 60/40 split accepted, launches Base only, claims without MINI or the bonus wallet.
- E4 public read for tokens.fun: builders with tokens (handle, name, photo, Shipping, page URL).
- E2 setup copy above; wallet step for everyone; token at the wallet step (default opt-in, instant on signature, no
  never again); one token per X account named after the builder; delete the per-project offers (`coin_moments`
  flows, `token_offers`, `token_declines`); support amounts in replies.
- E3 Token card wording and the X photo.
- E5 the weekly post card carries the token. E6 `?ref=tokensfun`.
- E7 Safe >= $5,000 email with the WETH to USDC transaction; low gas wallet email.
- Reply rendering per surface (rich on Grok Bot, plain on WhatsApp agents).
