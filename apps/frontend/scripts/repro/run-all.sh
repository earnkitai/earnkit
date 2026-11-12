#!/bin/zsh
# The repro pack: runs every Break script against the local instance (REPRO_BASE_URL, default http://localhost:4600;
# REPRO_DATABASE_URL, default earnkit_journeys), one at a time, then the pack cleanup, and prints a summary table.
# Usage: ./run-all.sh [pattern]   e.g. ./run-all.sh 'l28-*'
DIR=${0:A:h}
PAT=${1:-'l*-*'}
target=$($DIR/run.sh $DIR/target-check.mts 2>&1) || { echo "refused: $target"; exit 2; }
BASE=${target%% *}
echo "target: $target"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 $BASE/api/stats)
[[ $code == 200 ]] || { echo "the instance at $BASE is not answering /api/stats (got $code); start it first (README.md)"; exit 2; }
typeset -a rows; pass=0; fail=0
for f in $DIR/${~PAT}.mts(n); do
  [[ ${f:t} == lib.mts || ${f:t} == cleanup.mts || ${f:t} == target-check.mts || ${f:t} == *-wait.mts ]] && continue
  out=$($DIR/run.sh $f 2>/dev/null | tail -1)
  [[ -z $out ]] && out="FAIL ${f:t:r}: no output (script crashed)"
  echo "$out"
  if [[ $out == PASS* ]]; then ((pass++)); else ((fail++)); fi
  rows+=("$out")
done
$DIR/run.sh $DIR/cleanup.mts 2>/dev/null | tail -1
echo
echo "| id | result |"
echo "|---|---|"
for r in $rows; do id=${${r#* }%%:*}; res=${r%% *}; echo "| $id | $res |"; done
echo
echo "PASS $pass  FAIL $fail  (of $((pass + fail)))"
