import { escapeHtml, line, page } from './program-approve';
import { revertExpired, revertPreview, revertTarget, revertWrite, type NotRevertable, type RevertDeps, type RevertTarget } from './program-revert';

/**
 * v4.10.2 Task 4 (R7): the owner's revert link from the daily digest (program-revert.ts). GET checks the token and
 * shows what the revert does, with one button; it changes nothing (mail scanners open links). Only the button's POST
 * reverts, once. The approve page's shell, headers (no-store, no framing, no script) and escaping (program-approve.ts);
 * the form posts to EarnKit's own relative path. Every failure is one plain line. The signed token alone decides, so
 * the link works while the programs API is switched off (the owner's way back from a bad write).
 */

export const REVERT_TEXT = {
  title: 'Revert this change?',
  undo: 'The program goes back to how it was before this change.',
  close: 'This change created the program, so reverting closes it.',
  reopen: 'This change closed the program, so reverting re-opens it as it was before.',
  /** Fix round 1: the bot's later unlisted edits go with the revert. */
  alsoUndoes: (n: number) => `This also undoes ${n} later edit${n === 1 ? '' : 's'} to this program.`,
  button: 'Revert',
  bad: 'This link is not valid.',
  expired: 'This link has expired. Change the program with the bot instead.',
  done: 'This change was already reverted.',
  superseded: 'A later change replaced this one, so it can no longer be reverted. Revert the later one.',
  curated: 'EarnKit curates this program now, so the bot change is gone already.',
  noEarlier: "EarnKit has no earlier copy of this program, so it can't revert this change.",
  reverted: 'Reverted. The program is back to how it was.',
  closed: 'Reverted. The program is closed.',
  busy: 'EarnKit is busy. Try again in a minute.',
} as const;

const NO: Record<NotRevertable, [string, number]> = {
  missing: [REVERT_TEXT.bad, 400],
  done: [REVERT_TEXT.done, 409],
  superseded: [REVERT_TEXT.superseded, 409],
  curated: [REVERT_TEXT.curated, 409],
  no_earlier: [REVERT_TEXT.noEarlier, 409],
};
const no = (state: NotRevertable) => line(...NO[state]);

const tokenOf = (request: Request) => new URL(request.url).searchParams.get('t') ?? '';

/** The token's write, or the failure page. The signature is checked before any database read. */
function check(token: string, now: Date): { t: RevertTarget } | { fail: Response } {
  const t = revertTarget(token);
  if (!t) return { fail: line(REVERT_TEXT.bad, 400) };
  if (revertExpired(t, now)) return { fail: line(REVERT_TEXT.expired, 410) };
  return { t };
}

/** GET /api/programs/revert?t=: the confirm page. */
export async function programRevertGet(request: Request, now = new Date(), programsDir?: string | null): Promise<Response> {
  const token = tokenOf(request);
  const c = check(token, now);
  if ('fail' in c) return c.fail;
  try {
    const p = await revertPreview(c.t.writeId, programsDir);
    if (p.kind === 'no') return no(p.state);
    return page(
      `<h1>${escapeHtml(REVERT_TEXT.title)}</h1>` +
        `<p class="ek-line">${escapeHtml(`Program: ${p.title} (${p.id})`)}</p>` +
        (p.line ? `<p class="ek-line">${escapeHtml(`Change: ${p.line}`)}</p>` : '') +
        `<p class="ek-line">${escapeHtml(p.does === 'close' ? REVERT_TEXT.close : p.does === 'reopen' ? REVERT_TEXT.reopen : REVERT_TEXT.undo)}</p>` +
        (p.laterEdits > 0 ? `<p class="ek-line">${escapeHtml(REVERT_TEXT.alsoUndoes(p.laterEdits))}</p>` : '') +
        `<div class="ek-actions"><form method="post" action="${escapeHtml(`/api/programs/revert?t=${encodeURIComponent(token)}`)}">` +
        `<button class="ek-btn" type="submit">${escapeHtml(REVERT_TEXT.button)}</button></form></div>`,
    );
  } catch (err) {
    console.error('[program-revert] page failed', (err as { name?: string } | null)?.name ?? 'unknown');
    return line(REVERT_TEXT.busy, 503);
  }
}

/** POST /api/programs/revert?t=: the revert. Single use: a replay finds the revert row and does nothing. */
export async function programRevertPost(request: Request, deps: RevertDeps = {}): Promise<Response> {
  const now = deps.now ?? new Date();
  const c = check(tokenOf(request), now);
  if ('fail' in c) return c.fail;
  try {
    const out = await revertWrite(c.t.writeId, deps);
    if (out.kind === 'no') return no(out.state);
    return line(out.closed ? REVERT_TEXT.closed : REVERT_TEXT.reverted, 200);
  } catch (err) {
    console.error('[program-revert] revert failed', (err as { name?: string } | null)?.name ?? 'unknown');
    return line(REVERT_TEXT.busy, 503);
  }
}
