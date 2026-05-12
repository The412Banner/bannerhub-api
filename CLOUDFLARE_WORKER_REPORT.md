# BannerHub API — Cloudflare Worker Report

**Worker URL:** `bannerhub-worker.{account}.workers.dev`
**Repo:** `The412Banner/bannerhub-api`
**Default branch:** `master` (GitHub Pages serves from `main` — push both)

---

## Architecture Overview

The BannerHub Cloudflare Worker acts as a **reverse proxy and augmentation layer** between the BannerHub Android app and GameHub's backend (`landscape-api.vgabc.com`). It intercepts every API call the app makes and does one of three things:

1. **Serve from GitHub Pages** — static routes (component lists, Wine configs, etc.) are served from `the412banner.github.io/bannerhub-api` instead of GameHub's servers.
2. **Token injection + signature regeneration** — all proxied calls to GameHub's backend have `fake-token` replaced with the real authenticated GameHub token and the MD5 request signature regenerated.
3. **Response augmentation** — certain responses (like the Steam library sync) are modified before being returned to the app.

```
App → CF Worker → GitHub Pages (static routes)
               → GameHub API (proxied, real token injected)
                   ↑ Response augmented before returning to app
```

---

## KV Namespace: TOKEN_STORE

**KV ID:** `e94aa6c2c5c8439a890940d3c00f890f`

| Key | Value | Updated by |
|-----|-------|------------|
| `bannerhub_token` | JSON: `{token, loginTime, expires_in}` | `bannerhub-api-token-refresh` Worker every 4h |
| `steam_user_steamid` | SteamID64 string (e.g. `76561198012345678`) | App smali patch on Steam login |
| `steam_games_cache` | Reserved for future use | — |

---

## CF Worker Secrets

| Secret | Purpose | Set via |
|--------|---------|---------|
| `GAMEHUB_EMAIL` | GameHub account email for token refresh | CF dashboard / wrangler |
| `MAILTM_EMAIL` | Mail.tm OTP inbox | CF dashboard / wrangler |
| `MAILTM_PASSWORD` | Mail.tm OTP inbox password | CF dashboard / wrangler |
~~`STEAM_API_KEY`~~ | ~~Steam Web API key~~ | **Not needed** — replaced by public XML endpoint |

---

## Endpoints

### Static Routes (→ GitHub Pages)

All routes listed in `GITHUB_ROUTES` are served from GitHub Pages. Any path NOT in this set is proxied to GameHub's API. If a path is missing from `GITHUB_ROUTES`, it will be forwarded to GameHub, which may return an upgrade prompt, wrong background, or missing Steam card.

Full list: see `GITHUB_ROUTES` in `bannerhub-worker.js` (35 paths as of last update).

### Special Routes (custom handling)

#### `POST /jwt/refresh/token`
Returns the real GameHub token from KV (`bannerhub_token`). Falls back to `fake-token` if KV is empty.

#### `POST /simulator/executeScript`
Routes to `github.com/.../executeScript/{suffix}` based on `gpu_vendor` + `game_type` fields in request body. Qualcomm GPUs get a different script than generic.

#### `POST /vtouch/startType`
Routes to `startType_steam` (from GitHub Pages) when `game_type === 0`, otherwise to the standard `startType` endpoint.

#### `POST /simulator/v2/getComponentList`
Fetches the full component list from GitHub Pages, then filters by `type` field in the request body before returning.

#### `POST /steam/steamid/store` *(new — Steam library augmentation)*
Receives `{steam_id: "76561198..."}` from the BannerHub app smali patch after the user successfully logs into Steam. Stores the SteamID64 in KV as `steam_user_steamid`. Validates that the value is exactly 17 digits.

---

## Steam Library Augmentation

### Problem

GameHub's backend (`landscape-api.vgabc.com`) maintains its own catalog of Steam games. When the app syncs the user's Steam library (POST with `page=1&page_size=1000`), GameHub only returns games it has metadata for — confirmed via logcat to be ~65 games for users with 100+ owned games.

### Diagnosis (logcat `log_2026_03_27_06_51_33.log`)

```
SignUtils: ...page=1&page_size=1000&time=...&token=fake-token
SignUtils: ...steam_appids=10,20,30,...65 IDs...&token=fake-token
```

- The app requests up to 1000 games. GameHub returns 65.
- The `steam_appids=` metadata call confirms exactly 65 IDs were received.
- No pagination issue on the app side — GameHub's server-side catalog is the bottleneck.
- Image loading failures for some cards: likely games with no GameHub catalog entry.

### Solution

The Worker intercepts the library sync response (detected by `page_size === 1000` in the POST body) and augments it with the user's full Steam library via the Steam Web API:

