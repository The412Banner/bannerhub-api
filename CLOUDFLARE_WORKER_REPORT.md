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
| `STEAM_API_KEY` | Steam Web API key for `IPlayerService/GetOwnedGames` | CF dashboard / wrangler |

### Adding STEAM_API_KEY

1. Get a free Steam Web API key at: `https://steamcommunity.com/dev/apikey`
2. Add to the Worker via CF REST API or wrangler (no wrangler.toml — see deploy command below).

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
GET https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/
  ?key={STEAM_API_KEY}
  &steamid={steam_user_steamid from KV}
  &include_appinfo=1
  &include_played_free_games=1
  &format=json
```

Returns: `{response: {game_count: N, games: [{appid, name, playtime_forever, img_icon_url, ...}]}}`

**Limitation:** Only works for public Steam profiles. Private profiles return 0 games from this endpoint with a third-party API key.

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
