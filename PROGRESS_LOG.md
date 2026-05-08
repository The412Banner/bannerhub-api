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

### Verification pending
After commit/push, GitHub Pages serves the updated static files, and the worker's `/v6/getContainerDetail?id=11` + `/v6/getContainerList` will reflect 1.0.1 with sub_data. No worker code change needed — both endpoints fetch the static files via `GITHUB_BASE`.
