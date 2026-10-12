import { createHmac } from 'node:crypto';
import { chainOfId } from './match';

/**
 * v2.12 spec 3: clues to a person's past work, read from files of repos they verifiably own. Every
 * parser is pure and total: bad input is null or [], never a throw. A clue is a proposal; the
 * server verifies it before it scores (sources.ts).
 */
export type ContractClue = { chain: 'base' | 'arc'; address: string; deployer: string | null; via: 'foundry' | 'hardhat' };

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const host = (h: string): string | null => {
  const s = h.trim().toLowerCase().replace(/^\*\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  return HOST.test(s) ? s : null;
};
const origin = (h: string | null) => (h ? `https://${h}` : null);
/** Every line or regex clue file is cut to this many bytes' worth of characters before any parser reads it. */
export const CLUE_FILE_MAX = 64 * 1024;
/**
 * JSON clue files (foundry broadcasts, hardhat deployments, vercel.json, package.json) are cut at 1 MB
 * instead: real broadcast files often pass 64 KB, and JSON.parse is linear, so the larger cap is safe.
 */
export const CLUE_JSON_MAX = 1024 * 1024;
const cap = (text: string) => (typeof text === 'string' ? text.slice(0, CLUE_FILE_MAX) : '');
const json = (text: string): unknown => {
  try {
    return JSON.parse(typeof text === 'string' ? text.slice(0, CLUE_JSON_MAX) : '');
  } catch {
    return null;
  }
};
const scored = (id: number | null): 'base' | 'arc' | null => {
  const c = id === null || !Number.isFinite(id) ? null : chainOfId(id);
  return c?.mainnet && (c.chain === 'base' || c.chain === 'arc') ? c.chain : null;
};

/** Root files read per verified repo (the GitHub contents API, one read each). */
export const CLUE_PATHS = ['CNAME', 'vercel.json', 'wrangler.toml', 'package.json', 'pyproject.toml'] as const;

export function cnameSite(text: string): string | null {
  const line = cap(text).split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).find(Boolean);
  return line ? origin(host(line)) : null;
}

export function vercelSites(text: string): string[] {
  const v = json(text) as { alias?: unknown } | null;
  const list = typeof v?.alias === 'string' ? [v.alias] : Array.isArray(v?.alias) ? v.alias : [];
  return [...new Set(list.filter((a): a is string => typeof a === 'string').map(host).filter((h): h is string => !!h))].map((h) => `https://${h}`);
}

export function wranglerSites(text: string): string[] {
  const hosts = [...cap(text).matchAll(/\b(?:pattern|route)\s*=\s*"([^"]+)"/g)].map((m) => host(m[1])).filter((h): h is string => !!h);
  return [...new Set(hosts)].map((h) => `https://${h}`);
}

export function pagesSite(owner: string, repo: string): string {
  const o = owner.toLowerCase();
  return repo.toLowerCase() === `${o}.github.io` ? `https://${o}.github.io/` : `https://${o}.github.io/${repo.toLowerCase()}/`;
}

const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]{0,213}$/;
export function npmPackage(text: string): string | null {
  const p = json(text) as { name?: unknown; private?: unknown } | null;
  return p && p.private !== true && typeof p.name === 'string' && NPM_NAME.test(p.name) ? p.name : null;
}

export function pypiPackage(text: string): string | null {
  let inside = false;
  for (const raw of cap(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inside = line === '[project]' || line === '[tool.poetry]';
      continue;
    }
    if (!inside) continue;
    const m = /^name\s*=\s*"([A-Za-z0-9][A-Za-z0-9._-]{0,99})"\s*(#.*)?$/.exec(line);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export function foundryBroadcast(path: string, text: string): ContractClue[] {
  const fromPath = /broadcast\/[^/]+\/(\d+)\/run-latest\.json$/.exec(path);
  const run = json(text) as { chain?: unknown; transactions?: unknown } | null;
  const chain = scored(typeof run?.chain === 'number' ? run.chain : fromPath ? Number(fromPath[1]) : null);
  if (!chain || !Array.isArray(run?.transactions)) return [];
  const out: ContractClue[] = [];
  for (const t of run.transactions as { transactionType?: unknown; contractAddress?: unknown; transaction?: { from?: unknown } }[]) {
    if ((t?.transactionType !== 'CREATE' && t?.transactionType !== 'CREATE2') || typeof t.contractAddress !== 'string' || !ADDR.test(t.contractAddress)) continue;
    const from = typeof t.transaction?.from === 'string' && ADDR.test(t.transaction.from) ? t.transaction.from.toLowerCase() : null;
    out.push({ chain, address: t.contractAddress.toLowerCase(), deployer: from, via: 'foundry' });
  }
  return out;
}

const NETWORK_CHAIN: Record<string, 'base' | 'arc'> = { base: 'base', 'base-mainnet': 'base', arc: 'arc', 'arc-mainnet': 'arc' };
export function hardhatDeployment(path: string, text: string, chainIdFile: string | null = null): ContractClue | null {
  const m = /deployments\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!m) return null;
  const chain = chainIdFile !== null ? scored(Number(cap(chainIdFile).trim())) : (NETWORK_CHAIN[m[1].toLowerCase()] ?? null);
  const d = json(text) as { address?: unknown; receipt?: { from?: unknown } } | null;
  if (!chain || typeof d?.address !== 'string' || !ADDR.test(d.address)) return null;
  const from = typeof d.receipt?.from === 'string' && ADDR.test(d.receipt.from) ? d.receipt.from.toLowerCase() : null;
  return { chain, address: d.address.toLowerCase(), deployer: from, via: 'hardhat' };
}

export function githubProfileClues(u: { blog?: string | null; twitter_username?: string | null }): { site: string | null; twitter: string | null } {
  const blog = u.blog?.trim() ?? '';
  const site = blog ? origin(host(blog.replace(/^https?:\/\//i, ''))) : null;
  const twitter = u.twitter_username && /^[A-Za-z0-9_]{1,15}$/.test(u.twitter_username) ? u.twitter_username : null;
  return { site, twitter };
}

export function githubRemote(remote: string): string | null {
  if (typeof remote !== 'string' || remote.length > 300) return null;
  const m = /^(?:git@github\.com:|https?:\/\/(?:www\.)?github\.com\/)([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(remote.trim());
  if (!m || m[1].startsWith('-') || m[1].endsWith('-') || m[2] === '.' || m[2] === '..') return null;
  return `${m[1]}/${m[2]}`.toLowerCase();
}

/** The earnkit.txt `profile:` code for a site with no GitHub (spec 3 clue 6), v2.11's line family. */
export function profileCode(builderId: number, siteOrigin: string, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): string | null {
  if (!secret) return null;
  return createHmac('sha256', secret).update(`profile-line:v1:${builderId}:${siteOrigin.toLowerCase().replace(/\/+$/, '')}`).digest('hex').slice(0, 16);
}

export function profileCodesIn(text: string): string[] {
  return cap(text).split(/\r?\n/).map((l) => /^\s*profile\s*:\s*([0-9a-f]{16})\s*(#.*)?$/i.exec(l)?.[1]?.toLowerCase()).filter((c): c is string => !!c);
}
