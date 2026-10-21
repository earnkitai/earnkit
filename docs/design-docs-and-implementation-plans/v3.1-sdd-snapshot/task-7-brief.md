### Task 7: Builder Codes check for Base Builder Grants (I: Opus, R: Opus)

**Files:**
- Modify: `apps/frontend/lib/earnkit/builder-code.ts` (pure detector and copy)
- Create: `apps/frontend/lib/earnkit/builder-codes-check.ts`
- Modify: `apps/frontend/db/schema.sql` (append), `apps/frontend/lib/earnkit/bench-find.ts` (fill `BestFit.codes`)
- Test: `apps/frontend/lib/earnkit/v31-builder-codes.test.ts` (fake GitHub through `fixtures/fake-github.ts` and `fixtures/app-install.ts`)

**Interfaces:**
- `builder-code.ts`:
  - `export const BUILDER_CODES_SUFFIX = '80218021802180218021802180218021'`
  - `export function builderCodesIn(text: string): boolean`: true on `ox/erc8021`, `Attribution.toDataSuffix`, `/\bdataSuffix\s*:/`, or `/0x[0-9a-f]*80218021802180218021802180218021\b/i`.
  - `export const BASE_GRANTS_ID = 'base-builder-grants'`
  - `export const builderCodesFound = (repo: string) => \`Builder Codes found in ${repo}.\``
  - `export const BUILDER_CODES_FIRST = 'First step for Base: add Builder Codes. Guide: docs.base.org/base-chain/builder-codes/builder-codes'`
- Schema append:
  ```sql
  -- v3.1: whether a repo carries Base Builder Codes (ERC-8021), read through the read-only App, once a day.
  CREATE TABLE IF NOT EXISTS repo_builder_codes (repo_key text PRIMARY KEY, found boolean NOT NULL, checked_at timestamptz NOT NULL);
  ```
- `builder-codes-check.ts`:
  - `export const BUILDER_CODES_FILES = 30`, `BUILDER_CODES_TTL_MS = 86_400_000`.
  - `export function codePaths(paths: string[]): string[]` (pure): blobs ending `.ts .tsx .js .jsx .mjs .cjs`, not `.d.ts`, not under `node_modules/ dist/ build/ out/ .next/ coverage/ vendor/`, not `*.test.*`/`*.spec.*`; paths naming `wagmi|viem|config|provider|client|tx|transaction|contract|wallet|onchain` first, then shorter paths; at most `BUILDER_CODES_FILES`.
  - `export async function checkBuilderCodes(builderId: number, repoKey: string, now: Date, deps?: { fetch?: typeof fetch }): Promise<boolean | null>`: `appClient` (null → null), tree `GET /repos/{key}/git/trees/HEAD?recursive=1`, read each path from `codePaths` (`/contents/...`, base64), stop at the first hit; upserts `repo_builder_codes`; null on any failure (nothing stored).
  - `export async function builderCodesKnown(repoKey: string, now: Date): Promise<{ found: boolean; fresh: boolean } | null>` (cache read; never throws).
  - `export function builderCodesWords(repo: string, found: boolean | null): string | null` → found: `builderCodesFound(repo)`; false: `BUILDER_CODES_FIRST`; null: null.
- `benchView`: when `best.program_id === BASE_GRANTS_ID`, `codes` from the cache; a missing or stale row starts `checkBuilderCodes` in the background (not awaited) for the next reply.

- [ ] **Step 1: Tests**
```ts
test('(a) builderCodesIn: each of the four signals, and a plain viem call without dataSuffix is false', ...)
test('(b) codePaths ranks and caps; skips node_modules, tests and .d.ts', ...)
test('(c) checkBuilderCodes finds the import in the 3rd file, stores found=true; the Best fit line then says "Builder Codes found in maya/app."', ...)
test('(d) App off, a 404 tree, or a timeout: null, nothing stored, no Builder Codes words', ...)
test('(e) none found: the line ends with the guide, no https, no trailing period', ...)
```
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** plus `schema-rerun.test.ts`, `v31-best-fit.test.ts`.
- [ ] **Step 5: Commit** `feat(v3.1): Builder Codes check for Base Builder Grants`

---

