/**
 * v2.9 C12: the host Worker entry. A thin wrapper over `handle` (route.ts); the Workers runtime
 * supplies `caches.default`. Local structural types only, no @cloudflare/workers-types.
 */
import { handle, type EdgeCache, type Env } from './route';

type Ctx = { waitUntil(p: Promise<unknown>): void };
const edgeCache = () => (globalThis as unknown as { caches: { default: EdgeCache } }).caches.default;

export default {
  fetch: (req: Request, env: Env, ctx: Ctx): Promise<Response> => handle(req, env, edgeCache(), (p) => ctx.waitUntil(p)),
};
