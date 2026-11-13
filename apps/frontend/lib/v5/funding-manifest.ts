/**
 * L38-1 (v6.1.18 Task 11): FLOSS/fund takes a funding manifest (funding.json, https://fundingjson.org, schema v1.1.0)
 * and its URL. EarnKit does it: the ready row says "I add the funding file to your repo, then apply.", the agent gets
 * the manifest built from the record and the repo read as an `agent_step`, writes it at the repo root, pushes, and the
 * next find reads the file and fills the `funding_json_url` field with its raw GitHub URL. Pure.
 */
import type { Program } from './program-file';
import type { RecordContext } from './prefill';
import { repoKey, type RepoFacts } from './repo-facts';

/** The form field that takes the manifest's URL. */
export const MANIFEST_FIELD = 'funding_json_url';
/** Where the manifest sits in the repo, and the file that vouches for the manifest's host on the repo's host. */
export const MANIFEST_PATH = 'funding.json';
export const WELL_KNOWN_PATH = '.well-known/funding-manifest-urls';
export const MANIFEST_SCHEMA = 'https://fundingjson.org/schema/v1.1.0.json';
/** The ready row's step, said after the money: EarnKit writes the file, then applies. */
export const MANIFEST_LINE = 'I add the funding file to your repo, then apply.';
/** L1m-4 (v6.1.22): a manifest row drafted for the builder to send (off GitHub EarnKit adds no file): what they give. */
export const MANIFEST_GIVE = 'You give your funding manifest link.';

/** Whether a program's form takes a funding manifest's URL. Pure. */
export const wantsManifest = (p: Pick<Program, 'submission_requirements'>): boolean => p.submission_requirements.some((r) => r.key === MANIFEST_FIELD);

/** "owner/repo" of a GitHub repo link in the link's own case (the key, `repoKey`, is lower-cased), or null. Pure. */
function ownerRepo(repoUrl: string | null | undefined): string | null {
  const key = repoKey(repoUrl ?? undefined);
  if (!key) return null;
  const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/i.exec(repoUrl ?? '');
  return m && `${m[1]}/${m[2]}`.toLowerCase() === key.toLowerCase() ? `${m[1]}/${m[2]}` : key;
}

/** The raw GitHub URL of the manifest at a repo's root (its default branch), or null for a link not on GitHub. Pure. */
export function manifestUrl(repoUrl: string | null | undefined): string | null {
  const key = ownerRepo(repoUrl);
  return key ? `https://raw.githubusercontent.com/${key}/HEAD/${MANIFEST_PATH}` : null;
}

type Url = { url: string; wellKnown?: string };
export type FundingManifest = {
  $schema: string;
  version: string;
  entity: { type: 'individual' | 'organisation'; role: 'owner'; name: string | null; email: string | null; description: string; webpageUrl: Url };
  projects: { guid: string; name: string; description: string | null; webpageUrl: Url; repositoryUrl: Url; licenses: string[] | null; tags: string[] | null }[];
  funding: {
    channels: { guid: string; type: 'bank'; description: string }[];
    plans: { guid: string; status: 'active'; name: string; amount: number; currency: 'USD'; frequency: 'yearly'; channels: string[] }[];
  };
};

/** What the agent writes and does on yes (the JSON's `agent_step` on a ready program). */
export type ManifestStep = {
  kind: 'funding_manifest';
  /** The files to commit, at these paths from the repo root. */
  files: [{ path: typeof MANIFEST_PATH; json: FundingManifest }, { path: typeof WELL_KNOWN_PATH; text: string }];
  /** The URL the manifest is read at once pushed: what `funding_json_url` takes. */
  url: string;
  spec: string;
  /** Manifest paths left null, which the agent fills from its sources, never invents; and always entity.name and
   *  entity.email (final fix, I3): the file is public, so the builder confirms both before it is written. */
  fill: string[];
  note: string;
};

/** M6 (v6.1.19): the fund's steps above its floor (`$10,000 minimum and multiples of $25,000 thereafter`). */
export const PLAN_STEP_USD = 25_000;

/**
 * Fix round 1 (I3): the plan's starting amount: the record's most the builder asks (`policy.max_ask_usd`), kept within
 * the program's award floor and ceiling, else the floor; null with no floor. M6 (v6.1.19): an ask at the floor stays the
 * floor; above it rounds up to the next multiple of `PLAN_STEP_USD`, never above the largest multiple within the
 * ceiling (and never below the floor). Pure.
 */
export function planAmount(p: Pick<Program, 'min_award_usd' | 'max_award_usd'>, rec: RecordContext | null): number | null {
  const floor = p.min_award_usd;
  if (floor === undefined) return null;
  const ask = rec?.record.policy.max_ask_usd;
  if (ask === undefined || ask <= floor) return floor;
  const up = Math.ceil(ask / PLAN_STEP_USD) * PLAN_STEP_USD;
  const top = p.max_award_usd === undefined ? Infinity : Math.floor(p.max_award_usd / PLAN_STEP_USD) * PLAN_STEP_USD;
  return Math.max(floor, Math.min(up, top));
}

