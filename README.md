**web-search-zaimcp — Minimal CommonJS Utility**
- Zero-dependency helper that calls the BigModel MCP `webSearchPrime` tool.
- Pure JavaScript (CommonJS), easy to embed in any agent framework or script.
- Handles double-stringified JSON, `{items|results|data}` wrappers, and reuses connections by default.

**Files**
- `src/index.js` — exports `webSearchPrime(queryOrParams, options)`.
- `examples/run-web-search.js` — CLI example that loads `.env` and prints normalized results.

**Prerequisites**
- Node.js 18+.
- Install deps already listed in `package.json` (`@modelcontextprotocol/sdk`, `dotenv`).

**Environment Setup**
- Set `BIGMODEL_API_KEY` in your shell or add it to `.env` at repo root.
- Utilities never call `dotenv` automatically; every script should do `require('dotenv').config()` first.

**Run the Example**
- `node examples/run-web-search.js "你的查询"`
- Without args it defaults to `福建舰正式服役的外媒报道`.
- Output prints `- title` + URL + optional summary snippet.

**webSearchPrime Usage**
- `const { webSearchPrime } = require('web-search-zaimcp')`
- Accepts either a string (`'query'`) or full MCP params object.
- Supported params mirror BigModel’s tool: `search_query`, `count` (1-50), `content_size`, `location`, `search_domain_filter`, `search_recency_filter`.
- `options` (all optional):
  - `apiKey` (defaults to `process.env.BIGMODEL_API_KEY`).
  - `endpoint` (defaults to official WebSearch Prime MCP endpoint).
  - `reuseConnection` (default `true`; set `false` for isolated calls).

**Return Value**
- `{ items, rawBlocks }` where each item includes `{ title, url, summary, icon, siteName, media, publishedAt, refer, raw }`.
- `rawBlocks` exposes the original MCP text blocks for debugging or custom parsing.

**Integrating With Agents**
- Wrap `webSearchPrime` inside any framework’s tool abstraction (LangChain StructuredTool, deepagents, LangGraph, custom orchestrators).
- Typical handler: `const { items } = await webSearchPrime(args); return JSON.stringify(items)`.

**Further Customization**
- Add your own timeout wrapper via `Promise.race` if needed.
- For TS users, consider adding a thin `.d.ts` file or porting the helper to `.ts` with types.
- Modify `_normalizeItems` in `src/index.js` if you need different fields.
