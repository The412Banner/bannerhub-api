# BannerHub API

Static JSON API and Cloudflare Worker proxy for the [BannerHub](https://github.com/The412Banner/bannerhub) Android app. Replaces GameHub's original Chinese servers with a fully self-hosted, privacy-respecting backend.

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
| [bannerhub](https://github.com/The412Banner/bannerhub) | Main BannerHub app — patched GameHub APK with GOG, Epic, Steam, and component manager |
| [bannerhub-api](https://github.com/The412Banner/bannerhub-api) | This repo — static API + Cloudflare Worker |
| [bannerhub-api-token-refresh](https://github.com/The412Banner/bannerhub-api-token-refresh) | Automated token refresher (Cloudflare Worker + Cron, every 4h) |

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

## Component Types

| Type | Name | Description |
|------|------|-------------|
| 1 | Box64/FEX | x86_64 emulators for ARM64 |
| 2 | GPU Drivers | Turnip, Adreno, Mali drivers |
| 3 | DXVK | DirectX 9/10/11 → Vulkan |
| 4 | VKD3D | Direct3D 12 → Vulkan |
| 5 | Games | Game-specific patches/configs |
| 6 | Libraries | Windows DLLs for Wine |
| 7 | Steam | Steam client components |

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
