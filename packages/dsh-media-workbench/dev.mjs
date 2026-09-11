import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRuntime } from './runtime.mjs'

const host = '127.0.0.1'
const port = Number(process.env.MEDIA_PORT || 4317)
const runtime = createRuntime(resolve(process.env.MEDIA_DATA_DIR || 'doc/media-workbench-dev'))
await runtime.start()
const server = createServer(async (req, res) => {
  try {
    if (req.headers.host !== `${host}:${port}`) { res.writeHead(403); res.end('Forbidden host'); return }
    if (req.url === '/') { res.writeHead(302, { location: '/api/media-workbench/app' }); res.end(); return }
    const chunks = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) { res.writeHead(413); res.end(); return }; chunks.push(chunk) }
    const response = await runtime.handle(new Request(`http://${host}:${port}${req.url}`, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) }))
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) { res.writeHead(500); res.end(error.message) }
})
const timer = setInterval(() => runtime.tick().catch(console.error), 60000)
server.listen(port, host, () => console.log(`Content workbench: http://${host}:${port}/api/media-workbench/app`))
async function close() { clearInterval(timer); await runtime.dispose(); server.close(); }
process.on('SIGINT', close); process.on('SIGTERM', close)
