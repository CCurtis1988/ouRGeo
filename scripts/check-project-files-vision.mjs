// Explicit synthetic-only qualification of the production Ollama transport.
// No user project, credential or external memory provider enters this run.
import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const endpoint = new URL(option('--url', 'http://127.0.0.1:11434'))
if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search) throw new Error('Choose a literal local Ollama endpoint without credentials.')
const model = option('--model', 'gemma4:e2b')
const directory = resolve('.cache/project-files-qualification')
await mkdir(directory, { recursive: true })
const bundle = join(directory, 'vision-transport.mjs')
await build({ stdin: { contents: 'export {sendMessage,imageCapability} from "./src/lib/ai-client";', resolveDir: resolve('.') }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, tsconfig: 'tsconfig.web.json', plugins: [{ name: 'synthetic-http', setup(builder) {
  builder.onResolve({ filter: /ai-proxy-fetch$/ }, () => ({ path: 'proxy', namespace: 'fixture' }))
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: 'export const proxyFetch=(...args)=>globalThis.__projectFilesQualificationFetch(...args);' }))
} }] })
const { sendMessage, imageCapability } = await import(pathToFileURL(bundle).href)
let requests = 0, imageRequests = 0
globalThis.__projectFilesQualificationFetch = async (url, init) => {
  const parsed = new URL(url)
  if (parsed.origin !== endpoint.origin || !['/api/show', '/api/chat'].includes(parsed.pathname) || ++requests > 3) throw new Error('Synthetic qualification request refused.')
  if (parsed.pathname === '/api/chat') {
    const body = JSON.parse(init.body)
    if (!body.messages.some(message => message.images?.length === 1 && !message.images[0].startsWith('data:'))) throw new Error('Actual image bytes were absent from the native image field.')
    imageRequests++
  }
  return fetch(url, init)
}
const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000)
try {
  if (await imageCapability('ollama', model, endpoint.href.replace(/\/$/, ''), undefined, controller.signal) !== 'supported') throw new Error('The selected model did not advertise vision capability.')
  const original = await readFile('tests/fixtures/project-files/visual-reference.png')
  const data = `data:image/png;base64,${original.toString('base64')}`
  const usage = []
  const answer = await sendMessage({ provider: 'ollama', model, apiKey: '', localUrl: endpoint.href.replace(/\/$/, ''), contextSize: 32768, ollamaContextSize: 32768, maxOutputTokens: 1024, systemPrompt: 'Describe only the supplied synthetic image accurately. Reply in one sentence.', messages: [{ id: 'synthetic-vision', role: 'user', content: 'Name the colour and shape on the left and on the right of the image.', timestamp: 1 }], imageEvidence: () => [{ ref: 'ctx_synthetic_image', sourceId: 'project-file:synthetic:figure', title: 'Synthetic shape fixture', revision: createHash('sha256').update(original).digest('hex'), width: 192, height: 128, complete: true, estimatedTokens: 8192, materialise: async () => data }], onChunk: () => undefined, onInvocationUsage: report => usage.push(report), signal: controller.signal })
  const correct = /red/i.test(answer) && /square/i.test(answer) && /blue/i.test(answer) && /circle/i.test(answer) && imageRequests === 1
  const report = { measuredAt: new Date().toISOString(), model, transport: 'production-native-ollama', capability: 'vision', fixtureSha256: createHash('sha256').update(original).digest('hex'), dimensions: [192, 128], expected: { left: 'red square', right: 'blue circle' }, answer, passed: correct, imageRequests, usage, scope: 'Synthetic image + production message assembly and transport; Electron IPC and user-interface acceptance are separate checks.' }
  await writeFile(join(directory, 'vision-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  if (!correct) process.exitCode = 1
} finally { clearTimeout(timer) }
