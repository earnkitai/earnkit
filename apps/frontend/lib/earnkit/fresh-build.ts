import { isWalletAddress } from './campaigns';
import { CHAIN_NAMES } from './chains';
import { plainProblem } from './coach';
import { EARNKIT_STARTER_NAMES } from './earnkit-orgs';
import { prizeOf } from './entry-text';
import { NEEDS_LIVE_PRODUCT } from './guide';
import { STARTER_TEST_MAX_AGE_DAYS } from './program-file';
import { moneyText, openCurated, openMoneyUsd } from './pool';
import { STARTERS, type Starter, type StarterChain } from './starters';
import type { Card } from './present';

/**
 * v2.11 spec 1: the no-repo lead. When nothing else leads the short first reply (no good-odds row,
 * no entry waiting on the builder's submission, no users question), it is one context line ("$1.1M+
 * in prizes is open right now across 7 programs.") and one small program to build from a tested
 * starter. Pure.
 *
 * Fail closed: no pick unless the program names a starter (owner-set `fresh_build`), the starter's
 * test has passed (`tested_at`), EarnKit can deploy to the starter's chain, and hosting is on or the
 * starter's site can go on GitHub Pages instead (`pages_fallback`, v2.11 T9, plan S10). Without a
 * pick the reply is the v2.10 line, byte for byte.
 */

export type FreshPick = { card: Card; starter: Starter };

export type FreshPickOpts = {
  /** Programs the builder is not interested in, or applied to outside EarnKit (v2.9 A3). */
  hidden: Set<string>;
  /** Programs the builder already has an entry in. */
  entered: Set<string>;
  /** EarnKit deploys to this chain right now (deploy.ts deployChainOn: the key and DEPLOY_CHAINS; plus the chain's RPC). */
  deployOn: (c: StarterChain) => boolean;
  /** EarnKit hosting is on (r2.ts r2Enabled). Off: only a starter whose site can go on GitHub Pages (T9). */
  hostOn: boolean;
  /** The starter registry; starters.ts STARTERS unless a test passes its own. */
  starters?: Record<string, Starter>;
};

/** The pick rules (spec 1): the largest prize per winner, and the close window. */
export const FRESH_MAX_USD = 5000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_LEFT_MS = 24 * HOUR_MS;
const MAX_LEFT_MS = 14 * DAY_MS;
const LEVELS = ['Easy', 'Medium'] as const;

/**
 * The card's registered starter whose test passed within the last 30 days, or undefined (never a
 * prototype key such as "toString"). Review M6: programs:check holds the same 30 days against
 * verified_at at sync time; this holds it against now, so a stale test stops the offer at once.
 */
function starterOf(c: Card, starters: Record<string, Starter>, now: Date): Starter | undefined {
  const id = c.fresh_build?.starter;
  if (!id || !Object.hasOwn(starters, id)) return undefined;
  const s = starters[id];
  if (!s.tested_at) return undefined;
  const days = Math.floor((now.getTime() - new Date(`${s.tested_at}T00:00:00Z`).getTime()) / DAY_MS);
  return days <= STARTER_TEST_MAX_AGE_DAYS ? s : undefined;
}

/**
 * v2.11 spec 1: the one program a builder with no fitting repo can build for now, with its starter,
 * or undefined. A program qualifies when it is open and curated (never sponsored, an EarnKit
 * campaign or an investment, never tagged "long shot" or "needs a live product", never hidden or
 * entered); it names a tested starter on one of its chains that EarnKit can deploy to, with hosting
 * on (or, off, a starter whose site can go on GitHub Pages: T9); it is Easy or Medium; its prize
 * per winner is known and $5,000 or less; and it closes 24 hours to 14 days from now. A rolling program qualifies only when no dated one does. Rank: Easy first,
 * more winners per round (unknown counts as 1), the sooner close, the higher prize. Pure.
 */
