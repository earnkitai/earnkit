/**
 * v3.8 (deploy safety): the additive-only guard for db/schema.sql, which every deploy runs (railway.toml
 * preDeployCommand -> pnpm predeploy -> db:migrate). It reads the file statically, never a database: comments are
 * stripped, the text is split into top-level statements (quotes and $$ bodies respected), each statement is
 * normalized (whitespace collapsed), and any statement that could destroy, rewrite or lock data must appear verbatim
 * in SCHEMA_ALLOWLIST (schema-allowlist.ts). A new destructive statement fails the test and the deploy (fail closed:
 * db-migrate.mts runs this before any SQL and exits non-zero).
 */
import { SCHEMA_ALLOWLIST } from './schema-allowlist';

/** Why a statement needs an allowlist entry: the first rule it trips. */
const RULES: { name: string; re: RegExp }[] = [
  // Arbitrary procedural code can hide any of the above.
  { name: 'DO block', re: /^DO\b/i },
  { name: 'CREATE FUNCTION/PROCEDURE/TRIGGER/RULE', re: /^CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|TRIGGER|RULE)\b/i },
  { name: 'DROP TABLE', re: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN', re: /\bDROP\s+COLUMN\b/i },
  { name: 'DROP SCHEMA', re: /\bDROP\s+SCHEMA\b/i },
  { name: 'DROP TYPE', re: /\bDROP\s+TYPE\b/i },
  { name: 'TRUNCATE', re: /\bTRUNCATE\b/i },
  { name: 'DELETE', re: /\bDELETE\b/i },
  { name: 'UPDATE', re: /\bUPDATE\b/i },
  { name: 'ALTER ... TYPE', re: /\bALTER\b.*\bTYPE\b/i },
  { name: 'RENAME', re: /\bRENAME\b/i },
  { name: 'SET NOT NULL', re: /\bSET\s+NOT\s+NULL\b/i },
  { name: 'REVOKE', re: /\bREVOKE\b/i },
  // Any other DROP (constraint, index, view, default, not null): safe only as an inventoried idempotent pair.
  { name: 'DROP', re: /\bDROP\b/i },
  { name: 'CREATE TABLE without IF NOT EXISTS', re: /^CREATE\s+(UNLOGGED\s+)?TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/i },
  { name: 'CREATE INDEX without IF NOT EXISTS', re: /^CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?!IF\s+NOT\s+EXISTS\b)/i },
];

/** The text with -- and block comments blanked, quotes and dollar-quoted bodies kept as they are. */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const rest = text.slice(i);
    if (rest.startsWith('--')) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      out += ' ';
    } else if (rest.startsWith('/*')) {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === c && text[j + 1] !== c)) j += text[j] === c ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '$' && /^\$[A-Za-z_]*\$/.test(rest)) {
      const tag = rest.match(/^\$[A-Za-z_]*\$/)![0];
      const end = text.indexOf(tag, i + tag.length);
      const stop = end < 0 ? text.length : end + tag.length;
      out += text.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The top-level statements of comment-free SQL, each normalized (whitespace collapsed, trimmed), empties dropped. */
export function statements(text: string): string[] {
  const src = stripComments(text);
  const out: string[] = [];
  let cur = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    let take = 1;
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && !(src[j] === c && src[j + 1] !== c)) j += src[j] === c ? 2 : 1;
      take = j + 1 - i;
    } else if (c === '$' && /^\$[A-Za-z_]*\$/.test(rest)) {
      const tag = rest.match(/^\$[A-Za-z_]*\$/)![0];
      const end = src.indexOf(tag, i + tag.length);
      take = (end < 0 ? src.length : end + tag.length) - i;
    } else if (c === ';') {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += src.slice(i, i + take);
    i += take;
  }
  out.push(cur);
  return out.map(normalize).filter(Boolean);
}

/** One statement as the allowlist keys it: whitespace runs collapsed to one space, trimmed, no trailing semicolon. */
export function normalize(stmt: string): string {
  return stmt.replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();
}

export type Violation = { rule: string; statement: string };

/** Every statement that trips a rule and is not allowlisted; empty means the file is additive-only. */
export function checkSchema(text: string, allowlist: readonly string[] = SCHEMA_ALLOWLIST.map((e) => e.sql)): Violation[] {
  const allowed = new Set(allowlist.map(normalize));
  const out: Violation[] = [];
  for (const statement of statements(text)) {
    const hit = RULES.find((r) => r.re.test(statement));
    if (hit && !allowed.has(statement)) out.push({ rule: hit.name, statement });
  }
  return out;
}

/** One line per violation, the statement cut to 160 characters (the deploy log stays readable). */
export function describeViolations(v: Violation[]): string {
  return v.map((x) => `schema guard: ${x.rule}: ${x.statement.length > 160 ? x.statement.slice(0, 157) + '...' : x.statement}`).join('\n');
}
