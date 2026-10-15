import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseStep, newsOpener, pageReadyLine, paymentFits, standingNews, whereYouStand, type StandProject, type StandView } from './where-you-stand';

const p = (o: Partial<StandProject> & { key: string; name: string }): StandProject => ({
  what: null, shipped: true, people: 0, has_coin: false, sends_tx: false, tagged: false, untracked_contract: null, untracked_people: 0, certain: false, app: true, ...o,
});
const base: Omit<StandView, 'step' | 'news'> = {
  standing: { ranked: true, rank: 31, total: 40 }, claimed: false, handle: null, claimLink: 'earnkit.com/claim/abcdefghijkl',
  projects: [p({ key: 'a', name: 'Recipes', what: 'a recipe planner' }), p({ key: 'b', name: 'Budget', what: 'a budget tracker' }), p({ key: 'lee/tipjar', name: 'TipJar', what: 'a tip jar', sends_tx: true })],
  earn: [{ program_id: 'avalanche-team1-mini-grants', project: 'lee/tipjar', title: 'Avalanche Team1 mini grants', prize: 'up to $10K', when: 'open all year' }],
  fresh: null,
};

// Spec example 1 reads "#31 of 40"; the T2 ruling (rank.ts) shows a rank under 50 ranked only in the
// top half, so the golden text is checked byte for byte at #20 of 40, and at #31 without the rank.
const EXAMPLE_1 = (rank: string) => `Where you stand
You've shipped 3 apps with AI: a recipe planner, a budget tracker and a tip jar.${rank}
Claim your page with X: earnkit.com/claim/abcdefghijkl

Ways to earn right now
Your tip jar fits Avalanche Team1 mini grants: up to $10K, open all year. I can prepare the entry.

How to move up
Your tip jar has a payment side people could use. Want me to make it count the people who pay you? You won't have to do anything.`;

test('8.1 the typical target user (spec example 1)', () => {
  const step = chooseStep(base, { coin: () => false, build: null });
  assert.equal(whereYouStand({ ...base, standing: { ranked: true, rank: 20, total: 40 }, step, news: null }), EXAMPLE_1(" You're #20 of 40 builders on EarnKit."));
  assert.equal(whereYouStand({ ...base, step, news: null }), EXAMPLE_1(''));
});
test('8.2 someone with traction leads with the rank (spec example 2)', () => {
  const v = {
    ...base, standing: { ranked: true, rank: 3, total: 40 }, earn: [],
    projects: [
      p({ key: 'tf', name: 'tokens.fun', people: 12, untracked_contract: 'base:0x' + 'a'.repeat(40), untracked_people: 140, certain: true, app: false }), // not every one is an app: "projects"
      p({ key: 'x', name: 'X2', people: 3 }), ...['c', 'd', 'e', 'f'].map((k) => p({ key: k, name: k })),
    ],
  };
  const out = whereYouStand({ ...v, step: chooseStep(v, { coin: () => false, build: null }), news: null });
  assert.ok(out.startsWith(`Where you stand
You're #3 of 40 builders on EarnKit. You've shipped 6 projects, and 2 of them have people using them.
Claim your page with X: earnkit.com/claim/abcdefghijkl`));
  assert.ok(out.endsWith(`How to move up
tokens.fun has people using it who aren't counted yet. Want me to count them? Your rank goes up today.`));
});

test('8.3 nothing found (spec example 3): no claim link, the build offer, send a link', () => {
  const v = { ...base, standing: { ranked: false, rank: 0, total: 40 }, projects: [], earn: [], fresh: { title: 'Arc Microgrants', prize: '500 USDC' } };
  assert.equal(whereYouStand({ ...v, step: chooseStep(v, { coin: () => false, build: null }), news: null }),
`Where you stand
I couldn't find anything you've made yet.

Ways to earn right now
Arc Microgrants pays 500 USDC for a small app, and I can build one with you in about an hour.

How to move up
Send me a link to something you've made and I'll add it.`);
});