export function freshPick(cards: Card[], now: Date, opts: FreshPickOpts): FreshPick | undefined {
  const starters = opts.starters ?? STARTERS;
  const fits: (FreshPick & { dated: boolean })[] = [];
  for (const card of cards) {
    if (card.sponsored || card.earnkit_campaign || card.investment) continue;
    if (card.tag === 'long shot' || card.tag === NEEDS_LIVE_PRODUCT) continue;
    if (opts.hidden.has(card.id) || opts.entered.has(card.id)) continue;
    if (!openCurated(card, now)) continue;
    const level = card.difficulty?.level;
    if (!level || !(LEVELS as readonly string[]).includes(level)) continue;
    if (card.max_award_usd == null || card.max_award_usd > FRESH_MAX_USD) continue;
    const starter = starterOf(card, starters, now);
    if (!starter || !card.chains?.includes(starter.chain) || !opts.deployOn(starter.chain)) continue;
    if (!opts.hostOn && !starter.pages_fallback) continue;
    if (card.ends_at) {
      const left = card.ends_at.getTime() - now.getTime();
      if (left < MIN_LEFT_MS || left > MAX_LEFT_MS) continue;
    }
    fits.push({ card, starter, dated: Boolean(card.ends_at) });
  }
  const dated = fits.filter((f) => f.dated);
  const pool = dated.length > 0 ? dated : fits;
  const winners = (c: Card) => c.winners_per_round ?? 1;
  const [best] = pool.sort(
    (a, b) =>
      Number(a.card.difficulty?.level !== 'Easy') - Number(b.card.difficulty?.level !== 'Easy') ||
      winners(b.card) - winners(a.card) ||
      (a.card.ends_at?.getTime() ?? 0) - (b.card.ends_at?.getTime() ?? 0) ||
      (b.card.max_award_usd ?? 0) - (a.card.max_award_usd ?? 0) ||
      a.card.id.localeCompare(b.card.id),
  );
  return best ? { card: best.card, starter: best.starter } : undefined;
}

/**
 * v2.11 spec 1, Ruling S1: "$1.1M+ in prizes is open right now across 7 programs.", the site's money
 * figure (moneyText(openMoneyUsd)) and the count of the programs it sums, singular at 1. Null when
 * nothing is open. Pure.
 */
export function contextLine(cards: Card[], now: Date): string | null {
  const fig = moneyText(openMoneyUsd(cards, now));
  const n = cards.filter((c) => openCurated(c, now)).length;
  if (!fig || n === 0) return null;
  return `${fig} in prizes is open right now across ${n} program${n === 1 ? '' : 's'}.`;
}

/**
 * v2.11 spec 1, Ruling S2: the lead, one question.
 * - Builds: "Arc Microgrants pays 500 USDC and closes in 4 days. A USDC tip page on Arc takes about
 *   an hour. Want me to build it?"
 * - Chat-only: "... A coding agent builds the USDC tip page in about an hour. Want
 *   the plan?" (the starter's "what" as "the ...", its "on <chain>" dropped: the program already
 *   says where).
 * The prize is prizeOf cut at " × "; "closes in N days" counts whole days to `ends_at`, N = 1 reads
 * "closes tomorrow"; a rolling program reads "with no deadline". Every starter's bar is an hour
 * (`minutes: 60`). The "what" is the starter's, never the program's. Pure.
 */
export function freshLeadLine(p: FreshPick, now: Date, canBuild: boolean): string {
  const prize = prizeOf(p.card).split(' × ')[0];
  const days = p.card.ends_at ? Math.floor((p.card.ends_at.getTime() - now.getTime()) / DAY_MS) : null;
  const when = days === null ? 'with no deadline' : days === 1 ? 'and closes tomorrow' : `and closes in ${days} days`;
  const what = p.starter.what;
  const build = canBuild
    ? `${what.charAt(0).toUpperCase()}${what.slice(1)} takes about an hour. Want me to build it?`
    : `A coding agent builds ${theWhat(p.starter)} in about an hour. Want the plan?`;
  return `${p.card.title} pays ${prize} ${when}. ${build}`;
}

/** "a USDC tip page on Arc" as "the USDC tip page". */
const theWhat = (s: Starter) =>
  s.what.replace(/^an? /, 'the ').replace(new RegExp(` on ${CHAIN_NAMES[s.chain]}$`), '');

