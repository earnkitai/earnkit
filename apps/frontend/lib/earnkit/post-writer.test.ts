import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST_MAX, isMilestone, openingWord, postProblems, writePost, type PostHistory, type PostInput } from './post-writer';

/**
 * v3.1 one-tap posts, Task 2 (design 2): the deterministic writer. The design's 8 good posts come out exactly, its 3
 * bad ones are refused, and 26 weeks of one builder never repeat a shape or an opening word in a row.
 */
const write = (input: PostInput, history: PostHistory = []) => writePost(input, history);
const weekly = (o: Partial<Extract<PostInput, { moment: 'weekly' }>>): PostInput => ({ moment: 'weekly', name: null, week: 1, summary: null, note: null, ...o });

test('good 1: Maya, Recipes, week 6', () => {
  assert.deepEqual(write(weekly({ name: 'Recipes', week: 6, summary: 'Added offline mode and fixed several sync bugs.' })), {
    shape: 'name_week', text: 'Recipes, week 6: added offline mode and fixed several sync bugs.',
  });
});

test('good 2: the next weekly for Maya rotates the shape', () => {
  const history = [{ shape: 'name_week', text: 'Recipes, week 6: added offline mode and fixed several sync bugs.' }];
  assert.deepEqual(write(weekly({ name: 'Recipes', week: 9, summary: 'Rebuilt search so it works on ingredients.' }), history), {
    shape: 'change', text: 'Rebuilt search so it works on ingredients.',
  });
});

test('good 3: Dev\'s note goes in verbatim (a weekly or their news)', () => {
  const note = 'first paying customer today, $9/mo, from a stranger';
  assert.deepEqual(write({ moment: 'news', note }), { shape: 'note', text: note });
  assert.deepEqual(write(weekly({ name: 'Dev app', week: 3, summary: 'Added billing.', note })), { shape: 'note', text: note }, 'the note wins over our wording');
});

test('good 4: Sam, Tally, went live after 9 weeks of commits', () => {
  assert.deepEqual(write({ moment: 'went_live', name: 'Tally', weeks: 9 }), { shape: 'live', text: 'Tally is live. 9 weeks from first commit.' });
});

test('good 5: Lee, Ledgerline, a 12-week streak', () => {
  assert.deepEqual(write(weekly({ name: 'Ledgerline', week: 12, summary: 'Added CSV export.' })), {
    shape: 'count', text: '12 weeks shipping Ledgerline without missing one. This week: added CSV export.',
  });
});

test('good 6: Lee, an announced win', () => {
  assert.deepEqual(write({ moment: 'won', name: 'Ledgerline', program: 'Base Builder Grant', award: '$5,000' }), {
    shape: 'won', text: 'Ledgerline won the Base Builder Grant ($5,000).',
  });
});

test('good 7: Ana, Pollen, a 26-week streak', () => {
  assert.deepEqual(write(weekly({ name: 'Pollen', week: 26 })), { shape: 'bare', text: 'Week 26.' });
});

test('good 8: Kit, week 3', () => {
  assert.deepEqual(write(weekly({ name: 'Kit', week: 3, summary: 'Cut onboarding to two screens.' })), {
    shape: 'name_week', text: 'Kit, week 3: cut onboarding to two screens.',
  });
});

test('the 3 bad posts are refused, each for its reasons', () => {
  const bad1 = 'Excited to announce Recipes just shipped offline mode! LFG $RCP #buildinpublic';
  const p1 = postProblems(bad1);
  for (const r of ['excited', 'announce', 'exclamation', 'LFG', 'cashtag', 'hashtag']) assert.ok(p1.includes(r), `${r} in ${p1}`);
  const bad2 = 'Week 7 shipping Recipes. earnkit.com/maya';
  assert.ok(postProblems(bad2).includes('link'));
  assert.ok(postProblems('Week 7 shipping Recipes.', { prev: 'Week 7 shipping Recipes.' }).includes('repeat'), 'the same post again');
  const bad3 = 'Recipes is revolutionizing home cooking with a seamless offline-first experience. Back the vision.';
  const p3 = postProblems(bad3);
  for (const r of ['revolutioniz', 'seamless', 'back the']) assert.ok(p3.includes(r), `${r} in ${p3}`);
});

