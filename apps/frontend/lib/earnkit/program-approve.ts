import { brandShell } from './brand-page';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { approveExpired, approveTarget, type ApproveTarget } from './program-pending';
import { approveWrite, programsApiOn, type WriteDeps } from './programs-api';

/**
 * v4.10.1 Task 4 (R4): the owner's approve link for a pending program write (program-pending.ts). GET checks the token
 * and shows the write with one button; it changes nothing (mail scanners open links). Only the button's POST approves.
 * The page's only link and form action are EarnKit's own relative paths (the token is re-encoded), never a URL from the request, so it can't
 * redirect anywhere. The pending body is shown as escaped text, never as a link or markup. Every failure is one plain
 * line. Off (404) while the programs API is off.
 */

export const APPROVE_TEXT = {
  title: 'Approve this program?',
  note: 'It goes live on EarnKit when you approve. Check the links first.',
  button: 'Approve',
  bad: 'This link is not valid.',
  expired: 'This link has expired. Ask the bot to send the program again.',
  done: 'This write was already handled.',
  superseded: 'A newer write for this program came in, so this one was not applied.',
  approved: 'Approved. The program is live.',
  refused: 'This write no longer passes the checks, so nothing changed:',
  busy: 'EarnKit is busy. Try again in a minute.',
} as const;

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
  'X-Frame-Options': 'DENY',
  // No script runs here; the one form posts back to EarnKit; nobody can frame the button.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
/** v4.10.2 Task 4: the owner link pages (approve, revert) share the page, the line and the 404. */
export const page = (inner: string, status = 200) => new Response(brandShell(inner), { status, headers: PAGE_HEADERS });
export const line = (text: string, status: number) => page(`<p class="ek-line ek-first">${escapeHtml(text)}</p>`, status);
export const notFound = () => new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

const tokenOf = (request: Request) => new URL(request.url).searchParams.get('t') ?? '';

/** The token's write, or the failure page. The signature is checked before any database read. */
function check(token: string, now: Date): { t: ApproveTarget } | { fail: Response } {
  const t = approveTarget(token);
  if (!t) return { fail: line(APPROVE_TEXT.bad, 400) };
  if (approveExpired(t, now)) return { fail: line(APPROVE_TEXT.expired, 410) };
  return { t };
}

/** GET /api/programs/approve?t=: the confirm page. */
export async function programApproveGet(request: Request, now = new Date()): Promise<Response> {
  if (!programsApiOn()) return notFound();
  const token = tokenOf(request);
  const c = check(token, now);
  if ('fail' in c) return c.fail;
  try {
    const [w] = await sql()<{ result: string; action: string; body: unknown }[]>`
      SELECT result, action, body FROM program_writes WHERE id = ${c.t.writeId}`;
    if (!w || w.action !== 'upsert') return line(APPROVE_TEXT.bad, 400);
    if (w.result !== 'pending') return line(w.result === 'superseded' ? APPROVE_TEXT.superseded : APPROVE_TEXT.done, 409);
    const parsed = ProgramFile.safeParse(w.body);
    if (!parsed.success) return line(APPROVE_TEXT.bad, 400);
    const p = parsed.data;
    const rows = [
      ['Program', `${p.title} (${p.id})`],
      ['Organizer', p.organizer],
      ['Submission link', p.submission_url],
      ['Source page', p.source_url],
      ['Reward', p.summary],
    ];
    return page(
      `<h1>${escapeHtml(APPROVE_TEXT.title)}</h1>` +
        rows.map(([k, v]) => `<p class="ek-line">${escapeHtml(k!)}: ${escapeHtml(v!)}</p>`).join('') +
        `<p class="ek-line">${escapeHtml(APPROVE_TEXT.note)}</p>` +
        `<div class="ek-actions"><form method="post" action="${escapeHtml(`/api/programs/approve?t=${encodeURIComponent(token)}`)}">` +
        `<button class="ek-btn" type="submit">${escapeHtml(APPROVE_TEXT.button)}</button></form></div>`,
    );
  } catch (err) {
    console.error('[program-approve] page failed', (err as { name?: string } | null)?.name ?? 'unknown');
    return line(APPROVE_TEXT.busy, 503);
  }
}

/** POST /api/programs/approve?t=: the approval. Single use: a replay finds the write no longer pending. */
export async function programApprovePost(
  request: Request,
  deps: Omit<WriteDeps, 'limit' | 'afterRead' | 'mailer'> = {},
): Promise<Response> {
  if (!programsApiOn()) return notFound();
  const now = deps.now ?? new Date();
  const c = check(tokenOf(request), now);
  if ('fail' in c) return c.fail;
  try {
    const out = await approveWrite(c.t.writeId, { ...deps, now });
    if (out.kind === 'applied') return line(APPROVE_TEXT.approved, 200);
    if (out.kind === 'refused')
      return page(
        `<p class="ek-line ek-first">${escapeHtml(APPROVE_TEXT.refused)}</p>` +
          out.problems.slice(0, 10).map((x) => `<p class="ek-line">${escapeHtml(x)}</p>`).join(''),
        400,
      );
    if (out.state === 'missing') return line(APPROVE_TEXT.bad, 400);
    return line(out.state === 'superseded' ? APPROVE_TEXT.superseded : APPROVE_TEXT.done, 409);
  } catch (err) {
    console.error('[program-approve] approve failed', (err as { name?: string } | null)?.name ?? 'unknown');
    return line(APPROVE_TEXT.busy, 503);
  }
}
