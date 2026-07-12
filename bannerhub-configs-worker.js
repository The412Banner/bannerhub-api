// BannerHub Game Configs Worker
// Handles upload, list, download, games browse, voting, comments, reports, descriptions
// Config files stored in The412Banner/bannerhub-game-configs GitHub repo
// KV binding: CONFIG_KV
//
// KV key scheme:
//   token:<sha>        — upload token (set at upload, used for user delete + describe)
//   votes:<sha>        — vote count
//   downloads:<sha>    — download count
//   reports:<sha>      — report count
//   desc:<sha>         — uploader description
//   source:<sha>       — JSON {app_source, game, filename} for filtering/purge
//   comments:<g>/<f>   — comment array
//   cache:list:<game>  — cached list response (3 min TTL)
//   cache:games        — cached games list
//
// Bannerlator OPTIONAL accounts (ADDITIVE, all keys "bl"-prefixed, Bannerlator-global):
//   bluser:<lowercased_username> — {user_id, username, pass:{hash,salt,iters},
//                                   rec:{hash,salt,iters}, avatarUrl, createdAt}
//   bluserid:<user_id>           — <lowercased_username>  (reverse lookup)
//   blusertokens:<user_id>       — [{sha, game, filename, ts}]  cross-device upload registry
//   blrl:create:<ip>             — account-creation rate-limit counter (TTL 1h)
//   blrl:login:<ip>              — login/reset fail counter (TTL 15m)
//   bllock:login:<ip>            — login/reset lockout flag  (TTL 15m)

const GITHUB_OWNER = "The412Banner";

// ── Namespace → repo routing (ADDITIVE, 2026-07-11) ──────────────────────────
// The calling APP declares its namespace via ?ns=<name>. There is NO auto-detection.
// NO ns (or an unknown ns) → "bannerhub" = the ORIGINAL repo and behavior, preserved
// byte-for-byte so existing BannerHub clients are completely unaffected.
// ns=bannerlator → the SEPARATE Bannerlator repo. BannerHub clients never send this
// param, so they can never see Bannerlator configs (asymmetric visibility by design).
const REPOS = {
  bannerhub:   "bannerhub-game-configs",
  bannerlator: "bannerlator-game-configs",
};
function nsOf(url)  { const ns = url.searchParams.get("ns"); return REPOS[ns] ? ns : "bannerhub"; }
function repoOf(ns) { return REPOS[ns] || REPOS.bannerhub; }

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
      }

      let response;
      const p = url.pathname;
      const m = request.method;

      if      (m === "GET"  && p === "/games")    response = await handleGames(url, env);
      else if (m === "GET"  && p === "/list")     response = await handleList(url, env);
      else if (m === "POST" && p === "/upload")   response = await handleUpload(request, env);
      else if (m === "GET"  && p === "/download") response = await handleDownload(url, env);
      else if (m === "POST" && p === "/vote")     response = await handleVote(request, env);
      else if (m === "POST" && p === "/report")   response = await handleReport(request, env);
      else if (m === "POST" && p === "/describe") response = await handleDescribe(request, env);
      else if (m === "GET"  && p === "/desc")     response = await handleGetDesc(url, env);
      else if (m === "GET"  && p === "/comments") response = await handleGetComments(url, env);
      else if (m === "POST" && p === "/comment")      response = await handlePostComment(request, env);
      else if (m === "POST" && p === "/delete")        response = await handleUserDelete(request, env);
      else if (m === "POST" && p === "/admin/delete") response = await handleAdminDelete(request, env);
      else if (m === "POST" && p === "/admin/edit")   response = await handleAdminEdit(request, env);
      else if (m === "POST" && p === "/admin/purge")  response = await handleAdminPurge(request, env);
      else if (m === "GET"  && p === "/steam/search") response = await handleSteamSearch(url);
      else if (m === "POST" && p === "/account/create") response = await handleAccountCreate(request, env);
      else if (m === "POST" && p === "/account/login")  response = await handleAccountLogin(request, env);
      else if (m === "POST" && p === "/account/reset")  response = await handleAccountReset(request, env);
      else if (m === "POST" && p === "/account/avatar") response = await handleAccountAvatar(request, env);
      else if (m === "GET"  && p === "/account/avatar") response = await handleGetAvatar(url, env);
      else if (m === "GET"  && p === "/account/count")  response = await handleAccountCount(env);
      else response = json({ error: "Not found" }, 404);

      const out = new Response(response.body, { status: response.status, headers: new Headers(response.headers) });
      Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }
  }
};

// ── KV write helpers (fail silently on limit exceeded) ────────────────────────
async function kvPut(kv, key, value, opts) {
  try { await kv.put(key, value, opts); } catch (e) { /* quota exceeded — skip */ }
}
async function kvDelete(kv, key) {
  try { await kv.delete(key); } catch (e) { /* quota exceeded — skip */ }
}

