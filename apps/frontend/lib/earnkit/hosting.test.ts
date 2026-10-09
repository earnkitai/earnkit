import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { sql } from './db';
import { runCron } from './cron';
import {
  HOST_FULL,
  HOST_LIMITS,
  HOST_LINES,
  HOST_REVIEW,
  STATIC_EXT,
  STORAGE_NOTE,
  abuseFlags,
  deploySite,
  expireSites,
  hostTakedownPost,
  hostUploadPost,
  approveSite,
  cleanDeploys,
  issueUpload,
  refreshSiteExpiry,
  liveLine,
  readZip,
  siteExpiry,
  sitesInReview,
  slugFor,
  stripTopFolder,
  takedown,
  usesStorage,
  withBadge,
  zipProblems,
  type ZipEntry,
} from './hosting';
import { contentTypeFor } from './host-names';
import { r2Client, r2Enabled, type R2 } from './r2';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const R2_ENV = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'AKIDTEST', R2_SECRET_ACCESS_KEY: 'r2-secret-never-logged-0123456789', R2_BUCKET: 'sites' };

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
const R2_OFF = Object.fromEntries(Object.keys(R2_ENV).map((k) => [k, undefined]));

// ---- Pure

const file = (name: string, size = 10, o: Partial<ZipEntry> = {}): ZipEntry => ({ name, size, isDir: false, isLink: false, ...o });

test('8.1 slugFor: lowercase, runs to -, at most 63 with no trailing -, never reserved, empty or punycode', () => {
  assert.equal(slugFor('TipJar', 'Alice'), 'tipjar-alice');
  assert.equal(slugFor('My App!!', 'a_b'), 'my-app-a-b');
  assert.equal(slugFor('!!!', '___'), null, 'empty');
  assert.equal(slugFor('www', ''), null, 'reserved');
  assert.equal(slugFor('', 'docs'), null, 'reserved');
  assert.equal(slugFor('shop', 'x', { EARNKIT_RESERVED_SUBDOMAINS: 'blog, shop-x' }), null, 'the reserved env list (P41)');
  assert.equal(slugFor('shop', 'y', { EARNKIT_RESERVED_SUBDOMAINS: 'blog, shop-x' }), 'shop-y');
  const long = slugFor('a'.repeat(62) + '-b' + 'c'.repeat(17), 'alice');
  assert.equal(long, 'a'.repeat(62), 'cut to 63, then the trailing - goes');
  const cut = slugFor('x'.repeat(80), 'y'.repeat(80))!;
  assert.equal(cut.length, 63);
  assert.doesNotMatch(cut, /-$/);
  assert.match(cut, /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "the Worker's label");
  // Ruling G19: runs collapse, so `xn--` can't come out of slugFor.
  assert.equal(slugFor('xn--80ak6aa92e', 'bob'), 'xn-80ak6aa92e-bob');
});

test('8.2 zipProblems: every refusal is a plain line; case-insensitive extensions pass', () => {
  const site = (...extra: ZipEntry[]) => [file('index.html'), ...extra];
  assert.equal(zipProblems(site(file('../x.html'))), HOST_LINES.outside);
  assert.equal(zipProblems(site(file('a/../../x.html'))), HOST_LINES.outside);
  assert.equal(zipProblems(site(file('/etc/x'))), HOST_LINES.outside);
  assert.equal(zipProblems(site(file('a\\b.html'))), HOST_LINES.outside);
  assert.equal(zipProblems(site(file('a//b.html'))), HOST_LINES.outside);
  assert.equal(zipProblems(site(file('a/\u0001.html'))), HOST_LINES.outside);
  assert.equal(zipProblems(site(file('link.html', 10, { isLink: true }))), HOST_LINES.outside);
  assert.equal(zipProblems(site(file('setup.exe'))), HOST_LINES.notWebsite);
  assert.equal(zipProblems(site(file('more.zip'))), HOST_LINES.notWebsite);
  assert.equal(zipProblems(site(file('app.apk'))), HOST_LINES.notWebsite);
  assert.equal(zipProblems(site(file('README'))), HOST_LINES.notWebsite, 'no extension');
  assert.equal(zipProblems(site(file('INDEX.html'))), HOST_LINES.twice, 'duplicates, any case');
  assert.equal(zipProblems(Array.from({ length: 501 }, (_, i) => file(i === 0 ? 'index.html' : `f${i}.js`))), HOST_LINES.tooManyFiles);
  assert.equal(zipProblems(site(file('big.png', HOST_LIMITS.fileBytes + 1))), HOST_LINES.fileTooBig);
  const total = Array.from({ length: 3 }, (_, i) => file(`p${i}.png`, 9 * 1024 * 1024));
  assert.equal(zipProblems(site(...total)), HOST_LINES.tooBig, '25 MB + 1');
  assert.equal(zipProblems([file('app.js')]), HOST_LINES.noIndex);
  assert.equal(zipProblems([file('INDEX.HTML'), file('Logo.PNG'), file('assets/', 0, { isDir: true })]), null);
  assert.equal(STATIC_EXT.size, 22);
  for (const ext of STATIC_EXT) assert.notEqual(contentTypeFor(`a.${ext}`), 'application/octet-stream', `the Worker serves .${ext}`);
  assert.equal(stripTopFolder(['dist/index.html', 'dist/a.js']), 'dist/');
  assert.equal(stripTopFolder(['dist/index.html', 'build/a.js']), null);
  assert.equal(stripTopFolder(['index.html', 'a.js']), null);
});

const html = (body: string) => `<!doctype html><html><body>${body}</body></html>`;
const zipOf = (files: Zippable) => zipSync(files, { level: 9 });

/** Sets the central directory's uncompressed size of its first entry (the bomb fixture). */
function lieAboutSize(zip: Uint8Array, size: number) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = zip.length - 22; i >= 0; i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      view.setUint32(view.getUint32(i + 16, true) + 24, size, true);
      return zip;
    }
  throw new Error('no EOCD');
}

