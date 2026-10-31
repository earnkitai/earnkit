import assert from 'node:assert/strict';

/**
 * v4.8 Task 4: target B's opener (bench-find.ts openerView), the signed-out first reply of a person when programs are
 * open: what EarnKit does and the grants total, the numbered programs, then the number and the one sign-in link (last).
 * The same session again, or a number outside the list: the list in one short line (conversation.ts openerAgain).
 */
export const OPENER_HEAD = /^I'm EarnKit\. I get builders funded for what they ship(, and there's \$[\d.]+[KM]\+? in grants open right now)?\.\n\n1\. /;
const SIGNIN = String.raw`https:\/\/\S+\/signin\/[A-Za-z0-9_-]{22}`;
export const OPENER_TAIL = new RegExp(String.raw`\n\nReply with a number, and connect here so I can check if your work fits: (${SIGNIN})$`);
export const OPENER_AGAIN = new RegExp(String.raw`^Reply 1 for .+, and connect here so I can check if your work fits: (${SIGNIN})$`);

/** Asserts `s` is the opener (or, with `again`, the list again) with exactly one link, the sign-in link; returns it. */
export function assertOpener(s: string, o: { again?: boolean } = {}): string {
  const m = o.again ? OPENER_AGAIN.exec(s) : OPENER_HEAD.test(s) ? OPENER_TAIL.exec(s) : null;
  assert.ok(m, `the opener${o.again ? ' again' : ''}: ${s}`);
  assert.equal((s.match(/https?:\/\/\S+/g) ?? []).length, 1, s);
  return m[1];
}
/** The opener or the list again (an earlier find in the same session said the opener). */
export const isOpener = (s: string) => OPENER_HEAD.test(s) || OPENER_AGAIN.test(s);
