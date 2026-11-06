/**
 * A program's applicant list: `parseApplicants` reads the CSV (header row required) into applicants with
 * unique refs, each bad field nulled with a `problems` line; `resolveRepo` picks a repo from the site's
 * GitHub links (never a starter's or an SDK's); `identicalPitches` and `sharedContributors` count overlaps
 * inside the one list. Pure.
 */
import { isKnownChain } from '../v5/chains';
import { repoKey } from '../v5/repo-facts';
import type { LiveRows } from './live';

export type Applicant = {
  ref: string;
  name: string;
  repo_url: string | null;
  live_url: string | null;
  contracts: { chain: string; address: string }[];
  pitch: string | null;
  problems: string[];
};

/** The CSV cannot be read at all: no header, an open quote, no column EarnKit knows. */
export class CsvError extends Error {}

/** Header names after `headerKey` (so "GitHub URL" is github, "Project Name" is project_name). */
const COLUMNS: Record<'ref' | 'name' | 'repo' | 'live' | 'contracts' | 'pitch', string[]> = {
  ref: ['ref', 'id'],
  name: ['name', 'project', 'project_name'],
  repo: ['repo', 'github', 'github_repo'],
  live: ['url', 'website', 'live', 'site'],
  contracts: ['contract', 'contracts', 'address', 'contract_address', 'contract_addresses'],
  pitch: ['pitch', 'description', 'summary'],
};

/** A header cell as a column key: lowercase, spaces and dashes to underscores, a trailing "_url" dropped. Pure. */
export function headerKey(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/(.)_url$/, '$1');
}

/** RFC 4180 records: quoted fields, doubled quotes, CRLF or LF, newlines inside quotes. Throws CsvError on an open quote. */
function records(csv: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const text = csv.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') row.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) throw new CsvError('a quoted field is never closed');
  if (field !== '' || row.length) out.push([...row, field]);
  return out.filter((r) => r.some((f) => f.trim() !== ''));
}

const blank = (v: string | undefined) => (v ?? '').trim() || null;

/** The repo link as https://github.com/owner/name, or the problem with it. Pure. */
function repoOf(raw: string): { url: string | null; problem: string | null } {
  const href = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let host = '';
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return { url: null, problem: 'repo link is not a link' };
  }
  if (host !== 'github.com' && host !== 'www.github.com') return { url: null, problem: 'repo link not on GitHub' };
  const key = repoKey(href);
  return key ? { url: `https://github.com/${key}`, problem: null } : { url: null, problem: 'repo link is a GitHub account, not a repo' };
}

/** `chain:0x...` or bare `0x...` pairs, comma or space separated; each bad pair is one problem line. Pure. */
function contractsOf(raw: string, chain: string) {
  const contracts: { chain: string; address: string }[] = [];
  const problems: string[] = [];
  for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
    const at = part.lastIndexOf(':');
    const c = (at > 0 ? part.slice(0, at) : chain).trim().toLowerCase();
    const address = (at > 0 ? part.slice(at + 1) : part).trim();
    const why = [
      ...(isKnownChain(c) ? [] : [`unknown chain ${c}`]),
      ...(/^0x[0-9a-f]{40}$/i.test(address) ? [] : ['address not 40 hex characters']),
    ];
    if (why.length) problems.push(`contract ${part} skipped: ${why.join(', ')}`);
    else contracts.push({ chain: c, address: address.toLowerCase() });
  }
  return { contracts, problems };
}

/**
 * Applicants from a CSV with a header row. Columns by case-insensitive name (see COLUMNS); a bare address
 * is on `o.chain` (default base). Throws CsvError only when nothing can be read. Pure.
 */
export function parseApplicants(csv: string, o: { chain?: string } = {}): Applicant[] {
  const chain = (o.chain ?? 'base').toLowerCase();
  const [header, ...rows] = records(csv);
  if (!header) throw new CsvError('the file is empty');
  const names = header.map(headerKey);
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, aliases]) => [k, names.findIndex((h) => aliases.includes(h))]),
  ) as Record<keyof typeof COLUMNS, number>;
  if (col.repo < 0 && col.live < 0 && col.contracts < 0) {
    throw new CsvError(`no repo, site or contract column in the header (${names.join(', ')})`);
  }
  const refs = new Set<string>();
  return rows.map((r, i) => {
    const get = (k: keyof typeof COLUMNS) => (col[k] >= 0 ? blank(r[col[k]]) : null);
    const problems: string[] = [];
    // Refs key every count across the list: a repeated one becomes "ek-3 (2)".
    const given = (get('ref') ?? `row ${i + 1}`).replace(/\s+/g, ' ');
    let ref = given;
    for (let k = 2; refs.has(ref); k++) ref = `${given} (${k})`;
    if (ref !== given) problems.push('duplicate ref');
    refs.add(ref);
    let repo_url: string | null = null;
    const repoRaw = get('repo');
    if (repoRaw) {
      const rp = repoOf(repoRaw);
      repo_url = rp.url;
      if (rp.problem) problems.push(rp.problem);
    }
    const cs = contractsOf(get('contracts') ?? '', chain);
    problems.push(...cs.problems);
    return {
      ref,
      name: (get('name') ?? ref).replace(/\s+/g, ' '),
      repo_url,
      live_url: get('live'),
      contracts: cs.contracts,
      pitch: get('pitch'),
      problems,
    };
  });
}

