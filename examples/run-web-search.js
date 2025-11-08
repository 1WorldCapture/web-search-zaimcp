require('dotenv').config()
const { webSearchPrime } = require('../src')

;(async () => {
  const query = process.argv.slice(2).join(' ') || '福建舰正式服役的外媒报道'
  const { items } = await webSearchPrime({
    search_query: query,
    count: 10,
    content_size: 'medium',
    location: 'us',
  })
  for (const it of items) {
    console.log(`- ${it.title}`)
    console.log(`  ${it.url}`)
    if (it.summary) console.log(`  ${String(it.summary).slice(0, 120)}...`)
  }
})().catch((err) => {
  console.error(err)
  process.exit(1)
})