// ── GET /games[?refresh=1] ────────────────────────────────────────────────────
// Returns [{name, count}] from the pre-built games.json in the repo (updated every 30 min by CI).
// Falls back to GitHub directory listing if games.json is unavailable.
async function handleGames(url, env) {
  const repo = repoOf(nsOf(url));
  const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${repo}/main/games.json`;
  const res = await fetch(rawUrl);
  if (res.ok) {
    const text = await res.text();
    return new Response(text, { headers: { "Content-Type": "application/json" } });
  }

  // Fallback: directory listing
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/configs`;
  const r2 = await ghFetch(apiUrl, env);
  if (r2.status === 404) return json([], 200);
  if (!r2.ok) return json({ error: "GitHub error: " + r2.status }, 502);
  const items = await r2.json();
  const SYSTEM_FOLDERS = new Set(["BootstrapPackagedGame"]);
  const games = items
    .filter(i => i.type === "dir" && !SYSTEM_FOLDERS.has(i.name))
    .map(i => ({ name: i.name, count: 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return json(games);
}

// ── GET /list?game=<GameName>[&refresh=1] ─────────────────────────────────────
// Returns config entries with votes + downloads attached. KV-cached 3 min.
async function handleList(url, env) {
  const game = url.searchParams.get("game");
  if (!game) return json({ error: "game parameter required" }, 400);
  const bust = url.searchParams.get("refresh") === "1";
  const repo = repoOf(nsOf(url));
  const cacheKey = "cache:list:" + repo + ":" + game;

  if (!bust && env.CONFIG_KV) {
    try {
      const cached = await env.CONFIG_KV.get(cacheKey);
      if (cached) return json(JSON.parse(cached));
    } catch (e) { /* re-fetch */ }
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/configs/${encodeURIComponent(game)}`;
  const res = await ghFetch(apiUrl, env);
  if (res.status === 404) return json([], 200);
  if (!res.ok) return json({ error: "GitHub error: " + res.status }, 502);

  const files = await res.json();
  const entries = files.filter(f => f.name.endsWith(".json")).map(f => {
    const base  = f.name.replace(".json", "");
    const parts = base.split("-");
    const ts    = parseInt(parts[parts.length - 1]) || 0;
    const secondLast = parseInt(parts[parts.length - 2]);
    const hasSOC = isNaN(secondLast) || secondLast < 1000000000;
    const soc   = hasSOC ? parts[parts.length - 2] : "";
    const deviceParts = hasSOC ? parts.slice(0, parts.length - 2) : parts.slice(0, parts.length - 1);
    const gameParts = game.split("-");
    const device = deviceParts.slice(gameParts.length).join("-");
    return {
      filename:    f.name,
      size:        f.size,
      sha:         f.sha,
      timestamp:   ts,
      device:      device || deviceParts.join("-"),
      soc:         soc,
      date:        ts > 0 ? new Date(ts * 1000).toISOString().split("T")[0] : "",
      game_folder: game
    };
  });

  // Attach votes, downloads, and app_source in parallel
  if (env.CONFIG_KV) {
    await Promise.all(entries.map(async e => {
      try {
        const [voteVal, dlVal, sourceVal] = await Promise.all([
          env.CONFIG_KV.get("votes:"   + e.sha),
          env.CONFIG_KV.get("downloads:" + e.sha),
          env.CONFIG_KV.get("source:"  + e.sha)
        ]);
        e.votes      = voteVal ? parseInt(voteVal) : 0;
        e.downloads  = dlVal   ? parseInt(dlVal)   : 0;
        e.app_source = sourceVal ? (JSON.parse(sourceVal).app_source || "bannerhub") : "bannerhub";
      } catch (e2) { e.votes = 0; e.downloads = 0; e.app_source = "bannerhub"; }
    }));
  } else {
    entries.forEach(e => { e.votes = 0; e.downloads = 0; e.app_source = "bannerhub"; });
  }

  entries.sort((a, b) => b.votes !== a.votes ? b.votes - a.votes : b.timestamp - a.timestamp);

  if (env.CONFIG_KV) {
    await kvPut(env.CONFIG_KV, cacheKey, JSON.stringify(entries), { expirationTtl: 180 });
  }
  return json(entries);
}

// ── POST /upload ──────────────────────────────────────────────────────────────
// Body: { game, filename, content (base64), upload_token (optional) }
// Returns: { success, path, sha }
async function handleUpload(request, env) {
  const url = new URL(request.url);
  const ns  = nsOf(url);
  const repo = repoOf(ns);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const { game, filename, content, upload_token, session } = body;
  if (!game || !filename || !content) {
    return json({ error: "game, filename, and content are required" }, 400);
  }

  const safegame = game.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const safefile = filename.replace(/[^a-zA-Z0-9_\-\.]/g, "_");
  const path     = `configs/${safegame}/${safefile}`;

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/${path}`;
  const res = await ghFetch(apiUrl, env, {
    method: "PUT",
    body: JSON.stringify({
      message:   `Add config: ${safegame}/${safefile}`,
      content:   content,
      committer: { name: "BannerHub", email: "bannerhub@users.noreply.github.com" }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    return json({ error: "GitHub error: " + err }, 502);
  }

  const apiData = await res.json();
  const sha = apiData.content ? apiData.content.sha : "";

  if (env.CONFIG_KV) {
    if (sha && upload_token) await kvPut(env.CONFIG_KV, "token:" + sha, String(upload_token).slice(0, 64));

    // Extract app_source from uploaded config meta and store for filtering/purge
    if (sha) {
      try {
        const decoded = JSON.parse(atob(content));
        const appSource = decoded?.meta?.app_source || "bannerhub";
        await kvPut(env.CONFIG_KV, "source:" + sha, JSON.stringify({
          app_source: appSource,
          game: safegame,
          filename: safefile,
          ns: ns
        }));
      } catch (e) { /* non-fatal — proceed without source tag */ }
    }

    // Cross-device upload registry (ADDITIVE) — only when a valid account session is present.
    // Records this upload under the owning account so a user can recover their uploads on
    // another device. Absent/invalid session → no-op (existing behavior byte-identical).
    if (sha && session) {
      try {
        const sess = await readSession(session, env);
        if (sess && sess.uid) {
          const regKey = "blusertokens:" + sess.uid;
          let arr = [];
          try { const raw = await env.CONFIG_KV.get(regKey); if (raw) arr = JSON.parse(raw); } catch (e2) { /* reset */ }
          if (!Array.isArray(arr)) arr = [];
          if (!arr.some(x => x && x.sha === sha)) {
            // token stored so a new-device login can restore delete/edit for the user's own uploads.
            arr.push({ sha, game: safegame, filename: safefile, token: upload_token || null, ts: Math.floor(Date.now() / 1000) });
            if (arr.length > 500) arr = arr.slice(arr.length - 500);
            await kvPut(env.CONFIG_KV, regKey, JSON.stringify(arr));
          }
        }
      } catch (e) { /* non-fatal — upload already succeeded */ }
    }

    try {
      const cur = parseInt(await env.CONFIG_KV.get("counts:" + safegame) || "0");
      await kvPut(env.CONFIG_KV, "counts:" + safegame, String(cur + 1));
    } catch (e) { /* skip */ }
    await kvDelete(env.CONFIG_KV, "cache:games");
  }

  // Update recent.json + devices.json in repo (non-fatal if they fail)
  await Promise.all([
    updateRecentJson(env, repo, safegame, safefile),
    updateDevicesJson(env, repo, safegame, safefile, content)
  ]);

  return json({ success: true, path, sha });
}

// ── Update devices.json ───────────────────────────────────────────────────────
// Adds new device entry for the game, commits back.
async function updateDevicesJson(env, repo, game, filename, contentBase64) {
  try {
    const base = filename.replace(/\.json$/, "");
    const parts = base.split("-");
    if (parts.length < 3) return;
    const manufacturer = parts[parts.length - 3];
    const device       = parts[parts.length - 2];

    // Try to extract SOC from uploaded config content
    let soc = null;
    try {
      const decoded = JSON.parse(atob(contentBase64));
      if (decoded.meta && decoded.meta.soc) soc = decoded.meta.soc;
    } catch { /* ignore */ }

    const devUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/devices.json`;
    const getRes = await ghFetch(devUrl, env);

    let currentSha = null;
    let devMap = {};
    if (getRes.ok) {
      const data = await getRes.json();
      currentSha = data.sha;
      try { devMap = JSON.parse(atob(data.content.replace(/\n/g, ""))); } catch { devMap = {}; }
    }

    if (!devMap[game]) devMap[game] = [];
    // Avoid duplicate entries for same filename
    devMap[game] = devMap[game].filter(e => !(e.m === manufacturer && e.d === device && e.s === soc));
    devMap[game].push({ m: manufacturer, d: device, s: soc });

    const putBody = {
      message:   `Update devices.json: ${game}/${filename}`,
      content:   btoa(JSON.stringify(devMap)),
      committer: { name: "BannerHub", email: "bannerhub@users.noreply.github.com" }
    };
    if (currentSha) putBody.sha = currentSha;
    await ghFetch(devUrl, env, { method: "PUT", body: JSON.stringify(putBody) });
  } catch (e) { /* non-fatal */ }
}

// ── Update recent.json ────────────────────────────────────────────────────────
// Prepends new entry, deduplicates, trims to 20, commits back to repo.
async function updateRecentJson(env, repo, game, filename) {
  try {
    // Parse manufacturer, device, timestamp from filename
    // Format: GameName-...-Manufacturer-Model-timestamp.json
    const base = filename.replace(/\.json$/, "");
    const parts = base.split("-");
    if (parts.length < 3) return;
    const ts = parts[parts.length - 1];
    if (isNaN(ts) || ts.length < 8) return;
    const manufacturer = parts[parts.length - 3];
    const device       = parts[parts.length - 2];
    const timestamp    = parseInt(ts);

    // Fetch current recent.json to get its SHA for the update commit
    const recentUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/recent.json`;
    const getRes = await ghFetch(recentUrl, env);

    let currentSha = null;
    let recent = [];
    if (getRes.ok) {
      const data = await getRes.json();
      currentSha = data.sha;
      try { recent = JSON.parse(atob(data.content.replace(/\n/g, ""))); }
      catch { recent = []; }
    }

    // Prepend, deduplicate same file, trim to 20
    recent = recent.filter(r => !(r.filename === filename && r.game === game));
    recent.unshift({ game, manufacturer, device, timestamp, filename });
    recent = recent.slice(0, 20);

    const putBody = {
      message:   `Update recent.json: ${game}/${filename}`,
      content:   btoa(JSON.stringify(recent, null, 2)),
      committer: { name: "BannerHub", email: "bannerhub@users.noreply.github.com" }
    };
    if (currentSha) putBody.sha = currentSha;

    await ghFetch(recentUrl, env, { method: "PUT", body: JSON.stringify(putBody) });
  } catch (e) {
    // Non-fatal — upload already succeeded
  }
}

// ── GET /download?game=X&file=Y[&sha=Z] ──────────────────────────────────────
// Serves the raw config JSON. Increments downloads:<sha> if sha provided.
async function handleDownload(url, env) {
  const game = url.searchParams.get("game");
  const file = url.searchParams.get("file");
  const sha  = url.searchParams.get("sha");
  if (!game || !file) return json({ error: "game and file required" }, 400);

  const repo = repoOf(nsOf(url));
  const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${repo}/main/configs/${encodeURIComponent(game)}/${encodeURIComponent(file)}`;
  const res = await fetch(rawUrl);
  if (!res.ok) return json({ error: "Config not found" }, 404);
  const text = await res.text();

  if (sha && env.CONFIG_KV && Math.random() < 0.1) {
    try {
      const cur = parseInt(await env.CONFIG_KV.get("downloads:" + sha) || "0");
      await kvPut(env.CONFIG_KV, "downloads:" + sha, String(cur + 10));
    } catch (e) { /* skip */ }
  }

  return new Response(text, { headers: { "Content-Type": "application/json" } });
}

// ── POST /vote ────────────────────────────────────────────────────────────────
// Body: { sha, game, filename }. Rate limit: 1 vote per IP per config per 24h.
async function handleVote(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { sha } = body;
  if (!sha) return json({ error: "sha required" }, 400);
  if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);

  const ip    = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = `voted:${ip}:${sha}`;
  const already = await env.CONFIG_KV.get(ipKey);
  if (already) {
    const cur = parseInt(await env.CONFIG_KV.get("votes:" + sha) || "0");
    return json({ error: "already_voted", votes: cur }, 409);
  }

  const { game } = body;
  const current  = parseInt(await env.CONFIG_KV.get("votes:" + sha) || "0");
  const newCount = current + 1;
  await kvPut(env.CONFIG_KV, "votes:" + sha, String(newCount));
  await kvPut(env.CONFIG_KV, ipKey, "1", { expirationTtl: 86400 });

  return json({ success: true, votes: newCount });
}

// ── POST /report ──────────────────────────────────────────────────────────────
// Body: { sha }. Rate limit: 1 report per IP per config per 7 days.
async function handleReport(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { sha } = body;
  if (!sha) return json({ error: "sha required" }, 400);
  if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);

  const ip    = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipKey = `reported:${ip}:${sha}`;
  const already = await env.CONFIG_KV.get(ipKey);
  if (already) {
    const cur = parseInt(await env.CONFIG_KV.get("reports:" + sha) || "0");
    return json({ error: "already_reported", reports: cur }, 409);
  }

  const current  = parseInt(await env.CONFIG_KV.get("reports:" + sha) || "0");
  const newCount = current + 1;
  await kvPut(env.CONFIG_KV, "reports:" + sha, String(newCount));
  await kvPut(env.CONFIG_KV, ipKey, "1", { expirationTtl: 604800 });

  return json({ success: true, reports: newCount });
}

// ── POST /describe ────────────────────────────────────────────────────────────
// Body: { sha, token, text }. Sets the uploader's description for a config.
// Validates that token matches what was stored at upload time.
async function handleDescribe(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { sha, token, text } = body;
  if (!sha || !token || text === undefined) {
    return json({ error: "sha, token, text required" }, 400);
  }
  if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);

  const stored = await env.CONFIG_KV.get("token:" + sha);
  if (!stored || stored !== String(token)) {
    return json({ error: "unauthorized" }, 403);
  }

  const safeText = String(text).slice(0, 500).replace(/[<>]/g, "");
  await kvPut(env.CONFIG_KV, "desc:" + sha, safeText);
  return json({ success: true });
}

// ── GET /desc?sha=X ───────────────────────────────────────────────────────────
// Returns the uploader's description for a config, or empty string if none set.
async function handleGetDesc(url, env) {
  const sha = url.searchParams.get("sha");
  if (!sha) return json({ error: "sha required" }, 400);
  if (!env.CONFIG_KV) return json({ text: "" });
  const text = await env.CONFIG_KV.get("desc:" + sha);
  return json({ text: text || "" });
}

// ── GET /comments?game=X&file=Y ───────────────────────────────────────────────
async function handleGetComments(url, env) {
  const game = url.searchParams.get("game");
  const file = url.searchParams.get("file");
  if (!game || !file) return json({ error: "game and file required" }, 400);
  if (!env.CONFIG_KV) return json([], 200);
  const key = `comments:${game}/${file}`;
  try {
    const raw = await env.CONFIG_KV.get(key);
    return json(raw ? JSON.parse(raw) : []);
  } catch (e) { return json([]); }
}

// ── POST /comment ─────────────────────────────────────────────────────────────
// Body: { game, filename, text, device }. Max 500 chars, 200 comments per config.
async function handlePostComment(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const { game, filename, text, device } = body;
  if (!game || !filename || !text) return json({ error: "game, filename, text required" }, 400);
  if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);

  const safeText = String(text).slice(0, 500).replace(/[<>]/g, "");
  const key = `comments:${game}/${filename}`;
  try {
    const raw = await env.CONFIG_KV.get(key);
    const arr = raw ? JSON.parse(raw) : [];
    if (arr.length >= 200) arr.shift();
    arr.push({
      text:   safeText,
      device: String(device || "Anonymous").slice(0, 60).replace(/[<>]/g, ""),
      date:   new Date().toISOString().split("T")[0],
      ts:     Math.floor(Date.now() / 1000)
    });
    await kvPut(env.CONFIG_KV, key, JSON.stringify(arr));
  } catch (e) { /* skip */ }
  return json({ success: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── GET /steam/search?name=X ──────────────────────────────────────────────────
// Proxies Steam store search to avoid CORS. Returns { appid, name, cover }.
async function handleSteamSearch(url) {
  const name = url.searchParams.get("name");
  if (!name) return json({ error: "name required" }, 400);

  const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=US`;
  try {
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) return json({ error: "Steam API error" }, 502);
    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) return json({ appid: null });

    // Pick best match — prefer exact name match, otherwise first result
    const lower = name.toLowerCase();
    const exact = items.find(i => i.name.toLowerCase() === lower);
    const best  = exact || items[0];

    return json({
      appid: best.id,
      name:  best.name,
      cover: `https://cdn.akamai.steamstatic.com/steam/apps/${best.id}/header.jpg`
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

// ── Admin brute-force protection ──────────────────────────────────────────────
// 5 failed attempts per IP locks out for 15 minutes.
const MAX_ATTEMPTS = 5;
const LOCKOUT_TTL  = 900; // 15 min in seconds

async function checkAdminAuth(request, env, password) {
  if (!env.CONFIG_KV) return { ok: false, error: "KV not configured" };
  const ip       = request.headers.get("CF-Connecting-IP") || "unknown";
  const lockKey  = `admin:lock:${ip}`;
  const failKey  = `admin:fail:${ip}`;

  const locked = await env.CONFIG_KV.get(lockKey);
  if (locked) return { ok: false, error: "Too many failed attempts — try again in 15 minutes." };

  if (!password || password !== env.ADMIN_SECRET) {
    const fails = parseInt(await env.CONFIG_KV.get(failKey) || "0") + 1;
    if (fails >= MAX_ATTEMPTS) {
      await env.CONFIG_KV.put(lockKey, "1", { expirationTtl: LOCKOUT_TTL });
      await env.CONFIG_KV.delete(failKey);
      return { ok: false, error: "Too many failed attempts — locked out for 15 minutes." };
    }
    await env.CONFIG_KV.put(failKey, String(fails), { expirationTtl: LOCKOUT_TTL });
    return { ok: false, error: "Unauthorized" };
  }

  // Success — clear any fail counter
  await env.CONFIG_KV.delete(failKey);
  return { ok: true };
}

// ── POST /delete ──────────────────────────────────────────────────────────────
// Body: { sha, game, filename, upload_token }
// Verifies upload_token matches stored token, then deletes file + cleans up KV.
async function handleUserDelete(request, env) {
  const url = new URL(request.url);
  const repo = repoOf(nsOf(url));
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { sha, game, filename, upload_token } = body;
  if (!sha || !game || !filename || !upload_token) {
    return json({ error: "sha, game, filename, upload_token required" }, 400);
  }
  if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);

  // Primary: verify via KV token
  let verified = false;
  const stored = await env.CONFIG_KV.get("token:" + sha);
  if (stored && stored === String(upload_token).slice(0, 64)) {
    verified = true;
  }
  // Fallback: KV entry missing — verify via upload_token embedded in the file itself
  if (!verified) {
    try {
      const fileApiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/configs/${encodeURIComponent(game)}/${encodeURIComponent(filename)}`;
      const fileRes = await ghFetch(fileApiUrl, env);
      if (fileRes.ok) {
        const fileData = await fileRes.json();
        const raw = fileData.content ? fileData.content.replace(/\n/g, "") : "";
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        const fileContent = JSON.parse(new TextDecoder().decode(bytes));
        const embeddedToken = fileContent?.meta?.upload_token;
        if (embeddedToken && embeddedToken === String(upload_token)) {
          verified = true;
          // Restore to KV so future deletes use fast path
          await kvPut(env.CONFIG_KV, "token:" + sha, String(upload_token).slice(0, 64));
        }
      }
    } catch (e) { /* non-fatal */ }
  }
  if (!verified) {
    return json({ error: "unauthorized" }, 403);
  }

  const path = `configs/${game}/${filename}`;
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/configs/${encodeURIComponent(game)}/${encodeURIComponent(filename)}`;

  const getRes = await ghFetch(apiUrl, env);
  if (!getRes.ok) return json({ error: "File not found on server" }, 404);
  const fileData = await getRes.json();

  const delRes = await ghFetch(apiUrl, env, {
    method: "DELETE",
    body: JSON.stringify({
      message: `User delete: ${path}`,
      sha: fileData.sha,
      committer: { name: "BannerHub User", email: "bannerhub@users.noreply.github.com" }
    })
  });

  if (!delRes.ok) {
    const err = await delRes.text();
    return json({ error: "GitHub error: " + err }, 502);
  }

  // Clean up all KV keys for this sha/game
  if (env.CONFIG_KV) {
    await kvDelete(env.CONFIG_KV, "token:"      + sha);
    await kvDelete(env.CONFIG_KV, "votes:"      + sha);
    await kvDelete(env.CONFIG_KV, "downloads:"  + sha);
    await kvDelete(env.CONFIG_KV, "reports:"    + sha);
    await kvDelete(env.CONFIG_KV, "desc:"       + sha);
    await kvDelete(env.CONFIG_KV, "source:"     + sha);
    await kvDelete(env.CONFIG_KV, `comments:${game}/${filename}`);
    await kvDelete(env.CONFIG_KV, "cache:list:" + repo + ":" + game);
    await kvDelete(env.CONFIG_KV, "cache:games");
    // Decrement game count
    const cur = parseInt(await env.CONFIG_KV.get("counts:" + game) || "0");
    if (cur > 1) await kvPut(env.CONFIG_KV, "counts:" + game, String(cur - 1));
    else         await kvDelete(env.CONFIG_KV, "counts:" + game);
  }

  return json({ success: true });
}

// ── POST /admin/delete ────────────────────────────────────────────────────────
// Body: { game, filename, password }
async function handleAdminDelete(request, env) {
  const repo = repoOf(nsOf(new URL(request.url)));
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { game, filename, password } = body;
  const auth = await checkAdminAuth(request, env, password);
  if (!auth.ok) return json({ error: auth.error }, 401);
  if (!game || !filename) return json({ error: "game and filename required" }, 400);

  const path = `configs/${game}/${filename}`;
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/${encodeURIComponent(path)}`;

  const getRes = await ghFetch(apiUrl, env);
  if (!getRes.ok) return json({ error: "File not found" }, 404);
  const fileData = await getRes.json();

  const delRes = await ghFetch(apiUrl, env, {
    method: "DELETE",
    body: JSON.stringify({
      message: `Admin delete: ${path}`,
      sha: fileData.sha,
      committer: { name: "BannerHub Admin", email: "bannerhub@users.noreply.github.com" }
    })
  });

  if (!delRes.ok) {
    const err = await delRes.text();
    return json({ error: "GitHub error: " + err }, 502);
  }

  if (env.CONFIG_KV) {
    await kvDelete(env.CONFIG_KV, "cache:games");
    await kvDelete(env.CONFIG_KV, "cache:list:" + repo + ":" + game);
    await kvDelete(env.CONFIG_KV, "source:"     + fileData.sha);
  }

  return json({ success: true });
}

// ── POST /admin/edit ──────────────────────────────────────────────────────────
// Body: { game, filename, content (JSON string), password }
async function handleAdminEdit(request, env) {
  const repo = repoOf(nsOf(new URL(request.url)));
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { game, filename, content, password } = body;
  const auth = await checkAdminAuth(request, env, password);
  if (!auth.ok) return json({ error: auth.error }, 401);
  if (!game || !filename || !content) return json({ error: "game, filename, and content required" }, 400);

  try { JSON.parse(content); } catch { return json({ error: "Content is not valid JSON" }, 400); }

  const path = `configs/${game}/${filename}`;
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/${encodeURIComponent(path)}`;

  const getRes = await ghFetch(apiUrl, env);
  if (!getRes.ok) return json({ error: "File not found" }, 404);
  const fileData = await getRes.json();

  const putRes = await ghFetch(apiUrl, env, {
    method: "PUT",
    body: JSON.stringify({
      message: `Admin edit: ${path}`,
      content: btoa(content),
      sha: fileData.sha,
      committer: { name: "BannerHub Admin", email: "bannerhub@users.noreply.github.com" }
    })
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    return json({ error: "GitHub error: " + err }, 502);
  }

  if (env.CONFIG_KV) await kvDelete(env.CONFIG_KV, "cache:list:" + repo + ":" + game);

  return json({ success: true });
}

// ── POST /admin/purge ─────────────────────────────────────────────────────────
// Body: { password, app_source }
// Deletes ALL configs tagged with the given app_source value.
// Uses source:<sha> KV keys (written at upload time) to find targets.
// Returns { deleted, skipped, errors }.
async function handleAdminPurge(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const { password, app_source } = body;
  const auth = await checkAdminAuth(request, env, password);
  if (!auth.ok) return json({ error: auth.error }, 401);
  if (!app_source) return json({ error: "app_source required (e.g. 'bannerhub_lite')" }, 400);
  if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);

  let deleted = 0, skipped = 0;
  const errors = [];
  let cursor = undefined;

  // Paginate through all source: keys in KV
  do {
    const listOpts = { prefix: "source:", limit: 1000 };
    if (cursor) listOpts.cursor = cursor;
    const page = await env.CONFIG_KV.list(listOpts);

    await Promise.all(page.keys.map(async ({ name: key }) => {
      try {
        const raw = await env.CONFIG_KV.get(key);
        if (!raw) return;
        const meta = JSON.parse(raw);
        if (meta.app_source !== app_source) { skipped++; return; }

        const { game, filename } = meta;
        if (!game || !filename) { skipped++; return; }
        const sha = key.replace("source:", "");
        // Route to the repo this config was uploaded to (recorded in source:<sha>.ns).
        const repo = repoOf(meta.ns);

        // Delete from GitHub
        const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/configs/${encodeURIComponent(game)}/${encodeURIComponent(filename)}`;
        const getRes = await ghFetch(apiUrl, env);
        if (getRes.ok) {
          const fileData = await getRes.json();
          const delRes = await ghFetch(apiUrl, env, {
            method: "DELETE",
            body: JSON.stringify({
              message:   `Admin purge (${app_source}): configs/${game}/${filename}`,
              sha:       fileData.sha,
              committer: { name: "BannerHub Admin", email: "bannerhub@users.noreply.github.com" }
            })
          });
          if (!delRes.ok) {
            errors.push(`${game}/${filename}: GitHub ${delRes.status}`);
            return;
          }
        } else if (getRes.status !== 404) {
          errors.push(`${game}/${filename}: GitHub ${getRes.status}`);
          return;
        }
        // File deleted (or already gone) — clean up KV
        await Promise.all([
          kvDelete(env.CONFIG_KV, "source:"     + sha),
          kvDelete(env.CONFIG_KV, "token:"      + sha),
          kvDelete(env.CONFIG_KV, "votes:"      + sha),
          kvDelete(env.CONFIG_KV, "downloads:"  + sha),
          kvDelete(env.CONFIG_KV, "reports:"    + sha),
          kvDelete(env.CONFIG_KV, "desc:"       + sha),
          kvDelete(env.CONFIG_KV, `comments:${game}/${filename}`),
          kvDelete(env.CONFIG_KV, "cache:list:" + repo + ":" + game),
        ]);
        // Decrement game count
        const cur = parseInt(await env.CONFIG_KV.get("counts:" + game) || "0");
        if (cur > 1) await kvPut(env.CONFIG_KV, "counts:" + game, String(cur - 1));
        else         await kvDelete(env.CONFIG_KV, "counts:" + game);
        deleted++;
      } catch (e) {
        errors.push(`${key}: ${e.message}`);
      }
    }));

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  await kvDelete(env.CONFIG_KV, "cache:games");
  return json({ deleted, skipped, errors });
}

function ghFetch(url, env, options = {}) {
  return fetch(url, {
    method:  options.method || "GET",
    headers: {
      Authorization:  `Bearer ${env.GITHUB_TOKEN}`,
      Accept:         "application/vnd.github+json",
      "User-Agent":   "BannerHub-Configs-Worker",
      "Content-Type": "application/json"
    },
    body: options.body || undefined
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Bannerlator OPTIONAL accounts (ADDITIVE) — username claim, cross-device recovery.
// SECURITY: passwords + recovery keys are NEVER stored or logged in plaintext; only
// PBKDF2-SHA256 (150k iters, per-secret 16-byte salt) digests are kept. Sessions are
// HMAC-SHA256(env.AUTH_SECRET) signed and fail closed if AUTH_SECRET is unset. All
// hash/HMAC comparisons are constant-time. All KV keys are "bl"-prefixed.
// ══════════════════════════════════════════════════════════════════════════════

const PBKDF2_ITERS   = 100000;  // Cloudflare Workers caps PBKDF2 at 100k iterations (deriveBits throws above it).
const RESERVED_NAMES = new Set(["admin", "anonymous", "bannerlator", "bannerhub"]);
const BL_MAX_ATTEMPTS = 5;
const BL_LOCKOUT_TTL  = 900; // 15 min
const SESSION_TTL     = 30 * 24 * 3600; // 30 days
// Dummy digest used to equalize PBKDF2 timing when a username does not exist, so the
// response time never reveals whether an account exists. Value is irrelevant.
const BL_DUMMY_PASS = {
  hash:  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  salt:  "AAAAAAAAAAAAAAAAAAAAAA==",
  iters: PBKDF2_ITERS
};

// ── Base64 helpers ────────────────────────────────────────────────────────────
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64Url(bytes) {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64UrlToBytes(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return b64ToBytes(s);
}

// ── Constant-time string compare ──────────────────────────────────────────────
function ctEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Random helpers ────────────────────────────────────────────────────────────
function randHex(nBytes) {
  const b = crypto.getRandomValues(new Uint8Array(nBytes));
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}
function randRecoveryKey() {
  // 20 chars from an unambiguous alphabet, formatted as 4 groups of 5.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let chars = "";
  for (let i = 0; i < 20; i++) chars += alphabet[bytes[i] % alphabet.length];
  return chars.match(/.{1,5}/g).join("-");
}

// ── PBKDF2-SHA256 hashing ─────────────────────────────────────────────────────
async function pbkdf2(password, saltBytes, iters) {
  const km = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: iters, hash: "SHA-256" }, km, 256
  );
  return bytesToB64(new Uint8Array(bits));
}
async function hashSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(secret, salt, PBKDF2_ITERS);
  return { hash, salt: bytesToB64(salt), iters: PBKDF2_ITERS };
}
async function verifySecret(secret, stored) {
  if (!stored || !stored.hash || !stored.salt || !stored.iters) return false;
  try {
    const salt = b64ToBytes(stored.salt);
    const hash = await pbkdf2(secret, salt, stored.iters);
    return ctEqual(hash, stored.hash);
  } catch (e) { return false; }
}

// ── HMAC-SHA256 signed sessions ───────────────────────────────────────────────
async function hmacSha256B64Url(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return bytesToB64Url(new Uint8Array(sig));
}
async function makeSession(user_id, env) {
  if (!env || !env.AUTH_SECRET) return null; // fail closed
  try {
    const payloadObj = { uid: user_id, exp: Math.floor(Date.now() / 1000) + SESSION_TTL };
    const payload = bytesToB64Url(new TextEncoder().encode(JSON.stringify(payloadObj)));
    const sig = await hmacSha256B64Url(env.AUTH_SECRET, payload);
    return payload + "." + sig;
  } catch (e) { return null; }
}
async function readSession(token, env) {
  try {
    if (!env || !env.AUTH_SECRET || !token || typeof token !== "string") return null;
    const dot = token.indexOf(".");
    if (dot < 0) return null;
    const payload = token.slice(0, dot);
    const sig     = token.slice(dot + 1);
    const expected = await hmacSha256B64Url(env.AUTH_SECRET, payload);
    if (!ctEqual(sig, expected)) return null;
    const obj = JSON.parse(new TextDecoder().decode(b64UrlToBytes(payload)));
    if (!obj || !obj.uid || !obj.exp) return null;
    if (Math.floor(Date.now() / 1000) >= obj.exp) return null;
    return { uid: obj.uid };
  } catch (e) { return null; }
}

// ── Rate limiting + login brute-force lockout ─────────────────────────────────
async function rateLimited(env, key, max, ttl) {
  if (!env.CONFIG_KV) return false;
  try {
    const cur = parseInt(await env.CONFIG_KV.get(key) || "0");
    if (cur >= max) return true;
    await kvPut(env.CONFIG_KV, key, String(cur + 1), { expirationTtl: ttl });
    return false;
  } catch (e) { return false; }
}
async function loginLocked(env, ip) {
  if (!env.CONFIG_KV) return false;
  try { return !!(await env.CONFIG_KV.get("bllock:login:" + ip)); } catch (e) { return false; }
}
async function loginFail(env, ip) {
  if (!env.CONFIG_KV) return;
  try {
    const failKey = "blrl:login:" + ip;
    const fails = parseInt(await env.CONFIG_KV.get(failKey) || "0") + 1;
    if (fails >= BL_MAX_ATTEMPTS) {
      await kvPut(env.CONFIG_KV, "bllock:login:" + ip, "1", { expirationTtl: BL_LOCKOUT_TTL });
      await kvDelete(env.CONFIG_KV, failKey);
    } else {
      await kvPut(env.CONFIG_KV, failKey, String(fails), { expirationTtl: BL_LOCKOUT_TTL });
    }
  } catch (e) { /* non-fatal */ }
}
async function loginClear(env, ip) {
  if (!env.CONFIG_KV) return;
  await kvDelete(env.CONFIG_KV, "blrl:login:" + ip);
}

// ── POST /account/create ──────────────────────────────────────────────────────
// Body: { username, password }
// Returns { success, user_id, username, session, recovery_key } — recovery_key is
// returned ONE TIME, in plaintext, here only. It is never stored or returned again.
async function handleAccountCreate(request, env) {
  try {
    if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const lower    = username.toLowerCase();

    if (username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
      return json({ error: "invalid_username" }, 400);
    }
    if (RESERVED_NAMES.has(lower)) return json({ error: "username_reserved" }, 400);
    if (password.length < 6)       return json({ error: "weak_password" }, 400);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await rateLimited(env, "blrl:create:" + ip, 10, 3600)) {
      return json({ error: "rate_limited" }, 429);
    }

    const existing = await env.CONFIG_KV.get("bluser:" + lower);
    if (existing) return json({ error: "username_taken" }, 409);

    const user_id = randHex(16);
    // Build session first so a missing AUTH_SECRET fails BEFORE any record is written.
    const session = await makeSession(user_id, env);
    if (!session) return json({ error: "server_misconfigured" }, 503);

    const pass = await hashSecret(password);
    const recovery_key = randRecoveryKey();
    const rec  = await hashSecret(recovery_key);

    const record = {
      user_id,
      username,
      pass,
      rec,
      avatarUrl: null,
      createdAt: Math.floor(Date.now() / 1000)
    };
    await kvPut(env.CONFIG_KV, "bluser:" + lower, JSON.stringify(record));
    await kvPut(env.CONFIG_KV, "bluserid:" + user_id, lower);

    return json({ success: true, user_id, username, session, recovery_key });
  } catch (e) {
    return json({ error: "server_error" }, 500);
  }
}

// ── POST /account/login ───────────────────────────────────────────────────────
// Body: { username, password }
// Returns { success, user_id, username, session, avatarUrl, uploads } on success.
// Fails with a generic { error: "invalid" } 401 that never reveals account existence.
async function handleAccountLogin(request, env) {
  try {
    if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const lower    = username.toLowerCase();
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    if (await loginLocked(env, ip)) {
      return json({ error: "Too many failed attempts — try again in 15 minutes." }, 429);
    }

    let record = null;
    if (lower) {
      const raw = await env.CONFIG_KV.get("bluser:" + lower);
      if (raw) { try { record = JSON.parse(raw); } catch { record = null; } }
    }

    // Always run PBKDF2 (real or dummy) to keep timing constant vs. missing accounts.
    const ok = await verifySecret(password, record ? record.pass : BL_DUMMY_PASS);
    if (!record || !ok || !password) {
      await loginFail(env, ip);
      return json({ error: "invalid" }, 401);
    }

    await loginClear(env, ip);
    const session = await makeSession(record.user_id, env);
    if (!session) return json({ error: "server_misconfigured" }, 503);

    let uploads = [];
    try {
      const u = await env.CONFIG_KV.get("blusertokens:" + record.user_id);
      if (u) uploads = JSON.parse(u);
      if (!Array.isArray(uploads)) uploads = [];
    } catch { uploads = []; }

    return json({
      success:   true,
      user_id:   record.user_id,
      username:  record.username,
      session,
      avatarUrl: record.avatarUrl || null,
      uploads
    });
  } catch (e) {
    return json({ error: "server_error" }, 500);
  }
}

// ── POST /account/reset ───────────────────────────────────────────────────────
// Body: { username, recovery_key, new_password }
// Verifies the recovery key (constant-time) and re-hashes the new password.
async function handleAccountReset(request, env) {
  try {
    if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const username     = String(body.username || "").trim();
    const recovery_key = String(body.recovery_key || "");
    const new_password = String(body.new_password || "");
    const lower        = username.toLowerCase();
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";

    if (await loginLocked(env, ip)) {
      return json({ error: "Too many failed attempts — try again in 15 minutes." }, 429);
    }
    if (new_password.length < 6) return json({ error: "weak_password" }, 400);

    let record = null;
    if (lower) {
      const raw = await env.CONFIG_KV.get("bluser:" + lower);
      if (raw) { try { record = JSON.parse(raw); } catch { record = null; } }
    }

    // Always run PBKDF2 (real or dummy) to keep timing constant.
    const ok = await verifySecret(recovery_key, record ? record.rec : BL_DUMMY_PASS);
    if (!record || !ok || !recovery_key) {
      await loginFail(env, ip);
      return json({ error: "invalid" }, 401);
    }

    record.pass = await hashSecret(new_password);
    await kvPut(env.CONFIG_KV, "bluser:" + lower, JSON.stringify(record));
    await loginClear(env, ip);

    const session = await makeSession(record.user_id, env);
    if (!session) return json({ error: "server_misconfigured" }, 503);
    return json({ success: true, session });
  } catch (e) {
    return json({ error: "server_error" }, 500);
  }
}

// ── POST /account/avatar ──────────────────────────────────────────────────────
// Body: { session, image (base64), content_type }. Stores the image in R2 keyed by
// the session's user_id (one object per user, overwritten on change) and records the
// served URL on the account. Max 512 KB, jpeg/png/webp only.
async function handleAccountAvatar(request, env) {
  try {
    if (!env.AVATARS)   return json({ error: "avatars_unavailable" }, 503);
    if (!env.CONFIG_KV) return json({ error: "KV not configured" }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const sess = await readSession(body.session, env);
    if (!sess || !sess.uid) return json({ error: "unauthorized" }, 401);
    const uid = sess.uid;

    const ct = String(body.content_type || "").toLowerCase();
    if (!(ct === "image/jpeg" || ct === "image/png" || ct === "image/webp")) {
      return json({ error: "bad_type" }, 400);
    }
    let bytes;
    try { bytes = b64ToBytes(String(body.image || "")); }
    catch { return json({ error: "bad_image" }, 400); }
    if (!bytes.length || bytes.length > 512 * 1024) return json({ error: "bad_size" }, 400);

    await env.AVATARS.put("avatars/" + uid, bytes, { httpMetadata: { contentType: ct } });

    const origin = new URL(request.url).origin;
    const avatarUrl = origin + "/account/avatar?uid=" + encodeURIComponent(uid);
    try {
      const lower = await env.CONFIG_KV.get("bluserid:" + uid);
      if (lower) {
        const raw = await env.CONFIG_KV.get("bluser:" + lower);
        if (raw) {
          const rec = JSON.parse(raw);
          rec.avatarUrl = avatarUrl;
          await kvPut(env.CONFIG_KV, "bluser:" + lower, JSON.stringify(rec));
        }
      }
    } catch (e) { /* non-fatal — the image is stored regardless */ }

    return json({ success: true, avatarUrl });
  } catch (e) {
    return json({ error: "server_error" }, 500);
  }
}

// ── GET /account/avatar?uid=<user_id> ─────────────────────────────────────────
// Serves the avatar image from the (private) R2 bucket via the worker.
async function handleGetAvatar(url, env) {
  try {
    if (!env.AVATARS) return json({ error: "avatars_unavailable" }, 503);
    const uid = url.searchParams.get("uid");
    if (!uid) return json({ error: "uid required" }, 400);
    const obj = await env.AVATARS.get("avatars/" + uid);
    if (!obj) return json({ error: "not_found" }, 404);
    const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg";
    return new Response(obj.body, {
      headers: { "Content-Type": ct, "Cache-Control": "public, max-age=300" }
    });
  } catch (e) {
    return json({ error: "server_error" }, 500);
  }
}

// ── GET /account/count ────────────────────────────────────────────────────────
// Public, read-only: the number of REGISTERED accounts, for the repo README badge.
// Counts `bluser:<username>` keys (one per account) and EXCLUDES throwaway test
// accounts (`bluser:zztest*`). No write path is touched. The `bluser:` prefix does
// not collide with `bluserid:` / `blusertokens:` / `blusercount` (none start with
// "bluser:"). Paginated so it stays correct past 1000 accounts.
async function handleAccountCount(env) {
  try {
    if (!env.CONFIG_KV) return json({ users: 0 });
    let users = 0, cursor;
    for (;;) {
      const r = await env.CONFIG_KV.list({ prefix: "bluser:", cursor, limit: 1000 });
      for (const k of r.keys) { if (!k.name.startsWith("bluser:zztest")) users++; }
      if (r.list_complete) break;
      cursor = r.cursor;
    }
    return json({ users });
  } catch (e) {
    return json({ users: 0 });
  }
}

