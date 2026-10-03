import { json, preflight } from '@/lib/earnkit/http';
import { OAuthError, registerClient } from '@/lib/earnkit/oauth';
import { RateLimitError, clientIp, enforce } from '@/lib/earnkit/rate-limit';

export async function POST(request: Request) {
  try {
    // 20 registrations an hour per IP (v2.2 §5): client ids are free, but each is a signed record.
    await enforce(
      'oauthRegister',
      clientIp(request.headers),
      'Too many client registrations from this address.',
    );
    const metadata = await request.json().catch(() => ({}));
    return json(registerClient(metadata), 201);
  } catch (err) {
    if (err instanceof RateLimitError)
      return json(
        { error: 'too_many_requests', error_description: err.message },
        429,
        { 'Retry-After': String(err.retryAfter) },
      );
    if (err instanceof OAuthError)
      return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}
export const OPTIONS = preflight;