test('8.3 the reader stops inflating at the declared size: a 1 KB entry that inflates past 10 MB never inflates in memory', () => {
  const bomb = lieAboutSize(zipOf({ 'index.html': new Uint8Array(11 * 1024 * 1024) }), 1024);
  assert.ok(bomb.length < 100_000, 'the bomb is small');
  const stats = { inflated: 0 };
  const r = readZip(bomb, stats);
  assert.ok('problem' in r);
  assert.ok(stats.inflated < 2 * 1024 * 1024, `stopped early (${stats.inflated} bytes)`);
  // Honest sizes past 10 MB: refused before inflating.
  const honest = { inflated: 0 };
  const big = readZip(zipOf({ 'index.html': strToU8(html('x')), 'a.png': new Uint8Array(HOST_LIMITS.fileBytes + 1) }), honest);
  assert.deepEqual(big, { problem: HOST_LINES.fileTooBig, status: 413 });
  assert.equal(honest.inflated, 0);
});

test('readZip: drops the shared top folder; refuses a symlink, traversal, a non-zip and a truncated entry', () => {
  const ok = readZip(zipOf({ 'dist/index.html': strToU8(html('hi')), 'dist/js/app.js': strToU8('1'), 'dist/js/': {} as Zippable }));
  assert.ok('files' in ok);
  assert.deepEqual(ok.files.map((f) => f.name).sort(), ['index.html', 'js/app.js']);
  assert.equal(new TextDecoder().decode(ok.files.find((f) => f.name === 'index.html')!.data), html('hi'));
  const link = zipOf({ 'index.html': strToU8(html('x')), 'secret.txt': [strToU8('/etc/passwd'), { os: 3, attrs: (0o120777 << 16) >>> 0 }] });
  assert.deepEqual(readZip(link), { problem: HOST_LINES.outside, status: 400 });
  assert.deepEqual(readZip(zipOf({ 'index.html': strToU8('x'), '../evil.html': strToU8('x') })), { problem: HOST_LINES.outside, status: 400 });
  assert.deepEqual(readZip(strToU8('not a zip at all, just text')), { problem: HOST_LINES.badZip, status: 400 });
  const upper = readZip(zipOf({ 'INDEX.HTML': strToU8(html('x')) }));
  assert.ok('files' in upper && upper.files[0].name === 'index.html', 'the Worker serves index.html exactly');
  const short = lieAboutSize(zipOf({ 'index.html': strToU8(html('hello')) }), 9999);
  assert.ok('problem' in readZip(short), 'fewer bytes than declared');
});

test('8.4 abuseFlags: password next to a brand, seed or recovery phrase, a hard-coded approval; a normal login is clean', () => {
  const page = (text: string) => [{ path: 'index.html', text }];
  assert.deepEqual(abuseFlags(page('<form><input type="password"> Connect MetaMask</form>')), ['password-brand']);
  assert.deepEqual(abuseFlags(page("<input type='password'> Coinbase login")), ['password-brand']);
  assert.deepEqual(abuseFlags(page('<input name=p type=password> Chase online banking')), ['password-brand']);
  assert.deepEqual(abuseFlags(page('Enter your seed phrase')), ['seed-phrase']);
  assert.deepEqual(abuseFlags(page('your Recovery  Phrase')), ['seed-phrase']);
  const spender = '0x' + 'ab'.repeat(20);
  assert.deepEqual(abuseFlags([{ path: 'app.js', text: `token.approve(${spender}, MAX)` }]), ['hardcoded-approval']);
  assert.deepEqual(abuseFlags([{ path: 'app.js', text: `nft.setApprovalForAll("${spender}", true)` }]), ['hardcoded-approval']);
  assert.deepEqual(abuseFlags(page('<form><input type="email"><input type="password"><button>Log in</button></form>')), []);
  assert.deepEqual(abuseFlags([{ path: 'app.js', text: 'token.approve(spender, amount)' }]), []);
});

test('8.5 usesStorage: localStorage or indexedDB in a script', () => {
  assert.equal(usesStorage([{ path: 'app.js', text: "localStorage.setItem('k', v)" }]), true);
  assert.equal(usesStorage([{ path: 'db.mjs', text: "const r = indexedDB.open('x')" }]), true);
  assert.equal(usesStorage([{ path: 'index.html', text: "<script>sessionStorage['a'] = 1</script>" }]), true);
  assert.equal(usesStorage([{ path: 'app.js', text: 'const state = new Map()' }]), false);
  assert.equal(usesStorage([{ path: 'notes.txt', text: 'localStorage.setItem' }]), false);
});

