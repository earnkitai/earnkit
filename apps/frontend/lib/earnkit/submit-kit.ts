import type { ProgramRow } from './programs';

/**
 * v2.8 Part E (spec) and Rulings 27-28 (plan): the hand-off to the program's own form. Returned
 * ONLY by confirm_entry, after the builder passed the confirmation (the owner's ordering rule).
 * Task 8 builds the copy_paste kit; Task 10 adds the prefilled link, agent filling and the api modes.
 * Pure.
 */

export type SubmitMode = 'prefilled_link' | 'agent_fills' | 'copy_paste' | 'api';
export type KitField = { key: string; label: string; answer: string };
export type SubmitKit = {
  mode: SubmitMode;
  /** The program's submission_url. */
  url: string;
  /** Task 10. */
  prefilled_url?: string;
  /** Every answer, in form order. */
  fields: KitField[];
  /** The fields the builder (or agent) still enters by hand. */
  paste: KitField[];
  /** Task 10. */
  agent_steps?: string[];
  /** Task 10. */
  api?: { platform: 'superteam' | 'karma'; payload: Record<string, string> };
  proof: { kind: 'entry_link' | 'confirmation'; ask: string };
  show_to_builder: string;
};

/** Ruling 8 (plan): a public form's field ids, read once at listing (Task 10 fills it in). */
export type ProgramForm = {
  url: string;
  fields: Record<string, string>;
  sign_in?: boolean;
  read_at?: string;
};

export type KitProgram = Pick<ProgramRow, 'submission_url' | 'submission_requirements' | 'title'> & {
  submit_host?: string | null;
  submit_api?: boolean;
  form?: ProgramForm | null;
};

/** Ruling 28 (plan): hosts that give each entry a public page, so the proof is its link. */
const ENTRY_LINK_HOSTS = new Set([
  'dorahacks.io',
  'ethglobal.com',
  'devfolio.co',
  'colosseum.com',
  'arena.colosseum.org',
  'app.akindo.io',
  'taikai.network',
  'gap.karmahq.xyz',
]);

export const ENTRY_LINK_ASK = 'After you submit, paste your entry link here.';
export const CONFIRMATION_ASK = 'After you submit, send me the confirmation screenshot or email.';

/** The form's host ("dorahacks.io"), from submit_host or submission_url; '' when unknown. Pure. */
export function submitHost(p: Pick<KitProgram, 'submission_url' | 'submit_host'>): string {
  const raw = p.submit_host?.trim() || (URL.canParse(p.submission_url) ? new URL(p.submission_url).hostname : '');
  return raw.toLowerCase().replace(/^www\./, '');
}

/** Ruling 28 (plan): how the builder proves the entry once submitted. Pure. */
export function proofFor(host: string): SubmitKit['proof'] {
  return ENTRY_LINK_HOSTS.has(host) ? { kind: 'entry_link', ask: ENTRY_LINK_ASK } : { kind: 'confirmation', ask: CONFIRMATION_ASK };
}

/**
 * The kit for one confirmed entry. `answers`: every answer by requirement key (the agent's answers
 * plus what the project info fills in). Fields follow the form's own order and labels; empty answers
 * are left out. Task 8: always copy_paste (`agent.browser` is used from Task 10). Pure.
 */
export function submitKit(program: KitProgram, answers: Record<string, string>, agent: { browser: boolean }): SubmitKit {
  void agent; // Task 10: agent_fills needs agent.browser; Task 8 always returns copy_paste.
  const fields: KitField[] = program.submission_requirements.flatMap((r) => {
    const answer = answers[r.key]?.trim();
    return answer ? [{ key: r.key, label: r.label, answer }] : [];
  });
  const proof = proofFor(submitHost(program));
  const list = fields.map((f) => `${f.label}\n${f.answer}`).join('\n\n');
  const show_to_builder = [
    `Ready for ${program.title}. Paste each answer into the form:`,
    `Form: ${program.submission_url}`,
    ...(list ? [`\n${list}`] : []),
    `\n${proof.ask}`,
  ].join('\n');
  return { mode: 'copy_paste', url: program.submission_url, fields, paste: fields, proof, show_to_builder };
}