test('8.4 no rank line when it does not read well; claimed people see their page', () => {
  const v = { ...base, standing: { ranked: true, rank: 150, total: 200 }, claimed: true, handle: 'Lee', claimLink: null };
  const out = whereYouStand({ ...v, step: null, news: null });
  assert.ok(!/#150|top/.test(out));
  assert.match(out, /^Your page: earnkit\.com\/Lee$/m);
  // Under 50 ranked, only the top half reads well (rank.ts).
  const low = whereYouStand({ ...base, standing: { ranked: true, rank: 25, total: 40 }, step: null, news: null });
  assert.doesNotMatch(low, /#25/);
  const top = whereYouStand({ ...base, standing: { ranked: true, rank: 12, total: 120 }, step: null, news: null });
  assert.match(top, /You're in the top 10% of people building with AI\./);
});

test('8.5 the step: count past users, then tag future users, then a coin, then a payment side, then a link', () => {
  const opts = { coin: (k: string) => k === 'busy', build: null };
  const only = (ps: StandProject[]) => chooseStep({ ...base, projects: ps }, opts)?.kind;
  assert.equal(only([p({ key: 'k', name: 'K', untracked_contract: 'base:0x' + '1'.repeat(40), untracked_people: 3, sends_tx: true })]), 'count_past');
  assert.equal(only([p({ key: 'k', name: 'K', sends_tx: true })]), 'tag_future');
  assert.equal(only([p({ key: 'busy', name: 'Busy', people: 9, tagged: true, sends_tx: true })]), 'coin');
  assert.equal(only([p({ key: 'w', name: 'Shop', what: 'a coffee shop site' })]), 'payment');
  assert.equal(only([p({ key: 'w', name: 'Notes', what: 'a notes app' })]), undefined);
  assert.equal(paymentFits('a tip jar'), true);
  assert.equal(paymentFits('a notes app'), false);
});

test('8.6 an uncertain count of past users promises no rank change', () => {
  const v = { ...base, projects: [p({ key: 'k', name: 'K', untracked_contract: 'base:0x' + '1'.repeat(40), untracked_people: 3, certain: false })] };
  assert.equal(chooseStep(v, { coin: () => false, build: null })!.line, "K has people using it who aren't counted yet. Want me to count them? I'll send you a link to show it's yours.");
});

test('8.8 projects the agent named but none live: the reply names them, never "couldn\'t find anything"', () => {
  const v = { ...base, standing: { ranked: false, rank: 0, total: 40 }, earn: [], fresh: null,
    projects: base.projects.map((x) => ({ ...x, shipped: false })) };
  const out = whereYouStand({ ...v, step: chooseStep(v, { coin: () => false, build: null }), news: null });
  assert.ok(out.startsWith(`Where you stand
You've made 3 apps with AI: a recipe planner, a budget tracker and a tip jar. None is live yet.`));
  assert.ok(out.endsWith("Send me a link to something you've made and I'll add it."));
});

test('8.8b (ruling S15) none live and EarnKit can host one: the one yes puts it online', () => {
  const v = { ...base, standing: { ranked: false, rank: 0, total: 40 }, earn: [], fresh: null,
    projects: base.projects.map((x) => ({ ...x, shipped: false })) };
  const step = chooseStep(v, { coin: () => false, build: null, host: (k) => k === 'b' })!;
  assert.deepEqual(step, { kind: 'go_live', project_key: 'b', line: "Want me to put your budget tracker online? It takes a few minutes and you won't have to do anything." });
  const one = { ...v, projects: [p({ key: 'r', name: 'Recipes', shipped: false })] };
  assert.match(whereYouStand({ ...one, step: chooseStep(one, { coin: () => false, build: null }), news: null }), /^You've made 1 app with AI: Recipes\. It isn't live yet\.$/m);
});

test('v2.12.2 only code on GitHub: "on GitHub" by name (at most 3 named), and the one yes puts one online after any app', () => {
  const code = (key: string, name: string, what: string | null = null) => p({ key, name, what, shipped: false, app: false, code: true });
  const v = { ...base, standing: { ranked: false, rank: 0, total: 40 }, earn: [], fresh: null, claimLink: null,
    projects: [code('o/hello-world', 'Hello-World', 'My first repository on GitHub!'), code('o/spoon-knife', 'Spoon-Knife'), code('o/linguist', 'linguist')] };
  const step = chooseStep(v, { coin: () => false, build: null, host: () => true })!;
  assert.deepEqual(step, { kind: 'go_live', project_key: 'o/hello-world', line: "Want me to put Hello-World online? It takes a few minutes and you won't have to do anything." });
  assert.equal(whereYouStand({ ...v, step, news: null }), `Where you stand
You've made 3 projects on GitHub: Hello-World, Spoon-Knife and linguist. None is live yet.

How to move up
Want me to put Hello-World online? It takes a few minutes and you won't have to do anything.`);
  const many = { ...v, projects: [...v.projects, code('o/x', 'x')] };
  assert.match(whereYouStand({ ...many, step: null, news: null }), /^You've made 4 projects on GitHub\. None is live yet\.$/m);
  // An app the agent named comes first; without hosting the link ask stays.
  const mixed = { ...v, projects: [...v.projects, p({ key: 'r', name: 'Recipes', shipped: false })] };
  assert.equal(chooseStep(mixed, { coin: () => false, build: null, host: () => true })!.project_key, 'r');
  assert.match(whereYouStand({ ...mixed, step: null, news: null }), /^You've made 4 projects with AI\. None is live yet\.$/m);
  assert.equal(chooseStep(v, { coin: () => false, build: null })!.kind, 'send_link');
});

test('8.9 a project that sends payments gets the payment line; any other the plain one', () => {
  const v = { ...base, projects: [p({ key: 'g', name: 'Game', what: 'a puzzle game', sends_tx: true })] };
  assert.equal(chooseStep(v, { coin: () => false, build: null })!.line, "Want me to make your puzzle game count the people who use it? You won't have to do anything.");
});

test('8.10 (T7 carry) a claimed person with work not confirmed yet: the step offers the link again, in plain words', () => {
  const v = { ...base, claimed: true, handle: 'lee', claimLink: null, projects: base.projects.map((x) => ({ ...x, confirmed: false })) };
  const step = chooseStep(v, { coin: () => false, build: null })!;
  assert.equal(step.kind, 'confirm');
  assert.equal(step.line, "3 of your apps aren't confirmed as yours yet, so they don't count. Want a link to show they're yours? It takes one tap.");
  const one = { ...v, projects: [p({ key: 't', name: 'TipJar', what: 'a tip jar', confirmed: false })] };
  assert.equal(chooseStep(one, { coin: () => false, build: null })!.line, "Your tip jar isn't confirmed as yours yet, so it doesn't count. Want a link to show it's yours? It takes one tap.");
  // Unclaimed: the claim link is the step (the upgrade pages need a page), so no confirm step.
  assert.notEqual(chooseStep({ ...one, claimed: false }, { coin: () => false, build: null })?.kind, 'confirm');
});

test('8.7 news only when something real happened; the card is asked only when nothing else is', () => {
  const now = { standing: { ranked: true, rank: 3, total: 40 }, projects: [{ key: 'tf', name: 'tokens.fun', people: 52 }] };
  const at = new Date('2026-10-14T00:00:00Z');
  assert.equal(standingNews({ rank: 3, people: { tf: 52 }, at: '2026-10-13T00:00:00Z' }, now, at, true), null);
  assert.deepEqual(standingNews({ rank: 5, people: { tf: 40 }, at: '2026-10-10T00:00:00Z' }, now, at, true),
    { line: '12 new people used tokens.fun this week, and you moved up to #3. Want a card to share it?', card: 'people' });
  assert.equal(standingNews({ rank: 5, people: { tf: 40 }, at: '2026-10-10T00:00:00Z' }, now, at, false)!.line,
    '12 new people used tokens.fun this week, and you moved up to #3.');
  // A move into the top N%: "AI" keeps its capitals.
  const many = { standing: { ranked: true, rank: 12, total: 120 }, projects: [] };
  assert.deepEqual(standingNews({ rank: 40, at: '2026-09-01T00:00:00Z' }, many, at, true),
    { line: "You're now in the top 10% of people building with AI. Want a card to share it?", card: 'rank' });
  // Never seen before (no rank yet): a first rank is not a move up.
  assert.equal(standingNews({}, many, at, true), null);
});

test('8.11 the news opener: alert items, then news sentences; never a period after a link', () => {
  assert.equal(newsOpener([], []), null);
  assert.equal(newsOpener(['you won $500 in Arc Microgrants'], ['12 new people used tokens.fun this week.']),
    'Since you last checked: you won $500 in Arc Microgrants. 12 new people used tokens.fun this week.');
  assert.equal(newsOpener([], [pageReadyLine('earnkit.com/claim/abcdefghijkl')]),
    'Since you last checked: Your EarnKit page is ready. Claim it with X: earnkit.com/claim/abcdefghijkl');
});

test('8.12b one shipped app with people reads "and people are using it"; a GitHub sentence or jargon is never used as the few words', async () => {
  const v = { ...base, standing: { ranked: false, rank: 0, total: 40 }, earn: [], projects: [p({ key: 'n', name: 'Notes', people: 4 })] };
  assert.match(whereYouStand({ ...v, step: null, news: null }), /^You've shipped 1 app, and people are using it\.$/m);
  const { plainWhat } = await import('./where-you-stand');
  assert.equal(plainWhat('A recipe planner.'), 'a recipe planner');
  assert.equal(plainWhat('A Next.js app for recipes'), null);
  assert.equal(plainWhat('Smart contract for tips'), null);
  assert.equal(plainWhat('plans recipes'), null);
  assert.equal(plainWhat('AI notes for my class'), null);
});

test('8.22 (fix round 1) the money statements: a project that could win once people use it, an open-all-year program', async () => {
  const { usersMoneyLine, rollingLine, buildStepLine } = await import('./where-you-stand');
  assert.equal(usersMoneyLine(p({ key: 'r', name: 'Recipes', what: 'a recipe planner' }), 'lee/recipes', 'Base Builder Grants', 'up to $5K'),
    'Your recipe planner could win up to $5K from Base Builder Grants once people use it.');
  assert.equal(usersMoneyLine(null, 'lee/recipes', 'T', 'up to $5K'), 'recipes could win up to $5K from T once people use it.');
  assert.equal(rollingLine('Avalanche Team1 Mini Grants', 'up to $10K', true), "You could win up to $10K from Avalanche Team1 Mini Grants; it's open all year. I can prepare an entry with one of your projects.");
  assert.equal(rollingLine('A', 'up to $10K', false), "You could win up to $10K from A; it's open all year.");
  assert.equal(buildStepLine('Arc Microgrants', '500 USDC', false), 'Arc Microgrants pays 500 USDC for a small app. I can build it with you in about an hour. Want me to start?');
  const v = { ...base, earn: [], money: "You could win up to $10K from A; it's open all year." };
  assert.match(whereYouStand({ ...v, step: null, news: null }), /\n\nWays to earn right now\nYou could win up to \$10K from A; it's open all year\.$/);
});

test('8.25 (ruling) the open-all-year fallback: Easy first, then fewer things to fill in, then the bigger prize', async () => {
  const { byLazy, moneyFallback } = await import('./stand-view');
  const now = new Date('2026-10-14T00:00:00Z');
  const card = (id: string, level: 'Easy' | 'Medium' | null, fields: number, usd: number) => ({
    id, title: id, summary: `Up to $${usd} · rolling`, tag: null, each_time: [], builder_fields: fields, max_award_usd: usd, ends_at: null,
    difficulty: level ? { level, estimate: '1 hour' } : null, status: 'active', starts_at: null,
  }) as never;
  const cards = [card('Big', 'Medium', 0, 100000), card('EasyMany', 'Easy', 4, 10000), card('EasyFew', 'Easy', 1, 500), card('NoLevel', null, 0, 50000)];
  assert.deepEqual([...cards].sort(byLazy).map((c: { id: string }) => c.id), ['EasyFew', 'EasyMany', 'Big', 'NoLevel'], 'no level sorts as Medium, then the bigger prize');
  const tie = [card('Small', 'Easy', 1, 500), card('Bigger', 'Easy', 1, 5000)];
  assert.deepEqual([...tie].sort(byLazy).map((c: { id: string }) => c.id), ['Bigger', 'Small']);
  const m = moneyFallback({ cards, entered: new Set(), hidden: new Set(), now, projects: [] });
  assert.equal(m.money, "You could win up to $500 from EasyFew; it's open all year.");
});

test('8.26 (fix round 2) a build is the step only when nothing else asks: with a pending join it is a statement, one question in all', async () => {
  const { placeBuild, buildStepLine } = await import('./where-you-stand');
  const pick = { title: 'Arc Microgrants', prize: '500 USDC', canBuild: true };
  const join = 'Another agent signed in as your GitHub. Add it to your page?';
  const v = { ...base, projects: [], earn: [], standing: { ranked: false, rank: 0, total: 40 } };
  const held = placeBuild(pick, null, true);
  assert.equal(held.step, null);
  assert.deepEqual(held.fresh, { title: 'Arc Microgrants', prize: '500 USDC' });
  const reply = [whereYouStand({ ...v, ...held, news: null }), join].join('\n\n');
  assert.equal((reply.match(/\?/g) ?? []).length, 1, reply);
  assert.match(reply, /Arc Microgrants pays 500 USDC for a small app, and I can build one with you in about an hour\./);
  // Nothing else asks: the build is the step.
  assert.equal(placeBuild(pick, null, false).step?.line, buildStepLine('Arc Microgrants', '500 USDC', true));
  // A step of their own wins; the build is the statement.
  const own = { kind: 'send_link' as const, project_key: null, line: 'x' };
  assert.deepEqual(placeBuild(pick, own, false), { step: own, fresh: { title: 'Arc Microgrants', prize: '500 USDC' } });
});

test('8.27 (fix round 2) no fresh build past a repo read error or an unseen repo (Review M1); the entry offer only with a shipped project that can enter', async () => {
  const { moneyFallback } = await import('./stand-view');
  const now = new Date('2026-10-14T00:00:00Z');
  const fresh = { deployOn: () => true, hostOn: true, canBuild: true };
  const none = moneyFallback({ cards: [], entered: new Set(), hidden: new Set(), now, projects: [], fresh, repoTrouble: true });
  assert.deepEqual(none, { money: null, pick: null });
  const rolling = (tag: string | null) => ({ id: 'r', title: 'R', summary: 'Up to $900 · rolling', tag, each_time: [], max_award_usd: 900, ends_at: null, status: 'active', starts_at: null }) as never;
  const shipped = [p({ key: 'a', name: 'A' })];
  assert.match(moneyFallback({ cards: [rolling(null)], entered: new Set(), hidden: new Set(), now, projects: shipped }).money!, /I can prepare an entry/);
  assert.doesNotMatch(moneyFallback({ cards: [rolling('needs a live product')], entered: new Set(), hidden: new Set(), now, projects: shipped }).money!, /prepare/);
  assert.doesNotMatch(moneyFallback({ cards: [rolling(null)], entered: new Set(), hidden: new Set(), now, projects: [p({ key: 'a', name: 'A', shipped: false })] }).money!, /prepare/);
});

test('9.17 (T9 fix round 1) a step is offered only when its yes can deliver; "today" only when the count goes public at once', () => {
  const o = { coin: () => false, build: null };
  const kind = (ps: StandProject[], can?: StandView['can']) => chooseStep({ ...base, projects: ps, ...(can && { can }) }, o)?.kind ?? null;
  const past = p({ key: 'tf', name: 'tokens.fun', untracked_contract: 'base:0x1', untracked_people: 1, app: false });
  assert.equal(kind([past]), 'count_past');
  assert.equal(kind([past], { prove: false }), null, 'no link can be made and it is not provable: no step');
  assert.equal(kind([{ ...past, provable: true }], { prove: false }), 'count_past', 'provable: counted on the yes, no link needed');
  const line = (x: StandProject) => chooseStep({ ...base, projects: [x] }, o)!.line;
  assert.ok(line({ ...past, certain: true, provable: true }).endsWith('Want me to count them? Your rank goes up today.'));
  assert.ok(line({ ...past, provable: true }).endsWith('Want me to count them?'), 'held for review: no promise');
  assert.ok(line(past).endsWith("I'll send you a link to show it's yours."));
  const tag = p({ key: 'g', name: 'Game', what: 'a puzzle game', sends_tx: true });
  assert.equal(kind([tag]), 'tag_future');
  assert.equal(kind([tag], { tag: false }), null, 'no person code: no attribution line');
  assert.equal(kind([{ ...tag, tracked_tx: false }], { prove: false }), null, 'untracked and no link: no step');
  const shop = p({ key: 's', name: 'Shop', what: 'a coffee shop site' });
  assert.equal(kind([shop]), 'payment');
  assert.equal(kind([shop], { tips: false }), null, 'no tip jar can be deployed: no step');
});
