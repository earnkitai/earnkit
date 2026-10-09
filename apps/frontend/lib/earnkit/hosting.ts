import { createHash, randomBytes } from 'node:crypto';
import { Inflate } from 'fflate';
import { githubRepo, normalizeRepoUrl } from './campaigns';
import { sql, type Db } from './db';
import { siteUrl } from './entry-text';
import { FreeTierFull, freeTierRoom } from './free-tier';
import { createVerifyLink, githubVerifyEnabled, takeHostVerification } from './github-verify';
import { HOST_RESERVED, SITE_PREFIX, STATE_PREFIX, contentTypeFor } from './host-names';
import { bearerMatches, json } from './http';
import { sharedGroup } from './installations';
import { r2Client, r2Enabled, type R2 } from './r2';

/**
 * v2.9 C12-C14 (server side): static hosting on `<slug>.earnkit.com`. The agent gets a one-time
 * upload URL from prepare_submission (`host: true`, Ruling 8) and POSTs one zip to
 * /api/host/upload. The server reads the zip with hard limits while inflating, checks it, scans it
 * for abuse, adds the badge, and writes it to R2 with EarnKit's key (r2.ts; never an agent's).
 * The host Worker (infra/host-worker) serves `sites/<slug>/` and reads `state/<slug>.json`.
 *
 * - Gate: a GitHub sign-in for the repo, an account 30 days or older with a public repo.
 *   On a shared (hosted) client the host sign-in is single-use and lasts 15 minutes (P11).
 * - Limits: 3 live sites per GitHub account, 1 per repo, 10 deploys a day, 25 MB, 500 files,
 *   10 MB a file, static extensions only; total storage under 8 GB and the R2 free-tier counter
 *   (free-tier.ts), else "Hosting is full right now; try again tomorrow."
 * - A flagged upload is written as `review` (the Worker serves the taken-down page) and waits on
 *   the owner (`host-review:<slug>` in the cron's needs_owner, P46).
 * - Expiry (Ruling 10): 7 days after the latest end of the programs the repo entered, else 7 days
 *   after upload; the hourly cron deletes the files and writes `ended` (expireSites).
 * - Off when the R2 variables or the GitHub sign-in variables are absent.
 */

export const HOST_LIMITS = {
  sitesPerAccount: 3,
  deploysPerDay: 10,
  siteBytes: 25 * 1024 * 1024,
  files: 500,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 8_000_000_000,
  accountMinDays: 30,
  minPublicRepos: 1,
  graceDays: 7,
  uploadTtlMs: 15 * 60_000,
} as const;

/** The zone the sites live under. */
export const HOST_ZONE = 'earnkit.com';

export const STATIC_EXT: ReadonlySet<string> = new Set(
  'html htm css js mjs json map png jpg jpeg gif webp avif svg ico woff woff2 ttf otf wasm txt xml webmanifest'.split(' '),
);

// ---- Builder lines (plain, money-free: hosting is a means to the entry)

export const liveLine = (project: string, slug: string) => `${project} is live: ${slug}.${HOST_ZONE}`;
export const HOST_FULL = 'Hosting is full right now; try again tomorrow.';
export const HOST_REVIEW = 'Your site is waiting on a quick review before it goes live.';
export const HOST_LINES = {
  tooBig: 'Sites can be at most 25 MB.',
  tooManyFiles: 'Sites can have at most 500 files.',
  fileTooBig: 'Each file can be at most 10 MB.',
  notWebsite: 'Only website files can be hosted (no .exe).',
  outside: 'The zip has a file outside the site folder.',
  twice: 'The zip has the same file twice.',
  noIndex: 'The site needs an index.html.',
  badZip: "The upload isn't a zip that can be read.",
  sites: 'You have 3 live sites, the most allowed.',
  gate: 'Hosting needs a GitHub account at least 30 days old with a public repo.',
  deploys: "You've deployed 10 times today; try again tomorrow.",
  unavailable: 'Hosting is not available right now.',
  noRepo: 'Hosting needs the GitHub repo first.',
  badName: 'Pick another project name for the site.',
  nameTaken: 'That site name is taken; pick another project name.',
  takenDown: 'This site was taken down.',
  expired: 'This upload link has expired or was used.',
  failed: "The site couldn't be saved; try again.",
} as const;
/** Agent text: an upload that uses browser storage still deploys; the agent hears this once. */
export const STORAGE_NOTE = 'This app uses browser storage, which hosted sites block: keep that state in memory.';
/** Agent text, with an upload URL. */
export const UPLOAD_NOTE = 'POST the built site as one zip (Content-Type application/zip) to upload_url within 15 minutes. Static files only.';
/** The builder's sign-in line for hosting. Pure. */
export const hostSignInLine = (project: string, link: string) => `One click to prove ${project} is yours, then it goes live: ${link}`;

