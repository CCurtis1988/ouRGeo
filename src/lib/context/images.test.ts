import { describe, expect, it, vi } from 'vitest'
import { ollamaImageMessage, IMAGE_TOKEN_RESERVATION, type ContextImageEvidence } from './images'
import { estimateTokens } from './budget'
import { requestInvocation, imageCapability, type SendOptions } from '@/lib/ai-client'
import { projectFileCitation, rebindProjectFileReferences, parseProjectFileCitation } from '@/lib/project-file-citations'
const connection = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/ai-proxy-fetch', () => ({ proxyFetch: connection.request }))

const evidence = (): ContextImageEvidence => ({ ref: 'ctx_image', sourceId: 'project-file:p:f', revision: 'v1', title: 'Example', width: 800, height: 600, complete: false, estimatedTokens: IMAGE_TOKEN_RESERVATION, materialise: vi.fn(async () => 'data:image/png;base64,QUJD') })
describe('transient image dispatch', () => {
  it('uses the selected native Ollama vision model and distinguishes unknown from unsupported capability', async () => {
    connection.request.mockResolvedValue({ ok: true, json: async () => ({ capabilities: ['completion', 'vision'] }) })
    expect(await imageCapability('ollama', 'gemma4:e2b')).toBe('supported')
    expect(await imageCapability('ollama', 'another-vision-model')).toBe('supported')
    connection.request.mockResolvedValue({ ok: true, json: async () => ({ capabilities: ['completion'] }) })
    expect(await imageCapability('ollama', 'gemma4:e2b')).toBe('unsupported')
    expect(await imageCapability('anthropic', 'unqualified')).toBe('unknown')
  })
  it('serialises authorised bytes in the native Ollama images field and labels rendition limitations', () => {
    const message = ollamaImageMessage(evidence(), 'data:image/png;base64,QUJD')
    expect(message).toMatchObject({ role: 'user', images: ['QUJD'] })
    expect(message.content).toContain('downsampled rendition')
    expect(() => ollamaImageMessage(evidence(), 'file:///private.png')).toThrow('authorised image rendition')
  })
  it('budgets a conservative image reservation independent of binary encoding size', () => {
    const small = estimateTokens({ messages: [{ images: ['QUJD'], content: 'same' }] })
    const large = estimateTokens({ messages: [{ images: ['A'.repeat(1_000_000)], content: 'same' }] })
    expect(small).toBe(large)
    expect(small).toBeGreaterThan(IMAGE_TOKEN_RESERVATION)
  })
  it('materialises at dispatch and reuses a rendition within the live turn without changing persistent messages', async () => {
    const image = evidence(), messages: unknown[] = [{ role: 'user', content: 'Inspect this figure' }]
    const original = [{ id: 'message', role: 'user' as const, content: 'Inspect this figure', timestamp: 1 }]
    const opts: SendOptions = { provider: 'ollama', model: 'vision', apiKey: '', messages: original, systemPrompt: '', onChunk: () => undefined, contextSize: 32768, maxOutputTokens: 1000, imageEvidence: () => [image] }
    const request = vi.fn(async () => ({ ok: true, status: 200, body: null, json: async () => ({}), text: async () => '' }))
    await requestInvocation(opts, messages, 'openai', () => ({ messages }), request)
    await requestInvocation(opts, messages, 'openai', () => ({ messages }), request)
    expect(image.materialise).toHaveBeenCalledOnce()
    expect(messages).toHaveLength(2)
    expect(JSON.stringify(original)).not.toContain('QUJD')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('fails before network dispatch when visual evidence exceeds the window or transport support', async () => {
    const image = evidence(), messages: unknown[] = []
    const opts: SendOptions = { provider: 'ollama', model: 'vision', apiKey: '', messages: [], systemPrompt: '', onChunk: () => undefined, contextSize: 4096, maxOutputTokens: 512, imageEvidence: () => [image] }
    const request = vi.fn()
    await expect(requestInvocation(opts, messages, 'openai', () => ({ messages }), request)).rejects.toThrow('BUDGET_LIMIT')
    opts.provider = 'claude-cli'
    await expect(requestInvocation(opts, messages, 'openai', () => ({ messages }), request)).rejects.toThrow('not qualified')
    expect(request).not.toHaveBeenCalled()
  })
  it('rebinds portable citations and attachment references when a project is copied', () => {
    const reference = { projectId: 'original', id: 'f', revision: 'v1', location: { kind: 'pdf' as const, page: 80 } }
    const source = [{ content: `[Report](${projectFileCitation(reference)})`, projectFileReferences: [{ ...reference, title: 'Report' }] }]
    const copy = rebindProjectFileReferences(source, 'original', 'copy')
    expect(copy[0].projectFileReferences[0].projectId).toBe('copy')
    const uri = /\((.+)\)/.exec(copy[0].content)![1]
    expect(parseProjectFileCitation(uri)).toMatchObject({ ...reference, projectId: 'copy' })
    expect(source[0].projectFileReferences[0].projectId).toBe('original')
  })
})
