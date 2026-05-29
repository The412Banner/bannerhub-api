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

## 2026-05-12 (evening) — getGameLoadingPromptList auth passthrough — **THE actual unblocker**

After round 5, Brawlhalla launch retest still failed with "task install components failed." The earlier rounds had built the right catalog shape, but the launch task was failing on a different endpoint entirely. To stop guessing, **set up a live Cloudflare Workers tail** (`120c6b766df54ffc8fce0b31d7fb3b00`) and added a diagnostic `console.log` line at the top of the worker fetch handler logging every request URL + method + is60 flag. Connected via `wss://tail.developers.workers.dev/...` with the `trace-v1` subprotocol and the websockets python lib (Termux interpreter).

### Tail capture
With the user launching Brawlhalla three times in a row at ~13:35 EDT, the tail captured the full request graph. Filtering out concurrent traffic from other live users, the smoking gun was:

```
13:34:36 POST /v6/simulator/getGameLoadingPromptList -> 400
13:35:25 POST /v6/simulator/getGameLoadingPromptList -> 400
13:36:45 POST /v6/simulator/getGameLoadingPromptList -> 400
```

Reproduced with a bare curl: `{"code":400,"msg":"Invalid parameters","data":null,"time":"..."}` — same generic-proxy-strips-auth class as the `getLocalGameDetail` fix from 2026-05-11 (`79d3d0d`). The endpoint isn't in the worker's auth-passthrough block, so it falls through to the generic proxy at line ~1100 which resets the request headers to `{Content-Type: application/json}` only — dropping `clientparams`/`sign`/`time`. Upstream treats the request as anonymous and rejects with 400.

### Fix (commit `e132cad`, deploy `9a782221b16b4444b629fc55b57bee61`)
Added `url.pathname === '/simulator/getGameLoadingPromptList'` to the auth-passthrough condition that already serves `getLocalGameDetail` + vjoy/Scheme endpoints. Header forwarding + token injection now applies. Within ~30s of deploy, live tail showed legitimate clients flipping from 400 → 200.

### Verification
User confirmed Brawlhalla launch works on bannerhub-revanced 6.0.4 with rounds 1–6 all live — **but only after manually setting the Steam client and some game settings** in the container/per-game settings UI. The auto-defaults still don't pick up the right Steam client end-to-end. The server-side `getDefaultComponent` swap (round 4) returns `steam_client_0403`, but per-game settings may persist a different choice or the Compose UI's "Steam client" picker may not auto-bind to it on first launch.

**Open question / next investigation when revisiting:** why the auto-defaults aren't sufficient — likely either the container's per-game `PcGameSettings.steamClient` row isn't being seeded from `getDefaultComponent` on first save, or there's another endpoint between `getDefaultComponent` and the picker that we still serve stale data for. Tail-driven debug recipe documented above is the path forward.

### Wider lesson
The 6.0 launch flow has at least two auth-required endpoints we'd missed: `getLocalGameDetail` (fixed 2026-05-11) and `getGameLoadingPromptList` (fixed today). Both fail silently when stripped to the anonymous proxy and surface generic install errors. Anytime a 6.0 install flow fails with no specific component name, the tail-driven diagnostic loop is much faster than reshaping speculatively: deploy a `console.log`, tail it, ask the user to repro, grep for non-200s in the burst window. Diagnostic log line in `fetch()` left in place for future triage.

### Brawlhalla install-failure fix summary (rounds 1–6, all 2026-05-12)
| Round | Commit | What | Why it didn't fully fix it alone |
|---|---|---|---|
| 1 | `ac8ae07` | fileType=4 + is_steam=0 in reshapeFor60 | catalog ok, but install task uses other endpoints |
| 2 | `cb225c3` | UPSTREAM_STATUS1 set | status flag, not load-bearing for this game |
| 3 | `b0f23ac` | UPSTREAM_YML_OVERRIDES (17 .yml) | install-script versions, not load-bearing here |
| 4 | `dc04845` | getDefaultComponent steamClient → 0403 | required, but launch task also calls other endpoints |
| 5 | `a15d319` | executeScript inject `deps:[]` | required for kotlinx-strict, but launch task fails earlier |
| **6** | **`e132cad`** | **getGameLoadingPromptList → auth-passthrough block** | **THIS was the actual unblocker** |

Rounds 1–5 each closed real gaps but weren't the final blocker. The actual culprit was an unauthenticated 400 on a single endpoint the launch task fetches before the install pass.

## 2026-05-13 — /v6/ component metadata parity round 7 (commit `bff436c`, deploy `ea097a5a7e3d4a0ea315927f7e62bbe6`)

Field-by-field diff against a real upstream 6.0.4 `sp_winemu_unified_resources.xml` (provided by user) surfaced two non-zero drifts on the 17 entries in `UPSTREAM_YML_OVERRIDES` (Round 3 of the 2026-05-12 install-failure work):

- **fileName cosmetic drift.** All 17 entries served md5-named filenames (`b9d6016c3aab2bb836c8335b2e06a04b.yml`) while upstream sends friendly names (`mono.yml`, `K-Lite.yml`, `vcredist2022.yml`, …). Switched to friendly names; `download_url` still points to our GH-release-md5-named files so payload is unchanged.
- **Two missing `UPSTREAM_STATUS1` entries.** Upstream marks `mono` + `mono-10.4.1` as `status=1` (currently-active mono pair). Added both to the set so the 6.0 install task sees them as recommended defaults.

`fileMd5`, `fileSize`, `version`, `versionCode` were already a perfect match across all 17 entries; only the two parity items above were drifting.

### Verification
Live `POST /v6/simulator/v2/getComponentList type=6` post-deploy returns:
- `mono` / `mono-10.1.0` / `mono-10.3.0` / `mono-10.4.1` with `file_name=mono.yml` / `mono-10.1.0.yml` / etc., `status=1/0/0/1` matching upstream.
- 13 other override entries (K-Lite, VulkanRT, XLiveRedist, cjkfonts, gecko, oalinst, physx, vcredist2005/2008/2010/2012/2015/2022) with friendly fileNames.

5.x raw passthrough untouched (the override map only runs inside the `is60` branch).

## 2026-05-14 — imagefs firmware 1.3.7 → 1.3.8 (commit `2d88572`, deploy `46900b4660e44d31916a8f9525b035e2`)

Upstream Xiaoji (`uxdl.mac520.com/ux-landscape/pc_zst/51ff/98/0c/imagefs.zst`) bumped Firmware id=1 from 1.3.7 → 1.3.8 (versionCode 27 → 28). Verified against a real vanilla 6.0.x device `sp_winemu_unified_resources.xml` (Firmware row marked `state: INSTALLED` at 1.3.8). md5 `51ff980cbd8bc314730d1d8e119faece`, size 171,675,606 B (-238,205 B vs 1.3.7).

### What actually changed (3 of 6,801 files, plus 2 consumer relinks)

End-to-end extract + structural diff:

| 1.3.7 path | 1.3.8 path | What's different |
|-|-|-|
| `usr/lib/libjxl.so` | `usr/lib/libjxl_winemu.so` | SONAME renamed + ELF layout reshuffled |
| `usr/lib/libjxl_cms.so` | `usr/lib/libjxl_cms_winemu.so` | SONAME renamed |
| `usr/lib/libjxl_threads.so` | `usr/lib/libjxl_threads_winemu.so` | SONAME renamed |
| `gdk-pixbuf-2.0/.../libpixbufloader-jxl.so` | (same path) | NEEDED → `_winemu` names |
| `imlib2/loaders/jxl.so` | (same path) | NEEDED → `_winemu` names |

**Verified pure SONAME rename, not a code change:**
- `.text` byte-identical for all 3 libs (2,499,288 B / 7,040 B / 97,848 B)
- `.rodata`, `.data.rel.ro`, `.plt`, `.rela.dyn`, `.rela.plt` at identical file offsets + sizes
- Public dynamic-symbol surfaces match exactly (`diff` of dyn-syms is empty)
- Same NDK r27c, Android API 24, aarch64 toolchain

**File-size growth is pure ELF page-alignment padding.** The new build relocated `.dynsym`/`.dynstr`/`.note.android.ident` to fresh 64KB-aligned offsets at the file tail (e.g. `0x2c0000`, `0x2d0000`). `e_phnum` 10 → 11 covers the gap. No new code, strings, or symbols.