// ---- Pure rules

const RESERVED_ENV = 'EARNKIT_RESERVED_SUBDOMAINS';

/**
 * `<project>-<login>`: lowercase, runs of anything but [a-z0-9] become `-`, trimmed, at most 63
 * characters with no trailing `-`. Null when empty, reserved (HOST_RESERVED plus the
 * EARNKIT_RESERVED_SUBDOMAINS list, P41) or punycode-like (`xn--`, any `??--`; Ruling G19). Pure
 * given `env`. (Pre-flight P40: the Worker's `siteSlug` reads a Host; this one makes a name.)
 */
export function slugFor(project: string, login: string, env: Record<string, string | undefined> = process.env): string | null {
  const part = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = [part(project), part(login)]
    .filter(Boolean)
    .join('-')
    .slice(0, 63)
    .replace(/-+$/, '');
  if (!slug || /^..--/.test(slug)) return null;
  const extra = (env[RESERVED_ENV] ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if ((HOST_RESERVED as readonly string[]).includes(slug) || extra.includes(slug)) return null;
  return slug;
}

export type ZipEntry = { name: string; size: number; isDir: boolean; isLink: boolean };

const ARCHIVE_OR_BINARY = /\.(exe|apk|dmg|msi|bat|cmd|sh|ps1|jar|zip|rar|7z|tar|gz|tgz|bz2|xz|iso|deb|rpm)$/i;
/** Names the Worker can't serve or that leave the site folder: `..`, `.`, `//`, a leading `/`, `\`, control bytes. */
const OUTSIDE = /(^|\/)\.{1,2}(\/|$)|^\/|\/\/|\\|[\u0000-\u001f\u007f]/;

/** The first refusal for these entries (a plain builder line), or null. Pure. */
export function zipProblems(entries: ZipEntry[]): string | null {
  const files = entries.filter((e) => !e.isDir);
  if (files.length > HOST_LIMITS.files) return HOST_LINES.tooManyFiles;
  const seen = new Set<string>();
  let total = 0;
  for (const e of files) {
    if (e.isLink || !e.name || OUTSIDE.test(e.name)) return HOST_LINES.outside;
    const lower = e.name.toLowerCase();
    if (seen.has(lower)) return HOST_LINES.twice;
    seen.add(lower);
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
    if (ARCHIVE_OR_BINARY.test(lower) || !STATIC_EXT.has(ext)) return HOST_LINES.notWebsite;
    if (e.size > HOST_LIMITS.fileBytes) return HOST_LINES.fileTooBig;
    total += e.size;
    if (total > HOST_LIMITS.siteBytes) return HOST_LINES.tooBig;
  }
  return files.some((e) => e.name.toLowerCase() === 'index.html') ? null : HOST_LINES.noIndex;
}

/** The one top folder every name shares (`dist/`), or null. Pure. */
export function stripTopFolder(names: string[]): string | null {
  if (names.length === 0) return null;
  const first = names[0].indexOf('/');
  if (first <= 0) return null;
  const top = names[0].slice(0, first + 1);
  return names.every((n) => n.startsWith(top) && n.length > top.length) ? top : null;
}

const BRANDS = /\b(metamask|coinbase|phantom|rabby|trust\s?wallet|ledger|binance|kraken|chase|wells\s?fargo|bank of america|paypal|revolut)\b/i;

/** Spec C14's upload scan (regex). Any flag sends the site to owner review. Pure. */
export function abuseFlags(files: { path: string; text: string }[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    if (/<input[^>]+type\s*=\s*["']?password/i.test(f.text) && BRANDS.test(f.text)) out.add('password-brand');
    if (/\b(seed|recovery)\s+phrase\b/i.test(f.text)) out.add('seed-phrase');
    if (/\b(approve|setApprovalForAll|increaseAllowance|permit)\s*\(\s*["']?0x[0-9a-fA-F]{40}/.test(f.text)) out.add('hardcoded-approval');
  }
  return [...out];
}

const SCRIPT_FILE = /\.(js|mjs|html?)$/i;
/** Whether the code uses browser storage, which the sandboxed site can't. Pure. */
export function usesStorage(files: { path: string; text: string }[]): boolean {
  return files.some(
    (f) => SCRIPT_FILE.test(f.path) && /\b(localStorage|sessionStorage)\s*(\.\s*(setItem|getItem)\b|\[)|\bindexedDB\s*\.\s*open\b/.test(f.text),
  );
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Ruling 11: "Built with EarnKit by @alice. Report abuse." just before the last `</body>`
 * (appended when there is none), inline styles only. Pure.
 */
export function withBadge(html: string, login: string, slug: string): string {
  const a = 'style="color:inherit;text-decoration:underline" target="_blank" rel="noopener noreferrer"';
  const badge =
    '<div style="position:fixed;right:8px;bottom:8px;z-index:2147483647;padding:4px 8px;border-radius:6px;' +
    'background:#111;color:#fff;font:12px/1.4 system-ui,sans-serif;opacity:.85">' +
    `<a href="https://earnkit.com" ${a}>Built with EarnKit</a> by ` +
    `<a href="https://github.com/${encodeURIComponent(login)}" ${a}>@${escapeHtml(login)}</a>. ` +
    `<a href="mailto:abuse@earnkit.com?subject=${encodeURIComponent(slug)}" ${a}>Report abuse.</a></div>`;
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? html + badge : html.slice(0, at) + badge + html.slice(at);
}

const DAY_MS = 86_400_000;

/**
 * Ruling 10: the latest end among the programs the repo entered, plus 7 days; null while an
 * entered rolling program is still active; with none entered, upload plus 7 days. Never earlier
 * than upload plus 7 days, so a repo whose old program already ended keeps a new site for its next
 * entry. Pure.
 */
export function siteExpiry(a: { deployedAt: Date; entered: { ends_at: Date | null; active: boolean }[]; now: Date }): Date | null {
  const floor = a.deployedAt.getTime() + HOST_LIMITS.graceDays * DAY_MS;
  if (a.entered.length === 0) return new Date(floor);
  if (a.entered.some((p) => p.ends_at === null && p.active)) return null;
  const last = Math.max(...a.entered.map((p) => (p.ends_at ?? a.now).getTime()));
  return new Date(Math.max(floor, last + HOST_LIMITS.graceDays * DAY_MS));
}

// ---- The zip reader (untrusted input)

/** A zip has at most this many central directory entries (files plus folders). */
const MAX_ENTRIES = HOST_LIMITS.files * 2;
/** Compressed bytes per inflate push: at most ~1 MB of output (deflate's 1032:1) before a count. */
const PUSH_BYTES = 1024;

export type ZipRead = { files: { name: string; data: Uint8Array }[] } | { problem: string; status: 400 | 413 };

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const TOO_BIG = new Set<string>([HOST_LINES.tooBig, HOST_LINES.fileTooBig, HOST_LINES.tooManyFiles]);
const refuse = (problem: string): ZipRead => ({ problem, status: TOO_BIG.has(problem) ? 413 : 400 });

/**
 * Reads an uploaded zip from its central directory (one source of truth for names, sizes, folders
 * and symlinks), checks it with zipProblems, then inflates each file with fflate's streaming
 * Inflate, counting output as it goes: a file stops the moment it passes its declared size or
 * 10 MB, and the site the moment it passes 25 MB, so a zip bomb is never inflated in memory.
 * Refuses ZIP64, encryption, methods other than stored and deflate, and anything malformed.
 * `stats.inflated` (tests) is the most bytes inflated. The one shared top folder is dropped.
 */
export function readZip(zip: Uint8Array, stats: { inflated: number } = { inflated: 0 }): ZipRead {
  // End of central directory: the last signature within 64 KB + 22 of the end.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--)
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return refuse(HOST_LINES.badZip);
  const count = u16(zip, eocd + 10);
  const cdSize = u32(zip, eocd + 12);
  const cdStart = u32(zip, eocd + 16);
  if (u16(zip, eocd + 4) !== 0 || u16(zip, eocd + 6) !== 0 || count !== u16(zip, eocd + 8)) return refuse(HOST_LINES.badZip);
  if (count === 0xffff || cdStart === 0xffffffff || cdSize === 0xffffffff) return refuse(HOST_LINES.badZip);
  if (count > MAX_ENTRIES) return refuse(HOST_LINES.tooManyFiles);
  if (cdStart + cdSize > eocd) return refuse(HOST_LINES.badZip);

  type Raw = ZipEntry & { method: number; compSize: number; local: number };
  const raw: Raw[] = [];
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0, p = cdStart; i < count; i++) {
    if (p + 46 > cdStart + cdSize || u32(zip, p) !== 0x02014b50) return refuse(HOST_LINES.badZip);
    const madeBy = u16(zip, p + 4) >> 8;
    const flags = u16(zip, p + 8);
    const method = u16(zip, p + 10);
    const compSize = u32(zip, p + 20);
    const size = u32(zip, p + 24);
    const nameLen = u16(zip, p + 28);
    const next = p + 46 + nameLen + u16(zip, p + 30) + u16(zip, p + 32);
    const attrs = u32(zip, p + 38);
    const local = u32(zip, p + 42);
    if (next > cdStart + cdSize) return refuse(HOST_LINES.badZip);
    if (flags & 1 || (method !== 0 && method !== 8)) return refuse(HOST_LINES.badZip);
    if (compSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) return refuse(HOST_LINES.badZip);
    let name: string;
    try {
      name = utf8.decode(zip.subarray(p + 46, p + 46 + nameLen));
    } catch {
      return refuse(HOST_LINES.outside);
    }
    // Unix (3) and macOS (19) record the file type in the high 16 bits.
    const isLink = (madeBy === 3 || madeBy === 19) && ((attrs >>> 16) & S_IFMT) === S_IFLNK;
    raw.push({ name, size, isDir: name.endsWith('/') && !isLink, isLink, method, compSize, local });
    p = next;
  }

  const files = raw.filter((e) => !e.isDir);
  const top = stripTopFolder(files.map((e) => e.name));
  const named = files.map((e) => ({ ...e, name: top ? e.name.slice(top.length) : e.name }));
  const problem = zipProblems(named);
  if (problem) return refuse(problem);

  const out: { name: string; data: Uint8Array }[] = [];
  let total = 0;
  for (const e of named) {
    const at = e.local;
    if (at + 30 > cdStart || u32(zip, at) !== 0x04034b50) return refuse(HOST_LINES.badZip);
    const start = at + 30 + u16(zip, at + 26) + u16(zip, at + 28);
    const end = start + e.compSize;
    if (end > cdStart) return refuse(HOST_LINES.badZip);
    const limit = Math.min(e.size, HOST_LIMITS.fileBytes);
    const chunks: Uint8Array[] = [];
    let got = 0;
    const stop: { why: string | null } = { why: null };
    const keep = (chunk: Uint8Array) => {
      if (stop.why) return;
      got += chunk.length;
      total += chunk.length;
      stats.inflated = Math.max(stats.inflated, total);
      if (got > limit) stop.why = got > HOST_LIMITS.fileBytes ? HOST_LINES.fileTooBig : HOST_LINES.badZip;
      else if (total > HOST_LIMITS.siteBytes) stop.why = HOST_LINES.tooBig;
      else chunks.push(chunk);
    };
    if (e.method === 0) keep(zip.slice(start, end));
    else {
      const inflate = new Inflate(keep);
      try {
        if (start === end) inflate.push(new Uint8Array(0), true);
        for (let p = start; p < end && !stop.why; p += PUSH_BYTES) inflate.push(zip.subarray(p, Math.min(p + PUSH_BYTES, end)), p + PUSH_BYTES >= end);
      } catch {
        return refuse(HOST_LINES.badZip);
      }
    }
    if (stop.why) return refuse(stop.why);
    if (got !== e.size) return refuse(HOST_LINES.badZip);
    const data = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) {
      data.set(c, o);
      o += c.length;
    }
    // The Worker serves `/` and `dir/` from `index.html` exactly.
    out.push({ name: e.name.replace(/(^|\/)index\.html$/i, '$1index.html'), data });
  }
  return { files: out };
}

// ---- The flows (database and R2)

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const errorClass = (err: unknown) => (err instanceof Error ? err.name : 'error');
const siteLink = (slug: string) => `https://${slug}.${HOST_ZONE}`;
/** verify.ts's url_checks key for the hosted link (canonicalBuilderUrl adds the `/`). */
const checkKey = (slug: string) => `url:${siteLink(slug)}/`;
const stateKey = (slug: string) => `${STATE_PREFIX}${slug}.json`;
const stateBody = (status: 'live' | 'review' | 'killed' | 'ended', login: string) =>
  new TextEncoder().encode(JSON.stringify({ status, login }));

export type HostOffer = { upload_url: string; expires_at: string } | { sign_in_url: string } | { unavailable: string };

/** Spec C13's gate: an account 30 days or older with at least 1 public repo. Pure. */
export const hostGatePasses = (v: { account_created_at: Date; public_repos: number }, now: Date) =>
  now.getTime() - new Date(v.account_created_at).getTime() >= HOST_LIMITS.accountMinDays * DAY_MS &&
  v.public_repos >= HOST_LIMITS.minPublicRepos;

/** The programs this repo (`owner/repo`) entered, for Ruling 10. */
async function enteredPrograms(repoKey: string): Promise<{ ends_at: Date | null; active: boolean }[]> {
  const rows = await sql()<{ repo_url: string; ends_at: Date | null; active: boolean }[]>`
    SELECT pr.repo_url, p.ends_at, (p.status = 'active') AS active
    FROM projects pr JOIN programs p ON p.id = pr.program_id
    WHERE pr.repo_url ILIKE ${`%${repoKey}%`}`;
  return rows.filter((r) => normalizeRepoUrl(r.repo_url) === `github.com/${repoKey}`);
}

/**
 * Ruling 10: recomputes the expiry of this repo's live or in-review site (confirm_entry and
 * record_submission call it when they record an entry for the repo). Nothing when it has none.
 */
export async function refreshSiteExpiry(repoUrl: string, now = new Date()): Promise<void> {
  const gh = githubRepo(repoUrl);
  if (!gh) return;
  const repoKey = `${gh.owner}/${gh.repo}`.toLowerCase();
  const [site] = await sql()<{ slug: string; deployed_at: Date }[]>`
    SELECT slug, deployed_at FROM hosted_sites WHERE repo_key = ${repoKey} AND status IN ('live', 'review')`;
  if (!site) return;
  const expires = siteExpiry({ deployedAt: site.deployed_at, entered: await enteredPrograms(repoKey), now });
  await sql()`UPDATE hosted_sites SET expires_at = ${expires} WHERE slug = ${site.slug}`;
}

/**
 * The limits a new deploy of `slug` (for `repoKey`, adding `bytes`) must pass, or the refusal and
 * its status: 3 sites per login (this repo's own excluded), 10 deploys in 24 h, total storage
 * under 8 GB, and room in the R2 free tier for its writes.
 */
async function limitProblem(
  db: Db,
  a: { login: string; repoKey: string; slug: string; bytes: number; writes: number; now: Date },
): Promise<{ line: string; status: number } | null> {
  const [r] = await db<{ sites: number; deploys: number; stored: string }[]>`
    SELECT
      (SELECT count(*)::int FROM hosted_sites WHERE lower(login) = ${a.login} AND status IN ('live', 'review') AND repo_key <> ${a.repoKey}) AS sites,
      (SELECT count(*)::int FROM host_deploys WHERE lower(login) = ${a.login} AND at > ${new Date(a.now.getTime() - DAY_MS)}) AS deploys,
      (SELECT coalesce(sum(bytes), 0)::text FROM hosted_sites WHERE status IN ('live', 'review') AND slug <> ${a.slug}) AS stored`;
  if (r.sites >= HOST_LIMITS.sitesPerAccount) return { line: HOST_LINES.sites, status: 409 };
  if (r.deploys >= HOST_LIMITS.deploysPerDay) return { line: HOST_LINES.deploys, status: 429 };
  const stored = Number(r.stored) + a.bytes;
  if (a.bytes > 0 ? stored > HOST_LIMITS.totalBytes : stored >= HOST_LIMITS.totalBytes) return { line: HOST_FULL, status: 507 };
  if (!(await freeTierRoom('r2Writes', a.writes, a.now))) return { line: HOST_FULL, status: 507 };
  return null;
}

/** Why `slug` can't be this repo's site (taken down, or another repo's), or null. */
async function slugProblem(db: Db, slug: string, repoKey: string): Promise<string | null> {
  const rows = await db<{ slug: string; repo_key: string; status: string }[]>`
    SELECT slug, repo_key, status FROM hosted_sites WHERE slug = ${slug} OR repo_key = ${repoKey}`;
  if (rows.some((r) => r.status === 'killed')) return HOST_LINES.takenDown;
  if (rows.some((r) => r.slug === slug && r.repo_key !== repoKey && r.status !== 'ended')) return HOST_LINES.nameTaken;
  return null;
}

/**
 * Ruling 8: prepare_submission's `host: true`. A one-time upload URL (15 minutes) once the repo has
 * a GitHub sign-in that passes the gate and the limits; the sign-in link when it has none (on a
 * shared client: none unused from the last 15 minutes, P11); else a plain reason.
 */
export async function issueUpload(a: { installationId: number; repoKey: string; project: string }, now = new Date()): Promise<HostOffer> {
  if (!r2Enabled() || !githubVerifyEnabled()) return { unavailable: HOST_LINES.unavailable };
  const gh = githubRepo(`https://github.com/${a.repoKey}`);
  if (!gh) return { unavailable: HOST_LINES.noRepo };
  const repoKey = `${gh.owner}/${gh.repo}`.toLowerCase();
  const shared = await sharedGroup(a.installationId);
  const v = await takeHostVerification({ installationId: a.installationId, repoKey, shared }, now);
  if (!v) return { sign_in_url: await createVerifyLink({ installationId: a.installationId, projectId: null, repoKey, purpose: 'host' }, now) };
  if (!hostGatePasses(v, now)) return { unavailable: HOST_LINES.gate };
  const login = v.login.toLowerCase();
  // One site per repo: a redeploy keeps the repo's address while the same account owns it.
  const [own] = await sql()<{ slug: string; login: string }[]>`SELECT slug, login FROM hosted_sites WHERE repo_key = ${repoKey}`;
  const slug = own && own.login.toLowerCase() === login ? own.slug : slugFor(a.project, login);
  if (!slug) return { unavailable: HOST_LINES.badName };
  const taken = await slugProblem(sql(), slug, repoKey);
  if (taken) return { unavailable: taken };
  const limit = await limitProblem(sql(), { login, repoKey, slug, bytes: 0, writes: HOST_LIMITS.files + 3, now });
  if (limit) return { unavailable: limit.line };
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + HOST_LIMITS.uploadTtlMs);
  await sql()`
    INSERT INTO host_upload_tokens (token_hash, installation_id, login, repo_key, slug, project, expires_at)
    VALUES (${sha256(token)}, ${a.installationId}, ${login}, ${repoKey}, ${slug}, ${a.project}, ${expires})`;
  return { upload_url: `${siteUrl()}/api/host/upload?t=${token}`, expires_at: expires.toISOString() };
}

type TokenRow = { installation_id: number; login: string; repo_key: string; slug: string; project: string };

/** The upload token's row while it is unused and unexpired (nothing changes), or null. */
export async function uploadToken(token: string, now = new Date()): Promise<TokenRow | null> {
  if (!token) return null;
  const [row] = await sql()<TokenRow[]>`
    SELECT installation_id, login, repo_key, slug, project FROM host_upload_tokens
    WHERE token_hash = ${sha256(token)} AND used_at IS NULL AND expires_at > ${now}`;
  return row ?? null;
}

export type DeployReply = {
  status: number;
  body: { show_to_builder?: string; url?: string; review?: true; agent_note?: string; error?: string };
};
const refused = (status: number, line: string): DeployReply => ({ status, body: { error: line, show_to_builder: line } });
const TEXT_FILE = /\.(html?|js|mjs)$/i;
const HTML_FILE = /\.html?$/i;

/** Writes a site's state first, then deletes its files (an end or a takedown), then its row. */
async function closeSite(r2: R2, slug: string, login: string, status: 'killed' | 'ended') {
  await r2.put(stateKey(slug), stateBody(status, login), 'application/json');
  await r2.del(await r2.list(`${SITE_PREFIX}${slug}/`));
  await sql()`UPDATE hosted_sites SET status = ${status} WHERE slug = ${slug}`;
  await sql()`DELETE FROM url_checks WHERE key = ${checkKey(slug)}`;
}

/**
 * POST /api/host/upload: the upload URL's token (one use), then the zip: read with hard limits,
 * checked, scanned and badged; the gate and the limits again under one lock; then R2 (the files,
 * old files removed, then the state; a flagged site's `review` state goes first) and the row. A
 * live site's link counts as verified at once (Ruling G19, P39). Errors log the class only.
 */
export async function deploySite(token: string, zip: Uint8Array, deps: { r2?: R2; now?: Date } = {}): Promise<DeployReply> {
  const now = deps.now ?? new Date();
  const r2 = deps.r2 ?? (r2Enabled() ? r2Client() : null);
  if (!r2) return refused(503, HOST_LINES.unavailable);
  if (zip.length > HOST_LIMITS.siteBytes) return refused(413, HOST_LINES.tooBig);
  const t = await uploadToken(token, now);
  if (!t) return refused(410, HOST_LINES.expired);
  const read = readZip(zip);
  if ('problem' in read) return refused(read.status, read.problem);

  const [v] = await sql()<{ account_created_at: Date; public_repos: number }[]>`
    SELECT account_created_at, public_repos FROM github_verifications WHERE login = ${t.login} ORDER BY verified_at DESC, id DESC LIMIT 1`;
  if (!v || !hostGatePasses(v, now)) return refused(403, HOST_LINES.gate);

  const utf8 = new TextDecoder();
  const texts = read.files.filter((f) => TEXT_FILE.test(f.name)).map((f) => ({ path: f.name, text: utf8.decode(f.data) }));
  const flags = abuseFlags(texts);
  const storage = usesStorage(texts);
  const html = new Map(texts.filter((f) => HTML_FILE.test(f.path)).map((f) => [f.path, f.text]));
  const files = read.files.map((f) => {
    const page = html.get(f.name);
    return { name: f.name, data: page === undefined ? f.data : new TextEncoder().encode(withBadge(page, t.login, t.slug)) };
  });
  const bytes = files.reduce((n, f) => n + f.data.length, 0);
  const status = flags.length > 0 ? 'review' : 'live';

  // The limits and the token's one use, serialized across deploys.
  const blocked = await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('earnkit-hosting'))`;
    const taken = await slugProblem(tx, t.slug, t.repo_key);
    if (taken) return { line: taken, status: 409 };
    const limit = await limitProblem(tx, { login: t.login, repoKey: t.repo_key, slug: t.slug, bytes, writes: files.length + 3, now });
    if (limit) return limit;
    const used = await tx`
      UPDATE host_upload_tokens SET used_at = ${now}
      WHERE token_hash = ${sha256(token)} AND used_at IS NULL AND expires_at > ${now} RETURNING 1`;
    if (used.length === 0) return { line: HOST_LINES.expired, status: 410 };
    await tx`INSERT INTO host_deploys (login, slug, at) VALUES (${t.login}, ${t.slug}, ${now})`;
    return null;
  });
  if (blocked) return refused(blocked.status, blocked.line);

  const prefix = `${SITE_PREFIX}${t.slug}/`;
  const [prev] = await sql()<{ slug: string; login: string }[]>`
    SELECT slug, login FROM hosted_sites WHERE repo_key = ${t.repo_key} AND slug <> ${t.slug}`;
  try {
    if (status === 'review') await r2.put(stateKey(t.slug), stateBody('review', t.login), 'application/json');
    const old = await r2.list(prefix);
    for (const f of files) await r2.put(prefix + f.name, f.data, contentTypeFor(f.name));
    const keep = new Set(files.map((f) => prefix + f.name));
    await r2.del(old.filter((k) => !keep.has(k)));
    if (status === 'live') await r2.put(stateKey(t.slug), stateBody('live', t.login), 'application/json');
    // The repo's old address (a renamed project, or another account's): ended, its files removed.
    if (prev) await closeSite(r2, prev.slug, prev.login, 'ended');
  } catch (err) {
    console.error('[hosting] deploy', errorClass(err));
    return err instanceof FreeTierFull ? refused(507, HOST_FULL) : refused(502, HOST_LINES.failed);
  }

  const expires = siteExpiry({ deployedAt: now, entered: await enteredPrograms(t.repo_key), now });
  await sql().begin(async (tx) => {
    if (prev) await tx`DELETE FROM hosted_sites WHERE slug = ${prev.slug}`;
    await tx`
      INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, flags, deployed_at, expires_at)
      VALUES (${t.slug}, ${t.login}, ${t.repo_key}, ${t.installation_id}, ${bytes}, ${files.length}, ${status}, ${flags}, ${now}, ${expires})
      ON CONFLICT (slug) DO UPDATE SET login = EXCLUDED.login, repo_key = EXCLUDED.repo_key,
        installation_id = EXCLUDED.installation_id, bytes = EXCLUDED.bytes, files = EXCLUDED.files, status = EXCLUDED.status,
        flags = EXCLUDED.flags, deployed_at = EXCLUDED.deployed_at, expires_at = EXCLUDED.expires_at`;
    // Ruling G19, P39: a live deploy's link is verified now (no stale failure, no cached 404);
    // a site in review is not.
    if (status === 'live')
      await tx`
        INSERT INTO url_checks (key, ok, checked_at) VALUES (${checkKey(t.slug)}, true, ${now})
        ON CONFLICT (key) DO UPDATE SET ok = true, checked_at = EXCLUDED.checked_at`;
    else await tx`DELETE FROM url_checks WHERE key = ${checkKey(t.slug)}`;
  });
  if (status === 'review') return { status: 200, body: { show_to_builder: HOST_REVIEW, review: true } };
  return {
    status: 200,
    body: { show_to_builder: liveLine(t.project, t.slug), url: siteLink(t.slug), ...(storage && { agent_note: STORAGE_NOTE }) },
  };
}

/** Sites ended per cron run, and rolling expiries set per run. */
const EXPIRE_BATCH = 20;
const ROLLING_BATCH = 50;

/**
 * The hourly cron (Ruling 10): sets `now + 7 days` once on sites whose rolling programs have all
 * ended, then ends up to EXPIRE_BATCH sites past their expiry: `ended` state first (the Worker
 * serves the end page), files deleted, row ended. One site's failure never stops the others.
 */
export async function expireSites(now: Date, deps: { r2?: R2 } = {}): Promise<{ ended: number }> {
  const r2 = deps.r2 ?? r2Client();
  const open = await sql()<{ slug: string; repo_key: string; deployed_at: Date }[]>`
    SELECT slug, repo_key, deployed_at FROM hosted_sites
    WHERE status IN ('live', 'review') AND expires_at IS NULL ORDER BY deployed_at LIMIT ${ROLLING_BATCH}`;
  for (const s of open) {
    const expires = siteExpiry({ deployedAt: s.deployed_at, entered: await enteredPrograms(s.repo_key), now });
    if (expires) await sql()`UPDATE hosted_sites SET expires_at = ${expires} WHERE slug = ${s.slug} AND expires_at IS NULL`;
  }
  const due = await sql()<{ slug: string; login: string }[]>`
    SELECT slug, login FROM hosted_sites
    WHERE status IN ('live', 'review') AND expires_at <= ${now} ORDER BY expires_at LIMIT ${EXPIRE_BATCH}`;
  let ended = 0;
  for (const s of due)
    try {
      await closeSite(r2, s.slug, s.login, 'ended');
      ended++;
    } catch (err) {
      console.error('[hosting] expire', errorClass(err));
    }
  return { ended };
}

/** The owner's kill switch (spec C14): `killed` state first, then the files go. False: no such site. */
export async function takedown(slug: string, deps: { r2?: R2 } = {}): Promise<boolean> {
  const [site] = await sql()<{ login: string }[]>`SELECT login FROM hosted_sites WHERE slug = ${slug.toLowerCase()}`;
  if (!site) return false;
  await closeSite(deps.r2 ?? r2Client(), slug.toLowerCase(), site.login, 'killed');
  return true;
}

/** The owner's review passed: a `review` site goes live. False: no such site in review. */
export async function approveSite(slug: string, deps: { r2?: R2 } = {}): Promise<boolean> {
  const [site] = await sql()<{ login: string }[]>`
    SELECT login FROM hosted_sites WHERE slug = ${slug.toLowerCase()} AND status = 'review'`;
  if (!site) return false;
  await (deps.r2 ?? r2Client()).put(stateKey(slug.toLowerCase()), stateBody('live', site.login), 'application/json');
  await sql()`UPDATE hosted_sites SET status = 'live' WHERE slug = ${slug.toLowerCase()} AND status = 'review'`;
  return true;
}

/** The sites waiting on the owner's review (the cron's needs_owner `host-review:<slug>`, P46). */
export async function sitesInReview(): Promise<string[]> {
  const rows = await sql()<{ slug: string }[]>`SELECT slug FROM hosted_sites WHERE status = 'review' ORDER BY deployed_at`;
  return rows.map((r) => r.slug);
}

// ---- The two routes

/**
 * The request body, at most `max` bytes: null as soon as it passes them (a declared or a streamed
 * length), so a long body is never held.
 */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * POST /api/host/upload?t=<token>: 503 while hosting is off; the token is checked before the body
 * is read (an unknown one never costs a 25 MB read); a body over 25 MB is a 413 before any unzip.
 */
export async function hostUploadPost(request: Request, deps: { r2?: R2 } = {}): Promise<Response> {
  if (!deps.r2 && !r2Enabled()) return json(refused(503, HOST_LINES.unavailable).body, 503);
  const token = new URL(request.url).searchParams.get('t') ?? '';
  if (!(await uploadToken(token))) return json(refused(410, HOST_LINES.expired).body, 410);
  const zip = await readCapped(request, HOST_LIMITS.siteBytes);
  if (!zip) return json(refused(413, HOST_LINES.tooBig).body, 413);
  try {
    const out = await deploySite(token, zip, deps);
    return json(out.body, out.status);
  } catch (err) {
    console.error('[hosting] upload', errorClass(err));
    return json(refused(500, HOST_LINES.failed).body, 500);
  }
}

/**
 * POST /api/host/takedown (Bearer ADMIN_VETO_SECRET), JSON `{ slug, action?: 'kill' | 'approve' }`:
 * the owner's kill switch (default) or the owner's review passing. 401 without the secret.
 */
export async function hostTakedownPost(request: Request, deps: { r2?: R2 } = {}): Promise<Response> {
  if (!bearerMatches(request.headers.get('authorization'), process.env.ADMIN_VETO_SECRET)) return json({ error: 'unauthorized' }, 401);
  if (!deps.r2 && !r2Enabled()) return json({ error: HOST_LINES.unavailable }, 503);
  const body = (await request.json().catch(() => null)) as { slug?: unknown; action?: unknown } | null;
  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const action = body?.action ?? 'kill';
  if (!/^[a-z0-9-]{1,63}$/.test(slug) || (action !== 'kill' && action !== 'approve')) return json({ error: 'slug and action kill or approve' }, 400);
  const done = action === 'approve' ? await approveSite(slug, deps) : await takedown(slug, deps);
  return done ? json({ slug, status: action === 'approve' ? 'live' : 'killed' }) : json({ error: 'no such site' }, 404);
}
