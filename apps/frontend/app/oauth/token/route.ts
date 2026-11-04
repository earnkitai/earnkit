import { preflight } from '@/lib/v5/http';
import { tokenPost } from '@/lib/v5/oauth-routes';

export const POST = tokenPost;
export const OPTIONS = preflight;
