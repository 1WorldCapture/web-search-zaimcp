// Verifies runtime ESM named import resolution works without executing the tool.
import { webSearchPrime } from 'web-search-zaimcp'

if (typeof webSearchPrime !== 'function') {
  throw new Error('webSearchPrime is not a function via ESM named import')
}

console.log('[ok] ESM named import resolved: webSearchPrime()')

