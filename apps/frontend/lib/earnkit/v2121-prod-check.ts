import { bannedIn } from './fixtures/banned-words';
import { HEADS } from './where-you-stand';

/**
 * v2.12.1 acceptance runbook, pure checks (scripts/v2121-prod-check.mts runs them against production,
 * the runbook's section D and E say when). No network, no database, no secrets.
 */

const ORDER = [HEADS.stand, HEADS.earn, HEADS.up];

/** A v2.12 reply's leftovers: its "You:" line, its score words, its /b/<slug> page link. */
const V212_LINE = [/^You: /m, /\bscore\b/i, /earnkit\.com\/b\/[a-z0-9-]+/i];
/** A link followed straight by a period: the dot becomes part of the link in many chat apps. */
const GLUED = /(?:https?:\/\/|earnkit\.com\/)\S*\.(?=\s|$)/m;

/**
 * Problems in one `find` reply, in a fixed order (empty = passes): a missing or misordered heading,
 * more than one question, a banned word (`exempt` = the builder's project names and program titles),
 * a v2.12 line, a period glued to a link.
 */
export function checkReply(text: string, exempt: string[]): string[] {
  const problems: string[] = [];
  const lines = text.split('\n').map((l) => l.trim());
  const at = ORDER.map((h) => lines.indexOf(h));
  const missing = ORDER.filter((_, i) => at[i] < 0);
  if (missing.length) problems.push(`missing: ${missing.join(' or ')}`);
  else if (at[0] > at[1] || at[1] > at[2]) problems.push('headings out of order');
  const prose = text.replace(/\bhttps?:\/\/\S+|\bearnkit\.com\/\S+/g, ' ');
  if ((prose.match(/\?/g) ?? []).length > 1) problems.push('more than one question');
  for (const b of bannedIn(text, exempt)) problems.push(`banned word ${b}`);
  if (V212_LINE.some((r) => r.test(text))) problems.push('v2.12 line');
  if (GLUED.test(text)) problems.push('period glued to a link');
  return problems;
}

/** The claim code in a reply (earnkit.com/claim/<12 characters>), or null. */
export function claimCodeIn(text: string): string | null {
  return /earnkit\.com\/claim\/([a-z2-7]{12})(?![a-z0-9])/.exec(text)?.[1] ?? null;
}

/** The page's own csrf field and the cookie it set (`name=value`), or null when either is missing. */
export function claimFormOf(html: string, setCookie: string | null): { csrf: string; cookie: string } | null {
  const csrf = /<input type="hidden" name="csrf" value="([A-Za-z0-9_-]{43})"/.exec(html)?.[1];
  const cookie = /^(__Host-ekx-[a-f0-9]{16}=[A-Za-z0-9_-]{43})/.exec(setCookie ?? '')?.[1];
  return csrf && cookie ? { csrf, cookie } : null;
}

/** Problems with the claim page's HTML (what is public, how to hide it, one button). */
export function checkClaimPage(html: string): string[] {
  const p: string[] = [];
  if (!html.includes('Claim your EarnKit page')) p.push('claim page: no lead');
  if (!html.includes('hide my page')) p.push('claim page: does not say how to hide');
  if (!html.includes('Continue with X')) p.push('claim page: no button');
  return p;
}

/** Problems with the Location the claim button's POST answers (it must go to X with PKCE and our callback). Never followed. */
export function checkHandoff(status: number, location: string | null, base: string): string[] {
  if (status !== 303) return [`handoff: status ${status}, not 303`];
  let u: URL;
  try {
    u = new URL(location ?? '');
  } catch {
    return ['handoff: no Location'];
  }
  const p: string[] = [];
  if (u.origin + u.pathname !== 'https://x.com/i/oauth2/authorize') p.push(`handoff: goes to ${u.origin}${u.pathname}`);
  if (u.searchParams.get('code_challenge_method') !== 'S256') p.push('handoff: no S256 challenge');
  if (!u.searchParams.get('code_challenge')) p.push('handoff: no code_challenge');
  if (u.searchParams.get('redirect_uri') !== `${base}/x/callback`) p.push(`handoff: redirect_uri ${u.searchParams.get('redirect_uri')}`);
  if (u.searchParams.get('response_type') !== 'code') p.push('handoff: response_type is not code');
  if (!u.searchParams.get('state')) p.push('handoff: no state');
  return p;
}

/** The leaderboard is one list: no form, select, tab, filter or page links. */
export function checkLeaderboard(html: string): string[] {
  return /<form\b|<select\b|role="tab"|role="tablist"|[?&](chain|tool|filter|tab|page)=/i.test(html) ? ['leaderboard: filter markup'] : [];
}
