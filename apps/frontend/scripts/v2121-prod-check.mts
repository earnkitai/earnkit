import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkClaimPage, checkHandoff, checkLeaderboard, checkReply, claimCodeIn, claimFormOf } from '../lib/earnkit/v2121-prod-check';

/**
 * v2.12.1 acceptance runbook (docs/design-docs-and-implementation-plans/v2.12.1-acceptance-runbook.md),
 * the checks the controller runs without an X login. No secrets, no database, no cookies of yours.
 *
 *   pnpm exec tsx apps/frontend/scripts/v2121-prod-check.mts --base https://earnkit.com \
 *     [--flag on|off] [--reply <file>] [--exempt "<name>" ...] [--handoff]
 *
 * Read-only by design: every request is a GET, and the code below refuses any other method. The one
 * exception is opt-in (`--handoff`, flag on, X set): a POST to the claim page's own button with that
 * page's own cookie and csrf, as a browser would. EarnKit stores a 15-minute sign-in state for it
 * (it expires by itself) and answers 303 to x.com; this script never follows that redirect, so
 * nothing reaches X and no page is claimed. It is not a write to anyone's profile or score.
 * Exit code 0 = every check passed, 1 = at least one failed.
 *
 * --flag on (default): /leaderboard is one plain list (200), /claim/<code from the reply> renders,
 * /terms, /b/terms and /admin are themselves, a random name is 404.
 * --flag off: /leaderboard, /claim/x, /x/callback and /lee are all 404 and the reply (if given) must
 * miss all three headings.
 */
const { values } = parseArgs({
  options: {
    base: { type: 'string' }, flag: { type: 'string', default: 'on' }, reply: { type: 'string' },
    exempt: { type: 'string', multiple: true }, handoff: { type: 'boolean', default: false },
  },
});
const base = (values.base ?? '').replace(/\/+$/, '');
const flag = values.flag;
if (!/^https?:\/\//.test(base) || (flag !== 'on' && flag !== 'off')) {
  console.error('Usage: v2121-prod-check.mts --base <https://earnkit.com> [--flag on|off] [--reply <file>] [--exempt <name>]... [--handoff]');
  process.exit(2);
}

let failed = 0;
const report = (name: string, problems: string[]) => {
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'PASS'} ${name}${problems.length ? `: ${problems.join('; ')}` : ''}`);
};

/** The only way out of this script. GET always; POST only to a claim page's own button, and only with --handoff. */
async function request(method: 'GET' | 'POST', path: string, init: { headers?: Record<string, string>; body?: string } = {}) {
  if (method === 'POST' && !(values.handoff && /^\/claim\/[a-z2-7]{12}$/.test(path))) throw new Error(`refused: ${method} ${path}`);
  if (method !== 'GET' && method !== 'POST') throw new Error(`refused: ${method}`);
  const res = await fetch(`${base}${path}`, { method, redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init });
  return { status: res.status, location: res.headers.get('location'), setCookie: res.headers.get('set-cookie'), text: await res.text() };
}
const status = async (path: string) => (await request('GET', path)).status;

const reply = values.reply ? readFileSync(values.reply, 'utf8') : null;
if (reply !== null) {
  const problems = checkReply(reply, values.exempt ?? []);
  // Flag off: the reply must be v2.11, so all three headings are missing and nothing else is checked.
  if (flag === 'off') report('reply is v2.11 (no heading)', problems.some((p) => p.startsWith('missing: Where you stand or Ways to earn right now or How to move up')) ? [] : ['the reply has v2.12.1 headings']);
  else report('reply', problems);
}

if (flag === 'off') {
  for (const p of ['/leaderboard', '/claim/x', '/x/callback', '/lee']) {
    const s = await status(p);
    report(`GET ${p} is 404`, s === 404 ? [] : [`status ${s}`]);
  }
} else {
  const lb = await request('GET', '/leaderboard');
  report('GET /leaderboard', [...(lb.status === 200 ? [] : [`status ${lb.status}`]), ...(lb.status === 200 ? checkLeaderboard(lb.text) : [])]);
  const code = reply === null ? null : claimCodeIn(reply);
  if (reply !== null && !code) report('reply has a claim link', ['no earnkit.com/claim/<code> in the reply']);
  if (code) {
    const page = await request('GET', `/claim/${code}`);
    report(`GET /claim/${code}`, page.status === 200 ? checkClaimPage(page.text) : [`status ${page.status}`]);
    if (values.handoff && page.status === 200) {
      const form = claimFormOf(page.text, page.setCookie);
      if (!form) report('claim button handoff', ['no csrf field or cookie on the page']);
      else {
        const res = await request('POST', `/claim/${code}`, {
          headers: { Origin: new URL(base).origin, Cookie: form.cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ csrf: form.csrf }).toString(),
        });
        report('claim button hands off to X (not followed)', checkHandoff(res.status, res.location, base));
      }
    }
  }
  const terms = await request('GET', '/terms');
  report('GET /terms', terms.status === 200 ? [] : [`status ${terms.status}`]);
  const bTerms = await status('/b/terms');
  report('GET /b/terms is itself (page or 404, never a redirect)', bTerms === 200 || bTerms === 404 ? [] : [`status ${bTerms}`]);
  const admin = await status('/admin');
  report('GET /admin is not a profile', [401, 403, 404].includes(admin) ? [] : [`status ${admin}`]);
}
const random = Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
const rs = await status(`/${random}`);
report(`GET /${random} is 404`, rs === 404 ? [] : [`status ${rs}`]);
console.log(failed ? `${failed} check(s) failed. Turn the flag off (runbook G).` : 'All checks passed.');
process.exit(failed ? 1 : 0);
