/**
 * A site probe for tests: the real safeProbePage over a fake resolver and transport that answer recorded
 * pages (fixtures/sites.json, recorded 2026-11-06) and any extra pages a test passes. Unknown URLs answer
 * 404. `calls` lists every URL the transport was asked; `rdap` answers the recorded registration dates.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeProbePage } from '../../v5/safe-fetch';

type Deps = NonNullable<Parameters<typeof safeProbePage>[1]>;
type Page = { status: number; body: string; content_type?: string; location?: string };
type Recorded = { recorded_at: string; entries: Record<string, Page>; rdap: Record<string, { registered_at: string | null }> };

const REC = JSON.parse(readFileSync(join(import.meta.dirname, 'sites.json'), 'utf8')) as Recorded;
export const SITES_RECORDED_AT = REC.recorded_at;

/** A public address, so safe-fetch's address check passes without DNS. */
const PUBLIC_IP = '93.184.215.14';

export function fakeSite(extra: Record<string, Page> = {}) {
  const pages: Record<string, Page> = { ...REC.entries, ...extra };
  const calls: string[] = [];
  const resolve: NonNullable<Deps['resolve']> = async () => [{ address: PUBLIC_IP, family: 4 }];
  const transport: NonNullable<Deps['transport']> = async ({ url }) => {
    calls.push(url.href);
    const p = pages[url.href] ?? { status: 404, body: '<html><title>404: This page could not be found</title></html>' };
    const bytes = new TextEncoder().encode(p.body);
    return {
      status: p.status,
      contentType: p.content_type ?? 'text/html; charset=utf-8',
      contentLength: bytes.byteLength,
      ...(p.location && { location: p.location }),
      body: (async function* () {
        yield bytes;
      })(),
    };
  };
  const probe: typeof safeProbePage = (url, deps = {}) => safeProbePage(url, { ...deps, resolve, transport });
  return { probe, calls };
}

/** RDAP answers from the recording; an unrecorded domain throws, as an unreachable RDAP would. */
export function fakeRdap(extra: Record<string, { registered_at: string | null }> = {}) {
  const known = { ...REC.rdap, ...extra };
  const calls: string[] = [];
  const rdap = async (domain: string) => {
    calls.push(domain);
    const hit = known[domain];
    if (!hit) throw new Error('rdap: not recorded');
    return hit;
  };
  return { rdap, calls };
}
