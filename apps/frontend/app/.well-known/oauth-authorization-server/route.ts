import { json, notAllowed, preflight } from '../../../lib/v5/http';
import { authorizationServerMetadata, publicOrigin } from '../../../lib/v5/oauth';

export const GET = (request: Request) => json(authorizationServerMetadata(publicOrigin(request)));
export const OPTIONS = preflight;
/** L19-1: every other method is 405 with Allow (HEAD is answered from GET). */
const refuse = () => notAllowed('GET, HEAD, OPTIONS', true);
export const POST = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
