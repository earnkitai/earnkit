import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProgramFile } from '../program-file';
import { programCard } from '../programs';
import { STARTERS, type Starter } from '../starters';
import type { Card, FreshOn } from '../present';

/**
 * v2.11 T7: the starter registry with arc-tipjar tested on 2026-10-09, for tests pinned to
 * 2026-10-10 (the real registry's test passed on 2026-10-11, after that clock).
 */
export const TESTED_STARTERS: Record<string, Starter> = {
  'arc-tipjar': { ...STARTERS['arc-tipjar'], tested_at: '2026-10-09' },
};

/** Deploys and hosting on, a client that builds, and the tested registry. */
export const FRESH_ON: FreshOn = { deployOn: () => true, hostOn: true, canBuild: true, starters: TESTED_STARTERS };

/**
 * Every committed curated program file as find's card, with its real dates (programs.ts
 * programCard), so the pick rules run against today's catalogue. No pools, no campaign.
 */
export function fileCards(): Card[] {
  const dir = join(import.meta.dirname, '../../../../../programs');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ProgramFile.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))))
    .filter((p) => !p.campaign)
    .map((p) =>
      programCard(
        {
          ...p,
          logo: p.logo ?? null,
          focus: p.focus ?? null,
          best_bet: p.best_bet ?? null,
          winners_per_round: p.winners_per_round ?? null,
          tag: p.tag ?? null,
          campaign: null,
          ends_at: p.ends_at ? new Date(p.ends_at) : null,
          starts_at: p.starts_at ? new Date(p.starts_at) : null,
          verified_at: new Date(p.verified_at),
          created_at: new Date('2026-09-01T00:00:00Z'),
          opened_at: null,
          source: 'file',
          max_award_usd: p.max_award_usd == null ? null : String(p.max_award_usd),
          pool_usd: p.pool_usd == null ? null : String(p.pool_usd),
          min_award_usd: p.min_award_usd == null ? null : String(p.min_award_usd),
          needs_repo: p.needs_repo ?? null,
        },
        [],
      ),
    );
}

/** The cards with no fresh_build anywhere (the catalogue before the T6 follow-up tagged Arc). */
export const withoutFreshBuild = (cards: Card[]): Card[] => cards.map((c) => ({ ...c, fresh_build: null }));

/** The cards with `fresh_build: { starter }` set on the given program ids (the fixture's tag only). */
export const withFreshBuild = (cards: Card[], ids: string[], starter = 'arc-tipjar'): Card[] =>
  cards.map((c) => (ids.includes(c.id) ? { ...c, fresh_build: { starter } } : c));
