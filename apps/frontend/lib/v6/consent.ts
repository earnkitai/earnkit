/**
 * v3.8 E12 (plan item 8, L2, L10): the onboarding form, behind `form`. After sign-in, /me sends a builder with no
 * `record.consent` to /me/start: one consent step (fill forms, submit, show public evidence on program pages, use public
 * data in the corpus and benchmark), the 18-or-over question, and an optional wallet. No taste questions. Saving also
 * fills the record's name from GitHub when it is empty (silent enrichment). Under 18: nothing listed, no submit, not in
 * the corpus, whatever was ticked. Withdraw on /me turns all four off at once. Decision 28 is the corpus boundary.
 */
import { flagOn } from '../v5/flags';
import { getBuilder, getRecord, withRecord } from './builders';
import type { BuilderRecord } from './record';

export const CONSENT_VERSION = '2026-11-24';

export type Consent = NonNullable<BuilderRecord['consent']>;
export type ConsentForm = { fill: boolean; submit: boolean; list: boolean; corpus: boolean; adult: boolean | null; wallet: string };

/** The four things the one consent step covers, as the form and /privacy say them (plan 23.3). */
export const CONSENT_ITEMS = [
  ['fill', 'Your agent fills program forms from what you give EarnKit.'],
  ['submit', 'Your agent presses submit when you say yes to a program.'],
  ['list', 'Program pages show your public work, like your public repos and announced wins.'],
  ['corpus', "EarnKit uses your public data in its public corpus and benchmark. Never your private fields, drafts, email or wallet."],
] as const;

export const START_COPY = {
  title: 'One step before your first program',
  lead: "Tick what you're happy with. You can change it on your page any time.",
  adult: 'Are you 18 or over?',
  wallet: 'Wallet address (only if a program pays to one)',
  save: 'Save',
  needAdult: 'Say whether you are 18 or over, then save.',
  walletLong: 'That wallet address is too long. It takes 120 characters.',
} as const;

export const WITHDRAW_COPY = {
  title: 'What you said yes to',
  on: 'You said yes on the form. Withdraw and EarnKit stops filling, submitting, showing and using your data at once.',
  off: "You've said no to all of it.",
  change: 'Change your answers',
  button: 'Withdraw consent',
} as const;

export const CONSENT_SAVED = "Saved. You're set up.";
export const CONSENT_WITHDRAWN = "Done. EarnKit won't fill, submit, show or use your data until you say yes again.";
export const UNDER_18_SAVED = "Saved. Under 18, EarnKit doesn't list you, submit for you or use your data.";

/** /me's gate: off, nothing is read and /me is main's /me (no redirect, no section); on, the saved answers, or
 *  `start` when there are none (send the builder to /me/start). */
export async function meConsent(builderId: number): Promise<{ consent?: Consent; start: boolean }> {
  if (!flagOn('form')) return { start: false };
  const consent = (await getRecord(builderId)).consent;
  return { consent, start: !consent };
}

/** The stored answers from a form: under 18 turns submit, list and corpus off. Pure. */
export function consentOf(f: ConsentForm, now: Date): Consent {
  const adult = f.adult === true;
  return {
    fill: f.fill, submit: adult && f.submit, list: adult && f.list, corpus: adult && f.corpus, adult,
    ...(f.wallet.trim() ? { wallet: f.wallet.trim() } : {}), at: now.toISOString(), version: CONSENT_VERSION,
  };
}

/** Writes the answers on the record (EarnKit's own field); no submit means no agent submit and no standing approval;
 *  the record's name is filled from GitHub when empty. */
export async function saveConsent(builderId: number, c: Consent, now: Date): Promise<void> {
  const b = await getBuilder(builderId);
  await withRecord(builderId, now, (cur) => {
    cur.consent = c;
    if (!c.submit) cur.policy = { ...cur.policy, auto_apply: false, agent_may_submit: false };
    if (!cur.person.name && b?.name) cur.person = { ...cur.person, name: b.name.slice(0, 80) };
    return { record: cur, result: null };
  });
}

/** Withdraws: all four off, the time kept; no agent submit and no standing approval. */
export async function withdrawConsent(builderId: number, now: Date): Promise<boolean> {
  const r = await withRecord(builderId, now, (cur) => {
    if (!cur.consent) return { record: null, result: false };
    cur.consent = { ...cur.consent, fill: false, submit: false, list: false, corpus: false, withdrawn_at: now.toISOString() };
    cur.policy = { ...cur.policy, auto_apply: false, agent_may_submit: false };
    return { record: cur, result: true };
  });
  return !r.broken && r.result;
}

/** /privacy (L10): what is public, what is private, what the consent covers (decision 28). */
export const PRIVACY_TITLE = 'Privacy';
export const PRIVACY_SECTIONS = [
  { title: 'What is public', lines: [
    'Only what anyone can already see: your public GitHub repos and activity, a public demo or live link, public X posts, publicly announced wins and public traction pages.',
    'Program pages show it only if you said yes to that on the form.',
  ] },
  { title: 'What stays private', lines: [
    'Your email, wallet, phone, private record fields, private repos, drafts and the text of what you submit.',
    "Anything you told EarnKit that isn't public, and any result that wasn't publicly announced. A rejection is never public.",
  ] },
  { title: 'What your yes covers', lines: [
    'Filling forms, pressing submit when you say yes, showing your public work on program pages, and using your public data in the public corpus and benchmark.',
    "The corpus only uses public data, and only in groups of at least 10 people. Under 18, you're not listed, nothing is submitted for you and your data isn't used.",
  ] },
  { title: 'Changing your mind', lines: [
    'Withdraw on your page any time. EarnKit stops at once.',
    'Delete your account on your page and everything of yours goes, your person row included.',
  ] },
] as const;
