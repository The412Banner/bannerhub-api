#!/usr/bin/env bash
# check_component_layout.sh — Guard: reject .wcp-style component archives
# before they reach the catalog. Run on every new/updated component .tzst.
#
#   scripts/check_component_layout.sh <file1.tzst> [file2.tzst ...]
#
# FAILS (exit 1) if an archive contains profile.json, a redundant top-level
# "./"-only wrapper-dir member with the real payload nested under it, or is
# unreadable. This is the exact defect that made Box64/FEX components extract
# empty on v6 (2026-05-16). Wire into pre-upload / CI for new assets.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <component.tzst> ..." >&2; exit 2; }
rc=0
for f in "$@"; do
  if ! L="$(tar --zstd -tf "$f" 2>/dev/null)"; then
    echo "FAIL  $f : not a readable zstd tar"; rc=1; continue
  fi
  bad=""
  echo "$L" | grep -qiE '(^|/)profile\.json$' && bad="$bad profile.json"
  # a bare "./" dir member is the .wcp wrapper signature (working flat
  # archives list "./box64" or bare files, never a standalone "./" entry)
  echo "$L" | grep -qE '^\./$' && bad="$bad ./wrapper-dir"
  if [ -n "$bad" ]; then
    echo "FAIL  $f :$bad"
    echo "      contents: $(echo "$L" | tr '\n' ' ')"
    echo "      -> repackage with scripts/wcp2tzst.sh --type <box64|fex|vkd3d|dxvk>"
    rc=1
  else
    echo "OK    $f : $(echo "$L" | tr '\n' ' ')"
  fi
done
exit $rc
