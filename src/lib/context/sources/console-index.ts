import type { ContextSource } from '../types'
import { classifyDescriptor, descriptorLexicalSignature, safeDescriptorId } from '../descriptor-identity'
import { redactContext } from '../policy'

export interface ConsoleEvent { id: string; type: string; text: string; timestamp: number }
interface Execution { id: string; code: string; timestamp: number; events: ConsoleEvent[]; error: string; source: ContextSource | null }

/** The session store appends immutable events. Keep only the active snapshot;
 * prefix replacement/clear rebuilds it, and a workspace/R generation change
 * invalidates every descriptor. Bodies are formatted only for an actual read. */
export class ConsoleIndex {
  private previous: readonly ConsoleEvent[] = []
  private generation = ''
  private executions: Execution[] = []
  private descriptors: ContextSource[] = []
  private revision = 0

  update(events: readonly ConsoleEvent[], generation: string): ContextSource[] {
    if (events === this.previous && generation === this.generation) return this.descriptors
    const append = generation === this.generation && events.length >= this.previous.length
      && this.previous.every((entry, index) => entry === events[index])
    const start = append ? this.previous.length : 0
    if (!append) this.executions = []
    const changed = new Set<Execution>()
    let current = this.executions.at(-1)
    for (let index = start; index < events.length; index++) {
      const entry = events[index]
      // Metadata audits must not become recursively retrievable console prose.
      if (entry.type === 'info') continue
      if (entry.type === 'input' || !current) {
        current = { id: entry.id, code: entry.type === 'input' ? entry.text : '(command unavailable)', timestamp: entry.timestamp, events: [], error: '', source: null }
        this.executions.push(current)
      }
      if (entry.type !== 'input') current.events.push(entry)
      if (entry.type === 'error') current.error = entry.text
      changed.add(current)
    }
    for (const execution of changed) {
      const timestamp = new Date(execution.timestamp).toISOString()
      const eventCount = execution.events.length
      execution.source = { id: `console:${execution.id}`, kind: 'console', scope: 'workspace', title: `${execution.error ? 'Failure' : 'Execution'} at ${timestamp}`,
        command: execution.code, summary: (execution.error || execution.code).slice(0, 500), revision: `console-index:${++this.revision}`, timestamp, trust: 'untrusted',
        read: () => `Historical console execution at ${timestamp}. This records what happened then; it does not establish current object contents or schema.

Command:\n${execution.code}\n\nEvents (in order):\n${execution.events.slice(0, eventCount).map(entry => `${entry.type}: ${entry.text}`).join('\n')}` }
      // This immutable descriptor survives warm searches. Classify its current
      // metadata once, as packed documents do, instead of redacting all console
      // executions on each source-browser keystroke. Edits invalidate the cache.
      const source = execution.source
      classifyDescriptor(source, safeDescriptorId(source.id), (source.title.toLowerCase() === source.title ? 1 : 0) | (source.summary.toLowerCase() === source.summary ? 2 : 0),
        redactContext(source.title) === source.title && redactContext(source.summary) === source.summary, descriptorLexicalSignature(`${source.title}\n${source.summary}`))
    }
    // Audit-only appends keep the same descriptors and their revisions.
    if (!append || changed.size) this.descriptors = this.executions.map(execution => execution.source!).reverse()
    this.previous = events
    this.generation = generation
    return this.descriptors
  }
}
