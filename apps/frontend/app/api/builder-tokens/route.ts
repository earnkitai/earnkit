import { unstable_cache } from 'next/cache';
import { builderTokensJson, builderTokensResponse } from '@/lib/earnkit/builder-tokens-json';
import { builderPreflight } from '@/lib/earnkit/builder-json';
import { PROFILE_TAG } from '@/lib/earnkit/profile-cache';

/** v4.0 Task 10: GET /api/builder-tokens, the launched builder tokens for tokens.fun's list (builder-tokens-json.ts). One read a minute; readable from https://tokens.fun (CORS). */
export const dynamic = 'force-dynamic';

const cached = unstable_cache(() => builderTokensJson(new Date()), ['builder-tokens'], { revalidate: 60, tags: [PROFILE_TAG] });

export const GET = () => builderTokensResponse(cached);
export const OPTIONS = () => builderPreflight();
