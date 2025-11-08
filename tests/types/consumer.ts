import pkg from 'web-search-zaimcp'

async function run() {
  const { webSearchPrime } = pkg
  const result = await webSearchPrime('hello world', { apiKey: 'dummy' })
  // basic shape checks (type-only due to noEmit)
  for (const item of result.items) {
    const url: string = item.url
    void url
  }
}

void run

