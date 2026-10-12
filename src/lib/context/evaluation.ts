import { ContextBroker } from './broker'
import { assertInvocationBudget, estimateTokens, inputCapacity } from './budget'
import { buildContextContract, buildContextScopeCard } from './compiler'
import { routeContext, routeSkillDescriptors } from './router'
import type { ContextKind, ContextSource } from './types'

interface SearchFixture { query: string; kinds: ContextKind[]; scope?: string }
interface TurnFixture { id: string; text: string; contextFree?: boolean; skill?: string; search?: SearchFixture; expected?: string[] }
export interface EvaluationFixture {
  version: number
  id: string
  resources: { id: string; kind: ContextKind; scope: ContextSource['scope']; title: string; summary: string; body: string; resource?: ContextSource['resource']; timestamp?: string; authorised?: boolean; excluded?: boolean }[]
  plugin: { topic: string; summary: string; triggers: string[]; exclusions: string[]; body: string }
  turns: TurnFixture[]
  heldOutSkills: { text: string; skill: string }[]
}
export interface EvaluationReference { topic: string; summary: string; body: string; triggers: string[]; exclusions: string[] }

/** Offline evaluation keeps retrieval omissions visible. A scripted assistant
 * cannot establish answer correctness, provider tokenisation or task success.
 * Every scheduled follow-up is nevertheless charged in the token comparison. */
