import { AwsClient } from 'aws4fetch';
import { FreeTierFull, takeFreeTier } from './free-tier';

/**
 * v2.9 C12: the R2 bucket the host Worker serves, written only by the server (EarnKit's key never
 * reaches an agent). An S3 client signed with aws4fetch. Off unless all four variables are set.
 *
 * Every Class A call (put, copy, one list page) is taken from the free-tier counter first
 * (`takeFreeTier('r2Writes', 1)`) and throws FreeTierFull when refused, so R2 never bills. Deletes
 * are free on R2 (DeleteObject), so they take nothing.
 *
 * Errors carry the operation and the HTTP status only: never a key, a secret or a signature.
 */

type Env = Record<string, string | undefined>;
const VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;

export function r2Enabled(env: Env = process.env): boolean {
  return VARS.every((k) => Boolean(env[k]?.trim()));
}

export type R2 = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Every key under the prefix. */
  list(prefix: string): Promise<string[]>;
  del(keys: string[]): Promise<void>;
  /** Server-side copy (CopyObject, Class A): approval moves a staged site into place. */
  copy(from: string, to: string): Promise<void>;
};

/** A failed R2 call: the operation and status, nothing else. */
export class R2Error extends Error {
  constructor(op: string, status: number | string) {
    super(`R2 ${op} failed (${status})`);
    this.name = 'R2Error';
  }
}

const TIMEOUT_MS = 20_000;
/** A site has at most 500 files; 10 pages of 1,000 is far past any real prefix. */
const MAX_LIST_PAGES = 10;
const DELETE_CONCURRENCY = 8;

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');
const xmlText = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_m, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]!);

async function take() {
  if (!(await takeFreeTier('r2Writes', 1))) throw new FreeTierFull('r2Writes');
}

export function r2Client(env: Env = process.env): R2 {
  if (!r2Enabled(env)) throw new Error('R2 is not configured');
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
    service: 's3',
    region: 'auto',
  });
  const bucket = encodeURIComponent(env.R2_BUCKET!.trim());
  const base = `https://${env.R2_ACCOUNT_ID!.trim()}.r2.cloudflarestorage.com/${bucket}`;
  const call = async (op: string, url: string, init: RequestInit) => {
    let res: Response;
    try {
      res = await aws.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new R2Error(op, err instanceof Error ? err.name : 'error');
    }
    if (!res.ok && !(op === 'delete' && res.status === 404)) {
      await res.body?.cancel().catch(() => {});
      throw new R2Error(op, res.status);
    }
    return res;
  };
  return {
    async put(key, body, contentType) {
      await take();
      const res = await call('put', `${base}/${encodeKey(key)}`, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': contentType, 'Content-Length': String(body.byteLength) },
      });
      await res.body?.cancel().catch(() => {});
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | null = null;
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        await take();
        const q = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
        if (token) q.set('continuation-token', token);
        const xml = await (await call('list', `${base}?${q}`, { method: 'GET' })).text();
        for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlText(m[1]));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]*)</)?.[1] ?? null) : null;
        if (!token) return keys;
        token = xmlText(token);
      }
      throw new R2Error('list', 'too many keys');
    },
    async copy(from, to) {
      await take();
      const res = await call('copy', `${base}/${encodeKey(to)}`, {
        method: 'PUT',
        headers: { 'x-amz-copy-source': `/${bucket}/${encodeKey(from)}` },
      });
      // S3 can answer a failed copy with a 200 and an <Error> body.
      const body = await res.text();
      if (/<Error>/.test(body)) throw new R2Error('copy', 'error');
    },
    async del(keys) {
      for (let i = 0; i < keys.length; i += DELETE_CONCURRENCY)
        await Promise.all(
          keys.slice(i, i + DELETE_CONCURRENCY).map(async (key) => {
            const res = await call('delete', `${base}/${encodeKey(key)}`, { method: 'DELETE' });
            await res.body?.cancel().catch(() => {});
          }),
        );
    },
  };
}
