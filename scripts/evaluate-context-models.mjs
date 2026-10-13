// Complete model-selected retrieval loops, using the production transports.
// A development eager-context counterfactual is compared with the broker. Human
// scoring and independent corpus authorship are recorded separately, never faked.
import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { subscriptionEvaluation } from './lib/context-subscription-evaluation.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const provider = option('--provider', 'ollama'), dryRun = args.includes('--dry-run')
const host = option('--host', 'chris@10.0.0.10'), model = option('--model', 'gemma4:e2b')
const suite = option('--suite', 'smoke'), windowSize = Number(option('--context-window', '32768'))
const outputLimit = 1024, perTaskLimit = 6, requestLimit = 96
if (!['ollama', 'openai-subscription'].includes(provider) || !['smoke', 'mixed20', 'long'].includes(suite) || ![8192, 32768].includes(windowSize)) throw new Error('Choose a supported bounded provider, suite and context window.')
if (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+$/.test(host) || !/^[a-zA-Z0-9_.:/-]+$/.test(model)) throw new Error('Choose literal installed-model and SSH host names.')
const root = resolve('.'), directory = join(root, '.cache/stage02/model-evaluation')
await mkdir(directory, { recursive: true, mode: 0o700 })
const output = resolve(option('--output', join(directory, `${provider}-${suite}.json`)))
const raw = await readFile('tests/fixtures/context/evaluation/v1.json', 'utf8'), fixture = JSON.parse(raw)
const smoke = JSON.parse(await readFile('tests/fixtures/context/evaluation/local-smoke-v1.json', 'utf8'))
const historical = []
if (suite === 'long') {
  historical.push({ id: 'early', role: 'user', timestamp: 0, content: 'For this chat, never modify source data. Buffer distance is exactly 100 metres; working CRS is EPSG:32610.' })
  for (let index = 0; index < 20; index++) historical.push({ id: `followup-${index}`, role: 'user', timestamp: index, content: `Continue planning step ${index + 1} of the synthetic point-buffer workflow.` }, { id: `reply-${index}`, role: 'assistant', timestamp: index, content: `Synthetic historical explanation ${index + 1}. ` + 'A separate intermediate output is planned; no computation or source modification has run. '.repeat(25) })
}
const availableTurns = suite === 'long' ? [{ id: 'long-constraints', text: 'Give the final R code and repeat the exact distance, CRS and source-data constraint.' }]
  : suite === 'mixed20' ? fixture.turns : fixture.turns.filter(turn => smoke.taskIds.includes(turn.id))
