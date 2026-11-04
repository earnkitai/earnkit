import { json, preflight } from '@/lib/v5/http';
import { authorizationServerMetadata, publicOrigin } from '@/lib/v5/oauth';

export const GET = (request: Request) => json(authorizationServerMetadata(publicOrigin(request)));
export const OPTIONS = preflight;
