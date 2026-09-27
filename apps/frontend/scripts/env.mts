import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Loads apps/frontend/.env.local (or .env) so admin commands share the app's DATABASE_URL. */
for (const file of ['.env.local', '.env']) {
  const path = join(import.meta.dirname, '..', file);
  if (existsSync(path)) process.loadEnvFile(path);
}
