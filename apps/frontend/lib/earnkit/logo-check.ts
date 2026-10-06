import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logoFileProblem, type GuideLogo } from './program-file';

/**
 * v2.7 fix round 1 (Finding 8): reads a logo file under `publicDir` (apps/frontend/public in
 * `programs-sync.mts`; a fixture directory in tests) and runs `logoFileProblem` on it. Factored
 * out of the sync script so the read-and-check path is itself testable, not just the pure check.
 */
export function checkLogoFile(logo: GuideLogo, publicDir: string): string | null {
  let bytes: Buffer | null;
  try {
    bytes = readFileSync(join(publicDir, logo.path));
  } catch {
    bytes = null;
  }
  return logoFileProblem(logo.path, bytes);
}
