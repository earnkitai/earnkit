# Starter tables (kept, commented `archived v2.12`, no writes while the flag is off)

Rows stay. Nothing is dropped.

## starters

A program file's optional build ideas, replaced on every `programs:sync` while the flag was on.

| Column | Meaning |
|---|---|
| `id` | Serial key |
| `program_id` | The program (deleted with it) |
| `track_id` | The track it belongs to, `<program id>/<track slug>`, or null (deleted with the track) |
| `title` | The idea's title |
| `what_to_build` | What to build |
| `requirements` | Its requirements, as text |
| `build_context` | Links and labels for the build, as JSON (`[{ label, url? }]`) |
