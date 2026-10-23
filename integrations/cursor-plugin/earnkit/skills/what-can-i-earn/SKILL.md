---
name: what-can-i-earn
description: Ask EarnKit what the builder can earn for the project in this folder (grants they fit, their Shipping score, the one next step). Use when the builder asks about grants, funding, prizes or where they stand.
---

# What can I earn?

1. Call the EarnKit `find` tool. Fill `identity` yourself, never ask the builder: `project` is the one project in this
   folder (name and a few plain words on what it is from the README, `repo` from the git remote, `live_url` from the
   README or deploy config) and `github_login` from `gh auth status`.
2. Show `show_to_builder` exactly as written and follow every `agent_note`.
3. A yes or no to its question goes to `tell` with `move_up`.
4. When the builder asks where they stand, call `score`.

The first time, EarnKit asks the builder to sign in with X in the browser. That X account is their EarnKit page.
