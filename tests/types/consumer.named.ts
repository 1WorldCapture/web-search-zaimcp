import { webSearchPrime } from 'web-search-zaimcp'

async function run() {
  const result = await webSearchPrime('hello world', { apiKey: 'dummy' })
  const first = result.items[0]
  if (first) {
    const title: string = first.title
    void title
  }
}

void run

