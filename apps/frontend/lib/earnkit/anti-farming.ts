import type { Outcome } from './score';

/**
 * v2.12 spec 5: what counts as a user and as money, applied before the formula. Every rule is
 * strict from day one (only the calibration bars are generous); an unknown fact counts as the
 * stricter case (plan R12). Weights multiply: spread x fresh x ring. Pure.
 */
export const RULES = {
  feeCap: 0.1,
  minDays: 3,
  burstShare: 0.5,
  burstWeight: 0.25,
  freshGithubDays: 30,
  freshWalletDays: 7,
  freshWeight: 0.5,
  ringWeight: 0.5,
  clusterMin: 5,
  clusterCap: 5,
} as const;

export type ActorKind = 'wallet' | 'github';
export type TouchKind = 'caller' | 'stargazer' | 'forker' | 'issue_author' | 'contributor';
export type Touch = { project: string; actor: string; kind: TouchKind; at: Date; fee_usd?: number; volume_usd?: number };
export type ActorFacts = { created_at?: Date | null; first_tx_at?: Date | null };
export type FarmCtx = {
  self: ReadonlySet<string>;
  actors: ReadonlyMap<string, ActorFacts>;
  ring: ReadonlyMap<string, number>;
  /** Ring actor -> the partner person who owns it, so a partner counts once per project. */
  ringOwner?: ReadonlyMap<string, number>;
  clusterCap?: { actors: ReadonlySet<string>; cap: number };
};
export type Counted = { project: string; users: number; fees_usd: number; volume_usd: number; outcomes: Outcome[]; actors: Map<string, number> };

const DAY_MS = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** Money inputs reach the scorer finite: NaN, Infinity and negatives count 0. */
const nonNeg = (n: number | undefined) => (Number.isFinite(n) && n! > 0 ? n! : 0);
const isWallet = (actor: string) => actor.startsWith('wallet:');

function freshWeight(actor: string, at: Date, facts: ActorFacts | undefined): number {
  if (isWallet(actor)) {
    const first = facts?.first_tx_at;
    if (!first || !Number.isFinite(first.getTime())) return RULES.freshWeight;
    const gap = at.getTime() - first.getTime();
    if (gap < 0) return RULES.freshWeight; // a first transaction after the call is impossible data: unknown
    return gap <= RULES.freshWalletDays * DAY_MS ? RULES.freshWeight : 1;
  }
  const created = facts?.created_at;
  if (!created || !Number.isFinite(created.getTime())) return RULES.freshWeight;
  return at.getTime() - created.getTime() < RULES.freshGithubDays * DAY_MS ? RULES.freshWeight : 1;
}

