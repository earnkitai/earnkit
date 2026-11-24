/**
 * X sign-in on the install path (v3.8 E5, flag `x_signin`): GET /auth/x?s=<install state> (the chooser's X link) checks
 * the state and the browser's nonce cookie and goes to X with PKCE; GET /x/callback (the URI the X app has registered)
 * reads the X account and goes on to the same consent page as GitHub (lib/v6/install-consent.ts). Nothing is written before Connect there. The install
 * state is X's `state` too: it carries the checked authorize request and the nonce, under its own MAC label.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { publicOrigin } from '../v5/oauth';
import { RateLimitError, clientIp, enforce } from '../v5/rate-limit';
import { type PendingInstall, verifyInstallState } from './github-auth';
import { type InstallPage, installCookie, installPage, installSecret, installSignInOn, toConsent } from './install-consent';
import { cookieValue } from './sessions';
import { XAuthError, exchangeXCode, xAuthorizeUrl, xSignInOn } from './x-auth';

const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
type Deps = { now?: Date; x?: typeof fetch };

/** The install state and this browser's nonce when both are good; else the page to show. */
function pendingOf(request: Request, state: string, now: Date): { req: PendingInstall; nonce: string } | InstallPage {
  if (!installSignInOn() || !xSignInOn()) return 'failed';
  const p = verifyInstallState(state, installSecret(), now);
  // Signed but past its 15 minutes (it verifies at the epoch).
  if (!p) return verifyInstallState(state, installSecret(), new Date(0)) ? 'expired' : 'failed';
  const nonce = cookieValue(request.headers.get('cookie'), installCookie());
  return nonce && same(nonce, p.nonce) ? p : 'failed';
}

/** GET /auth/x?s=<install state>: to X's authorize page with the PKCE challenge of this nonce. */
export function xStartGet(request: Request, deps: Deps = {}): Response {
  const s = new URL(request.url).searchParams.get('s') ?? '';
  const p = pendingOf(request, s, deps.now ?? new Date());
  if (typeof p === 'string') return installPage(p);
  return new Response(null, { status: 302, headers: { Location: xAuthorizeUrl(s, p.nonce, installSecret(), publicOrigin(request)), 'Cache-Control': 'no-store' } });
}

/** GET /x/callback: X's Cancel is the denied page; a good code reads the account and goes to the consent page. */
export async function xCallbackGet(request: Request, deps: Deps = {}): Promise<Response> {
  try {
    await enforce('linkGet', clientIp(request.headers), 'Too many sign-ins from this address.');
  } catch (err) {
    if (err instanceof RateLimitError) return installPage('failed');
    throw err;
  }
  const now = deps.now ?? new Date();
  const q = new URL(request.url).searchParams;
  const p = pendingOf(request, q.get('state') ?? '', now);
  if (typeof p === 'string') return installPage(p);
  if (q.get('error') === 'access_denied') return installPage('denied');
  const code = q.get('code');
  if (!code) return installPage('failed');
  try {
    const user = await exchangeXCode(code, p.nonce, installSecret(), publicOrigin(request), process.env, deps.x ?? fetch);
    return toConsent({ req: p.req, who: { by: 'x', user }, nonce: p.nonce, at: now.getTime() }, now);
  } catch (err) {
    if (!(err instanceof XAuthError)) throw err;
    console.warn(`[install] ${err.message}`);
    return installPage('failed');
  }
}