```
App → Worker: POST {page: 1, page_size: 1000, token: "fake-token", ...}
Worker → GameHub: same request, real token injected → 65 games
Worker → Steam API: GET /IPlayerService/GetOwnedGames?key=STEAM_API_KEY&steamid=STEAMID
Worker: merges missing games, builds CardItemData objects with Steam CDN images
Worker → App: augmented response with all owned games
```

### Steam API Call

```
GET https://steamcommunity.com/{steamid}/games/?tab=all&xml=1
```

Returns XML with all owned games: `<appID>`, `<name>` per `<game>` entry.

- **No API key required**
- **Limitation:** Only works for public Steam profiles. Private profiles return no games.

### Injected Card Format (CardItemData)

Missing games are injected as `CardItemData`-compatible JSON objects:

```json
{
  "id": "APPID",
  "game_name": "Game Name from Steam API",
  "game_cover_image": "https://cdn.cloudflare.steamstatic.com/steam/apps/APPID/header.jpg",
  "content_img": "https://cdn.cloudflare.steamstatic.com/steam/apps/APPID/header.jpg",
  "square_image": "https://cdn.cloudflare.steamstatic.com/steam/apps/APPID/library_600x900.jpg",
  "game_back_image": "https://cdn.cloudflare.steamstatic.com/steam/apps/APPID/library_hero.jpg",
  "source": "steam",
  "jump_type": "",
  "is_display_title": true,
  "is_display_price": false,
  "is_display_btn": false,
  "is_pay": false,
  "is_play_video": false
}
```

**Known limitation:** `jump_type` is empty for injected games — tapping them may not launch the game. The correct GameHub `jump_type` value for Steam games is TBD (requires analysis of a real GameHub library response). Cards will be **visible** but may not be **launchable** until this is resolved.

### SteamID Delivery (smali patch — pending)

The Worker needs the user's SteamID64 in KV to make the Steam API call. This is automated via a smali patch in the BannerHub app:

- **Injection point:** After `SteamLoginActivity` completes successfully
- **SteamID source:** `XjSteamClient.getSteamID().convertToUInt64()` (JavaSteam, already available in-app)
- **Delivery:** `POST /steam/steamid/store` with `{steam_id: "76561198..."}` to the Worker
- **Fallback:** SteamID can be manually added to KV via:
  ```bash
  # CF REST API (replace with your account/namespace/token details)
  curl -X PUT "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{KV_ID}/values/steam_user_steamid" \
    -H "Authorization: Bearer {CF_TOKEN}" \
    -d "76561198XXXXXXXXX"
  ```

---

## Token Refresh Worker

**Worker:** `bannerhub-api-token-refresh`
**KV:** same `TOKEN_STORE` namespace (binding shared across both workers)

Flow: Mail.tm OTP login every 4h → extracts real GameHub token → stores as `bannerhub_token` in KV → main worker reads it on every proxied request.

**CF error 1042 note:** Workers cannot call other `workers.dev` URLs via `fetch()`. Both workers must share the same KV binding directly — do NOT use HTTP between them.

---

## Deploy Command

No `wrangler.toml` — deploy via CF REST API:

```bash
# See memory/bannerhub_api_session_2026-03-27.md for full deploy command
# Key: upload bannerhub-worker.js script body + set KV binding TOKEN_STORE
# After deploy: clear app data on test device (MMKV caches fake-token)
```

---

## GITHUB_ROUTES Rule

ALL static bannerhub-api paths MUST be in `GITHUB_ROUTES` in `bannerhub-worker.js`. Any missing path is forwarded to GameHub's real server, which causes:
- Upgrade prompt overlay
- Steam card disappearing from My Games
- Wrong background image
- Component list returning GameHub's real data instead of BannerHub's

When adding new static endpoints to `bannerhub-api`, always add them to `GITHUB_ROUTES` in the same commit.

---

## Known Issues / TODO

- [ ] **`jump_type` for injected Steam games** — determine correct value from a live GameHub library response (logcat of a working game tap)
- [ ] **Smali patch for SteamID** — automate SteamID delivery to Worker after Steam login
- [ ] **Private Steam profiles** — injected games will be 0 for users with private profiles; consider fallback using stored `steamLoginSecure` cookie (complex) or user-provided API key
- [ ] **Image loading failures** — some cards missing images; likely games outside GameHub's catalog that have no override; Steam CDN injection partially addresses this
- [ ] **6.0 auto-defaults for Steam client / per-game settings** — even after the 2026-05-12 fix series, `bannerhub-revanced` 6.0.4 users must manually pick the Steam client + some per-game settings in the container UI on first launch. `/v6/getDefaultComponent` (round 4) returns `steam_client_0403` correctly, but the per-game settings row isn't being seeded from it on first save. Open investigation — tail-driven debug recipe in §"6.0 install-flow fixes" is the path forward.

