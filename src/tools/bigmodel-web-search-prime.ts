/**
 * BigModel MCP WebSearch Prime — framework-agnostic utility
 *
 * 目标：
 * - 提供一个可复用的纯函数，便于在 LangChain / LangGraph / deepagents / 自研框架中封装为 @tool / StructuredTool 等。
 * - 尽量零依赖（不自动调用 dotenv，不绑定特定框架）。
 * - 强类型入参/出参，内置"双层字符串化 JSON"解包与结果规范化。
 * - 连接可复用（默认），亦可按需禁用复用。
 *
 * 注意：
 * - 需要在调用方自行确保环境变量 BIGMODEL_API_KEY（或通过 options.apiKey 传入）、
 *   以及在 CLI/脚本里（而非本模块内）调用 dotenv.config()（如果需要）。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/** MCP 内容块（最小化本地定义，避免强耦合 SDK 内部类型） */
export interface MCPContentBlock {
  type: string
  text?: string
  [k: string]: unknown
}

/** WebSearchPrime 原始参数（与 BigModel 工具定义保持一致） */
export interface WebSearchPrimeParams {
  /** Content to be searched, <= 70 chars is recommended by provider */
  search_query: string
  /** 1-50，默认 10 */
  count?: number
  /** 'medium' | 'high'；默认 'medium' */
  content_size?: 'medium' | 'high'
  /** 'cn' | 'us'；默认 'cn' */
  location?: 'cn' | 'us'
  /** 仅返回指定域名结果，如 'www.example.com' */
  search_domain_filter?: string
  /** 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear' | 'noLimit'；默认 'noLimit' */
  search_recency_filter?: 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear' | 'noLimit'
}

/** 额外客户端配置（与业务无关） */
export interface BigModelMCPOptions {
  /** Bearer key；若未提供则回落至 process.env.BIGMODEL_API_KEY */
  apiKey?: string
  /** MCP 端点；默认指向 BigModel WebSearch Prime MCP */
  endpoint?: string
  /** 额外 HTTP 头（会与 Authorization 合并） */
  transportHeaders?: Record<string, string>
  /** 是否复用连接（默认 true） */
  reuseConnection?: boolean
  /** 可选：在调用前校验工具是否存在（默认 false，避免额外一次 RTT） */
  validateToolAvailability?: boolean
  /**
   * 软超时（毫秒）。超时后本函数会 reject，但无法保证底层请求已被真正中断（MCP Transport 目前不暴露逐次 signal）。
   * 若你对“真中断”有强需求，建议将 reuseConnection 设为 false，由调用方自行为每次调用构建带 signal 的 transport。
   */
  timeoutMs?: number
}

/** 统一后的结果项（做轻量规范化，但保留 raw 便于调用方实现自定义策略） */
export interface WebSearchPrimeItem {
  title: string
  url: string
  summary?: string
  icon?: string
  siteName?: string
  media?: string
  publishedAt?: string
  refer?: string
  /** 原始项（未改动），用于框架侧二次处理或 debug */
  raw?: Record<string, unknown>
}

/** 函数总返回值 */
export interface WebSearchPrimeOutput {
  /** 规范化后的列表 */
  items: WebSearchPrimeItem[]
  /** MCP 原始 content blocks（用于溯源/调试） */
  rawBlocks: MCPContentBlock[]
  /** 元信息 */
  meta: {
    endpoint: string
    toolName: 'webSearchPrime'
    tookMs: number
    requestedCount?: number
    returnedCount: number
    reusedConnection: boolean
  }
}

/** 供封装器/装饰器使用的 JSON Schema（非绑定，仅为方便） */
export const WEB_SEARCH_PRIME_ARGS_SCHEMA = {
  type: 'object',
  properties: {
    search_query: { type: 'string', description: 'query, <= 70 chars recommended' },
    count: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
    content_size: { type: 'string', enum: ['medium', 'high'], default: 'medium' },
    location: { type: 'string', enum: ['cn', 'us'], default: 'cn' },
    search_domain_filter: { type: 'string' },
    search_recency_filter: {
      type: 'string',
      enum: ['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit'],
      default: 'noLimit',
    },
  },
  required: ['search_query'],
  additionalProperties: false,
} as const

