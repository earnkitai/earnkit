/**
 * v2.9 Part 2 final review I3: preloaded (`--import`) by `pnpm test` and the local e2e scripts, so
 * no test reaches a real outside service whatever the shell exports.
 * - The keys that turn on a real vendor are cleared: tokens.fun launches, Resend mail, R2 writes and
 *   GitHub sign-in, the read-only GitHub App and the contract deployer. A test that needs one on sets its own (fake) value.
 * - `fetch` reaches only this machine (localhost, 127.0.0.1, ::1) and the anvil in BONUS_ANVIL_URL;
 *   anything else throws, so a test that needs another host injects its own fetch or fake.
 * The one opt-in network test (`LINK_CHECK=1`, footer-links.test.ts) keeps the real fetch.
 */
const CLEARED = [
  'TOKENSFUN_DEPLOY_API_KEY',
  'RESEND_API_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  // v2.10 item 7b: the read-only GitHub App (a test that needs it on sets a generated key).
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_PRIVATE_KEY',
  // v2.10 item 13: EarnKit's contract deployer (a test that needs it on sets an anvil dev key).
  'DEPLOYER_PRIVATE_KEY',
];
for (const name of CLEARED) delete process.env[name];

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
for (const url of [process.env.BONUS_ANVIL_URL]) {
  try {
    if (url) LOCAL.add(new URL(url).hostname);
  } catch {
    // Not a URL: nothing to allow.
  }
}

/** The host a fetch call is for. */
function hostOf(input: RequestInfo | URL): string {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  return url.hostname;
}

if (process.env.LINK_CHECK !== '1') {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const host = hostOf(input);
    if (!LOCAL.has(host)) return Promise.reject(new Error(`test guard: no network in tests (fetch to ${host}); inject a fake`));
    return real(input, init);
  }) as typeof fetch;
}
