import assert from 'node:assert/strict';
import { claimGet, claimPost, xCallback } from '../claim';
import type { XOAuthDeps } from '../x-oauth';

/**
 * The claim link's page, its form and X's callback, as a browser carries them, with `x` as X
 * (moved from v2121-journey.test.ts, v2.13 F19). Returns the callback's response.
 */
export async function claimThroughX(link: string, x: XOAuthDeps): Promise<Response> {
  const code = link.split('/').pop()!;
  const get = await claimGet(new Request(`https://earnkit.com/claim/${code}`), code);
  assert.equal(get.status, 200);
  const cookie = get.headers.get('set-cookie')!.split(';')[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(await get.text())![1];
  const post = await claimPost(
    new Request(`https://earnkit.com/claim/${code}`, {
      method: 'POST',
      headers: { cookie, origin: 'https://earnkit.com', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf }),
    }),
    code,
    { limit: async () => {} },
  );
  assert.equal(post.status, 303);
  const state = new URL(post.headers.get('location')!).searchParams.get('state')!;
  return xCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${encodeURIComponent(state)}`, { headers: { cookie } }), { x, limit: async () => {} });
}
