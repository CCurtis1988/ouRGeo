import { describe, expect, it, vi } from 'vitest'
import { fetchLocalContextSize, resolveContextSize, EXECUTE_R_TOOL } from '@/lib/ai-client'
import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { buildContextContract } from './compiler'
import { initialToolExposure, compactToolSchemas } from './tools'
import { estimateTokens, inputCapacity } from './budget'
import { CONTEXT_TOOLS } from '@/lib/ai-context-tools'
import { UI_TOOLS } from '@/lib/ai-ui-tools'
import { DOC_TOOLS } from '@/lib/ai-doc-tools'

vi.mock('@/lib/ai-proxy-fetch', () => ({ proxyFetch: vi.fn() }))
describe('effective local context windows', () => {
  it('uses a conservative unloaded Ollama window and the requested runner’s actual allocation', async () => {
    vi.mocked(proxyFetch).mockResolvedValue(new Response(JSON.stringify({ models: [{ name: 'other', context_length: 131072 }, { name: 'qwen:latest', context_length: 4096 }] })))
    expect(resolveContextSize('ollama', 'qwen', {})).toBe(4096)
    expect(await fetchLocalContextSize('ollama', 'http://localhost:11434', '', 'qwen')).toBe(4096)
    expect(await fetchLocalContextSize('ollama', 'http://localhost:11434', '', 'missing')).toBeNull()
    expect(vi.mocked(proxyFetch).mock.calls.at(-1)?.[0]).toBe('http://localhost:11434/api/ps')
    expect(resolveContextSize('ollama', 'qwen', { ollama_ctx: '16384' })).toBe(16384)
  })
  it('fits essential rules, discovery, and the original simple request in a 4k window', () => {
    const tools = compactToolSchemas(initialToolExposure([...CONTEXT_TOOLS, ...UI_TOOLS, ...DOC_TOOLS, EXECUTE_R_TOOL], 4096, false))
    const payload = { system: buildContextContract({ autoPilot: false, terminal: false, web: false, viaMcp: false }), tools, messages: [{ role: 'user', content: 'Generate 100 rows of dummy data.' }] }
    expect(estimateTokens(payload)).toBeLessThan(inputCapacity(4096, 512))
    expect(tools.some(tool => tool.name === 'context_search')).toBe(true)
    expect(tools.some(tool => tool.name === 'run_ui_action')).toBe(true)
    expect(tools.some(tool => tool.name === 'execute_r_code')).toBe(true)
    expect(tools.some(tool => tool.name === 'read_document')).toBe(false)
  })
})
