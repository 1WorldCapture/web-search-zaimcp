// ESM shim that re-exports from the CommonJS implementation.
// This enables `import { webSearchPrime } from 'web-search-zaimcp'` in ESM/TS.
import cjs from './index.js'

export const { webSearchPrime } = cjs
export default cjs

