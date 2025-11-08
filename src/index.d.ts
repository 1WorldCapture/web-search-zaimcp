export interface WebSearchPrimeParams {
  /** Search query text */
  search_query: string;
  /** Number of results to return (service-dependent). */
  count?: number;
  /** Content size preference (service-dependent). */
  content_size?: string;
  /** Location/region hint (e.g. 'cn'). */
  location?: string;
  /** Domain filter string (service-dependent). */
  search_domain_filter?: string;
  /** Recency filter string (service-dependent). */
  search_recency_filter?: string;
  /** Additional provider-specific parameters */
  [key: string]: unknown;
}

export interface WebSearchPrimeOptions {
  /** BigModel API key; falls back to process.env.BIGMODEL_API_KEY */
  apiKey?: string;
  /** Override endpoint; defaults to official WebSearch Prime MCP endpoint */
  endpoint?: string;
  /** Reuse a cached MCP client connection; default true */
  reuseConnection?: boolean;
}

export interface WebSearchPrimeItem {
  title: string;
  url: string;
  summary?: string;
  icon?: string;
  siteName?: string;
  media?: unknown;
  publishedAt?: string;
  refer?: unknown;
  /** Raw provider item */
  raw?: unknown;
}

export interface WebSearchPrimeResult {
  items: WebSearchPrimeItem[];
  /** Raw MCP content blocks returned by the tool */
  rawBlocks: unknown[];
}

export declare function webSearchPrime(
  queryOrParams: string | WebSearchPrimeParams,
  options?: WebSearchPrimeOptions
): Promise<WebSearchPrimeResult>;

declare const _default: {
  webSearchPrime: typeof webSearchPrime;
};

export default _default;
export { webSearchPrime };