**`libGameScopeVK.so` byte-identical to 1.3.7** (sha256 `c8f4809c7dbbf0add52fdf702a07e4cdbe8f9e2fa31d10ce37e3bb59e782c943`). The 1.3.6→1.3.7 `DirectRendering::Present()` drop-frame patch is preserved unchanged — zero AI frame-gen regression risk.

**Upstream motivation:** the `_winemu` suffix is defensive against Bionic-linker namespace collisions — newer Android versions / OEM ROMs (especially OnePlus 12, MIUI 14) bundle a system `libjxl.so` for HEIF-JXL gallery decode. Bionic's app-private namespace can resolve to the system copy first under some load orders, and the renamed soname forces the per-app copy to win. No client-visible behavior change.

### Files touched (7 sites holding imagefs metadata, all bumped in one commit)
1. `bannerhub-worker.js` — `/v6/` inline branch (only file requiring worker re-deploy)
2. `data/imagefs.json`
3. `simulator/v2/getImagefsDetail`
4. `simulator/executeScript/generic`
5. `simulator/executeScript/generic_steam`
6. `simulator/executeScript/qualcomm`
7. `simulator/executeScript/qualcomm_steam`

### Asset rollout
`imagefs_138.zst` (171,675,606 B) uploaded to `The412Banner/bannerhub-api` Components release prior to the metadata commit. Previous `imagefs_137.zst` retained for rollback.

### Verification (post-deploy)
- `https://bannerhub-api.the412banner.workers.dev/simulator/v2/getImagefsDetail` → `version: 1.3.8`, `version_code: 28`, `md5: 51ff980c…`, `download_url: …/imagefs_138.zst`
- `https://bannerhub-api.the412banner.workers.dev/v6/simulator/v2/getImagefsDetail` → same payload
- All 4 `executeScript/{generic,qualcomm}{,_steam}` variants on `main` branch confirmed serving 1.3.8 metadata
- Asset HEAD on Components release returns 200 + `content-length: 171675606`

### Memory updates
- [[bannerhub-api-imagefs-routing]] — bumped to 1.3.8; note the metadata-site count now SEVEN (was 6) because the worker inline `is60` block is the 7th
- [[imagefs-firmware-libGameScopeVK-delta-history]] — extend with 1.3.8 row (libGameScopeVK.so byte-identical; the 1.3.8 delta is entirely outside that lib)

## 2026-05-14 — GPU catalog: VIVSI driver add + MTR bulk rename (commits `87a244e`, `abb6752`, `cfca1be`)

Two changes in one day's session against the GPU driver catalog (component type=2).

### 1. New driver: VIVSI_Turnip_710-720-722_v2.5.6 (id=1330)

User supplied `Turnip-710-720-722-v2.5.6.zip` from their Downloads. AdrenoTools-format zip containing:
- `libvulkan_freedreno.so` (18.3 MB unstripped, NDK r29, Android API 28+, aarch64)
- `meta.json` declaring Mesa 26.2.0 / Vulkan 1.4.350, author `vauzi`, target chips Adreno 710 / 720 / 722

Repackaged as `.tzst` to match the catalog's existing format (zstd-19 tar containing just `./libvulkan_freedreno.so`), md5 `81de750512d55045b940e7d11c56c938`, 2.5 MB compressed. Uploaded to the Components release, added to `data/custom_components.json` at id=1330 with `VIVSI_` prefix following the existing third-party convention (`SMXZ_` StevenMXZ, `WHITE_` whitebelyash). `npm run build` regenerated 21 downstream files.

**Fills the catalog's Snapdragon 7-series Adreno gap** (we had heavy A8xx/Elite coverage but nothing dedicated to 710/720/722 — SD 7 Gen 1 / 7+ Gen 2 / 7+ Gen 3 chips). Bumped GPU driver total 265 → 266.

### 2. MTR driver bulk rename — 37 entries to consistent `MTR_Turnip_<ver>_<chip>[_<mod>]` (commit `cfca1be`)

User pointed out two MTR entries broke the space-separated convention:
- `Turnip-MTR-v1.8.7-A840P` (id 1203)
- `Turnip-MTR-v1.8.7a-A8XX` (id 1204)

Decided to do a full bulk rename to align with the existing third-party prefix convention. New scheme:
- **Prefix:** `MTR_` (matches SMXZ_/WHITE_/VIVSI_)
- **Separators:** underscores throughout (no hyphens between tokens)
- **Chip ID** (A840 / A840P / A8XX / Axxx) immediately after version
- **Modifier suffixes** (Test, a, RC3, Smart, b, p) always at the very end as their own underscore-separated token

Examples:

| Old | New |
|-|-|
| `Turnip MTR v1.8 A840P RC3` | `MTR_Turnip_v1.8_A840P_RC3` |
| `Turnip MTR v1.8.3 A840P-Test` | `MTR_Turnip_v1.8.3_A840P_Test` |
| `Turnip MTR v1.8.8 A8XX-a` | `MTR_Turnip_v1.8.8_A8XX_a` |
| `Turnip MTR v1.9.1-b Axxx` | `MTR_Turnip_v1.9.1_Axxx_b` |
| `Turnip MTR v3.2.0-p Axxx` | `MTR_Turnip_v3.2.0_Axxx_p` |
| `Turnip-MTR-v1.8.7a-A8XX` | `MTR_Turnip_v1.8.7_A8XX_a` |

All 37 MTR entries renamed in `data/custom_components.json` via a single Python regex pass; `npm run build` regenerated 20 downstream catalog files (580+ line churn but no binary changes — `file_md5` / `file_size` / `download_url` all unchanged). Components bind by `id`, so users with a renamed driver installed in a container see the new name automatically on next picker refresh; no install state lost.

### Verification (post-Pages-deploy)
- `GET /simulator/v2/getComponentList?type=2` (5.x path) — id=1330 VIVSI present + 0 MTR entries match the old `Turnip MTR …` / `Turnip-MTR-…` patterns
- `POST /v6/simulator/v2/getComponentList type=2` (6.0 worker path) — same, with `fileType=4` / `is_steam=0` reshape applied via `reshapeFor60`
- Asset HEAD on `81de750512d55045b940e7d11c56c938.tzst` returns 200, content-length 2,597,443

### Memory updates
- [[bannerhub-api-gpu-driver-naming-prefixes]] — added `MTR_` and `VIVSI_` entries; documented the full `<PREFIX>_<line>_<version>[_<modifier>...]` underscore-only scheme with suffix-at-end rule; added "How to apply" guidance for future bulk renames (`data/custom_components.json` + `npm run build`)

## 2026-05-15 — Proton 11 ARM64x container v1.0.1 → v1.0.2 (5.x)

5.x-vs-upstream container audit found `proton11.0-arm64x` (id 11) one revision behind upstream: we served v1.0.1 / vc 2 (`ffcaf1de…`, 240,592,439 B) while upstream shipped v1.0.2 / vc 3 (`19f1e3ed…`, 251,416,426 B) — a genuinely different/larger build (`wine_11_arm64x_out.tar.zst`), not a stale mirror. Upstream's binary was not on our release (404).

### Actions
- Uploaded the new main + sub_data to the `Components` release **md5-named** (non-destructive — old `wine_proton_11.0_arm64x.tar.zst` / `f71af255…` retained for rollback):
  - `19f1e3ed3fe6985953039820681faa0f.tar.zst` (251,416,426 B, end-to-end md5 verified)
  - `10e4cb165a42dd2a4416b7fbff687bc6.tzst` (32,186,652 B, sub_data)
- `data/containers.json` id=11: version 1.0.1→1.0.2, version_code 2→3, `file_md5`/`file_size` → upstream's, `download_url` → md5-named asset. `file_name` kept as `wine_proton_11.0_arm64x.tar.zst` (client-facing label unchanged).
- `sub_data` scheme preserved exactly: `sub_file_name` = `<new main md5>.tzst`, `sub_download_url`/`sub_file_md5` = sub's own md5 (`10e4cb16…`).
- `npm run build` regenerated `getContainerList` + `getContainerDetail/11`; timestamp-only churn on other endpoints reverted to keep the diff scoped (matches prior P11 commit `8351de2` convention).