test('8.6 withBadge: before </body>, appended without one, the login escaped, the abuse mail names the slug', () => {
  const out = withBadge(html('<p>Hi</p>'), 'alice', 'tipjar-alice');
  assert.match(out, /Built with EarnKit<\/a> by <a [^>]*>@alice<\/a>\. <a [^>]*>Report abuse\.<\/a><\/div><\/body><\/html>$/);
  assert.match(out, /href="mailto:abuse@earnkit\.com\?subject=tipjar-alice"/);
  assert.match(out, /href="https:\/\/earnkit\.com"/);
  assert.match(out, /href="https:\/\/github\.com\/alice"/);
  assert.doesNotMatch(out, /<link|<style|class=/, 'inline styles only');
  assert.match(withBadge('<p>no body tag</p>', 'alice', 's'), /^<p>no body tag<\/p><div /);
  const evil = withBadge(html(''), '<script>x</script>', 's');
  assert.doesNotMatch(evil, /<script>/);
  assert.match(evil, /@&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(withBadge('<BODY>x</BODY>', 'a', 's'), /<\/div><\/BODY>$/);
});

test('8.7 siteExpiry (Ruling 10)', () => {
  const deployedAt = new Date('2026-10-09T15:30:00Z');
  const now = new Date('2026-10-10T00:00:00Z');
  const at = (d: string) => new Date(`${d}T15:30:00Z`);
  assert.deepEqual(
    siteExpiry({ deployedAt, now, entered: [{ ends_at: at('2026-10-14'), active: true }, { ends_at: at('2026-10-21'), active: true }] }),
    at('2026-10-28'),
  );
  assert.deepEqual(siteExpiry({ deployedAt, now, entered: [] }), new Date('2026-10-16T15:30:00Z'));
  assert.equal(siteExpiry({ deployedAt, now, entered: [{ ends_at: null, active: true }, { ends_at: at('2026-10-14'), active: true }] }), null);
  const later = new Date('2026-11-20T00:00:00Z');
  assert.deepEqual(
    siteExpiry({ deployedAt, now: later, entered: [{ ends_at: null, active: false }, { ends_at: at('2026-10-14'), active: false }] }),
    new Date('2026-11-27T00:00:00Z'),
  );
  // Never before upload + 7 days: an old program's end doesn't take a new site down.
  assert.deepEqual(siteExpiry({ deployedAt, now, entered: [{ ends_at: at('2026-09-01'), active: false }] }), new Date('2026-10-16T15:30:00Z'));
});

test('liveLine, the lines and the agent notes', () => {
  assert.equal(liveLine('TipJar', 'tipjar-alice'), 'TipJar is live: tipjar-alice.earnkit.com');
  assert.equal(HOST_FULL, 'Hosting is full right now; try again tomorrow.');
  assert.equal(HOST_REVIEW, 'Your site is waiting on a quick review before it goes live.');
  assert.equal(HOST_LINES.tooBig, 'Sites can be at most 25 MB.');
  assert.equal(HOST_LINES.notWebsite, 'Only website files can be hosted (no .exe).');
  assert.equal(HOST_LINES.sites, 'You have 3 live sites, the most allowed.');
  assert.equal(HOST_LINES.gate, 'Hosting needs a GitHub account at least 30 days old with a public repo.');
  assert.equal(HOST_LINES.deploys, "You've deployed 10 times today; try again tomorrow.");
  assert.equal(r2Enabled({}), false);
  assert.equal(r2Enabled({ ...R2_ENV, R2_BUCKET: ' ' }), false);
  assert.equal(r2Enabled(R2_ENV), true);
});

// ---- Database, with a fake R2 recording calls

after(async () => {
  if (process.env.DATABASE_URL) {
    await sql()`DELETE FROM hosted_sites WHERE login LIKE 'hz%' OR slug = 'tipjar-alice'`;
    await sql()`DELETE FROM host_deploys WHERE login LIKE 'hz%' OR slug = 'tipjar-alice'`;
    await sql().end();
  }
});

function fakeR2(seed: string[] = []) {
  const objects = new Map<string, { body: Uint8Array; type: string }>(seed.map((k) => [k, { body: new Uint8Array(1), type: 'x' }]));
  const calls: string[] = [];
  const r2: R2 = {
    put: async (key, body, type) => {
      calls.push(`put ${key}`);
      objects.set(key, { body, type });
    },
    list: async (prefix) => {
      calls.push(`list ${prefix}`);
      return [...objects.keys()].filter((k) => k.startsWith(prefix));
    },
    del: async (keys) => {
      calls.push(`del ${keys.join(',')}`);
      for (const k of keys) objects.delete(k);
    },
    copy: async (from, to) => {
      calls.push(`copy ${from} ${to}`);
      const o = objects.get(from);
      if (!o) throw new Error('no such key');
      objects.set(to, o);
    },
  };
  const state = (slug: string) => {
    const o = objects.get(`state/${slug}.json`);
    return o ? (JSON.parse(new TextDecoder().decode(o.body)) as { status: string; login: string }) : null;
  };
  return { r2, objects, calls, state };
}

const stamp = () => `${process.pid}${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** An installation, a GitHub sign-in for `login` and an upload token for `slug`. */
async function upload(o: { login?: string; slug?: string; project?: string; accountDays?: number; publicRepos?: number; expiresMs?: number; used?: boolean } = {}) {
  const login = o.login ?? `hz${stamp()}`;
  const slug = o.slug ?? `site-${login}`;
  const repoKey = `${login}/${slug}`;
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`hz-${stamp()}`}) RETURNING id`;
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
    VALUES (${repoKey}, ${login}, ${id}, ${new Date(Date.now() - (o.accountDays ?? 400) * 86_400_000)}, ${o.publicRepos ?? 2}, 'host')`;
  const token = randomBytes(32).toString('base64url');
  await sql()`
    INSERT INTO host_upload_tokens (token_hash, installation_id, login, repo_key, slug, project, expires_at, used_at)
    VALUES (${sha(token)}, ${id}, ${login}, ${repoKey}, ${slug}, ${o.project ?? 'TipJar'}, ${new Date(Date.now() + (o.expiresMs ?? 900_000))},
      ${o.used ? new Date() : null})`;
  return { login, slug, repoKey, token, installationId: id };
}

const site = (extra: Zippable = {}) => zipOf({ 'index.html': strToU8(html('<h1>Tip Jar</h1>')), ...extra });

test('8.8 deploySite refusals write nothing', db, async () => {
  const check = async (name: string, status: number, line: string, run: (r2: R2) => Promise<{ status: number; body: { show_to_builder?: string } }>) => {
    const f = fakeR2();
    const out = await run(f.r2);
    assert.equal(out.status, status, name);
    assert.equal(out.body.show_to_builder, line, name);
    assert.deepEqual(f.calls, [], `${name}: nothing written`);
  };
  const u = await upload();
  await check('26 MB', 413, HOST_LINES.tooBig, (r2) => deploySite(u.token, new Uint8Array(26 * 1024 * 1024), { r2 }));
  await check('.exe', 400, HOST_LINES.notWebsite, (r2) => deploySite(u.token, site({ 'setup.exe': strToU8('MZ') }), { r2 }));

  const four = await upload();
  await sql()`
    INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status)
    SELECT ${four.login} || '-' || n, ${four.login}, ${four.login} || '/r' || n, ${four.installationId}, 10, 1, 'live' FROM generate_series(1, 3) n`;
  await check('a fourth site', 409, HOST_LINES.sites, (r2) => deploySite(four.token, site(), { r2 }));

  const busy = await upload();
  await sql()`INSERT INTO host_deploys (login, slug) SELECT ${busy.login}, ${busy.slug} FROM generate_series(1, 10)`;
  await check('the 11th deploy today', 429, HOST_LINES.deploys, (r2) => deploySite(busy.token, site(), { r2 }));

  const young = await upload({ accountDays: 29 });
  await check('29 days old', 403, HOST_LINES.gate, (r2) => deploySite(young.token, site(), { r2 }));
  const noRepos = await upload({ publicRepos: 0 });
  await check('no public repo', 403, HOST_LINES.gate, (r2) => deploySite(noRepos.token, site(), { r2 }));

  const expired = await upload({ expiresMs: -1000 });
  await check('expired token', 410, HOST_LINES.expired, (r2) => deploySite(expired.token, site(), { r2 }));
  const used = await upload({ used: true });
  await check('used token', 410, HOST_LINES.expired, (r2) => deploySite(used.token, site(), { r2 }));
  await check('unknown token', 410, HOST_LINES.expired, (r2) => deploySite('nope', site(), { r2 }));

  const full = await upload();
  const filler = `hzfill${stamp()}`;
  await sql()`
    INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status)
    VALUES (${filler}, ${filler}, ${`${filler}/x`}, ${full.installationId}, ${HOST_LIMITS.totalBytes - 2_000_000}, 1, 'live')`;
  try {
    await check('over 8 GB', 507, HOST_FULL, (r2) => deploySite(full.token, site({ 'a.png': new Uint8Array(3_000_000) }), { r2 }));
  } finally {
    await sql()`DELETE FROM hosted_sites WHERE slug = ${filler}`;
  }
  // The refusals above never used a token: the 26 MB one still works.
  const ok = fakeR2();
  assert.equal((await deploySite(u.token, site(), { r2: ok.r2 })).status, 200);
  assert.equal((await deploySite(u.token, site(), { r2: ok.r2 })).status, 410, 'one use');
});

test('8.9 a clean zip goes live; a flagged one goes to review and waits on the owner', db, async () => {
  await sql()`DELETE FROM hosted_sites WHERE slug = 'tipjar-alice' OR repo_key = 'alice/tipjar-alice'`;
  await sql()`DELETE FROM host_deploys WHERE login = 'alice'`;
  await sql()`DELETE FROM github_verifications WHERE login = 'alice' AND repo_key = 'alice/tipjar-alice'`;
  await sql()`INSERT INTO url_checks (key, ok, checked_at) VALUES ('url:https://tipjar-alice.earnkit.com/', false, now())
    ON CONFLICT (key) DO UPDATE SET ok = false, checked_at = now()`;
  const u = await upload({ login: 'alice', slug: 'tipjar-alice' });
  const f = fakeR2(['sites/tipjar-alice/old.html', 'sites/tipjar-alice/index.html']);
  const zip = zipOf({
    'dist/index.html': strToU8(html('<h1>Tip Jar</h1>')),
    'dist/app.js': strToU8("localStorage.setItem('tips', '1')"),
    'dist/img/logo.png': new Uint8Array([137, 80, 78, 71]),
  });
  const out = await deploySite(u.token, zip, { r2: f.r2 });
  assert.equal(out.status, 200);
  assert.equal(out.body.show_to_builder, 'TipJar is live: tipjar-alice.earnkit.com');
  assert.equal(out.body.url, 'https://tipjar-alice.earnkit.com');
  assert.equal(out.body.agent_note, STORAGE_NOTE);
  assert.ok(!f.objects.has('sites/tipjar-alice/old.html'), 'old files deleted');
  assert.equal(f.objects.get('sites/tipjar-alice/index.html')?.type, 'text/html; charset=utf-8');
  assert.equal(f.objects.get('sites/tipjar-alice/app.js')?.type, 'text/javascript');
  assert.equal(f.objects.get('sites/tipjar-alice/img/logo.png')?.type, 'image/png');
  assert.match(new TextDecoder().decode(f.objects.get('sites/tipjar-alice/index.html')!.body), /Report abuse\.<\/a><\/div><\/body>/);
  assert.deepEqual(f.state('tipjar-alice'), { status: 'live', login: 'alice' });
  assert.equal(f.calls.at(-1), 'put state/tipjar-alice.json', 'the live state is written last');
  const [row] = await sql()<{ status: string; files: number; repo_key: string; expires_at: Date }[]>`
    SELECT status, files, repo_key, expires_at FROM hosted_sites WHERE slug = 'tipjar-alice'`;
  assert.equal(row.status, 'live');
  assert.equal(row.files, 3);
  assert.equal(row.repo_key, 'alice/tipjar-alice');
  assert.ok(Math.abs(row.expires_at.getTime() - (Date.now() + 7 * 86_400_000)) < 60_000, 'no entry: upload + 7 days');
  // Ruling G19, P39: the hosted link counts as verified now, the stale failure gone.
  const [check] = await sql()<{ ok: boolean }[]>`SELECT ok FROM url_checks WHERE key = 'url:https://tipjar-alice.earnkit.com/'`;
  assert.equal(check.ok, true);

  // Flagged: review state first, the review line, and the owner's needs_owner.
  const again = await upload({ login: 'alice', slug: 'tipjar-alice' });
  await sql()`DELETE FROM host_upload_tokens WHERE token_hash = ${sha(again.token)}`;
  await sql()`
    INSERT INTO host_upload_tokens (token_hash, installation_id, login, repo_key, slug, project, expires_at)
    VALUES (${sha(again.token)}, ${u.installationId}, 'alice', 'alice/tipjar-alice', 'tipjar-alice', 'TipJar', ${new Date(Date.now() + 900_000)})`;
  const g = fakeR2();
  const flagged = await deploySite(again.token, site({ 'img/help.svg': strToU8('<svg><text>Type your seed phrase to restore</text></svg>') }), { r2: g.r2 });
  assert.equal(flagged.status, 200);
  assert.deepEqual(flagged.body, { show_to_builder: HOST_REVIEW, review: true });
  assert.ok(g.calls.every((c) => !c.includes(' sites/') && !c.includes(' state/')), 'nothing served is written (I1)');
  const [r] = await sql()<{ status: string }[]>`SELECT status FROM hosted_sites WHERE slug = 'tipjar-alice'`;
  assert.equal(r.status, 'live', 'the approved site keeps serving');
  const [d] = await sql()<{ status: string; flags: string[] }[]>`
    SELECT status, flags FROM host_deploys WHERE slug = 'tipjar-alice' ORDER BY id DESC LIMIT 1`;
  assert.deepEqual(d, { status: 'review', flags: ['seed-phrase'] });
  assert.ok((await sitesInReview()).includes('tipjar-alice'));
  const cron = await withEnv(R2_ENV, () => runCron({ only: ['hz-none'], deps: { hosting: { r2: fakeR2().r2 } } }));
  assert.ok(cron.needs_owner.includes('host-review:tipjar-alice'));
  await sql()`UPDATE hosted_sites SET status = 'ended' WHERE slug = 'tipjar-alice'`;
  await sql()`UPDATE host_deploys SET status = 'cleaned' WHERE slug = 'tipjar-alice' AND status = 'review'`;
});

test('8.10 expireSites ends a site past its expiry and sets a rolling site whose programs ended once', db, async () => {
  const s = stamp();
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`hz-exp-${s}`}) RETURNING id`;
  const programId = `hz-exp-${s}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, ends_at)
    VALUES (${programId}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'closed', 'allowed', NULL)`;
  const due = `hzdue${s}`;
  const rolling = `hzroll${s}`;
  await sql()`INSERT INTO projects (program_id, name, installation_id, repo_url) VALUES (${programId}, 'R', ${inst}, ${`https://github.com/hz${s}/roll`})`;
  await sql()`
    INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at, expires_at) VALUES
      (${due}, ${`hz${s}`}, ${`hz${s}/due`}, ${inst}, 10, 1, 'live', '2026-10-01', '2026-10-28T00:00:00Z'),
      (${rolling}, ${`hz${s}`}, ${`hz${s}/roll`}, ${inst}, 10, 1, 'live', '2026-10-01', NULL)`;
  const f = fakeR2([`sites/${due}/index.html`, `sites/${due}/a.js`, `sites/${rolling}/index.html`]);
  const now = new Date('2026-10-28T00:00:01Z');
  const out = await expireSites(now, { r2: f.r2 });
  assert.ok(out.ended >= 1);
  assert.deepEqual(f.state(due), { status: 'ended', login: `hz${s}` });
  assert.ok(!f.objects.has(`sites/${due}/index.html`) && !f.objects.has(`sites/${due}/a.js`), 'files deleted');
  assert.ok(f.calls.indexOf(`put state/${due}.json`) < f.calls.findIndex((c) => c.startsWith(`del sites/${due}/`)), 'ended state before the delete');
  const rows = await sql()<{ slug: string; status: string; expires_at: Date | null }[]>`
    SELECT slug, status, expires_at FROM hosted_sites WHERE slug IN (${due}, ${rolling}) ORDER BY slug`;
  const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
  assert.equal(by[due].status, 'ended');
  assert.equal(by[rolling].status, 'live');
  assert.deepEqual(by[rolling].expires_at, new Date(now.getTime() + 7 * 86_400_000));
  assert.ok(f.objects.has(`sites/${rolling}/index.html`), 'the rolling site keeps its files');
  await sql()`DELETE FROM projects WHERE program_id = ${programId}`;
  await sql()`DELETE FROM programs WHERE id = ${programId}`;
});