const DEFAULT_ENDPOINT = 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp'
const TOOL_NAME = 'webSearchPrime'

/** 内部：连接缓存，按 endpoint+apiKey 维度复用 */
type CacheKey = string
const clientCache = new Map<CacheKey, Promise<{ client: Client }>>()

/** 标准化错误类型 */
export class BigModelMCPError extends Error {
  code:
    | 'MISSING_API_KEY'
    | 'MCP_TOOL_ERROR'
    | 'INVALID_RESPONSE'
    | 'TRANSPORT_OR_CONNECT_ERROR'
  details?: unknown
  constructor(
    message: string,
    code: BigModelMCPError['code'],
    details?: unknown
  ) {
    super(message)
    this.name = 'BigModelMCPError'
    this.code = code
    this.details = details
  }
}

/** 公开：主函数（可直接被任何框架的 tool 装饰器/封装器调用） */
export async function bigmodelWebSearchPrime(
  params: WebSearchPrimeParams,
  options: BigModelMCPOptions = {}
): Promise<WebSearchPrimeOutput> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const apiKey = options.apiKey ?? process.env.BIGMODEL_API_KEY
  if (!apiKey || apiKey.trim() === '') {
    throw new BigModelMCPError(
      'Missing BigModel API key: pass options.apiKey or set BIGMODEL_API_KEY',
      'MISSING_API_KEY'
    )
  }

  const start = Date.now()

  // 1) 获取（或新建）MCP Client
  const reusedConnection = options.reuseConnection !== false
  const client = await (reusedConnection
    ? getOrCreateClient(endpoint, apiKey, options.transportHeaders)
    : createEphemeralClient(endpoint, apiKey, options.transportHeaders))

  // 2) 可选：校验工具存在
  if (options.validateToolAvailability) {
    const toolList = await client.listTools().catch((e) => {
      throw new BigModelMCPError(
        'Failed to list tools on MCP server',
        'TRANSPORT_OR_CONNECT_ERROR',
        e
      )
    })
    const exists = Array.isArray((toolList as any)?.tools)
      ? (toolList as any).tools.some((t: any) => t?.name === TOOL_NAME)
      : false
    if (!exists) {
      throw new BigModelMCPError(
        `Tool "${TOOL_NAME}" not found on MCP endpoint ${endpoint}`,
        'INVALID_RESPONSE',
        toolList
      )
    }
  }

  // 3) 调用工具（带软超时）
  const callPromise = client
    .callTool({
      name: TOOL_NAME,
      arguments: params,
    })
    .catch((e: unknown) => {
      throw new BigModelMCPError(
        `MCP callTool("${TOOL_NAME}") failed`,
        'TRANSPORT_OR_CONNECT_ERROR',
        e
      )
    })

  const result = await withSoftTimeout(callPromise, options.timeoutMs)

  if ((result as any)?.isError) {
    throw new BigModelMCPError(
      `MCP tool "${TOOL_NAME}" returned isError=true`,
      'MCP_TOOL_ERROR',
      result
    )
  }

  const rawBlocks: MCPContentBlock[] = Array.isArray((result as any)?.content)
    ? ((result as any).content as MCPContentBlock[])
    : []

  // 4) 解析 content blocks -> items[]
  const parsedItems = parseItemsFromBlocks(rawBlocks)
  const items = normalizeItems(parsedItems)

  const tookMs = Date.now() - start
  return {
    items,
    rawBlocks,
    meta: {
      endpoint,
      toolName: TOOL_NAME,
      tookMs,
      requestedCount: params.count,
      returnedCount: items.length,
      reusedConnection,
    },
  }
}

/* ----------------- 内部工具函数 ----------------- */

async function getOrCreateClient(
  endpoint: string,
  apiKey: string,
  headers?: Record<string, string>
): Promise<Client> {
  const key: CacheKey = `${endpoint}::${hashKey(apiKey)}`
  let existing = clientCache.get(key)
  if (!existing) {
    existing = createClientPromise(endpoint, apiKey, headers)
    clientCache.set(key, existing)
  }
  const { client } = await existing
  return client
}