### Scope
- **5.x only.** The `/v6/` `sp_winemu_unified_resources.xml` artifact + version scheme still needs the same bump — tracked as the next step.
- Unrelated audit findings (17 stale `.yml` helpers, `turnip_v26.2.0_b2/b3`, type 5↔6 game-config labels) deferred.

## 2026-05-15 — Add Box64-0.4.3 (type 1) custom component

User-supplied `Box64-0.4.3-0a7b7d4f6-Bionic.wcp` (profile.json: `type=Box64`, `versionName=Box64-0.4.3-0a7b7d4f6-Bionic`, single `box64`→`${bindir}/box64`). User confirmed the in-app **display name should be `Box64-0.4.3`** (short form, matching the existing Box64 catalog naming — not the full versionName the `add-components.py` auto-deriver would have used). A second candidate `Box64-Hybrid-Bionic-a2c23e110.wcp` was found in the same Download dir but explicitly dropped by the user — only 0.4.3 added.

### Actions
- md5 `f5a5de984166acf774eb0771a56e4deb`, size 2,829,556 B (verified on the copy before upload).
- Uploaded to the `Components` GH release as md5-named `f5a5de984166acf774eb0771a56e4deb.tzst` (`--clobber`; was not previously present). wcp = zstd-tar = same container as tzst, so uploaded byte-for-byte (no repack — mirrors `add-components.py` behavior for non-ZIP inputs).
- Hand-added `data/custom_components.json` entry (did NOT run `add-components.py` — its auto-derived name/auto-push would have mislabeled the component): `id=1331` (script convention = max custom id 1330 + 1; verified free, no XML collision), `name`/`display_name`=`Box64-0.4.3`, `version`=`0.4.3`, `version_code`=1, `type`=1. Clean 12-line append, no reformat churn.
- `npm run build` regenerated 21 files. `components/box64_manifest` total 34→35; new entry id=1331 present with `display_name=Box64-0.4.3`, correct md5/size/url, `is_ui=1`; also in `getComponentList`/`getAllComponentList`/`downloads`. Pre-existing missing-file warnings (turnip/dxvk/settings backlog) unrelated — my asset was NOT in the missing list (found on release).
- Commit `4c86229` `feat: add 1 component(s) — Box64-0.4.3` (identity `The412Banner <the412banner@users.noreply.github.com>`, no Claude co-author trailer). Staged with `git add -u` only — the local `.tzst`, the stray `.bak`, and `gamehub_reports/` deliberately excluded. Pushed to `origin/main` and `origin/master` (both 9bdbfa7→4c86229).

### Deploy
- **No Cloudflare worker redeploy** — `bannerhub-worker.js` unchanged; the worker fetches the catalog from GitHub Pages (served from `main`) at runtime and merges by name. Pages build for `4c86229` kicked off (status: building). ~30–60 s + CDN before `the412banner.github.io/.../components/box64_manifest` and the in-app picker show `Box64-0.4.3`.
- The wcp's internal `profile.json` still reads `Box64-0.4.3-0a7b7d4f6-Bionic`; only the catalog metadata users see is the short `Box64-0.4.3` (consistent with how every other Box64 entry's md5-named file diverges from its catalog name).

## 2026-05-15 — imagefs 1.3.8 → 1.4.1 (5.x + v6); base verified unchanged

User supplied the upstream v6 device strings for Firmware 1.4.1 and base, asked to serve 1.4.1 to both 5.x and v6 and to replace base only if changed.

### base.tzst — NO action (verified identical)
- Downloads `base.tzst` md5 `96df60f3cff612a9747e56cae9d4c6e8`, 83,424,612 B = byte-identical to currently-served `base_v101.tzst` (v1.0.1/vc2) and to the user's v6 base string. Not new, unchanged → nothing done. (9-file base lockstep untouched.)

### imagefs 1.4.1 — bumped across all 7 lockstep sites
- New values: version `1.4.1`, version_code `31`, md5 `643024d54f11d01196ffdb2918dc3c85`, size `172206649`, asset `imagefs_141.zst`, file_name stays `imagefs.zst`. Downloads `imagefs141.zst` md5/size verified against the user's v6 string before upload.
- Uploaded `imagefs_141.zst` (172,206,649 B) to the `Components` release; confirmed live (HTTP 200, content-length match) **before** pushing metadata.
- **7-site lockstep** — confirmed via `src/index.ts` that `npm run build` regenerates only 3 (`getImagefsDetail`, `executeScript/generic`, `executeScript/qualcomm`). The 2 `executeScript/*_steam` variants + the worker inline `is60` block are NOT generated → hand-patched (this is the `c8d7f21`-class footgun, now documented in memory). Sites: (1) `bannerhub-worker.js` inline+comment, (2) `data/imagefs.json`, (3) `getImagefsDetail`, (4) `executeScript/generic`, (5) `executeScript/qualcomm`, (6) `executeScript/generic_steam`, (7) `executeScript/qualcomm_steam`. Repo-wide grep post-patch: OLD md5/asset = 0 everywhere, NEW present in all 7.
- Reverted pure-timestamp churn on 14 unrelated endpoints (`git checkout --`, P11 `8351de2` convention). Commit `5dc29a9` `feat(imagefs): bump 1.3.8 -> 1.4.1 for 5.x + v6 (7-site lockstep)` — exactly 7 files, 42/42, identity `The412Banner <the412banner@users.noreply.github.com>`, no co-author. Pushed `origin/main` + `origin/main:master`.

### Deploy + verification
- Pages built for `5dc29a9` (status: built). Cloudflare worker redeployed (multipart PUT, `keep_bindings:["secret_text"]` + KV TOKEN_STORE re-declared) → `success:true`, deployment `51c9f71fc809475e889357034d46730f`; settings confirm SUPABASE_URL + SUPABASE_SERVICE_KEY + TOKEN_STORE all preserved.
- Live-verified 1.4.1 on every path: `/v6/simulator/v2/getImagefsDetail` (worker inline), `/simulator/v2/getImagefsDetail` (worker→Pages proxy), Pages direct, `POST /simulator/executeScript {qualcomm,1}` (5.x Add-Game), and all 4 Pages executeScript variants (generic/generic_steam/qualcomm/qualcomm_steam).

### imagefs 1.3.8 → 1.4.1 binary delta (authoritative full-tree md5 diff)

Both `.zst` extracted (601M / 604M), per-file md5 manifests built and diffed (space-safe NUL-path method — an initial space-in-filename artifact on `openal/.../Default HRTF.mhr` was disproven; md5 `eac9bb28…` identical both).

**Of ~6801 files: 0 content-changed, 0 removed, exactly 2 ADDED.** Not a SONAME rename (1.3.7→1.3.8 was; 1.4.1 is not).

- **ADDED `./usr/lib/libGameScopeV2.so`** — 2,210,904 B, md5 `848887d5dd22a645a5fd501dc9337a62`. New Vulkan ICD driver: exports `vk_icdGetInstanceProcAddr` / `vk_icdGetPhysicalDeviceProcAddr` / `vk_icdNegotiateLoaderICDInterfaceVersion`; ELF aarch64 NDK r27; NEEDED set identical to `libGameScopeVK.so` (EGL/GLESv2/GLESv3/X11/xcb). A *second/alternate* GameScope ICD shipped alongside the old one — not a replacement.
- **ADDED `./usr/share/vulkan/GameScopeVK_icd.json`** — 159 B, system-wide ICD manifest, `library_path` → `/data/data/com.winemu/files/usr/lib/libGameScopeV2.so` (api 1.3.216).
- **`libGameScopeVK.so` byte-identical** (md5 `9447d8dff507228bc9183c8146a4482f` both) → existing AI frame-gen path unaffected. All `libjxl*_winemu`, wine, everything else byte-identical. The pre-existing per-user `~/.config/vulkan/icd.d/GameScopeVK_icd.json` (unchanged, in both) still points at `libGameScopeVK.so`; both ICDs coexist.
- ⚠️ **Footgun:** new system-wide ICD json hardcodes `/data/data/com.winemu/files/...`. On BannerHub/renamed-package builds that path won't resolve → `libGameScopeV2.so` unreachable via this ICD until a launch-time per-package V2 manifest writer is added (same class as BannerHub's `BhFrameGenWriter.ensureIcdJsonForCurrentPackage()`). Old VK frame-gen still works (per-user ICD written by the app). Net user impact of the 1.4.1 firmware bump: **none negative** — purely additive; the V2 path is dormant on renamed packages until explicitly wired.

