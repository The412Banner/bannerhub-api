#!/usr/bin/env python3
"""
Generate data/upstream_overrides.json — blurb backfill for XiaoJi-supplied
upstream entries that ship without a description.

Scope: type=2 GPU drivers that come from data/sp_winemu_all_components12.xml
       (i.e. the entry's id is NOT in data/custom_components.json).

Each blurb starts with the literal prefix "original Gamehub Driver — " so
the v6 picker's detail panel makes the provenance explicit. The body is
synthesized from name prefix, mirroring scripts/backfill_blurb.py's
family-rule approach.

Re-run any time after an XML re-mirror to refresh coverage:

    python3 scripts/generate_upstream_overrides.py

Manual edits inside data/upstream_overrides.json are honored as long as the
key set doesn't shrink — this script never removes entries, only adds.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CUSTOM = REPO / 'data' / 'custom_components.json'
OVERRIDES = REPO / 'data' / 'upstream_overrides.json'
LIST = REPO / 'simulator' / 'v2' / 'getComponentList'

PREFIX = 'original Gamehub Driver — '

def synth_body(name: str) -> str:
    n = name
    # Qualcomm proprietary blob lines first (most specific)
    if n.startswith('qcom-') or n.startswith('Qualcomm'):
        return ('Qualcomm proprietary Adreno GPU driver (closed-source vendor '
                'blob), repackaged for use under Wine on Android.')
    if n.startswith('Adreno_'):
        return ('Qualcomm Adreno proprietary GPU driver build, repackaged '
                'for use under Wine on Android.')
    if n.startswith('8Elite') or n.startswith('8eGen5') or n.startswith('8Elite2'):
        return ('Qualcomm 8 Elite / Gen 5 proprietary Adreno GPU driver '
                'build, repackaged for use under Wine on Android.')
    # Mesa Turnip release/beta/mem variants
    if re.search(r'_R\d', n):
        return ('Mesa Turnip Vulkan driver release build for Adreno '
                '(community).')
    if re.search(r'_b\d', n):
        return ('Mesa Turnip Vulkan driver beta build for Adreno '
                '(community).')
    if re.search(r'_mem\b', n):
        return ('Mesa Turnip Vulkan driver memory-tuned build for Adreno '
                '(community).')
    if re.match(r'^[Tt]urnip[\s\-_]?v\d', n):
        return ('Mesa Turnip Vulkan driver build for Adreno (community).')
    # Bare 8Elite without prefix match — defensive fallback
    return ('GPU driver build (community).')


def main() -> int:
    # Load the generated list to identify target entries
    gcl = json.loads(LIST.read_text())
    lst = gcl['data']['list']
    if isinstance(lst, str):
        lst = json.loads(lst)
    custom_ids = {c['id'] for c in json.loads(CUSTOM.read_text())['components']}

    # Target: type=2, NOT in custom_components.json, currently no blurb
    targets = [
        c for c in lst
        if c.get('type') == 2
        and c['id'] not in custom_ids
        and not c.get('blurb')
    ]

    # Preserve manually-written entries if the file already exists
    existing: dict = {}
    if OVERRIDES.exists():
        try:
            existing = json.loads(OVERRIDES.read_text()).get('blurb_by_id', {})
        except Exception:
            existing = {}

    blurb_by_id: dict[str, str] = dict(existing)
    added = 0
    for c in targets:
        key = str(c['id'])
        if key in blurb_by_id:
            continue
        blurb_by_id[key] = PREFIX + synth_body(c['name'])
        added += 1

    # Sort keys numerically for stable diffs
    sorted_map = {
        k: blurb_by_id[k]
        for k in sorted(blurb_by_id, key=lambda s: int(s))
    }

    payload = {
        '$schema': 'data/schemas/upstream_overrides.schema.json',
        'description': (
            'Per-id metadata overrides applied to XiaoJi-supplied XML '
            'entries after the merge, before the registry is built. '
            'Survives XML re-mirrors.'
        ),
        'blurb_by_id': sorted_map,
    }

    OVERRIDES.write_text(json.dumps(payload, indent=2) + '\n')
    print(f'targets matching scope: {len(targets)}')
    print(f'existing entries preserved: {len(existing)}')
    print(f'new entries added: {added}')
    print(f'total blurb_by_id entries written: {len(sorted_map)}')
    print(f'wrote {OVERRIDES.relative_to(REPO)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
