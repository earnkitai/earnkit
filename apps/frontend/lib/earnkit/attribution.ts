import { createHmac } from 'node:crypto';
import { Attribution } from 'ox/erc8021';
import { EARNKIT_BUILDER_CODE } from './builder-code';
import { sql } from './db';
import { noteEvent } from './events';

/**
 * v2.12.1 spec 3 "Count future users": Base apps carry the builder's own Base code plus `earnkit`
 * (ERC-8021); Arc, Monad and Tempo apps carry an ek_<person> code in the same format, which EarnKit
 * decodes itself (builder-code.ts codesIn). Tags are read only on contracts EarnKit tracks
 * (person-score.ts counts a call as tagged only on the person's own tracked contract). The Base code
 * comes from Base's agents API, called once per person and stored (owner "Option 1"), and only with
 * EARNKIT_BASE_AGENT_CODES=on (owner setup step 2: Base's answer first).
 */
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** The person's own code, `ek_` plus 10 base32 characters, stable per person; null without a secret. */
export function personCode(builderId: number, secret = process.env.EARNKIT_AUTH_SECRET): string | null {
  if (!secret) return null;
  const mac = createHmac('sha256', secret).update(`person-code:v1:${builderId}`).digest();
  return `ek_${[...mac.subarray(0, 10)].map((b) => BASE32[b % 32]).join('')}`;
}

/** The ERC-8021 data suffix carrying `codes`. Pure. */
export const attributionSuffix = (codes: string[]) => Attribution.toDataSuffix({ codes }) as `0x${string}`;

export type BaseCodeDeps = { post: (wallet: string) => Promise<unknown> };
const realBase: BaseCodeDeps = {
  post: async (wallet) => {
    const res = await fetch('https://api.base.dev/v1/agents/builder-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'EarnKit' },
      body: JSON.stringify({ wallet }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`base.dev builder code (${res.status})`);
    return res.json();
  },
};
const CODE = /^[A-Za-z0-9_-]{2,32}$/;

/**
 * The person's Base builder code: the stored one, else asked for once with their proven wallet and
 * stored. Null when switched off, on a failed call, or when the answer has no usable code (the
 * caller then uses the person code). Never throws for the API.
 */
export async function baseBuilderCode(builderId: number, wallet: string, deps: BaseCodeDeps = realBase): Promise<string | null> {
  if (process.env.EARNKIT_BASE_AGENT_CODES !== 'on') return null;
  const [p] = await sql()<{ code: string | null }[]>`SELECT base_builder_code AS code FROM builder_profiles WHERE builder_id = ${builderId}`;
  if (!p) return null;
  if (p.code) return p.code;
  const body = (await deps.post(wallet.toLowerCase()).catch((err: unknown) => {
    console.error('[attribution] base code', err instanceof Error ? err.name : 'error');
    return null;
  })) as Record<string, unknown> | null;
  const code = [body?.code, body?.builderCode, body?.builder_code].find((x): x is string => typeof x === 'string' && CODE.test(x)) ?? null;
  if (!code) return null;
  // Set once: a second answer racing this one never replaces the first.
  const [kept] = await sql()<{ code: string }[]>`
    UPDATE builder_profiles SET base_builder_code = COALESCE(base_builder_code, ${code}) WHERE builder_id = ${builderId} RETURNING base_builder_code AS code`;
  await noteEvent('builder_code_issued', () => ({ type: 'builder_code_issued', dedupe_key: `builder_code:${builderId}`, installation_id: builderId }));
  return kept?.code ?? code;
}

export type Chain = 'base' | 'arc' | 'monad' | 'tempo';
export type AttributionLine = { codes: string[]; data_suffix: string };

/**
 * The codes and suffix for an app on `chain`: [Base code, earnkit] on Base when one is issued (the
 * person's first proven wallet asks for it), else [ek_<person>, earnkit]. Null without a secret.
 */
export async function attributionFor(builderId: number, chain: Chain, deps?: BaseCodeDeps): Promise<AttributionLine | null> {
  const mine = personCode(builderId);
  if (!mine) return null;
  let own = mine;
  if (chain === 'base') {
    const [w] = await sql()<{ wallet: string }[]>`SELECT wallet FROM person_wallets WHERE builder_id = ${builderId} ORDER BY proven_at, wallet LIMIT 1`;
    if (w) own = (await baseBuilderCode(builderId, w.wallet, deps)) ?? mine;
  }
  const codes = [own, EARNKIT_BUILDER_CODE];
  return { codes, data_suffix: attributionSuffix(codes) };
}
