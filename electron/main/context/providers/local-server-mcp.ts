import { object } from './shared'

const versions = ['2025-03-26', '2025-06-18', '2025-11-25']
const fields = { bank: { type: 'string' }, namespace: { type: 'string' } }
const tools = [
  { name: 'mnemosyne_stats', description: 'Inspect this authenticated bank.', inputSchema: { type: 'object', properties: { bank: fields.bank }, required: ['bank'] } },
  { name: 'mnemosyne_recall', description: 'Read bounded lexical matches in this bank.', inputSchema: { type: 'object', properties: { bank: fields.bank, query: { type: 'string', maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['bank', 'query'] } },
  { name: 'mnemosyne_get', description: 'Read one canonical source in this bank.', inputSchema: { type: 'object', properties: { bank: fields.bank, memory_id: { type: 'string' } }, required: ['bank', 'memory_id'] } },
  { name: 'ourgeo_mnemosyne_snapshot', description: 'Host snapshot protocol. Writes require a current protected outbox job.', inputSchema: { type: 'object', properties: { ...fields, operation: { enum: ['probe', 'read', 'search', 'replace'] }, sourceId: { type: 'string' }, query: { type: 'string', maxLength: 2000 }, limit: { type: 'integer', minimum: 1, maximum: 10 }, generation: { type: 'integer', minimum: 1 }, records: { type: 'array', maxItems: 10000 }, invocationId: { type: 'string', maxLength: 128 } }, required: ['bank', 'namespace', 'operation'] } },
]
export type LocalMcpPlan =
  | { kind: 'reply'; status: 200 | 202; body?: unknown }
  | { kind: 'operation'; payload: Record<string, unknown>; reply: (result: unknown) => unknown }

/** Stateless Streamable HTTP. Control messages disclose no memory and confer
 * no access. Only the already authenticated registration supplies the bank. */
export function localMcpPlan(input: unknown, namespace: string): LocalMcpPlan {
  const message = object(input)
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') throw new Error('POLICY_REFUSED')
  if (message.id === undefined) {
    if (!message.method.startsWith('notifications/')) throw new Error('POLICY_REFUSED')
    return { kind: 'reply', status: 202 }
  }
  if (!Number.isSafeInteger(message.id) && !(typeof message.id === 'string' && message.id.length <= 128)) throw new Error('POLICY_REFUSED')
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result })
  if (message.method === 'initialize') {
    const params = object(message.params)
    const protocolVersion = versions.includes(String(params.protocolVersion)) ? params.protocolVersion : versions.at(-1)
    return { kind: 'reply', status: 200, body: reply({ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'ourgeo-mnemosyne-lexical', version: '1' } }) }
  }
  if (message.method === 'ping') return { kind: 'reply', status: 200, body: reply({}) }
  if (message.method === 'tools/list') return { kind: 'reply', status: 200, body: reply({ tools }) }
  const unavailable = (): LocalMcpPlan => ({ kind: 'reply', status: 200, body: { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method or tool unavailable.' } } })
  if (message.method !== 'tools/call') return unavailable()
  const params = object(message.params), args = object(params.arguments)
  if (args.bank !== namespace) throw new Error('POLICY_REFUSED')
  let payload: Record<string, unknown>
  if (params.name === 'mnemosyne_stats') payload = { operation: 'probe', namespace }
  else if (params.name === 'mnemosyne_get') payload = { operation: 'read', namespace, sourceId: args.memory_id }
  else if (params.name === 'mnemosyne_recall') payload = { operation: 'search', namespace, query: args.query, limit: args.limit ?? 5 }
  else if (params.name === 'ourgeo_mnemosyne_snapshot') {
    if (args.namespace !== namespace || !['probe', 'read', 'search', 'replace'].includes(String(args.operation))) throw new Error('POLICY_REFUSED')
    payload = { namespace, operation: args.operation }
    for (const key of ['sourceId', 'query', 'limit', 'generation', 'records', 'invocationId']) if (Object.hasOwn(args, key)) payload[key] = args[key]
  } else return unavailable()
  return { kind: 'operation', payload, reply: result => {
    const data = object(result)
    let value: unknown = data
    if (params.name === 'mnemosyne_stats') value = { status: 'ok', bank: namespace }
    else if (params.name === 'mnemosyne_get') {
      if (!Array.isArray(data.evidence)) throw new Error('INVALID_RESPONSE')
      const row = data.evidence[0] ? object(data.evidence[0]) : null
      value = row ? { status: 'ok', memory: { id: row.id, content: row.text, revision: row.revision } } : { status: 'not_found' }
    } else if (params.name === 'mnemosyne_recall') {
      if (!Array.isArray(data.evidence)) throw new Error('INVALID_RESPONSE')
      value = { status: 'ok', bank: namespace, results: data.evidence.map(item => { const row = object(item); return { id: row.id, content: row.text, created_at: row.updatedAt } }) }
    }
    // A single JSON text block works across all negotiated versions and avoids
    // duplicating every memory body in structuredContent and text content.
    return reply({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false })
  } }
}

export function localMcpVersionSupported(version: string | string[] | undefined): boolean {
  return version === undefined || typeof version === 'string' && versions.includes(version)
}
