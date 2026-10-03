import { preflight } from '@/lib/earnkit/http';
import { tokenPost } from '@/lib/earnkit/oauth-routes';

export const POST = tokenPost;
export const OPTIONS = preflight;