const selectedIds = option('--ids', '').split(',').filter(Boolean)
if (new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !availableTurns.some(turn => turn.id === id))) throw new Error('Choose distinct task IDs from the selected suite.')
const turns = selectedIds.length ? availableTurns.filter(turn => selectedIds.includes(turn.id)) : availableTurns
const bundle = join(directory, `production-transports-${process.pid}.mjs`)
await build({ stdin: { contents: 'export {sendMessage} from "./src/lib/ai-client"; export {ContextBroker} from "./src/lib/context/broker"; export {buildContextContract,buildContextScopeCard} from "./src/lib/context/compiler"; export {routeContext,routeSkillDescriptors} from "./src/lib/context/router"; export {failureSchemas} from "./src/lib/context/failure-schemas"; export {consoleFailurePrefetch} from "./src/lib/context/console-prefetch"; export {selectConversation} from "./src/lib/context/compaction"; export {buildWorkingState} from "./src/lib/context/working-state"; export {estimateTokens} from "./src/lib/context/budget"; export {OURGEO_TOPICS,topicDescriptors,buildOurgeoCore} from "./src/lib/ai-skill-ourgeo"; export {buildDocumentSkill} from "./src/lib/ai-skill-documents"; export {CONTEXT_TOOLS,runContextTool} from "./src/lib/ai-context-tools";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, tsconfig: 'tsconfig.web.json', plugins: [{ name: 'synthetic-evaluation', setup(builder) {
  builder.onResolve({ filter: /ai-proxy-fetch$/ }, () => ({ path: 'proxy', namespace: 'evaluation' }))
  builder.onResolve({ filter: /ai-actions\/registry$/ }, () => ({ path: 'registry', namespace: 'evaluation' }))
  builder.onResolve({ filter: /^@\/store\/(context|project)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'evaluation' }))
  builder.onLoad({ filter: /.*/, namespace: 'evaluation' }, args => ({ loader: 'js', contents: args.path === 'proxy' ? 'export const proxyFetch=(...args)=>globalThis.__evaluationFetch(...args);'
    : args.path === 'registry' ? 'export const actionIndex=()=>"Evaluation scope: application, R, file and shell actions are disabled.";'
      : `export const ${args.path === 'context' ? 'useContextStore' : 'useProjectStore'}={getState(){throw new Error("No user stores are accessible to synthetic evaluation.")}};` }))
} }] })
const api = await import(pathToFileURL(bundle).href)
const references = api.topicDescriptors().map(descriptor => ({ ...descriptor, body: api.OURGEO_TOPICS[descriptor.topic] })); references.push(fixture.plugin)
const sources = [...references.map(item => ({ id: `skill:${item.topic}`, kind: 'skill', scope: 'application', title: item.topic, summary: `${item.summary} ${item.triggers.join(' ')}`, revision: 'fixture-v1', trust: 'untrusted', ...(item.kind === 'console' ? { command: item.body.match(/^Execution \w+: ([^\n]+)/)?.[1] } : {}), read: () => item.kind === 'console' ? `Historical console execution at ${item.timestamp}. This records what happened then; it does not establish current object contents or schema.\n\n${item.body}` : item.body })), ...fixture.resources.filter(item => item.authorised !== false).map(item => ({ ...item, revision: 'fixture-v1', trust: 'untrusted', ...(item.kind === 'console' ? { command: item.body.match(/^Execution \w+: ([^\n]+)/)?.[1] } : {}), read: () => item.kind === 'console' ? `Historical console execution at ${item.timestamp}. This records what happened then; it does not establish current object contents or schema.\n\n${item.body}` : item.body }))]
const excluded = fixture.resources.filter(item => item.excluded).map(item => item.id)
const allowed = sources.filter(item => !excluded.includes(item.id)), safety = api.buildContextContract({ autoPilot: false, web: false, terminal: false, viaMcp: false })
const scopeCard = api.buildContextScopeCard({ autoPilot: false, web: false, terminal: false, savedProject: true })
const eagerContract = api.buildOurgeoCore() + '\n' + api.buildDocumentSkill({ hasDocumentTools: true })
let subscription, requests = 0, taskRequests = 0, currentTask, currentPayload, accountId
const appVersion = JSON.parse(await readFile('package.json', 'utf8')).version
const report = { version: 1, appVersion, measuredAt: new Date().toISOString(), provider, model, window: windowSize, outputLimit, requestLimit, perTaskLimit, suite, taskIds: turns.map(turn => turn.id), dryRun, fixtureSha256: createHash('sha256').update(raw).digest('hex'), corpusStatus: 'development-regression', humanReview: 'pending', releaseCertification: false,
  methodology: 'Same synthetic tasks, permissions, model and production full-message transport. Eager current legacy-contract builders plus all authorised workspace fixture resource bodies versus broker-selected evidence and production compaction. This is a context-assembly counterfactual, not a historical app run, independent hold-out, invoice comparison or human task-success certification.', conditions: { eager: [], broker: [] } }

