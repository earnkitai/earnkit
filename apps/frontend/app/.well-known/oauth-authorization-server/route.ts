import { json, preflight } from '@/lib/earnkit/http';
import { authorizationServerMetadata, publicOrigin } from '@/lib/earnkit/oauth';

export const GET = (request: Request) => json(authorizationServerMetadata(publicOrigin(request)));
export const OPTIONS = preflight;
