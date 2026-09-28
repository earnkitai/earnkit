import { json, preflight } from '@/lib/earnkit/http';
import { OAuthError, registerClient } from '@/lib/earnkit/oauth';

export async function POST(request: Request) {
  const metadata = await request.json().catch(() => ({}));
  try {
    return json(registerClient(metadata), 201);
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}
export const OPTIONS = preflight;
