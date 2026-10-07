# Outcome files

One file per program, `programs/outcomes/<program-id>.json`, written by the weekly routine from the program's published results page (never from a builder's word).
Each result names the entry by `repo`, `name` or `live_url` (at least one), with `result` one of `won`, `placed`, `finalist`, `not_selected`, `unknown`, and `prize_usd` only when the source states it.
`pnpm programs:check` validates these files and `pnpm programs:sync` matches them to EarnKit entries; it prints counts only, never names.

```json
{
  "program_id": "arc-microgrants",
  "round_label": "Arc Microgrants 2026",
  "source_url": "https://community.arc.io/public/events/arc-microgrants-f8tijfjhyq",
  "captured_at": "2026-10-22",
  "results": [
    { "repo": "github.com/alice/tipjar", "result": "won", "prize_usd": 500 },
    { "name": "NanoCrawl", "result": "not_selected" }
  ]
}
```