// ---- v2.11 T8 (spec 3): the twist question, the build checks, the building line and the kit ----

/** The twist question (spec 3), asked once before any work starts. */
export const TWIST_QUESTION = 'What should it do for you or your users? One line is enough, like "tips for my podcast listeners".';
/** Owner decision D-D: a statement, not a question, so the reply keeps one question. */
export const WALLET_ASK = 'Add the wallet that should own it.';

/** The reply to a yes to the fresh lead: the question alone when a wallet is already known (decision 5). Pure. */
export const twistQuestion = (walletKnown: boolean): string => (walletKnown ? TWIST_QUESTION : `${TWIST_QUESTION} ${WALLET_ASK}`);

/** v2.11 T8 (plan 8.5): a shared client never gets the build path (Ruling S6). No question, no tool name. */
export const BUILD_CHAT_ONLY = "I can't build from here. To have it built and deployed for you, add EarnKit to a coding agent.";

/** spec 3: on a pass, the builder's one line before the agent builds. */
export const buildingLine = (name: string, what: string, forWhom: string) => `Building ${name}: ${what} ${forWhom}. I'll be back with the live link.`;

/**
 * Accounts 0 to 9 of the default test mnemonic that anvil and Hardhat use. Their keys are public, so
 * anyone could take what such a wallet owns. The same list as chain-kits arc/tipjar
 * `scripts/artifact.mjs` (main at 0f573a7). Lowercase, without 0x.
 */
export const PUBLIC_TEST_WALLETS = [
  'f39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  '70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  '90f79bf6eb2c4f870365e785982e1f101e93b906',
  '15d34aaf54267db7d7c367839aaf71a00a2c6a65',
  '9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  '976ea74026e726554db657fa54763abd0c3a0aa9',
  '14dc79964da2c08b23698b3d3cc7ca32193d9955',
  '23618e81e3f5cdf7f54c3d65f7fbc0abaec7d3e1',
  'a0ee7a142d267c1f36714e4a8f75612f20a79720',
] as const;

/** A public test wallet (above) or the zero address, any case. Pure. */
export const publicTestWallet = (w: string): boolean => {
  const hex = w.trim().toLowerCase().replace(/^0x/, '');
  return /^0{40}$/.test(hex) || (PUBLIC_TEST_WALLETS as readonly string[]).includes(hex);
};

/** The build fields the agent writes from the builder's twist (plan S7). */
export type BuildFields = { twist: string; name: string; description: string; feature: string; for_whom: string; wallet?: string };

/** Field limits (the starter's BUILD.md: name 3 to 40, description and feature 10 to 160; spec 3: twist at most 200). */
export const BUILD_LIMITS = { twist: [3, 200], name: [3, 40], description: [10, 160], feature: [10, 160], for_whom: [5, 60] } as const;

/** Words that say nothing about whose build it is. */
const STOP_WORDS = new Set(
  ('a an the and or of to for in on at by with from as is are be it its this that these those my our your their his her ' +
    'me us we you they them who what which some any all one line like just so can will would should do does make makes made ' +
    'user users people everyone anyone someone app site').split(' '),
);
/** A text's words: camelCase split ("PodTips" is pod, tips), lower case, 3 letters or more, no stop words. */
const words = (t: string): string[] =>
  t
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
/** The same word or stem: equal, one starts the other ("pod" and "podcast"), or 5 letters in common at the start. */
const sameWord = (a: string, b: string) => {
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= 5;
};
const fold = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
const NOT_SHOWN = " Call prepare again with the fixed build. Don't show this to the builder.";
/** An agent fix for one build field (never shown to the builder). Pure. */
export const buildFix = (field: string, why: string) => `Fix build.${field}: ${why}.${NOT_SHOWN}`;
const fix = buildFix;

