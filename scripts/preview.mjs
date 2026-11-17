import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'preview')
await mkdir(out, { recursive: true })
await build({ entryPoints: [path.join(root, 'preview/mount.js')], outfile: path.join(out, 'app.js'), bundle: true, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' }, banner: { js: '/* QA preview: ReactDOM and SDK shim are bundled for browser harness only. */' }, packages: 'bundle', alias: { '@hermes/plugin-sdk': path.join(root, 'preview/sdk-shim.js') } })
const server = createServer(async (req, res) => {
  const name = req.url === '/app.js' ? 'app.js' : req.url === '/react.js' ? 'react.js' : req.url === '/react-dom.js' ? 'react-dom.js' : 'index.html'
  try { const data = await readFile(path.join(out, name)); res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(data) }
  catch { res.writeHead(404); res.end('Not found') }
})
server.listen(8766, '127.0.0.1', () => console.log('Marketing UI QA preview: http://127.0.0.1:8766 (set service CORS origin to this URL)'))
