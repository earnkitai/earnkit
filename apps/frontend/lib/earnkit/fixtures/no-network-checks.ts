import { checkDefaults } from '../verify';
import { wonSource } from '../stats';
import { setFeeSource } from '../fees';

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

// v2.9 E20: the first reply's "Builders using EarnKit won $X" never depends on another test file's
// announced wins in the shared database (a test about the line sets its own source).
wonSource.read = async () => 0;

// Part 2 final review I3: the first reply's fee alerts read token fees in the background; here they
// read none (never Base RPC or DefiLlama). A test about fees sets its own source (fees.test.ts).
setFeeSource({ availableWeth: async () => 0n, wethUsd: async () => 0 });