test('every banned word, mark and phrase is refused in EarnKit-written text', () => {
  const cases = [
    'We are thrilled.', 'Proud to share this.', 'A game changer.', 'A game-changing build.', 'It empowers people.', 'This unlocks search.',
    'Our journey goes on.', 'WAGMI.', 'Up to the moon.', 'Moon soon.', 'A hidden gem.', 'Some alpha here.', 'Going 100x.', "Don't miss it.",
    'Buy now.', 'Back me.', 'Ape in.', 'Recipes on EarnKit.', 'Added search — fast.', 'Added search \u{1F680}', 'Added #search.', 'See $RCP.',
    'Read it at https://recipes.example.', 'Read it at recipes.app now.', 'Added search!',
  ];
  for (const c of cases) assert.notDeepEqual(postProblems(c), [], c);
  assert.deepEqual(postProblems('Added offline mode for $9/mo plans.'), [], 'a price is not a cashtag');
  assert.ok(postProblems('Just shipped search.', { prev: 'Just shipped offline mode.' }).includes('just shipped twice'));
  assert.deepEqual(postProblems('Just shipped search.', { prev: 'Added offline mode.' }), []);
  assert.ok(postProblems('x'.repeat(POST_MAX + 1)).includes('length'));
});

test('a summary with banned words is never posted; the writer falls to another shape or none', () => {
  assert.equal(write(weekly({ name: 'Recipes', week: 5, summary: 'Unlocked a seamless new search!' })), null);
  assert.deepEqual(write(weekly({ name: 'Pollen', week: 12, summary: 'Unlocked a seamless new search!' })), { shape: 'bare', text: 'Week 12.' });
  // A note with a shill word or a link is not used; our wording is.
  assert.deepEqual(write(weekly({ name: 'Recipes', week: 5, summary: 'Added search.', note: 'buy $RCP before it moons' })), {
    shape: 'name_week', text: 'Recipes, week 5: added search.',
  });
  assert.deepEqual(write(weekly({ name: 'Recipes', week: 5, summary: 'Added search.', note: 'read more at recipes.app' }))!.shape, 'name_week');
  // A builder's own "!" stays theirs.
  assert.deepEqual(write({ moment: 'news', note: 'Finally got the first 10 users!' }), { shape: 'note', text: 'Finally got the first 10 users!' });
});

test('no summary, no note: no weekly post (the streak alone is never one); under 12 weeks no bare post', () => {
  assert.equal(write(weekly({ name: 'Recipes', week: 5 })), null);
  assert.equal(write(weekly({ name: 'Recipes', week: 8 })), null, 'a milestone under 12 needs a summary');
  assert.deepEqual(write(weekly({ name: 'Recipes', week: 52 })), { shape: 'bare', text: 'Week 52.' });
  assert.deepEqual([4, 8, 12, 26, 52].map(isMilestone), [true, true, true, true, true]);
  assert.deepEqual([1, 5, 13, 27].map(isMilestone), [false, false, false, false]);
});

test('a private project (no name to show): only the nameless shapes', () => {
  const a = write(weekly({ name: null, week: 6, summary: 'Added offline mode.' }))!;
  assert.deepEqual(a, { shape: 'change', text: 'Added offline mode.' });
  const b = write(weekly({ name: null, week: 7, summary: 'Rebuilt search.' }), [a])!;
  assert.deepEqual(b, { shape: 'this_week', text: 'This week: rebuilt search.' });
  assert.equal(write({ moment: 'went_live', name: null as unknown as string, weeks: 3 }), null);
});

test('the summary\'s first letter is lowered only for an ordinary word; an acronym or brand keeps its case', () => {
  assert.equal(write(weekly({ name: 'Kit', week: 3, summary: 'CSV export for every list.' }))!.text, 'Kit, week 3: CSV export for every list.');
  assert.equal(write(weekly({ name: 'Kit', week: 3, summary: 'iOS app in review' }))!.text, 'Kit, week 3: iOS app in review.');
  assert.equal(write(weekly({ name: 'Kit', week: 3, summary: 'I added a shopping list.' }))!.text, 'Kit, week 3: I added a shopping list.');
  assert.equal(write(weekly({ name: 'Kit', week: 3, summary: 'A shopping list.' }))!.text, 'Kit, week 3: a shopping list.');
});

test('events: went live, won, accepted, funded, each with a second wording when the last post opened the same way', () => {
  const last = [{ shape: 'name_week', text: 'Tally, week 9: added receipts.' }];
  assert.deepEqual(write({ moment: 'went_live', name: 'Tally', weeks: 9 }, last), { shape: 'live_alt', text: '9 weeks from first commit, Tally is live.' });
  assert.deepEqual(write({ moment: 'went_live', name: 'Tally', weeks: 1 }), { shape: 'live', text: 'Tally is live.' });
  const lw = [{ shape: 'name_week', text: 'Ledgerline, week 4: added CSV export.' }];
  assert.deepEqual(write({ moment: 'won', name: 'Ledgerline', program: 'Base Builder Grant', award: null }, lw), { shape: 'won_alt', text: 'Won the Base Builder Grant with Ledgerline.' });
  assert.deepEqual(write({ moment: 'accepted', name: 'Ledgerline', program: 'Arc Microgrants', award: null }), { shape: 'accepted', text: 'Ledgerline was accepted into the Arc Microgrants.' });
  assert.deepEqual(write({ moment: 'funded', name: 'Ledgerline', program: 'The Base Fund', award: '$10,000' }), { shape: 'funded', text: 'Ledgerline was funded by The Base Fund ($10,000).' });
  assert.deepEqual(write({ moment: 'funded', name: 'Ledgerline', program: 'Base Fund', award: null }, lw), { shape: 'funded_alt', text: 'Funded by the Base Fund, for Ledgerline.' });
  // Two wins in a row: the second rotates.
  const w1 = write({ moment: 'won', name: 'Ledgerline', program: 'Base Builder Grant', award: null })!;
  assert.equal(write({ moment: 'won', name: 'Ledgerline', program: 'Arc Microgrants', award: null }, [w1])!.shape, 'won_alt');
});