export async function evaluateContext(fixture: EvaluationFixture, references: EvaluationReference[], options: { schemas: unknown; legacyContract: string; window?: number }) {
  const window = options.window ?? 32000
  const sources: ContextSource[] = [
    ...references.map(reference => ({ id: `skill:${reference.topic}`, kind: 'skill' as const, scope: 'application' as const, title: reference.topic, summary: `${reference.summary} ${reference.triggers.join(' ')}`, revision: 'fixture-v1', trust: 'untrusted' as const, read: () => reference.body })),
    ...fixture.resources.filter(resource => resource.authorised !== false).map(resource => ({ ...resource, revision: 'fixture-v1', trust: 'untrusted' as const, read: () => resource.body })),
  ]
  const excluded = fixture.resources.filter(resource => resource.excluded).map(resource => resource.id)
  const descriptors = references.map(({ topic, triggers, exclusions }) => ({ topic, triggers, exclusions }))
  const contract = buildContextContract({ autoPilot: false, web: false, terminal: false, viaMcp: false })
  const scope = buildContextScopeCard({ autoPilot: false, web: false, terminal: false, savedProject: true })
  const legacyAuxiliary = sources.filter(source => source.kind !== 'skill' && !excluded.includes(source.id)).map(({ title, summary }) => `${title}: ${summary}`).join('\n')
  const dialogue: { role: string; content: string }[] = []
  const turns = []
  for (const turn of fixture.turns) {
    let discoveries = 0, fetches = 0, providerCalls = 0
    const broker = new ContextBroker({ identity: { chatId: 'synthetic-chat', projectId: 'synthetic-project', workspaceEpoch: 1, policyRevision: 1 }, target: 'offline/scripted-full-message', effort: 'balanced', signal: new AbortController().signal, current: () => true,
      sources: kinds => { discoveries++; return sources.filter(source => !kinds || kinds.includes(source.kind)).map(source => ({ ...source, read: () => { fetches++; return source.read() } })) }, excluded: () => excluded,
      recall: async () => { providerCalls++; throw new Error('Offline evaluation must not call a memory provider.') } })
    dialogue.push({ role: 'user', content: turn.text })
    const route = routeContext(turn.text), topics = [...new Set([...route.topics, ...routeSkillDescriptors(turn.text, descriptors)])]
    const prefetch = await broker.prefetch(topics.map(topic => `skill:${topic}`))
    const messages: unknown[] = [...dialogue, ...prefetch.map(content => ({ role: 'user', content }))]
    const invocations: { phase: string; estimatedInputTokens: number; estimatedNonDialogueTokens: number; legacyCounterfactualTokens: number; legacyOverWindow: boolean }[] = []
    const invoke = (phase: string) => {
      const payload = { model: 'fixture/no-model', tools: options.schemas, messages: [{ role: 'system', content: `${contract}\n${scope}` }, ...messages], max_tokens: 4000 }
      const tokens = assertInvocationBudget(payload, window)
      // Compare the same scripted calls/dialogue. Legacy is a deterministic
      // counterfactual built from its real contract and fixture descriptors,
      // never a second paid model call or an actual measured quality baseline.
      const legacy = estimateTokens({ model: 'fixture/no-model', tools: options.schemas, messages: [{ role: 'system', content: `${options.legacyContract}\n${legacyAuxiliary}` }, ...messages], max_tokens: 4000 })
      invocations.push({ phase, estimatedInputTokens: tokens, estimatedNonDialogueTokens: tokens - estimateTokens(dialogue), legacyCounterfactualTokens: legacy, legacyOverWindow: legacy > inputCapacity(window) })
      broker.recordInvocation(tokens, window, payload)
    }
    invoke('initial')
    let hitIds: string[] = [], relevantHits = 0
    if (turn.search) {
      const searched = broker.search(turn.search as unknown as Record<string, unknown>)
      const result = JSON.parse(searched) as { results: { ref: string }[] }
      hitIds = (result.results ?? []).map(hit => broker.trace.selected.find(evidence => evidence.ref === hit.ref)!.sourceId)
      relevantHits = hitIds.filter(id => turn.expected?.includes(id)).length
      messages.push({ role: 'assistant', tool_calls: [{ id: 'search', type: 'function', function: { name: 'context_search', arguments: JSON.stringify(turn.search) } }] }, { role: 'tool', tool_call_id: 'search', content: searched })
      invoke('after-search')
      // Selection is scripted from expected IDs and explicitly labelled. It
      // tests wire accounting/freshness, not a model's ability to pick a hit.
      const hit = result.results?.find(result => turn.expected?.includes(broker.trace.selected.find(evidence => evidence.ref === result.ref)!.sourceId))
      if (hit) {
        const read = await broker.read({ ref: hit.ref })
        messages.push({ role: 'assistant', tool_calls: [{ id: 'read', type: 'function', function: { name: 'context_read', arguments: JSON.stringify({ ref: hit.ref }) } }] }, { role: 'tool', tool_call_id: 'read', content: read })
        invoke('after-read')
      }
    }
    broker.finish(true)
    turns.push({ id: turn.id, text: turn.text, contextFree: Boolean(turn.contextFree), routeTopics: topics, requiredSkillPrefetched: turn.skill ? topics.includes(turn.skill) : null, hitIds, expectedIds: turn.expected ?? [], relevantHits,
      recallAt5: turn.expected?.length ? relevantHits / turn.expected.length : null, precisionAt5: hitIds.length ? relevantHits / hitIds.length : turn.expected?.length ? 0 : 1,
      sourceDiscoveries: discoveries, contentFetches: fetches, providerCalls, selectedAuxiliarySources: broker.trace.selected.length, retrievalCalls: broker.trace.retrievalCalls, returnedTokens: broker.trace.returnedTokens, invocations })
    dialogue.push({ role: 'assistant', content: `Scripted completion ${turn.id}; no model answer or analytical result generated.` })
  }
  const heldOut = []
  for (const item of fixture.heldOutSkills) {
    const routed = [...new Set([...routeContext(item.text).topics, ...routeSkillDescriptors(item.text, descriptors)])]
    const broker = new ContextBroker({ identity: { chatId: 'heldout', projectId: null, workspaceEpoch: 1, policyRevision: 1 }, target: 'offline/no-model', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: kinds => sources.filter(source => !kinds || kinds.includes(source.kind)), excluded: () => excluded })
    const result = JSON.parse(broker.search({ query: item.text, kinds: ['skill'] })) as { results: { ref: string }[] }
    const found = (result.results ?? []).some(hit => broker.trace.selected.find(evidence => evidence.ref === hit.ref)?.sourceId === `skill:${item.skill}`)
    heldOut.push({ ...item, prefetched: routed.includes(item.skill), originalQuerySearchAt5: found, withinTwoSteps: routed.includes(item.skill) || found })
  }
  const invocations = turns.flatMap(turn => turn.invocations)
  const inputTokens = invocations.reduce((sum, item) => sum + item.estimatedInputTokens, 0), legacyTokens = invocations.reduce((sum, item) => sum + item.legacyCounterfactualTokens, 0)
  const retrieval = turns.filter(turn => turn.expectedIds.length)
  const byKind = Object.fromEntries([...new Set(retrieval.map(turn => turn.expectedIds[0].split(':')[0]))].map(kind => {
    const cases = retrieval.filter(turn => turn.expectedIds[0].startsWith(`${kind}:`))
    return [kind, { questions: cases.length, recallAt5: cases.reduce((sum, turn) => sum + (turn.recallAt5 ?? 0), 0) / cases.length, precisionAt5: cases.reduce((sum, turn) => sum + turn.precisionAt5, 0) / cases.length }]
  }))
  const simple = turns.filter(turn => turn.contextFree).map(turn => ({ id: turn.id, estimatedInputTokens: turn.invocations[0].estimatedInputTokens, estimatedNonDialogueTokens: turn.invocations[0].estimatedNonDialogueTokens, estimatedLegacyCounterfactualTokens: turn.invocations[0].legacyCounterfactualTokens, auxiliarySources: turn.selectedAuxiliarySources }))
  return { fixtureVersion: fixture.version, fixtureId: fixture.id, methodology: 'Deterministic scripted OpenAI-shaped full-message inference envelopes; actual broker/router/reference bodies; conservative estimated tokens, not tokenizer/billing/model quality.', window,
    gates: { contextFree: turns.filter(turn => turn.contextFree).every(turn => !turn.contentFetches && !turn.providerCalls && !turn.sourceDiscoveries && !turn.selectedAuxiliarySources), authorisedFixtureBoundary: turns.every(turn => !turn.hitIds.some(id => fixture.resources.some(resource => resource.id === id && (resource.authorised === false || resource.excluded)))), tokenWindow: true,
      recallAt5: retrieval.reduce((sum, turn) => sum + (turn.recallAt5 ?? 0), 0) / retrieval.length, precisionAt5: retrieval.reduce((sum, turn) => sum + turn.precisionAt5, 0) / retrieval.length,
      skillDiscoveryWithinTwoSteps: heldOut.filter(item => item.withinTwoSteps).length / heldOut.length },
    totals: { turns: turns.length, invocations: invocations.length, estimatedInputTokens: inputTokens, estimatedLegacyCounterfactualInputTokens: legacyTokens, estimatedInputReduction: 1 - inputTokens / legacyTokens, legacyOverWindowInvocations: invocations.filter(item => item.legacyOverWindow).length, retrievalCalls: turns.reduce((sum, turn) => sum + turn.retrievalCalls, 0), estimatedReturnedRetrievalTokens: turns.reduce((sum, turn) => sum + turn.returnedTokens, 0), backgroundOperations: 0, monetaryCost: 'No billable operations issued; savings in money not measured.' },
    sourceRetrievalByKind: byKind, simpleTurnAccounting: simple, staleHitRate: { status: 'Static revisions only; mutation/race freshness covered by separate tests.' },
    modelTaskSuccess: { status: 'not-measured', transportCoverage: 'Scripted full-message only; no small local/hosted/retained model task runs.' }, humanReview: { status: 'not-performed', usability: 'not-performed' }, turns, heldOutSkills: heldOut }
}
