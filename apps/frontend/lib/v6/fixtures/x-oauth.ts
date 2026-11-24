/**
 * A fetch fake for X sign-in (v3.8 E5): the token exchange and the account read. `fail` makes one of them answer 401;
 * `calls` lists every request as "METHOD url", and `bodies` the token request bodies, so a test can check the PKCE
 * verifier and the scopes asked.
 */
export type XAccount = { id: string; username: string; name?: string; profile_image_url?: string; created_at?: string };

export function xOAuthFetch(account: XAccount, o: { fail?: 'token' | 'user'; token?: string } = {}) {
  const token = o.token ?? 'x_fake_access_token';
  const calls: string[] = [];
  const bodies: URLSearchParams[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    if (method === 'POST' && url === 'https://api.x.com/2/oauth2/token') {
      bodies.push(new URLSearchParams(String(init?.body ?? '')));
      if (o.fail === 'token') return Response.json({ error: 'invalid_request' }, { status: 401 });
      return Response.json({ access_token: token, token_type: 'bearer', scope: 'users.read tweet.read', expires_in: 7200 });
    }
    if (method === 'GET' && url.startsWith('https://api.x.com/2/users/me')) {
      const auth = new Headers(init?.headers).get('authorization');
      if (o.fail === 'user' || auth !== `Bearer ${token}`) return Response.json({ title: 'Unauthorized' }, { status: 401 });
      return Response.json({ data: account });
    }
    return new Response('not faked', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls, bodies };
}
