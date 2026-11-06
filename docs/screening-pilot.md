# The screening pilot

A program sends EarnKit its last cohort's applicant list. EarnKit reads each applicant's public evidence and
returns the list sorted into five named tiers, each applicant with the facts that placed it. The program tells
us where the sort was wrong; those corrections set the thresholds before screening is a tool.

## The message to send a program

> Send me your last cohort's applicant list; I return it sorted with evidence in 48 hours; tell me where I was wrong.

## The CSV

One header row, then one applicant per row. Columns are matched by name, any case; extra columns are ignored.

| Column (any of) | What goes in it |
|---|---|
| `ref`, `id` | The program's own id for the applicant (default: the row number) |
| `name`, `project` | The project's name |
| `repo`, `github`, `repo_url` | A GitHub repo link (`github.com/owner/name`) |
| `url`, `website`, `live_url`, `site` | The live site |
| `contract`, `contracts`, `address` | `chain:0x...` pairs, comma or space separated; a bare `0x...` is on `--chain` |
| `pitch`, `description`, `summary` | The pitch text, used only to spot copies |

A list needs at least one of the repo, site or contract columns. A bad cell never stops the run: a GitLab link, a
GitHub account instead of a repo, an address that is not 40 hex characters or an unknown chain is dropped and
named in the report. With no repo given, EarnKit takes the first repo the site links to.

## The command

```bash
export GITHUB_TOKEN=...      # optional: raises the GitHub limit
pnpm screen applicants.csv --program base-builder-grants --chain base
```

| Option | Use |
|---|---|
| `--program <id>` | The program's id; names the files |
| `--chain <slug>` | The chain for bare addresses (default `base`) |
| `--out <dir>` | Where the two files go (default `.screen-out/screen` in the repo, or `$EARNKIT_SCREEN_OUT/screen`) |
| `--no-cache` | Read everything again instead of using reads under 7 days old |
| `--thresholds <json>` | Override a threshold, for example `{"used_funded_senders":10}` |

It prints one line per applicant as it reads (`ref name: tier`), then the totals, the reads used and where it
wrote `<program>-<date>.md` and `<program>-<date>.csv`. About 6 seconds an applicant (the 8-row sample took 49 seconds).

## The tiers

| Tier | Means |
|---|---|
| used | The site loads and 25 or more wallets paying their own gas used one mainnet contract in 90 days. |
| live | The site loads, or a mainnet contract has transactions in 90 days. |
| building | Commits in the public repo in the last 90 days, nothing live yet. |
| flagged | A rule fired: mostly a known starter, a fork with little own work, a pitch others sent, shared contributors, or farmed wallets. |
| unverified | Nothing recent EarnKit could check. |

A project with a repo also needs a push in the last 60 days for used. Each applicant's report names the rule or
the facts that placed it. A flag is a reason to look, not a verdict.

## What is read, and what is never read or shown

Read, all public: whether the site loads and links a GitHub repo, the domain's age; the public repo's commits,
contributors, fork parent, starter overlap, tests and releases; mainnet contracts on Base, Ethereum, Arbitrum,
Optimism, Polygon and Arc through public explorers, their transactions and senders.

Never read: private repos, anything behind a login, a wallet's history beyond its first transactions (read only
to see whether it paid its own gas).
Never shown: the pitch text (it is compared to the other pitches in the same list, then dropped), anything
about a person beyond public GitHub logins counted inside the list.

## Who sees the results

The results are private to the program that sent the list. EarnKit does not publish them, does not show one
program's list to another, and does not tell the applicants.
