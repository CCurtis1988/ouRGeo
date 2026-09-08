import { describe, it, expect, beforeEach } from 'vitest'
import { useAiStore } from './ai'

const reset = (): void => {
  useAiStore.setState({
    messages: [], isStreaming: false, streamingContent: '', abortController: null,
    tokenUsage: { used: 0, total: 0 }, lastSessionContext: null, claudeSessionId: null,
  })
}

beforeEach(reset)

describe('ending a turn', () => {
  it('keeps what the assistant said', () => {
    useAiStore.getState().beginStream()
    useAiStore.getState().appendStreamChunk('Here are the ')
    useAiStore.getState().appendStreamChunk('first five rows.')
    useAiStore.getState().finalizeStream('Here are the first five rows.')

    const { messages, isStreaming, streamingContent } = useAiStore.getState()
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toBe('Here are the first five rows.')
    expect(isStreaming).toBe(false)
    expect(streamingContent).toBe('')
  })

  it('adds no message when there is nothing to add', () => {
    // A blank assistant bubble reads as the assistant having answered with
    // nothing; the error line under the box is the honest report.
    useAiStore.getState().beginStream()
    useAiStore.getState().finalizeStream('')
    expect(useAiStore.getState().messages).toHaveLength(0)
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
    expect(useAiStore.getState().messages.map((m) => m.content))
      .toEqual(['The buffer has 41 features'])
    expect(useAiStore.getState().isStreaming).toBe(false)
  })

  it('leaves nothing behind when nothing had arrived', () => {
    useAiStore.getState().beginStream()
    useAiStore.getState().cancelStream()
    expect(useAiStore.getState().messages).toHaveLength(0)
  })
})

describe('the token reading', () => {
  it('is dropped when the model changes, because it described the old one', () => {
    useAiStore.setState({ tokenUsage: { used: 120_000, total: 200_000 } })
    useAiStore.getState().setModel('some-8k-local-model')
    expect(useAiStore.getState().tokenUsage).toEqual({ used: 0, total: 0 })
  })
})

describe('the session-state block a transcript-keeping provider was sent', () => {
  it('is forgotten when the conversation is, so the next turn carries it again', () => {
    useAiStore.getState().setLastSessionContext('# Session state\nObjects: pts')
    useAiStore.getState().clearMessages()
    expect(useAiStore.getState().lastSessionContext).toBeNull()
    // …and so is the CLI's transcript, which is what "New conversation" means.
    expect(useAiStore.getState().claudeSessionId).toBeNull()
  })

  it('is forgotten on a provider switch — the new one has been sent nothing', () => {
    useAiStore.getState().setLastSessionContext('# Session state\nObjects: pts')
    useAiStore.getState().setProvider('anthropic')
    expect(useAiStore.getState().lastSessionContext).toBeNull()
  })
})
