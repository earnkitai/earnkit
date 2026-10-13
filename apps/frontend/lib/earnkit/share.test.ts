import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { CARD_OFFER_NOTE, cardModel, cardOffer, cardYes, findOfferLine, intentUrl, offerCard, xAsk } from './share';
import { fullProfile } from './fixtures/profile';
import { ensureProfile } from './profiles';
import { findSecondLine, tools } from './tools';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('11.1 the card: ring score, "Top N% of builders", the top outcome in words, the handle; never a chain first', () => {
  assert.deepEqual(cardModel(fullProfile), { score: 41, top: 'Top 22% of builders', outcome: '1,100 people used tipjar', handle: '@lee_builds' });
});

test('11.2 the offer and the X ask, one question each, no em dash', () => {
  assert.equal(cardOffer(12), "You're top 12%. Want your card to post on X?");
  assert.equal(xAsk('lee_builds'), 'Use @lee_builds?');
  assert.equal(xAsk(null), 'Add your X handle to your GitHub profile, then say done.');
  for (const s of [cardOffer(12), xAsk('a'), xAsk(null), CARD_OFFER_NOTE]) assert.doesNotMatch(s, /—/);
});

test('final T15 ruling: the card and the X text say "Top N%" only for N <= 50; above it the score alone', () => {
  assert.equal(cardModel({ ...fullProfile, top_percent: 50 }).top, 'Top 50% of builders');
  const low = cardModel({ ...fullProfile, top_percent: null });
  assert.equal(low.top, null);
  const u = new URL(intentUrl('lee_builds', low));
  assert.equal(u.searchParams.get('text'), 'Builder score 41 on EarnKit. 1,100 people used tipjar.');
  assert.doesNotMatch(u.searchParams.get('text')!, /Top|null/);
});

test('final T11: the card route draws the outcome at 44px and the footer at 30px; no name line or "Top" line when absent', () => {
  const src = readFileSync(join(import.meta.dirname, '../../app/b/[slug]/card.png/route.tsx'), 'utf8');
  assert.match(src, /fontSize: 44, color: '#E5EEFC'[^}]*\}\}>\{m\.outcome\}/);
  assert.match(src, /justifyContent: 'space-between', fontSize: 30, color: SOFT/);
  assert.match(src, /\{m\.handle \? </);
  assert.match(src, /\{m\.top \? </);
});

test('11.3 the intent link carries the profile URL and no wallet; EarnKit never posts', () => {
  const u = new URL(intentUrl('lee_builds', cardModel(fullProfile)));
  assert.equal(u.origin + u.pathname, 'https://x.com/intent/post');
  assert.equal(u.searchParams.get('url'), 'https://earnkit.com/b/lee_builds');
  assert.match(u.searchParams.get('text')!, /^Top 22% of builders on EarnKit\./);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['text', 'url']);
});