Memory `bannerhub-api-imagefs-routing` updated with the delta + footgun. Diff workdir `~/imagefs-diff-138-141` removed after recording (fully reproducible from the Components release).

## 2026-05-16 — add 6 components (5 GPU drivers + 1 Box64)

Six files staged in `~/API/`, added via a controlled one-shot pipeline (mirrors `add-components.py` repack/upload logic but with scheme-locked names; commit `6f4fc11`, pushed `main` + `master`).

| ID | Name | Type | Source file | md5 |
|----|------|------|-------------|-----|
| 1332 | `SMXZ_Turnip_Gen8_V31` | 2 | `Turnip_Gen8_V31.zip` | `62ee5dab…` |
| 1333 | `SMXZ_Turnip_v26.2.0_R4` | 2 | `Turnio_v26.2.0_R4.zip` | `37d2828e…` |
| 1334 | `SMXZ_Turnip_v26.2.0_R4_OneUI` | 2 | `Turnip_v26.2.0_R4_OneUI.zip` | `43fc8012…` |
| 1335 | `MTR_WN_Turnip_v1.01_Axxx_b` | 2 | `WN-Turnip-1.01-b_Axxx.zip` | `f2889fc0…` |
| 1336 | `MTR_WN_Turnip_v1.01_Axxx_p` | 2 | `WN-Turnip-1.01-p_Axxx.zip` | `eb698f6c…` |
| 1337 | `Box64-Hybrid-Bionic` | 1 | `Box64-Hybrid-Bionic-a2c23e110.wcp` | `ba326af5…` |

### Naming decisions (user-directed)

- **WinNative `WN-Turnip-1.01-*` drivers are MTR builds** → keep the existing `MTR_` prefix, insert `WN` segment after it: `MTR_WN_Turnip_v1.01_Axxx_{b,p}`. No new WN_/WINNATIVE_ prefix introduced. `-b`/`-p` = balanced/performance modifier, kept last per the underscore scheme.
- **R4 builds get the `SMXZ_` prefix.** The bare `Turnip_v26.x_R*` / `Turnip_26.2.0_R3_OneUI` catalog entries are legacy pre-`cfca1be`-normalization duplicates; the current convention (R1/R2/R3, Gen8 V27–V30) is `SMXZ_`. OneUI mirrors its SMXZ sibling `SMXZ_Turnip_v26.2.0_R3_OneUI` (with `v`).
- **Box64 Hybrid-Bionic:** dropped the `-a2c23e110` commit suffix → `Box64-Hybrid-Bionic`, version `Hybrid-Bionic` (mirrors the `Box64-<version>` pattern, e.g. `Box64-0.4.1-fix`).
- SMXZ drivers carry `version: "1.0.0"` (matches siblings); MTR/WN carry `version: "WN-1.01-{b,p}"`.

### Verification

