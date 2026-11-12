// Prints the repro pack's target (base URL and database name), or the refusal and exit 2. run-all.sh runs it first.
import { reproTarget } from './target.ts';
try {
  const t = reproTarget();
  console.log(`${t.base} ${new URL(t.database).pathname.slice(1)}`);
} catch (e) {
  console.log((e as Error).message);
  process.exit(2);
}
