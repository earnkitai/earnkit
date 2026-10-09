import { appSetup } from '@/lib/earnkit/github-app';

// v2.10 item 7b (R8): the read-only GitHub App's setup URL: GitHub sends the builder here after the
// install, with installation_id and state (the v2.9 nonce). Off (404) unless the App is configured.
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => appSetup(request);
