# BannerHub API — Progress Log

Chronological record of significant changes to the catalog data, the Cloudflare Worker, and the build system. Newest entries at the bottom.

## 2026-05-02 — GameHub 6.0 catalog + Worker hardening session

End-to-end session that moved 6.0 from "wrapper fix landed" to "fully documented + Steam working + zero unknowns in the type table."

### Catalog adds / bumps

- **`Fex_20260428` version_code 1 → 2** in `data/custom_components.json` (commit `93b16a6`). Matches the authoritative Xiaoji SharedPreferences entry. Binary on the GitHub release was already byte-identical to upstream — no re-upload, only the catalog version bump triggered a rebuild of all 22 generated endpoint files.
- **`Turnip_v26.2.0_R1` added** as a new entry (id 1297, type 2, 3.21 MB, md5 `c1ea3d75…`). Binary uploaded to the `Components` GitHub release; `npm run build` regenerated catalog files. Same commit `93b16a6`.
- **Earlier hand-edit (`caf1c20`) was wrong** — it edited the generated `simulator/v2/getAllComponentList`/`getComponentList` files directly, which would have been clobbered on the next build. Rectified by moving the change to `data/custom_components.json` and rebuilding properly.

### Worker behavior changes (all gated to `/v6/`, 5.x untouched)

- **Steam type 7 → 8 remap on `/v6/`** (commit `163b4be`, deployment_id `84eb21e4…`). New helper `remapSteamFor60(e)` runs in both `getComponentList` and `getAllComponentList` BEFORE the type filter, so a 6.0 client requesting `type=8` actually receives the promoted entries. 5.x clients keep type 7 via the pass-through path.
- **Steam client allowlist on `/v6/`** (commit `5114722`, deployment_id `59317385…`). New `keepForSteamClientAllowlist60(e)` predicate + `ALLOWED_STEAM_CLIENTS = new Set(['steam_client_0403'])`. Drops upstream's `steam_9866232/233` from `/v6/` responses while keeping them visible on the 5.x path. 6.0 picker now sees only `steam_client_0403`.
- **`isSteam` (camelCase) mirror on `/v6/getContainerList`** (commit `76aa2f5`, deployment_id `d623e44…`). Dedicated handler before the `GITHUB_ROUTES` generic catch-all. For each container, mirrors `is_steam` → `isSteam` verbatim — values 1, 2, 0 preserved. 5.x containers still pass through with snake-case `is_steam` only.
- **Removed dead `is_steam` default from `reshapeFor60`** (same commit). Was setting snake-case `is_steam = 0` on every component — wrong field name (6.0 reads `isSteam` camelCase) AND wrong category (the flag belongs on containers, not components). 6.0 never read it.

### Live verification snapshots after each deploy

- `/v6/getComponentList?type=8` → 1 entry (`steam_client_0403`)
- `/v6/getComponentList?type=7` → 0 entries (bucket emptied by remap)
- `/v6/getAllComponentList` Steam-named entries → only `steam_client_0403` at type 8 (plus type-5 agents `steamagent`, `SteamAgent2`)
- `/v6/getContainerList` → 10 containers, all carry `isSteam` (6 at value 1, 4 at value 2)
- `/simulator/v2/getContainerList` (5.x) → 10 containers, `isSteam` absent on all, snake-case `is_steam` preserved (6 at 1, 4 at 2)
- `/v6/getAllComponentList` components → zero entries carry either `is_steam` or `isSteam` (dead default removed)

### README hybrid restructure (commits `6db016a` + cascade through `6a1d878`)

User picked Option C (hybrid) over Options A (additive) and B (full restructure) after evaluating three rendered HTML previews saved to `/storage/emulated/0/Download/`. Hybrid = additive at the global level + targeted clarity fixes:

1. **Heads-up callout** at the top — points readers from the implicitly-5.3.5 default content to `§ GameHub 6.0 support`.
2. **Renamed** existing `## Component Types` → `## Component types (GameHub 5.3.5)` so the table isn't presumed universal.
3. **Added `bannerhub-revanced`** row to the Related Repositories table (was overdue — that repo is the 6.0 client).
4. **New `## GameHub 6.0 support` H2** between the renamed 5.3.5 table and `## Directory Structure`. Subsections: client identification (`/v6/` gate), endpoint behavior table, `reshapeFor60` field changes, 6.0 component-type table, Steam handling (clients + agents + `isSteam` containers), install bootstrap, known gaps.

Cascade fixes that landed alongside:
- Dropped undefined "sidecar" jargon from type-3/4 status cells (`a466f9b`).
- Promoted types 2/3/4 from 🟡 → ✅ after user confirmed end-to-end picker → download → game-launch on device (`b4c42b5`).
- Updated table intro to count 4 confirmed rows (`a00a09e`).
- Collapsed the two Steam rows (type 7 + type 8) into a single divergence row keyed on the 6.0 type (`d92909a`).
- Promoted type 8 (Steam) to ✅ confirmed live after on-device test of the type-7→8 remap (`207b4d3`).
- Promoted type 5 (Games / Steam agents) and type 6 (Libraries / Runtime deps with vcredist/dotnet examples) to ✅ confirmed after user clarified upstream classifications (`41dd937`, `ed77791`).
- Updated the `is_steam` subsection → `isSteam on containers (not components)` after the camelCase mirror landed (`6a1d878`).

**Final state of 6.0 type table: 7/7 confirmed (1, 2, 3, 4, 5, 6, 8) — zero 🟡 rows. Only known divergence: Steam clients (5.3.5 type 7 → 6.0 type 8). Steam agents stay type 5 in both versions.**

### Empirical receipts checked into the repo

- `data/sp_winemu_strings_by_type.txt` (376 lines, commit `2d33dee`) — every `COMPONENT:*` key the 6.0 host wrote to `sp_winemu_unified_resources.xml` on a real device, grouped by type. Linked from the 6.0 type table intro.
- `data/sp_winemu_all_components12_by_type.txt` (365 lines, commit `7c4b398`) — every component the upstream `sp_winemu_all_components12.xml` catalog ships, grouped by type. Linked from the 5.3.5 type table intro.

### Open follow-ups
- Probe whether XiaoJi added any **type 9+ categories** in the KMP rewrite (only known unknown in the type space).
- The `convert-drivers.ts` script header still has `GITHUB_REPO = 'Producdevity/gamehub-lite-api'` — wrong repo (upstream of this fork). If anyone runs it as-is, the GitHub upload step targets the upstream's release, not ours. Worth fixing before next driver batch import.
- `ADDING_NEW_COMPONENTS.md` is silent on `.wcp` / `.zip` / `.tar.xz` format flexibility — host-side `ComponentInjectorHelper.java` detects format by magic bytes (PK / zstd / xz). Only `.tzst` is documented as the canonical on-release format here. Consider a short "Accepted formats" addendum.

## 2026-05-06 — VKD3D-Proton 3.0.1 catalog adds

Upstream VKD3D-Proton tagged `v3.0.1` at commit `3b10bd7a` (2026-05-06, same SHA as the prior `v3.0b` master HEAD plus the changelog commit). Added the Winlator WCP Hub stripped builds to the catalog so 6.0 picker exposes them.

### Catalog adds (commit `a83d3b8`)

