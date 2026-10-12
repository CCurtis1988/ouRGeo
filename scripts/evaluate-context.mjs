import { build } from 'esbuild'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

// Only synthetic fixture text is read. The registry/store stubs prevent GUI
// imports; no actions, project/profile stores or model transports execute.
const root = resolve(import.meta.dirname, '..'), directory = join(root, '.cache', 'context-evaluation')
await mkdir(directory, { recursive: true })
const filename = join(root, 'tests/fixtures/context/evaluation/v1.json'), raw = await readFile(filename, 'utf8'), fixture = JSON.parse(raw)
const bundle = join(directory, 'evaluate.mjs')
await build({ stdin: { contents: 'export { evaluateContext } from "./src/lib/context/evaluation"; export { OURGEO_TOPICS, topicDescriptors, buildOurgeoCore } from "./src/lib/ai-skill-ourgeo"; export { buildDocumentSkill } from "./src/lib/ai-skill-documents"; export { CONTEXT_TOOLS } from "./src/lib/ai-context-tools";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, tsconfig: join(root, 'tsconfig.web.json'),
  plugins: [{ name: 'offline-reference-boundary', setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/ai-actions\/registry$/ }, () => ({ path: 'registry', namespace: 'fixture' }))
    builder.onResolve({ filter: /^@\/store\/(context|project)$/ }, args => ({ path: args.path.endsWith('context') ? 'context' : 'project', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'registry'
      ? 'export const actionIndex = () => "[Action registry omitted from this conservative legacy counterfactual.]";'
      : `export const ${args.path === 'context' ? 'useContextStore' : 'useProjectStore'} = { getState() { throw new Error("Synthetic evaluation cannot access user stores.") } };`, loader: 'js' }))
  } }] })
const { evaluateContext, OURGEO_TOPICS, topicDescriptors, buildOurgeoCore, buildDocumentSkill, CONTEXT_TOOLS } = await import(pathToFileURL(bundle).href)
const references = topicDescriptors().map(descriptor => ({ ...descriptor, body: descriptor.topic === 'documents' ? buildDocumentSkill({ hasDocumentTools: true }) + '\n' + OURGEO_TOPICS[descriptor.topic] : OURGEO_TOPICS[descriptor.topic] }))
references.push({ ...fixture.plugin })
const report = await evaluateContext(fixture, references, { schemas: CONTEXT_TOOLS.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })), legacyContract: buildOurgeoCore() + '\n' + buildDocumentSkill({ hasDocumentTools: true }) })
const sourceHashes = Object.fromEntries(await Promise.all(['src/lib/context/evaluation.ts', 'src/lib/context/broker.ts', 'src/lib/context/router.ts', 'src/lib/context/rank.ts', 'src/lib/context/budget.ts', 'src/lib/context/compiler.ts', 'src/lib/ai-context-tools.ts', 'src/lib/ai-skill-ourgeo.ts', 'src/lib/ai-skill-documents.ts'].map(async filename => [filename, createHash('sha256').update(await readFile(join(root, filename))).digest('hex')])))
Object.assign(report, { sourceHashes, measuredAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, skillCorpusStatus: 'Development regression corpus after disclosed alias tuning; independent release hold-out still required.', fixtureSha256: createHash('sha256').update(raw).digest('hex'), referenceSha256: createHash('sha256').update(JSON.stringify(references)).digest('hex'), legacyLimitations: 'Real legacy application/document contracts, fixture resource descriptors, same context tool schemas and scheduled retrieval calls. Action index, full legacy tools and console bodies are omitted, so this is a conservative synthetic counterfactual, not a legacy app task run.' })
await writeFile('/tmp/ourgeo-context-evaluation.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, turns: undefined, heldOutSkills: undefined }))
if (!report.gates.contextFree || !report.gates.authorisedFixtureBoundary || !report.gates.tokenWindow) process.exitCode = 1
// Recall/quality targets are observations. Leave missed held-out cases in the
// report instead of changing expectations until it produces a green claim.
