/**
 * A client ID metadata document served by fixtures (v6.1.15 Task 14): a resolver and a transport for safeFetchJson that
 * never touch the network and record every request, so a test can see a redirect was not followed.
 */
import type { Resolver, Transport } from '../safe-fetch';

export type CimdResponse = {
  status?: number;
  contentType?: string;
  location?: string;
  /** The body: a value is sent as JSON, a string as is. */
  body?: unknown;
  /** Sends no content-length, so only the streamed byte count can refuse it. */
  noLength?: boolean;
  /** Never answers until the fetch is aborted. */
  stall?: boolean;
};

export function cimdFixture(response: CimdResponse | ((url: URL) => CimdResponse), address = '93.184.216.34') {
  const requests: string[] = [];
  const resolves: string[] = [];
  const resolve: Resolver = async (host) => {
    resolves.push(host);
    return [{ address, family: address.includes(':') ? 6 : 4 }];
  };
  const transport: Transport = async ({ url, signal }) => {
    requests.push(url.href);
    const r = typeof response === 'function' ? response(url) : response;
    if (r.stall)
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    const bytes = Buffer.from(text);
    return {
      status: r.status ?? 200,
      ...(!r.noLength && { contentLength: bytes.byteLength }),
      contentType: r.contentType ?? 'application/json',
      ...(r.location && { location: r.location }),
      body: (async function* () {
        yield new Uint8Array(bytes);
      })(),
    };
  };
  return { resolve, transport, requests, resolves };
}
