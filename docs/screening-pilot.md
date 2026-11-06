# The screening pilot

A program sends EarnKit its last cohort's applicant list. EarnKit reads each applicant's public evidence and
returns the list sorted into five named tiers, each applicant with the facts that placed it. The program tells
us where the sort was wrong; those corrections set the thresholds before screening is a tool.

## The message to send a program

> Send me your last cohort's applicant list; I return it sorted with evidence in 48 hours; tell me where I was wrong.

## The CSV

One header row, then one applicant per row. Columns are matched by name: any case, spaces and dashes read as
underscores and a trailing `URL` is dropped, so `GitHub URL`, `Project Name` and `Contract Address` all map.
Extra columns are ignored.

| Column (any of) | What goes in it |
|---|---|
| `ref`, `id` | The program's own id for the applicant (default: the row number); a repeated one becomes `ek-3 (2)` and is named |
| `name`, `project`, `project name` | The project's name |
| `repo`, `github`, `repo url`, `github url` | A GitHub repo link (`github.com/owner/name`) |
| `url`, `website`, `live url`, `site` | The live site |
| `contract`, `contracts`, `address`, `contract address` | `chain:0x...` pairs, comma or space separated; a bare `0x...` is on `--chain` |
| `pitch`, `description`, `summary` | The pitch text, used only to spot copies; a pitch under 10 words is a placeholder and never compared |

A list needs at least one of the repo, site or contract columns. A bad cell never stops the run: a GitLab link, a
GitHub account instead of a repo, an address that is not 40 hex characters or an unknown chain is dropped and
named in the report. With no repo given, EarnKit takes a repo the site links to: never one owned by a starter or
SDK (Coinbase, Base, Vercel, Scaffold-ETH, wevm, Rainbow, Foundry, Hardhat, Solana, Circle, Privy, thirdweb), one
sharing a word with the domain or project name first, else the first left. The report names it (`repo taken from
the site link: owner/name`) so the reviewer can check it.

## The command

```bash
export GITHUB_TOKEN=...      # required: your own personal token, never the server's
pnpm screen applicants.csv --program base-builder-grants --chain base
```

The GitHub token is required: without one GitHub allows 60 requests an hour, a few applicants' worth. Use a
personal token (no scopes needed for public repos), never the server's: the run would spend the hourly allowance
the live service needs. The run shares one allowance across all applicants and stops reading GitHub when under 500
requests are left; the applicants after that are marked `not read: budget` and read again on the next run.

| Option | Use |
|---|---|
| `--program <id>` | The program's id; names the files |
| `--chain <slug>` | The chain for bare addresses (default `base`) |
| `--out <dir>` | Where the two files go (default `.screen-out/screen` in the repo, or `$EARNKIT_SCREEN_OUT/screen`) |
| `--no-cache` | Read everything again instead of using reads under 7 days old |
| `--thresholds <json>` | Override a threshold, for example `{"used_funded_senders":10}` |

It prints one line per applicant as it reads (`ref name: tier`), then the totals, the reads used and where it
wrote `<program>-<date>.md` and `<program>-<date>.csv`. Time is mostly the explorers: they are read at 5 requests
a second, and a busy contract costs 130 to 230 explorer requests (its transactions, then the first transactions of
50 sampled senders), so about 25 to 45 seconds each. An applicant with no contract takes a few seconds. Expect roughly 1 to
3 hours for 200 applicants, depending on how many list busy contracts.

## The tiers

| Tier | Means |
|---|---|
| used | The site loads and 25 or more wallets the deployer did not fund used one counted mainnet contract in 90 days. |
| live | The site loads, or a counted mainnet contract has transactions in 90 days. |
| building | Commits in the public repo in the last 60 days, nothing live yet. |
| flagged | A rule fired: a known starter with under 10 files of the project's own, a fork of a starter with under 20 commits after the fork (a fork of anything else: under 20% own work), a pitch others sent, shared contributors, or farmed wallets. |
| unverified | Nothing recent EarnKit could check. |

A project with a repo also needs a push in the last 60 days for used. Each applicant's report names the rule or
the facts that placed it. A flag is a reason to look, not a verdict.

A contract counts toward the tier only when it is plausibly the project's: its deployer is named in the repo, it
was created by the repo's own deploy runs (`broadcast/`, `ignition/deployments/`), or it was deployed after the
repo's first commit. A contract the repo only names (a router, Permit2, the 4337 EntryPoint, Multicall3, a price
feed) is shown as `named in the repo, not counted`. A listed contract counts unless its deployer is not in the repo
and it predates the repo (`claimed`). For a fork, the team and the recent commits are only the commits after the
fork point; for a project built from a starter, the starter's maintainers are not counted as its team.

Usage through a smart wallet or a paymaster (Coinbase Smart Wallet and other calls through the 4337 EntryPoint)
is not read in v6.0: those users reach the contract through a bundler, so a product used only that way reads as
fewer senders than it has.

## What is read, and what is never read or shown

Read, all public: whether the site loads (https only) and links a GitHub repo, the domain's age; the public repo's
commits, contributors, fork parent, starter overlap, deploy runs, tests and releases; mainnet contracts on Base, Ethereum, Arbitrum,
Optimism, Polygon and Arc through public explorers, their transactions and senders.

Never read: private repos, anything behind a login, a wallet's history beyond its first transactions (read only
to see whether the deployer funded it).
Never shown: the pitch text (it is compared to the other pitches in the same list, then dropped), anything
about a person beyond public GitHub logins counted inside the list.

## Who sees the results

The results are private to the program that sent the list. EarnKit does not publish them, does not show one
program's list to another, and does not tell the applicants.