/** One project's counted users and money after every rule. */
export function countProject(project: string, touches: Touch[], ctx: FarmCtx): Counted {
  // Actor ids are case-insensitive: lowercase every id once.
  const lc = <T>(m: ReadonlyMap<string, T>) => new Map([...m].map(([k, v]) => [k.toLowerCase(), v] as [string, T]));
  const self = new Set([...ctx.self].map((a) => a.toLowerCase()));
  const known = lc(ctx.actors);
  const ring = lc(ctx.ring);
  const ringOwner = ctx.ringOwner && lc(ctx.ringOwner);
  const cluster = ctx.clusterCap && { cap: ctx.clusterCap.cap, actors: new Set([...ctx.clusterCap.actors].map((a) => a.toLowerCase())) };
  // Self-exclusion, then one per account (earliest touch; its money summed per account).
  const first = new Map<string, Touch>();
  const fee = new Map<string, number>();
  const vol = new Map<string, number>();
  for (const raw of touches) {
    const t = { ...raw, actor: raw.actor.toLowerCase() };
    if (t.project !== project || self.has(t.actor) || !Number.isFinite(t.at.getTime())) continue;
    const seen = first.get(t.actor);
    if (!seen || t.at < seen.at) first.set(t.actor, t);
    fee.set(t.actor, (fee.get(t.actor) ?? 0) + nonNeg(t.fee_usd));
    vol.set(t.actor, (vol.get(t.actor) ?? 0) + nonNeg(t.volume_usd));
  }
  // Spread, onchain callers only.
  const callers = [...first.values()].filter((t) => t.kind === 'caller');
  const byDay = new Map<string, number>();
  for (const t of callers) byDay.set(dayOf(t.at), (byDay.get(dayOf(t.at)) ?? 0) + 1);
  const burstDay = [...byDay].find(([, n]) => n > RULES.burstShare * callers.length)?.[0];
  const spread = (t: Touch) => (t.kind !== 'caller' ? 1 : byDay.size < RULES.minDays ? 0 : dayOf(t.at) === burstDay ? RULES.burstWeight : 1);

  const actors = new Map<string, number>();
  for (const [actor, t] of first) {
    const w = spread(t) * freshWeight(actor, t.at, known.get(actor)) * (ring.get(actor) ?? 1);
    actors.set(actor, w);
  }
  // A ring partner counts once per project: only their best-weighted account keeps credit.
  if (ringOwner) {
    const best = new Map<number, [string, number]>();
    for (const [a, w] of actors) {
      const who = ringOwner.get(a);
      if (who === undefined) continue;
      const b = best.get(who);
      if (!b || w > b[1]) best.set(who, [a, w]);
    }
    for (const [a] of actors) {
      const who = ringOwner.get(a);
      if (who !== undefined && best.get(who)![0] !== a) actors.set(a, 0);
    }
  }
  // Cluster cap: in-cluster credit at most `cap`, scaled down evenly.
  if (cluster) {
    const inCluster = [...actors].filter(([a]) => cluster.actors.has(a));
    const sum = inCluster.reduce((n, [, w]) => n + w, 0);
    if (sum > cluster.cap) for (const [a, w] of inCluster) actors.set(a, (w * cluster.cap) / sum);
  }
  // Money: per-account cap at 10% of the project's (self-excluded) total, weighted like the account.
  const capped = (m: Map<string, number>) => {
    const total = [...m.values()].reduce((n, x) => n + x, 0);
    let out = 0;
    for (const [a, x] of m) out += Math.min(x, RULES.feeCap * total) * (actors.get(a) ?? 0);
    return out;
  };
  const users = [...actors.values()].reduce((n, w) => n + w, 0);
  const outcomes: Outcome[] = [...first].map(([a, t]) => ({ at: t.at, weight: actors.get(a) ?? 0 })).filter((o) => o.weight > 0);
  return { project, users, fees_usd: capped(fee), volume_usd: capped(vol), outcomes, actors };
}

export const moneyOf = (c: Pick<Counted, 'fees_usd' | 'volume_usd'>) => c.fees_usd + 0.01 * c.volume_usd;

/**
 * Rings (spec 5). `edges`: [counter, counted] person pairs (an account of `counter` counts as a user
 * of `counted`). For `person`: each actor of someone in a mutual pair with them weighs 0.5; when
 * the mutual-pair component holding them has 5+ people, their in-cluster credit is capped at 5.
 * `owner` maps actor ids to the person who owns them (verified wallets and logins). Pure.
 */
export function ringWeights(edges: Array<[counter: number, counted: number]>, person: number, owner: ReadonlyMap<string, number>): Pick<FarmCtx, 'ring' | 'ringOwner' | 'clusterCap'> {
  const has = new Set(edges.map(([a, b]) => `${a}>${b}`));
  const mutual = new Map<number, Set<number>>();
  for (const [a, b] of edges)
    if (a !== b && has.has(`${b}>${a}`)) {
      if (!mutual.has(a)) mutual.set(a, new Set());
      mutual.get(a)!.add(b);
    }
  const partners = mutual.get(person) ?? new Set<number>();
  // The connected component of `person` in the mutual graph.
  const comp = new Set<number>([person]);
  const queue = [person];
  while (queue.length) for (const n of mutual.get(queue.shift()!) ?? []) if (!comp.has(n)) (comp.add(n), queue.push(n));
  const ring = new Map<string, number>();
  const ringOwner = new Map<string, number>();
  const clusterActors = new Set<string>();
  for (const [actor, who] of owner) {
    const id = actor.toLowerCase();
    if (partners.has(who)) (ring.set(id, RULES.ringWeight), ringOwner.set(id, who));
    if (who !== person && comp.has(who)) clusterActors.add(id);
  }
  return { ring, ringOwner, ...(comp.size >= RULES.clusterMin && { clusterCap: { actors: clusterActors, cap: RULES.clusterCap } }) };
}
