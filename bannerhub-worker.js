const GITHUB_BASE = 'https://the412banner.github.io/bannerhub-api'
const GAMEHUB_API = 'https://landscape-api.vgabc.com'
const SECRET_KEY = 'all-egg-shell-y7ZatUDk'

// ============================================================
// CHAT MODERATION & ROUTING
// Routes: POST /chat/send, POST /chat/report, GET /chat/rooms
// Required CF Worker secrets: SUPABASE_URL, SUPABASE_SERVICE_KEY
// Required CF KV bindings: TOKEN_STORE (already bound)
// KV keys used:
//   rl:{username}            — rate limit counter (TTL 60s)
//   last:{username}          — last message content (TTL 60s)
//   rep:{username}:{msgId}   — report dedup (TTL 7 days)
// ============================================================

const KNOWN_ROOMS = new Set(['general','english','spanish','portuguese','russian','chinese','japanese'])

// ── Profanity word lists (normalised lowercase) ───────────────────────────────
// English
const BAD_WORDS_EN = ['fuck','shit','cunt','nigger','nigga','faggot','fag','cock','pussy',
  'asshole','bitch','bastard','whore','slut','motherfucker','motherfucking','dick','prick',
  'wanker','twat','bollocks','arse','retard','spastic','kike','chink','spic','wetback',
  'cracker','honky','tranny','shemale','rape','raping','rapist','pedophile','paedophile',
  'nonce','clit','blowjob','handjob','rimjob','cumshot','creampie','jizz','cum','titties',
  'tits','boobs','dildo','vibrator','anal','anus','rectum','scrotum','testicle','penis',
  'vagina','vulva','labia','orgasm','masturbate','masturbation','ejaculate','ejaculation',
  'pornography','pornographic','xxx','nude','naked','nudity','erection','boner']
// Spanish
const BAD_WORDS_ES = ['puta','coño','mierda','joder','hostia','cabron','cabrón','pendejo',
  'chingada','chingar','verga','polla','culo','maricón','maricon','puto','zorra','follar',
  'coger','culero','pinche','mamada','chinga','carajo','hijoputa','gilipollas','capullo',
  'gilipolla','mamón','marica','travesti','pederasta','violacion','violación']
// Portuguese
const BAD_WORDS_PT = ['porra','caralho','fodase','foder','buceta','merda','cuzao','cuzão',
  'viado','bicha','puta','vadia','safado','safada','desgraçado','desgraçada','filho da puta',
  'filha da puta','otario','otário','corno','cu','pau','xoxota','piroca','babaca']
// Russian (romanised)
const BAD_WORDS_RU = ['blyad','blyadt','pizda','pizdets','khuy','khui','ebal','ebat','nahuy',
  'poshel','pidoras','pidor','govno','suka','zalupa','mudak','mudila','yebat','yebany',
  'ублюдок','блядь','пизда','хуй','ебать','гавно','сука','мудак','пидор','педик']
// Chinese (pinyin + chars)
const BAD_WORDS_ZH = ['cao','shabi','tama','tamade','wocao','niubi','niuma','ta ma de',
  '操','傻逼','他妈的','我操','牛逼','日你','滚','狗日','妈逼','干你','草泥马']
// Japanese (romaji + kana)
const BAD_WORDS_JA = ['kichiku','kisama','kiero','shine','aho','baka','chikushō','chinpira',
  'chinpo','manko','unko','kusoyaro','kutabare','omanko','yariman','売春','強姦','レイプ']

const ALL_BAD_WORDS = [
  ...BAD_WORDS_EN, ...BAD_WORDS_ES, ...BAD_WORDS_PT,
  ...BAD_WORDS_RU, ...BAD_WORDS_ZH, ...BAD_WORDS_JA
]

// ── Explicit/sexual content keywords ─────────────────────────────────────────
const EXPLICIT_WORDS = ['porn','porno','pornhub','xvideos','xnxx','onlyfans','camgirl',
  'sexting','nude pic','nude photo','send nudes','naked pic','sex video','sex tape',
  'child porn','cp ','lolicon','shota','hentai','incest','bestiality','zoophilia',
  'snuff','gore','自慰','性交','강간','포르노']

// ── Leet-speak normalisation ──────────────────────────────────────────────────
function normaliseLeet(text) {
  return text
    .toLowerCase()
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, '') // strip zero-width chars
    .replace(/@/g, 'a')
    .replace(/3/g, 'e')
    .replace(/1/g, 'i')
    .replace(/0/g, 'o')
    .replace(/\$/g, 's')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/4/g, 'a')
    .replace(/ph/g, 'f')
    .replace(/\*/g, '')
    .replace(/\./g, '')
    .replace(/_/g, '')
    .replace(/-/g, '')
}

// ── Filter check ──────────────────────────────────────────────────────────────
function containsBadWord(text) {
  const norm = normaliseLeet(text)
  for (const word of ALL_BAD_WORDS) {
    if (norm.includes(normaliseLeet(word))) return true
  }
  return false
}

function containsExplicit(text) {
  const lower = text.toLowerCase()
  for (const word of EXPLICIT_WORDS) {
    if (lower.includes(word)) return true
  }
  return false
}

function containsSpam(text) {
  // Repeated single char 7+ times
  if (/(.)\1{6,}/.test(text)) return true
  // URL/invite links
  if (/(https?:\/\/|discord\.gg|t\.me|bit\.ly|tinyurl|invite\.gg)/i.test(text)) return true
  // All caps > 10 chars (>80% uppercase)
  const letters = text.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 10) {
    const upperCount = (text.match(/[A-Z]/g) || []).length
    if (upperCount / letters.length > 0.8) return true
  }
  return false
}

// ── Supabase helper ───────────────────────────────────────────────────────────
async function supabaseQuery(env, method, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } }
  catch (e) { return { ok: res.ok, status: res.status, data: text } }
}

