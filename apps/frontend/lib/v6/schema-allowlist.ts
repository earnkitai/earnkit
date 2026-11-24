/**
 * The inventory of every statement in db/schema.sql that trips a schema-guard.ts rule but is safe to rerun on
 * every deploy (idempotent drop-then-add pairs, DROP NOT NULL, NULL-only backfills, DO blocks). Keyed by the exact
 * normalized statement (schema-guard.ts normalize: comments stripped, whitespace collapsed): editing one of these
 * statements, or adding a new destructive one, fails the test and the deploy until it is reviewed and listed here.
 * Order follows the file. Add an entry only for a statement that is idempotent and loses no data on a rerun.
 */
export const SCHEMA_ALLOWLIST: readonly { why: string; sql: string }[] = [
  // DROP
  {
    why: "programs: relaxes NOT NULL on legacy columns the file-backed rows no longer fill (DROP NOT NULL only, idempotent).",
    sql: "DO $$ DECLARE c text; BEGIN FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'programs' AND is_nullable = 'NO' AND column_name NOT IN ('id', 'source', 'status', 'created_at', 'updated_at') LOOP EXECUTE format('ALTER TABLE programs ALTER COLUMN %I DROP NOT NULL', c); END LOOP; END $$",
  },
  // UPDATE
  {
    why: "programs: maps a legacy status onto the three allowed ones; a no-op once every row is active/upcoming/closed.",
    sql: "UPDATE programs SET status = 'closed' WHERE status NOT IN ('active', 'upcoming', 'closed')",
  },
  // UPDATE
  {
    why: "programs: one-time backfill of `file` from the row; a no-op on rerun (WHERE file IS NULL).",
    sql: "UPDATE programs SET file = jsonb_strip_nulls( to_jsonb(programs) - ARRAY['file', 'source', 'created_at', 'updated_at', 'stale_since', 'opened_at', 'match_floor', 'match_precision', 'form'] ) || jsonb_build_object( 'starts_at', to_char((to_jsonb(programs) ->> 'starts_at')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), 'ends_at', to_char((to_jsonb(programs) ->> 'ends_at')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')) WHERE file IS NULL",
  },
  // DROP
  {
    why: "programs: drop-then-add of the status CHECK so it can be re-created with the current list (paired with the ADD right after).",
    sql: "ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_status_check",
  },
  // DROP
  {
    why: "cron_state.last_run_at NULL allowed (v6.1.19 Task 6); relaxing, idempotent.",
    sql: "ALTER TABLE cron_state ALTER COLUMN last_run_at DROP NOT NULL",
  },
  // DROP
  {
    why: "sent_asks: old (installation, program) primary key replaced by the unique index with project_id (v6.1.22); IF EXISTS.",
    sql: "ALTER TABLE sent_asks DROP CONSTRAINT IF EXISTS sent_asks_pkey",
  },
  // DROP
  {
    why: "builders.github_id NULL allowed (X-only builders); relaxing, idempotent.",
    sql: "ALTER TABLE builders ALTER COLUMN github_id DROP NOT NULL",
  },
  // DROP
  {
    why: "builders.login NULL allowed (X-only builders); relaxing, idempotent.",
    sql: "ALTER TABLE builders ALTER COLUMN login DROP NOT NULL",
  },
  // DO block
  {
    why: "builders_one_account CHECK added once (IF NOT EXISTS guard in the block); additive.",
    sql: "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'builders_one_account') THEN ALTER TABLE builders ADD CONSTRAINT builders_one_account CHECK ( (github_id IS NOT NULL OR x_user_id IS NOT NULL) AND ((github_id IS NULL) = (login IS NULL)) AND ((x_user_id IS NULL) = (x_handle IS NULL))); END IF; END $$",
  },
  // UPDATE
  {
    why: "applications.owner backfill; WHERE owner IS NULL makes it a no-op on rerun.",
    sql: "UPDATE applications SET owner = 'i:' || installation_id WHERE owner IS NULL",
  },
  // UPDATE
  {
    why: "application_history.owner backfill; WHERE owner IS NULL makes it a no-op on rerun.",
    sql: "UPDATE application_history SET owner = 'i:' || installation_id WHERE owner IS NULL",
  },
  // UPDATE
  {
    why: "gaps_done.owner backfill; WHERE owner IS NULL makes it a no-op on rerun.",
    sql: "UPDATE gaps_done SET owner = 'i:' || installation_id WHERE owner IS NULL",
  },
  // SET NOT NULL
  {
    why: "owner SET NOT NULL on three tables, only when no NULL is left (after the backfills above); a no-op once set.",
    sql: "DO $$ DECLARE t text; has_null boolean; BEGIN FOREACH t IN ARRAY ARRAY['applications', 'application_history', 'gaps_done'] LOOP EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE owner IS NULL)', t) INTO has_null; IF NOT has_null THEN EXECUTE format('ALTER TABLE %I ALTER COLUMN owner SET NOT NULL', t); END IF; END LOOP; END $$",
  },
  // DELETE
  {
    why: "applications: removes exact duplicate (owner, program, project) rows before the unique index below; a no-op once unique.",
    sql: "DELETE FROM applications a USING applications b WHERE a.owner = b.owner AND a.program_id = b.program_id AND COALESCE(a.project_id, '') = COALESCE(b.project_id, '') AND (a.at < b.at OR (a.at = b.at AND a.ctid < b.ctid))",
  },
  // DROP
  {
    why: "applications: old (owner, program) index replaced by the project one (IF EXISTS).",
    sql: "DROP INDEX IF EXISTS applications_owner_program",
  },
  // DELETE
  {
    why: "gaps_done: removes exact duplicate rows before the unique index below; a no-op once unique.",
    sql: "DELETE FROM gaps_done a USING gaps_done b WHERE a.owner = b.owner AND a.project_key = b.project_key AND a.program_id = b.program_id AND a.item = b.item AND (a.at < b.at OR (a.at = b.at AND a.ctid < b.ctid))",
  },
  // DROP
  {
    why: "gaps_done: old (owner, item) index replaced by the project key one (IF EXISTS).",
    sql: "DROP INDEX IF EXISTS gaps_done_owner_item",
  },
  // DROP
  {
    why: "applications: old (installation, program) primary key replaced by the owner/project unique index (IF EXISTS).",
    sql: "ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_pkey",
  },
  // DROP
  {
    why: "gaps_done: old primary key replaced by the owner/project unique index (IF EXISTS).",
    sql: "ALTER TABLE gaps_done DROP CONSTRAINT IF EXISTS gaps_done_pkey",
  },
  // UPDATE
  {
    why: "applications.sent_at backfill for pre-v6.1.9 auto rows; WHERE sent_at IS NULL makes it a no-op on rerun.",
    sql: "UPDATE applications a SET sent_at = COALESCE( (SELECT max(h.at) FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id AND h.status = 'applied'), CASE WHEN a.status = 'applied' THEN a.at END) WHERE a.sent_at IS NULL AND a.auto_applied",
  },
  // DROP
  {
    why: "screen_jobs.builder_id NULL allowed; relaxing, idempotent.",
    sql: "ALTER TABLE screen_jobs ALTER COLUMN builder_id DROP NOT NULL",
  },
  // UPDATE
  {
    why: "applications.amounts backfill from amount_usd; WHERE amounts IS NULL makes it a no-op on rerun.",
    sql: "UPDATE applications SET amounts = jsonb_build_object('USD', amount_usd) WHERE amounts IS NULL AND amount_usd IS NOT NULL",
  },
  // UPDATE
  {
    why: "applications.project_id: a record project id becomes its repo URL (v6.1.16 Task 14); a rewritten row starts with https:// and is skipped on rerun.",
    sql: "UPDATE applications a SET project_id = k.key FROM ( SELECT DISTINCT ON (a2.owner, a2.program_id, lower(regexp_replace(regexp_replace(p->>'repo_url', '/+$', ''), '(\\.git)+$', '', 'i'))) a2.ctid AS row_id, lower(regexp_replace(regexp_replace(p->>'repo_url', '/+$', ''), '(\\.git)+$', '', 'i')) AS key FROM applications a2 JOIN builders b ON a2.owner = 'b:' || b.id, jsonb_array_elements(COALESCE(b.record->'projects', '[]'::jsonb)) p WHERE a2.project_id IS NOT NULL AND a2.project_id NOT LIKE 'https://%' AND a2.project_id NOT LIKE 'name:%' AND p->>'id' = a2.project_id AND COALESCE(p->>'repo_url', '') LIKE 'https://github.com/%' ORDER BY a2.owner, a2.program_id, lower(regexp_replace(regexp_replace(p->>'repo_url', '/+$', ''), '(\\.git)+$', '', 'i')), a2.at DESC ) k WHERE a.ctid = k.row_id AND NOT EXISTS ( SELECT 1 FROM applications c WHERE c.owner = a.owner AND c.program_id = a.program_id AND COALESCE(c.project_id, '') = k.key)",
  },
  // UPDATE
  {
    why: "applications.repo_key backfill; WHERE repo_key IS NULL makes it a no-op on rerun.",
    sql: "UPDATE applications SET repo_key = project_id WHERE repo_key IS NULL AND project_id LIKE 'https://%'",
  },
  // UPDATE
  {
    why: "application_history.project_id backfill; WHERE project_id IS NULL makes it a no-op on rerun.",
    sql: "UPDATE application_history h SET project_id = a.project_id FROM applications a WHERE h.project_id IS NULL AND a.project_id IS NOT NULL AND a.owner = h.owner AND a.program_id = h.program_id AND NOT EXISTS (SELECT 1 FROM applications b WHERE b.owner = a.owner AND b.program_id = a.program_id AND b.ctid <> a.ctid)",
  },
  // UPDATE
  {
    why: "applications.identity backfill (v6.1.16.1 Task 2); only rows with identity IS NULL.",
    sql: "UPDATE applications a SET identity = k.identity FROM ( SELECT ctid AS row_id, owner, program_id, COALESCE('gh:' || repo_id::text, repo_key, project_id) AS identity, row_number() OVER (PARTITION BY owner, program_id, COALESCE('gh:' || repo_id::text, repo_key, project_id) ORDER BY (CASE status WHEN 'won' THEN 5 WHEN 'rejected' THEN 4 WHEN 'no_result' THEN 3 WHEN 'applied' THEN 2 ELSE 1 END) DESC, at) AS n FROM applications WHERE identity IS NULL AND COALESCE('gh:' || repo_id::text, repo_key, project_id) IS NOT NULL ) k WHERE a.ctid = k.row_id AND k.n = 1 AND NOT EXISTS (SELECT 1 FROM applications c WHERE c.owner = a.owner AND c.program_id = a.program_id AND c.identity = k.identity)",
  },
  // UPDATE
  {
    why: "applications.sent_by_installation_id one-time backfill (v6.1.19 Task 1); only NULL rows.",
    sql: "UPDATE applications a SET sent_by_installation_id = ( SELECT h.installation_id FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id AND COALESCE(h.project_id, '') = COALESCE(a.project_id, '') AND h.status = 'applied' ORDER BY h.at DESC, h.id DESC LIMIT 1) WHERE a.sent_by_installation_id IS NULL AND EXISTS ( SELECT 1 FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id AND COALESCE(h.project_id, '') = COALESCE(a.project_id, '') AND h.status = 'applied') AND (SELECT h.note FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id AND COALESCE(h.project_id, '') = COALESCE(a.project_id, '') AND h.status = 'applied' ORDER BY h.at DESC, h.id DESC LIMIT 1) IS DISTINCT FROM 'sent by the builder, no agent linked'",
  },
  // UPDATE
  {
    why: "applications.sent_at one-time backfill from the newest applied history row (v6.1.19 Task 1); only NULL rows.",
    sql: "UPDATE applications a SET sent_at = ( SELECT h.at FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id AND COALESCE(h.project_id, '') = COALESCE(a.project_id, '') AND h.status = 'applied' ORDER BY h.at DESC, h.id DESC LIMIT 1) WHERE a.sent_at IS NULL AND a.status IN ('applied', 'won', 'rejected', 'no_result') AND EXISTS ( SELECT 1 FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id AND COALESCE(h.project_id, '') = COALESCE(a.project_id, '') AND h.status = 'applied') AND COALESCE(( SELECT h.note FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id AND COALESCE(h.project_id, '') = COALESCE(a.project_id, '') AND h.status = 'applied' ORDER BY h.at DESC, h.id DESC LIMIT 1), '') <> 'sent by the builder outside EarnKit'",
  },
  // UPDATE
  {
    why: "applications.earlier_win one-time backfill (v6.1.22 L47-6); only NULL rows.",
    sql: "UPDATE applications a SET earlier_win = jsonb_build_object('amount_usd', a.amount_usd, 'amounts', a.amounts, 'at', a.at) FROM programs p WHERE p.id = a.program_id AND a.status = 'won' AND a.sent_at IS NULL AND a.submitted_by = 'builder' AND a.earlier_win IS NULL AND (p.file->>'starts_at') IS NOT NULL AND (p.file->>'starts_at')::timestamptz > a.at",
  },
  // DROP
  {
    why: "owner_people view: dropped and re-created each run (its column list changes; nothing is stored in a view).",
    sql: "DROP VIEW IF EXISTS owner_people",
  },
  // DO block
  {
    why: "owner_people: read grant for the tracker role when it exists; additive.",
    sql: "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'earnkit_ro') THEN GRANT SELECT ON owner_people TO earnkit_ro; END IF; END $$",
  },
];