test('8.11 takedown writes killed before deleting files; the route needs the Bearer secret', db, async () => {
  await sql()`DELETE FROM hosted_sites WHERE slug = 'tipjar-alice' OR repo_key = 'alice/tipjar-alice'`;
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`hz-kill-${stamp()}`}) RETURNING id`;
  await sql()`
    INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status)
    VALUES ('tipjar-alice', 'alice', 'alice/tipjar-alice', ${id}, 10, 1, 'live')`;
  const f = fakeR2(['sites/tipjar-alice/index.html']);
  const secret = 'k'.repeat(40);
  await withEnv({ ADMIN_VETO_SECRET: secret, ...R2_ENV }, async () => {
    const req = (auth?: string) =>
      new Request('https://earnkit.com/api/host/takedown', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth && { authorization: auth }) },
        body: JSON.stringify({ slug: 'tipjar-alice' }),
      });
    assert.equal((await hostTakedownPost(req(), { r2: f.r2 })).status, 401);
    assert.equal((await hostTakedownPost(req('Bearer wrong-wrong-wrong-wrong-wrong-wrong'), { r2: f.r2 })).status, 401);
    assert.deepEqual(f.calls, []);
    const [still] = await sql()<{ status: string }[]>`SELECT status FROM hosted_sites WHERE slug = 'tipjar-alice'`;
    assert.equal(still.status, 'live');
    const res = await hostTakedownPost(req(`Bearer ${secret}`), { r2: f.r2 });
    assert.equal(res.status, 200);
  });
  assert.equal(f.calls[0], 'put state/tipjar-alice.json', 'killed goes first');
  assert.deepEqual(f.state('tipjar-alice'), { status: 'killed', login: 'alice' });
  assert.equal(f.objects.has('sites/tipjar-alice/index.html'), false);
  const [row] = await sql()<{ status: string }[]>`SELECT status FROM hosted_sites WHERE slug = 'tipjar-alice'`;
  assert.equal(row.status, 'killed');
  assert.equal(await takedown('no-such-site-here', { r2: f.r2 }), false);
  // A killed site can't come back with a new upload.
  await sql()`DELETE FROM host_deploys WHERE login = 'alice'`;
  const u = await upload({ login: 'alice', slug: 'tipjar-alice' });
  await sql()`UPDATE host_upload_tokens SET repo_key = 'alice/tipjar-alice' WHERE token_hash = ${sha(u.token)}`;
  const back = await deploySite(u.token, site(), { r2: fakeR2().r2 });
  assert.equal(back.status, 409);
  assert.equal(back.body.show_to_builder, HOST_LINES.takenDown);
  await sql()`DELETE FROM hosted_sites WHERE slug = 'tipjar-alice'`;
});

test('8.12 with the R2 variables absent the upload route answers 503 and the cron skips expireSites', db, async () => {
  await withEnv(R2_OFF, async () => {
    const res = await hostUploadPost(new Request('https://earnkit.com/api/host/upload?t=x', { method: 'POST', body: site() }));
    assert.equal(res.status, 503);
    const f = fakeR2();
    const out = await runCron({ only: ['hz-none'], deps: { hosting: { r2: f.r2 } } });
    assert.equal('hosting' in out, false);
    assert.deepEqual(f.calls, []);
    assert.equal(out.needs_owner.some((n) => n.startsWith('host-review:')), false);
  });
  await withEnv(R2_ENV, async () => {
    const out = await runCron({ only: ['hz-none'], deps: { hosting: { r2: fakeR2().r2 } } });
    assert.ok('hosting' in out, 'on with R2');
  });
});

test('the upload route checks the token before reading the body, and caps the body', db, async () => {
  await withEnv(R2_ENV, async () => {
    const r2 = fakeR2().r2;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const bad = await hostUploadPost(new Request('https://earnkit.com/api/host/upload?t=unknown', { method: 'POST', body, duplex: 'half' } as RequestInit), { r2 });
    assert.equal(bad.status, 410);
    assert.ok(pulled <= 1, 'the body was not read');
    const u = await upload();
    const endless = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(new Uint8Array(1024 * 1024)) });
    const big = await hostUploadPost(new Request(`https://earnkit.com/api/host/upload?t=${u.token}`, { method: 'POST', body: endless, duplex: 'half' } as RequestInit), { r2 });
    assert.equal(big.status, 413);
    const ok = await hostUploadPost(new Request(`https://earnkit.com/api/host/upload?t=${u.token}`, { method: 'POST', body: site() }), { r2 });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { show_to_builder: string }).show_to_builder, `TipJar is live: ${u.slug}.earnkit.com`);
  });
});