---

## 6.0 client (`/v6/` prefix) architecture

GameHub 6.0 was rewritten in KMP/Compose with a kotlinx-strict serializer pipeline. The `bannerhub-revanced` patched APK adds a `v6/` prefix to every relative API path emitted by `URL_HELPER_CLASS.b(builder, path)`. The Worker strips the prefix at the top of `fetch()` and sets `is60 = true`, then existing path handlers run unchanged — except for the handful that need a 6.0-only response variant.

```js
let is60 = false
if (url.pathname.startsWith('/v6/')) {
  is60 = true
  url.pathname = url.pathname.slice(3) // keep leading slash
}
```

5.x clients never carry the prefix → `is60 = false` → all `/v6/`-only branches are bypassed and the legacy 5.x passthrough behavior is preserved.

### `reshapeFor60(e)` — applied to every component on `/v6/`

Runs in both `getComponentList` and `getAllComponentList` handlers, inside the `is60` branch only. Strips dead 5.x fields, injects 6.0-required fields, applies upstream-value overrides.

| Behavior | Detail |
|---|---|
| `delete e.is_ui` | 5.x-only field, ignored on 6.0 |
| `delete e.gpu_range` | 5.x-only field |
| `e.fileType = 4` | Forced unconditionally. Upstream Xiaoji /v6/ ships every COMPONENT with fileType=4 (351/351 verified). Our 5.x source XML had `fileType=0` universally; without this override, /v6/ served 0 and the install task routed to the wrong extractor. **Fix landed `ac8ae07` 2026-05-12.** |
| `e.is_steam = 0 if undefined` | Upstream ships `isSteam` (camelCase via kotlinx `@SerialName`) on every COMPONENT, always 0 across all 351. We were stripping it; missing-field vs zero-value matters to kotlinx-strict. **Fix landed `ac8ae07` 2026-05-12.** |
| `e.status = UPSTREAM_STATUS1.has(name) ? 1 : 0` | Upstream marks 9 specific components as "currently active / recommended" (`status=1`): base, steam_client_0403, vkd3d-2.12, dxvk-2.3.1-async, vcredist2019, SteamAgent2, Fex_20260509, Turnip_v26.2.0_R3, turnip_v26.1.0_R4. Manual maintenance set; update when upstream rotates a recommended component. **Fix landed `cb225c3` 2026-05-12.** |
| `UPSTREAM_YML_OVERRIDES.get(name)` | 17 `.yml` install scripts (vcredist*, mono*, gecko, physx, K-Lite, VulkanRT, XLiveRedist, cjkfonts, oalinst) upstream bumped to v1.0.1+ while our static catalog stayed on v1.0.0. Files mirrored to our `Components` GH release at md5-named paths; reshape applies the override. **Fix landed `b0f23ac` 2026-05-12.** |
| `framework`, `framework_type`, `blurb`, `upgrade_msg`, `sub_data`, `base` defaults | Inject defaults for fields the 6.0 kotlinx-strict deserializer expects but our 5.x source catalog never carried. |

### `/v6/`-only dedicated handlers

| Path | Behavior | Why |
|---|---|---|
| `/v6/simulator/v2/getContainerList` | Mirrors snake-case `is_steam` → camelCase `isSteam` per container (verbatim values 0/1/2 preserved) | 6.0 reads camelCase `isSteam` on containers (not on components) |
| `/v6/simulator/v2/getImagefsDetail` | Returns firmware 1.3.7 (vs 1.3.3 for 5.x) | 6.0 requires 1.3.7 imagefs |
| `/v6/simulator/v2/getDefaultComponent` | Rewrites `data.steamClient` to `steam_client_0403` (type=8, fileType=4, status=1) | Static file points default Steam client at `steam_9866233` (type=7), which our `/v6/` catalog filters out via `keepForSteamClientAllowlist60`. Launch task validates → no match → install fails. **Fix landed `dc04845` 2026-05-12.** |
| `/v6/simulator/executeScript` | Injects `data.deps = []` when missing | 6.0's `GameEnvConfigEntity$$serializer` marks `deps` as REQUIRED (`Lr0h;->j(name, false)`); our 5.x-era static catalog doesn't carry it. kotlinx-strict throws `MissingFieldException("deps")` → launch task gets no env config → generic install failure. **Fix landed `a15d319` 2026-05-12.** |

### Auth-passthrough block (shared with 5.x)

The following paths bypass the generic proxy and instead forward client `clientparams`/`sign`/`time` headers + inject the real `bannerhub_token` from KV:

