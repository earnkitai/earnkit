import { generateKeyPairSync } from 'node:crypto';
import { appProof } from '../github-app';
import { saveVerification } from '../github-verify';
import { proveByApp, type RepoProof } from '../repo-proof';
import type { FakeGitHub } from './fake-github';

/** The App's env with a generated key (github-app.ts githubAppEnabled needs the PEM and GitHub sign-in). */
export function appEnv(): void {
  process.env.EARNKIT_AUTH_SECRET ??= 'app-install-test-secret';
  process.env.GITHUB_OAUTH_CLIENT_ID = 'gh-cid';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'gh-sec';
  process.env.GITHUB_APP_ID = '5355247';
  process.env.GITHUB_APP_SLUG = 'earnkitai';
  if (!process.env.GITHUB_APP_PRIVATE_KEY?.includes('PRIVATE KEY'))
    process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** github-app.ts appSetup's work after the sign-in hop named `login`: appProof, the verification row, proveByApp. */
export async function installApp(o: { builderId: number; repoKey: string; login: string; gh: FakeGitHub }): Promise<RepoProof | { notProven: 'not_listed' | 'not_yours' }> {
  const key = o.repoKey.toLowerCase();
  const id = o.gh.repos[key].installation!;
  const proof = await appProof({ installationId: id, login: o.login, repoKey: key }, { fetch: o.gh });
  if (!proof.ok) return { notProven: proof.reason };
  await saveVerification(
    { installation_id: o.builderId, project_id: null, repo_key: key, purpose: 'app', wallet: null, symbol: null },
    { login: o.login, created_at: new Date('2020-01-01'), public_repos: 3 }, new Date(), { githubInstallationId: id },
  );
  return proveByApp({ builderId: o.builderId, repoKey: key, githubInstallationId: id }, { fetch: o.gh });
}
