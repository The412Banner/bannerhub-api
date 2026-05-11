# BannerHub API
[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white)](https://discord.gg/n8S4G2WZQ4)


Static JSON API and Cloudflare Worker proxy for the [BannerHub](https://github.com/The412Banner/bannerhub) Android app. Replaces GameHub's original Chinese servers with a fully self-hosted, privacy-respecting backend.

> **Heads up:** this README documents the API as consumed by GameHub **5.3.5** (BannerHub app + BH-Lite) by default. GameHub **6.0** (the KMP rewrite, hit by [`bannerhub-revanced`](https://github.com/The412Banner/bannerhub-revanced)) shares the same Worker but branches behavior on a `/v6/` path prefix — see [§ GameHub 6.0 support](#gamehub-60-support) below.

## Why use the BannerHub API?

Every component (DXVK, VKD3D, Box64, FEXCore, GPU drivers, libraries) downloads directly from GitHub Releases — no login, no Chinese servers, no third-party CDNs, no Big-Eyes CDN links, no Zygler URLs. Always available regardless of GameHub server status.

![BannerHub API component catalog](https://github.com/The412Banner/BannerHub/releases/download/v2.7.4/bannerhub_catalog.png)

## BannerHub vs BH-Lite

![BannerHub vs BH-Lite feature comparison](https://github.com/The412Banner/BannerHub/releases/download/v2.7.4/bannerhub_compare.png)

## Live Endpoints

| Service | URL |
|---------|-----|
| **GitHub Pages (static API)** | `https://the412banner.github.io/bannerhub-api` |
| **Cloudflare Worker (proxy)** | `https://bannerhub-api.the412banner.workers.dev` |

The app points to the Cloudflare Worker. The worker serves static routes from GitHub Pages and proxies data calls (search, library, etc.) to GameHub's backend with real token injection and MD5 signature regeneration.

## Architecture

```
BannerHub App
    └─► Cloudflare Worker (bannerhub-api.the412banner.workers.dev)
            ├─► GitHub Pages  — static routes (components, Wine config, etc.)
            └─► landscape-api.vgabc.com — proxied with real token + MD5 sig
                    └─► Response augmented (Steam library, etc.) before returning
```

### Token Refresh

A separate worker (`bannerhub-api-token-refresher.the412banner.workers.dev`) runs every 4 hours, logs into GameHub via Mail.tm OTP, and stores the real token in a shared KV namespace (`TOKEN_STORE`). The main worker reads this token on every proxied request.

## Related Repositories

| Repository | Description |
|------------|-------------|
| [bannerhub](https://github.com/The412Banner/bannerhub) | Main BannerHub app — patched GameHub 5.x APK with GOG, Epic, Steam, and component manager |
| [bannerhub-api](https://github.com/The412Banner/bannerhub-api) | This repo — static API + Cloudflare Worker |
| [bannerhub-api-token-refresh](https://github.com/The412Banner/bannerhub-api-token-refresh) | Automated token refresher (Cloudflare Worker + Cron, every 4h) |
| [bannerhub-revanced](https://github.com/The412Banner/bannerhub-revanced) | ReVanced patch bundle for GameHub 6.0 — produces patched APKs that hit this Worker via the `/v6/` prefix. Default branch `gamehub-600-build`, latest stable `v1.0.0-600`. |

## Build System

TypeScript build system generates all API endpoint files from source data.

```bash
npm install
npm run build      # Generate all files
npm run validate   # Validate without generating
```

### Generated Endpoints

**Component Manifests** (`components/`):
- `box64_manifest` — Type 1: Box64/FEX emulators
- `drivers_manifest` — Type 2: GPU drivers (Turnip, Adreno, etc.)
- `dxvk_manifest` — Type 3: DXVK layers
- `vkd3d_manifest` — Type 4: VKD3D Proton
- `games_manifest` — Type 5: Game patches/configs (SteamAgent)
- `libraries_manifest` — Type 6: Windows libraries
- `steam_manifest` — Type 7: Steam client components
- `index` — Component counts by type
- `downloads` — All downloadable files

**Simulator Endpoints** (`simulator/`):
- `v2/getAllComponentList` — All components
- `v2/getComponentList` — Type 1 components only
- `v2/getContainerList` — Wine/Proton containers
- `v2/getDefaultComponent` — Default component selection
- `v2/getImagefsDetail` — Firmware info
- `executeScript/generic` — Generic ARM execution preset
- `executeScript/qualcomm` — Qualcomm-specific preset

## CDN

All component files are hosted on GitHub Releases under this repo:
```
https://github.com/The412Banner/bannerhub-api/releases/download/Components/{filename}
```

## Component types (GameHub 5.3.5)

The original 5.3.5 type schema as the BannerHub app and BH-Lite consume it. **GameHub 6.0 reuses most of these but differs on type 7 — see [§ GameHub 6.0 support](#gamehub-60-support) for the 6.0-specific table.**

The full empirical receipt — every component the upstream `sp_winemu_all_components12.xml` catalog ships, grouped by type — is checked in at [`data/sp_winemu_all_components12_by_type.txt`](data/sp_winemu_all_components12_by_type.txt).

| Type | Name | Description |
|------|------|-------------|
| 1 | Box64/FEX | x86_64 emulators for ARM64 |
| 2 | GPU Drivers | Turnip, Adreno, Mali drivers |
| 3 | DXVK | DirectX 9/10/11 → Vulkan |
| 4 | VKD3D | Direct3D 12 → Vulkan |
| 5 | Games | Game-specific patches/configs (per-game settings packs). Steam agents (`steamagent`, `SteamAgent2`) also live here. |
| 6 | Libraries / Runtime deps | Windows DLLs for Wine — vcredist, dotnet, and similar runtime dependencies |
| 7 | Steam | Steam client components — retyped from 8 → 7 in commit `ca40378` for 5.3.5 compatibility |

## GameHub 6.0 support
*(current version: 6.0.1)*

GameHub 6.0 (the KMP rewrite under `com.xiaoji.egggame`) hits the same Worker through a parallel code path that branches off a single signal: the `/v6/` path prefix.

### Client identification — the `/v6/` gate

The patched 6.0 APK from [`bannerhub-revanced`](https://github.com/The412Banner/bannerhub-revanced) ships two cooperating patches:

- **`RedirectCatalogApiPatch`** swaps both `landscape-api-{cn,oversea}.vgabc.com` hosts on the `mcj` environment enum's `Online` value for `bannerhub-api.the412banner.workers.dev`.
- **`PrefixApiPathPatch`** hooks `zdb.b(qx9 builder, String path)` — the single chokepoint every relative API call funnels through — and prepends `v6/` via the `V6PathPrefix` Java extension. Full URLs (`http://`, `https://`) pass through untouched, so direct downloads still work.

The Worker strips the prefix on entry and sets a request-scoped `is60 = true` flag. 5.x clients never carry the prefix and stay on the default branch.

```js
// bannerhub-worker.js (entry)
let is60 = false
if (url.pathname.startsWith('/v6/')) {
  is60 = true
  url.pathname = url.pathname.slice(3)
}
```

### Endpoint behavior on `/v6/`

| Endpoint | 5.x behavior | 6.0 behavior (when `is60`) |
|---|---|---|
| `simulator/v2/getAllComponentList` | Native upstream pass-through (`{list: <stringified>, total}`; `is_ui` / `gpu_range` preserved) | Wrapped as `BaseResult<EnvListData<EnvLayerEntity>>` — `{list, page, page_size, total}` with each entry passed through `reshapeFor60` (see below) |
| `simulator/v2/getComponentList` | Native upstream pass-through | Form-urlencoded body parser (6.0 sends `type` as a `pl6.J` POST builder), filter by `type` after Steam remap, then reshape |
| `simulator/v2/getImagefsDetail` | Firmware **1.3.3** (legacy, ~161 MB, versionCode 23) | Firmware **1.3.6** (~164 MB, versionCode 26) — bumped through 1.3.4 → 1.3.5 → 1.3.6, see PROGRESS_LOG. v134 + v135 assets retained on the `Components` release as rollback. |
| `simulator/v2/getContainerDetail/{id}` | (not used) | Per-id static file lookup (6.0-only endpoint) |
| All other endpoints (`chat/*`, `devices/*`, `card/*`, `cloud/*`, token-injected vgabc proxy, etc.) | Same handler — no `is60` divergence | Same handler — no `is60` divergence |

### `reshapeFor60` — what every catalog entry on `/v6/` goes through

6.0's `kotlinx-strict` deserializer rejects unknown fields and requires known fields to be present with the right shape. Without `reshapeFor60`, every component-list parse throws and zero `COMPONENT:*` keys land in `sp_winemu_unified_resources.xml` on device.

| Field | What `reshapeFor60` does |
|---|---|
| `is_ui`, `gpu_range` | Stripped — these are 5.x fields the 6.0 deserializer rejects |
| `fileType` | Pinned to `0` for the `base` entry (Wine prefix scaffold extractor); `4` for everything else (single-package extractor) |
| `framework`, `framework_type`, `blurb`, `upgrade_msg` | Defaulted to empty string when missing |
| `status` | Defaulted to `0` when missing |
| `sub_data`, `base` | Defaulted to `null` when missing |

### Component types in 6.0 — what we know

5.x type ints (the table immediately above this section) are **mostly** identical in 6.0. Types 1–6 are now confirmed identical to 5.3.5 by direct on-device evidence. Steam clients are the only known divergence: 5.3.5 uses type 7, 6.0 uses type 8. (Steam agents — distinct from clients — stay at type 5 in both versions.)

The full empirical receipt — every `COMPONENT:*` key the 6.0 host wrote to `sp_winemu_unified_resources.xml` on a real device, grouped by type — is checked in at [`data/sp_winemu_strings_by_type.txt`](data/sp_winemu_strings_by_type.txt).

| Type | Category | 6.0 status |
|---|---|---|
| 1 | Box64 / FEX | ✅ **confirmed live** — bannerhub-revanced Component Manager v0.3.3 corrected `TYPE_BOX64/TYPE_FEXCORE` from 6 → 1; on-device registry shows entries persisted at type 1 |
| 2 | GPU Drivers | ✅ **confirmed live** — non-default Turnip picked in 6.0 picker, downloaded, and used to launch a game on device |
| 3 | DXVK | ✅ **confirmed live** — non-default DXVK picked, downloaded, and used to launch a D3D9/10/11 game on device |
| 4 | VKD3D | ✅ **confirmed live** — non-default VKD3D picked, downloaded, and used to launch a D3D12 game on device |
| 5 | Games | ✅ **confirmed live** — Game-specific patches/configs (per-game settings packs); same category in both 5.3.5 and 6.0. Steam agents (`steamagent`, `SteamAgent2`) also live here. |
| 6 | Libraries / Runtime deps | ✅ **confirmed live** — Windows DLLs for Wine: vcredist, dotnet components, and similar runtime dependencies; same category in both 5.3.5 and 6.0 |
| 8 | Steam *(was type 7 in 5.3.5)* | ✅ **confirmed live** — Worker remaps type 7 → 8 on `/v6/` and `steam_client_0403` is picker-visible, downloads, and runs Steam games on device. `steam_client_0403` originally shipped at type 8 (commit `d694e1a`) before the 5.3.5 retype to 7; 6.0 kept the pre-retype convention. |

### Steam handling on 6.0

#### `remapSteamFor60` — type 7 → 8

Every Steam *client* in the catalog ships at type 7 (5.3.5 convention). On `/v6/`, `remapSteamFor60` promotes `e.type === 7` to `e.type = 8` before the type filter runs (so a 6.0 client requesting `type=8` actually receives them). Steam *agents* (type 5: `steamagent`, `SteamAgent2`) are intentionally untouched — type 5 is the correct category for them in both 5.3.5 and 6.0.

#### `keepForSteamClientAllowlist60` — only `steam_client_0403`

Upstream's catalog ships `steam_9866232` and `steam_9866233` alongside `steam_client_0403`. For 6.0 we surface only `steam_client_0403` in the picker; the 9866* clients are kept in the 5.x pass-through response for back-compat but filtered from `/v6/` responses entirely. Adding more allowed clients later is a one-set extension:

```js
const ALLOWED_STEAM_CLIENTS = new Set(['steam_client_0403'])
```

#### `isSteam` on containers (not components)

GameHub 6.0 reads **`isSteam`** (camelCase) on **containers** (Wine/Proton runtime containers from `getContainerList`) — not on components. The flag tells the host which container can host the Steam client component. Components themselves carry no Steam-related field; type 8 alone (the remap above) is what makes Steam clients picker-visible to 6.0.

The upstream catalog already carries the correct values in the snake-case `is_steam` field on each container. On `/v6/getContainerList` the Worker mirrors them to camelCase verbatim:

| `isSteam` | Containers (6.0 + 5.3.5) |
|---|---|
| **1** | `proton10.0-x64-1`, `proton10.0-arm64x-2`, `proton9.0-x64-3`, `proton9.0-arm64x-3`, `proton11.0-arm64x`, `wine10.6-arm64x-2` (all Proton-based + the one Wine ARM64EC container) |
| **2** | `wine9.5-x64-2`, `wine9.13-x64-2`, `wine9.16-x64-2`, `wine10.0-x64-2` (all plain Wine x64) |

5.x clients hit the same upstream pass-through and continue to read snake-case `is_steam` only — no `isSteam` is added to their responses. (Earlier versions of `reshapeFor60` defaulted a snake-case `is_steam=0` on every component, which was dead code — 6.0 never read it. Removed.)

#### BannerHub-fork JavaSteam integration

**Not ported to 6.0.** The Worker's `steam_user_steamid` KV key + `augmentSteamLibrary` handler exist for the BannerHub 5.x app's in-app Steam client to populate; `bannerhub-revanced` for 6.0 ships only the API redirect, no Steam-aware patches, so that branch is currently dead for 6.0 traffic.

### What 6.0 receives at install bootstrap

| Component | Detail |
|---|---|
| **base** (Wine prefix scaffold) | id 8, `fileType: 0`, ~40 MB (`base.tzst`, MD5 `3d5c31b1346985d582f04d239004b4d7`). Same binary as 5.x — no `/v6/` override. Confirmed byte-identical to XiaoJi's 1.3.6 base on 2026-05-08, so firmware bumps don't require a base swap. |
| **Firmware (imagefs)** | `1.3.6`, versionCode 26, ~164 MB (171,913,961 B), MD5 `bc95fcb8dc02dac7d61e1be7dd374aeb`, asset `imagefs_136.zst`. **6.0-only** — 5.x stays on 1.3.3. |
| **Container (Wine/Proton)** | One of 10 returned by `getContainerList`: `wine10.0-x64-2`, `wine9.5/9.13/9.16-x64-2`, `wine10.6-arm64x-2`, `proton10.0-arm64x-2`, plus 4 more. Same set 5.x sees. |

### Known gaps

- **No probe yet for type 9+ categories** XiaoJi may have introduced in the KMP rewrite.

## Directory Structure

```
bannerhub-api/
├── src/                    # TypeScript source
│   ├── index.ts
│   ├── parsers/
│   ├── generators/
│   ├── registry/
│   ├── types/
│   └── utils/
├── data/                   # Source data
│   ├── sp_winemu_all_components12.xml
│   ├── custom_components.json
│   ├── containers.json
│   ├── imagefs.json
│   ├── defaults.json
│   └── execution_config.json
├── components/             # Generated manifests
├── simulator/              # Generated API endpoints
├── bannerhub-worker.js     # Cloudflare Worker source
└── CLOUDFLARE_WORKER_REPORT.md
```

## Adding Components

### From Updated XML
1. Replace `data/sp_winemu_all_components12.xml`
2. Run `npm run build`
3. Upload missing files to the Components release

### Custom Components
1. Add entry to `data/custom_components.json`
2. Run `npm run build`
3. Upload the component file to the Components release

## Component Hosting — Verified GitHub-Only

Every downloadable component file (DXVK, VKD3D, Box64, FEXCore, GPU drivers, libraries) is hosted exclusively on GitHub Releases under this repository:

```
https://github.com/The412Banner/bannerhub-api/releases/download/Components/{filename}
```

**No third-party CDNs are used for component downloads.** All component `download_url` fields in every manifest point to `github.com` — verified by scanning all JSON manifests.

### Full URL audit

| Domain | Where used | Component downloads? |
|--------|-----------|----------------------|
| `github.com/The412Banner/bannerhub-api` | All component files | ✅ Yes — only download host |
| `landscape-api.vgabc.com` | Cloudflare Worker proxy → GameHub backend (game listings, Steam card) | ❌ No |
| `steamcommunity.com` | Steam library XML feed (Steam game list augmentation) | ❌ No |
| `cdn.cloudflare.steamstatic.com` | Steam game box art / header images | ❌ No |
| `dl.winehq.org` | Wine library reference links in `data/` manifest | ❌ No |
| `download.microsoft.com` | vcredist, dotnet library references in `data/` manifest | ❌ No |
| `proxy.usebottles.com` | Some library entries in `data/` manifest | ❌ No |

No Big-Eyes CDN links. No Zygler URLs. No undisclosed third-party file hosts.

## Privacy

No user data, analytics, or tracking. Contains only public component manifests, open-source configuration, and CDN download links.


## Community

Join our Discord: https://discord.gg/n8S4G2WZQ4
