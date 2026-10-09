import { checkDefaults } from '../verify';
import { wonSource } from '../stats';
import { setFeeSource } from '../fees';
import { logoDefaults } from '../token-logo';
import { proofDefaults } from '../submission-proof';
import { SafeFetchError } from '../safe-fetch';

/**
 * v2.9 A5: test suites that run the entry tools import this once, so link and contract checks
 * never reach the network or url_checks: every live link loads and every address has code (with 0
 * transactions on Base), cached in memory. A test about a failed check passes its own probe or getCode (ToolContext.verifyDeps).
 */
const rows = new Map<string, { ok: boolean; checked_at: Date; note?: string | null; n?: number | null }>();
checkDefaults.probe = async () => {};
checkDefaults.getCode = async () => '0x6080';
// v2.10 item 6: no Blockscout read leaves the process; every contract has 0 transactions.
checkDefaults.blockscout = async () => ({ transactions_count: '0' });
checkDefaults.cache = {
  get: async (key) => rows.get(key) ?? null,
  set: async (key, ok, now, extra) => void rows.set(key, { ok, checked_at: now, ...extra }),
};

// v2.9 E20: the first reply's "Builders using EarnKit won $X" never depends on another test file's
// announced wins in the shared database (a test about the line sets its own source).
wonSource.read = async () => 0;

// Part 2 final review I3: the first reply's fee alerts read token fees in the background; here they
// read none (never Base RPC or DefiLlama). A test about fees sets its own source (fees.test.ts).
setFeeSource({ availableWeth: async () => 0n, wethUsd: async () => 0 });

// v2.10 item 12: a launch's logo never reads a live site or GitHub; it falls to the mark. A test
// about the logo passes its own (TokenFlowDeps.logo, or token-logo.test.ts's fakes).
logoDefaults.launch = async () => null;

// v2.10 final fix I3: a submission link's page (e.g. a DoraHacks BUIDL) is never read from the real
// site: it is unreachable, so the builder's confirmation counts, flagged. A test about the proof
// passes its own (ToolContext.entryDeps.fetchProof, or proofCheck's deps.fetchText).
proofDefaults.fetchText = async () => {
  throw new SafeFetchError('no network in tests');
};
