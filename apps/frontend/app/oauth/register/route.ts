import { notAllowed, preflight } from '../../../lib/v5/http';
import { registerPost } from '../../../lib/v5/oauth-routes';

export const POST = registerPost;
export const OPTIONS = preflight;
/** L19-1: every other method is 405 with Allow. */
const refuse = () => notAllowed('POST, OPTIONS', true);
export const GET = refuse;
export const PUT = refuse;
export const PATCH = refuse;
export const DELETE = refuse;
