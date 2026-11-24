/**
 * Preloaded (`--import`) after test-guard.ts by `pnpm test:flags-on`: the whole suite runs with every shipping flag
 * (`PREVIEW_FLAGS`) on, so the flags can be switched on with a green suite. test-guard clears `EARNKIT_FLAGS`; this
 * sets it for the run, no new variable. A test that asserts flag-off behaviour sets or clears the flags itself.
 */
import { PREVIEW_FLAGS } from '../flags';

process.env.EARNKIT_FLAGS = PREVIEW_FLAGS.join(',');
