#!/usr/bin/env python3
"""
Compare an upstream sp_winemu XML against what bannerhub-api serves.

Handles BOTH schemas:
  * legacy  sp_winemu_all_components12.xml  — snake_case, unescaped, no category prefix
  * v6      sp_winemu_unified_resources.xml — camelCase, HTML-escaped, CATEGORY:name keys

Usage: python3 xmldiff.py <upstream.xml> [--repo /path/to/bannerhub-api]

INTERPRETING THE OUTPUT — it matches by lowercased name, so it OVER-REPORTS.
Known permanent / expected rows as of 2026-07-29 (do not "fix" these):

  * "MISSING: arm64ec-3.0.1-3dfc6f07" — upstream junk row, type 13, empty
    md5/size/fileName, no download URL. Nothing to mirror.
  * "OUT OF DATE: xact_x64" — upstream's 1.0.1 only repoints the payload from
    Microsoft's CDN (which ours uses) to uxdl.mac520.com. Adopting it would ADD
    a XiaoJi dependency. Deliberate permanent drift.
  * "OUT OF DATE: dxvk-3.0" — upstream's own packaging; ours is DXVK-3.0
    (custom id 1370), our build of the same DXVK release. Paired by name only.
  * "OUT OF DATE: wuchang" — name collision: upstream's wuchang.yml (type 6, our
    id 1396) vs our WUCHANG.tzst game patch (type 5). Both legitimately exist.
  * "SAME VERSION, DIFFERENT PAYLOAD" on the .yml components (witcher32, dmc52,
    bannerlord2, sf62, tloul, tloull1, K-Lite) — BY DESIGN. We rehost the
    installer each yml fetches and rewrite its url: line, so our yml md5
    necessarily differs from upstream's. Not drift.
  * "METADATA DRIFT" — status / fileType / depInfo are NOT emitted by this
    repo's build (a generated entry has 12 fields, none of them these), and on
    /v6/ the worker overwrites status from UPSTREAM_STATUS1 and forces
    fileType=4. So these rows never affect a client. depInfo specifically must
    NOT be adopted: upstream's is either null or points at their mirror where
    ours carries a full recipe using our rehosted payloads.
  * Against the v6 unified dump expect ~300 metadata rows: that dump carries
    fileType=4 universally while our source XML uses 0. Pure noise.
  * "OURS ONLY: steam_9866233" — the 5.x Steam client; /v6/ uses
    steam_client_0403 instead. Intentional.

Genuinely actionable rows are: new upstream components we don't serve, real
version bumps with a changed payload, and containers/imagefs differences.
"""
import json, re, sys, os, html
from collections import OrderedDict

PAT = re.compile(r'<string name="([^"]*)">(.*?)</string>', re.S)

# v6 camelCase -> our canonical snake_case
CAMEL = {
    'downloadUrl': 'download_url', 'fileMd5': 'file_md5', 'fileName': 'file_name',
    'fileSize': 'file_size', 'displayName': 'display_name', 'versionCode': 'version_code',
    'isSteam': 'is_steam', 'subData': 'sub_data', 'upgradeMsg': 'upgrade_msg',
    'frameworkType': 'framework_type', 'fileType': 'fileType',
}

def norm_entry(e):
    out = dict(e)
    for c, s in CAMEL.items():
        if c in e:
            out[s] = e[c]
    return out

def parse_xml(path):
    """-> {category: OrderedDict[key] = normalised entry}"""
    cats = {'COMPONENT': OrderedDict(), 'CONTAINER': OrderedDict(), 'IMAGE_FS': OrderedDict()}
    content = open(path, encoding='utf-8', errors='replace').read()
    for key, blob in PAT.findall(content):
        blob = html.unescape(blob).strip()
        if not blob.startswith('{'):
            continue
        try:
            w = json.loads(blob)
        except json.JSONDecodeError as ex:
            print(f"  !! unparsable {key}: {ex}", file=sys.stderr)
            continue
        cat = w.get('category') or ('COMPONENT' if ':' not in key else key.split(':', 1)[0])
        name = key.split(':', 1)[1] if ':' in key else key
        e = norm_entry(w.get('entry') or {})
        rec = {
            'key': name, 'category': cat,
            'id': e.get('id'), 'name': e.get('name') or w.get('name'),
            'type': e.get('type'), 'version': e.get('version'),
            'version_code': e.get('version_code'),
            'file_md5': e.get('file_md5'), 'file_size': e.get('file_size'),
            'file_name': e.get('file_name'), 'download_url': e.get('download_url'),
            'display_name': e.get('display_name') or '', 'is_steam': e.get('is_steam'),
            'status': e.get('status'), 'fileType': e.get('fileType'),
            'sub_data': e.get('sub_data'), 'depInfo': w.get('depInfo'),
            'isBase': w.get('isBase'), 'isDep': w.get('isDep'), '_raw': w,
        }
        cats.setdefault(cat, OrderedDict())[name] = rec
    return cats

