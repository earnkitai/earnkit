import { json, notAllowed, preflight } from '../../../../lib/v5/http';
import { protectedResourceMetadata, publicOrigin } from '../../../../lib/v5/oauth';

/**
 * Served at /.well-known/oauth-protected-resource and its RFC 9728 path-suffix form
 * /.well-known/oauth-protected-resource/mcp (a trailing slash on either); any other subpath is 404 (L19-9).
 */
export async function GET(request: Request, context?: { params: Promise<{ path?: string[] }> }) {
  const path = (await context?.params)?.path;
  if (path !== undefined && !(path.length === 1 && path[0] === 'mcp')) return json({ error: 'not_found' }, 404);
  return json(protectedResourceMetadata(publicOrigin(request)));
}
export const OPTIONS = preflight;
/** L19-1: every other method is 405 with Allow (HEAD is answered from GET). */
const refuse = () => notAllowed('GET, HEAD, OPTIONS');
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