/** A guid: lower-case letters, digits and dashes, at most 32. Pure. */
const guidOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'project';
const TAG = /^[a-z0-9-]{1,32}$/;

/**
 * The manifest step for a program that takes one, or null: the manifest is already in the repo (the read found it),
 * the project has no GitHub repo to put it in, or the repo was not read. Built from the repo read and the record only: the builder's name and
 * email from the record, the license and topics from the read; what neither holds is null and named in `fill`. The plan
 * asks the program's minimum award a year, paid by bank transfer (the fund pays to a bank account). Pure.
 */
export function manifestStep(p: Program, facts: RepoFacts, rec: RecordContext | null): ManifestStep | null {
  // Only on a repo read: with none, EarnKit cannot check the file once pushed, so the link stays the builder's.
  if (!wantsManifest(p) || facts.funding_json_url || facts.as_reported) return null;
  // Fix round 1 (M8): no award floor, no amount to start from: never a silent 0 (the spec's "any amount").
  const amount = planAmount(p, rec);
  if (amount === null) return null;
  const url = manifestUrl(facts.repo_url);
  const key = ownerRepo(facts.repo_url);
  if (!url || !key) return null;
  const repo = `https://github.com/${key}`;
  const wellKnown = `${repo}/blob/HEAD/${WELL_KNOWN_PATH}`;
  const person = rec?.record.person;
  const company = rec?.record.company.name ?? null;
  const own = rec?.projectId ? rec.record.projects.find((x) => x.id === rec.projectId) : undefined;
  const description = (own?.description ?? facts.description ?? '').trim().slice(0, 2000) || null;
  const license = facts.license && facts.license !== 'NOASSERTION' ? [`spdx:${facts.license}`] : null;
  const tags = (facts.topics ?? []).filter((t) => TAG.test(t)).slice(0, 10);
  const json: FundingManifest = {
    $schema: MANIFEST_SCHEMA,
    // Fix round 1 (M5): the manifest's version agrees with its schema.
    version: 'v1.1.0',
    entity: {
      type: company ? 'organisation' : 'individual',
      role: 'owner',
      name: company ?? person?.name ?? null,
      email: person?.email ?? null,
      description: `${company ? 'The team behind' : 'Maintainer of'} ${facts.name}.`.slice(0, 2000),
      webpageUrl: { url: repo, wellKnown },
    },
    projects: [{
      guid: guidOf(key.split('/')[1]),
      name: facts.name.slice(0, 250),
      description,
      webpageUrl: { url: repo, wellKnown },
      repositoryUrl: { url: repo, wellKnown },
      licenses: license,
      tags: tags.length > 0 ? tags : null,
    }],
    funding: {
      channels: [{ guid: 'bank', type: 'bank', description: 'Bank transfer.' }],
      plans: [{ guid: 'support', status: 'active', name: 'Project support', amount, currency: 'USD', frequency: 'yearly', channels: ['bank'] }],
    },
  };
  // Final fix (I3): the name and email go into a public repo, so both are always the builder's to confirm.
  const fill = [
    'entity.name',
    'entity.email',
    ...(description === null ? ['projects[0].description'] : []),
    ...(license === null ? ['projects[0].licenses'] : []),
    ...(tags.length === 0 ? ['projects[0].tags'] : []),
  ];
  return {
    kind: 'funding_manifest',
    files: [{ path: MANIFEST_PATH, json }, { path: WELL_KNOWN_PATH, text: `${url}\n` }],
    url,
    spec: MANIFEST_SCHEMA,
    fill,
    note: MANIFEST_NOTE,
  };
}

/** The agent's steps for a manifest step (also in the find agent note when a ready program carries one). */
export const MANIFEST_NOTE =
  'On yes, for a ready program with agent_step funding_manifest: write agent_step.files at those paths from the repo root ' +
  '(funding.json as the JSON, then the .well-known file), filling each null path in agent_step.fill from your sources (git config, ' +
  'the README, the GitHub profile; licenses as spdx:<id>, tags lower-case with dashes) or by asking the builder once, never ' +
  'inventing. The file is public: before writing it, tell the builder it names them as entity.name with the email ' +
  'entity.email (agent_step.fill always lists both) and let them change either. The plan\'s amount and yearly frequency ' +
  'are a starting value: before writing the file, tell the builder what it asks and let them change either; never ' +
  'present the amount as a fact about the builder. Commit and push, call track started for the ' +
  'program, then call find with its program_id: once the file is in the repo, funding_json_url carries agent_step.url to send.';
