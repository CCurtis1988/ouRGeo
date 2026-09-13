import { describe, it, expect, beforeEach } from 'vitest'
import { useAiStore, selectActiveChat, selectMessages, makeChat } from './ai'

/** A store with exactly one empty conversation — what the panel opens on. */
const reset = (): void => {
  const chat = makeChat('anthropic', 'claude-opus-4-6')
  useAiStore.setState({
    chats: [chat], activeChatId: chat.id,
    isStreaming: false, streamingContent: '', abortController: null,
  })
}

const messages = (): ReturnType<typeof selectMessages> => selectMessages(useAiStore.getState())
const active = () => selectActiveChat(useAiStore.getState())!

beforeEach(reset)

describe('ending a turn', () => {
  it('keeps what the assistant said', () => {
    useAiStore.getState().beginStream()
    useAiStore.getState().appendStreamChunk('Here are the ')
    useAiStore.getState().appendStreamChunk('first five rows.')
    useAiStore.getState().finalizeStream('Here are the first five rows.')

    const { isStreaming, streamingContent } = useAiStore.getState()
    expect(messages()).toHaveLength(1)
    expect(messages()[0].content).toBe('Here are the first five rows.')
    expect(isStreaming).toBe(false)
    expect(streamingContent).toBe('')
  })

  it('adds no message when there is nothing to add', () => {
    // A blank assistant bubble reads as the assistant having answered with
    // nothing; the error line under the box is the honest report.
    useAiStore.getState().beginStream()
    useAiStore.getState().finalizeStream('')
    expect(messages()).toHaveLength(0)
    expect(useAiStore.getState().isStreaming).toBe(false)
  })
})

describe('pressing Stop', () => {
  it('keeps the half-written answer instead of deleting it', () => {
    // Stopping means "that is enough", not "undo that" — and what was on
    // screen when the button was pressed is usually the reason it was pressed.
    const ac = useAiStore.getState().beginStream()
    useAiStore.getState().appendStreamChunk('The buffer has 41 features')
    useAiStore.getState().cancelStream()

    expect(ac.signal.aborted).toBe(true)
    expect(messages().map((m) => m.content))
      .toEqual(['The buffer has 41 features'])
    expect(useAiStore.getState().isStreaming).toBe(false)
  })

  it('leaves nothing behind when nothing had arrived', () => {
    useAiStore.getState().beginStream()
    useAiStore.getState().cancelStream()
    expect(messages()).toHaveLength(0)
  })
})

describe('the token reading', () => {
  it('is dropped when the model changes, because it described the old one', () => {
    useAiStore.getState().setTokenUsage(120_000, 200_000)
    useAiStore.getState().setModel('some-8k-local-model')
    expect(active().tokenUsage).toEqual({ used: 0, total: 0 })
  })
})

describe('the session-state block a transcript-keeping provider was sent', () => {
  it('starts fresh in a new chat, which has its own transcript', () => {
    useAiStore.getState().setLastSessionContext({ objects: { '.GlobalEnv::pts': '- `pts`' }, documents: '', switches: '', consoleMark: '7' })
    useAiStore.getState().setClaudeSession('sid-1')
    useAiStore.getState().newChat()
    expect(active().lastSessionContext).toBeNull()
    expect(active().claudeSessionId).toBeNull()
  })

  it('is forgotten on a provider switch — the new one has been sent nothing', () => {
    useAiStore.getState().setLastSessionContext({ objects: { '.GlobalEnv::pts': '- `pts`' }, documents: '', switches: '', consoleMark: '7' })
    useAiStore.getState().setProvider('openai')
    expect(active().lastSessionContext).toBeNull()
  })

  it('is dropped with a Claude session the CLI turned out not to have', () => {
    useAiStore.getState().setClaudeSession('sid-gone')
    useAiStore.getState().setLastSessionContext({ objects: {}, documents: '', switches: '', consoleMark: '7' })
    useAiStore.getState().clearClaudeSession()
    expect(active().claudeSessionId).toBeNull()
    // The replacement transcript has been sent nothing, so the next turn must
    // carry the session state in full.
    expect(active().lastSessionContext).toBeNull()
  })
})