/** GitHub owners of starters and SDKs: a site linking them links its tools, not its own code. */
export const TOOL_OWNERS = new Set([
  'coinbase', 'base', 'base-org', 'vercel', 'scaffold-eth', 'wevm', 'rainbow-me', 'ethereum', 'foundry-rs', 'nomicfoundation',
  'solana-labs', 'solana-foundation', 'circlefin', 'privy-io', 'thirdweb-dev',
]);
/** Words that name nothing about a project. */
const FILLER = new Set([
  'the', 'app', 'and', 'for', 'www', 'com', 'xyz', 'org', 'net', 'dev', 'labs', 'onchain',
  // Shared hosts' own names.
  'vercel', 'netlify', 'github', 'pages', 'onrender', 'railway', 'fly', 'herokuapp', 'replit', 'web', 'firebaseapp', 'surge',
]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !FILLER.has(w));
/** Whether a repo key shares a word with the site's domain or the project's name (or holds one whole). Pure. */
function sharesWord(key: string, hints: string[]): boolean {
  const [owner, name] = key.split('/');
  const mine = new Set([...words(owner), ...words(name)]);
  const joined = `${owner}${name}`.replace(/[^a-z0-9]/g, '');
  return hints.some((h) => mine.has(h) || (h.length >= 4 && joined.includes(h)));
}

/**
 * The applicant's repo, else a repo the site links (owner/name, never an account page, never a starter's
 * or an SDK's owner), preferring one sharing a word with the domain or project name, else null. Pure.
 */
export function resolveRepo(a: Applicant, live: LiveRows): string | null {
  if (a.repo_url) return a.repo_url;
  const keys = live.github_links.map((l) => repoKey(l)).filter((k): k is string => !!k && !TOOL_OWNERS.has(k.split('/')[0]));
  const domain = (live.domain ?? '').split('.').slice(0, -1).join('.');
  const hints = [...new Set([...words(domain), ...words(a.name)])];
  const key = keys.find((k) => sharesWord(k, hints)) ?? keys[0];
  return key ? `https://github.com/${key}` : null;
}

const SHINGLE = 5;
const SAME = 0.9;
/** A pitch under 10 words ("TBD", "a DeFi app on Base") is a placeholder, not text worth comparing. */
const MIN_PITCH_WORDS = 10;
/** Lowercase, punctuation dropped, whitespace collapsed. Pure. */
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
/** The 5-word shingles of a text; a text under 5 words is one shingle. Pure. */
function shingles(text: string): Set<string> {
  const w = normalize(text).split(' ').filter(Boolean);
  if (w.length <= SHINGLE) return new Set(w.length ? [w.join(' ')] : []);
  const out = new Set<string>();
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '));
  return out;
}

/**
 * Ref to the count of other applicants whose pitch shares at least 90% of its 5-word shingles with this one
 * (measured against the larger set, so a short pitch inside a long one is not the same). No pitch, or one
 * under 10 words, counts 0 and is never counted against. Pure.
 */
export function identicalPitches(apps: Applicant[]): Map<string, number> {
  const long = (p: string | null): p is string => !!p && normalize(p).split(' ').filter(Boolean).length >= MIN_PITCH_WORDS;
  const sets = apps.map((a) => (long(a.pitch) ? shingles(a.pitch) : new Set<string>()));
  const out = new Map<string, number>();
  apps.forEach((a, i) => {
    let n = 0;
    const s = sets[i];
    if (s.size) {
      sets.forEach((t, j) => {
        if (j === i || !t.size) return;
        let shared = 0;
        for (const x of s) if (t.has(x)) shared++;
        if (shared / Math.max(s.size, t.size) >= SAME) n++;
      });
    }
    out.set(a.ref, n);
  });
  return out;
}

/** Ref to the count of other applicants sharing at least one contributor login (case ignored). Pure. */
export function sharedContributors(logins: Map<string, string[]>): Map<string, number> {
  const sets = [...logins].map(([ref, ls]) => [ref, new Set(ls.map((l) => l.toLowerCase()))] as const);
  return new Map(
    sets.map(([ref, s]) => [ref, sets.filter(([other, t]) => other !== ref && [...s].some((l) => t.has(l))).length]),
  );
}