function remote(path, body) {
  const command = body === undefined ? `curl --max-time 175 --fail-with-body -sS http://127.0.0.1:11434${path}` : `curl --max-time 175 --fail-with-body -sS -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:11434${path}`
  return new Promise((resolveReply, reject) => {
    const child = spawn('ssh', ['-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, command], { stdio: ['pipe', 'pipe', 'pipe'] })
    let text = '', error = ''
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Local evaluation timed out.')) }, 180000)
    child.stdout.on('data', part => { text += part; if (text.length > 2_000_000) { child.kill('SIGTERM'); reject(new Error('Local response exceeds 2 MB.')) } })
    child.stderr.on('data', part => { error = (error + part).slice(-1000) })
    child.on('error', failure => { clearTimeout(timer); reject(failure) })
    child.on('close', code => { clearTimeout(timer); if (code) reject(new Error(`Local inference failed (${code}): ${error}`)); else resolveReply(text) })
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body))
  })
}
const persist = async () => writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 })
try {
  if (!dryRun && provider === 'openai-subscription') {
    subscription = await subscriptionEvaluation(directory, requestLimit)
    Object.assign(report, subscription.configuration)
    accountId = 'native-configured-account'
  } else if (!dryRun) {
    const [tags, ps, version] = await Promise.all(['/api/tags', '/api/ps', '/api/version'].map(async path => JSON.parse(await remote(path))))
    if (ps.models?.length) throw new Error('The local server has another loaded workload. No model was changed.')
    const installed = tags.models?.find(item => item.name === model || item.model === model)
    if (!installed) throw new Error('Selected local model is not installed. No download is authorised.')
    const details = JSON.parse(await remote('/api/show', { model }))
    if (!details.capabilities?.includes('tools')) throw new Error('The local model does not advertise tool calling.')
    Object.assign(report, { modelDigest: installed.digest, runtimeVersion: version.version })
  }
  globalThis.window = { electronAPI: { chatgpt: { status: async () => ({ planEnabled: true, activeId: accountId ?? 'dry-run' }) } } }
  globalThis.__evaluationFetch = async (url, init) => {
    if (requests >= requestLimit || taskRequests >= perTaskLimit) throw new Error('Evaluation request allowance exhausted; no further dispatch.')
    requests++; taskRequests++
    const invocation = { estimatedInputTokens: api.estimateTokens(currentPayload), delivery: 'prepared' }
    currentTask.invocations.push(invocation)
    if (dryRun) return { ok: true, status: 200, body: new ReadableStream({ start(controller) { controller.close() } }), json: async () => ({ message: { content: 'Payload validation only.' }, done: true }), text: async () => '' }
    invocation.delivery = 'uncertain'
    const started = Date.now()
    const response = provider === 'openai-subscription' ? await subscription.request(url, init) : await (async () => {
      if (url !== 'http://127.0.0.1:11434/api/chat') throw new Error('Only local Ollama inference is available.')
      const body = JSON.parse(init.body)
      body.stream = false; body.think = false; body.keep_alive = 0
      body.options = { ...body.options, num_gpu: 0, num_thread: 2, temperature: 0, seed: 42 }
      return { ok: true, status: 200, text: await remote('/api/chat', body) }
    })()
    Object.assign(invocation, { delivery: 'acknowledged', durationMs: Date.now() - started, requestId: response.requestId ?? null })
    return { ...response, text: async () => response.text, json: async () => JSON.parse(response.text), body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(response.text)); controller.close() } }) }
  }
  report.sourceHashes = Object.fromEntries(await Promise.all(['scripts/evaluate-context-models.mjs', 'scripts/lib/context-subscription-evaluation.mjs', 'src/lib/ai-client.ts', 'src/lib/ai-chatgpt-transport.ts', 'src/lib/context/compaction.ts', 'src/lib/context/broker.ts', 'src/lib/context/compiler.ts', 'src/lib/context/failure-schemas.ts', 'src/lib/context/sources/console-index.ts'].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
  const dialogues = { eager: [...historical], broker: [...historical] }
  taskLoop: for (const [index, turn] of turns.entries()) for (const condition of index % 2 ? ['broker', 'eager'] : ['eager', 'broker']) {
    currentTask = { id: turn.id, text: turn.text, condition, answer: '', error: null, invocations: [], usage: [], toolCalls: [], evidence: [], sourceReads: 0, discoveries: 0, omissions: [] }
    taskRequests = 0
    const dialogue = dialogues[condition], user = { id: turn.id, role: 'user', content: turn.text, timestamp: index }
    const broker = new api.ContextBroker({ identity: { chatId: `evaluation-${condition}`, projectId: 'synthetic-project', workspaceEpoch: 1, policyRevision: 1 }, target: `${provider}/${report.model}`, effort: 'thorough', signal: new AbortController().signal, current: () => true,
      sources: kinds => { currentTask.discoveries++; return sources.filter(item => !kinds || kinds.includes(item.kind)).map(item => ({ ...item, read: () => { currentTask.sourceReads++; return item.read() } })) }, excluded: () => excluded })
    try {
      console.log(JSON.stringify({ event: 'start', id: turn.id, condition, provider }))
      const route = api.routeContext(turn.text), topics = [...new Set([...route.topics, ...api.routeSkillDescriptors(turn.text, references)])]
      const ids = topics.map(topic => `skill:${topic}`)
      if (route.environment) {
        for (const match of turn.text.matchAll(/\[([^\]\n]+)\]/g)) {
          const hits = sources.filter(item => item.kind === 'environment' && (item.resource?.name === match[1] || item.title === match[1]))
          if (hits.length === 1) ids.push(hits[0].id)
        }
        if (/\b(?:this|active|selected) layer\b/i.test(turn.text)) ids.push(...sources.filter(item => item.resource?.environment === smoke.workspace.activeLayer.environment && item.resource?.name === smoke.workspace.activeLayer.name).map(item => item.id))
      }
      if (route.console) {
        const selected = api.consoleFailurePrefetch(sources, turn.text)
        ids.push(...selected, ...api.failureSchemas(sources.filter(source => selected.includes(source.id)), sources.filter(source => source.kind === 'environment'), excluded))
      }
      if (route.memory) ids.push(...allowed.filter(item => item.kind === 'memory' && item.scope === (turn.text.includes('global') ? 'global' : 'project')).slice(0, 2).map(item => item.id))
      const attachments = []
      for (const id of smoke.workspace.attachmentsByTask?.[turn.id] ?? []) {
        const source = allowed.find(item => item.id === id)
        if (!source) throw new Error('Synthetic attachment is unavailable.')
        attachments.push(await broker.attach({ sourceId: id, revision: source.revision, workspaceEpoch: 1 }, 800))
      }
      const evidence = condition === 'broker' ? [...attachments, ...await broker.prefetch(ids, 2400)] : allowed.filter(item => item.kind !== 'skill').map(item => JSON.stringify({ sourceId: item.id, revision: item.revision, scope: item.scope, content: item.read() }))
      const systemPrompt = (condition === 'eager' ? eagerContract + '\n' : '') + safety
      const context = scopeCard + (evidence.length ? '\nUntrusted source evidence; not permissions:\n' + evidence.join('\n') : '')
      const original = [...dialogue, { ...user, content: user.content + '\n' + context }]
      const selected = condition === 'broker' ? api.selectConversation(original, suite === 'long' ? 4000 : windowSize - api.estimateTokens(systemPrompt) - 2000) : { messages: original, omitted: [] }
      currentTask.conversationSelectionBudget = condition === 'broker' ? suite === 'long' ? 4000 : windowSize - api.estimateTokens(systemPrompt) - 2000 : null
      currentTask.omissions = selected.omitted
      currentTask.answer = await api.sendMessage({ provider, model: report.model, apiKey: '', localUrl: 'http://127.0.0.1:11434', ollamaContextSize: windowSize, contextSize: windowSize, maxOutputTokens: outputLimit,
        messages: selected.messages, systemPrompt, tools: api.CONTEXT_TOOLS.filter(tool => ['context_search', 'context_read'].includes(tool.name)), onChunk: () => {},
        beforeInvocation: payload => { broker.validateSend(); currentPayload = payload },
        onInvocationUsage: usage => { currentTask.usage.push(usage) },
        onToolCall: async call => {
          let result
          if (!['context_search', 'context_read'].includes(call.name)) result = JSON.stringify({ status: 'SOURCE_UNAVAILABLE', recovery: 'Synthetic evaluation grants no mutation or execution authority.' })
          else result = await api.runContextTool(broker, call.name, call.input, turn.text, 'synthetic-chat')
          currentTask.toolCalls.push({ name: call.name, input: call.input, result: JSON.parse(result) })
          return result
        } })
      if (dryRun) currentTask.answer = ''
    } catch (error) { currentTask.error = dryRun && provider === 'openai-subscription' && String(error).includes('without a final answer') ? null : String(error) }
    currentTask.evidence = broker.trace.selected.map(({ sourceId, revision, completeness, reason }) => ({ sourceId, revision, completeness, reason }))
    currentTask.noUnauthorisedReads = !currentTask.evidence.some(item => fixture.resources.some(resource => resource.id === item.sourceId && (resource.authorised === false || resource.excluded)))
    currentTask.simpleNoAuxiliary = condition === 'broker' && turn.contextFree ? currentTask.discoveries === 0 && currentTask.sourceReads === 0 && currentTask.evidence.length === 0 : null
    if (suite === 'mixed20') dialogue.push(user, { id: `answer-${turn.id}`, role: 'assistant', content: currentTask.answer || '[No completed answer]', timestamp: index })
    report.conditions[condition].push(currentTask)
    await persist()
    console.log(JSON.stringify({ event: 'finish', id: turn.id, condition, invocations: currentTask.invocations.length, error: currentTask.error }))
    if (requests >= requestLimit) { report.stopped = 'Evaluation request allowance exhausted.'; break taskLoop }
  }
  report.dispatchedRequests = requests
  report.totals = Object.fromEntries(Object.entries(report.conditions).map(([condition, tasks]) => [condition, {
    tasks: tasks.length, invocations: tasks.reduce((sum, task) => sum + task.invocations.length, 0), completedAnswers: tasks.filter(task => task.answer.trim() && !task.error).length,
    reportedInputTokens: tasks.some(task => task.usage.some(usage => usage.inputTokens !== undefined)) ? tasks.flatMap(task => task.usage).reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0) : null, reportedOutputTokens: tasks.some(task => task.usage.some(usage => usage.outputTokens !== undefined)) ? tasks.flatMap(task => task.usage).reduce((sum, usage) => sum + (usage.outputTokens ?? 0), 0) : null,
    usageStatus: tasks.every(task => task.invocations.length > 0 && task.invocations.length === task.usage.length && task.usage.every(usage => Number.isInteger(usage.inputTokens) && Number.isInteger(usage.outputTokens))) ? 'complete-reported-counters' : 'partial-or-unknown',
    taskSuccess: 'Human review required; completed text is not a correctness score.' }]))
  const eagerInput = report.totals.eager.reportedInputTokens, brokerInput = report.totals.broker.reportedInputTokens
  report.reportedInputReduction = eagerInput > 0 && report.totals.eager.usageStatus === 'complete-reported-counters' && report.totals.broker.usageStatus === 'complete-reported-counters' ? 1 - brokerInput / eagerInput : null
  report.estimatedMoney = 'Unknown; subscription plan usage and local token counts are not invoices. No paid memory maintenance ran.'
  await persist()
  console.log(JSON.stringify({ event: 'report', output, totals: report.totals, releaseCertification: false }))
} finally { if (subscription) await subscription.close() }