test('11.4 the offer is made once, only with a public score, and waits when line 1 already asks', dbTest, async () => {
  // A fresh key per run (builder_scores is append-only), above every other v2.12 test's range.
  const id = 2_140_000_000 + Math.floor(Math.random() * 7_000_000);
  await ensureProfile(id, new Date());
  assert.equal(await offerCard(id, false), null, 'no score yet');
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, '2026-10-12', 41, 88, '{}', '{}', 'v1', 'v1-launch', false)`;
  assert.equal(await offerCard(id, true), null, 'line 1 asks: wait');
  // The percentile comes from builder_ranks once any run's percentiles() ranks this person, so
  // only the shape is pinned here; 11.2 pins the exact words.
  assert.match((await offerCard(id, false)) ?? '', /^You're top \d+%\. Want your card to post on X\?$/);
  assert.equal(await offerCard(id, false), null, 'once');
});

test('final T15 ruling: no card offer above the top 50% (and it is not used up, so it can come later)', dbTest, async () => {
  const id = 2_140_000_000 + Math.floor(Math.random() * 7_000_000);
  await ensureProfile(id, new Date());
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, '2026-10-12', 3, 30, '{}', '{}', 'v1', 'v1-launch', false)`;
  await sql()`INSERT INTO builder_ranks (builder_id, score, percentile, computed_at) VALUES (${id}, 3, 30, now())
    ON CONFLICT (builder_id) DO UPDATE SET percentile = 30`;
  assert.equal(await offerCard(id, false), null);
  const [p] = await sql()<{ at: Date | null }[]>`SELECT card_offered_at AS at FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.at, null);
  await sql()`DELETE FROM builder_ranks WHERE builder_id = ${id}`;
});

test('11.6 the outcome in plain words: one person, money only, an unnamed project, nothing measured; never a wallet', () => {
  const one = { ...fullProfile, projects: [{ ...fullProfile.projects[0], numbers: ['1 user'] }] };
  assert.equal(cardModel(one).outcome, '1 person used tipjar');
  const money = { ...fullProfile, projects: [{ ...fullProfile.projects[0], numbers: ['$3.1k'] }] };
  assert.equal(cardModel(money).outcome, '$3.1k through tipjar');
  const unnamed = { ...fullProfile, projects: [{ ...fullProfile.projects[0], title: 'Private project', numbers: ['40 users'] }] };
  assert.equal(cardModel(unnamed).outcome, '40 people used a private project');
  const oss = { ...fullProfile, projects: [{ ...fullProfile.projects[0], title: 'Open source', numbers: ['12 users'] }] };
  assert.equal(cardModel(oss).outcome, '12 people used their open source work');
  // Final review: the plain "Builder" fallback is never on the card (no name line).
  const none = { ...fullProfile, name: 'Builder', projects: [] };
  assert.deepEqual(cardModel(none), { score: 41, top: 'Top 22% of builders', outcome: 'Verified builder', handle: null });
  assert.equal(findOfferLine('You: score 41, top 22%. earnkit.com/b/lee'), 'You: score 41, top 22%. earnkit.com/b/lee. Want your card to post on X?');
});

const PARTS = () => sql().json({ users: { points: 10, raw: { U: 40 } }, money: { points: 0, raw: {} }, staying: { points: 0, raw: {} }, recency: { points: 0, raw: {} }, consistency: { points: 0, raw: {} } });

async function scored(prefill: { login?: string; twitter?: string; x?: string } = {}) {
  const id = 2_140_000_000 + Math.floor(Math.random() * 7_000_000);
  await ensureProfile(id, new Date());
  await sql()`UPDATE builder_profiles SET slug = ${`card${id}`}, github_login = ${prefill.login ? `${prefill.login}${id}` : null}, twitter_prefill = ${prefill.twitter ? `${prefill.twitter}${id}`.slice(-15) : null},
    x_handle = ${prefill.x ? `${prefill.x}${id}`.slice(-15) : null} WHERE builder_id = ${id}`;
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, '2026-10-12', 41, 78, ${PARTS()}, '{}', 'v1', 'v1-launch', false)`;
  return id;
}

