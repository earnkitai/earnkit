### Task 8: program facts: `unlisted`, off-thesis programs out, Base's `primary_challenge` (I: Opus, R: Opus)

**Files:**
- Modify: `apps/frontend/lib/earnkit/program-file.ts:65` (`type` adds `'multi_choice'`), `:101` (refine: `multi_choice` needs options), `:387` (status adds `'unlisted'`), superRefine (unlisted follows the active rules)
- Modify: `apps/frontend/db/schema.sql` (append), `apps/frontend/lib/earnkit/programs.ts` (`ProgramRow.status` type), `apps/frontend/lib/earnkit/landing.ts:257` (`readGuideIds`: `AND status <> 'unlisted'`), `apps/frontend/lib/earnkit/submission.ts:54` (multi_choice check), `apps/frontend/lib/earnkit/submit-kit.ts:171-182` (`fillable`: one pair per option)
- Modify: `programs/avalanche-team1-mini-grants.json`, `programs/ethglobal-mumbai.json` (`"status": "unlisted"`), `programs/base-builder-grants.json` (`primary_challenge`: `"type": "multi_choice"`, `"options"` as the live form shows them; `form.fields.primary_challenge: "entry.475374687"`; `form.read_at` and `verified_at` the day the form is re-read), `programs/README.md` (`unlisted`, `multi_choice`)
- Test: `apps/frontend/lib/earnkit/v31-programs.test.ts`; update tests that load the two unlisted files as open programs: `also-qualifies`, `coach`, `copy-review`, `guide`, `fresh-build`, `move-up`, `programs`, `program-file`, `present`, `tools`, `v3-programs`, `v281-journey`, `v3-profile` (`.test.ts`; switch them to another committed program or to a fixture copy with `status: 'active'`)

**Interfaces:**
- Schema append:
  ```sql
  -- v3.1: an unlisted program (off-thesis) keeps its row for old entries; nothing lists, matches, counts or guides it.
  ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_status_check;
  ALTER TABLE programs ADD CONSTRAINT programs_status_check CHECK (status IN ('active', 'closed', 'upcoming', 'unlisted'));
  ```
- `multi_choice`: the answer is options joined by `"; "`; each part must be one of `options` (`Must be one of: <options>.` otherwise); prefill repeats the param once per option (`entry.475374687=User+acquisition&entry.475374687=Go-to-market+strategy`).
- Re-read https://docs.google.com/forms/d/e/1FAIpQLSeEFi9BLm5XCm7KrFzRZC-rxcAqCNZPzWZ9He4aZkxsKuRXjw/viewform before editing: copy the six options exactly as the form spells them; if the field id or options differ from the research, the form wins.
- **Task 8b (owner-gated, D4):** when the owner pastes the Alliance form questions after the email step, mirror each into `alliance-all19.json` `submission_requirements` (key, label verbatim, type, required, kind, todo, from), `verified_at` that day; `pnpm programs:check`.

- [ ] **Step 1: Tests**
```ts
test('(a) an unlisted program: not in listPrograms, the landing, /api/stats open money, find or score; its guide is a 404', ...)
test('(b) prepare on an unlisted program refuses (NotFoundError)', ...) // R15, wired in Task 9
test('(c) multi_choice: validation, and a Google prefill with the param repeated per option', ...)
test('(d) pnpm programs:check passes (spawn) and the two files are unlisted', ...)
test('(e) the money total no longer counts Avalanche', ...)
```
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** plus `pnpm programs:check`, `schema-rerun.test.ts`, the listed files.
- [ ] **Step 5: Commit** `feat(v3.1): unlisted programs; Avalanche and ETHGlobal Mumbai out; Base's primary challenge prefills`

---

