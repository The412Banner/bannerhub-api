const GITHUB_BASE = 'https://the412banner.github.io/bannerhub-api'
const GAMEHUB_API = 'https://landscape-api.vgabc.com'
const SECRET_KEY = 'all-egg-shell-y7ZatUDk'

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

// Routes that stay on GitHub Pages (BannerHub-specific static endpoints)
const GITHUB_ROUTES = new Set([
  '/simulator/v2/getComponentList',
  '/simulator/v2/getAllComponentList',
  '/simulator/v2/getContainerList',
  '/simulator/v2/getDefaultComponent',
  '/simulator/v2/getImagefsDetail',
  '/simulator/executeScript',
  '/simulator/getTabList',
  '/vtouch/startType',
  '/components/index',
])

export default {
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

      const resBody = await res.text()
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
