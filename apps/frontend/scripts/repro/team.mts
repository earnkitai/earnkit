// Shared setup for the lane 28 repros: two co-founders (own GitHub logins, own agents) on one seeded repo.
import { agent, builder, link, seedRepo, type Ctx } from './lib.mts';
export async function cofounders(c: Ctx, repoName = 'timer') {
  const key = c.repo(repoName);
  const A = await builder(`${c.tag}-alice`); const Bb = await builder(`${c.tag}-bob`);
  await seedRepo(key, { readme_lead: 'Timer keeps time for teams.', first_commit_at: '2026-03-01T00:00:00Z', authors: [A.login, Bb.login], contributors: [A.login, Bb.login] });
  const AA = await agent(`${c.tag}-alice`, c.ip(1)); await link(AA, A);
  const BA = await agent(`${c.tag}-bob`, c.ip(2)); await link(BA, Bb);
  const proj = { name: 'Timer', description: 'Keeps time for teams', repo_url: `https://github.com/${key}` };
  return { A, Bb, AA, BA, proj, key };
}
export const send = (ag: any, programId: string, proj: any) => import('./lib.mts').then(({ call }) =>
  call(ag, 'track', { program_id: programId, status: 'applied', submitted_by: 'agent', fields_used: ['project_name', 'email'], project: proj }));