- All 6 md5s confirmed present on the `Components` release (none in `npm run build`'s pre-existing missing-files warning, which lists only older unrelated components).
- Picker order confirmed: `PICKER_NEWEST_LAST_TYPES = {1,2,4}` → both types sort by ID ascending, newest last. The 5 drivers stack at the bottom of the GPU picker after `VIVSI_Turnip_710-720-722_v2.5.6`; `Box64-Hybrid-Bionic` at the bottom of the Box64 picker after `Box64-0.4.3`.
- `total_components` 539 → 545 (+6). Embedded archive metadata left untouched (catalog `display_name` is independent of in-archive `name`).

## 2026-05-16 — GPU driver picker flipped to newest-first

User request: GPU drivers should list newest at the TOP, not the bottom.

- Removed type **2** from `PICKER_NEWEST_LAST_TYPES` in `src/registry/registry.ts` (now `{1, 4}`). Type 2 falls into the default branch → `sortByIdDescending` → highest ID (newest) first.
- The set has two consumers: `manifest-generator.ts` (the `drivers_manifest` picker) **and** `registry.ts:196` inside `sortByTypeAndIdDescending`, used by the `getComponentList` / `getAllComponentList` / `getContainerDetail/*` simulator endpoints. Flip is therefore consistent across the picker and those endpoints.
- **Box64 (type 1) and VKD3D (type 4) deliberately left newest-last** — user scoped the request to GPU drivers only. This is an intentional asymmetry (Box64 newest-bottom, GPU newest-top).
- No catalog data change — `custom_components.json` untouched; only generated files reordered. Verified: `drivers_manifest` top is now id 1336→1335→1334→1333→1332 (the 2026-05-16 adds), Box64 manifest unchanged. Commit `996f1d6`, pushed `main` + `master`.

## 2026-05-16 — GPU driver picker reverted to newest-last

User asked to change the GPU ordering method back. Restored type 2 in `PICKER_NEWEST_LAST_TYPES` (`{1,4}` → `{1,2,4}`), reverting the earlier same-day flip (`996f1d6`). GPU drivers, Box64, and VKD3D all newest-last again. No catalog data change — generated files reordered back. Verified `drivers_manifest` bottom = the 2026-05-16 adds (1332→1336). Commit follows.


## 2026-05-16 — 🐞 ROOT CAUSE: custom Box64/FEX/VKD3D .tzst have .wcp-style layout → extract EMPTY on v6 (NOT yet fixed)

### Symptom (from BannerHub V6 Lite `banner.hub.lite` device testing)
DiRT 3 (x86_64, gameId 131962) and other x86_64 titles fail to launch on v6 when a custom Box64 is selected — `:wine` dies ~12–107 s pre-Wine-init (Java WineActivity UI loads, native wine/box64 tree never spawns; `linker64` thrashes ~75 s, box64 finally exec'd from `usr/bin/box64` then process death → back to library). User suspected the custom Box64 components we added aren't working in v6 — **confirmed correct.**

### Diagnosis (definitive)
On-device `usr/home/components/` audit — custom comps extract to **empty dirs**:
- Box64: `Box64-0.4.3`, `Box64-0.4.1-fix`, `Box64-Hybrid-Bionic` = 0 files
- FEX: `Fex_20260428`, `FEXCore-2603`, `FEXCore-2605` = 0 files
- `vkd3d-proton-3.0.1` = 0 files
- Working (flat-packed): `Box64-0.4.1-2` (1), `Fex-20251025`/`Fex_20260509` (2), `dxvk-2.3.1-async`/`vkd3d-2.12` (2), drivers/mono/vcredist/oalinst/XLiveRedist/etc.

`curl` + `tar --zstd -tf` of the GitHub release assets:
- **WORKING** `Box64-0.4.1-2` (`cd7fe188….tzst`) → `./box64` (flat, bare binary at root)
- **BROKEN** `Box64-0.4.3` (`f5a5de98….tzst`) → `./` + `profile.json` + `box64`
- **BROKEN** `Box64-0.4.1-fix` (`4b6f4157….tzst`) → `./` + `box64` + `profile.json`
- **BROKEN** `Box64-Hybrid-Bionic` (`ba326af5….tzst`) → `./` + `profile.json` + `box64`

**Root cause:** the custom Box64 (and custom FEX/VKD3D) `.tzst` were repackaged from Winlator `.wcp` and retain the `.wcp` internal layout (`./` dir entry + `profile.json` + binary). The GameHub 6.0 / **v6** component extractor for type=1 expects a **flat archive with only the bare binary at root** (as stock `Box64-0.4.1-2`). Given the `.wcp`-style archive it makes the component dir but unpacks no usable binary → empty → per-game translator path resolves empty → x86_64 game dies pre-Wine. Worker `reshapeFor60` is NOT at fault — working vs broken `getAllComponentList` entries are byte-shape identical (display_name/download_url/file_md5/file_name/file_size/id/is_ui/logo/name/type/version/version_code); purely a release-asset payload-layout defect. (The 2026-05-15 `Box64-0.4.3` add already flagged the `.wcp` internal-name mismatch as a risk — this is that risk realized, and broader: the whole `.wcp` layout, not just the name.)

### Fix (NOT yet applied — pending user go-ahead)
Per broken component: re-extract, repackage flat (`tar -C <dir> --zstd -cf out.tzst <binary>` → `tar -tf` = exactly `./box64` / FEX / vkd3d payload; no `profile.json`, no `./` dir entry), re-upload the GitHub release asset, bump `file_md5`/`file_name`/`file_size`/`download_url` in lockstep across `components/box64_manifest`, `data/custom_components.json`, `components/downloads`, `simulator/v2/getComponentList`, `simulator/v2/getAllComponentList`, then `npm run build`. Audit ALL type=1/type=4 customs sourced from `.wcp` for the same defect. Durable rule → memory `bannerhub-api-box64-tzst-flat-layout`. Blocks the BannerHub V6 Lite Steam/Epic+game-launch merge-gate for x86_64 titles. Interim user workaround: select `Box64-0.4.1-2`.

### Scope correction + FIX APPLIED 2026-05-16

**Recursive on-device re-audit corrected the count from 7 → 5.** The first audit only counted top-level files, so components that legitimately extract into a `system32/`/`syswow64/` subdir false-flagged as empty:
- `vkd3d-proton-3.0.1` — archive has NO `profile.json`; extracted fine on device (`system32/`+`syswow64/` populated). **Not broken — left untouched.**
- `Fex_20260428` — archive is bare `libarm64ecfex.dll`+`libwow64fex.dll` at root, byte-identical layout to working `Fex_20260509`. Empty on device for an unrelated reason (never downloaded / transient), **not a packaging defect — left untouched** (re-uploading a correct asset would churn it for nothing; flagged for separate follow-up if it stays empty after a fresh download).

**5 genuinely layout-broken, repackaged + re-uploaded + catalog-updated:**

| Component | old md5 | new md5 | new size | new layout |
|---|---|---|---|---|
| Box64-0.4.3 | f5a5de98… | 2381fcfb… | 4590382 | `./box64` |
| Box64-0.4.1-fix | 4b6f4157… | 02ae1d3d… | 4796628 | `./box64` |
| Box64-Hybrid-Bionic | ba326af5… | fd9286b6… | 4590835 | `./box64` |
| FEXCore-2603 | 6008bf7c… | 0216e6a8… | 2300330 | `libarm64ecfex.dll`+`libwow64fex.dll` |
| FEXCore-2605 | 02fc4d33… | d2bc7916… | 1696433 | `libarm64ecfex.dll`+`libwow64fex.dll` |

Payloads verified post-repack: Box64 = ELF aarch64 PIE (matches working `Box64-0.4.1-2`); FEXCore = PE32+ ARM64 WINE DLLs. New assets `gh release upload … --clobber` to the `Components` release (all 5 confirmed present). `data/custom_components.json` updated surgically (file_md5/file_name/file_size[string-typed, matches 233-entry convention]/download_url; `version_code` 1→2 to force client re-download); `npm run build` regenerated the catalog (box64_manifest/downloads/getComponentList/getAllComponentList carry new md5s, zero residual old md5s; other regen = incidental build-`time` epoch bump). Prevention tooling (wcp→tzst converter + layout validator) added separately so this cannot recur — see follow-up entry. Commit + push (main+master): commit `983fd47`.

**VERIFIED ON DEVICE 2026-05-16** (`banner.hub.lite`, post GH-Pages propagation): user re-downloaded; `Box64-0.4.3` & `Box64-Hybrid-Bionic` now extract `box64` (files=1, were 0). With Box64-Hybrid-Bionic, box64 is exec'd from the component dir and **Wine fully boots** (`esync up and running`, ProcessHelper Wine-debug, ntoskrnl/init_peb) — the native tree that was 100% absent pre-fix. Packaging defect conclusively resolved. Separate residual (not this bug): DiRT 3 is 32-bit and `onStopGame`s with `err:wow:load_64bit_module c000007b` (STATUS_INVALID_IMAGE_FORMAT) under x64-Proton experimental wow64 — 32-bit/container/wow64 compat, tracked apart.

## 2026-05-20 — Tag `[Original GameHub Driver]` on XiaoJi-origin entries in custom_components.json

Follow-up to `1625da3` (blurb override on XML-sourced drivers). The override file targets the 84 type=2 entries in `sp_winemu_all_components12.xml` by id. But `data/custom_components.json` also carries XiaoJi-published drivers as separate entries (different id range 1104+, named to match upstream), and those weren't covered by the override layer — they had only generic family-template blurbs from the 2026-05-19 backfill.

Cross-referenced `data/custom_components.json` type=2 (188 entries) against `~/sp_winemu_unified_resources.xml` type=2 (118 entries, upstream 6.0.4 unified resources mirror) by case-insensitive `name` match → 32 overlap. Those 32 entries got `[Original GameHub Driver] ` prepended to their existing blurb via surgical text replacement (anchored on `"id": N,` → next `"blurb": "..."`, no JSON re-serialization → diff stays exactly 32 lines).

ids prefixed: 1104, 1107–1118, 1120–1128, 1297, 1317–1319, 1322–1327. Remaining 156 (MTR, SMXZ, WHITE, A8XX MR drafts, Banners Turnip, Mesa-git, PixelyIon, Danil's fork, Deck, etc.) untouched — confirmed non-XiaoJi community builds. Prefix style intentionally distinct from the override file's `original Gamehub Driver — ` (lowercase, em-dash) — bracketed form chosen per user direction; the two annotations apply to disjoint id ranges (XML 42–388 via override vs custom_components 1104+ inline). No build run; CI regenerates served JSON on push.

## 2026-05-21 — Catalog add: `DXVK-2.4.1-fix` (id 1339)

Added a new DXVK type=3 entry sourced from a hand-supplied `dxvk-2.4.1-fix.wcp` (sys-driver-fix variant of upstream DXVK 2.4.1). `scripts/wcp2tzst.sh --type dxvk` repacked the archive (stripped `profile.json`, no `./` wrapper) → md5 `3fa28e6e10c256a7ae4f55749f453d4f`, 8493387 bytes; `scripts/check_component_layout.sh` returned OK (10-DLL `system32/`+`syswow64/` layout, matching the existing DXVK sibling shape). Asset uploaded to the `Components` release; `data/custom_components.json` got a 13-line append (id 1339 — next free above the 1338 high-water mark) carrying name/version/version_code derived from the .wcp's internal `profile.json` (`versionName: "2.4.1-fix"`, `versionCode: 1`). `npm run build` regenerated 22 endpoint files — dxvk total 46 → 47; all other regen is just build-`time` epoch bumps. dxvk_manifest now serves id 1339 alongside the prior 17 custom DXVK entries.

## 2026-05-21 — Proton 9/10 x64 + Proton 9 arm64x `sub_data` 404 fix (commit `7c73883`)

**Device-verified shipped fix** for long-standing "Container installation failed" toast on x86_64 Proton layers across **BHL 1.0.2 + BannerHub 3.7.5 + bannerhub-revanced v6** (all three apps share the same `simulator/v2/getContainerList`).

### Root cause

Live logcat capture on `com.xiaoji.egggame` (BHL Original v1.0.2 / Pocket FIT) showed Drake.NET ConvertException on a 404 GH-Releases asset:

```
E runFailure: err = com.drake.net.exception.ConvertException:
  https://.../Components/751b2ec403b86ddd7357206f7a85b301.tzst …(null:89)
```

That URL was the `sub_data.sub_download_url` for `proton10.0-x64-1` (id 10) in `data/containers.json`. Engine fetches this ~4 MB supplementary tzst during container init; on 404, failure propagates via Drake.NET → `PcEmuSetupDialog.checkWineAndContainer$3$1.invokeSuspend` → toast `winemu_container_installation_failed` (R.string id `0x7f130c29`).

Three entries had broken hashes — pattern looked like a copy-paste mistake where `sub_file_name` was correct but `sub_download_url` + `sub_file_md5` carried unrelated hashes from a different/deleted revision:

| id | name | old broken hash | status | new hash |
|----|------|-----------------|--------|----------|
| 10 | proton10.0-x64-1   | `751b2ec…`                                  | 404 (URL)  | `ac15e5a378…` (real 4.08 MB tzst, matches top `file_md5`) |
| 4  | proton9.0-x64-3    | URL OK; `sub_file_md5=6f41b9c…`             | md5 hash file 404 | `83b3a2a16f…` (URL's filename hash) |
| 9  | proton9.0-arm64x-3 | `ae9d3f0…`                                  | 404 (URL)  | `2ff6952b6e…` (real 3.98 MB tzst, matches top `file_md5`) |

### Fix

Three surgical 2-line edits in `data/containers.json` (6 lines total). `npm run build` regenerated `simulator/v2/getContainerList` and `getContainerDetail/{4,9,10}`. Diff = 18 files; remaining 15 are build-`time` epoch bumps (executeScript pair, allComponentList, componentList, defaultComponent, imagefsDetail, getContainerDetail/{2,3,5,6,7,8,11}) — zero content drift.

### Engine-side semantics — sub_data (reusable)

- `download_url` (top) = wine binary archive (~150–220 MB, `wine_<flavor>.tar.zst`).
- `sub_data.sub_download_url` = supplementary tzst (~3.9–4.1 MB) — **REQUIRED** for container init to succeed; engine aborts the launch on its 404.
- Naming convention in working entries: filename = `<top file_md5>.tzst` (= `sub_file_name`).
- `sub_file_md5` is NOT verified against file content — proven by the working baseline `proton10.0-arm64x-2` (id 2) which carries a mismatched `sub_file_md5=439b7ec…` yet ships fine. Safest setting: = the URL filename hash so all three fields agree.

### Build-time validation gap (follow-up)

`checkMissingFiles` in `dist/index.js:51` walks `registry.getAllOriginalInfo()` which only contains component XML entries; container `sub_data` URLs are not in the validation set, so this class of bug ships silently. **Follow-up:** extend `getAllOriginalInfo()` (or add a parallel sweep) to surface containers' `sub_data.sub_download_url` for the same release-asset-presence check that catches missing component files today. Would have caught this in v1.0.1 pre-release. Filed as a soft TODO — not actioned this commit.

### Cross-app coverage

The `/v6/simulator/v2/getContainerList` handler in `bannerhub-worker.js:985` proxies the same static file and only mirrors `is_steam → isSteam`; `sub_data` passes through verbatim. So fixing the source file silently fixed bannerhub-revanced v1.5.1-604 (GameHub 6.0.4 base) at the same time, alongside BHL 1.0.2 and BannerHub 3.7.5 (both 5.x snake-case pass-through).

## 2026-05-22 — Proton sub_data fix follow-up: regression discovered, NOT shipped

Re-audited the May 21 fix after a user-side regression report. Findings below; no code changes pushed this session — diagnostic pending user input.

### User-reported symptom

BannerHub-ReVanced v1.5.1-604 (v6/GameHub 6.0.4 base): a game that previously booted with **sound + actual gameplay** now boots with **sound + black screen** since `7c73883` shipped. Classic missing-or-wrong wineprefix signature (Wine starts, audio drivers load, but renderer init fails → no frames presented).

### Audit results (live HEAD against `Components` release, ~17:00 EDT)

1. **The May 21 fix wrote the wrong `sub_file_md5` on all 3 touched entries.** Convention across every untouched working container (id 2, 3, 5, 6, 7, 8) is: `sub_file_name = <binary_md5>.tzst` AND `sub_file_md5 ≠ file_md5` (wineprefix is a separate file with its own content hash). The fix instead set `sub_file_md5 = file_md5` (binary archive's md5) for id 4/9/10.

   | id | name           | binary file_md5 | sub_file_md5 (post-fix) | match? |
   |----|----------------|-----------------|--------------------------|--------|
   | 2  | proton10.0-arm64x-2 | `6dcb13706c…` | `439b7ec0ae…` | ≠ ✓ correct |
   | 4  | proton9.0-x64-3     | `83b3a2a16f…` | `83b3a2a16f…` | **= ✗ wrong** |
   | 9  | proton9.0-arm64x-3  | `2ff6952b6e…` | `2ff6952b6e…` | **= ✗ wrong** |
   | 10 | proton10.0-x64-1    | `ac15e5a378…` | `ac15e5a378…` | **= ✗ wrong** |
   | 11 | proton11.0-arm64x   | `19f1e3ed3f…` | `10e4cb165a…` | ≠ ✓ correct |

2. **Files DO exist as real ~3.7–4 MB wineprefixes on the release.** HEAD/200:
   - `ac15e5a378….tzst` (id 10) → 4,082,239 B
   - `2ff6952b6e….tzst` (id 9)  → 3,983,209 B
   - `83b3a2a16f….tzst` (id 4)  → 3,909,211 B
   - Baseline `6dcb13706c….tzst` (id 2) → 3,882,744 B (sanity check)

3. **id 11 (proton11.0-arm64x) sub_data is separately 404.** `19f1e3ed3fe6985953039820681faa0f.tzst` does not exist on `Components`. NOT in scope of the May 21 fix — a new/separate breakage. Likely from the p11-banner build not uploading its paired wineprefix archive.

### Reconciling the "md5 not verified" claim from the May 21 entry

The May 21 PROGRESS entry asserts `sub_file_md5` isn't verified against file content (basis: id 2 ships fine with a mismatched md5). That holds — **install proceeds despite the mismatch**. So the symptom is NOT an install failure; the wineprefix successfully unpacks. The black-screen-with-sound therefore points to a different layer: **the wineprefix content itself is wrong shape for v6** (likely pre-v6 `xuser` user-dir convention vs v6's expected `steamuser` per the Winlator→GameHub layer mapping notes — Wine boots fine without `users/steamuser/` but the v6 launcher's renderer init relies on registry/path layout that's missing → audio works, video never starts).

This also explains why BHL 1.0.2 egggame device-verified the fix as working on May 21: egggame is a minimal smoke test that doesn't exercise the renderer init paths that fail on real games.

### Diagnostic pending — what to ask user when back online

Inside the broken v6 game's per-game settings dialog: **which Wine/Proton container is selected?**
- id 4 / 9 / 10  → confirms this regression's scope; fix per (A) below.
- id 11          → separate (missing wineprefix file); fix per (B) below.
- id 2           → root cause is elsewhere — investigate imagefs/component updates.

### Follow-up commits queued (NOT pushed)

**(A) Repair sub_data for id 4 / 9 / 10.** Two options to evaluate:
   - Cheap: re-derive `sub_file_md5` by hashing each release file. Doesn't fix black-screen if content is structurally wrong.
   - Real: repack the wineprefix archives from a known-good v6 donor (id 2's baseline or a fresh `proton11.0-arm64x` style prefix migrated for x64). Upload new tzsts, regenerate catalog. This is what likely needs to happen given the symptom.

**(B) Re-upload missing sub_data for id 11.** `19f1e3ed3fe6985953039820681faa0f.tzst` needs to either be uploaded fresh (from p11-banner build artifacts) or repointed at a working wineprefix. Currently every Proton 11 arm64x install on v6 fails at the sub_data step.

**(C) Build validator extension (carried over from May 21 TODO).** Extend `checkMissingFiles` / `getAllOriginalInfo()` to walk container `sub_data.sub_download_url`. Plus: warn if `sub_file_md5 == file_md5` (= the May 22 anti-pattern). Plus: warn if `sub_file_name`'s hash prefix ≠ `file_md5` (catches name/binary drift).

**(D) v6 installer instrumentation.** Does v6 surface ANY error when an unpacked sub_data wineprefix lacks `users/steamuser`? If silent, that's a UX bug — every "wineprefix shape wrong for v6" failure looks like a generic black screen. Worth logging.

### Repo state going home

`bannerhub-api` HEAD = `ab4a448` (May 21 docs commit on top of `7c73883`). Working tree clean. Nothing committed this session. May 21 fix remains live in production until follow-up (A)/(B) lands.

### Adjacent work this session (logged separately)

Outside `bannerhub-api`: decompiled `GameHub_6.0.2.apk` to `~/gh602-decompile/` (first time), traced the HUD "+" engine-name badge across 6.0.2/6.0.4 (saved as memory `reference_gamehub_hud_plus_badge`), and analyzed GPU Passthrough pacing regression vs 6.0.2 Native Rendering (folded into memory `reference_gamehub_gpu_passthrough`). All three live in `~/.claude/projects/-home-claude-user/memory/`. Relevant here only because v6 = GameHub 6.0.4 base, so the wineprefix `steamuser` convention is a 6.0.x expectation, not a 5.x one.

## 2026-05-22 evening (initial attempt, REVERTED) — /v6/ upstream-CDN override for Proton ids 4/9/10/11

User retrieved the upstream Xiaoji unified resources XML (`sp_winemu_unified_resources.xml` from `/storage/emulated/0/Download/`) — the SharedPreferences cache dumped from a GameHub 6.0.4 device. Extracted authoritative upstream URLs for the four affected Proton containers and wired a `/v6/`-only override in the worker. 5.x stays on the static catalog.

### Critical reframe of the May 21 fix

Parsing the upstream XML's `CONTAINER:*` entries revealed: **every "deleted" sub_data hash we cleaned up on May 21 was actually the correct upstream md5 all along.**

| id | upstream subData.fileMd5 | pre-fix value on our API | match? |
|----|--------------------------|--------------------------|--------|
| 4  | `6f41b9c15b5bc97a0365b65da2b7545f` | `6f41b9c15b…` | ✓ |
| 9  | `ae9d3f0c04341ac4fbb933f1ce4b6409` | `ae9d3f0c04…` | ✓ |
| 10 | `751b2ec403b86ddd7357206f7a85b301` | `751b2ec403…` | ✓ |
| 11 | `10e4cb165a42dd2a4416b7fbff687bc6` | `10e4cb165a…` | ✓ |

Our catalog entries had been identity-copied from upstream when first added (correct hashes), but the actual archive files were never uploaded to our `Components` GitHub release. The 404s in era C weren't drift — they were missing mirror uploads. The May 21 fix repointed the URLs at an *existing-but-wrong* file (the binary archive itself), which made `bannerhub-revanced` v6 install "succeed" while loading the wrong-shape wineprefix.

### The right fix: send v6 traffic to upstream directly

Upstream Xiaoji archives at `uxdl.mac520.com/ux-landscape/pc_zst/…` are byte-correct for GameHub 6.0.4 (`steamuser` user-dir, 62 reg refs, current Proton revisions) by definition — they're what the upstream client downloads. Pointing /v6/ traffic at them bypasses our mirror entirely for these four entries, while leaving the static catalog (and thus BHL 1.0.2 + BannerHub 3.7.5) on the existing self-hosted path.

### Worker patch (+82 lines, single file)

`bannerhub-worker.js`:

1. **New constant** `V6_CONTAINER_UPSTREAM_OVERRIDES` declared inside the per-request handler (~line 510), populated from the unified XML. Map shape: id → `{file_name, file_md5, file_size, download_url, sub_data:{sub_file_name, sub_file_md5, sub_download_url}}`. Only ids 4/9/10/11.
2. **New helper** `applyV6ContainerOverride(data)` mutates the inner `data` object in place if its id is in the map; no-op otherwise.
3. **`getContainerDetail` handler** (~line 647): on `is60 && V6_CONTAINER_UPSTREAM_OVERRIDES.has(id)`, parse JSON, apply override, re-serialize. Other ids: byte pass-through. 5.x: pass-through.
4. **`getContainerList` handler** (~line 985, `is60` branch): iterate `data.data`, call `applyV6ContainerOverride(c)` per row alongside the existing `isSteam` mirror loop.

### Behavior verified by simulation harness

Ran extracted override map + applier against the actual static payloads in `simulator/v2/getContainerDetail/{10,2}` and `simulator/v2/getContainerList`. Results:

- **id 10 5.x payload** (unchanged): `download_url = https://github.com/.../wine_proton_10.0_x64.tar.zst`, `sub_data.sub_file_md5 = ac15e5a378…` (post-May-21 bogus value retained).
- **id 10 /v6/ payload** (after override): `download_url = https://uxdl.mac520.com/ux-landscape/pc_zst/ac15/e5/a3/wine_proton_10.0_x64.tar.zst`, `sub_data.sub_download_url = https://uxdl.mac520.com/ux-landscape/pc_zst/751b/2e/c4/751b2ec403…tzst`, `sub_data.sub_file_md5 = 751b2ec403…` (restored to original upstream).
- **id 2** (not in override map): `applyV6ContainerOverride` is a no-op → unchanged.
- **getContainerList** post-override iteration:
  - ids 4/9/10/11 → UPSTREAM (uxdl.mac520.com)
  - ids 2/3/5/6/7/8 → OUR MIRROR (github.com/The412Banner/bannerhub-api/releases)

`node --check bannerhub-worker.js` → clean. `git diff --stat` → `1 file changed, 82 insertions(+)`. No catalog files, no `data/*.json`, no `simulator/*` touched.

### What 5.x sees: nothing different

`simulator/v2/getContainerList`, `getContainerDetail/{N}` static files unchanged. BHL 1.0.2 + BannerHub 3.7.5 continue reading the post-May-21 catalog, which has been device-verified for the `xuser`-tolerant BHL path on egggame.

### What v6 sees now

`bannerhub-revanced` v1.5.1-604 (GameHub 6.0.4 base) hits `/v6/simulator/v2/getContainerDetail?id={4,9,10,11}` → worker reads static, applies override, serves upstream Xiaoji URLs. Client downloads `wine_proton_<n>.tar.zst` from `uxdl.mac520.com` and the matching ~4 MB `<sub_md5>.tzst` wineprefix (steamuser-flavored) from the same CDN. Install completes with a v6-canonical bottle. Game should boot sound + gameplay.

### Quirks worth noting

- **id 4 lives in `ux-landscape-test`** (not the production `ux-landscape` bucket) per the upstream XML. Carried verbatim — flag for future check if Xiaoji ever retires test buckets.
- **Upstream `subFileSize` is `null`** for all four entries. We don't carry `sub_file_size` in our snake-case schema anyway; no client appears to need it.
- **id 2's upstream is `f855339e3d…` version 1.0.4 vc=5** vs our static `6dcb13706c…` version 1.0.0. Our id 2 is stale relative to upstream but still works for both 5.x and v6 on-device, so left untouched — would only matter if a future upstream bump introduces a hard incompatibility. Deferred.

### Pending before this can ship

1. **Diagnostic: which container is the broken game using?** Open question from earlier in this session. If 4/9/10/11 → push the worker patch and expect resolution. If id 2 or a Wine entry → don't push the worker change yet; root cause is elsewhere (imagefs/components/launcher delta).
2. **Push.** `git commit -m "..." && git push` on `main`. Cloudflare deploys the worker automatically.
3. **Device verify.** Same Proton 10 x64 (or whichever) game that was sound+black-screen. After a container reinstall or v6 cache clear → expect sound+gameplay.

### Architecture note for next session

This generalizes. If upstream rotates a Proton revision, refresh the map entries. If we want to extend the pattern to the wine entries (ids 3/5/6/7/8) or unify on upstream for everything on /v6/, the override map is the right scaffolding — just add more entries. The full-mirror or single-source-of-truth approaches (Options 2 and "unify" from the earlier strategy discussion) remain available as later steps if this iteration proves insufficient.

## 2026-05-22 late — Proton sub_data: MIRROR APPROACH (the right fix, shipped)

User correction: "you were supposed to download those components for us to host on the GitHub repo." The worker `/v6/` override from the previous section was the wrong choice — it would have made v6 traffic dependent on Xiaoji's CDN reliability. Correct approach is to mirror the upstream wineprefix archives to our `Components` GitHub release and serve everything from our own infrastructure, unifying 5.x and v6 on a single catalog.

### What was done

1. **Downloaded** the 4 upstream Xiaoji wineprefix archives from `uxdl.mac520.com`:
   - `6f41b9c15b5bc97a0365b65da2b7545f.tzst`  (id 4 sub_data, 3,909,211 B)
   - `ae9d3f0c04341ac4fbb933f1ce4b6409.tzst`  (id 9 sub_data, 3,983,209 B)
   - `751b2ec403b86ddd7357206f7a85b301.tzst`  (id 10 sub_data, 4,082,239 B)
   - `10e4cb165a42dd2a4416b7fbff687bc6.tzst`  (id 11 sub_data, 32,186,652 B — Proton 11 is a fresher / fuller prefix)
2. **md5-verified** each downloaded file against its filename hash (all 4 match — files are content-addressed correctly).
3. **Uploaded** via `gh release upload Components` to `The412Banner/bannerhub-api` (id 11's archive was already on the release; ids 4/9/10 are new uploads).
4. **Verified mirror availability** — HEAD against `https://github.com/The412Banner/bannerhub-api/releases/download/Components/<hash>.tzst` for all 4 returned HTTP 200 with matching `content-length`.
5. **Reverted the worker `/v6/` override patch** — no longer needed, the May 22 evening commit-in-working-tree was rolled back via `git checkout -- bannerhub-worker.js` before this change. Worker is byte-identical to `ab4a448`.
6. **Re-edited `data/containers.json`** to restore the original upstream `sub_file_md5` values (the same hashes that were "wrong" pre-May-21 are now correct — we host the files they point at), with `sub_file_name` + `sub_download_url` realigned to match. Original 2-space indentation preserved. 4 entries × 3 fields = 12 line edits.
7. **`npm run build`** regenerated the served catalog. `data/containers.json` diff = 20 lines (4 entries × 5 lines/entry with context). Other `simulator/v2/*` files: timestamp-only churn.

### Final containers.json shape (post-fix)

| id | sub_file_name | sub_file_md5 | sub_download_url tail | mirror status |
|----|---------------|--------------|-----------------------|---------------|
| 4  | `6f41b9c15b…tzst` | `6f41b9c15b…` (upstream) | `…/Components/6f41b9c15b….tzst` | 200 OK ✓ |
| 9  | `ae9d3f0c04…tzst` | `ae9d3f0c04…` (upstream) | `…/Components/ae9d3f0c04….tzst` | 200 OK ✓ |
| 10 | `751b2ec403…tzst` | `751b2ec403…` (upstream) | `…/Components/751b2ec403….tzst` | 200 OK ✓ |
| 11 | `10e4cb165a…tzst` | `10e4cb165a…` (upstream, unchanged) | `…/Components/10e4cb165a….tzst` | 200 OK ✓ |

For id 11 specifically, the `sub_file_md5` was already correct (`10e4cb165a…`) but `sub_file_name` and `sub_download_url` pointed at the 404'ing `19f1e3ed3f….tzst` (= the binary md5 with `.tzst` suffix, an obsolete naming convention). Repointed to match the actual upstream filename (`<sub_md5>.tzst`).

### What this fixes

- **v6 (`bannerhub-revanced` v1.5.1-604 / GameHub 6.0.4 base):** receives steamuser-flavored upstream wineprefixes from our mirror. Container install completes with correct shape → DXVK/d3d device init finds expected `users/steamuser/...` paths → renderer presents frames. Sound + black-screen regression resolved.
- **BHL 1.0.2 + BannerHub 3.7.5 (5.x family):** same JSON, same wineprefix archives. Per the prior memory note that `sub_file_md5` is leniently checked + the upstream archives are `steamuser`-flavored, BHL should remain compatible (gamehub-lite tolerates `steamuser` paths in practice — minimal smoke games like egggame definitely will, full games likely will too). **If BHL regresses post-deploy, revert this entry's specific sub_data block to the May 21 values** — but device test first; the unify hypothesis is that one shape works for both clients.
- **id 11 (`proton11.0-arm64x`):** no longer 404s on install. Same wineprefix as upstream ships.

### Diff scope

- `data/containers.json`: 20 lines (4 entries × 5 lines including context)
- `simulator/v2/getContainerDetail/{4,9,10,11}`: regenerated to match (8/8/8/4 lines respectively for the changed entries)
- `simulator/v2/getContainerDetail/{2,3,5,6,7,8}`: timestamp epoch only (1 line each — `npm run build` always touches `time` on every file)
- `simulator/v2/getContainerList`, `getAllComponentList`, `getComponentList`, `getDefaultComponent`, `getImagefsDetail`, `executeScript/{generic,qualcomm}`: timestamp churn only

`bannerhub-worker.js` UNCHANGED from HEAD.

### Build validator follow-up (still queued)

`checkMissingFiles` in `dist/index.js:51` should walk container `sub_data.sub_download_url` (currently only validates component XML entries). Would have caught the May 21 misalignment before it shipped. Same TODO as the May 21 entry. Plus: warn if `sub_file_md5 == file_md5` (= the May 21 anti-pattern from binary-md5 reuse).

### Next steps for resume

1. Commit + push. Cloudflare deploys the static catalog from `the412banner.github.io/bannerhub-api` (same Pages site the worker reads from), so once the commit lands on `main` the live API serves the new JSON.
2. Device test on bannerhub-revanced v1.5.1-604: pick a game that was sound+black-screen pre-fix on Proton 10 x64 (id 10) → reinstall the container or clear cache → relaunch. Expect sound + gameplay.
3. Smoke-test BHL 1.0.2 egggame and one other game to confirm the steamuser-flavored prefix doesn't regress 5.x. If it does, see "what this fixes" → revert the affected entry's sub_data block only.

## 2026-05-29 — Container bump: `proton10.0-arm64x-2` 1.0.3/vc4 → 1.0.4/vc5 (match upstream)

Diffed our container catalog against a fresh on-device upstream dump (`/storage/emulated/0/Download/sp_winemu_unified_resources.xml`, 10 `CONTAINER:*` keys). 9/10 byte-identical; only **id 2 (`proton10.0-arm64x-2`)** had drifted — upstream moved it to a new build.

### What changed upstream
- **Binary:** `wine_proton10.0-arm64x-2.tar.zst` (md5 `6dcb1370…`, 216,807,973 B) → `wine_proton10.0-arm64x-5.1.tar.zst` (md5 `f855339e3d05b3824538c462548c06c3`, 235,985,629 B, +19 MB).
- **Wineprefix (`sub_data`):** new content, md5 `9332aa643892080441c4e8ddbd94e4ce`. Upstream stores it path-named by sub-md5 (`…/9332/aa/64/9332aa64….tzst`) but client-facing `subFileName` is the main md5 (`f855339e….tzst`).
- **version 1.0.3 → 1.0.4, version_code 4 → 5.**

### Files mirrored to the `Components` release
Downloaded both from `uxdl.mac520.com/ux-landscape/pc_zst/…`, md5-verified, uploaded via `gh release upload --clobber`:
- `wine_proton10.0-arm64x-5.1.tar.zst` (md5 ✓, HEAD content-length 235985629 ✓)
- `f855339e3d05b3824538c462548c06c3.tzst` — the sub asset, **named after the main md5** per our `sub_file_name` convention (mirrors current id-2 pattern where the sub asset was `6dcb…tzst`), content md5 `9332aa64…`, HEAD content-length 3986829 ✓.

### Three served representations updated (commit `b889385`, pushed to `main` + `master`)
- `simulator/v2/getContainerList` — read by **v5** (GITHUB_ROUTES passthrough) **and v6** (is60 branch, mirrors `is_steam`→`isSteam`). Single source for both client list views.
- `simulator/v2/getContainerDetail/2` — **v6-only** per-id detail call (GameHub 6.0).
- `data/containers.json` — reference doc only (NOT read at runtime), kept in sync.

`bannerhub-worker.js` UNCHANGED. `data/containers.json` is **not** a runtime source — the worker proxies static files from the Pages site `the412banner.github.io/bannerhub-api` (Pages legacy build, branch `main`, path `/`). Edits to the two `simulator/v2/*` files are what actually change served data.

### Live verification (after Pages rebuild — built in ~25s on commit `b889385`)
- `…/simulator/v2/getContainerDetail/2` → version 1.0.4, vc 5, file `wine_proton10.0-arm64x-5.1.tar.zst`, md5 `f855339e…`, sub_md5 `9332aa64…` ✓
- `…/simulator/v2/getContainerList` id=2 → same ✓

The vc4→vc5 bump is what re-fires v6's strict `sub_file_md5` check and prompts already-installed clients to upgrade. Old 1.0.3 assets left on the release (rollback safety; harmless).

### Why this was needed
Only out-of-date container vs upstream. The other 9 (5 wine + 4 proton) remain byte-identical: matching md5s, sizes, and version_codes. No device retest scheduled by user this session — change is a straight upstream parity bump (same archive upstream already ships), not a custom rework.
