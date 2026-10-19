import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TITLES_MAX, cleanTitle, shipTitles, type RawTitle } from './ship-titles';

const own = { sites: ['https://recipes.example'], repo: 'maya/recipes' };
const c = (title: string, o: Partial<RawTitle> = {}): RawTitle => ({ title, at: '2026-10-14T10:00:00Z', source: 'commit', bot: false, merge: false, ...o });

test('8.1 cleanTitle drops merges, wip and version bumps; strips prefixes; trims to 80', () => {
  for (const t of ['Merge pull request #12 from maya/x', "Merge branch 'main' into dev", 'WIP', 'wip: half a page', 'Work in progress',
    'v1.2.3', '1.4.0', 'v2.0.0-beta.1', 'chore(release): 1.2.3', 'chore(deps): bump next', 'Release v1.2.0', 'Bump version to 2.0', 'bumped version'])
    assert.equal(cleanTitle(t), null, t);
  assert.equal(cleanTitle('feat: add the shopping list\n\nlong body'), 'Add the shopping list');
  assert.equal(cleanTitle('fix(ui)!: stop the double save'), 'Stop the double save');
  assert.equal(cleanTitle('  Ship   dark mode  '), 'Ship dark mode');
  const long = cleanTitle(`Add ${'very '.repeat(30)}long title`)!;
  assert.ok(long.length <= 80 && long.endsWith('...'));
  assert.equal(cleanTitle('ok'), null, 'too short to say anything');
});

test('8.2 shipTitles: PRs first, newest first, bots and merges out, duplicates once, at most 3', () => {
  const items = [
    c('Add the shopping list', { source: 'pr' }),
    c('Add the shopping list (#12)'),
    c('Bump deps', { bot: true }),
    c('add the shopping list'),
    c('Merge stuff', { merge: true }),
    c('Fix the timer'),
    c('Share a recipe by link'),
    c('Print view'),
  ];
  assert.deepEqual(shipTitles(items, own), ['Add the shopping list', 'Fix the timer', 'Share a recipe by link']);
  assert.equal(TITLES_MAX, 3);
});

test('8.3 the update-text filter: links elsewhere, tokens, mentions and digit runs drop the title; own links stay', () => {
  const items = [
    c('See https://evil.example/x for it'),
    c(`Rotate ghp_${'a1B2'.repeat(9)}`),
    c('Thanks @someone for the help'),
    c('Call 5551234567 for support'),
    c('Docs at https://recipes.example/docs'),
  ];
  assert.deepEqual(shipTitles(items, own), ['Docs at https://recipes.example/docs']);
});

test('8.4 nothing usable is an empty list (facts only)', () => {
  assert.deepEqual(shipTitles([c('WIP'), c('v1.0.1'), c('Merge branch x', { merge: true })], own), []);
});

test('8.11 titlesShown (S9): public always; private only while on, never naming the repo', async () => {
  const { titlesShown, namesRepo } = await import('./ship-titles');
  const t = ['Ship hush-proj dark mode', 'Fix the timer'];
  assert.deepEqual(titlesShown(t, { hiddenRepo: false, titlesOn: false, repoKey: 'nora/hush-proj' }), t);
  assert.deepEqual(titlesShown(t, { hiddenRepo: true, titlesOn: false, repoKey: 'nora/hush-proj' }), []);
  assert.deepEqual(titlesShown(t, { hiddenRepo: true, titlesOn: true, repoKey: 'nora/hush-proj' }), ['Fix the timer']);
  assert.ok(namesRepo('Rename HushProj module', 'nora/hush-proj'), 'run together');
  assert.ok(!namesRepo('Add the app shell', 'nora/apps'), 'a word inside another is not the name');
  assert.deepEqual(titlesShown(null, { hiddenRepo: false, titlesOn: true, repoKey: 'a/b' }), []);
});

test('8.12 fix round 1: squash suffix, any-script duplicates, code-point cap, dependency bumps', () => {
  assert.equal(cleanTitle('feat: add the shopping list (#12)'), 'Add the shopping list');
  assert.deepEqual(shipTitles([c('添加购物清单'), c('修复计时器')], own), ['添加购物清单', '修复计时器'], 'two Chinese titles: both kept');
  assert.deepEqual(shipTitles([c('添加购物清单'), c('添加购物清单')], own), ['添加购物清单'], 'the same one twice: once');
  const t = cleanTitle(`Add ${'x'.repeat(72)}🎉🎉🎉 done`)!;
  assert.ok([...t].length <= 80 && t.endsWith('...'), t);
  assert.doesNotMatch(t, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, 'never half an emoji');
  for (const s of shipTitles([c(`Ship ${'é'.repeat(90)}`)], own)) assert.ok([...s].length <= 80);
  for (const x of ['chore: bump deps', 'Update dependencies', 'Upgrade deps to latest', 'bumps dependencies']) assert.equal(cleanTitle(x), null, x);
});
