import { checkDefaults } from '../verify';

/**
 * v2.9 A5: test suites that run the entry tools import this once, so link and contract checks
 * never reach the network or url_checks: every live link loads and every address has code, cached
 * in memory. A test about a failed check passes its own probe or getCode (ToolContext.verifyDeps).
 */
const rows = new Map<string, { ok: boolean; checked_at: Date }>();
checkDefaults.probe = async () => {};
checkDefaults.getCode = async () => '0x6080';
checkDefaults.cache = {
  get: async (key) => rows.get(key) ?? null,
  set: async (key, ok, now) => void rows.set(key, { ok, checked_at: now }),
};
