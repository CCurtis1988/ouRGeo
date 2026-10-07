import { describe, it, expect } from 'vitest'
import { withEarlierTurns } from './ai-client'
import type { ChatMessage } from '@/store/ai'

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ id: content, role, content, timestamp: 0 })

describe('starting a Claude Code session mid-conversation', () => {
  it('sends the newest turn alone when there is nothing before it', () => {
    expect(withEarlierTurns([msg('user', 'hello')], 'hello')).toBe('hello')
  })

  it('carries what is on screen, because the CLI has none of it', () => {
    // Every other transport posts the whole array each turn. Without this, a
    // follow-up asked just after switching provider would be answered by a
    // model that had silently forgotten the question it follows.
    const out = withEarlierTurns(
      [msg('user', 'how many rows?'), msg('assistant', '7'), msg('user', 'times six?')],
      'times six?',
    )
    expect(out).toContain('User: how many rows?')
    expect(out).toContain('You: 7')
    expect(out.endsWith('times six?')).toBe(true)
    expect(out).toContain('do not answer them again')
  })

  it('preserves original user instructions in a fresh authorised reconstruction', () => {
    const old = msg('user', `ancient ${'x'.repeat(20000)}`)
    const recent = msg('assistant', 'the recent one')
    const out = withEarlierTurns([old, recent, msg('user', 'now')], 'now')
    expect(out).toContain('the recent one')
    expect(out).toContain(old.content)
  })
})
