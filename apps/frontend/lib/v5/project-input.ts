/**
 * What an agent reports about a project: name, description, links, chains, dates. Parsed leniently:
 * a bad link, unknown chain or malformed date is dropped and a long name or description cut, with a
 * problem line, never a refusal; only a name or description missing or not text fails. users is null when not reported.
 */
import { z } from 'zod';
import { isKnownChain } from './chains';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const ProjectInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(280),
  repo_url: z.string().optional(),
  live_url: z.string().optional(),
  demo_url: z.string().optional(),
  chains: z.array(z.object({ chain: z.string(), mainnet: z.boolean(), contract: z.string().optional() })).optional(),
  last_commit_at: z.string().optional(),
  first_commit_at: z.string().optional(),
  private: z.boolean().optional(),
  builder_codes: z.boolean().optional(),
  users: z.boolean().nullable().optional(),
});
export type Project = z.infer<typeof ProjectInput>;

const MAX = { name: 80, description: 280 } as const;
/** Control and format characters (zero-width, bidi overrides, NUL) are never part of a project string (v6.1.7, C15). */
const clean = (s: string) => s.replace(/\p{C}/gu, '');
const text = (v: unknown) => (typeof v === 'string' ? clean(v).trim() : '');
/** The chains read from one report; the rest are named, not read. */
const MAX_CHAINS = 20;
/** A commit date this far past now is a mistake, not a clock skew. */
const FUTURE_MS = 86_400_000;

const URL_FIELDS = ['repo_url', 'live_url', 'demo_url'] as const;
const DATE_FIELDS = ['last_commit_at', 'first_commit_at'] as const;

/** An https or http URL as given, or null. */
const webUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 500) return null;
  try {
    const u = new URL(clean(v).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
};

/**
 * Parses a report into a Project. Optional fields that do not hold up are dropped and named in `problems`; a commit
 * date more than a day past `now` is dropped too. Pure.
 */
export function parseProject(v: unknown, now = new Date()): { ok: true; project: Project; problems: string[] } | { ok: false; problem: string } {
  const raw = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const out: Record<string, unknown> = { users: null };
  for (const k of ['name', 'description'] as const) {
    if (raw[k] != null && typeof raw[k] !== 'string') return { ok: false, problem: `${k}: not text` };
    const t = text(raw[k]);
    if (!t) return { ok: false, problem: `${k}: missing` };
    if (t.length > MAX[k]) problems.push(`${k} cut to ${MAX[k]} characters`);
    out[k] = t.slice(0, MAX[k]);
  }

  for (const k of URL_FIELDS) {
    if (raw[k] == null) continue;
    const url = webUrl(raw[k]);
    if (url) out[k] = url;
    else problems.push(`${k} dropped: not a web link`);
  }
  for (const k of DATE_FIELDS) {
    if (raw[k] == null) continue;
    const t = typeof raw[k] === 'string' ? Date.parse(raw[k] as string) : NaN;
    if (Number.isNaN(t)) problems.push(`${k} dropped: not a date`);
    else if (t > now.getTime() + FUTURE_MS) problems.push(`${k} is in the future; not used.`);
    else out[k] = new Date(t).toISOString();
  }
  for (const k of ['private', 'builder_codes', 'users'] as const) {
    if (raw[k] == null) continue;
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
    else problems.push(`${k} dropped: not true or false`);
  }
  if (Array.isArray(raw.chains)) {
    const chains: NonNullable<Project['chains']> = [];
    const seen = new Set<string>();
    for (const c of raw.chains.slice(0, MAX_CHAINS)) {
      // A bare slug ("base") is that chain on mainnet.
      const e = (typeof c === 'string' ? { chain: c, mainnet: true } : typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
      const chain = typeof e.chain === 'string' ? clean(e.chain).trim().toLowerCase() : '';
      if (!isKnownChain(chain)) {
        problems.push(`chain ${typeof e.chain === 'string' ? clean(e.chain).slice(0, 40) : '?'} dropped: not a known chain`);
        continue;
      }
      if (typeof e.mainnet !== 'boolean') {
        problems.push(`chain ${chain} dropped: mainnet must be true or false`);
        continue;
      }
      const given = typeof e.contract === 'string' ? clean(e.contract).trim() : e.contract;
      const contract = typeof given === 'string' && ADDRESS.test(given) ? given : undefined;
      if (e.contract != null && !contract) problems.push(`contract on ${chain} dropped: not an address`);
      // One entry per chain, network and contract (v6.1.7, C13).
      const key = `${chain}|${e.mainnet}|${contract?.toLowerCase() ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chains.push({ chain, mainnet: e.mainnet, ...(contract && { contract }) });
    }
    if (chains.length) out.chains = chains;
    if (raw.chains.length > MAX_CHAINS) problems.push(`${raw.chains.length - MAX_CHAINS} chains beyond ${MAX_CHAINS} were not read.`);
  } else if (raw.chains != null) problems.push('chains dropped: not a list');

  return { ok: true, project: out as Project, problems };
}