test('coin intro (owner ruling 1): one post that names the ticker once; the ticker appears in no other shape', () => {
  assert.deepEqual(write({ moment: 'coin_intro', name: 'Tally', symbol: 'tally', weeks: 9 }), { shape: 'coin_intro', text: 'Tally has a coin now, $TALLY. 9 weeks shipping so far.' });
  assert.deepEqual(write({ moment: 'coin_intro', name: 'Tally', symbol: 'TALLY', weeks: 1 }), { shape: 'coin_intro', text: 'Tally has a coin now, $TALLY.' });
  assert.deepEqual(write({ moment: 'coin_intro', name: 'Tally', symbol: 'MOON', weeks: 3 })!.text, 'Tally has a coin now, $MOON. 3 weeks shipping so far.', 'the ticker is a name, not a hype word');
  assert.equal(write({ moment: 'coin_intro', name: 'Tally', symbol: 'T A L', weeks: 3 }), null, 'a ticker that is not plain letters and digits');
  assert.equal(write({ moment: 'coin_intro', name: 'Tally', symbol: 'TALLY', weeks: 3 }, [{ shape: 'coin_intro', text: 'Tally has a coin now, $TALLY.' }]), null, 'never twice');
  assert.ok(postProblems('Tally has a coin now, $TALLY. Also $TALLY.', { ticker: 'TALLY' }).includes('cashtag'), 'only once');
});

test('openingWord: the first word, lowercase, without punctuation', () => {
  assert.equal(openingWord('Recipes, week 6: added offline mode.'), 'recipes');
  assert.equal(openingWord('Week 26.'), 'week');
  assert.equal(openingWord('12 weeks shipping'), '12');
});

test('26 simulated weeks: every week with something to say gets a post, and no shape or opening word repeats in a row', () => {
  const summaries = [
    'Added offline mode.', 'Added recipe import from links.', 'Fixed the sync loop on slow networks.', 'Rebuilt search so it works on ingredients.',
    'Added a shopping list.', 'Cut the app size in half.', 'Added dark mode.', 'Moved images to a cheaper store.', 'Added meal plans.',
    'Fixed login on Android.', 'Added sharing to friends.', 'Rewrote the editor.', 'Added nutrition facts.', 'This week was mostly tests.',
  ];
  const notes: Record<number, string> = { 5: 'first 100 people used it this week', 6: 'paid users now cover the server bill', 17: 'a cooking school asked for a team plan' };
  const history: PostHistory = [];
  const posts: { week: number; shape: string; text: string }[] = [];
  for (let week = 1; week <= 26; week++) {
    const summary = week === 9 ? null : summaries[(week * 5) % summaries.length]!;
    const p = writePost(weekly({ name: 'Recipes', week, summary, note: notes[week] ?? null }), history);
    if (week === 9) {
      assert.equal(p, null, 'week 9 has nothing to say');
      continue;
    }
    assert.ok(p, `week ${week} has a post`);
    assert.deepEqual(postProblems(p.text), [], p.text);
    posts.push({ week, ...p });
    history.unshift(p);
  }
  assert.equal(posts.length, 25);
  for (let i = 1; i < posts.length; i++) {
    const [a, b] = [posts[i - 1]!, posts[i]!];
    assert.notEqual(b.shape, a.shape, `weeks ${a.week} and ${b.week}: ${a.text} / ${b.text}`);
    assert.notEqual(openingWord(b.text), openingWord(a.text), `weeks ${a.week} and ${b.week}: ${a.text} / ${b.text}`);
  }
  // Milestones fold into their week's post: 4, 8, 12 and 26 carry the count or the bare week.
  for (const w of [4, 8, 12, 26]) assert.ok(['count', 'bare', 'note'].includes(posts.find((p) => p.week === w)!.shape), `week ${w}`);
  // No more than 2 of any 3 in a row share a shape.
  for (let i = 2; i < posts.length; i++) assert.ok(new Set([posts[i - 2]!.shape, posts[i - 1]!.shape, posts[i]!.shape]).size >= 2);
});
