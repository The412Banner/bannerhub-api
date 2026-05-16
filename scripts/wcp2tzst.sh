#!/usr/bin/env bash
# wcp2tzst.sh — Convert a Winlator .wcp (or any archive/dir) into a
# correctly-flat BannerHub-API component .tzst.
#
# WHY THIS EXISTS:
#   GameHub 6.0 / the v6 client's component extractor expects each
#   translator/component archive to contain ONLY its payload, laid out
#   exactly like the working sibling of the same type — NO profile.json,
#   NO redundant "./" wrapper-dir member, and (for FEX) NO system32/
#   nesting. A raw .wcp keeps profile.json + a wrapper layout, so on v6 it
#   extracts to an EMPTY component dir → x86_64 game launch dies pre-Wine.
#   (Root-caused 2026-05-16; see PROGRESS_LOG + memory
#   bannerhub-api-box64-tzst-flat-layout.)
#
#   ALWAYS run a .wcp through this script. Never hand-`tar` a .wcp.
#
# USAGE:
#   scripts/wcp2tzst.sh --type box64|fex|vkd3d|dxvk|generic <input.wcp|dir> [outdir]
#
# OUTPUT: <outdir>/<md5>.tzst  and prints  name|md5|size|layout
# Then paste md5/size/file_name/download_url into data/custom_components.json
# (file_size as a STRING), bump version_code, `npm run build`, and run
# scripts/check_component_layout.sh on the produced .tzst before committing.

set -euo pipefail

TYPE=""; IN=""; OUT="."
while [ $# -gt 0 ]; do
  case "$1" in
    --type) TYPE="$2"; shift 2;;
    -*) echo "unknown flag $1" >&2; exit 2;;
    *) if [ -z "$IN" ]; then IN="$1"; else OUT="$1"; fi; shift;;
  esac
done
[ -n "$TYPE" ] && [ -n "$IN" ] || { sed -n '2,30p' "$0"; exit 2; }

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
src="$work/src"; mkdir -p "$src"

# 1. Materialize input into $src (accept dir, or tar that is zstd/gzip/plain).
if [ -d "$IN" ]; then
  cp -a "$IN/." "$src/"
else
  if   tar --zstd -tf "$IN" >/dev/null 2>&1; then tar --zstd -xf "$IN" -C "$src"
  elif tar -tzf       "$IN" >/dev/null 2>&1; then tar     -xzf "$IN" -C "$src"
  elif tar -tf        "$IN" >/dev/null 2>&1; then tar     -xf  "$IN" -C "$src"
  else echo "ERROR: cannot read $IN as a tar (.wcp/.tzst/.tar[.gz])" >&2; exit 1; fi
fi

# 2. Drop the Winlator manifest + any redundant single top-level wrapper dir.
find "$src" -name profile.json -delete
# collapse a lone wrapper dir (e.g. "./pkg/<payload>") down to payload root
while :; do
  entries=("$src"/*); [ -e "${entries[0]}" ] || break
  if [ "${#entries[@]}" -eq 1 ] && [ -d "${entries[0]}" ] \
     && [ "$(basename "${entries[0]}")" != system32 ] \
     && [ "$(basename "${entries[0]}")" != syswow64 ]; then
    inner="${entries[0]}"; mv "$inner"/* "$inner"/.[!.]* "$src"/ 2>/dev/null || true
    rmdir "$inner" 2>/dev/null || break
  else break; fi
done

# 3. Select payload to match the WORKING sibling layout for this type.
stage="$work/stage"; mkdir -p "$stage"
pick(){ f="$(find "$src" -name "$1" -type f | head -1)"; [ -n "$f" ] || { echo "ERROR: $1 not found in input" >&2; exit 1; }; cp "$f" "$stage/$1"; }
case "$TYPE" in
  box64)  pick box64 ;;                                  # working layout: ./box64
  fex)    pick libarm64ecfex.dll; pick libwow64fex.dll ;;# working: bare dlls at root
  vkd3d|dxvk)                                            # working: system32/ + syswow64/
          for d in system32 syswow64; do
            s="$(find "$src" -type d -name "$d" | head -1)"
            [ -n "$s" ] && { mkdir -p "$stage/$d"; cp -a "$s/." "$stage/$d/"; }
          done
          [ -n "$(ls -A "$stage")" ] || { echo "ERROR: no system32/syswow64 payload found" >&2; exit 1; } ;;
  generic) cp -a "$src/." "$stage/" ;;
  *) echo "ERROR: unknown --type $TYPE (box64|fex|vkd3d|dxvk|generic)" >&2; exit 2 ;;
esac

# 4. Repack flat. box64 keeps the proven "./box64" form; others bare at root.
mkdir -p "$OUT"; tmp="$work/out.tzst"
if [ "$TYPE" = box64 ]; then
  ( cd "$stage" && tar --zstd -cf "$tmp" ./box64 )
else
  ( cd "$stage" && tar --zstd -cf "$tmp" $(ls -A) )
fi
md5="$(md5sum "$tmp" | cut -d' ' -f1)"; size="$(stat -c%s "$tmp")"
final="$OUT/$md5.tzst"; mv "$tmp" "$final"

name="$(basename "$IN" | sed 's/\.[^.]*$//')"
echo "$name|$md5|$size|$(tar --zstd -tf "$final" | tr '\n' ' ')"
echo "-> $final" >&2
