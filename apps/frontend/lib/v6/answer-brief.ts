/**
 * The brief behind one answer: the question reviewers actually ask, the record and repo facts to
 * draw on (as "Label: value" lines, never prose), the length band and the style contract. The
 * agent drafts from it; EarnKit writes no prose. Pure.
 */
import { chainName } from '../v5/chains';
import type { AnswerKind } from '../v5/program-file';
import type { BuilderRecord } from './record';

export const STYLE_CONTRACT =
  'Use the approved answer. Shorten to the limit by cutting sentences, never by paraphrasing. Never add a fact, a number or a claim that is not in the answer or the record. No em dashes, no emoji, no filler, no over-explaining. If the program asks something the bank does not cover, ask the builder once and store their answer in the record before using it.';

const QUESTIONS: Record<AnswerKind, string> = {
  one_liner: 'What is it, in one sentence?',
  problem: 'What problem do you solve, for whom, and how do they handle it today?',
  solution: 'What did you build and how does it work?',
  traction: 'What usage, revenue or signal do you have, with numbers and dates?',
  team: 'Who is on the team and what have they built before?',
  why_you: 'Why are you the ones to do this?',
  milestones: 'What will you ship in the next 3 to 6 months?',
  use_of_funds: 'What will the money pay for?',
  competitors: 'Who else does this and what is different about yours?',
  risks: 'What could stop this and how do you handle it?',
  ecosystem_fit: 'Why this ecosystem, and what of it do you use?',
  what_next: 'What happens after this program?',
  past_work: 'What have you shipped before, with links?',
  help_needed: 'What help beyond money do you need?',
};

const LENGTH: Partial<Record<AnswerKind, string>> = {
  one_liner: 'one sentence, under 140 characters',
  traction: 'two to four sentences with numbers and dates',
};
const PARAGRAPH = 'one paragraph, 60 to 120 words';

export type RepoFacts = { repo_url: string | null; live_url: string | null; chains: string[]; first_commit_at: string | null };
export type AnswerBrief = { kind: string; question: string; use: string[]; length: string; style: string };

const STAGE: Record<string, string> = { idea: 'idea', building: 'building', pre_launch: 'pre-launch', launched: 'launched' };

/** "Label: value" for each present value. */
function facts(pairs: [string, unknown][]): string[] {
  return pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${String(v)}`);
}

/** The record facts that bear on one kind, beyond the project basics every brief carries. */
function kindFacts(kind: AnswerKind, r: BuilderRecord): [string, unknown][] {
  const team = r.team.map((m) => (m.role ? `${m.name} (${m.role})` : m.name)).join(', ');
  const people: [string, unknown][] = [['Builder', r.person.name], ['Bio', r.person.bio], ['Technical', r.person.technical === undefined ? undefined : r.person.technical ? 'yes' : 'no'], ['Team', team || 'solo']];
  const traction: [string, unknown][] = [
    ['Traction line', r.traction.line_pre_launch], ['Waitlist', r.traction.waitlist], ['Revenue claim in USD, unverified', r.traction.revenue_usd_claim],
    ['Traction notes', r.traction.notes], ['Launch date', r.company.launch_date],
  ];
  const company: [string, unknown][] = [['Stage', r.company.stage && STAGE[r.company.stage]], ['Raised in USD', r.company.raised_usd], ['Raised from', r.company.raised_from]];
  switch (kind) {
    case 'traction': return traction;
    case 'team': case 'why_you': case 'past_work': return [...people, ['LinkedIn', r.person.linkedin]];
    case 'use_of_funds': case 'milestones': case 'what_next': case 'help_needed': return [...company, ['Launch date', r.company.launch_date]];
    case 'risks': case 'competitors': return company;
    default: return [];
  }
}

/** The brief for one answer kind. The current draft, when there is one, is listed so the agent revises rather than restarts. */
export function answerBrief(kind: AnswerKind, record: BuilderRecord, f: RepoFacts): AnswerBrief {
  const p = record.projects[0];
  const draft = (p?.answers[kind] ?? record.answers[kind])?.text;
  const use = facts([
    ['Project', p?.name], ['One-liner', p?.one_liner], ['Description', p?.description], ['Goals', p?.goals],
    ['Repo', f.repo_url], ['Live', f.live_url], ['Chains', f.chains.map(chainName).join(', ')], ['First commit', f.first_commit_at?.slice(0, 10)],
    ...kindFacts(kind, record),
    ['Current draft', draft],
  ]);
  return { kind, question: QUESTIONS[kind], use, length: LENGTH[kind] ?? PARAGRAPH, style: STYLE_CONTRACT };
}