async function createEphemeralClient(
  endpoint: string,
  apiKey: string,
  headers?: Record<string, string>
): Promise<Client> {
  const { client } = await createClientPromise(endpoint, apiKey, headers)
  return client
}

function createClientPromise(
  endpoint: string,
  apiKey: string,
  headers?: Record<string, string>
): Promise<{ client: Client }> {
  const mergedHeaders = {
    Authorization: `Bearer ${apiKey}`,
    ...(headers ?? {}),
  }

  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: mergedHeaders,
    },
  })

  const client = new Client({
    name: 'bigmodel-search-mcp',
    version: '1.0.0',
  })

  return client
    .connect(transport)
    .then(() => ({ client }))
    .catch((e) => {
      throw new BigModelMCPError(
        'Failed to connect MCP client',
        'TRANSPORT_OR_CONNECT_ERROR',
        e
      )
    })
}

function hashKey(s: string): string {
  // 简单不可逆“指纹”，避免把完整 key 暴露到内存结构/日志（非安全哈希，仅用于 cache key）
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return `k${Math.abs(h)}`
}

async function withSoftTimeout<T>(
  p: Promise<T>,
  timeoutMs?: number
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return p
  return new Promise<T>((resolve, reject) => {
    const to = setTimeout(() => {
      reject(
        new BigModelMCPError(
          `MCP call soft-timeout after ${timeoutMs}ms`,
          'TRANSPORT_OR_CONNECT_ERROR'
        )
      )
    }, timeoutMs)
    p.then(
      (v) => {
        clearTimeout(to)
        resolve(v)
      },
      (e) => {
        clearTimeout(to)
        reject(e)
      }
    )
  })
}

/** 解包可能“多层字符串化”的 JSON 文本 */
function parsePossiblyNestedJson(text: string): unknown {
  let val: unknown = text
  // 最多解两层（provider 现状常见“双层”）
  for (let i = 0; i < 2; i++) {
    if (typeof val === 'string') {
      try {
        val = JSON.parse(val)
      } catch {
        break
      }
    }
  }
  return val
}

/** 从 content blocks 中抽取 items 的原始数组 */
function parseItemsFromBlocks(blocks: MCPContentBlock[]): any[] {
  const out: any[] = []
  for (const b of blocks) {
    if (b?.type !== 'text' || typeof b.text !== 'string') continue
    const parsed = parsePossiblyNestedJson(b.text)
    if (Array.isArray(parsed)) {
      out.push(...parsed)
      continue
    }
    // 兼容一些包装结构：{ items: [...] } / { results: [...] } / { data: [...] }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      const arr =
        (Array.isArray(obj.items) && obj.items) ||
        (Array.isArray(obj.results) && obj.results) ||
        (Array.isArray(obj.data) && obj.data) ||
        null
      if (arr) out.push(...(arr as any[]))
    }
  }
  return out
}

/** 将 provider 返回的任意对象，轻量标准化为 WebSearchPrimeItem */
function normalizeItems(raw: any[]): WebSearchPrimeItem[] {
  const seen = new Set<string>()
  const result: WebSearchPrimeItem[] = []

  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>

    const url =
      (o.link as string) ??
      (o.url as string) ??
      (o.href as string) ??
      (typeof o['sourceUrl'] === 'string' ? (o['sourceUrl'] as string) : undefined)

    if (!url || typeof url !== 'string') continue

    const title =
      (o.title as string) ??
      (o.name as string) ??
      (o['page_title'] as string) ??
      url

    const summary =
      (o.content as string) ??
      (o.summary as string) ??
      (o.description as string)

    const icon =
      (o.icon as string) ??
      (o.favicon as string)

    const siteName =
      (o.website as string) ??
      (o.site as string) ??
      (o.siteName as string)

    const media = (o.media as string) ?? undefined
    const publishedAt =
      (o.publish_date as string) ??
      (o.published_at as string) ??
      (o.date as string) ??
      undefined

    const refer = (o.refer as string) ?? undefined

    if (seen.has(url)) continue
    seen.add(url)

    result.push({
      title,
      url,
      summary,
      icon,
      siteName,
      media,
      publishedAt,
      refer,
      raw: o,
    })
  }
  return result
}

