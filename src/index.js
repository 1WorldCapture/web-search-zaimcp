const DEFAULT_ENDPOINT =
  'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp'

/** 连接缓存（按 endpoint+key 指纹） */
const _clientCache = new Map()

/** 对 API Key 做一个轻指纹（非安全哈希，仅作 cache key） */
function _hashKey(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return `k${Math.abs(h)}`
}

/** 兼容：query(string) or params(object) */
function _toParams(input) {
  if (typeof input === 'string') {
    return { search_query: input, count: 10, content_size: 'medium', location: 'cn' }
  }
  return {
    count: 10,
    content_size: 'medium',
    location: 'cn',
    ...input,
  }
}

/** 解析可能“双层字符串化 JSON”的文本 */
function _parseNestedJson(text) {
  let v = text
  for (let i = 0; i < 2; i++) {
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v)
      } catch {
        break
      }
    }
  }
  return v
}

/** 从 content blocks 中抽取数组结果 */
function _extractArrayFromBlocks(blocks) {
  const out = []
  for (const b of blocks || []) {
    if (!b || b.type !== 'text' || typeof b.text !== 'string') continue
    const parsed = _parseNestedJson(b.text)
    if (Array.isArray(parsed)) {
      out.push(...parsed)
      continue
    }
    if (parsed && typeof parsed === 'object') {
      const o = parsed
      const arr =
        (Array.isArray(o.items) && o.items) ||
        (Array.isArray(o.results) && o.results) ||
        (Array.isArray(o.data) && o.data) ||
        null
      if (arr) out.push(...arr)
    }
  }
  return out
}

/** 轻量标准化 */
function _normalizeItems(rawArr) {
  const seen = new Set()
  const out = []
  for (const r of rawArr || []) {
    if (!r || typeof r !== 'object') continue
    const link = r.link || r.url || r.href || r.sourceUrl
    if (!link || typeof link !== 'string') continue
    if (seen.has(link)) continue
    seen.add(link)
    out.push({
      title: r.title || r.name || link,
      url: link,
      summary: r.content || r.summary || r.description,
      icon: r.icon || r.favicon,
      siteName: r.website || r.site || r.siteName,
      media: r.media,
      publishedAt: r.publish_date || r.published_at || r.date,
      refer: r.refer,
      raw: r,
    })
  }
  return out
}

/**
 * BigModel MCP WebSearch Prime（框架无关最小版）
 * @param {string|object} queryOrParams
 * @param {object} [options]
 * @returns {Promise<{items: Array, rawBlocks: Array}>}
 */
async function webSearchPrime(queryOrParams, options = {}) {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT
  const apiKey = options.apiKey || process.env.BIGMODEL_API_KEY
  if (!apiKey) {
    throw new Error('Missing BigModel API key: pass options.apiKey or set BIGMODEL_API_KEY')
  }
  const params = _toParams(queryOrParams)

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  )

  const cacheKey = options.reuseConnection === false
    ? `ephemeral::${Date.now()}`
    : `${endpoint}::${_hashKey(apiKey)}`

  let clientPromise = _clientCache.get(cacheKey)
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
      })
      const client = new Client({ name: 'bigmodel-search-mcp', version: '1.0.0' })
      await client.connect(transport)
      return client
    })()
    _clientCache.set(cacheKey, clientPromise)
  }
  const client = await clientPromise

  const result = await client.callTool({ name: 'webSearchPrime', arguments: params })
  if (result && result.isError) {
    throw new Error(`MCP tool "webSearchPrime" error: ${JSON.stringify(result)}`)
  }

  const rawBlocks = Array.isArray(result?.content) ? result.content : []
  const parsed = _extractArrayFromBlocks(rawBlocks)
  const items = _normalizeItems(parsed)
  return { items, rawBlocks }
}

module.exports = { webSearchPrime }

