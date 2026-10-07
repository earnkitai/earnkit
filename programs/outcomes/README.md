# Outcome files

One file per program, `programs/outcomes/<program-id>.json`, written by the weekly routine from the program's published results page (never from a builder's word).
Each result names the entry by `repo`, `name` or `live_url` (at least one), with `result` one of `won`, `placed`, `finalist`, `not_selected`, `unknown`, and `prize_usd` only when the source states it; `complete` is `true` only when the announcement names every winner (every other EarnKit entry then becomes `not_selected`, else `unknown`, which never counts).
Each file names its round's window as UTC days, both inclusive: `entries_from` is the round's first day and `entries_until` its deadline, both required when `complete` is `true` (optional otherwise). Only entries submitted inside the window are labelled, and only they can become `not_selected`, so an entry made after the round closed (already in the next round of a rolling program) is never labelled in this one. An entry another round's file already labelled is never labelled again as `not_selected` or `unknown` here.
`pnpm programs:check` validates these files and `pnpm programs:sync` labels every submitted EarnKit entry of the program; it prints counts only, never names, and a committed `round_label` never changes.

```json
{
  "program_id": "arc-microgrants",
  "round_label": "Arc Microgrants 2026",
  "source_url": "https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq",
  "captured_at": "2026-10-22",
  "complete": true,
  "entries_from": "2026-09-15",
  "entries_until": "2026-10-14",
  "results": [
    { "repo": "github.com/alice/tipjar", "result": "won", "prize_usd": 500 },
    { "name": "NanoCrawl", "result": "not_selected" }
  ]
}
```