test('11.7 a yes to the offer: X set gives the share link; a GitHub prefill asks "Use @name?" once; no prefill asks to add it; no login shares as is', dbTest, async () => {
  const withX = await scored({ login: 'lee', twitter: 'lee_builds', x: 'lee_builds' });
  assert.deepEqual(await cardYes(withX), { show_to_builder: `Post it: https://earnkit.com/b/card${withX}/share` });

  const prefilled = await scored({ login: 'lee2', twitter: 'lee_two' });
  const ask = await cardYes(prefilled);
  assert.equal(ask.show_to_builder, `Use @${`lee_two${prefilled}`.slice(-15)}?`);
  assert.match(ask.agent_note ?? '', /x_handle/);
  const [{ x_asked_at }] = await sql()<{ x_asked_at: Date | null }[]>`SELECT x_asked_at FROM builder_profiles WHERE builder_id = ${prefilled}`;
  assert.ok(x_asked_at);
  // Final review M4: asked once; the next yes shares the card as it is (never "Use @name?" again).
  assert.equal((await cardYes(prefilled)).show_to_builder, `Post it: https://earnkit.com/b/card${prefilled}/share`);

  const bare = await scored({ login: 'lee3' });
  assert.equal((await cardYes(bare)).show_to_builder, 'Add your X handle to your GitHub profile, then say done.');
  // Asked once: the next yes (still no prefill) shares the card as it is.
  assert.equal((await cardYes(bare)).show_to_builder, `Post it: https://earnkit.com/b/card${bare}/share`);

  // Without a proven login a handle could never be shown: no X ask.
  const noLogin = await scored({ twitter: 'someone' });
  assert.equal((await cardYes(noLogin)).show_to_builder, `Post it: https://earnkit.com/b/card${noLogin}/share`);

  await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${withX}`;
  assert.doesNotMatch((await cardYes(withX)).show_to_builder, /share/);
});

test('11.8 find makes the offer inside line 2 (two lines at most, one question); score adds it last; tell takes card yes and skip; flag off nothing', dbTest, async () => {
  const was = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash) VALUES (${`t11-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}) RETURNING id`;
    const ctx = { installationId: id };
    await tools.find({}, ctx); // the profile and the consent line
    await sql()`UPDATE builder_profiles SET slug = ${`cardf${id}`} WHERE builder_id = ${id}`;
    await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
      VALUES (${id}, '2026-10-12', 41, 77.9, ${PARTS()}, '{}', 'v1', 'v1-launch', false)`;
    await sql()`INSERT INTO builder_ranks (builder_id, score, percentile, computed_at) VALUES (${id}, 41, 77.9, now())`;
    // Line 1 of a bare find asks ("Want the 3 easiest?"): the offer waits. When nothing above asks
    // (what the list holds depends on the shared test DB), it rides on the score line: no extra line, one question.
    let offers = 0;
    for (const [n, input] of [{}, { more: true }].entries()) {
      const r = (await tools.find(input, ctx)) as { show_to_builder: string; card_offer?: { agent_note: string } };
      const lines = r.show_to_builder.split('\n');
      const before = lines.slice(0, -1).join('\n');
      assert.ok((r.show_to_builder.match(/\?/g) ?? []).length <= 1, r.show_to_builder);
      if (n === 0) assert.match(before, /\?/, 'a bare find asks on line 1');
      if (before.includes('?') || offers > 0) {
        assert.equal(lines.at(-1), `You: score 41, top 23%. earnkit.com/b/cardf${id}`);
        assert.ok(!r.card_offer);
      } else {
        assert.equal(lines.at(-1), `You: score 41, top 23%. earnkit.com/b/cardf${id}. Want your card to post on X?`);
        assert.equal(r.card_offer?.agent_note, CARD_OFFER_NOTE);
        offers++;
      }
    }
    assert.ok(offers <= 1);
    // The offer itself, deterministic: line 1 asks, it waits; nothing asks, it rides on the score line.
    if (offers === 0) {
      assert.deepEqual(await findSecondLine(id, true), { line: `You: score 41, top 23%. earnkit.com/b/cardf${id}`, fill: false, offered: false });
      assert.deepEqual(await findSecondLine(id, false), { line: `You: score 41, top 23%. earnkit.com/b/cardf${id}. Want your card to post on X?`, fill: false, offered: true });
    }
    assert.deepEqual(await findSecondLine(id, false), { line: `You: score 41, top 23%. earnkit.com/b/cardf${id}`, fill: false, offered: false }, 'once');
    // Once offered (by find or now), the score reply never offers again.
    await sql()`UPDATE builder_profiles SET card_offered_at = COALESCE(card_offered_at, now()) WHERE builder_id = ${id}`;
    const s = (await tools.score({}, ctx)) as { show_to_builder: string };
    assert.doesNotMatch(s.show_to_builder, /Want your card/);

    const skip = (await tools.tell({ card: 'skip' }, ctx)) as { show_to_builder: string };
    assert.equal(skip.show_to_builder, 'Skipped.');
    const yes = (await tools.tell({ card: 'yes' }, ctx)) as { show_to_builder: string };
    assert.equal(yes.show_to_builder, `Post it: https://earnkit.com/b/cardf${id}/share`);
    // Flag off: card is ignored, so tell is v2.11's (nothing else said: its usual refusal).
    delete process.env.EARNKIT_BUILDER_SCORE;
    await assert.rejects(tools.tell({ card: 'yes' }, ctx), /Pass at least one program_status/);
  } finally {
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});

test('11.9 the score reply offers the card last, once, and only when nothing else asks', dbTest, async () => {
  const was = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    const id = await scored({ login: 'lee9' });
    // A verified site, so the next step is "more users", declarative: nothing asks.
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'site', 'https://lee9.dev', 'lee9.dev', 'verified', 'earnkit_txt', 'server')`;
    const r = (await tools.score({}, { installationId: id })) as { show_to_builder: string; card_offer?: { agent_note: string } };
    const lines = r.show_to_builder.split('\n');
    assert.match(lines.at(-1)!, /^You're top \d+%\. Want your card to post on X\?$/);
    assert.equal((r.show_to_builder.match(/\?/g) ?? []).length, 1);
    assert.equal(r.card_offer?.agent_note, CARD_OFFER_NOTE);
    const again = (await tools.score({}, { installationId: id })) as { show_to_builder: string };
    assert.doesNotMatch(again.show_to_builder, /Want your card/);
  } finally {
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});

test('11.10 the confirmed X handle answers with the profile and the share link (only with a card to share)', dbTest, async () => {
  const was = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  try {
    const id = await scored({ login: 'leex', twitter: 'lx' });
    const r = (await tools.tell({ x_handle: 'yes' }, { installationId: id })) as { show_to_builder: string };
    const slug = `lx${id}`.slice(-15).toLowerCase();
    assert.equal(r.show_to_builder, `Your profile is now earnkit.com/b/${slug}. Post it: https://earnkit.com/b/${slug}/share`);
  } finally {
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});
