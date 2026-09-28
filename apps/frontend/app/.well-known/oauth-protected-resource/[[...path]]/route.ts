import { json, preflight } from '@/lib/earnkit/http';
import { protectedResourceMetadata, publicOrigin } from '@/lib/earnkit/oauth';

/** Served at /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/mcp. */
export const GET = (request: Request) => json(protectedResourceMetadata(publicOrigin(request)));
export const OPTIONS = preflight;
