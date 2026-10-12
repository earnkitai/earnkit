import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProfileView from '../../app/b/[slug]/ProfileView';
import { EMPTY_LINE, SCORE_COLORS, money, profileData, profileName, statsOf, stricterNote, type ProfileData } from './profile-data';
import { emptyProfile, fullProfile } from './fixtures/profile';
import { sql } from './db';

(globalThis as { React?: typeof React }).React = React;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('10.1 hero: one dominant number, "Top N% of builders", the 7-day change; the name is X, never a wallet', () => {
  const h = html(React.createElement(ProfileView, { data: fullProfile }));
  const t = text(h);
  assert.match(h, /<h1[^>]*>@lee_builds<\/h1>/);
  assert.match(t, /\b41\b.*Top 22% of builders/);
  assert.match(t, /up 6 this week/);
  assert.doesNotMatch(t, /0x[0-9a-f]{40}/i);
});

test('10.2 stat strip: three strongest parts, each with a one-line meaning', () => {
  const t = text(html(React.createElement(ProfileView, { data: fullProfile })));
  for (const s of ['1,240 users', '$3.1k fees and volume', '14 months live']) assert.ok(t.includes(s), s);
  assert.equal((html(React.createElement(ProfileView, { data: fullProfile })).match(/data-stat=/g) ?? []).length, 3);
});

test('10.3 project cards, verified sources row, sparkline; no self-reported text, no private repo, no em dash, no emoji', () => {
  const h = html(React.createElement(ProfileView, { data: fullProfile }));
  assert.equal((h.match(/data-project=/g) ?? []).length, fullProfile.projects.length);
  assert.match(text(h), /Arc Microgrants: won/);
  assert.match(h, /<svg[^>]*aria-label="Score over 90 days"/);
  // Cut at the shared Footer, as copy-review.test.ts does: its "©" is Extended_Pictographic, not an emoji we add.
  assert.doesNotMatch(h.split('<footer')[0], /—|\p{Extended_Pictographic}/u);
  assert.doesNotMatch(h, /href="javascript:/);
});

test('10.4 an empty profile renders the neutral public line and no number; the score ring uses the two score tokens', () => {
  const h = html(React.createElement(ProfileView, { data: emptyProfile }));
  const t = text(h);
  assert.match(t, /Builder b-x7k2m9qa/);
  assert.ok(t.includes(EMPTY_LINE));
  // A public page: nothing addressed to the owner (no "your", no "say ...", no fill step).
  assert.doesNotMatch(text(h.split('<footer')[0]), /\byour?\b|\bsay\b|earnkit\.txt/i);
  assert.doesNotMatch(t, /Top \d+%/);
  const ring = readFileSync(join(import.meta.dirname, '../../app/b/[slug]/ScoreRing.tsx'), 'utf8');
  assert.match(ring, /SCORE_COLORS\.from/);
  assert.match(ring, /SCORE_COLORS\.to/);
});

test('10.5 the accents are 4.5:1 or more on the panel navy (plan R17)', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  assert.ok(ratio(SCORE_COLORS.from, SCORE_COLORS.panel) >= 4.5);
  assert.ok(ratio(SCORE_COLORS.to, SCORE_COLORS.panel) >= 4.5);
  const tw = readFileSync(join(import.meta.dirname, '../../tailwind.config.ts'), 'utf8');
  assert.match(tw, /'ek-score-orange': '#FF7A1A'/);
  assert.match(tw, /'ek-score-purple': '#9B6BFF'/);
});

test('10.6 statsOf and money: words, not jargon', () => {
  assert.equal(money(3100), '$3.1k');
  assert.equal(money(950), '$950');
  assert.equal(money(1_200_000), '$1.2M');
  const parts = { users: { points: 40, raw: { U: 1240 } }, money: { points: 12, raw: { M: 3100 } }, staying: { points: 15, raw: {} }, recency: { points: 2, raw: {} }, consistency: { points: 1, raw: { weeks: 2 } } };
  assert.deepEqual(statsOf(parts, [{ first_outcome_at: '2025-08-01T00:00:00Z' }], new Date('2026-10-12T00:00:00Z')).map((s) => s.value), ['1,240 users', '14 months live', '$3.1k fees and volume']);
});