- **`vkd3d-proton-3.0.1` added** (id 1298, type 4, 3.13 MB, md5 `83de62e6…`). Source: `/storage/emulated/0/Download/vkd3d-repack/vkd3d-proton-3.0.1.wcp` from WCP Hub. Repacked `.wcp → .tzst` with `profile.json` stripped (catalog convention — verified against the existing `vkd3d-proton-3.0b` component which also lacks a profile.json). DLL sha256 hashes preserved bit-identically through the repack.
- **`vkd3d-proton-arm64ec-3.0.1` added** (id 1299, type 4, 3.14 MB, md5 `61957eab…`). Same source/process for the ARM64EC variant. First arm64ec VKD3D entry in the custom catalog — earlier versions (3.0a/3.0b/2.x) ship standard-only.
- Both binaries uploaded to the `Components` GitHub release as `<md5>.tzst`. `npm run build` regenerated 21 endpoint files. Pushed to `master` and `main`.

### Repack process (.wcp → catalog .tzst)

WCP Hub `.wcp` files are zstd-compressed tar with `system32/`, `syswow64/`, AND `profile.json` (Winlator's per-component manifest). Catalog `.tzst` files are zstd-compressed tar with `system32/` + `syswow64/` only — no `profile.json`. Conversion: extract → delete `profile.json` → `tar -cf - … | zstd -19`. md5 and file_size are recomputed after repack (the strip changes both).

## 2026-05-06 — SMXZ Turnip backlog catalog adds

Backfilled the StevenMXZ/Adreno-Tools-Drivers releases from `v27.1` (2026-03-30) through `v30` (2026-05-01) into the catalog as type 2 GPU drivers, ids 1300-1308 (commit `c8f5479`). Single push, all 9 binaries uploaded as `<md5>.tzst` to the `Components` release.

### Naming — `SMXZ_` prefix to disambiguate from existing entries

StevenMXZ's `Turnip_v26.2.0_R1.zip` ships `vulkan.ad07XX.so` (Adreno 07xx Mesa Main test driver), while the existing catalog `Turnip_v26.2.0_R1` (id 1297) is from Banners-Turnip and ships the standard `libvulkan_freedreno.so`. Same upstream release tag name, different binaries — would collide in the picker. All SMXZ entries get an `SMXZ_` prefix to keep them visually distinct. Future imports from this repo should follow the same convention.

### Adds (commit `c8f5479`)

| id | name | source release | size |
|---|---|---|---|
| 1300 | `SMXZ_Turnip_Gen8_V27` | v27.1 | 1.82 MB |
| 1301 | `SMXZ_Turnip_Autotuner_v26.1.0` | v26.1.0_auto | 2.45 MB |
| 1302 | `SMXZ_Turnip_v26.2.0_R1` | v26.2.0-R1 | 2.47 MB |
| 1303 | `SMXZ_Turnip_Gen8_V28` | v28 | 2.48 MB |
| 1304 | `SMXZ_Turnip_v26.2.0_R2` | v26.2.0-R2 | 2.47 MB |
| 1305 | `SMXZ_Turnip_Gen8_V29` | v29 | 1.88 MB |
| 1306 | `SMXZ_Turnip_v26.2.0_R3` | turnip_v26.3.0_r3 (asset is R3) | 1.88 MB |
| 1307 | `SMXZ_Turnip_v26.2.0_R3_OneUI` | turnip_v26.3.0_r3 (OneUI variant) | 1.88 MB |
| 1308 | `SMXZ_Turnip_Gen8_V30` | v30 | 1.88 MB |

The `Gen8_*` line targets the Adreno A8xx Snapdragon Gen8 SoCs; the `v26.2.0_R*` and `Autotuner` line target Adreno 07xx with custom shader libraries. Both ship as Adreno-tools-style ZIPs with `meta.json` + `*.so`.

### ZIP → tzst repack (Adreno-tools format)

Mirrors `add-components.py`'s repack path so md5s are reproducible: extract ZIP → tar with `sorted(os.listdir(extract))` → `zstd -19`. Output preserves the original `meta.json` + `.so` (unlike the WCP→tzst flow, which strips `profile.json`). Existing `Turnip_v26.2.0_R1` (id 1297) was repacked the same way — its tzst contains `./libvulkan_freedreno.so` only because the underlying zip from Banners-Turnip ships only the `.so`, no `meta.json`.

## 2026-05-06 — Picker ordering: newest-at-bottom for types 1/2/4 (commit `166dd9f`)

Flipped the in-app picker order for **Box64/FEX (type 1)**, **GPU drivers (type 2)**, and **VKD3D (type 4)** so newer entries appear at the **bottom** of each list. DXVK (3), Games (5), Libraries (6), and Steam (7) keep their existing ordering — newest-first for manifests, name-sorted for simulator endpoints. Honored consistently in both per-type manifests and the cross-type simulator endpoints, so the order is the same regardless of which path the client takes.

### Implementation

- **`src/registry/registry.ts`**: exported new `PICKER_NEWEST_LAST_TYPES = new Set([1, 2, 4])` as the single source of truth. Added `sortByIdAscending()` method. Modified the (misnamed) `sortByTypeAndIdDescending()` to: keep type-asc grouping, switch to id-asc within types in the set, fall through to name-with-numeric-collation for everything else.
- **`src/generators/manifest-generator.ts`**: imports `PICKER_NEWEST_LAST_TYPES` and conditionally picks `sortByIdAscending` vs. `sortByIdDescending` based on type.
- **`src/generators/simulator-generators.ts`**: unchanged — the registry change flows through automatically since both `getAllComponentList` and `getComponentList` go through `sortByTypeAndIdDescending`.

### Verified live (post-Pages rebuild)

```
VKD3D:       [7, 59, 208, 356, 384, 1298, 1299]   ← newest at bottom (1299)
GPU drivers: 251 entries, ends [1304, 1305, 1306, 1307, 1308] ← SMXZ Turnips at bottom
Box64/FEX:   32 entries, ends [1157, 1159, 1294]  ← Fex_20260428 at bottom
```

### Open follow-up

- The registry method `sortByTypeAndIdDescending` is now even more of a misnomer (sorts asc for some types, by name for others). Worth renaming to `sortForListEndpoints` in a future cleanup pass. Skipped here to keep the diff minimal — name change would touch the two call sites in `simulator-generators.ts` and any future grep readers.

## 2026-05-06 — WHITE A8xx Turnip backlog catalog adds (commit `f09f417`)

Backfilled the whitebelyash/freedreno_turnip-CI A8xx Gen8 line from `tu_v25` (2026-04-15) through `tu_v26` (2026-05-05) — 5 entries, ids 1309-1313:

| id | name | source release |
|---|---|---|
| 1309 | `WHITE_A8xx_Turnip_v25` | tu_v25 |
| 1310 | `WHITE_A8xx_Turnip_v25.1` | tu_v25.1 |
| 1311 | `WHITE_A8xx_Turnip_v25.2` | tu_v25.2 |
| 1312 | `WHITE_A8xx_Turnip_v25.3` | tu_v25.3 |
| 1313 | `WHITE_A8xx_Turnip_v26` | tu_v26 |

### Naming convention codified

`WHITE_` mirrors the `SMXZ_` precedent established earlier today. Both StevenMXZ and whitebelyash publish A8xx Gen8 turnip builds and would naming-collide without prefixes. Banners-Turnip remains the unprefixed default. Convention saved to memory (`feedback_bannerhub_api_driver_prefixes.md`) so future imports auto-apply.

## 2026-05-07 — Firmware 6.0 bump 1.3.4 → 1.3.5 (commit `687a9ac`)

Replaced the 6.0 firmware served on the `/v6/` gate. Same single endpoint, same gating logic, just newer asset.

### What changed
- `bannerhub-worker.js` `getImagefsDetail` 6.0 branch:
  - `version: '1.3.4'` → `'1.3.5'`
  - `version_code: 24` → `25`
  - `download_url`: `imagefs_v134.zst` → `imagefs_v135.zst`
  - `file_md5`: `76a186c04196c0ffe31ea1ab88705b83` → `d2242c284e42cbbe49289caf4506b95d`
  - `file_size`: `168,890,206` → `171,913,896` (~164 MB)
- New asset uploaded to `Components` release on `The412Banner/bannerhub-api`. Source: user-provided `imagefs_v135.zst` from device.
- `imagefs_v134.zst` kept on the release as rollback safety per user direction.

### Deploy
Curl REST PUT to `accounts/{acct}/workers/scripts/bannerhub-api` with KV-binding metadata block (per memory's no-wrangler pattern). `success: true`, etag `2668f3acc1bab28bd9f5656cc9b59b4860de0f5f268a15b0081e425412e61b95`.

### Verification (live)
- `GET /v6/simulator/v2/getImagefsDetail` → `version: "1.3.5"`, new url/md5/size ✅
- `GET /simulator/v2/getImagefsDetail` (no `/v6/`) → `version: "1.3.3"` from static `imagefs.zst` (5.x path untouched) ✅
- `HEAD imagefs_v135.zst` → 200, redirected to GitHub blob-storage CDN ✅

## 2026-05-07 — vjoy/Scheme cloud-share login bypass (Worker-side)

### Symptom
6.0.1 added a "cloud share schemes / vjoy layouts" UI screen. On all BannerHub variants the screen showed **"Please login first"** even with our login bypass active. Proven via logcat:
```
VJoy_MainRecommend: loadFeedPage error(...): Business(code=401, message=Please login first)
```

### Diagnosis
- **The 401 is server-side**, not a client gate. Bypass-login makes the *client* think it's logged in, so the client makes the request — but the request goes upstream **unauthenticated** and upstream rejects.
- Captured the request shape via temporary debug-intercept that wrote to `bannerhub_debug_*` KV keys. The vjoy feed is `GET /v6/vcontroller/recommendMapList?game_id=0&is_official=2&page=1&page_size=20` with headers `clientparams`/`sign`/`time` for integrity but **no token header, no token in query, no Authorization**. The client just doesn't include any auth credential for this endpoint family.
- Existing worker fall-through proxy strips ALL incoming headers (only sets `Content-Type`) and forwards GETs as-is with no token injection. Result: upstream sees an anonymous request → 401.

### Fix
New custom handler covering the full vjoy/Scheme endpoint family:
- `vcontroller/*` (recommendMapList, shareMap, getMapByShareCode, etc.)
- `simulator/configList`, `simulator/getConfigById`, `simulator/shareConfig`, `simulator/deleteShareConfig`, `simulator/reportConfigApply`
- `readLayoutType/*`, `writeLayoutType/*`

Handler logic:
1. Read `bannerhub_token` from `TOKEN_STORE` KV (the rotating-real-token already maintained for other endpoints).
2. Forward all original request headers verbatim, dropping only hop-by-hop and CF-injected ones (`host`, `connection`, `content-length`, `cf-*`, `x-forwarded*`, `x-real-ip`).
3. Inject `token: <realToken>` header.
4. For POST: also swap any in-body `token` field and recompute the `sign` via the existing `generateSignature()`.
5. Forward to `landscape-api.vgabc.com`; pass response through.

### Verification
Live test with the captured request reproduces:
```
code: 200, msg: Success
data: {list: [...real vjoy layouts...], page: 1, page_size: 20, total: ...}
```
Real entries returned: "GTA5专用按键" (id 1, downloadCount 14882), "Gamehub 2" (id 13, downloadCount 5355), etc.

### Deploy
Curl REST PUT to `accounts/{acct}/workers/scripts/bannerhub-api`. `success: true`.

### Commit pending
After device-confirm, push to master + main.

## 2026-05-08 — Firmware 6.0 bump 1.3.5 → 1.3.6

Same shape as the 1.3.4 → 1.3.5 cutover. Single endpoint touched, `/v6/` gate untouched, 5.x path stays on 1.3.3.

### What changed
- `bannerhub-worker.js` `getImagefsDetail` 6.0 branch:
  - `version: '1.3.5'` → `'1.3.6'`
  - `version_code: 25` → `26`
  - `download_url`: `imagefs_v135.zst` → `imagefs_136.zst`
  - `file_md5`: `d2242c284e42cbbe49289caf4506b95d` → `bc95fcb8dc02dac7d61e1be7dd374aeb`
  - `file_size`: `171,913,896` → `171,913,961` (+65 bytes vs 1.3.5)
- Comment block at line 501 + the endpoint comment updated `1.3.5` → `1.3.6`.
- New asset `imagefs_136.zst` uploaded to `Components` release on `The412Banner/bannerhub-api`. Source: user-provided file in Downloads, dated 2026-05-08 04:23.
- `imagefs_v135.zst` kept on the release as rollback safety per user direction (matches v134 retention pattern).

### What's actually different in 1.3.6
File listing identical to 1.3.5 (7,799 entries, byte-for-byte). The only meaningful delta is `usr/lib/libGameScopeVK.so` — rebuilt, **2,218,920 → 2,218,904 B (-16 B)**, MD5 `17993261…` → `6d611691…`. Same Vulkan ICD JSON (`api_version 1.3.216`). Looks like a quiet recompile of the AI Frame Generation compositor; no UI-surfaced version change.

### Deploy
Curl REST PUT to `accounts/{acct}/workers/scripts/bannerhub-api` with the same KV-binding metadata block as the v135 cutover.

### Verification (live)
- `GET /v6/simulator/v2/getImagefsDetail` → `version: "1.3.6"`, new url/md5/size
- `GET /simulator/v2/getImagefsDetail` (no `/v6/`) → still `version: "1.3.3"` from static `imagefs.zst` (5.x path untouched)
- `HEAD imagefs_136.zst` on the Components release → 200

### `base.tzst` verification (separate check, same day)
User had a `base_136.tzst` in Downloads (40,612,198 B, MD5 `3d5c31b1346985d582f04d239004b4d7`); compared byte-for-byte against the live `base.tzst` the API serves at `Components/base.tzst`. Result: **byte-identical**. XiaoJi did not change the Wine-prefix scaffold for 1.3.6 — `libGameScopeVK.so` rebuild is the only payload delta. No worker change needed for `base`; existing entry id 8 / type 5 / version 1.0.0 / code 1 still points at the correct blob.

## 2026-05-08 — Proton 11 ARM64EC v1.0.0 → v1.0.1 (sub_data added)

GameHub's new unified-resources XML (firmware 1.3.6 / GameHub 6.0.1) bumped `CONTAINER:proton11.0-arm64x` from `version 1.0.0 / versionCode 1` to `version 1.0.1 / versionCode 2` and added a `subData` block — the only Proton container that previously lacked one. Main wine tarball (`wine_proton_11.0_arm64x.tar.zst`, md5 `ffcaf1de…44c`, 240,592,439 B) is unchanged: byte-for-byte identical between the upstream v1.0.0 release and the v1.0.1 file the user pulled today (verified via `cmp -l` exit 0 + matching SHA256).

### What changed
- New asset `f71af255a6cd68348da825dcd698df76.tzst` (32,316,723 B, md5 self-named) downloaded from `zlyer-cdn-comps-en.bigeyes.com/ux-landscape/pc_zst/f71a/f2/55/…` and uploaded to `Components` release on `The412Banner/bannerhub-api`.
- `data/containers.json` id=11: bumped `version 1.0.0 → 1.0.1`, `version_code 1 → 2`, added `sub_data` block (sub_file_name = parent's md5 `ffcaf1de…44c.tzst` per convention; sub_download_url + sub_file_md5 = `f71af255…`).
- `simulator/v2/getContainerDetail/11`: same three fields updated.
- `simulator/v2/getContainerList`: id=11 entry updated identically.

### Why
Proton 11 was the lone outlier in `containers.json` without a `sub_data` block — every other Proton/Wine container shipped one. With XiaoJi now publishing a companion tarball for it, our /v6/ clients should serve the same shape so the unpacker has access to whatever is in the new sub-file.

### Verification (live)
Pages deploy run `25572650189` succeeded in 9s after pushing master → main (master alone is not enough — Pages source is `main`).

- `GET https://the412banner.github.io/bannerhub-api/simulator/v2/getContainerDetail/11` → `version: "1.0.1"`, `sub_data` populated ✅
- `GET https://bannerhub-api.the412banner.workers.dev/v6/simulator/v2/getContainerDetail?id=11` → identical, with `sub_data` ✅
- `GET https://bannerhub-api.the412banner.workers.dev/v6/simulator/v2/getContainerList` → id=11 entry has `sub_data` + `isSteam: 1` mirror ✅
- `HEAD .../Components/f71af255a6cd68348da825dcd698df76.tzst` → 200, 32,316,723 B ✅

### Worker not redeployed (intentional)
`/v6/getContainerDetail` (worker.js:624-638) and `/v6/getContainerList` (worker.js:866-879) are pure proxies — every request runs `fetch(${GITHUB_BASE}${path})` against Pages. No worker-side cache, no inlined data. Worker picked up the new Pages content on the very next request post-deploy. Worker only needs a redeploy when its own behavior changes (new endpoint, new reshape rule, new gate). Catalog/data bumps ship via Pages alone.

---

## 2026-05-09 — `FEXCore-2605` added (commit `1f3dc69`)

New FEXCore release dropped — added to the catalog via the standard `add-components.py` pipeline.

### Catalog entry
- **id 1314, name `FEXCore-2605`, type 1** (Box64/FEX), version `2605`, version_code 1
- **file_md5** `02fc4d33b36a3cb6df08030962303405`, **file_size** 1,105,631 B (1.05 MB)
- **download_url** `https://github.com/The412Banner/bannerhub-api/releases/download/Components/02fc4d33b36a3cb6df08030962303405.tzst`
- Source `.wcp` came from `/storage/emulated/0/Download/FEXCore-2605.wcp` (1.62 MB before recompression)
- Profile inside: `type=FEXCore`, `versionName=2605`, files `system32/libarm64ecfex.dll` + `system32/libwow64fex.dll` (so it slots straight into ARM64EC + WoW64 paths just like the prior 25xx/26xx entries)

### One pre-step before running the script
The upstream `profile.json` has no `name` field — the script's fallback uses `versionName` ("2605"), which would have committed as bare `"2605"` and required a post-hoc rename commit (cf. `4f88c6b`). Patched in `name: "FEXCore-2605"` before repacking, so the entry landed with the correct prefix on first commit. No follow-up rename needed.

### Verification
- `git log --oneline -1` → `1f3dc69 feat: add 1 component(s) — FEXCore-2605`
- `git push origin master` ✅, `git push origin master:main` ✅ (Pages-from-main rule honored)
- `HEAD https://github.com/The412Banner/bannerhub-api/releases/download/Components/02fc4d33b36a3cb6df08030962303405.tzst` → 302 redirect to release-assets blob ✅
- `data/custom_components.json` entry present with id=1314 and matching md5
- `npm run build` regenerated all manifest endpoints (script wouldn't have committed otherwise)

### Worker not redeployed
Catalog-only change. Pages serves the regenerated manifest files; the worker passes through unchanged. Same pattern as the Proton 11 v1.0.1 catalog bump on 2026-05-08.

---

## 2026-05-10 — 6.0 Firmware v1.3.6 → v1.3.7 (worker /v6/ branch + sidecar)

GameHub's unified-resources XML bumped `IMAGE_FS:Firmware` to `1.3.7 / versionCode 27`. Upstream payload at `https://uxdl.mac520.com/ux-landscape/pc_zst/82e9/82/61/imagefs.zst` (md5 `82e98261…`, 171,913,811 B). 5.x stays pinned at 1.3.3 — only the 6.0 worker branch + sidecar asset move.

### What changed
- New asset `imagefs_137.zst` (171,913,811 B, md5 `82e98261e4dbe0a59bbdf2d390ac771d`) uploaded to the `Components` release alongside the existing `imagefs_136.zst` (kept for rollback) and `imagefs.zst` (5.x's 1.3.3 binary, untouched).
- `bannerhub-worker.js:830-857` inline `/v6/` JSON updated: `version 1.3.6 → 1.3.7`, `version_code 26 → 27`, `download_url …imagefs_136.zst → …imagefs_137.zst`, `file_md5 → 82e98261…`, `file_size → 171913811`. Comment bumped to "5.x stays on 1.3.3 / 6.0 gets 1.3.7."
- Pages source (`data/imagefs.json` + `simulator/v2/getImagefsDetail`) **NOT changed** — 5.x must keep serving 1.3.3 per the 5.3.5-pinned variant strategy.

### Incident note — restore during this session
Initial draft of this change clobbered `imagefs.zst` on the release with 1.3.7 content (intending to ship Pages-side too). Caught before commit: 5.x clients in the wild would have failed md5 verification against the still-1.3.3 advertised manifest. Recovery:
1. Pulled the original 1.3.3 binary from `Producdevity/gamehub-lite-api` release (mirror source from `0185126`, md5 `27fd5164…` confirmed) → re-uploaded as `imagefs.zst` to The412Banner release with `--clobber`.
2. Reverted local edits to `data/imagefs.json` + `simulator/v2/getImagefsDetail` via `git checkout`.
3. Re-uploaded 1.3.7 content under the sidecar name `imagefs_137.zst`.
Live state restored before any clients saw the broken manifest/binary mismatch (window <10 min).

### Verification (live)
Worker deployment id `a5489569985749d69a87d6b58dd01fa2`, modified `2026-05-10T23:52:55Z`.
- `GET /v6/simulator/v2/getImagefsDetail` → `version=1.3.7, vc=27, md5=82e98261…, size=171913811, url=…/imagefs_137.zst` ✅
- `GET /simulator/v2/getImagefsDetail` (5.x) → `version=1.3.3, vc=23, md5=27fd5164…, size=168943620, url=…/imagefs.zst` ✅
- `HEAD .../imagefs_137.zst` → 200, 171,913,811 B ✅
- `HEAD .../imagefs.zst` → 200, 168,943,620 B (5.x intact) ✅

### Pages not redeployed
Source-of-truth files (`data/imagefs.json`, `simulator/v2/getImagefsDetail`) deliberately not changed — only `bannerhub-worker.js` committed. The 5.x manifest published from `main` is still pinned at 1.3.3.

---

## 2026-05-10 — Catalog sync vs upstream unified XML (14 components)

Diffed live `sp_winemu_unified_resources.xml` (firmware 1.3.7 / GameHub 6.0) against our `data/sp_winemu_all_components12.xml` + `data/custom_components.json`. Deltas: 1 version bump + 13 new components. All 14 mirrored to the Components release at md5-named filenames.

### SteamAgent2 — version bump
- `data/custom_components.json` id=1295 bumped: `version 1.0.1 → 1.0.2`, `version_code 2 → 3`, `file_md5 e31b0c0e… → 216fccca808125c3c1eaf910cdbc32dd`, `file_size 970765 → 969498`, `file_name e31b0c0e….tzst → 216fccca….tzst`, `download_url` re-pointed at new asset.
- New asset uploaded; old `e31b0c0e….tzst` left on release (no rollback signal yet).

### 13 new components (ids 1315–1327)

| id | name | type | md5 | size |
|---|---|---|---|---|
| 1315 | `Fex_20260509` | 1 (FEX) | `413f44586f2fccaf93a2792f6198495d` | 1,675,639 |
| 1316 | `GOOD` | 5 (Games) | `5c4e8b3c447f3015bcadd12e94a5c23f` | 25,508,581 |
| 1317 | `Turnip_26.2.0_R3_OneUI` | 2 (GPU) | `6894a06d588c2cf485f2a3ad1103d1df` | 2,431,230 |
| 1318 | `Turnip_v26.1.0_R6` | 2 | `38b2d5398d927470009ff5a66967811d` | 3,114,826 |
| 1319 | `Turnip_v26.2.0_R3` | 2 | `65ea8b61f2313c3b76c3fac205322a4f` | 2,430,930 |
| 1320 | `dxvk-1.12.0-sarek` | 3 (DXVK) | `580d0b9ce2bead84f33c7c1a790854ba` | 9,789,808 |
| 1321 | `dxvk-1.12.0-sarek-dyasync` | 3 | `a84304e53659142aa820558a51ec7640` | 6,255,786 |
| 1322 | `turnip_v26.1.0_b10` | 2 | `05743ec8d638c60cf7329060c94d09c5` | 2,352,100 |
| 1323 | `turnip_v26.1.0_b11` | 2 | `e2b8d9aa9e3a64d67e24e0c4930d45cb` | 2,349,702 |
| 1324 | `turnip_v26.1.0_b12` | 2 | `d6c6e7719f84ba2729c58f710e4783dc` | 3,226,771 |
| 1325 | `turnip_v26.1.0_b7-git_2` (v1.0.2 vc3) | 2 | `143478654f8b8180fef596fbfa131552` | 2,318,118 |
| 1326 | `turnip_v26.1.0_b9` | 2 | `3ae13ec0a178d3eeec7005d5c1388a80` | 2,352,436 |
| 1327 | `turnip_v26.2.0_b1` | 2 | `5d92be400392ef2e16c42b4d0c24f680` | 2,432,554 |

### Source workflow
Per `ADDING_NEW_COMPONENTS.md`: appended to `data/custom_components.json`, uploaded binaries to `Components` release at the canonical `<md5>.tzst` filename, ran `npm run build` to regenerate 16+ manifest files. All 14 confirmed present in `simulator/v2/getAllComponentList` post-build (total entries 514 → 535).

### Worker not redeployed
Catalog-only change. Both 5.x (Pages pass-through) and 6.0 (`/v6/` reshape) pick up the new entries the moment Pages publishes from `main` — no worker logic touched. Same pattern as the FEXCore-2605 add on 2026-05-09 and the Proton 11 v1.0.1 bump on 2026-05-08.

### Note on `GOOD` (id 1316)
Type-5 (Games/Settings) entry with an unusually terse name and 25.5 MB payload. Flagged at diff time but added per user request — review on device before assuming it's a real settings pack vs an upstream test artifact.

### Unaddressed delta — RESOLVED below
~~`CONTAINER:wine10.6-arm64x-2` (id=6) `sub_data` mirror~~ — addressed in the follow-up commit (next section).

---

## 2026-05-10 — wine10.6-arm64x-2 `sub_data` mirror (final container without one)

GameHub's unified XML now ships `CONTAINER:wine10.6-arm64x-2` with a `subData` companion — the same shape change Proton 11 got on 2026-05-08 (`8351de2`). After this commit, all 10 containers in `containers.json` carry a `sub_data` block.

### What changed
- New asset `758f0f8dbdb9935a261ca0730f119540.tzst` (110,075,894 B / 105 MB, md5 self-named) downloaded from `uxdl.mac520.com/ux-landscape/pc_zst/758f/0f/8d/…` and uploaded to the `Components` release on `The412Banner/bannerhub-api`. Upstream `subFileName` was `10.6_arm64x-2_warm_up_pkg.tzst`; mirrored under the canonical md5-named filename per release convention.
- `data/containers.json` id=6 (`wine10.6-arm64x-2`): added `sub_data` block — `sub_file_name = aeb9ee7dccf887d5d543963ce823f1cc.tzst` (parent md5 per convention), `sub_download_url` pointing at our `758f0f8d….tzst`, `sub_file_md5 = 758f0f8dbdb9935a261ca0730f119540`.
- `simulator/v2/getContainerDetail/6` + `getContainerList` regenerated via `npm run build` — main wine tarball untouched.

### Why
wine10.6 was the only outlier in `containers.json` without a `sub_data` block after the Proton 11 fix. Upstream now publishes one. Our `/v6/` clients should serve the same shape so the unpacker has access to whatever's in the warm-up package (likely fast-path runtime preload, naming consistent with the Proton 11 sidecar).

### Verification (live, commit `bbb4381`)
Pages build status `built`. Verified end-to-end:
- `GET /v6/simulator/v2/getContainerDetail?id=6` → `sub_data` populated with the new sidecar URL/md5 ✅
- `GET /simulator/v2/getContainerList` (5.x via Pages) → id=6 entry includes the `sub_data` block ✅
- `HEAD .../Components/758f0f8dbdb9935a261ca0730f119540.tzst` → 200, 110,075,894 B ✅
- Main wine tarball `wine_10.6_arm64x-2.tar.zst` (md5 `aeb9ee7d…`, 220,083,873 B) unchanged.

All 10 containers in `containers.json` now carry a `sub_data` block. `wine10.6-arm64x-2` was the last outlier post-Proton-11.

### Worker not redeployed
Container endpoints are pure pass-throughs (`/v6/getContainerDetail` proxies Pages verbatim; `/v6/getContainerList` only adds the `isSteam` camelCase mirror). Same deploy pattern as Proton 11 v1.0.1 catalog bump on 2026-05-08.

---

## 2026-05-10 — Fix: 5.x `getComponentList` server-side type filter

Reported by user investigating `gamehub.lite` (5.3.5 BannerHub variant): GPU drivers / DXVK / VKD3D / Box64 tabs all showed every component instead of the type-specific subset. Root cause: the worker's 5.x branch on `/simulator/v2/getComponentList` proxied to Pages and dropped the `?type=N` query string. Pages is static, ignores query strings, and serves a single 535-entry file. Every tab got the same payload back.

### Why the regression happened
Pre-self-host (before `0185126` on 2026-03-26): worker forwarded to the upstream Xiaoji API, which filtered server-side. Self-host pivot moved the catalog to GitHub Pages — at that point the 5.x branch became a dumb pass-through. The `51ee1c0` v6-gate split on 2026-05-02 codified the dumb pass-through for 5.x and left filtering in place only on the `/v6/` branch (where the worker also reshapes/remaps/allowlists). Two months of every 5.x picker showing the full catalog.

### What changed
- `bannerhub-worker.js:731-757`: hoisted the `type` parsing out of the 6.0-only block (parses query string for GET, JSON body or form-urlencoded body for POST — both paths use the same parser).
- New 5.x branch applies `all.filter(i => i.type === type)` against the parsed catalog from Pages, then re-stringifies `list` to preserve the legacy 5.x list-of-string wrapper (`parseListField` comment block).
- No reshape, no Steam remap, no allowlist on 5.x — those remain 6.0-only. `is_ui` / `gpu_range` and snake_case fields stay intact.
- 6.0 branch (lines 770+) unchanged structurally — it now re-uses the hoisted `type` variable.

### Verification (live, deploy `49a92d4d5c084238989b31ba53aac469`)
Every type 1–7 returns only its own type, list shape stays stringified:
- `5.x ?type=1` → 34 entries, all type 1
- `5.x ?type=2` → 265 entries, all type 2
- `5.x ?type=3` → 44 entries, all type 3
- `5.x ?type=4` → 7 entries, all type 4
- `5.x ?type=5` → 65 entries, all type 5
- `5.x ?type=6` → 117 entries, all type 6
- `5.x ?type=7` → 3 entries, all type 7
- `5.x` (no `?type`) → all 535 entries (matches upstream pass-through behavior)
- `5.x POST form-urlencoded type=3` → 44 entries, all type 3 (covers POST clients too)
- `6.0 /v6/ ?type=2` → 265 entries, real array (not stringified), reshape applied ✅
- `6.0 /v6/ ?type=8` → 1 entry (`steam_client_0403`), Steam allowlist intact ✅

### Client side: no app update needed
The two app variants route to separate URL paths (5.x → bare, 6.0 → `/v6/…`) at the smali redirect level. Both already exist in the wild today — the fix lives entirely in the worker's `is60`-false branch. `gamehub.lite` users see filtered tabs on the next request after deploy.

## 2026-05-11 — getLocalGameDetail forwarded with auth headers (commit `79d3d0d`, deploy `5fd6c6a7b34c47b8b7bd75b091fb43ba`)

### Symptom
Imported PC games on the patched 6.0 client (`bannerhub-revanced` gamehub-602-build) landed with no cover art. Vanilla GameHub 6.0 (Genshin-package APK talking directly to `landscape-api.vgabc.com`) showed full cover art on the same imports.

### Investigation
- Smali analysis of `GameHub_6.0.2.apk` traced the import flow:
  - `Lmf0;` = `AppNavKey.PcImportEdit` (carries only `exePath`)
  - `Lj46;` = the Compose lambda dispatching the screen — reads `Lmf0;->d` and calls `Ljc5;->e(String, Lq3g;, Composer, Int)V`
  - `Lq3g;` = the ViewModel — Koin-injected, holds `LocalGameInfoSvrEntity` recognition result
- `q3g.smali:1203` literal `"simulator/getLocalGameDetail"` followed at `:402-407` by construction of `LocalImportGameArgs(fileStr, otherFileStr)` (POST body).
- Response schema `LocalGameInfoSvrEntity` (`com/xiaoji/egggame/game/domain/model/`) has `game_id`, `steam_appid`, `name`, `logo`, `cover_image`, `back_image`, `description`, `square_image`, `hero_capsule` — every cover-art field is here.
- Vanilla logcat (`com.miHoYo.GenshinImpact`) captured `DISPOSE overlay=mf0` twice for two imports, plus in-flight Ktor CancellationException at dismissal — confirming the call fires. URL itself isn't logged (Ktor logging off on vanilla), but smali evidence was airtight.

### Root cause
The worker's `/v6/` prefix is stripped at line 507. `/v6/simulator/getLocalGameDetail` then hit the generic fall-through proxy (line ~984 "All other routes") which forwards body with token-swap but sets `forwardHeaders = { 'Content-Type': 'application/json' }` — every client header (`clientparams`/`sign`/`time`) gets dropped. Upstream `landscape-api.vgabc.com/simulator/getLocalGameDetail` treated the request as anonymous and returned empty `data` (no recognition match), so the ViewModel surfaced a blank entity → blank cover art on the library tile.

### Fix
Added `url.pathname === '/simulator/getLocalGameDetail'` to the existing vjoy/Scheme authenticated-proxy condition (block originally added in `0792400`). That branch already does the right thing:
- copies inbound headers verbatim (drops only Host/CF/X-Forwarded-* hop-by-hop)
- injects `token: <bannerhub_token>` from KV
- for POSTs with a body-side `token` field, swaps + re-signs (no-op here — `LocalImportGameArgs` has only `file_str` + `other_file_str`)
- forwards to `landscape-api.vgabc.com/simulator/getLocalGameDetail` and pipes the response back

### Verification (live)
Device-confirmed on the `com.xiaoji.egggame` build (`bannerhub-revanced` gamehub-602-build) immediately after deploy — imported games now show cover art.

### 5.x impact
Zero. BannerHub 3.7.1 (5.3.5) talks straight to `landscape-api*.vgabc.com` — the worker isn't on its network path. Even if a 5.x client somehow hit the worker, the new condition fires only for the literal path, and 5.x's import flow has its own code path unrelated to the worker.

### Release-notes ripple
The "Imported games have no cover art by default" warning carried in `bannerhub-revanced` v1.0.0-600 / v1.0.1-601 / v1.0.0-602 release notes should be dropped from the next ReVanced stable's notes — fix is server-side and live for all existing patched APKs without an app update.

## 2026-05-11 — Custom DXVK additions (1.9.4-async, 1.7.3-async) — Helio G99 fallback

### Why these specifically
Added **for Helio G99 users** (MediaTek SoC, Mali-G57 MC2 GPU — e.g. Retroid Pocket 4 Pro, Anbernic RG556, AYN Odin Lite, base Retroid Pocket 5). The existing DXVK lineup in BannerHub-API starts at 2.3.1 and is heavy on `gplasync` / `arm64ec` variants — those don't run well on Mali-G57-class silicon. The simpler 1.x async path is known to work where 2.x regresses.

When triaging "DXVK crashes / glitches on G99" reports going forward: point users at id=1328 (1.9.4-async) first, id=1329 (1.7.3-async) as a further fallback.

### Source files
User had two older async-patched DXVK builds in Winlator `.wcp` format (xz-compressed tar) sitting in the Termux home: `dxvk-1.9.4-async.wcp` and `dxvk-1.7.3-async.wcp`.

### Why they needed repacking
The `.wcp` files are Winlator container packages with a `profile.json` manifest at the root + `system32/`/`syswow64/` DLL trees. BannerHub-API's existing DXVK entries are GameHub-format `.tzst` — same DLL layout, zstd compression, **no manifest** (GameHub's container import just unpacks the trees straight into the wine prefix; a stray `profile.json` would land as noise in the prefix root). Wrapping format was the only blocker — DLLs (`d3d9`/`d3d10`/`d3d10_1`/`d3d10core`/`d3d11`/`dxgi`) are valid PE binaries that drop in unchanged.

### Repack pipeline
For each file:
1. `xz -dc <file>.wcp | tar -xf -` into a scratch dir
2. Delete `profile.json`
3. `tar -cf - system32 syswow64 | zstd -19 -o <tmp>.tzst`
4. `md5sum <tmp>.tzst` → use that as the final filename per repo convention
5. `gh release upload Components <md5>.tzst --repo The412Banner/bannerhub-api`

### Resulting entries (`data/custom_components.json`)
| id | name | display_name | md5 | size |
|---|---|---|---|---|
| 1328 | DXVK-1.9.4-async | DXVK-1.9.4-async | `acb1b8a2f851285747443a0d4b7b0629` | 3,346,298 B |
| 1329 | DXVK-1.7.3-async | DXVK-1.7.3-async | `f74724b310f964e761f123b9863a815c` | 3,167,495 B |

Both `type: 3`, `version_code: 1`. Built with `npm run build` — `dxvk_manifest` total 44 → 46.

### Push
- Commit `a356629` on `master` (after rebase onto upstream's Discord README commit `0cbf752`).
- `master` fast-forwarded onto `main` (Pages serves from `main`).
- Live verification: `curl https://raw.githubusercontent.com/The412Banner/bannerhub-api/main/components/dxvk_manifest` → total 46, both IDs visible. Asset URLs return HTTP 302 (redirect to release CDN).

### Notes
- Author email amended from `d.roethlein88@gmail.com` (private on GitHub, push rejected) → `205237651+The412Banner@users.noreply.github.com` to match prior commits.
- These are older DXVK series (1.x) — most existing entries are 2.3.1 / 2.4.1 / 2.5.x / 2.6.x / 2.7.1. Specifically chosen to give Helio G99 / Mali-G57-class users a working DXVK path (see "Why these specifically" above).
- For BannerHub release-notes ripple: the next stable's notes should mention these as "older DXVK builds for Mali-based devices like Helio G99" rather than just generic legacy fallbacks.


## 2026-05-12 — base.tzst v1.0.0 → v1.0.1 mirror (40 MB → 83 MB)

Upstream GameHub 5.3.5 / 6.0 catalogs ship base id=8 at version 1.0.1 (md5 `96df60f3cff612a9747e56cae9d4c6e8`, 83,424,612 B). We were still serving 1.0.0 (3d5c31b…4d7, 40,612,198 B) on every client path. Verified by inspecting a fresh GameHub 5.3.5 install's `<string name="base">` row.

### Asset upload
- Downloaded from upstream CDN: `https://uxdl.mac520.com/ux-landscape/pc_zst/96df/60/f3/96df60f3cff612a9747e56cae9d4c6e8.tzst`
- md5 + size verified against upstream JSON before upload
- Uploaded to `Components` release as **`base_v101.tzst`** (version-suffixed for rollback, same pattern as `imagefs_137.zst`)
- Original `base.tzst` (40 MB v1.0.0) kept on the release as rollback artifact

### Metadata bumped in nine files (lockstep)
1. `components/games_manifest`
2. `components/downloads`
3. `data/sp_winemu_all_components12.xml` — inner entry + outer wrapper `"version":"1.0.0"` → `"1.0.1"`
4. `simulator/executeScript/generic`
5. `simulator/executeScript/generic_steam`
6. `simulator/executeScript/qualcomm`
7. `simulator/executeScript/qualcomm_steam`
8. `simulator/v2/getComponentList`
9. `simulator/v2/getAllComponentList`

Field changes per row: `download_url` → `…/Components/base_v101.tzst`, `file_md5` → new, `file_size` → 83424612, `version` → 1.0.1, `version_code` → 2. **`file_name` stays "base.tzst"** (matches upstream convention; clients save local file as base.tzst regardless of URL).

### Affected clients
- **BannerHub 3.7.1** (GameHub 6.0.x base) — `/v6/` static-proxy path (worker ~660-668 just reshapes, doesn't pin a separate base)
- **Bannerhub-Lite 1.0.2** (GameHub Lite 5.1.4 base) — `executeScript` Add-Game path

### Push
- Commit `9889ff6` on `main` → `master:main` push for Pages parity (Pages source = `main`).
- Worker NOT redeployed — its `/v6/` base handling routes through Pages.

### Lockstep gotcha
Same trap as the imagefs `c8d7f21` miss (executeScript variants left stale for ~22 h). The script that did this bump (`base-tzst-mirror/bump.py`) enumerates all 9 paths from a single grep on the old md5 — anyone updating base metadata in the future should do the same enumeration to avoid leaving half the clients on the old version.

## 2026-05-12 — reshapeFor60 fixes for 6.0 install failure on base v1.0.1

User hit `task install components failed` immediately on Brawlhalla launch in `bannerhub-revanced` 6.0.2 (against the BannerHub Worker). Same container settings worked on vanilla GameHub 6.0.2 / 6.0.4 talking to upstream Xiaoji, and on BannerHub 3.7.2 (which goes through our 5.x passthrough), so the failure was scoped to the `/v6/` reshape path.

### Diagnostic — upstream XML comparison
User shared their on-device `sp_winemu_unified_resources.xml` from a working vanilla 6.0.x install. Field-by-field diff against our `/v6/` `getComponentList` response on `base`:

| Field | Upstream `/v6/` | Our `/v6/` before fix |
|---|---|---|
| `fileType` | 4 | **0** |
| `is_steam` / `isSteam` | 0 (present) | **missing** |
| All other fields | match | match |

Distribution across all 351 upstream COMPONENT entries: **fileType=4 universally**, **isSteam=0 universally** (zero special-cases, including the Steam client itself and base). The pre-existing `reshapeFor60` comment hardcoding `base.fileType = 0` ("Wine prefix scaffold so unpacker uses base-layout extractor") was either always wrong on 6.0 or specifically wrong for base v1.0.1 (83 MB) — empirical upstream evidence says fileType=4 for base and works.

### Fixes (both in `reshapeFor60`, `/v6/`-only by construction)

- **`e.fileType = 4` unconditionally** — replaced the `(e.name === 'base') ? 0 : 4` special-case. Was previously a no-op anyway since source XML defines `fileType=0` everywhere and reshape only fired when undefined.
- **`if (e.is_steam === undefined) e.is_steam = 0`** — restores the field upstream sends. Snake-case on the wire; kotlinx `@SerialName` maps it to camelCase `isSteam` in the on-device cache. Previously omitted on the assumption that 6.0 doesn't read `isSteam` on components — but missing-field vs zero-value is a real difference for kotlinx-strict.

### Deploys
- `e86579f9…` — fileType=4 only
- `3ee299be…` — fileType=4 + is_steam=0

### Verification
- `/v6/` base: `fileType=4`, `is_steam=0`, MD5 `96df60f3…` unchanged
- `/v6/` GPU drivers: `fileType=4` (also flipped from previously-incorrect 0)
- `5.x` base: untouched — still passes raw upstream XML through (`gpu_range` present, `fileType` absent), reshape never fires for non-`/v6/` traffic
- BannerHub 3.7.2 and other 5.x clients unaffected

### Pending verification
Brawlhalla launch on a freshly-rebuilt `bannerhub-revanced` 6.0.4 APK. User noted comparison was muddied by mixing 6.0.4 upstream XML with a 6.0.2 ReVanced build; rebuild against 6.0.4 base in progress. If install task still fails after this fix, next suspect is the `executeScript` handler which is currently shared between 5.x and 6.0 (no `/v6/` gate) and serves the static catalog files verbatim with `fileType=0`.

## 2026-05-12 — Full upstream-XML audit + 2 follow-up `/v6/` reshape fixes

User shared their on-device `sp_winemu_unified_resources.xml` from a working vanilla GameHub 6.0.x install (362 entries: 351 COMPONENT + 10 CONTAINER + 1 IMAGE_FS). Ran a full field-by-field audit of every shared entry between upstream and our `/v6/` response.

### Headline findings

**Set parity is clean:**
- 0 upstream entries missing from our `/v6/` response
- 176 BannerHub additions on top (Proton 11, custom Turnips, Box64/FEX variants, etc.)

**`fileType` + `isSteam` now match upstream after this morning's two fixes (`ac8ae07`):** all 351/351 entries align.

**Two real divergences remained after the morning fixes:**

1. **`status` flag mismatch on 9 entries.** Upstream marks `status=1` on the "currently active / recommended" component per category — base, steam_client_0403, vkd3d-2.12, dxvk-2.3.1-async, vcredist2019, SteamAgent2, Fex_20260509, Turnip_v26.2.0_R3, turnip_v26.1.0_R4. We were defaulting every component to `status=0`. The install task likely gates "use this as the default for new containers" on this flag, which would have explained why base + steam_client_0403 + vkd3d-2.12 (the trio a Steam game install touches first) didn't auto-install cleanly even after `fileType=4` landed.

2. **17 `.yml` install scripts on stale versions.** Upstream had bumped vcredist2005/8/10/12/15/22, mono / mono-10.1.0 / mono-10.3.0 / mono-10.4.1, gecko, physx, K-Lite, VulkanRT, XLiveRedist, cjkfonts, oalinst to fresher versions (most v1.0.1, K-Lite to v1.0.6, vcredist2015 to v1.0.2, mono-10.4.1 to v1.0.3). Our static catalog still served v1.0.0 across the board.

### Fixes

**Status fix** (`cb225c3`, deploy `fd8eaf4047324ae3acb44fb391a189b2`):
- New `UPSTREAM_STATUS1` `Set<string>` of 9 names in the worker.
- `reshapeFor60` forces `e.status = UPSTREAM_STATUS1.has(e.name) ? 1 : 0`.
- Hardcoded set, needs manual maintenance if upstream rotates a recommended component.

**`.yml` install-script sync** (`b0f23ac`, deploy `6fbbdfc71b59476b894fe075ef173b32`):
- Downloaded all 17 upstream `.yml` files from `uxdl.mac520.com` (public CDN, MD5-verified).
- 16 unique blobs (mono-10.1.0 and mono-10.4.1 share the same `294e578d…` content).
- Uploaded to the `Components` GitHub release with md5-named filenames.
- New `UPSTREAM_YML_OVERRIDES` `Map<string, OverrideSpec>` in the worker.
- `reshapeFor60` looks up by name and overrides `file_md5`, `file_size`, `file_name`, `version`, `version_code`, `download_url` when a match is found.

Both fixes are `/v6/`-only by construction (`reshapeFor60` only runs inside the `is60` branch). 5.x clients verified untouched on live deploy — still serve the pre-existing v1.0.0 `.yml` entries via the raw passthrough.

### Remaining intentional differences (not bugs)
- `downloadUrl` on 351/351 differs (github.com vs uxdl.mac520.com) — by design, same MD5 = same content.
- `id` on 46 entries differs (different numbering schemes between BannerHub and upstream; doesn't affect functionality).
- `fileName` cosmetic mismatches (`name.tzst` vs `<md5>.tzst`) on 52 entries.
- `displayName` set to component name in our catalog, upstream uses empty string — cosmetic.
- 4 game-settings entries (ACM, DeadSpace(2023), WRC10, id Software) categorized as type=6 in our catalog vs type=5 upstream — could cause UI misplacement under the "Games" category but not install failure. Not fixed in this round.
- 2 binary mismatches outside the .yml sync: `steamagent` (same size, different MD5 — possibly repacked) and `vkd3d-proton-3.0.1` (real size diff: upstream 5.0 MB, ours 3.1 MB). Left alone pending decision on whether to mirror.

## 2026-05-12 (afternoon) — getDefaultComponent steamClient swap on /v6/ (Steam library launch fix)

After the morning's catalog reshape fixes (`ac8ae07`/`cb225c3`/`b0f23ac`), user rebuilt `bannerhub-revanced` against 6.0.4 (CI run 25747297755 all green) and retested Brawlhalla. **Still failed** with "task install components failed" — but now scoped to *Steam-library game launches* specifically (Brawlhalla came in via Steam-sync after logging into Steam in-app).

### Triage
- Failure timing: after "checking environment and firmware" passes, during the component-install pass.
- Implication: container/imagefs preflight succeeded; launch task moved on to fetching install spec.
- Grep of 6.0.4 smali (`/tmp/gh604_smali/`) for `"simulator/"` URL strings surfaced `/simulator/v2/getDefaultComponent` — an endpoint the worker didn't have an explicit handler for. Curl confirmed it falls through to the `GITHUB_ROUTES` static proxy on both 5.x and `/v6/`, returning the per-game default component bundle.
- Static file returns `steamClient = { name: "steam_9866233", type: 7, download_url: ".../steam_9866233.tar.zst" }`.

### Root cause
The default-Steam-client record references `steam_9866233` (type=7). On `/v6/` this entry is unreachable two ways:
- `keepForSteamClientAllowlist60` (allowlist = `{steam_client_0403}`) drops `steam_9866233` from `/v6/getComponentList`.
- `remapSteamFor60` promotes type=7 → type=8, so the type-7 bucket on `/v6/` is empty by design.

The 6.0 launch task fetches the default bundle, tries to validate/install `steam_9866233`, finds nothing matching in `/v6/` catalog, and surfaces the generic failure toast. EXE-import launches don't hit this code path (no Steam client needed), which is why earlier PC-game launches looked fine.

### Fix (commit `dc04845`, deploy `7afe847cc5224e1482b99743b1b46784`)
New handler `if (is60 && url.pathname === '/simulator/v2/getDefaultComponent')` — fetches the static file, then rewrites `data.steamClient` to a fully reshape-compatible `steam_client_0403` record:

```
name: 'steam_client_0403'
type: 8
fileType: 4
status: 1
file_md5: '08c498cef5c15d710d253681751068c1'
file_size: 64897035
download_url: '.../Components/08c498cef5c15d710d253681751068c1.tzst'
version: '1.0.0'
version_code: 1
```

All other fields in the bundle (`dxvk`, `vkd3d`, `container`, `gpu`, `translator`) pass through untouched.

### Verification (live)
- `/v6/`: `steamClient.name = steam_client_0403`, type 8, fileType 4, status 1, md5-named url ✅
- 5.x (no `/v6/` prefix): `steamClient.name = steam_9866233`, type 7, original url ✅ untouched

### Pending verification
User to retry Brawlhalla launch on bannerhub-revanced 6.0.4 with this fix live. Steam library should now launch end-to-end since the install task gets a self-consistent Steam client record on the `/v6/` catalog.

## 2026-05-12 (late afternoon) — `/v6/` executeScript missing required `deps` field

After round-4 deploy, user retried Brawlhalla launch — still `task install components failed`. The Steam library launch was now getting past the Steam-client-record check (round 4 unblocked that), but failing elsewhere in the install pass.

### Triage — decompile the 6.0.4 deserializer
The `simulator/executeScript` response is consumed by 6.0's kotlinx `GameEnvConfigEntity$$serializer`. Decompiled `/tmp/gh604_smali/smali_classes4/com/xiaoji/egggame/common/winemu/data/bean/GameEnvConfigEntity$$serializer.smali` and parsed the descriptor — each `Lr0h;->j(String name, boolean optional)` call defines a field, with `optional=false` meaning kotlinx-strict throws `MissingFieldException` if the field is absent.

**Required fields per the 6.0.4 schema:**
- `component`, `deps`, `container`, `imagefs`

**Optional fields (kotlinx defaults apply if missing):**
- `translations`, `controller`, `audio_driver`, `start_param`, `launch_windowed_mode`, `environment`, `cpu_limitations`, `directx_panel`, `video_memory`, `surface_format`, `disable_window_manager`, `gameId`, `totalDownloadSize`

Our static executeScript variants (`simulator/executeScript/{generic,qualcomm}{,_steam}`) carry every required field **except `deps`** — that field was added to the 6.0 schema, post-dating our static files (which were authored for 5.x). 5.x's lenient deserializer never cared about the absence, so same response continued to work there.

### Fix (commit `a15d319`, deploy `fc803738469948a4b84c089c55f5bce7`)
`/v6/`-only injection in the `/simulator/executeScript` handler: after fetching the static response, if `is60` is set, parse, inject `data.deps = []` when missing, and return. 5.x branch unchanged — still serves the raw text passthrough.

The other 4 missing fields are optional with kotlinx defaults — kotlinx-strict's `@Serializable data class GameEnvConfigEntity(...)` provides defaults for `OPTIONAL` fields, so they don't need to be in the wire response.

### Verification (live)
- `/v6/` executeScript Steam-game: `deps` present, value `[]` ✅
- 5.x executeScript Steam-game: `deps` still absent ✅ (untouched)
- 5 component records still returned unchanged

### Pending verification
User to retry Brawlhalla launch on bannerhub-revanced 6.0.4 with rounds 1–5 all live. This was the missing-required-field shoe to drop after the catalog and getDefaultComponent fixes.
