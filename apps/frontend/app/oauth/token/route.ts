import { json, preflight, readParams } from '@/lib/earnkit/http';
import { saveInstallation } from '@/lib/earnkit/installations';
import { OAuthError, exchangeCode } from '@/lib/earnkit/oauth';

export async function POST(request: Request) {
  try {
    const token = exchangeCode(await readParams(request));
    await saveInstallation(token);
    return json({ access_token: token, token_type: 'Bearer' });
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}
export const OPTIONS = preflight;