- `/vcontroller/*`
- `/simulator/configList`, `/simulator/getConfigById`, `/simulator/shareConfig`, `/simulator/deleteShareConfig`, `/simulator/reportConfigApply`
- `/simulator/getLocalGameDetail` (added 2026-05-11 `79d3d0d` — fixed missing cover art on PC EXE imports)
- `/simulator/getGameLoadingPromptList` (**added 2026-05-12 `e132cad` — the actual unblocker for Brawlhalla Steam-library launches on bannerhub-revanced 6.0.4**)
- `/readLayoutType/*`, `/writeLayoutType/*`

Without this passthrough, the generic proxy resets headers to `{Content-Type: application/json}` only — dropping the auth headers and causing upstream to reject anonymous requests with 400 "Invalid parameters" or 401.

---

## 6.0 install-flow fixes (2026-05-12)

Triggered by `task install components failed` on Brawlhalla launch in `bannerhub-revanced` 6.0.2 (later 6.0.4). Same container settings worked on vanilla GameHub 6.0.x (real upstream) and on BannerHub 3.7.2 (5.x passthrough). Scoped to `/v6/` reshape path.

**Six rounds of `/v6/`-only worker fixes** — every fix is server-side, no APK rebuild required, 5.x clients verified untouched on every deploy:

| Round | Commit | Deploy ID | Fix |
|---|---|---|---|
| 1 | `ac8ae07` | `3ee299be…` | fileType=4 + is_steam=0 in reshapeFor60 |
| 2 | `cb225c3` | `fd8eaf40…` | UPSTREAM_STATUS1 rotation set (9 names → status=1) |
| 3 | `b0f23ac` | `6fbbdfc7…` | UPSTREAM_YML_OVERRIDES map (17 fresher .yml install scripts mirrored from upstream) |
| 4 | `dc04845` | `7afe847c…` | getDefaultComponent steamClient swap to `steam_client_0403` on /v6/ |
| 5 | `a15d319` | `fc803738…` | executeScript inject required `deps: []` on /v6/ |
| **6** | **`e132cad`** | **`9a782221…`** | **getGameLoadingPromptList added to auth-passthrough** — THE actual unblocker |

Rounds 1–5 closed real gaps (catalog shape, kotlinx-strict required fields, default-component routing) but none was the actual blocker. Round 6 cleared the final blocking 400 — identified via live Cloudflare Workers tail. Brawlhalla launches confirmed working end-to-end after round 6 (with manual Steam client + per-game settings configuration; see TODO above for the auto-defaults follow-up).

### Diagnostic-tail recipe

For any future 6.0 install-flow failure with no specific component name in the toast, this debug loop is much faster than speculative reshapes:

1. **Create a Workers tail session:**
   ```bash
   curl -X POST -H "Authorization: Bearer $CF_TOKEN" \
     "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/workers/scripts/bannerhub-api/tails" \
     -d '{}'
   ```
   Returns `wss://tail.developers.workers.dev/<id>`.
2. **Add a `console.log` at the top of `fetch()`** (already present in current worker source; remove only after the investigation closes):
   ```js
   console.log(`[REQ] ${request.method} ${is60 ? '/v6 ' : '5x  '}${url.pathname}${url.search}`)
   ```
3. **Connect a WebSocket client with the `trace-v1` subprotocol.** The Termux Python interpreter (`/data/data/com.termux/files/usr/bin/python3`) with the `websockets` library works; PRoot Python needs `--break-system-packages` install.
4. **Have the user reproduce the failure with a known timestamp.** Other live users mix into the stream — filter by HH:MM window with `awk`.
5. **`grep -vE "heartbeat|card/v2/getIndexList|cloud/order|search/getHot|cloud_sign|getH5ShareLink|game/v2/detail|favicon"`** strips the heartbeat/auth noise so any genuine install-flow 4xx pops out.

### 6.0-schema gap recipe (different problem class)

For "task install components failed" with no obvious 4xx in the tail (i.e. all 200s but deserialization is still failing):

1. Decompile the 6.0 APK with apktool: `java -jar ~/apktool.jar d <apk> -o /tmp/gh<ver>_smali -f --no-res`
2. Find the relevant kotlinx `*$$serializer.smali` class for the response shape (often co-located in `smali_classes*/com/xiaoji/egggame/common/winemu/`).
3. Parse the `Lr0h;->j(String name, boolean optional)` calls in `<clinit>`:
   - `optional=false` (smali `const/4 vN, 0x0`) = REQUIRED → kotlinx-strict throws `MissingFieldException` if missing
   - `optional=true` (smali `const/4 vN, 0x1`) = OPTIONAL → kotlinx default applies
4. Compare against the JSON shape your endpoint actually returns; inject defaults for any required fields the worker isn't currently sending.