test('8.13 an R2 failure logs the error class only, never the secret key or the upload token', db, async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  const origFetch = globalThis.fetch;
  try {
    const u = await upload();
    const boom: R2 = {
      put: async () => {
        throw new Error(`denied ${R2_ENV.R2_SECRET_ACCESS_KEY} ${u.token}`);
      },
      list: async () => [],
      del: async () => {},
      copy: async () => {},
    };
    const out = await deploySite(u.token, site(), { r2: boom });
    assert.equal(out.status, 502);
    assert.equal(out.body.show_to_builder, HOST_LINES.failed);
    // The real client's error: the operation and status only.
    globalThis.fetch = (async () => new Response(`<Error>${R2_ENV.R2_SECRET_ACCESS_KEY}</Error>`, { status: 403 })) as typeof fetch;
    const err = await r2Client(R2_ENV)
      .put('sites/x/index.html', new Uint8Array(1), 'text/html')
      .then(() => null, (e: unknown) => e as Error);
    assert.equal(err?.message, 'R2 put failed (403)');
    logged.push(String(err), err?.stack ?? '');
    const all = logged.join('\n');
    assert.match(all, /\[hosting\] deploy Error/);
    assert.ok(!all.includes(R2_ENV.R2_SECRET_ACCESS_KEY), 'no secret');
    assert.ok(!all.includes(u.token), 'no upload token');
  } finally {
    console.error = orig;
    globalThis.fetch = origFetch;
  }
});

