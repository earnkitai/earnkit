import { preflight } from '@/lib/earnkit/http';
import { registerPost } from '@/lib/earnkit/oauth-routes';

export const POST = registerPost;
export const OPTIONS = preflight;