def load_json(repo, fn, key=None):
    p = os.path.join(repo, 'data', fn)
    if not os.path.exists(p):
        return [] if key else {}
    d = json.load(open(p))
    if key:
        return d.get(key, d if isinstance(d, list) else [])
    return d

TYPES = {1: 'Box64/FEX', 2: 'GPU driver', 3: 'DXVK', 4: 'VKD3D',
         5: 'Game patch', 6: 'System lib', 7: 'Steam client', 8: 'Steam client v6'}
def tn(t): return TYPES.get(t, f'type{t}')

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    up_path = sys.argv[1]
    repo = '/data/data/com.termux/files/home/bannerhub-api'
    if '--repo' in sys.argv:
        repo = sys.argv[sys.argv.index('--repo') + 1]

    up_all = parse_xml(up_path)
    ours_all = parse_xml(os.path.join(repo, 'data/sp_winemu_all_components12.xml'))
    up = up_all['COMPONENT']
    ours = ours_all['COMPONENT']
    custom = load_json(repo, 'custom_components.json', 'components')

    custom_by_id = {c['id']: c for c in custom}
    custom_by_name = {}
    for c in custom:
        custom_by_name.setdefault(str(c.get('name', '')).lower(), []).append(c)
    ours_by_id = {c['id']: c for c in ours.values() if c['id'] is not None}
    ours_by_name = {}
    for c in ours.values():
        ours_by_name.setdefault(str(c['name'] or '').lower(), []).append(c)

    print(f"upstream : {up_path}")
    print(f"           {len(up)} components, {len(up_all['CONTAINER'])} containers, "
          f"{len(up_all['IMAGE_FS'])} imagefs")
    print(f"ours     : {len(ours)} XML components + {len(custom)} custom")
    print()

    missing, outdated, payload, meta, extra = [], [], [], [], []

    for key, u in up.items():
        o = ours.get(key) or ours_by_id.get(u['id'])
        if o is None:
            same = ours_by_name.get(str(u['name'] or '').lower())
            o = same[0] if same else None
        src = 'xml'
        if o is None:
            cc = custom_by_id.get(u['id']) or (custom_by_name.get(str(u['name'] or '').lower()) or [None])[0]
            if cc:
                o, src = cc, 'custom'
        if o is None:
            missing.append(u); continue

        if str(u['version']) != str(o.get('version')) or \
           (u['version_code'] or 0) != (o.get('version_code') or 0):
            outdated.append((u, o, src))
        elif u['file_md5'] != o.get('file_md5'):
            payload.append((u, o, src))
        else:
            diffs = []
            for f in ('type', 'is_steam', 'status', 'fileType'):
                if f in o and u.get(f) is not None and u[f] != o.get(f):
                    diffs.append(f'{f}: ours {o.get(f)!r} -> upstream {u[f]!r}')
            if src == 'xml':
                if json.dumps(u['sub_data'], sort_keys=True) != json.dumps(o.get('sub_data'), sort_keys=True):
                    diffs.append('sub_data changed')
                if json.dumps(u['depInfo'], sort_keys=True) != json.dumps(o.get('depInfo'), sort_keys=True):
                    diffs.append('depInfo changed')
            if diffs:
                meta.append((u, o, diffs))

    up_ids = {u['id'] for u in up.values()}
    for key, o in ours.items():
        if key not in up and o['id'] not in up_ids:
            extra.append(o)

    def show(c):
        return (f"  [{str(c.get('id')):>5}] {str(c.get('name')):<40} {tn(c.get('type')):<16} "
                f"v{c.get('version')} vc{c.get('version_code')}")

    print("=" * 80)
    print(f"1. MISSING — upstream has it, we serve it nowhere  ({len(missing)})")
    print("=" * 80)
    for u in sorted(missing, key=lambda c: (c['type'] or 0, c['id'] or 0)):
        print(show(u))
        print(f"          {u['download_url']}")
        print(f"          md5 {u['file_md5']}  size {u['file_size']}")

    print(f"\n{'='*80}\n2. OUT OF DATE — version/versionCode differs  ({len(outdated)})\n{'='*80}")
    for u, o, src in sorted(outdated, key=lambda x: (x[0]['type'] or 0, x[0]['id'] or 0)):
        print(f"  [{str(u['id']):>5}] {str(u['name']):<40} {tn(u['type'])}")
        print(f"          ours({src:6}) v{o.get('version')} vc{o.get('version_code')}  {o.get('file_md5')}")
        print(f"          upstream     v{u['version']} vc{u['version_code']}  {u['file_md5']}")
        print(f"          {u['download_url']}")

    print(f"\n{'='*80}\n3. SAME VERSION, DIFFERENT PAYLOAD (md5 changed in place)  ({len(payload)})\n{'='*80}")
    for u, o, src in sorted(payload, key=lambda x: (x[0]['type'] or 0, x[0]['id'] or 0)):
        print(f"  [{str(u['id']):>5}] {str(u['name']):<40} v{u['version']} vc{u['version_code']} ({src})")
        print(f"          ours {o.get('file_md5')} ({o.get('file_size')})")
        print(f"          upst {u['file_md5']} ({u['file_size']})")
        print(f"          {u['download_url']}")

    print(f"\n{'='*80}\n4. METADATA DRIFT  ({len(meta)})\n{'='*80}")
    for u, o, diffs in sorted(meta, key=lambda x: (x[0]['type'] or 0, x[0]['id'] or 0)):
        print(f"  [{str(u['id']):>5}] {str(u['name']):<40}")
        for d in diffs:
            print(f"          {d}")

    print(f"\n{'='*80}\n5. OURS ONLY — in our XML, absent upstream  ({len(extra)})\n{'='*80}")
    for o in sorted(extra, key=lambda c: (c['type'] or 0, c['id'] or 0)):
        print(show(o))

    # containers + imagefs
    print(f"\n{'='*80}\n6. CONTAINERS  ({len(up_all['CONTAINER'])} upstream)\n{'='*80}")
    ours_cont = load_json(repo, 'containers.json')
    oc = ours_cont.get('containers', ours_cont) if isinstance(ours_cont, dict) else ours_cont
    oc_by_name = {}
    if isinstance(oc, list):
        for c in oc:
            oc_by_name[str(c.get('name', '')).lower()] = c
    elif isinstance(oc, dict):
        for k, v in oc.items():
            oc_by_name[k.lower()] = v
    for k, u in up_all['CONTAINER'].items():
        o = oc_by_name.get(k.lower()) or {}
        ov, ovc = o.get('version'), o.get('version_code', o.get('versionCode'))
        flag = '' if (str(ov) == str(u['version']) and (ovc or 0) == (u['version_code'] or 0)) else '  <-- DIFFERS'
        if not o:
            flag = '  <-- NOT SERVED'
        print(f"  {k:<28} upstream v{u['version']} vc{u['version_code']}   ours v{ov} vc{ovc}{flag}")

    print(f"\n{'='*80}\n7. IMAGE_FS\n{'='*80}")
    ours_ifs = load_json(repo, 'imagefs.json')
    for k, u in up_all['IMAGE_FS'].items():
        print(f"  upstream {k}: v{u['version']} vc{u['version_code']} md5 {u['file_md5']} size {u['file_size']}")
    print(f"  ours     : {json.dumps(ours_ifs)}")

    print(f"\n{'-'*80}")
    print(f"SUMMARY: {len(missing)} missing | {len(outdated)} outdated | {len(payload)} payload-changed "
          f"| {len(meta)} metadata drift | {len(extra)} ours-only")

if __name__ == '__main__':
    main()