// ── POST /chat/send ───────────────────────────────────────────────────────────
async function handleChatSend(request, env, corsHeaders) {
  const time = Math.floor(Date.now() / 1000).toString()
  let body
  try { body = await request.json() } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_json', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  const { room, username, content } = body

  // 1. Validate fields
  if (!KNOWN_ROOMS.has(room)) {
    return new Response(JSON.stringify({ error: 'invalid_room', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }
  if (!username || !/^[a-zA-Z0-9_]{2,24}$/.test(username)) {
    return new Response(JSON.stringify({ error: 'invalid_username', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }
  if (!content || content.trim().length === 0 || content.length > 500) {
    return new Response(JSON.stringify({ error: 'invalid_content', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  // 2. Rate limit — max 3 messages per 60 seconds
  const rlKey = `rl:${username}`
  const rlRaw = await env.TOKEN_STORE.get(rlKey)
  const rlCount = rlRaw ? parseInt(rlRaw, 10) : 0
  if (rlCount >= 3) {
    return new Response(JSON.stringify({ error: 'rate_limit', time }),
      { status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }
  await env.TOKEN_STORE.put(rlKey, String(rlCount + 1), { expirationTtl: 60 })

  // 3. Duplicate message check
  const lastKey = `last:${username}`
  const lastMsg = await env.TOKEN_STORE.get(lastKey)
  if (lastMsg === content.trim()) {
    return new Response(JSON.stringify({ error: 'duplicate_message', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  // 4. Spam check
  if (containsSpam(content)) {
    return new Response(JSON.stringify({ error: 'filtered', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  // 5. Profanity check
  if (containsBadWord(content)) {
    return new Response(JSON.stringify({ error: 'filtered', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  // 6. Explicit content check
  if (containsExplicit(content)) {
    return new Response(JSON.stringify({ error: 'filtered', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  // 7. Insert into Supabase
  const result = await supabaseQuery(env, 'POST', '/messages', {
    room, username, content: content.trim()
  })
  if (!result.ok) {
    return new Response(JSON.stringify({ error: 'db_error', time }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  // 8. Store last message for duplicate check
  await env.TOKEN_STORE.put(lastKey, content.trim(), { expirationTtl: 60 })

  return new Response(JSON.stringify({ ok: true, time }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

// ── POST /chat/report ─────────────────────────────────────────────────────────
async function handleChatReport(request, env, corsHeaders) {
  const time = Math.floor(Date.now() / 1000).toString()
  let body
  try { body = await request.json() } catch (e) {
    return new Response(JSON.stringify({ error: 'invalid_json', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  const { message_id, reporter_username } = body

  if (!message_id || !reporter_username) {
    return new Response(JSON.stringify({ error: 'missing_fields', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }
  if (!/^[a-zA-Z0-9_]{2,24}$/.test(reporter_username)) {
    return new Response(JSON.stringify({ error: 'invalid_username', time }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  // 1. Check for duplicate report via KV
  const repKey = `rep:${reporter_username}:${message_id}`
  const alreadyReported = await env.TOKEN_STORE.get(repKey)
  if (alreadyReported) {
    return new Response(JSON.stringify({ error: 'already_reported', time }),
      { status: 409, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  // 2. Insert report row
  const insertResult = await supabaseQuery(env, 'POST', '/reports', {
    message_id, reporter_username
  })
  // 23505 = unique violation (already reported in DB)
  if (!insertResult.ok) {
    return new Response(JSON.stringify({ error: 'already_reported', time }),
      { status: 409, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }

  // 3. Store dedup key in KV (7 days)
  await env.TOKEN_STORE.put(repKey, '1', { expirationTtl: 604800 })

  // 4. Count total reports for this message
  const countResult = await supabaseQuery(env, 'GET',
    `/reports?message_id=eq.${encodeURIComponent(message_id)}&select=id`, null)
  const reportCount = Array.isArray(countResult.data) ? countResult.data.length : 0

  // 5. Auto-hide at 3+ reports
  if (reportCount >= 3) {
    await supabaseQuery(env, 'PATCH',
      `/messages?id=eq.${encodeURIComponent(message_id)}`,
      { hidden: true })
  }

  return new Response(JSON.stringify({ ok: true, time }),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

// ── GET /chat/rooms ───────────────────────────────────────────────────────────
async function handleChatRooms(env, corsHeaders) {
  const result = await supabaseQuery(env, 'GET',
    '/rooms?select=id,name,flag_emoji,sort_order&order=sort_order.asc', null)
  if (!result.ok) {
    return new Response(JSON.stringify({ error: 'db_error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
  }
  return new Response(JSON.stringify(result.data),
    { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

// ============================================================
// STEAM LIBRARY AUGMENTATION
// Purpose: GameHub's backend only returns ~65 games it has
// metadata for. This augments the library sync response with
// the user's full Steam library via the public Steam community
// XML endpoint — no API key required.
//
// Required CF Worker bindings:
//   TOKEN_STORE    — KV namespace (already used for GameHub token)
//
// KV keys used:
//   bannerhub_token          — existing: real GameHub token
//   steam_user_steamid       — SteamID64 string for the user
//                              (set automatically via smali patch after Steam login)
//
// Detection: library sync call has page_size=1000 in POST body.
// ============================================================

// Fetch full Steam owned games list using the public community XML endpoint.
// Works for any public Steam profile — no API key needed.
// Returns [{appid, name}] or null on failure.
async function fetchSteamOwnedGames(steamId) {
  const url = `https://steamcommunity.com/${steamId}/games/?tab=all&xml=1`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'BannerHub/1.0' } })
    if (!res.ok) return null
    const xml = await res.text()
    // Parse <game> entries from XML: <appID>...</appID> <name>...</name>
    const games = []
    const gameRegex = /<game>([\s\S]*?)<\/game>/g
    let match
    while ((match = gameRegex.exec(xml)) !== null) {
      const block = match[1]
      const appIdMatch = block.match(/<appID>(\d+)<\/appID>/)
      const nameMatch = block.match(/<name><!\[CDATA\[(.+?)\]\]><\/name>/) || block.match(/<name>(.+?)<\/name>/)
      if (appIdMatch) {
        games.push({
          appid: parseInt(appIdMatch[1], 10),
          name: nameMatch ? nameMatch[1] : `App ${appIdMatch[1]}`,
        })
      }
    }
    return games.length ? games : null
  } catch (e) {
    return null
  }
}

// Build a CardItemData-compatible game object for injection
// Uses Steam CDN for images. jump_type/source match Steam games in GameHub.
function buildSteamCard(appid, name) {
  const cdn = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`
  return {
    id: String(appid),
    game_name: name || `Steam App ${appid}`,
    game_cover_image: `${cdn}/header.jpg`,
    content_img: `${cdn}/header.jpg`,
    square_image: `${cdn}/library_600x900.jpg`,
    game_back_image: `${cdn}/library_hero.jpg`,
    source: 'steam',
    jump_type: '',
    card_param: '',
    is_display_title: true,
    is_display_price: false,
    is_display_btn: false,
    is_pay: false,
    is_play_video: false,
  }
}

// Augment a GameHub library sync response with missing Steam games
async function augmentSteamLibrary(gamehubBody, env) {
  try {
    // Parse GameHub response
    let respData
    try { respData = JSON.parse(gamehubBody) } catch (e) { return gamehubBody }
    if (!respData?.data) return gamehubBody

    // Get card_list — may be a JSON string or a real array
    let cardList = respData.data.card_list
    if (typeof cardList === 'string') {
      try { cardList = JSON.parse(cardList) } catch (e) { return gamehubBody }
    }
    if (!Array.isArray(cardList)) return gamehubBody

    // Collect appids already in the GameHub list
    const knownIds = new Set(cardList.map(c => String(c.id || c.steam_appid || '')).filter(Boolean))

    // Get stored SteamID64 (set by app smali patch after Steam login)
    const steamId = await env.TOKEN_STORE.get('steam_user_steamid')
    if (!steamId) return gamehubBody

    // Fetch full Steam library — no API key needed
    const steamGames = await fetchSteamOwnedGames(steamId)
    if (!steamGames || !steamGames.length) return gamehubBody

    // Identify missing games (in Steam but not in GameHub's list)
    const missing = steamGames.filter(g => !knownIds.has(String(g.appid)))
    if (!missing.length) return gamehubBody

    // Build card objects for missing games
    const injected = missing.map(g => buildSteamCard(g.appid, g.name))

    // Merge into response
    const merged = [...cardList, ...injected]
    if (typeof respData.data.card_list === 'string') {
      respData.data.card_list = JSON.stringify(merged)
    } else {
      respData.data.card_list = merged
    }
    if (respData.data.total !== undefined) {
      respData.data.total = merged.length
    }

    return JSON.stringify(respData)
  } catch (e) {
    return gamehubBody
  }
}

// Minimal MD5 implementation for Cloudflare Workers
function md5(str) {
  function safeAdd(x, y) { const lsw=(x&0xffff)+(y&0xffff); return (((x>>16)+(y>>16)+(lsw>>16))<<16)|(lsw&0xffff) }
  function bitRotateLeft(num,cnt) { return (num<<cnt)|(num>>>(32-cnt)) }
  function md5cmn(q,a,b,x,s,t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b) }
  function md5ff(a,b,c,d,x,s,t) { return md5cmn((b&c)|((~b)&d),a,b,x,s,t) }
  function md5gg(a,b,c,d,x,s,t) { return md5cmn((b&d)|(c&(~d)),a,b,x,s,t) }
  function md5hh(a,b,c,d,x,s,t) { return md5cmn(b^c^d,a,b,x,s,t) }
  function md5ii(a,b,c,d,x,s,t) { return md5cmn(c^(b|(~d)),a,b,x,s,t) }
  function uTF8Encode(s) {
    let r='', i=0
    while(i<s.length){const c=s.charCodeAt(i++);if(c<128)r+=String.fromCharCode(c);else if(c<2048)r+=String.fromCharCode(192|(c>>6),128|(c&63));else r+=String.fromCharCode(224|(c>>12),128|((c>>6)&63),128|(c&63))}
    return r
  }
  str = uTF8Encode(str)
  const x=[], l=str.length
  for(let i=0;i<l;i+=4){x[i>>2]=(str.charCodeAt(i))|(str.charCodeAt(i+1)<<8)|(str.charCodeAt(i+2)<<16)|(str.charCodeAt(i+3)<<24)}
  x[l>>2]|=0x80<<((l%4)*8)
  x[(((l+8)>>6)<<4)+14]=l*8
  let [a,b,c,d]=[1732584193,-271733879,-1732584194,271733878]
  for(let i=0;i<x.length;i+=16){
    const [oa,ob,oc,od]=[a,b,c,d]
    a=md5ff(a,b,c,d,x[i],7,-680876936);d=md5ff(d,a,b,c,x[i+1],12,-389564586);c=md5ff(c,d,a,b,x[i+2],17,606105819);b=md5ff(b,c,d,a,x[i+3],22,-1044525330)
    a=md5ff(a,b,c,d,x[i+4],7,-176418897);d=md5ff(d,a,b,c,x[i+5],12,1200080426);c=md5ff(c,d,a,b,x[i+6],17,-1473231341);b=md5ff(b,c,d,a,x[i+7],22,-45705983)
    a=md5ff(a,b,c,d,x[i+8],7,1770035416);d=md5ff(d,a,b,c,x[i+9],12,-1958414417);c=md5ff(c,d,a,b,x[i+10],17,-42063);b=md5ff(b,c,d,a,x[i+11],22,-1990404162)
    a=md5ff(a,b,c,d,x[i+12],7,1804603682);d=md5ff(d,a,b,c,x[i+13],12,-40341101);c=md5ff(c,d,a,b,x[i+14],17,-1502002290);b=md5ff(b,c,d,a,x[i+15],22,1236535329)
    a=md5gg(a,b,c,d,x[i+1],5,-165796510);d=md5gg(d,a,b,c,x[i+6],9,-1069501632);c=md5gg(c,d,a,b,x[i+11],14,643717713);b=md5gg(b,c,d,a,x[i],20,-373897302)
    a=md5gg(a,b,c,d,x[i+5],5,-701558691);d=md5gg(d,a,b,c,x[i+10],9,38016083);c=md5gg(c,d,a,b,x[i+15],14,-660478335);b=md5gg(b,c,d,a,x[i+4],20,-405537848)
    a=md5gg(a,b,c,d,x[i+9],5,568446438);d=md5gg(d,a,b,c,x[i+14],9,-1019803690);c=md5gg(c,d,a,b,x[i+3],14,-187363961);b=md5gg(b,c,d,a,x[i+8],20,1163531501)
    a=md5gg(a,b,c,d,x[i+13],5,-1444681467);d=md5gg(d,a,b,c,x[i+2],9,-51403784);c=md5gg(c,d,a,b,x[i+7],14,1735328473);b=md5gg(b,c,d,a,x[i+12],20,-1926607734)
    a=md5hh(a,b,c,d,x[i+5],4,-378558);d=md5hh(d,a,b,c,x[i+8],11,-2022574463);c=md5hh(c,d,a,b,x[i+11],16,1839030562);b=md5hh(b,c,d,a,x[i+14],23,-35309556)
    a=md5hh(a,b,c,d,x[i+1],4,-1530992060);d=md5hh(d,a,b,c,x[i+4],11,1272893353);c=md5hh(c,d,a,b,x[i+7],16,-155497632);b=md5hh(b,c,d,a,x[i+10],23,-1094730640)
    a=md5hh(a,b,c,d,x[i+13],4,681279174);d=md5hh(d,a,b,c,x[i],11,-358537222);c=md5hh(c,d,a,b,x[i+3],16,-722521979);b=md5hh(b,c,d,a,x[i+6],23,76029189)
    a=md5hh(a,b,c,d,x[i+9],4,-640364487);d=md5hh(d,a,b,c,x[i+12],11,-421815835);c=md5hh(c,d,a,b,x[i+15],16,530742520);b=md5hh(b,c,d,a,x[i+2],23,-995338651)
    a=md5ii(a,b,c,d,x[i],6,-198630844);d=md5ii(d,a,b,c,x[i+7],10,1126891415);c=md5ii(c,d,a,b,x[i+14],15,-1416354905);b=md5ii(b,c,d,a,x[i+5],21,-57434055)
    a=md5ii(a,b,c,d,x[i+12],6,1700485571);d=md5ii(d,a,b,c,x[i+3],10,-1894986606);c=md5ii(c,d,a,b,x[i+10],15,-1051523);b=md5ii(b,c,d,a,x[i+1],21,-2054922799)
    a=md5ii(a,b,c,d,x[i+8],6,1873313359);d=md5ii(d,a,b,c,x[i+15],10,-30611744);c=md5ii(c,d,a,b,x[i+6],15,-1560198380);b=md5ii(b,c,d,a,x[i+13],21,1309151649)
    a=md5ii(a,b,c,d,x[i+4],6,-145523070);d=md5ii(d,a,b,c,x[i+11],10,-1120210379);c=md5ii(c,d,a,b,x[i+2],15,718787259);b=md5ii(b,c,d,a,x[i+9],21,-343485551)
    a=safeAdd(a,oa);b=safeAdd(b,ob);c=safeAdd(c,oc);d=safeAdd(d,od)
  }
  return [a,b,c,d].map(n=>('00000000'+(n<0?n+4294967296:n).toString(16)).slice(-8).replace(/(..)(..)(..)(..)$/,(_,a,b,c,d)=>d+c+b+a)).join('')
}

function generateSignature(params) {
  const sorted = Object.keys(params).sort()
  const str = sorted.map(k => `${k}=${params[k]}`).join('&') + '&' + SECRET_KEY
  return md5(str)
}

// Routes that stay on GitHub Pages (all bannerhub-api static endpoints)
const GITHUB_ROUTES = new Set([
  '/base/getBaseInfo',
  '/card/getCtsList',
  '/card/getGameIcon',
  '/card/getNewsList',
  '/card/getTopPlatform',
  '/cloud/game/check_user_timer',
  '/components/box64_manifest',
  '/components/downloads',
  '/components/drivers_manifest',
  '/components/dxvk_manifest',
  '/components/games_manifest',
  '/components/index',
  '/components/libraries_manifest',
  '/components/steam_manifest',
  '/components/vkd3d_manifest',
  '/devices/getDevicesList',
  '/email/login',
  '/ems/send',
  '/game/checkLocalHandTourGame',
  '/game/cts/report',
  '/game/getDnsIpPool',
  '/game/getGameCircleList',
  '/game/getSteamHost/index',
  '/game/userVideoNum',
  '/heartbeat/game/getUserPlayTimeList',
  '/heartbeat/game/start',
  '/simulator/getTabList',
  '/simulator/v2/getAllComponentList',
  '/simulator/v2/getComponentList',
  '/simulator/v2/getContainerList',
  '/simulator/v2/getDefaultComponent',
  '/simulator/v2/getImagefsDetail',
  '/upgrade/getAppUpgradeApk',
  '/user/info',
  '/vtouch/startType_steam',
])

// ── In-game voice: hosted WebRTC room ───────────────────────────────────────
// Replaces the old WebView approach where the call page was loaded via
// loadDataWithBaseURL — that gave the page an *opaque* origin and Chromium
// blocks getUserMedia on opaque origins, so the mic never opened. Serving the
// SAME page from this real https origin fixes that. SDP/ICE are relayed through
// an R2-backed mailbox (CHAT_IMAGES bucket, `voice/` prefix) instead of Steam
// chat — R2 is strongly consistent (KV's 60s negative-cache would stall the
// handshake). Audio then flows peer-to-peer (TURN-assisted across NATs). Room =
// sorted SteamID pair. Each signal is one tiny object the recipient drains and
// deletes on its next poll; the bucket lifecycle sweeps anything orphaned.
const VOICE_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/

function jsonRes(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj),
    { status, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
}

// POST /voice/signal {room,to,from,payload} → drop one SDP/ICE blob in to's mailbox
async function handleVoiceSignal(request, env, corsHeaders) {
  let b
  try { b = await request.json() } catch (e) { return jsonRes({ error: 'invalid_json' }, 400, corsHeaders) }
  const { room, to, from, payload } = b || {}
  if (!VOICE_ID_RE.test(room || '') || !VOICE_ID_RE.test(to || '') || !VOICE_ID_RE.test(from || '')) {
    return jsonRes({ error: 'invalid_id' }, 400, corsHeaders)
  }
  if (typeof payload !== 'string' || payload.length === 0 || payload.length > 16000) {
    return jsonRes({ error: 'invalid_payload' }, 400, corsHeaders)
  }
  // Time-prefixed key → recipient's prefix lists in chronological order. Store
  // {from,payload} so the recipient knows which peer a signal came from — the
  // mesh room has many peers and routes each signal to the right connection by
  // sender. (1:1 rings ignore `from` and just read `payload`.)
  const key = `voice/${room}/${to}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`
  await env.CHAT_IMAGES.put(key, JSON.stringify({ from, payload }),
    { httpMetadata: { contentType: 'application/json' } })
  return jsonRes({ ok: true }, 200, corsHeaders)
}

// GET /voice/poll?room=&self= → drain (read + delete) self's mailbox.
// Returns [{from,payload}] (payload = the original signal string).
async function handleVoicePoll(url, env, corsHeaders) {
  const room = url.searchParams.get('room') || ''
  const self = url.searchParams.get('self') || ''
  if (!VOICE_ID_RE.test(room) || !VOICE_ID_RE.test(self)) return jsonRes({ error: 'invalid_id' }, 400, corsHeaders)
  const prefix = `voice/${room}/${self}/`
  const listed = await env.CHAT_IMAGES.list({ prefix, limit: 100 })
  const keys = listed.objects.map(o => o.key).sort()  // chronological (time-prefixed)
  const signals = []
  for (const k of keys) {
    const obj = await env.CHAT_IMAGES.get(k)
    if (obj) {
      const text = await obj.text()
      let from = '', payload = text
      try { const w = JSON.parse(text); if (w && typeof w.payload === 'string') { from = w.from || ''; payload = w.payload } } catch (e) {}
      signals.push({ from, payload })
    }
    await env.CHAT_IMAGES.delete(k)
  }
  return jsonRes({ ok: true, signals }, 200, corsHeaders)
}

// /voice/roster — group-call membership. POST {room,self} heartbeats presence
// (re-stamps an R2 object's upload time); GET ?room= lists members seen in the
// last 15s. Each member's mesh page heartbeats every ~5s; stale entries (left /
// crashed) simply age out of the list.
async function handleVoiceRoster(request, url, env, corsHeaders) {
  if (request.method === 'POST') {
    let b
    try { b = await request.json() } catch (e) { return jsonRes({ error: 'invalid_json' }, 400, corsHeaders) }
    const { room, self } = b || {}
    if (!VOICE_ID_RE.test(room || '') || !VOICE_ID_RE.test(self || '')) return jsonRes({ error: 'invalid_id' }, 400, corsHeaders)
    await env.CHAT_IMAGES.put(`voice/${room}/_members/${self}`, String(Date.now()),
      { httpMetadata: { contentType: 'text/plain' } })
    return jsonRes({ ok: true }, 200, corsHeaders)
  }
  const room = url.searchParams.get('room') || ''
  if (!VOICE_ID_RE.test(room)) return jsonRes({ error: 'invalid_id' }, 400, corsHeaders)
  const listed = await env.CHAT_IMAGES.list({ prefix: `voice/${room}/_members/`, limit: 50 })
  const now = Date.now()
  const members = []
  for (const o of listed.objects) {
    if (o.uploaded && (now - o.uploaded.getTime()) > 15000) continue
    const id = o.key.split('/').pop()
    if (id) members.push(id)
  }
  return jsonRes({ ok: true, members }, 200, corsHeaders)
}

// /voice/log — multi-party WebRTC diagnostics. POST {room,self,msg} appends a
// tiny timestamped line; GET ?room= returns the merged recent timeline so every
// participant's events (offer/answer/ICE/roster) are visible server-side without
// each device's logcat. Entries are tiny and age out with the bucket lifecycle.
async function handleVoiceLog(request, url, env, corsHeaders) {
  if (request.method === 'POST') {
    let b
    try { b = await request.json() } catch (e) { return jsonRes({ error: 'invalid_json' }, 400, corsHeaders) }
    const { room, self, msg } = b || {}
    if (!VOICE_ID_RE.test(room || '') || !VOICE_ID_RE.test(self || '')) return jsonRes({ error: 'invalid_id' }, 400, corsHeaders)
    const m = (typeof msg === 'string' ? msg : '').slice(0, 400)
    const key = `vlog/${Date.now()}-${crypto.randomUUID().slice(0, 6)}.json`
    await env.CHAT_IMAGES.put(key, JSON.stringify({ t: Date.now(), room, self, msg: m }),
      { httpMetadata: { contentType: 'application/json' } })
    return jsonRes({ ok: true }, 200, corsHeaders)
  }
  const room = url.searchParams.get('room') || ''
  const listed = await env.CHAT_IMAGES.list({ prefix: 'vlog/', limit: 1000 })
  const keys = listed.objects.map(o => o.key).sort().slice(-250)  // most recent ~250
  const entries = []
  for (const k of keys) {
    const obj = await env.CHAT_IMAGES.get(k)
    if (!obj) continue
    try { const e = JSON.parse(await obj.text()); if (!room || e.room === room) entries.push(e) } catch (e) {}
  }
  return jsonRes({ ok: true, count: entries.length, entries }, 200, corsHeaders)
}

// GET /voice/turn → ICE servers. Public STUN always; plus Cloudflare Realtime
// TURN with SHORT-LIVED credentials minted per request (TTL'd, so nothing static
// is ever exposed). Falls back to STUN-only if TURN isn't configured. (Replaced
// the dead free openrelay TURN whose static creds metered deprecated, which left
// strict-NAT pairs stuck at ICE "checking" → failed.)
async function handleVoiceTurn(env, corsHeaders) {
  const iceServers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ]
  if (env.TURN_KEY_ID && env.TURN_API_TOKEN) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      })
      if (r.ok) {
        const j = await r.json()
        const cf = j && j.iceServers ? (Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers]) : []
        for (const s of cf) iceServers.push(s)
      }
    } catch (e) {}
  }
  return jsonRes({ iceServers }, 200, corsHeaders)
}

// GET /voice/room — the call page. Reads room/self from its OWN query string,
// so no server-side templating. MESH group call: it discovers everyone in the
// room via /voice/roster and opens one RTCPeerConnection per other member
// (offerer per pair = the lexicographically-smaller id, so no glare). Signals
// are routed to the right connection by sender (`from`). Works standalone in a
// browser (open the URL on N devices with the same room + distinct self) and
// inside the app's WebView, where the optional window.BhVoice bridge surfaces
// call state + the live participant roster to the overlay.
const VOICE_PAGE_HTML =
  '<!doctype html><html><head><meta charset=utf-8>' +
  '<meta name=viewport content="width=device-width,initial-scale=1"><title>BannerHub Voice</title>' +
  '<style>body{margin:0;background:#10141c;color:#cfe;font:14px sans-serif;display:flex;' +
  'align-items:center;justify-content:center;height:100vh}#s{opacity:.85}</style></head>' +
  '<body><div id=s>starting…</div><script>\n' +
  '(function(){\n' +
  'var q=new URLSearchParams(location.search);\n' +
  'var ROOM=q.get("room")||"",SELF=q.get("self")||"",PEER=q.get("peer")||"";\n' +
  'var API=location.origin;\n' +
  'var pcs={},localStream=null,dead=false,connected=false,ice=null,lastRoster="",sEl=document.getElementById("s");\n' +
  'function jlog(m){try{if(window.BhVoice&&BhVoice.log)BhVoice.log(""+m);}catch(e){}}\n' +
  'function dlog(m){jlog(m);try{fetch(API+"/voice/log",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({room:ROOM,self:SELF,msg:""+m})}).catch(function(){});}catch(e){}}\n' +
  'function status(s,d){sEl.textContent=s+(d?(" — "+d):"");try{if(window.BhVoice&&BhVoice.state)BhVoice.state(s,d||"");}catch(e){}}\n' +
  'function reportRoster(){try{if(window.BhVoice&&BhVoice.roster){var ids=[SELF];for(var k in pcs){if(pcs[k].connected)ids.push(k);}BhVoice.roster(ids.join(","));}}catch(e){}}\n' +
  'function getIce(){return fetch(API+"/voice/turn").then(function(r){return r.json();}).then(function(j){return j.iceServers;}).catch(function(){return [{urls:["stun:stun.l.google.com:19302"]}];});}\n' +
  'function sendTo(to,o){return fetch(API+"/voice/signal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({room:ROOM,to:to,from:SELF,payload:JSON.stringify(o)})}).catch(function(){});}\n' +
  'function audioFor(id){var aid="a_"+id,a=document.getElementById(aid);if(!a){a=document.createElement("audio");a.id=aid;a.autoplay=true;document.body.appendChild(a);}return a;}\n' +
  'function ensurePc(id){\n' +
  ' if(dead||!id||id===SELF||pcs[id])return pcs[id];\n' +
  ' var pc=new RTCPeerConnection({iceServers:ice});var ent={pc:pc,pending:[],connected:false};pcs[id]=ent;\n' +
  ' dlog("ensurePc "+id+" offerer="+(SELF<id));\n' +
  ' if(localStream)localStream.getTracks().forEach(function(t){pc.addTrack(t,localStream);});\n' +
  ' pc.onicecandidate=function(e){if(e.candidate)sendTo(id,{t:"ice",c:e.candidate});};\n' +
  ' pc.ontrack=function(e){var a=audioFor(id);if(a.srcObject!==e.streams[0])a.srcObject=e.streams[0];};\n' +
  ' pc.oniceconnectionstatechange=function(){dlog("ice["+id+"] "+pc.iceConnectionState);};\n' +
  ' pc.onconnectionstatechange=function(){var st=pc.connectionState;dlog("pc["+id+"] "+st);\n' +
  '  if(st==="connected"){ent.connected=true;connected=true;status("in-call");reportRoster();}\n' +
  '  else if(st==="failed"||st==="closed"){dropPeer(id);}};\n' +
  // Poke the peer so they create their side of the connection immediately, even
  // if their own roster poll hasn\'t discovered us yet — a single discovery (by
  // either side, via roster or the fast-path) now bootstraps both. The lower id
  // still makes the offer; ensurePc dedups so the hello can\'t loop.
  ' sendTo(id,{t:"hello"});\n' +
  ' if(SELF<id){pc.createOffer().then(function(off){return pc.setLocalDescription(off).then(function(){dlog("->offer "+id);sendTo(id,{t:"offer",sdp:off.sdp});});}).catch(function(e){dlog("offer-err "+id+" "+e);});}\n' +
  ' return ent;\n' +
  '}\n' +
  'function dropPeer(id){var ent=pcs[id];if(!ent)return;dlog("drop "+id);try{ent.pc.close();}catch(e){}delete pcs[id];var a=document.getElementById("a_"+id);if(a){try{a.srcObject=null;a.remove();}catch(e){}}reportRoster();\n' +
  ' if(!Object.keys(pcs).length){status("ended","call ended");cleanup();}}\n' +
  'function flush(ent){while(ent.pending.length){ent.pc.addIceCandidate(ent.pending.shift()).catch(function(e){jlog("icef "+e);});}}\n' +
  'function handleFrom(from,m){\n' +
  ' if(!from||from===SELF)return;\n' +
  ' if(m.t==="bye"){dropPeer(from);return;}\n' +
  ' var ent=ensurePc(from);if(!ent)return;var pc=ent.pc;\n' +
  ' try{\n' +
  '  if(m.t==="offer"){dlog("<-offer "+from+" state="+pc.signalingState);pc.setRemoteDescription({type:"offer",sdp:m.sdp}).then(function(){return pc.createAnswer();}).then(function(an){return pc.setLocalDescription(an).then(function(){dlog("->answer "+from);sendTo(from,{t:"answer",sdp:an.sdp});});}).then(function(){flush(ent);}).catch(function(e){dlog("ans-err "+from+" "+e);});}\n' +
  '  else if(m.t==="answer"){dlog("<-answer "+from+" state="+pc.signalingState);pc.setRemoteDescription({type:"answer",sdp:m.sdp}).then(function(){flush(ent);}).catch(function(e){dlog("setans-err "+from+" "+e);});}\n' +
  '  else if(m.t==="ice"){if(pc.remoteDescription&&pc.remoteDescription.type){pc.addIceCandidate(m.c).catch(function(e){jlog("ice "+e);});}else{ent.pending.push(m.c);}}\n' +
  ' }catch(e){jlog("handle "+e);}}\n' +
  'function poll(){if(dead)return;\n' +
  ' fetch(API+"/voice/poll?room="+encodeURIComponent(ROOM)+"&self="+encodeURIComponent(SELF)).then(function(r){return r.json();}).then(function(j){\n' +
  '  if(j&&j.signals){for(var i=0;i<j.signals.length;i++){var s=j.signals[i],m;try{m=JSON.parse(s.payload);}catch(e){continue;}handleFrom(s.from,m);}}\n' +
  ' }).catch(function(){}).then(function(){if(!dead)setTimeout(poll,1200);});}\n' +
  'function heartbeat(){if(dead)return;fetch(API+"/voice/roster",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({room:ROOM,self:SELF})}).catch(function(){}).then(function(){if(!dead)setTimeout(heartbeat,5000);});}\n' +
  'function rosterPoll(){if(dead)return;fetch(API+"/voice/roster?room="+encodeURIComponent(ROOM)).then(function(r){return r.json();}).then(function(j){if(j&&j.members){var rs=j.members.join(",");if(rs!==lastRoster){lastRoster=rs;dlog("roster ["+rs+"]");}for(var i=0;i<j.members.length;i++){var id=j.members[i];if(id&&id!==SELF)ensurePc(id);}}}).catch(function(){}).then(function(){if(!dead)setTimeout(rosterPoll,2500);});}\n' +
  'function cleanup(){if(dead)return;dead=true;for(var k in pcs){try{pcs[k].pc.close();}catch(e){}}pcs={};try{if(localStream)localStream.getTracks().forEach(function(t){t.stop();});}catch(e){}}\n' +
  'window.bhHangup=function(){try{for(var k in pcs)sendTo(k,{t:"bye"});}catch(e){}status("ended","");cleanup();};\n' +
  'window.bhSetMuted=function(m){if(localStream)localStream.getAudioTracks().forEach(function(t){t.enabled=!m;});};\n' +
  'function init(){dlog("init self="+SELF+" room="+ROOM+" peer="+PEER);status("connecting");\n' +
  ' var tmo=new Promise(function(_,r){setTimeout(function(){r(new Error("timeout"));},10000);});\n' +
  ' Promise.race([navigator.mediaDevices.getUserMedia({audio:true,video:false}),tmo]).then(function(s){localStream=s;return getIce();}).then(function(srv){ice=srv;poll();heartbeat();rosterPoll();if(PEER)ensurePc(PEER);}).catch(function(e){status("failed","mic "+e);});\n' +
  '}\n' +
  'init();\n' +
  '})();\n' +
  '</scr'+'ipt></body></html>'

function handleVoiceRoom(corsHeaders) {
  const h = new Headers(corsHeaders)
  h.set('Content-Type', 'text/html; charset=utf-8')
  h.set('cache-control', 'no-store')
  return new Response(VOICE_PAGE_HTML, { headers: h })
}

export default {
  async scheduled(event, env, ctx) {
    // Keep-alive ping — fires every 5 minutes via cron trigger
    // Prevents Supabase free tier from pausing due to inactivity
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/rooms?select=id&limit=1`, {
        headers: {
          'apikey': env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        }
      })
    } catch (e) {}
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // 6.0 client gate: patched 6.0 APK prefixes every relative path with "v6/"
    // (smali patch on zdb.b in bannerhub-revanced). Strip the prefix here so
    // existing handlers don't need to know about it; record `is60` for the
    // few endpoints that need a 6.0-only response variant (firmware 1.3.6,
    // future-only swaps). 5.x clients never carry the prefix and stay on the
    // default branch.
    let is60 = false
    if (url.pathname.startsWith('/v6/')) {
      is60 = true
      url.pathname = url.pathname.slice(3) // keep the leading slash
    }

    // Diagnostic log — 2026-05-12 Brawlhalla install-failure triage.
    // Emit one line per request so Workers tail captures URL + method + is60.
    // Remove after the install-failure investigation closes.
    console.log(`[REQ] ${request.method} ${is60 ? '/v6 ' : '5x  '}${url.pathname}${url.search}`)

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    const time = Math.floor(Date.now() / 1000).toString()

    try {
      // ── Chat routes ────────────────────────────────────────────────────────
      if (url.pathname === '/chat/send') {
        if (request.method !== 'POST') {
          return new Response(JSON.stringify({ error: 'method_not_allowed' }),
            { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        return handleChatSend(request, env, corsHeaders)
      }

      if (url.pathname === '/chat/report') {
        if (request.method !== 'POST') {
          return new Response(JSON.stringify({ error: 'method_not_allowed' }),
            { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        return handleChatReport(request, env, corsHeaders)
      }

      if (url.pathname === '/chat/rooms') {
        return handleChatRooms(env, corsHeaders)
      }

      // ── Steam chat image hosting (R2) ───────────────────────────────────────
      // The native friends.upload_chat_image 401s (Steam web access-token
      // expiry), so the in-game overlay POSTs the picked image here and sends
      // the returned URL as a normal Steam chat message (Steam embeds it
      // inline). Stored in the bannerhub-chat-images R2 bucket with a 7-day
      // lifecycle; served back from /chat/i/<key>.
      if (url.pathname === '/chat/upload-image') {
        if (request.method !== 'POST') {
          return new Response(JSON.stringify({ error: 'method_not_allowed' }),
            { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        // Lightweight gate (bounds casual abuse; not a security boundary).
        if (request.headers.get('x-bh-chat') !== 'bh6img') {
          return new Response(JSON.stringify({ error: 'forbidden' }),
            { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        const ct = request.headers.get('content-type') || 'image/jpeg'
        if (!ct.startsWith('image/')) {
          return new Response(JSON.stringify({ error: 'image_only' }),
            { status: 415, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        const buf = await request.arrayBuffer()
        if (buf.byteLength === 0 || buf.byteLength > 5 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: 'bad_size' }),
            { status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        const ext = ct === 'image/png' ? 'png'
          : ct === 'image/gif' ? 'gif'
          : ct === 'image/webp' ? 'webp' : 'jpg'
        const key = crypto.randomUUID().replace(/-/g, '') + '.' + ext
        await env.CHAT_IMAGES.put(key, buf, { httpMetadata: { contentType: ct } })
        const imgUrl = `https://${url.host}/chat/i/${key}`
        return new Response(JSON.stringify({ url: imgUrl }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      if (url.pathname.startsWith('/chat/i/')) {
        const key = decodeURIComponent(url.pathname.slice('/chat/i/'.length))
        if (!key || key.includes('/')) return new Response('not found', { status: 404 })
        const obj = await env.CHAT_IMAGES.get(key)
        if (!obj) return new Response('not found', { status: 404 })
        const h = new Headers(corsHeaders)
        obj.writeHttpMetadata(h)
        h.set('cache-control', 'public, max-age=604800, immutable')
        if (!h.get('content-type')) h.set('content-type', 'image/jpeg')
        return new Response(obj.body, { headers: h })
      }

      // ── Keep-alive ping (scheduled cron calls this) ─────────────────────────
      if (url.pathname === '/chat/keepalive') {
        try {
          await fetch(`${env.SUPABASE_URL}/rest/v1/rooms?select=id&limit=1`, {
            headers: {
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
            }
          })
          return new Response(JSON.stringify({ ok: true }),
            { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        } catch (e) {
          return new Response(JSON.stringify({ ok: false }),
            { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
      }

      // ── In-game voice room (hosted WebRTC; handlers defined above) ───────────
      if (url.pathname === '/voice/room') {
        return handleVoiceRoom(corsHeaders)
      }
      if (url.pathname === '/voice/turn') {
        return await handleVoiceTurn(env, corsHeaders)
      }
      if (url.pathname === '/voice/signal') {
        if (request.method !== 'POST') {
          return jsonRes({ error: 'method_not_allowed' }, 405, corsHeaders)
        }
        return handleVoiceSignal(request, env, corsHeaders)
      }
      if (url.pathname === '/voice/poll') {
        return handleVoicePoll(url, env, corsHeaders)
      }
      if (url.pathname === '/voice/roster') {
        return handleVoiceRoster(request, url, env, corsHeaders)
      }
      if (url.pathname === '/voice/log') {
        return handleVoiceLog(request, url, env, corsHeaders)
      }

      // steam/steamid/store: app sends SteamID64 after login → stored in KV
      // POST body: {steam_id: "76561198..."}
      // Called by BannerHub smali patch after successful Steam login.
      if (url.pathname === '/steam/steamid/store') {
        try {
          const body = await request.json()
          const steamId = String(body.steam_id || '').trim()
          if (steamId && /^\d{17}$/.test(steamId)) {
            await env.TOKEN_STORE.put('steam_user_steamid', steamId)
            return new Response(
              JSON.stringify({ code: 200, msg: 'ok', time }),
              { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
            )
          }
        } catch (e) {}
        return new Response(
          JSON.stringify({ code: 400, msg: 'invalid steam_id', time }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        )
      }

      // jwt/refresh/token: read real token from shared KV
      if (url.pathname === '/jwt/refresh/token') {
        try {
          const tokenDataStr = await env.TOKEN_STORE.get('bannerhub_token')
          if (tokenDataStr) {
            const tokenData = JSON.parse(tokenDataStr)
            return new Response(
              JSON.stringify({ code: 200, msg: '', time, data: { token: tokenData.token } }),
              { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
            )
          }
        } catch (e) {}
        return new Response(
          JSON.stringify({ code: 200, msg: '', time, data: { token: 'fake-token' } }),
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        )
      }

      // simulator/executeScript: route by gpu_vendor + game_type
      //
      // On /v6/, the 6.0 client's GameEnvConfigEntity$$serializer marks
      // `deps` as a REQUIRED field (smali descriptor in
      // smali_classes4/com/xiaoji/egggame/common/winemu/data/bean/
      // GameEnvConfigEntity$$serializer.smali — Lr0h;->j(name, false=required)).
      // Our static executeScript variants (generic{,_steam}, qualcomm{,_steam})
      // pre-date the 6.0 schema and don't carry `deps`. Without it,
      // kotlinx-strict throws MissingFieldException, the launch task gets no
      // env config, and the install pass surfaces "task install components
      // failed" — verified 2026-05-12 against bannerhub-revanced 6.0.4
      // Steam-library launches of Brawlhalla. Inject an empty `deps` array
      // ONLY for /v6/ traffic; 5.x's lenient deserializer doesn't care.
      if (url.pathname === '/simulator/executeScript') {
        let gpuVendor = '', gameType = null
        if (request.method === 'POST') {
          try { const body = await request.clone().json(); gpuVendor = (body.gpu_vendor || '').toLowerCase(); gameType = body.game_type } catch (e) {}
        }
        const gpuSuffix = gpuVendor.includes('qualcomm') ? 'qualcomm' : 'generic'
        const suffix = gameType === 0 ? `${gpuSuffix}_steam` : gpuSuffix
        const res = await fetch(`${GITHUB_BASE}/simulator/executeScript/${suffix}`)
        if (!res.ok) return new Response(JSON.stringify({ code: 200, msg: 'Success', data: {}, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        if (!is60) {
          return new Response(await res.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        const data = await res.json()
        if (data && data.data && data.data.deps === undefined) data.data.deps = []
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // vtouch/startType: route by game_type
      if (url.pathname === '/vtouch/startType') {
        let gameType = null
        if (request.method === 'POST') {
          try { const body = await request.clone().json(); gameType = body.game_type } catch (e) {}
        }
        const path = gameType === 0 ? '/vtouch/startType_steam' : '/vtouch/startType'
        const res = await fetch(`${GITHUB_BASE}${path}`)
        return new Response(await res.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // GameHub 6.0: getContainerDetail?id=N → serve per-id static file
      if (url.pathname === '/simulator/v2/getContainerDetail') {
        let id = null
        if (request.method === 'POST') {
          try { const body = await request.json(); id = body.id } catch (e) {}
        } else {
          id = url.searchParams.get('id')
        }
        if (id == null || !/^\d+$/.test(String(id))) {
          return new Response(JSON.stringify({ code: 400, msg: 'Missing or invalid id', data: null, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        const res = await fetch(`${GITHUB_BASE}/simulator/v2/getContainerDetail/${id}`)
        if (!res.ok) return new Response(JSON.stringify({ code: 404, msg: 'Container not found', data: null, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        return new Response(await res.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // Reshape a 5.x EnvLayer item to satisfy 6.0 kotlinx-strict EnvLayerEntity.
      // Strips dead 5.x fields (is_ui, gpu_range) and injects 6.0 required fields
      // missing from the static catalog (fileType, framework, framework_type,
      // is_steam, status, blurb, upgrade_msg, sub_data, base). Without these,
      // every 6.0 component-list parse throws and zero COMPONENT:* keys land in
      // sp_winemu_unified_resources.xml.
      const reshapeFor60 = (e) => {
        delete e.is_ui
        delete e.gpu_range
        // Upstream Xiaoji /v6/ ships every component (including base) with
        // fileType=4. Our 5.x source XML defines fileType=0 universally, so
        // without an override every /v6/ response served 0 — wrong for base
        // on 6.0 and the cause of "task install components failed" on first
        // launch for v1.0.1 base.tzst (verified 2026-05-12 against vanilla
        // 6.0.x on-device sp_winemu_unified_resources.xml COMPONENT:base
        // entry which had fileType=4). Force 4 on /v6/ to match upstream.
        e.fileType = 4
        if (e.framework === undefined) e.framework = ''
        if (e.framework_type === undefined) e.framework_type = ''
        // Upstream Xiaoji /v6/ ships `isSteam` on every COMPONENT entry (always
        // 0 — verified 2026-05-12 across all 351 upstream entries, including
        // the Steam client itself). Inject snake-case `is_steam` here; kotlinx
        // @SerialName maps it to the camelCase Kotlin field, matching the
        // on-device sp_winemu_unified_resources.xml shape exactly. Previously
        // omitted on the assumption "components don't read isSteam" — but
        // missing-field-vs-zero-value is a real difference for kotlinx-strict.
        // Container-side isSteam mirror still lives in the dedicated
        // getContainerList handler below (carries real 1/2 values per row).
        if (e.is_steam === undefined) e.is_steam = 0
        // Force status=1 for upstream's "active/recommended" rotation (see
        // UPSTREAM_STATUS1 set below). Everything else stays at 0.
        e.status = UPSTREAM_STATUS1.has(e.name) ? 1 : 0
        // Override stale .yml install scripts with mirrored upstream content.
        // /v6/-only swap: 5.x continues to serve our static catalog values.
        const yml = UPSTREAM_YML_OVERRIDES.get(e.name)
        if (yml) {
          e.file_md5 = yml.file_md5
          e.file_size = yml.file_size
          e.file_name = yml.file_name
          e.version = yml.version
          e.version_code = yml.version_code
          e.download_url = yml.download_url
        }
        if (e.blurb === undefined) e.blurb = ''
        if (e.upgrade_msg === undefined) e.upgrade_msg = ''
        if (e.sub_data === undefined) e.sub_data = null
        if (e.base === undefined) e.base = null
        return e
      }

      // 6.0-only Steam-client type remap.
      //
      // 5.3.5 ships Steam clients at type=7 (per ADDING_NEW_COMPONENTS.md +
      // commit ca40378 "retype steam_client_0403 to type 7 for 5.3.5
      // compatibility"). The 6.0 Steam picker does NOT surface our type=7
      // entries — type 7 may have been reassigned in the KMP rewrite. We are
      // probing type 8 first since steam_client_0403 originally shipped at
      // type 8 (commit d694e1a "add type 8 (Steam Client)") before the 5.3.5
      // retype, so 6.0 likely kept the pre-retype convention.
      //
      // Filter is type === 7 (catches steam_client_0403, steam_9866232,
      // steam_9866233 — every Steam *client* in the catalog today, plus any
      // future entry the upstream XML adds at type 7). Steam *agents* (type
      // 5 today, e.g. SteamAgent2) are intentionally untouched — they are
      // not Steam clients and may belong to a different 6.0 category.
      //
      // This runs only on the /v6/ path (where reshapeFor60 is called); the
      // 5.x pass-through path keeps type=7 untouched, so 5.3.5 keeps working.
      const remapSteamFor60 = (e) => {
        if (e.type === 7) e.type = 8
      }

      // 6.0-only Steam-client allowlist.
      //
      // Upstream's catalog still ships steam_9866232 and steam_9866233
      // alongside steam_client_0403, all at type=7 → promoted to type=8 by
      // remapSteamFor60 above. For 6.0 we want the picker to surface only
      // steam_client_0403 (the canonical/working one); the 9866* clients
      // are kept in the 5.x pass-through response for back-compat but
      // filtered from /v6/ responses entirely.
      //
      // Returns true to KEEP, false to DROP. Drop only Steam clients
      // (post-remap type=8) that are NOT the allowlisted name. Anything
      // else (every non-Steam entry, plus steam_client_0403 itself) is
      // kept untouched. Inverted check on type lets us add more allowed
      // Steam-client names later by extending ALLOWED_STEAM_CLIENTS.
      const ALLOWED_STEAM_CLIENTS = new Set(['steam_client_0403'])
      const keepForSteamClientAllowlist60 = (e) =>
        e.type !== 8 || ALLOWED_STEAM_CLIENTS.has(e.name)

      // Upstream Xiaoji /v6/ marks 9 specific components with `status=1` (the
      // "currently active / recommended" flag — one per slot per category).
      // Verified 2026-05-12 against the user's on-device unified resources
      // XML from vanilla GameHub 6.0.x: every other component is status=0.
      // Without this set our /v6/ defaults everything to 0, which appears to
      // suppress the install task's "use this default" path for base +
      // steam_client_0403 + vkd3d-2.12 and likely contributed to "task
      // install components failed" on Brawlhalla. Update this set when
      // upstream rotates a recommended component.
      const UPSTREAM_STATUS1 = new Set([
        'base',
        'steam_client_0403',
        'vkd3d-2.12',
        'dxvk-2.3.1-async',
        'vcredist2019',
        'SteamAgent2',
        'Fex_20260509',
        'Turnip_v26.2.0_R3',
        'turnip_v26.1.0_R4',
        'mono',
        'mono-10.4.1',
      ])

      // Upstream Xiaoji /v6/ ships fresher versions of 17 .yml install scripts
      // (vcredist*, mono*, gecko, physx, K-Lite, VulkanRT, XLiveRedist,
      // cjkfonts, oalinst) than our static catalog. The .yml content is a
      // dependency manifest read by the install task to fetch the actual
      // installer (e.g. VC_redist.x64.exe from Microsoft). Mirror the fresher
      // .yml files on our Components release (md5-named) so the 6.0 install
      // task gets the up-to-date dependency list. /v6/-only swap — 5.x still
      // serves our pre-existing v1.0.0 .yml entries via the raw passthrough.
      // Update entries here when upstream bumps a .yml file.
      const UPSTREAM_YML_OVERRIDES = new Map([
        ['K-Lite', { file_md5: 'a408473ba1386cf39e15a7bb1b59827a', file_size: 392, file_name: 'K-Lite.yml', version: '1.0.6', version_code: 1143, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/a408473ba1386cf39e15a7bb1b59827a.yml' }],
        ['VulkanRT', { file_md5: '9875d27394bd0395d71307f98f32075c', file_size: 547, file_name: 'VulkanRT.yml', version: '1.0.1', version_code: 1493, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/9875d27394bd0395d71307f98f32075c.yml' }],
        ['XLiveRedist', { file_md5: 'fb698a45d3a6ec01337cde14c931a723', file_size: 409, file_name: 'XLiveRedist.yml', version: '1.0.1', version_code: 1593, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/fb698a45d3a6ec01337cde14c931a723.yml' }],
        ['cjkfonts', { file_md5: 'a7907ac50b78a6de437e3eb6c1360037', file_size: 4013, file_name: 'cjkfonts.yml', version: '1.0.1', version_code: 1000, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/a7907ac50b78a6de437e3eb6c1360037.yml' }],
        ['gecko', { file_md5: '39bf8130cf0a66c8dd8c5e6358ad0004', file_size: 677, file_name: 'gecko.yml', version: '1.0.1', version_code: 2, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/39bf8130cf0a66c8dd8c5e6358ad0004.yml' }],
        ['mono', { file_md5: 'b9d6016c3aab2bb836c8335b2e06a04b', file_size: 490, file_name: 'mono.yml', version: '1.0.1', version_code: 941, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/b9d6016c3aab2bb836c8335b2e06a04b.yml' }],
        ['mono-10.1.0', { file_md5: '294e578d4325b19d60e98f81012ecf3f', file_size: 494, file_name: 'mono-10.1.0.yml', version: '1.0.1', version_code: 1061, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/294e578d4325b19d60e98f81012ecf3f.yml' }],
        ['mono-10.3.0', { file_md5: '4862ad0883ef2dd6419f0f1ac38c225c', file_size: 494, file_name: 'mono-10.3.0.yml', version: '1.0.1', version_code: 2, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/4862ad0883ef2dd6419f0f1ac38c225c.yml' }],
        ['mono-10.4.1', { file_md5: '294e578d4325b19d60e98f81012ecf3f', file_size: 494, file_name: 'mono-10.4.1.yml', version: '1.0.3', version_code: 4, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/294e578d4325b19d60e98f81012ecf3f.yml' }],
        ['oalinst', { file_md5: 'c131cd67a1f028c82dff21628a2f6c95', file_size: 407, file_name: 'oalinst.yml', version: '1.0.1', version_code: 1938, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/c131cd67a1f028c82dff21628a2f6c95.yml' }],
        ['physx', { file_md5: '6d9e00fa670ac3f5eedd0006b10040e5', file_size: 523, file_name: 'physx.yml', version: '1.0.1', version_code: 942, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/6d9e00fa670ac3f5eedd0006b10040e5.yml' }],
        ['vcredist2005', { file_md5: '3ff1b801eaa4760b3c02830374ce2677', file_size: 1091, file_name: 'vcredist2005.yml', version: '1.0.1', version_code: 117, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/3ff1b801eaa4760b3c02830374ce2677.yml' }],
        ['vcredist2008', { file_md5: 'dc4f22dd8028c6eba432ba8d46998c05', file_size: 1105, file_name: 'vcredist2008.yml', version: '1.0.1', version_code: 118, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/dc4f22dd8028c6eba432ba8d46998c05.yml' }],
        ['vcredist2010', { file_md5: '315fd6cc33ca6ff33d795e501a63d6be', file_size: 1049, file_name: 'vcredist2010.yml', version: '1.0.1', version_code: 120, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/315fd6cc33ca6ff33d795e501a63d6be.yml' }],
        ['vcredist2012', { file_md5: 'b6498f6b34280ed2fb7e089e6eb74124', file_size: 1049, file_name: 'vcredist2012.yml', version: '1.0.1', version_code: 121, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/b6498f6b34280ed2fb7e089e6eb74124.yml' }],
        ['vcredist2015', { file_md5: '09d2bd2947c16ba62f49db8bbfe4be6a', file_size: 2509, file_name: 'vcredist2015.yml', version: '1.0.2', version_code: 945, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/09d2bd2947c16ba62f49db8bbfe4be6a.yml' }],
        ['vcredist2022', { file_md5: '793aa93426d903a6526d434cd1652aa3', file_size: 1629, file_name: 'vcredist2022.yml', version: '1.0.1', version_code: 945, download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/793aa93426d903a6526d434cd1652aa3.yml' }],
      ])

      // Unwrap the static catalog's 5.x list-of-string wrapper into a real
      // JSON array, so 6.0 kotlinx-strict can deserialize it. EnvListData.list
      // is typed Ljava/util/List; (EnvListData.smali:36); BaseResult<List<...>>
      // expects data to BE the array (i9f.smali:2413, nhn.smali:932). A
      // stringified list throws "expected JSON array, got String".
      const parseListField = (data) => {
        if (!data || data.list == null) return []
        if (Array.isArray(data.list)) return data.list
        if (typeof data.list === 'string') {
          try { return JSON.parse(data.list) } catch (e) { return [] }
        }
        return []
      }

      // getComponentList: filter by type, reshape for 6.0 parser.
      // Body may be JSON or form-urlencoded — 6.0 client uses form-urlencoded
      // (see i9f.smali:485 — pl6.J builder writes "type"/"page"/"page_size").
      // Response shape: BaseResult<EnvListData<EnvLayerEntity>> — list MUST be
      // a real JSON array, not stringified.
      if (url.pathname === '/simulator/v2/getComponentList') {
        // Parse type from query OR POST body (form-urlencoded or JSON) — both
        // 5.x and 6.0 clients send the filter here. 5.x used to rely on the
        // upstream Xiaoji API to do the filter server-side; after the self-host
        // pivot to GitHub Pages (commit 0185126), Pages is static and ignores
        // query strings, so the 5.x pass-through quietly stopped filtering.
        // Worker applies the filter for both branches now.
        let type = null
        if (request.method === 'POST') {
          const raw = await request.clone().text()
          try {
            type = JSON.parse(raw).type
          } catch (e) {
            const params = new URLSearchParams(raw)
            const v = params.get('type')
            if (v != null && v !== '') type = Number(v)
          }
        } else {
          const v = url.searchParams.get('type')
          if (v != null && v !== '') type = Number(v)
        }

        // 5.x: filter the static catalog server-side, preserve 5.x shape
        // (stringified `list`, snake_case fields, is_ui/gpu_range intact).
        // Do NOT reshape/remap/allowlist — those are 6.0-only.
        if (!is60) {
          const res = await fetch(`${GITHUB_BASE}${url.pathname}`)
          if (!res.ok) {
            return new Response(JSON.stringify({ code: 200, msg: 'Success', data: { list: '[]', total: 0, page: 1, pageSize: 10 }, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
          }
          const data = await res.json()
          let all = parseListField(data.data)
          if (type) all = all.filter(i => i.type === type)
          return new Response(JSON.stringify({
            code: data.code ?? 200,
            msg: data.msg ?? 'Success',
            data: {
              list: JSON.stringify(all),
              total: all.length,
              page: data.data?.page ?? 1,
              pageSize: data.data?.pageSize ?? all.length,
            },
            time,
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        const res = await fetch(`${GITHUB_BASE}${url.pathname}`)
        if (!res.ok) return new Response(JSON.stringify({ code: 200, msg: 'Success', data: { list: [], total: 0, page: 1, pageSize: 10 }, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        const data = await res.json()
        let all = parseListField(data.data)
        // Promote Steam clients (type=7 in 5.3.5) to type=8 BEFORE the type
        // filter, so a 6.0 client requesting type=8 actually receives them.
        for (const e of all) remapSteamFor60(e)
        // 6.0 Steam-client allowlist: keep only steam_client_0403, drop
        // upstream's steam_9866232/233 from /v6/ responses.
        all = all.filter(keepForSteamClientAllowlist60)
        if (type) all = all.filter(i => i.type === type)
        for (const e of all) reshapeFor60(e)
        return new Response(JSON.stringify({
          code: data.code ?? 200,
          msg: data.msg ?? 'Success',
          data: {
            list: all,
            total: all.length,
            page: data.data?.page ?? 1,
            pageSize: data.data?.pageSize ?? all.length,
          },
          time,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // getAllComponentList: reshape for 6.0 parser.
      //
      // ACTUAL response shape per l13.smali:861 cast:
      //   BaseResult<EnvListData<EnvLayerEntity>>
      //
      // EnvListData has fields {list, page, page_size, total} (per
      // EnvListData.smali:97-131). The 6.0 client deserializes `data` as
      // EnvListData<EnvLayerEntity> via EnvListData$$serializer — passing a
      // bare JSON array for `data` causes the cast to fail silently, the
      // entire COMPONENT category never persists, and
      // sp_winemu_unified_resources.xml stays empty for COMPONENT:* keys
      // (only CONTAINER:* and IMAGE_FS:* land via their separate endpoints).
      //
      // Earlier `data: [array]` shape (5.x bare-list) was inherited from a
      // wrong 6.0 assumption — corrected 2026-05-02 after on-device XML
      // showed 11 entries vs vanilla's ~340 COMPONENT entries.
      if (url.pathname === '/simulator/v2/getAllComponentList') {
        // 5.x: pass upstream catalog through unchanged. The EnvListData wrapper
        // + reshape are only required by 6.0's kotlinx-strict deserializer;
        // 5.x's tolerant Gson parser accepts the native upstream shape with
        // is_ui/gpu_range intact. Gating restores pre-bc09862 5.x behavior.
        if (!is60) {
          const res = await fetch(`${GITHUB_BASE}${url.pathname}`)
          return new Response(await res.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        const res = await fetch(`${GITHUB_BASE}${url.pathname}`)
        if (!res.ok) {
          return new Response(JSON.stringify({
            code: 200, msg: 'Success',
            data: { list: [], page: 1, page_size: 0, total: 0 },
            time,
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        const data = await res.json()
        let all = parseListField(data.data)
        for (const e of all) remapSteamFor60(e)
        // 6.0 Steam-client allowlist: keep only steam_client_0403, drop
        // upstream's steam_9866232/233 from /v6/ responses.
        all = all.filter(keepForSteamClientAllowlist60)
        for (const e of all) reshapeFor60(e)
        return new Response(JSON.stringify({
          code: data.code ?? 200,
          msg: data.msg ?? 'Success',
          data: {
            list: all,
            page: data.data?.page ?? 1,
            page_size: data.data?.page_size ?? all.length,
            total: data.data?.total ?? all.length,
          },
          time,
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // getImagefsDetail: serves Firmware metadata. Both 5.x and 6.0 now serve
      // 1.4.2 — 6.0 from this inline is60 branch, 5.x from the static
      // simulator/v2/getImagefsDetail file. The Add-Game path on 5.x reads
      // simulator/executeScript/{generic,qualcomm}{,_steam} which was bumped
      // to 1.4.2 alongside this comment. All 7 metadata sites stay in lockstep
      // (asset imagefs_142.zst, md5 6bcdc256…). Source: upstream 1.4.2 firmware
      // (uxdl.mac520.com imagefs.zst, versionCode 32). NOTE: this inline branch
      // is served by the Cloudflare worker — it does NOT update on git push;
      // the worker must be redeployed (CF REST API) IN LOCKSTEP with the Pages
      // static files or 6.0 clients split-brain (config 1.4.2 / firmware 1.4.1)
      // and "Download Game Config" fails. Re-applied 2026-06-07 WITH redeploy.
      if (url.pathname === '/simulator/v2/getImagefsDetail') {
        if (is60) {
          return new Response(JSON.stringify({
            code: 200,
            msg: 'Success',
            data: {
              id: 1,
              version: '1.4.2',
              version_code: 32,
              name: 'Firmware',
              logo: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/45e60d211d35955bd045aabfded4e64b.png',
              upgrade_msg: '',
              blurb: '',
              download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/imagefs_142.zst',
              file_md5: '6bcdc2568d26d6dbe90468fcdb4490ce',
              file_size: '173024718',
              file_name: 'imagefs.zst',
              display_name: 'Firmware',
            },
            time,
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        // 5.x falls through to GITHUB_ROUTES static proxy below.
      }

      // getContainerList: 6.0 reads `isSteam` (camelCase) on each container to
      // know which can host the Steam client component. The upstream catalog
      // already carries the right values in the snake-case `is_steam` field
      // (1 = Proton-based + Wine ARM64EC, 2 = plain Wine x64, 0 = neither).
      // For /v6/, mirror is_steam → isSteam verbatim per container so the
      // 6.0 client sees the field name it actually reads. 5.x clients fall
      // through to the generic pass-through below and keep snake-case only.
      if (is60 && url.pathname === '/simulator/v2/getContainerList') {
        const res = await fetch(`${GITHUB_BASE}${url.pathname}`)
        if (!res.ok) return new Response(JSON.stringify({ code: 200, msg: 'Success', data: [], time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        const data = await res.json()
        const containers = Array.isArray(data?.data) ? data.data : []
        for (const c of containers) {
          if (typeof c.is_steam === 'number') c.isSteam = c.is_steam
        }
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // /v6/ getDefaultComponent: swap steamClient to the allowlisted client.
      //
      // The static file points the default Steam client at `steam_9866233`
      // (type=7), which is correct for 5.x but breaks 6.0 — we filter
      // 9866233 out of /v6/getComponentList via keepForSteamClientAllowlist60
      // (only steam_client_0403 is exposed at type=8 on /v6/). When the 6.0
      // launch task asks for default components on a Steam library game, it
      // gets steamClient=9866233/type=7, tries to install it against the
      // /v6/ catalog where it doesn't exist, and surfaces "task install
      // components failed". Root cause identified 2026-05-12 after the
      // earlier reshape fixes (fileType/is_steam/status/yml) didn't fully
      // unblock the Steam-library launch flow on bannerhub-revanced 6.0.4.
      //
      // Swap to steam_client_0403 (type=8 after remap, fileType=4 per
      // reshape, in allowlist). Other fields (dxvk/vkd3d/container/gpu/
      // translator) pass through untouched.
      if (is60 && url.pathname === '/simulator/v2/getDefaultComponent') {
        const res = await fetch(`${GITHUB_BASE}${url.pathname}`)
        if (!res.ok) return new Response(JSON.stringify({ code: 200, msg: 'Success', data: {}, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        const data = await res.json()
        if (data && data.data) {
          data.data.steamClient = {
            base: null,
            blurb: '',
            display_name: '',
            download_url: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/08c498cef5c15d710d253681751068c1.tzst',
            file_md5: '08c498cef5c15d710d253681751068c1',
            file_name: '08c498cef5c15d710d253681751068c1.tzst',
            file_size: 64897035,
            fileType: 4,
            framework: '',
            framework_type: '',
            id: 1296,
            is_steam: 0,
            logo: 'https://github.com/The412Banner/bannerhub-api/releases/download/Components/45e60d211d35955bd045aabfded4e64b.png',
            name: 'steam_client_0403',
            status: 1,
            sub_data: null,
            type: 8,
            upgrade_msg: '',
            version: '1.0.0',
            version_code: 1,
          }
        }
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // Other GitHub Pages static routes
      if (GITHUB_ROUTES.has(url.pathname)) {
        const res = await fetch(`${GITHUB_BASE}${url.pathname}`)
        if (!res.ok) return new Response(JSON.stringify({ code: 200, msg: 'Success', data: {}, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        return new Response(await res.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // vjoy/Scheme cloud-share endpoints — these need a real GameHub auth
      // token to reach upstream (without one, upstream returns
      // {code:401, msg:"Please login first"} which the client surfaces as
      // the "log in first" prompt).
      //
      // Captured request shape (2026-05-07): GET, no token header, no token
      // in query, only `clientparams`/`sign`/`time` for integrity. The
      // existing fall-through proxy strips all headers and never adds a
      // token, so authenticated GETs always 401 today.
      //
      // Fix: forward the original request headers verbatim AND inject the
      // shared `bannerhub_token` as a `token` header so upstream sees the
      // request as authenticated.
      // /simulator/getLocalGameDetail is the PC-EXE import recognition call
      // (POST body: LocalImportGameArgs{file_str, other_file_str}). Vanilla
      // 6.0 hits landscape-api.vgabc.com directly and receives a populated
      // LocalGameInfoSvrEntity (logo/cover_image/back_image/hero_capsule/
      // square_image), so imported games show cover art. Under the generic
      // fall-through proxy, all client headers (clientparams/sign/time) get
      // stripped, upstream treats the request as anonymous, and the response
      // is empty data → imported games land with no art.
      if (
        url.pathname.startsWith('/vcontroller/') ||
        url.pathname === '/simulator/configList' ||
        url.pathname === '/simulator/getConfigById' ||
        url.pathname === '/simulator/shareConfig' ||
        url.pathname === '/simulator/deleteShareConfig' ||
        url.pathname === '/simulator/reportConfigApply' ||
        url.pathname === '/simulator/getLocalGameDetail' ||
        url.pathname === '/simulator/getGameLoadingPromptList' ||
        url.pathname.startsWith('/readLayoutType/') ||
        url.pathname.startsWith('/writeLayoutType/')
      ) {
        let realToken = 'fake-token'
        try {
          const tokenDataStr = await env.TOKEN_STORE.get('bannerhub_token')
          if (tokenDataStr) realToken = JSON.parse(tokenDataStr).token
        } catch (e) {}

        const fwdHeaders = {}
        for (const [k, v] of request.headers.entries()) {
          // Drop hop-by-hop and CF-injected headers; keep clientparams/sign/time/etc.
          const lk = k.toLowerCase()
          if (lk === 'host' || lk === 'connection' || lk === 'content-length' ||
              lk.startsWith('cf-') || lk.startsWith('x-forwarded') ||
              lk === 'x-real-ip') continue
          fwdHeaders[k] = v
        }
        fwdHeaders['token'] = realToken

        let fwdBody = null
        if (request.method === 'POST') {
          fwdBody = await request.text()
          // If the body has a token field, swap fake-token → real (existing
          // pattern) and recompute the signature.
          try {
            const j = JSON.parse(fwdBody)
            if ('token' in j) {
              j.token = realToken
              const sigParams = {}
              for (const [k, v] of Object.entries(j)) {
                if (k !== 'sign') sigParams[k] = v
              }
              j.sign = generateSignature(sigParams)
              fwdBody = JSON.stringify(j)
            }
          } catch (e) {}
        }

        try {
          const res = await fetch(`${GAMEHUB_API}${url.pathname}${url.search}`, {
            method: request.method,
            headers: fwdHeaders,
            body: fwdBody,
          })
          return new Response(await res.text(), {
            status: res.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          })
        } catch (e) {
          return new Response(JSON.stringify({
            code: 500, msg: `vjoy proxy error: ${e.message}`, time,
          }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
      }

      // All other routes: proxy to GameHub API with real token + regenerated signature
      let realToken = 'fake-token'
      try {
        const tokenDataStr = await env.TOKEN_STORE.get('bannerhub_token')
        if (tokenDataStr) realToken = JSON.parse(tokenDataStr).token
      } catch (e) {}

      let bodyText = null
      let forwardBody = null

      if (request.method === 'POST') {
        bodyText = await request.text()
        try {
          const bodyJson = JSON.parse(bodyText)
          // Replace token and regenerate signature
          if ('token' in bodyJson) {
            bodyJson.token = realToken
            // Rebuild signature from all body params except 'sign'
            const sigParams = {}
            for (const [k, v] of Object.entries(bodyJson)) {
              if (k !== 'sign') sigParams[k] = v
            }
            bodyJson.sign = generateSignature(sigParams)
            forwardBody = JSON.stringify(bodyJson)
          } else {
            forwardBody = bodyText
          }
        } catch (e) {
          forwardBody = bodyText
        }
      }

      const forwardHeaders = { 'Content-Type': 'application/json' }
      const res = await fetch(`${GAMEHUB_API}${url.pathname}${url.search}`, {
        method: request.method,
        headers: forwardHeaders,
        body: forwardBody,
      })

      let resBody = await res.text()

      // Steam library augmentation: intercept when page_size=1000 (library sync)
      // GameHub's backend returns only ~65 games it has metadata for.
      // We augment with the user's full Steam library via GetOwnedGames.
      if (
        request.method === 'POST' &&
        forwardBody &&
        res.ok
      ) {
        try {
          const parsedFwd = JSON.parse(forwardBody)
          if (parsedFwd.page_size === 1000 && parsedFwd.page === 1 && !parsedFwd.steam_appids) {
            resBody = await augmentSteamLibrary(resBody, env)
          }
        } catch (e) {}
      }

      return new Response(resBody, {
        status: res.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })

    } catch (error) {
      return new Response(
        JSON.stringify({ code: 500, msg: `Error: ${error.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }
  },
}
