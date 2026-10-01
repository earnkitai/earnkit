#!/bin/sh
# Staleness guard for test/halmos/EarnKitCampaignsFlat.sol (see Halmos.t.sol and README.md
# "Analyzer notes" for why Halmos proves properties against this flattened copy instead of
# importing src/ directly).
#
# Regenerates src/EarnKitCampaigns.sol (which pulls in src/EarnKitCampaign.sol) via
# `forge flatten` into a temp file and diffs it against the committed flattened copy. Exits
# non-zero, with instructions, if they differ — i.e. if src/ changed since the copy was last
# regenerated.
#
# Usage: run before every Halmos run, from the contracts/ directory or anywhere:
#   ./test/halmos/check-flat.sh && halmos --contract HalmosTest --solver-timeout-assertion 0
#
# To regenerate after a legitimate src/ change:
#   forge flatten src/EarnKitCampaigns.sol -o test/halmos/EarnKitCampaignsFlat.sol
set -e
cd "$(dirname "$0")/../.."

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

forge flatten src/EarnKitCampaigns.sol -o "$tmp" >/dev/null

if ! diff -q "$tmp" test/halmos/EarnKitCampaignsFlat.sol >/dev/null 2>&1; then
    echo "test/halmos/EarnKitCampaignsFlat.sol is STALE relative to src/EarnKitCampaign.sol / src/EarnKitCampaigns.sol." >&2
    echo "Regenerate it with:" >&2
    echo "  forge flatten src/EarnKitCampaigns.sol -o test/halmos/EarnKitCampaignsFlat.sol" >&2
    echo "then re-run Halmos." >&2
    exit 1
fi

echo "test/halmos/EarnKitCampaignsFlat.sol is up to date with src/."
