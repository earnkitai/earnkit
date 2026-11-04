import { preflight } from '@/lib/v5/http';
import { registerPost } from '@/lib/v5/oauth-routes';

export const POST = registerPost;
export const OPTIONS = preflight;
