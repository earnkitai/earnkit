/**
 * A program's applicant list: `parseApplicants` reads the CSV (header row required) into applicants,
 * each bad field nulled with a `problems` line; `resolveRepo` takes a repo from the site's GitHub links;
 * `identicalPitches` and `sharedContributors` count overlaps inside the one list. Pure.
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

const COLUMNS: Record<'ref' | 'name' | 'repo' | 'live' | 'contracts' | 'pitch', string[]> = {
  ref: ['ref', 'id'],
  name: ['name', 'project'],
  repo: ['repo', 'github', 'repo_url'],
  live: ['url', 'website', 'live_url', 'site'],
  contracts: ['contract', 'contracts', 'address'],
  pitch: ['pitch', 'description', 'summary'],
};

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
  const names = header.map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([k, aliases]) => [k, names.findIndex((h) => aliases.includes(h))]),
  ) as Record<keyof typeof COLUMNS, number>;
  if (col.repo < 0 && col.live < 0 && col.contracts < 0) {
    throw new CsvError(`no repo, site or contract column in the header (${names.join(', ')})`);
  }
  return rows.map((r, i) => {
    const get = (k: keyof typeof COLUMNS) => (col[k] >= 0 ? blank(r[col[k]]) : null);
    const ref = get('ref') ?? `row ${i + 1}`;
    const problems: string[] = [];
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

/** The applicant's repo, else the first repo (owner/name, never an account page) the site links, else null. Pure. */
export function resolveRepo(a: Applicant, live: LiveRows): string | null {
  if (a.repo_url) return a.repo_url;
  for (const link of live.github_links) {
    const key = repoKey(link);
    if (key) return `https://github.com/${key}`;
  }
  return null;
}

const SHINGLE = 5;
const SAME = 0.9;
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
 * (measured against the larger set, so a short pitch inside a long one is not the same). No pitch counts 0. Pure.
 */
export function identicalPitches(apps: Applicant[]): Map<string, number> {
  const sets = apps.map((a) => (a.pitch ? shingles(a.pitch) : new Set<string>()));
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
