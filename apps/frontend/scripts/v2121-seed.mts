/**
 * v2.12.1 T11, local only: people for the design review's screenshots. Refuses to run unless
 * DATABASE_URL is a local database named v2121_shots (so a test database's leftovers never change
 * the ranks, and nothing real is ever touched).
 *
 *   DATABASE_URL=postgres://postgres@127.0.0.1:55442/v2121_shots?sslmode=disable pnpm exec tsx apps/frontend/scripts/v2121-seed.mts
 *
 * People: the target user (@maya_makes: 3 live apps, none confirmed yet, unranked), traction
 * (@lee_builds: #3 of 40, 140 people on tokens.fun, TipJar confirmed, two agent-only projects, one
 * untracked), a reserved handle with a long name (@terms, served at /b/terms), an empty claimed
 * page (@sam_new), and 38 ranked filler people (24 claimed, so the board shows gaps).
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? '';
const u = URL.canParse(url) ? new URL(url) : null;
if (!u || !['127.0.0.1', 'localhost'].includes(u.hostname) || u.pathname !== '/v2121_shots') {
  console.error('Refusing: DATABASE_URL must be a local database named v2121_shots.');
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

await sql`DELETE FROM builder_projects`;
await sql`DELETE FROM builder_live`;
await sql`DELETE FROM entry_outcomes`;
await sql`DELETE FROM projects WHERE installation_id >= 900000`;
await sql`DELETE FROM installations WHERE id >= 900000`;
await sql`DELETE FROM builder_profiles`;

type Person = { id: number; handle: string | null; name: string | null; score?: number; people?: number; moment?: 'people' | 'rank' };
async function person(p: Person) {
  await sql`INSERT INTO installations (id, token_hash, builder_id) VALUES (${p.id}, ${`shots-${p.id}`}, ${p.id})`;
  await sql`
    INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle, x_name, consent_shown_at, claimed_at, card_moments)
    VALUES (${p.id}, ${p.handle?.toLowerCase().replace(/^_+/, '') ?? `b-${p.id}`}, ${p.handle ? `x${p.id}` : null}, ${p.handle}, ${p.name}, now(), ${p.handle ? new Date() : null},
      ${sql.json((p.moment ? { latest: p.moment } : {}) as never)})`;
  // read_at a year ahead: a page view's refresh (at most once every 10 minutes) never rescores these
  // people from their (empty) sources, which would replace the seeded projects.
  await sql`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
    VALUES (${p.id}, ${p.score ?? 0}, '{}'::jsonb, ${p.score !== undefined}, 1, ${p.people ?? 0}, 'v2', 'v2', now(), now() + interval '1 year')`;
}
type Proj = { key: string; name: string; what?: string; link?: string; kind?: string; confirmed: boolean; tracked?: boolean; people?: number; money?: number; days: number };
async function project(id: number, p: Proj) {
  await sql`
    INSERT INTO builder_projects (builder_id, project_key, name, what, link, kind, confirmed, shipped, tracked, people, money_usd, last_active_at)
    VALUES (${id}, ${p.key}, ${p.name}, ${p.what ?? null}, ${p.link ?? null}, ${p.kind ?? 'app'}, ${p.confirmed}, true, ${p.tracked ?? true}, ${p.people ?? 0}, ${p.money ?? 0}, ${ago(p.days)})`;
}
async function entry(id: number, program: string, key: string, won: boolean) {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id, live_url, submitted_at) VALUES (${program}, ${key}, ${id}, ${key}, ${ago(20)}) RETURNING id`;
  if (won) await sql`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis) VALUES (${row.id}, ${program}, 'r1', 'won', 1000, 'announcement')`;
}

// The target user: three live apps the agent reported, none confirmed yet.
const maya = 900001;
await person({ id: maya, handle: 'maya_makes', name: 'Maya Chen' });
await project(maya, { key: 'https://mealplan-maya.vercel.app', name: 'Recipe planner', what: 'Plans a week of meals from what is already in the fridge', link: 'https://mealplan-maya.vercel.app', confirmed: false, days: 4 });
await project(maya, { key: 'https://budget-buddy.netlify.app', name: 'Budget buddy', what: 'Tracks spending and says it back in plain words', link: 'https://budget-buddy.netlify.app', confirmed: false, days: 21 });
await project(maya, { key: 'https://tipjar-maya.vercel.app', name: 'Tip jar', what: 'A tip page for her cooking videos', link: 'https://tipjar-maya.vercel.app', confirmed: false, days: 45 });

// Traction: #3 of 40.
const lee = 900002;
await person({ id: lee, handle: 'lee_builds', name: 'Lee Okafor', score: 71, people: 2, moment: 'people' });
await project(lee, { key: 'https://tokens.fun', name: 'tokens.fun', what: 'Launch a coin for your project in one tap', link: 'https://tokens.fun', confirmed: true, people: 140, money: 1234, days: 2 });
await project(lee, { key: 'https://tipjar.lee.dev', name: 'TipJar', what: 'Tips for creators, paid in seconds', link: 'https://tipjar.lee.dev', confirmed: true, people: 4, days: 30 });
await project(lee, { key: 'https://recipes.lee.dev', name: 'Recipes', what: 'Saves recipes from any site', link: 'https://recipes.lee.dev', confirmed: false, days: 1 });
await project(lee, { key: 'https://budget.lee.dev', name: 'Budget', confirmed: false, days: 60 });
await project(lee, { key: 'https://old.lee.dev', name: 'Old landing page', link: 'https://old.lee.dev', confirmed: false, tracked: false, days: 200 });
await entry(lee, 'base-builder-grants', 'https://tokens.fun', true);
await entry(lee, 'arc-microgrants', 'https://tipjar.lee.dev', false);

// A reserved handle with a long name: served at /b/terms; its card says its rank.
const terms = 900003;
await person({ id: terms, handle: 'terms', name: 'Bartholomew Alexandrescu-Whitfield', score: 62, people: 1, moment: 'rank' });
await project(terms, { key: 'https://the-extremely-long-named-weekend-project.example.com', name: 'The extremely long named weekend project for neighbourhood plant swaps', what: 'Lets neighbours swap cuttings, seeds and pots without a group chat getting in the way of anything', link: 'https://the-extremely-long-named-weekend-project.example.com/swap', confirmed: true, people: 1280, money: 86, days: 3 });
await project(terms, { key: 'https://notes.example.com', name: 'Notes', confirmed: true, days: 40 });

// An empty claimed page.
await person({ id: 900004, handle: 'sam_new', name: 'Sam' });

// 38 ranked filler people around them (most claimed; every third unclaimed, so the board skips numbers).
const first = ['ana', 'ben', 'cleo', 'dev', 'eli', 'fay', 'gus', 'hana', 'ivo', 'jun', 'kai', 'lia', 'max', 'nia', 'oli', 'pia', 'quin', 'ravi', 'sol', 'tess', 'uma', 'vic', 'wen', 'yara'];
const apps = ['Plant tracker', 'Mood log', 'Gym timer', 'Quiz night', 'Pet feeder', 'Bookshelf', 'Run club', 'Chore chart', 'Trip split', 'Study cards', 'Gift list', 'Habit streaks'];
const scores = [88, 79, 66, 64, 60, 58, 55, 53, 50, 48, 46, 44, 42, 40, 38, 36, 34, 32, 30, 28, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4];
for (const [i, score] of scores.entries()) {
  const id = 900100 + i;
  const claimed = i % 3 !== 2 && i < 34;
  await person({ id, handle: claimed ? `${first[i % first.length]}${i >= first.length ? i : ''}_${['ships', 'makes', 'codes', 'builds'][i % 4]}` : null, name: null, score, people: i % 3 === 0 ? 1 : 0 });
  const used = i % 3 === 0;
  await project(id, { key: `https://app-${id}.example.com`, name: apps[i % apps.length], link: `https://app-${id}.example.com`, confirmed: true, people: used ? Math.max(3, 260 - i * 9) : 0, days: 5 + i });
  if (i % 2) await project(id, { key: `https://two-${id}.example.com`, name: `${apps[(i + 5) % apps.length]} 2`, confirmed: false, days: 9 + i });
}

const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_live WHERE ranked`;
console.log(`Seeded: ${n} ranked people; @maya_makes, @lee_builds, /b/terms, @sam_new.`);
await sql.end();