/**
 * v2.11 T8 (spec 3): the server's check of what the agent wrote from the builder's twist (EarnKit runs
 * no LLM: the agent writes, the server checks). Every text field is plain words (coach.ts
 * plainProblem: no address, hash, stat dump or link) and one line. The twist is 3 to 200 characters
 * and names something of the builder's own (a word that isn't the kit's). The name is 3 to 40
 * characters, never a kit name (EARNKIT_STARTER_NAMES or the kit's own twist slot). The twist is
 * baked in: the name and the description each use a word of it (or its stem: "Pod" in "PodTips" for
 * "podcast"). The feature is one sentence, never the kit's default, with a word of its own. `for_whom` is a short "for ..." phrase. A
 * given wallet is a valid address (EIP-55 when mixed case), never the zero address or a public test
 * wallet. Returns the agent's fix for the first problem, or null. Pure.
 */
export function buildCheck(b: BuildFields, starter: Starter): string | null {
  const t = {
    twist: b.twist.trim(),
    name: b.name.trim(),
    description: b.description.trim(),
    feature: b.feature.trim(),
    for_whom: b.for_whom.trim(),
  };
  const kitWords = words([starter.what, starter.kit_twist.name, starter.kit_twist.description, starter.kit_twist.feature].join(' '));
  for (const f of ['twist', 'name', 'description', 'feature', 'for_whom'] as const) {
    const [min, max] = BUILD_LIMITS[f];
    if (t[f].length < min || t[f].length > max) return fix(f, `${min} to ${max} characters`);
    if (/[\r\n]/.test(t[f])) return fix(f, 'one line');
    const plain = plainProblem(t[f], f === 'name' ? 'name' : 'one_liner');
    if (plain) return fix(f, `plain words only (${plain})`);
  }
  const own = words(t.twist).filter((w) => !kitWords.some((k) => sameWord(w, k)));
  if (own.length === 0)
    return fix('twist', 'it names nothing of the builder\'s own. Ask them who it is for, in one short question, and send their words');
  const usesTwist = (text: string) => words(text).some((w) => own.some((o) => sameWord(w, o)));
  const kitNames = [...EARNKIT_STARTER_NAMES, starter.kit_twist.name].map(fold);
  if (kitNames.includes(fold(t.name))) return fix('name', `the builder's own, never the kit's ("${starter.kit_twist.name}")`);
  if (!usesTwist(t.name)) return fix('name', `put the twist in it: use a word from "${t.twist}"`);
  if (!usesTwist(t.description)) return fix('description', `put the twist in it: use a word from "${t.twist}"`);
  if (/[.!?]\s+\S/.test(t.feature)) return fix('feature', 'one sentence');
  // Review I2: the name and the description carry the twist (and block an unchanged clone); the
  // feature only has to be the builder's own: never the kit's default, and at least one word that
  // isn't the kit's (BUILD.md's "A goal bar shows how close the next release fund is." passes).
  if (fold(t.feature) === fold(starter.kit_twist.feature)) return fix('feature', `the builder's own, never the kit's default ("${starter.kit_twist.feature}")`);
  const ownWord = words(t.feature).some((w) => !kitWords.some((k) => sameWord(w, k)));
  if (!ownWord && !usesTwist(t.feature)) return fix('feature', `the builder's own: say what it does for them, not only the kit's words`);
  if (!/^for \S/i.test(t.for_whom) || /[.!?]/.test(t.for_whom)) return fix('for_whom', 'a short phrase that starts with "for", like "for your podcast listeners"');
  if (b.wallet !== undefined) {
    const w = b.wallet.trim();
    if (!isWalletAddress(w)) return fix('wallet', 'not a valid wallet address (0x and 40 hex, checksum when mixed case). Send the wallet exactly as the builder gave it');
    if (publicTestWallet(w)) return fix('wallet', 'a public test wallet (anvil or Hardhat): anyone can spend from it. Ask the builder for their own wallet');
  }
  return null;
}

/** What buildKit hands the agent (never the builder). */
export type BuildKit = {
  starter: string;
  degit: string;
  steps: string;
  /** v2.11 T10: the steps in the order the owner proof needs (T9 R4: a fresh push within 10 minutes of the repo). */
  order: string[];
  twist_slots: { name: string; description: string; feature: string };
  owner_wallet: string;
  proof_file: string;
  proof_line: string | null;
  proof_line_note?: string;
  artifact_shape: string;
  next: string;
  rules: string[];
  /** v2.12.1 T9 (spec 3, flag on): the attribution line every transaction of the app ends with. */
  attribution?: { codes: string[]; data_suffix: string };
};

