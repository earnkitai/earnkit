/**
 * A fetch fake for GitHub sign-in: the token exchange and the user read. `fail` makes one of them
 * answer 401; `calls` lists every request as "METHOD url", so a test can check what was asked.
 */
export type GitHubUser = { id: number; login: string; name: string | null; avatar_url: string | null };

export function githubOAuthFetch(user: GitHubUser, o: { fail?: 'token' | 'user'; token?: string } = {}) {
  const token = o.token ?? 'gho_fake_token';
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    if (method === 'POST' && url === 'https://github.com/login/oauth/access_token') {
      if (o.fail === 'token') return Response.json({ error: 'bad_verification_code' }, { status: 401 });
      return Response.json({ access_token: token, token_type: 'bearer' });
    }
    if (method === 'GET' && url === 'https://api.github.com/user') {
      const auth = new Headers(init?.headers).get('authorization');
      if (o.fail === 'user' || auth !== `Bearer ${token}`) return Response.json({ message: 'Bad credentials' }, { status: 401 });
      return Response.json(user);
    }
    return new Response('not faked', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}
