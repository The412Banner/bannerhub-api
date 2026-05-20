#!/usr/bin/env python3
"""
One-shot backfill of `blurb` on custom_components.json for types 1/2/3/4.

Strategy: synthesize per-family descriptions from the entry `name`. No
network. Skips entries that already carry a `blurb`. Run with --dry-run
to preview, no args to write.

Going-forward, new entries get blurb from AdrenoTools `meta.json` via
convert-drivers.ts (dfa1a68); this script exists to retro-fill the
~220 entries that predate that wiring.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Callable

CUSTOM = Path('data/custom_components.json')

# Order matters: first matching rule wins.
# Each rule = (predicate, blurb)
def starts(prefix: str) -> Callable[[str], bool]:
    return lambda n: n.startswith(prefix)

def contains(sub: str) -> Callable[[str], bool]:
    return lambda n: sub in n

def matches(pat: str) -> Callable[[str], bool]:
    rx = re.compile(pat)
    return lambda n: bool(rx.search(n))

# --- type=1 Box64/FEX ----------------------------------------------------
RULES_T1: list[tuple[Callable[[str], bool], str]] = [
    (matches(r'^Box64-0\.4\.3-Hybrid-Bionic$'),
     "Box64 0.4.3 Hybrid-Bionic build. Links against Android's Bionic libc rather than glibc for better in-app compatibility on Android Wine containers."),
    (matches(r'^Box64-\d'),
     "Box64 x86_64-to-ARM64 dynamic recompiler. Translates x86_64 Linux binaries to native ARM64 at runtime for use under Wine."),
    (matches(r'^FEXCore-'),
     "FEX-Emu FEXCore — x86/x86_64-to-ARM64 dynamic recompiler. WoW64 layer that lets Wine run 32-bit and 64-bit Windows binaries on ARM64."),
    (matches(r'^Fex[-_]'),
     "FEX-Emu — x86/x86_64-to-ARM64 dynamic recompiler. WoW64 layer that lets Wine run 32-bit and 64-bit Windows binaries on ARM64."),
]

# --- type=2 GPU drivers --------------------------------------------------
RULES_T2: list[tuple[Callable[[str], bool], str]] = [
    # Vendor / fork-specific lines first (most specific)
    (starts('Banners-Turnip'),
     "The412Banner Turnip build from Mesa main. KGSL backend; targets A6xx/A7xx Adreno."),
    (starts('Banners_Turnip'),
     "The412Banner Turnip build from Mesa main. KGSL backend; targets A6xx/A7xx Adreno."),
    (starts('MTR_'),
     "MTR community Turnip build (Mesa-based). Targets Adreno A840P / A8xx generations with stability tweaks."),
    (starts('SMXZ_'),
     "StevenMXZ Turnip build. Mesa-based Vulkan driver for Adreno with the SMXZ tuning patch set."),
    (starts('WHITE_'),
     "WHITE community Turnip build. A8xx-targeted Mesa Vulkan driver with the WHITE patch set."),
    (starts('VIVSI_'),
     "VIVSI Turnip build. Targets Adreno 710 / 720 / 722 mid-tier mobile GPUs."),
    (starts('Qualcomm '),
     "Qualcomm proprietary Adreno GPU driver (closed-source vendor blob). Repackaged for use under Wine on Android."),
    (starts('qcom-'),
     "Qualcomm proprietary Adreno GPU driver (closed-source vendor blob). Repackaged for use under Wine on Android."),

    # Style: "Turnip (Danil's Fork ...) ..." and other parenthesised forks
    (contains("Danil's Fork"),
     "Danil's-fork Turnip (tu-newat-fixes). Experimental upstream-Mesa branch with newat-related fixes."),
    (contains('PixelyIon'),
     "PixelyIon-fork Turnip build. Community fork tracked separately from Mesa main."),
    (contains('Mesa 26.0.0 (Patched: OneUI/UBWC)'),
     "Turnip on Mesa 26.0.0 with OneUI / UBWC compositor patches."),
    (contains('Mesa 26.0.0 (Patched: OneUI)'),
     "Turnip on Mesa 26.0.0 with OneUI compositor patches."),
    (contains('Mesa Main'),
     "Turnip built from Mesa main branch."),
    (contains('Autotuner'),
     "Turnip with the Autotuner heuristic tuning patches (Mesa-based)."),

    # Style: "Turnip Normal/OneUI/a6xx - <version>"
    (matches(r'^Turnip Normal\b'),
     "Standard Turnip Mesa Vulkan driver build."),
    (matches(r'^Turnip OneUI\b'),
     "Turnip with OneUI compositor compatibility patches."),
    (matches(r'^Turnip a6xx\b'),
     "Turnip targeted at Adreno A6xx generation."),

    # Style: "Turnip-Gen8-V<n>" / "Mesa Turnip Gen8 V<n>"
    (matches(r'(Turnip-Gen8|Mesa Turnip Gen8|Turnip Gen8|Mesa Turnip driver|Mesa Turnip Driver|Mesa-git Turnip|Mesa 26\.0 Turnip|Mesa Turnip v|Mesa Turnip\b)'),
     "Mesa Turnip Vulkan driver for Adreno. Community build."),

    # Style: "Turnip-Main-<sha>[-A6xxFix...]"
    (matches(r'^Turnip-Main'),
     "Turnip from Mesa main branch (community snapshot)."),
    (matches(r'^Turnip-MR'),
     "Turnip with upstream Mesa merge-request patches."),
    (matches(r'^Turnip-Deck'),
     "Turnip tuned for handheld / Steam-Deck-class workloads."),
    (matches(r'^Turnip-R\d'),
     "Turnip community release build for Adreno."),

    # Style: "Turnip-v<...>-R<n>" / "Turnip_v<...>_R<n>" / "Turnip v<...> R<n>"
    # Optionally suffixed _OneUI / _Test / etc.
    (matches(r'^Turnip[\s\-_]?\d?.*_OneUI$'),
     "Turnip Vulkan driver release build with OneUI compositor patches."),
    (matches(r'^Turnip[\s\-_]v?\d.*[\s\-_][Rr]\d'),
     "Turnip Vulkan driver release build for Adreno."),
    (matches(r'^[Tt]urnip[\s\-_]v\d'),
     "Turnip Vulkan driver for Adreno. Community build."),

    # Style: "Turnip-<date> ..." or "Turnip - Oct 22, 2025 ..."
    (matches(r'^Turnip\b.*\d{4}'),
     "Turnip Mesa Vulkan driver, dated community snapshot."),
    (matches(r'^Turnip\b'),
     "Turnip Mesa Vulkan driver for Adreno."),

    # turnip_v<line>_<R|b><n>[_<mod>]
    (matches(r'^turnip_v\d.*_R\d'),
     "Turnip Vulkan driver release build for Adreno."),
    (matches(r'^turnip_v\d.*_b\d'),
     "Turnip Vulkan driver beta build for Adreno."),
    (matches(r'^turnip_v\d'),
     "Turnip Vulkan driver for Adreno."),

    # A8XX / A8xx draft / MR series
    (matches(r'^A8[Xx]X\b'),
     "A8xx-targeted Turnip Vulkan driver community build (Adreno gen 8)."),

    # v<num> bare (kept-name Adreno blobs that slipped through)
    (matches(r'^v\d+$'),
     "Qualcomm Adreno GPU driver build (community-repackaged proprietary blob)."),
]

# --- type=3 DXVK ---------------------------------------------------------
RULES_T3: list[tuple[Callable[[str], bool], str]] = [
    (matches(r'(?i)gplasync.*arm64ec'),
     "DXVK ARM64EC build with GPL async pipeline compilation. Direct3D 9/10/11 → Vulkan translation layer."),
    (matches(r'(?i)gplasync'),
     "DXVK with GPL async pipeline compilation. Direct3D 9/10/11 → Vulkan translation layer."),
    (matches(r'(?i)sarek.*dyasync|sarek.*async'),
     "DXVK Sarek variant for older Vulkan implementations, with async pipeline compilation."),
    (matches(r'(?i)sarek'),
     "DXVK Sarek variant for older / restricted Vulkan implementations."),
    (matches(r'(?i)mali'),
     "DXVK build patched for Mali GPUs. Direct3D 9/10/11 → Vulkan translation layer."),
    (matches(r'(?i)async'),
     "DXVK with async pipeline compilation. Direct3D 9/10/11 → Vulkan translation layer."),
    (matches(r'(?i)^dxvk'),
     "DXVK Direct3D 9/10/11 → Vulkan translation layer."),
]

# --- type=4 VKD3D --------------------------------------------------------
RULES_T4: list[tuple[Callable[[str], bool], str]] = [
    (matches(r'arm64ec'),
     "VKD3D-Proton ARM64EC build. Direct3D 12 → Vulkan translation layer."),
    (matches(r'(?i)^vkd3d'),
     "VKD3D-Proton Direct3D 12 → Vulkan translation layer."),
]

RULES = {1: RULES_T1, 2: RULES_T2, 3: RULES_T3, 4: RULES_T4}

def synth(name: str, typ: int) -> str | None:
    for pred, blurb in RULES.get(typ, []):
        if pred(name):
            return blurb
    return None

def main() -> int:
    dry = '--dry-run' in sys.argv
    data = json.loads(CUSTOM.read_text())

    target_types = {1, 2, 3, 4}
    needing = [c for c in data['components']
               if c.get('type') in target_types and not c.get('blurb')]
    print(f'unblurbed entries in target types: {len(needing)}')

    miss: list[tuple[int, str]] = []
    applied = 0
    by_type: dict[int, int] = {}
    for c in needing:
        b = synth(c['name'], c['type'])
        if b is None:
            miss.append((c['type'], c['name']))
            continue
        if not dry:
            c['blurb'] = b
        applied += 1
        by_type[c['type']] = by_type.get(c['type'], 0) + 1

    print(f'applied: {applied}')
    for t in sorted(by_type): print(f'  type={t}: {by_type[t]}')
    if miss:
        print(f'\nUNCOVERED ({len(miss)}):')
        for t, n in miss: print(f'  type={t}: {n!r}')

    if not dry and applied:
        CUSTOM.write_text(json.dumps(data, indent=2) + '\n')
        print(f'\nwrote {CUSTOM}')
    elif dry:
        print('\n[dry-run] no file written')

    return 1 if miss else 0

if __name__ == '__main__':
    sys.exit(main())
