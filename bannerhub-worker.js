const GITHUB_BASE = 'https://the412banner.github.io/bannerhub-api'

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
      // jwt/refresh/token: read real token directly from shared KV
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

      // For getComponentList: filter by type from POST body
      if (url.pathname === '/simulator/v2/getComponentList') {
        let type = null
        if (request.method === 'POST') {
          try { const body = await request.json(); type = body.type } catch (e) {}
        } else {
          type = Number(url.searchParams.get('type')) || null
        }
        const response = await fetch(`${GITHUB_BASE}${url.pathname}`)
        if (!response.ok) {
          return new Response(
            JSON.stringify({ code: 200, msg: 'Success', data: { list: '[]', total: 0, page: 1, pageSize: 10 }, time }),
            { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
          )
        }
        const data = await response.json()
        if (type && data.data && data.data.list) {
          try {
            const allItems = JSON.parse(data.data.list)
            const filtered = allItems.filter(item => item.type === type)
            data.data.list = JSON.stringify(filtered)
            data.data.total = filtered.length
          } catch (e) {}
        }
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
      }

      // simulator/executeScript: route by gpu_vendor + game_type
      if (url.pathname === '/simulator/executeScript') {
        let gpuVendor = '', gameType = null
        if (request.method === 'POST') {
          try { const body = await request.clone().json(); gpuVendor = (body.gpu_vendor || '').toLowerCase(); gameType = body.game_type } catch (e) {}
        }
        const gpuSuffix = gpuVendor.includes('qualcomm') ? 'qualcomm' : 'generic'
        const suffix = gameType === 0 ? `${gpuSuffix}_steam` : gpuSuffix
        const response = await fetch(`${GITHUB_BASE}/simulator/executeScript/${suffix}`)
        if (!response.ok) {
          return new Response(JSON.stringify({ code: 200, msg: 'Success', data: {}, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
        }
        return new Response(await response.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // vtouch/startType: route by game_type
      if (url.pathname === '/vtouch/startType') {
        let gameType = null
        if (request.method === 'POST') {
          try { const body = await request.clone().json(); gameType = body.game_type } catch (e) {}
        }
        const path = gameType === 0 ? '/vtouch/startType_steam' : '/vtouch/startType'
        const response = await fetch(`${GITHUB_BASE}${path}`)
        return new Response(await response.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }

      // All other requests: proxy to GitHub Pages
      const response = await fetch(`${GITHUB_BASE}${url.pathname}`)
      if (!response.ok) {
        return new Response(JSON.stringify({ code: 200, msg: 'Success', data: {}, time }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })
      }
      return new Response(await response.text(), { headers: { 'Content-Type': 'application/json', ...corsHeaders } })

    } catch (error) {
      return new Response(
        JSON.stringify({ code: 500, msg: `Error: ${error.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }
  },
}