test('P11: on a shared client the host sign-in is used by one upload URL; elsewhere the install and repo binding holds', db, async () => {
  const on = { ...R2_ENV, GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret' };
  await withEnv(on, async () => {
    for (const shared of [true, false]) {
      const login = `hz${stamp()}`;
      const [{ id }] = await sql()<{ id: number }[]>`
        INSERT INTO installations (token_hash, shared_client) VALUES (${`hz-p11-${stamp()}`}, ${shared}) RETURNING id`;
      const repoKey = `${login}/tipjar`;
      await sql()`
        INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
        VALUES (${repoKey}, ${login}, ${id}, '2020-01-01', 3, 'host')`;
      const first = await issueUpload({ installationId: id, repoKey, project: 'TipJar' });
      assert.ok('upload_url' in first, `${shared}: first`);
      const second = await issueUpload({ installationId: id, repoKey, project: 'TipJar' });
      assert.equal('sign_in_url' in second, shared, `${shared}: a second URL needs a new sign-in only on a shared client`);
      const [t] = await sql()<{ slug: string; login: string }[]>`SELECT slug, login FROM host_upload_tokens WHERE installation_id = ${id} LIMIT 1`;
      assert.deepEqual(t, { slug: `tipjar-${login}`, login });
    }
    // An account under 30 days: a plain reason, no URL.
    const young = `hz${stamp()}`;
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`hz-young-${stamp()}`}) RETURNING id`;
    await sql()`
      INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
      VALUES (${`${young}/app`}, ${young}, ${id}, ${new Date(Date.now() - 29 * 86_400_000)}, 3, 'host')`;
    assert.deepEqual(await issueUpload({ installationId: id, repoKey: `${young}/app`, project: 'App' }), { unavailable: HOST_LINES.gate });
  });
});

test('Ruling 10: an entry recorded for the repo moves its site expiry to the program end + 7 days', db, async () => {
  const s = stamp();
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`hz-ent-${s}`}) RETURNING id`;
  const programId = `hz-ent-${s}`;
  const ends = new Date('2099-03-01T12:00:00Z');
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, ends_at)
    VALUES (${programId}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed', ${ends})`;
  const slug = `hzent${s}`;
  await sql()`
    INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, expires_at)
    VALUES (${slug}, ${`hz${s}`}, ${`hz${s}/app`}, ${inst}, 10, 1, 'live', now())`;
  await sql()`INSERT INTO projects (program_id, name, installation_id, repo_url) VALUES (${programId}, 'App', ${inst}, ${`https://github.com/HZ${s}/App/`})`;
  await refreshSiteExpiry(`https://github.com/hz${s}/app`);
  const [row] = await sql()<{ expires_at: Date }[]>`SELECT expires_at FROM hosted_sites WHERE slug = ${slug}`;
  assert.deepEqual(row.expires_at, new Date(ends.getTime() + 7 * 86_400_000));
  await sql()`DELETE FROM projects WHERE program_id = ${programId}`;
  await sql()`DELETE FROM programs WHERE id = ${programId}`;
});

// ---- Fix round 1 (task-8-review.md I1 to I4)

const text = (o: { body: Uint8Array } | undefined) => (o ? new TextDecoder().decode(o.body) : '');
const servedKeys = (f: ReturnType<typeof fakeR2>, slug: string) =>
  [...f.objects.keys()].filter((k) => k.startsWith(`sites/${slug}/`) || k === `state/${slug}.json`).sort();
const snapshot = (f: ReturnType<typeof fakeR2>, slug: string) => servedKeys(f, slug).map((k) => `${k}=${text(f.objects.get(k))}`);
/** A live site for `u` in the DB and the fake R2. */
async function liveSite(u: Awaited<ReturnType<typeof upload>>, f: ReturnType<typeof fakeR2>) {
  const first = await deploySite(u.token, site(), { r2: f.r2 });
  assert.equal(first.status, 200);
  const again = randomBytes(32).toString('base64url');
  await sql()`
    INSERT INTO host_upload_tokens (token_hash, installation_id, login, repo_key, slug, project, expires_at)
    VALUES (${sha(again)}, ${u.installationId}, ${u.login}, ${u.repoKey}, ${u.slug}, 'TipJar', ${new Date(Date.now() + 900_000)})`;
  return again;
}
const PHISH = { 'login.html': strToU8(html('<input type="password"> Connect MetaMask')) };

test('I1: a flagged redeploy never touches the served files; flagged content reaches sites/ only on approval', db, async () => {
  const u = await upload();
  const f = fakeR2();
  const token = await liveSite(u, f);
  const before = snapshot(f, u.slug);
  const flagged = await deploySite(token, site(PHISH), { r2: f.r2 });
  assert.deepEqual(flagged.body, { show_to_builder: HOST_REVIEW, review: true });
  assert.deepEqual(snapshot(f, u.slug), before, 'the live site is untouched, its state still live');
  assert.equal(f.state(u.slug)?.status, 'live');
  assert.ok([...f.objects.keys()].some((k) => k.startsWith(`staging/${u.slug}/`) && k.endsWith('/login.html')), 'staged');
  assert.ok(!servedKeys(f, u.slug).some((k) => k.endsWith('login.html')));
  const [row] = await sql()<{ status: string }[]>`SELECT status FROM hosted_sites WHERE slug = ${u.slug}`;
  assert.equal(row.status, 'live', 'the old approved site keeps serving');
  assert.ok((await sitesInReview()).includes(u.slug), 'the owner sees it');
  // Approval copies it into place, then the staging copy goes.
  assert.equal(await approveSite(u.slug, { r2: f.r2 }), true);
  assert.match(text(f.objects.get(`sites/${u.slug}/login.html`)), /MetaMask/);
  assert.equal(f.state(u.slug)?.status, 'live');
  assert.ok(![...f.objects.keys()].some((k) => k.startsWith(`staging/${u.slug}/`)), 'staging cleaned');
  assert.ok(!(await sitesInReview()).includes(u.slug));
  const [after] = await sql()<{ status: string; flags: string[] }[]>`SELECT status, flags FROM hosted_sites WHERE slug = ${u.slug}`;
  assert.deepEqual(after, { status: 'live', flags: ['password-brand'] });
});

test('I1: a new flagged site writes nothing the Worker serves, not even a state', db, async () => {
  const u = await upload();
  const f = fakeR2();
  const out = await deploySite(u.token, site(PHISH), { r2: f.r2 });
  assert.equal(out.body.review, true);
  assert.deepEqual(servedKeys(f, u.slug), []);
  const [row] = await sql()<{ status: string; bytes: string }[]>`SELECT status, bytes::text FROM hosted_sites WHERE slug = ${u.slug}`;
  assert.equal(row.status, 'review');
  assert.equal(await takedown(u.slug, { r2: f.r2 }), true);
  assert.ok(![...f.objects.keys()].some((k) => k.startsWith(`staging/${u.slug}/`)), 'a kill removes the staged copy');
  assert.equal(f.state(u.slug)?.status, 'killed');
});

/** A fake R2 whose writes wait a tick, so concurrent deploys interleave. */
function slowR2() {
  const f = fakeR2();
  const wait = () => new Promise((r) => setTimeout(r, 5));
  const r2: R2 = {
    put: async (k, b, t) => (await wait(), f.r2.put(k, b, t)),
    list: async (p) => (await wait(), f.r2.list(p)),
    del: async (k) => (await wait(), f.r2.del(k)),
    copy: async (a, b) => (await wait(), f.r2.copy(a, b)),
  };
  return { ...f, r2 };
}

test('I2: concurrent deploys by one login never pass 3 sites', db, async () => {
  const login = `hz${stamp()}`;
  const ups = [];
  for (let i = 0; i < 5; i++) ups.push(await upload({ login, slug: `s${i}-${login}` }));
  const f = slowR2();
  const out = await Promise.all(ups.map((u) => deploySite(u.token, site(), { r2: f.r2 })));
  assert.ok(out.some((o) => o.status !== 200), 'some are refused');
  const [{ n }] = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM hosted_sites WHERE login = ${login} AND status IN ('live', 'review', 'deploying')`;
  assert.ok(n <= 3, `${n} sites`);
  // One after another: exactly 3.
  for (const u of ups) {
    const t = randomBytes(32).toString('base64url');
    await sql()`
      INSERT INTO host_upload_tokens (token_hash, installation_id, login, repo_key, slug, project, expires_at)
      VALUES (${sha(t)}, ${u.installationId}, ${login}, ${u.repoKey}, ${u.slug}, 'TipJar', ${new Date(Date.now() + 900_000)})`;
    await deploySite(t, site(), { r2: f.r2 });
  }
  const [{ m }] = await sql()<{ m: number }[]>`SELECT count(*)::int AS m FROM hosted_sites WHERE login = ${login} AND status = 'live'`;
  assert.equal(m, 3);
});

test('I2: a flagged and a clean zip racing on one repo never publish the flagged one', db, async () => {
  for (const order of [0, 1]) {
    const u = await upload();
    const second = randomBytes(32).toString('base64url');
    await sql()`
      INSERT INTO host_upload_tokens (token_hash, installation_id, login, repo_key, slug, project, expires_at)
      VALUES (${sha(second)}, ${u.installationId}, ${u.login}, ${u.repoKey}, ${u.slug}, 'TipJar', ${new Date(Date.now() + 900_000)})`;
    const f = slowR2();
    const runs = [() => deploySite(u.token, site(PHISH), { r2: f.r2 }), () => deploySite(second, site(), { r2: f.r2 })];
    const out = await Promise.all(order ? runs.reverse().map((r) => r()) : runs.map((r) => r()));
    assert.ok(out.some((o) => o.status === 409), 'the second waits its turn');
    assert.ok(!servedKeys(f, u.slug).some((k) => k.endsWith('login.html')), 'flagged never served');
  }
});

test('I2: a new upload link revokes the unused ones for the repo', db, async () => {
  await withEnv({ ...R2_ENV, GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret' }, async () => {
    const login = `hz${stamp()}`;
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`hz-rev-${stamp()}`}) RETURNING id`;
    await sql()`
      INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
      VALUES (${`${login}/app`}, ${login}, ${id}, '2020-01-01', 3, 'host')`;
    const a = await issueUpload({ installationId: id, repoKey: `${login}/app`, project: 'App' });
    const b = await issueUpload({ installationId: id, repoKey: `${login}/app`, project: 'App' });
    assert.ok('upload_url' in a && 'upload_url' in b);
    const ta = new URL(a.upload_url).searchParams.get('t')!;
    const tb = new URL(b.upload_url).searchParams.get('t')!;
    const r = await deploySite(ta, site(), { r2: fakeR2().r2 });
    assert.equal(r.status, 410, 'the older link is revoked');
    assert.equal((await deploySite(tb, site(), { r2: fakeR2().r2 })).status, 200);
  });
});