/** v2.12.1 T9: the kit's rule for the attribution line. */
export const ATTRIBUTION_RULE = 'Every transaction the app sends ends with attribution.data_suffix (viem: dataSuffix). It is how EarnKit counts the people who use it.';

/**
 * v2.11 T8 (spec 3, plan S8): the build kit for the agent: the starter's degit command and its twist
 * slots filled with the checked fields, the wallet that owns the contract, the earnkit.txt proof line
 * (`proofLine`, token-gate.ts tokenLineFor for the repo; null until the agent sends build.repo_url, or
 * with `repoGiven` when EarnKit has no signing secret),
 * the artifact shape `prepare.deploy` takes, the next call and the rules. Pure.
 */
export function buildKit(
  starter: Starter,
  proofLine: string | null,
  f: BuildFields & { wallet: string },
  repoGiven = false,
  attribution?: { codes: string[]; data_suffix: string },
): BuildKit {
  return {
    starter: starter.id,
    degit: `npx degit ${starter.repo} <project>`,
    steps: 'Follow BUILD.md in the copy, with the twist slots and the wallet below, in the order below.',
    // T10 (T9 concerns): EarnKit proves the owner from find's github_user and the owner's own first
    // push, dated within 10 minutes of the repo's creation, so the repo comes first, then the commit,
    // then the push at once.
    order: [
      "Call find with github_user: the builder's own GitHub login (what gh api user --jq .login prints); never guess it. EarnKit deploys and hosts only for that account.",
      `Copy the starter (${'`'}npx degit ${starter.repo} <project>${'`'}) into a new folder, fill the twist slots and build it as BUILD.md says. Don't create the repo or commit yet.`,
      "Create the public repo under that account (gh repo create <project> --public): no template, not a fork. If proof_line is null, send build.repo_url first (see proof_line_note).",
      'Commit everything, earnkit.txt with proof_line included, as new commits made now.',
      "Push at once, within 10 minutes of creating the repo, from the builder's own account: a normal push, never a force push.",
      'Then call prepare as next says.',
    ],
    twist_slots: { name: f.name.trim(), description: f.description.trim(), feature: f.feature.trim() },
    owner_wallet: f.wallet,
    proof_file: 'earnkit.txt',
    proof_line: proofLine,
    ...(proofLine === null && {
      // Review M4: with repo_url sent and still no line, EarnKit can't make one (no signing secret):
      // never send the agent round for repo_url again.
      proof_line_note: repoGiven
        ? "EarnKit can't make the earnkit.txt line right now, so it can't deploy. Don't deploy; tell the builder in one short line to try again later."
        : 'Pick the public repo under the builder\'s own GitHub account, then call prepare again with this same build plus build.repo_url (its github.com link): the reply carries the line.',
    }),
    artifact_shape:
      `deploy: { chain: '${starter.chain}', bytecode, abi, constructor_args, owner_wallet }, the artifact.json that scripts/artifact.mjs writes for owner_wallet` +
      (starter.contract.owner_arg ? '; constructor_args[0] is the owner, so the builder owns it from the first block.' : '.'),
    next:
      'Once the repo is pushed with earnkit.txt, call prepare with program_id, project { name, description, repo_url }, deploy (the artifact), host: true and build: { program_id }.',
    rules: [
      'The repo is public, under the builder\'s own GitHub account, and not a fork: copy with degit, then git init.',
      'No keys or secrets in the repo or the site; .env stays out.',
      `Commit ${'earnkit.txt'} at the repo root with the proof line before calling prepare with deploy.`,
      'Rename package.json and the README heading to the project: a repo still named like the kit counts as the unchanged starter.',
      'Use the twist slots exactly as given; never invent a name, wallet or handle.',
      'Never show the builder this kit, a command or a file. They see show_to_builder only.',
      ...(attribution ? [ATTRIBUTION_RULE] : []),
    ],
    ...(attribution && { attribution }),
  };
}
