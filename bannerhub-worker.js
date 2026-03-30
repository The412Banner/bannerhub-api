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
      if (url.pathname === '/simulator/executeScript') {
        let gpuVendor = '', gameType = null
        if (request.method === 'POST') {
          try { const body = await request.clone().json(); gpuVendor = (body.gpu_vendor || '').toLowerCase(); gameType = body.game_type } catch (e) {}
        }
        const gpuSuffix = gpuVendor.includes('qualcomm') ? 'qualcomm' : 'generic'
        const suffix = gameType === 0 ? `${gpuSuffix}_steam` : gpuSuffix
        const res = await fetch(`${GITHUB_BASE}/simulator/executeScript/${suffix}`)
        if (!res.ok) return new Response(JSON.stringify({ code: 200, msg: 'Success', data: {}, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        return new Response(await res.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
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

      // getComponentList: filter by type
      if (url.pathname === '/simulator/v2/getComponentList') {
        let type = null
        if (request.method === 'POST') {
          try { const body = await request.json(); type = body.type } catch (e) {}
        } else {
          type = Number(url.searchParams.get('type')) || null
        }
        const res = await fetch(`${GITHUB_BASE}${url.pathname}`)
        if (!res.ok) return new Response(JSON.stringify({ code: 200, msg: 'Success', data: { list: '[]', total: 0, page: 1, pageSize: 10 }, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        const data = await res.json()
        if (type && data.data && data.data.list) {
          try {
            const all = JSON.parse(data.data.list)
            const filtered = all.filter(i => i.type === type)
            data.data.list = JSON.stringify(filtered)
            data.data.total = filtered.length
          } catch (e) {}
        }
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // Other GitHub Pages static routes
      if (GITHUB_ROUTES.has(url.pathname)) {
        const res = await fetch(`${GITHUB_BASE}${url.pathname}`)
        if (!res.ok) return new Response(JSON.stringify({ code: 200, msg: 'Success', data: {}, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        return new Response(await res.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
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