test('I3: a write that fails mid-way marks the deploy failed, counts its bytes, and the cron removes its keys', db, async () => {
  const u = await upload();
  const f = fakeR2();
  let puts = 0;
  const flaky: R2 = { ...f.r2, put: async (k, b, t) => (++puts > 2 ? Promise.reject(new Error('R2 500')) : f.r2.put(k, b, t)) };
  const out = await deploySite(u.token, site({ 'a.js': strToU8('1'), 'b.js': strToU8('2'), 'c.js': strToU8('3') }), { r2: flaky });
  assert.equal(out.status, 502);
  assert.equal(f.state(u.slug), null, 'never live');
  const [d] = await sql()<{ status: string; written: string[]; bytes: string }[]>`
    SELECT status, written, bytes::text FROM host_deploys WHERE slug = ${u.slug} ORDER BY id DESC LIMIT 1`;
  assert.equal(d.status, 'failed');
  assert.ok(d.written.length >= 2 && Number(d.bytes) > 0, 'its keys and bytes are tracked');
  const [site0] = await sql()<{ status: string }[]>`SELECT status FROM hosted_sites WHERE slug = ${u.slug}`;
  assert.equal(site0.status, 'failed');
  assert.ok([...f.objects.keys()].some((k) => k.includes(u.slug)), 'objects left');
  await cleanDeploys(new Date(), { r2: f.r2 });
  assert.ok(![...f.objects.keys()].some((k) => k.includes(u.slug)), 'cleaned');
  const [c] = await sql()<{ status: string }[]>`SELECT status FROM host_deploys WHERE slug = ${u.slug} ORDER BY id DESC LIMIT 1`;
  assert.equal(c.status, 'cleaned');
});

