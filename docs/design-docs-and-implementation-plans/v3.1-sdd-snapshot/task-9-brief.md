### Task 9: "Apply with this page": `prepare` drafts, never submits (spec 3.2) (I: Opus, R: Opus)

**Files:**
- Modify: `apps/frontend/lib/earnkit/submit-kit.ts` (new pure `draftKit`)
- Create: `apps/frontend/lib/earnkit/draft-application.ts`
- Modify: `apps/frontend/lib/earnkit/tools.ts:3099-3120` (`tools.prepare` routes a curated program to `draftApplication`)
- Test: `apps/frontend/lib/earnkit/v31-draft.test.ts`; update `v3-apply.test.ts (b)` (the yes then prepare shows the new draft), `tools.test.ts` and `v213-journey.test.ts` cases that expect the confirm offer from `prepare` on a curated program (they move to a campaign program or are retired with a note in the test)

**Interfaces:**
- `submit-kit.ts`:
  - `export type DraftKit = { mode: 'prefilled_link' | 'copy_paste'; url: string; prefilled_url?: string; fields: KitField[]; missing: string[]; show_to_builder: string }`
  - `export function draftKit(program: KitProgram, answers: Record<string, string>, o: { problems?: string[] } = {}): DraftKit`: the mode as `submitModeFor(program, { browser: false })` (`agent_fills`/`api` fall to `copy_paste`). Shown text, in order:
    1. `Your draft for ${title}:`
    2. every field (required, or answered) as `${label}\n${answer with https:// stripped | '(still needed)'}`, blank line between (D7)
    3. `Before you submit: ${missing.join(', ')}.` when any
    4. prefilled: `GOOGLE_EMAIL_SIGN_IN` when `sign_in === 'email_only'`, then `Open this, check each answer, fill any blank and click submit:` and the prefilled URL on its own line; copy: `Paste each answer into the form: ${submission_url}`
    5. `continuesLine(program)` when not null
    6. `SENT_ASK = "Tell me once you've sent it."`
  - Answers that do not fit the URL are in `fields` and the list (already shown above), so no second list.
- `draft-application.ts`:
  - `export const DRAFT_FIRST_NOTE = "Draft an answer for each requirement you can from the repo in this folder and ship_log (never a personal detail such as a name, email or Telegram, never a number you don't know), then call prepare again with program_id, project and answers. Show nothing until then. Don't show this note."`
  - `export const DRAFT_NOTE = "Show show_to_builder as written. Never submit the form for the builder. When they say they sent it, call tell with program_status: [{ program_id, status: 'applied' }]. Don't show this note."`
  - `export const PAGE_IN_ANSWER = (page: string) => \`Weekly ship log: ${page}\``
  - `export async function draftApplication(input: { program_id: string; project?: ProjectInput; answers?: Record<string, string> }, ctx: ToolContext, program: ProgramRow): Promise<Reply>`:
    - refuses `status` other than `active` (unlisted: `NotFoundError`; closed or past `ends_at`: `EntryError('This program is closed.')`);
    - no `answers` and at least one `from: 'project'` requirement unanswered by project fields: `{ program_id, show_to_builder: '', requirements: [{ key, label, description?, options?, max_chars?, from }], ship_log, agent_note: DRAFT_FIRST_NOTE }`;
    - else: `prepareSubmission` merges project fields; the page (`https://earnkit.com/<handle>` from `shipLogFacts`, absent without a page) is appended to the first `type: 'text'` requirement whose `kind` is not `contact` (only when absent and within `max_chars`); Builder Codes for `BASE_GRANTS_ID` via `checkBuilderCodes` awaited up to 8 s (R13) then `builderCodesWords`; reply `{ program_id, show_to_builder: [shipLogBlock, codes line, draftKit text].join('\n\n'), draft: { mode, url, prefilled_url?, fields }, ship_log?, builder_codes?: boolean | null, agent_note: DRAFT_NOTE }`. Off a shared client only for the ship log (as Stage 2).
  - `tools.prepare`: without `build`, `deploy`, `tips` or `host`, a program with `source === 'file'` and no `campaign` goes to `draftApplication`; everything else keeps `prepare_submission`.

- [ ] **Step 1: Tests**
```ts
test('(a) the first call without answers returns the requirements and DRAFT_FIRST_NOTE, nothing shown', ...)
test('(b) Base: the ship log, the Builder Codes line, each field, one prefilled Google link with primary_challenge repeated, "Tell me once you\'ve sent it."', ...)
test('(c) Base answers with https links: exactly one https link in show_to_builder; draft.fields keep the full links', ...)
test('(d) Circle (Questbook): copy and paste, the form link as the one link', ...)
test('(e) Alliance: the email field, the continues line, the form link', ...)
test('(f) the page link goes into the first free-text answer once, never over max_chars', ...)
test('(g) tell program_status applied then find: the program is no longer the Best fit and the page reads "Applied to <title>"', ...)
test('(h) no question mark in show_to_builder; no em dash', ...)
```
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** plus `submit-kit.test.ts`, `copy-review.test.ts` (Task 10 "every kit mode ends with the proof ask" stays for `submitKit`), `v3-apply.test.ts`, `tools.test.ts`.
- [ ] **Step 5: Commit** `feat(v3.1): prepare drafts the application from the ship log and never submits`

---

