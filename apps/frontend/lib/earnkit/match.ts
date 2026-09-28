import { CHAIN_NAMES, type Chain, type Detection } from './chains';

/**
 * Matching a builder's public repos to open programs. Pure: the GitHub facts come in,
 * verdicts come out. Evidence is shown, and anything it can't confirm becomes a "check".
 */
export type RepoFacts = {
  name: string;
  url: string;
  homepage: string | null;
  created_at: string;
  chains: Detection;
  /** Program id -> whether the repo has commits inside that program's build window. */
  commits_in_window: Record<string, boolean>;
};

export type ProgramFacts = {
  id: string;
  title: string;
  chains: Chain[];
  existing_work: 'allowed' | 'new_work_only' | 'unknown';
  tag: string | null;
  starts_at: Date | null;
};

export type Verdict = {
  program_id: string;
  program: string;
  status: 'likely' | 'after_step' | 'no';
  /** What still has to happen (after_step) or be confirmed (likely), in a few words. */
  note: string | null;
};

const day = (d: Date) =>
  d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export function matchRepo(
  repo: RepoFacts,
  programs: ProgramFacts[],
): Verdict[] {
  const verdicts: Verdict[] = [];
  for (const p of programs) {
    const chain = p.chains.find((c) => repo.chains[c]);
    if (!chain) continue;
    const signal = repo.chains[chain]!;
    const name = CHAIN_NAMES[chain];
    const v = (status: Verdict['status'], note: string | null) =>
      verdicts.push({ program_id: p.id, program: p.title, status, note });

    if (p.existing_work === 'new_work_only') {
      // Existing code doesn't count here; an active repo can only enter with new work.
      const since = p.starts_at ? ` since ${day(p.starts_at)}` : '';
      if (p.starts_at && !repo.commits_in_window[p.id])
        v('no', `no commits${since}; only new work counts`);
      else v('after_step', `new work${since} (only that counts)`);
      continue;
    }

    if (p.tag === 'needs a live product') {
      if (!repo.homepage) v('after_step', 'a live product with users');
      else v('likely', 'check: it has real users');
      continue;
    }

    // Existing work allowed and the project must be live on the chain.
    const steps = [
      !signal.mainnet && `deploy to ${name} mainnet`,
      !repo.homepage && 'a live link',
    ].filter(Boolean) as string[];
    if (steps.length > 0) v('after_step', steps.join(' + '));
    else
      v(
        'likely',
        p.existing_work === 'unknown'
          ? 'check: existing work is allowed'
          : `check: working on ${name} mainnet`,
      );
  }
  return verdicts;
}

export function presentMatches(
  user: string | null,
  checked: number,
  results: { repo: RepoFacts; verdicts: Verdict[] }[],
) {
  const who = user ? ` by @${user}` : '';
  const order = { likely: 0, after_step: 1, no: 2 };
  // Builders want what can earn; "no" verdicts stay in the data but not in the text.
  const earning = results
    .map((r) => ({
      ...r,
      verdicts: r.verdicts.filter((v) => v.status !== 'no'),
    }))
    .filter((r) => r.verdicts.length > 0)
    .sort(
      (a, b) =>
        Math.min(...a.verdicts.map((v) => order[v.status])) -
        Math.min(...b.verdicts.map((v) => order[v.status])),
    );

  if (earning.length === 0) {
    return (
      `None of the ${checked} public repos${who} I checked can earn from an open program as-is.\n\n` +
      'Want me to build something for one instead?'
    );
  }

  const blocks = earning.map(({ repo, verdicts }) => {
    const nets = Object.entries(repo.chains)
      .map(
        ([c, s]) =>
          `${CHAIN_NAMES[c as Chain]} ${s!.mainnet ? 'mainnet' : 'testnet'}`,
      )
      .join(', ');
    const lines = [...verdicts]
      .sort((a, b) => order[a.status] - order[b.status])
      .map(
        (v) =>
          `${v.program}: ${v.status === 'likely' ? `likely qualifies${v.note ? ` · ${v.note}` : ''}` : `after one step: ${v.note}`}`,
      );
    return [`**${repo.name}** (${nets})`, ...lines].join('\n');
  });

  return [
    `Checked ${checked} public repos${who}. ${earning.length} could earn:`,
    ...blocks,
    "Want me to prepare the ones that qualify? I'll ask each personal detail once. (Private repos aren't included.)",
  ].join('\n\n');
}