test('I3: a deploy stuck in deploying for 10 minutes is failed and cleaned; takedown finds a slug with objects and no row', db, async () => {
  const s = `hzghost${stamp()}`;
  const f = fakeR2([`sites/${s}/index.html`, `staging/${s}/9/index.html`]);
  await f.r2.put(`state/${s}.json`, new TextEncoder().encode('{"status":"live","login":"x"}'), 'application/json');
  assert.equal(await takedown(s, { r2: f.r2 }), true);
  assert.equal(f.state(s)?.status, 'killed');
  assert.deepEqual([...f.objects.keys()].filter((k) => k.includes(s)), [`state/${s}.json`]);
  assert.equal(await takedown(`hznothing${stamp()}`, { r2: fakeR2().r2 }), false);

  const login = `hz${stamp()}`;
  await sql()`
    INSERT INTO host_deploys (login, slug, repo_key, at, status, bytes, written)
    VALUES (${login}, ${`st-${login}`}, ${`${login}/st`}, ${new Date(Date.now() - 11 * 60_000)}, 'deploying', 5, ${[`sites/st-${login}/index.html`]})`;
  const g = fakeR2([`sites/st-${login}/index.html`]);
  await cleanDeploys(new Date(), { r2: g.r2 });
  assert.equal(g.objects.size, 0);
});

test('I4: more than 50 rolling sites never starve a site whose programs ended', db, async () => {
  const s = stamp();
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`hz-i4-${s}`}) RETURNING id`;
  const open = `hz-i4-open-${s}`;
  const closed = `hz-i4-closed-${s}`;
  for (const [id, status] of [[open, 'active'], [closed, 'closed']])
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, ends_at)
      VALUES (${id}, 'X', 'P', 'd', 'https://x.example', 'https://x.example', 'r', 's', ${status}, 'allowed', NULL)`;
  const login = `hz${s}`;
  for (let i = 0; i < 60; i++) {
    await sql()`INSERT INTO projects (program_id, name, installation_id, repo_url) VALUES (${open}, 'R', ${inst}, ${`https://github.com/${login}/r${i}`})`;
    await sql()`
      INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
      VALUES (${`r${i}-${login}`}, ${login}, ${`${login}/r${i}`}, ${inst}, 1, 1, 'live', ${new Date(Date.UTC(2020, 0, 1, 0, i))})`;
  }
  await sql()`INSERT INTO projects (program_id, name, installation_id, repo_url) VALUES (${closed}, 'T', ${inst}, ${`https://github.com/${login}/target`})`;
  await sql()`
    INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status, deployed_at)
    VALUES (${`target-${login}`}, ${login}, ${`${login}/target`}, ${inst}, 1, 1, 'live', '2026-10-01')`;
  const now = new Date();
  for (let run = 0; run < 3; run++) await expireSites(now, { r2: fakeR2().r2 });
  const [t] = await sql()<{ expires_at: Date | null }[]>`SELECT expires_at FROM hosted_sites WHERE slug = ${`target-${login}`}`;
  assert.ok(t.expires_at, 'the ended site got its expiry');
  await sql()`DELETE FROM projects WHERE program_id IN (${open}, ${closed})`;
  await sql()`DELETE FROM programs WHERE id IN (${open}, ${closed})`;
});

test('Minor: no .xml; the scan sees through tags, entities and new phrases; UTF-16 pages are refused; 5 attempts per link', db, async () => {
  assert.equal(STATIC_EXT.has('xml'), false);
  assert.equal(zipProblems([file('index.html'), file('sitemap.xml')]), HOST_LINES.notWebsite);
  const page = (t: string) => abuseFlags([{ path: 'index.html', text: t }]);
  assert.deepEqual(page('Enter your seed&nbsp;phrase'), ['seed-phrase']);
  assert.deepEqual(page('Enter your seed<b></b> phrase'), ['seed-phrase']);
  assert.deepEqual(page('Type the 12-word mnemonic'), ['seed-phrase']);
  assert.deepEqual(page('Paste your secret phrase'), ['seed-phrase']);
  const u = await upload();
  const bom = new Uint8Array([0xff, 0xfe, ...strToU8('<\0h\0t\0m\0l\0')]);
  const out = await deploySite(u.token, zipOf({ 'index.html': bom }), { r2: fakeR2().r2 });
  assert.equal(out.status, 400);
  assert.equal(out.body.show_to_builder, HOST_LINES.notUtf8);
  // Refused attempts don't use the link, but a link takes at most 5 attempts.
  for (let i = 0; i < 4; i++) assert.equal((await deploySite(u.token, zipOf({ 'a.exe': strToU8('x') }), { r2: fakeR2().r2 })).status, 400);
  assert.equal((await deploySite(u.token, site(), { r2: fakeR2().r2 })).status, 410, 'the 6th attempt');
});