test('10.7 the stricter note shows only when the calibration changed and the percentile did not fall', () => {
  assert.equal(stricterNote([{ day: '2026-12-01', calibration: 'v2', percentile: 80 }, { day: '2026-11-30', calibration: 'v1-launch', percentile: 78 }]), 'Scoring got stricter on Dec 1, 2026; your rank is unchanged.');
  assert.equal(stricterNote([{ day: '2026-12-01', calibration: 'v2', percentile: 70 }, { day: '2026-11-30', calibration: 'v1-launch', percentile: 78 }]), null);
  assert.equal(stricterNote([{ day: '2026-12-01', calibration: 'v1-launch', percentile: 70 }]), null);
});

test('10.8 the page: ISR 600, 404 for hidden and unknown, a permanent redirect for an old slug, nothing with the flag off', () => {
  const page = readFileSync(join(import.meta.dirname, '../../app/b/[slug]/page.tsx'), 'utf8');
  assert.match(page, /export const revalidate = 600/);
  assert.match(page, /permanentRedirect\(`\/b\/\$\{/);
  assert.match(page, /if \(!builderScoreEnabled\(\)\) notFound\(\)/);
});

test('10.9 the name: X, else the proven GitHub login, else a neutral label; never a wallet (spec 7)', () => {
  assert.equal(profileName({ x_handle: 'lee_builds', github_login: 'lee', slug: 'lee_builds' }), '@lee_builds');
  assert.equal(profileName({ x_handle: null, github_login: 'lee-dev', slug: 'lee-dev' }), 'lee-dev');
  assert.equal(profileName({ x_handle: null, github_login: null, slug: 'b-x7k2m9qa' }), 'Builder b-x7k2m9qa');
  // A wallet slug (and its numbered forms) is never part of the name.
  assert.equal(profileName({ x_handle: null, github_login: null, slug: '0xabcd1234' }), 'Builder');
  assert.equal(profileName({ x_handle: null, github_login: null, slug: '0xabcd1234-2' }), 'Builder');
  // A single-value history draws no sparkline; a 0 change shows no change line.
  const h = html(React.createElement(ProfileView, { data: { ...fullProfile, spark: [41], change_7d: 0 } }));
  assert.doesNotMatch(h, /Score over 90 days/);
  assert.doesNotMatch(text(h), /this week/);
  assert.match(text(html(React.createElement(ProfileView, { data: { ...fullProfile, change_7d: -3 } }))), /down 3 this week/);
});

// ---- With a database: what profileData reads.

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// builder_scores and source_readings are append-only: this run's people are fresh ids.
const T = 2_143_000_000 + Math.floor(Math.random() * 200_000) * 20;
const NOW = new Date('2026-10-12T12:00:00Z');
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await sql()`DELETE FROM builder_sources WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_ranks WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_profiles WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM profile_slug_history WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM repo_public_reads WHERE repo_key LIKE ${`github.com/lee${T}/%`}`;
  await sql().end();
});
const parts = (users: number, U: number) => ({
  users: { points: users, raw: { U } }, money: { points: 0, raw: { M: 0 } }, staying: { points: 0, raw: {} },
  recency: { points: 1, raw: {} }, consistency: { points: 0, raw: { weeks: 0 } },
});
const profile = (id: number, o: { slug?: string; x?: string | null; login?: string | null; held?: boolean; hidden?: boolean } = {}) =>
  sql()`INSERT INTO builder_profiles (builder_id, slug, x_handle, github_login, fallback_handle, held, hidden)
    VALUES (${id}, ${o.slug ?? `s${id}`}, ${o.x ?? null}, ${o.login ?? null}, ${o.login ?? '0xabcd…1234'}, ${o.held ?? false}, ${o.hidden ?? false})`;
const scoreRow = (id: number, day: string, score: number, o: { held?: boolean; U?: number } = {}) =>
  sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, ${day}, ${score}, 60, ${sql().json(parts(score, o.U ?? 3) as never)}, ${sql().json({} as never)}, 'v1', 'v1-launch', ${o.held ?? false})`;
const source = async (id: number, kind: string, ref: string, project_key: string, proof: string) => {
  const [r] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, ${kind}, ${ref}, ${project_key}, 'verified', ${proof}, 'server') RETURNING id`;
  return Number(r.id);
};
const reading = (sid: number, day: string, signals: unknown) =>
  sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${sid}, ${day}, ${sql().json(signals as never)}, true)`;
const isFull = (d: unknown): d is ProfileData => !!d && typeof d === 'object' && 'score' in d;

test('10.10 profileData: unknown and hidden are null, an old slug redirects, no public score is the neutral empty line', dbTest, async () => {
  const [a, b] = [T, T + 1];
  assert.equal(await profileData(`nobody-${T}`, NOW), null);
  await profile(a, { hidden: true });
  await sql()`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${`old${a}`}, ${a})`;
  assert.equal(await profileData(`s${a}`, NOW), null, 'hidden');
  assert.equal(await profileData(`old${a}`, NOW), null, 'hidden, even through its history');
  await profile(b);
  await sql()`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${`old${b}`}, ${b})`;
  assert.deepEqual(await profileData(`old${b}`, NOW), { redirect: `s${b}` });
  // A wallet fallback is never the name.
  assert.deepEqual(await profileData(`s${b}`, NOW), { name: `Builder s${b}`, slug: `s${b}`, line: EMPTY_LINE });
  await scoreRow(b, '2026-10-11', 0);
  assert.deepEqual(await profileData(`s${b}`, NOW), { name: `Builder s${b}`, slug: `s${b}`, line: EMPTY_LINE }, 'a public 0 is empty too');
});

test('10.11 profileData: a held profile shows its last unheld score; 90-day spark and 7-day change from public rows only', dbTest, async () => {
  const id = T + 2;
  await profile(id, { x: 'lee_builds', login: `leex${T}`, held: true });
  await scoreRow(id, '2026-10-01', 30);
  await scoreRow(id, '2026-10-05', 33);
  await scoreRow(id, '2026-10-10', 36);
  await scoreRow(id, '2026-10-11', 90, { held: true });
  const d = await profileData(`s${id}`, NOW);
  assert.ok(isFull(d));
  assert.equal(d.name, '@lee_builds');
  assert.equal(d.score, 36, 'never the held number');
  assert.deepEqual(d.spark, [30, 33, 36]);
  assert.equal(d.change_7d, 6, 'against the score a week before (the latest public row on or before that day)');
  // builder_ranks is rebuilt by any test's percentiles() run, so the rank is read, not fixed.
  assert.ok(Number.isInteger(d.top_percent) && d.top_percent >= 1 && d.top_percent <= 100);
  assert.equal(d.stricter_note, null);
});

test('10.12 profileData: a private repo is never named; a public one links; a repo-linked site shows as live only', dbTest, async () => {
  const id = T + 3;
  await profile(id, { login: `lee${T}` });
  await scoreRow(id, '2026-10-11', 20);
  const day = '2026-10-11';
  const star = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `gh:fan${T}x${i}`, at: '2026-07-01T00:00:00Z', created_at: '2020-01-01T00:00:00Z' }));
  const repoSignals = (n: number) => ({ owner: `lee${T}`, owner_type: 'User', fork: false, template: false, stargazers: star(n), forkers: [], issue_authors: [], contributors: [], commit_weeks: [], partial: false });
  const pub = await source(id, 'repo', `lee${T}/tipjar`, `lee${T}/tipjar`, 'repo_owner');
  const priv = await source(id, 'repo', `lee${T}/secret-plan`, `lee${T}/secret-plan`, 'repo_owner');
  const site = await source(id, 'site', 'https://tipjar.example.com', `lee${T}/tipjar`, 'repo_link');
  await reading(pub, day, repoSignals(4));
  await reading(priv, '2026-09-01', repoSignals(2));
  await reading(site, day, { status: 200, up: true });
  await sql()`INSERT INTO repo_public_reads (repo_key, read_at) VALUES (${`github.com/lee${T}/tipjar`}, ${NOW}) ON CONFLICT DO NOTHING`;
  const d = await profileData(`s${id}`, NOW);
  assert.ok(isFull(d));
  assert.equal(d.name, `lee${T}`);
  const all = JSON.stringify(d);
  assert.doesNotMatch(all, /secret-plan/);
  const tip = d.projects.find((p) => p.key === `lee${T}/tipjar`);
  assert.ok(tip);
  assert.equal(tip.title, 'tipjar');
  assert.deepEqual(tip.numbers, ['4 users']);
  assert.deepEqual(tip.sources.map((s) => [s.kind, s.label, s.href]), [
    ['github', `lee${T}/tipjar`, `https://github.com/lee${T}/tipjar`],
    ['site', 'tipjar.example.com', 'https://tipjar.example.com/'],
  ]);
  const hidden = d.projects.find((p) => p.key !== `lee${T}/tipjar`);
  assert.match(hidden?.key ?? '', /^project-\d+$/);
  assert.equal(hidden?.title, 'Private project');
  assert.deepEqual(hidden?.sources, []);
  const t = text(html(React.createElement(ProfileView, { data: d })));
  assert.doesNotMatch(t, /secret-plan/);
});
