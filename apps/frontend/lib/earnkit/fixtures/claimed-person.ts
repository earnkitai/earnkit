import { randomBytes } from 'node:crypto';
import { bindX } from '../claim';
import { connectInstallation, saveInstallation } from '../installations';
import { ensureProfile } from '../profiles';
import type { XUser } from '../x-oauth';

/**
 * v2.13 T11: a person claimed with X, as claim.test.ts's first-claim case makes one: an installation,
 * its profile, and the first bindX. The X id and handle are unique per call (the shared DB keeps them).
 */
export async function claimedPerson(o: { avatar?: string | null; now?: Date } = {}): Promise<{ root: number; user: XUser }> {
  const now = o.now ?? new Date();
  const token = `ek_test_${process.pid}-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await saveInstallation(token, undefined, false);
  const c = (await connectInstallation(token))!;
  await ensureProfile(c.own, now);
  const tag = randomBytes(5).toString('hex');
  const user: XUser = { id: `cp${tag}`, username: `cp_${tag}`, name: 'Claimed', avatar: o.avatar ?? null };
  const r = await bindX(c.own, user, now);
  if (!r.ok) throw new Error(`claimedPerson: ${r.reason}`);
  return { root: r.root, user };
}
