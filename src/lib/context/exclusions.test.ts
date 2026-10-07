import { expect, it } from 'vitest'
import { exclusionScope, executionBlocked, validateExclusions } from './exclusions'
import { chatContentChanged, disclosureDialogue } from './disclosure-dialogue'
import { makeChat } from '@/store/ai'

it('keeps scratch exclusions transient and project choices bound to a saved identity', () => {
  expect(exclusionScope('workspace', null)).toBeNull()
  expect(exclusionScope('conversation', 'project')).toBe('project')
  expect(exclusionScope('application', null)).toBe('application')
  expect(exclusionScope('global', 'project')).toBe('global')
  expect(() => validateExclusions(['environment:.GlobalEnv:private'], 'application')).toThrow('authorised source')
  expect(() => validateExclusions(['document:api_key=secret'], 'project')).toThrow('authorised source')
})

it('retains exact user constraints while refusing replay of unverified derived answers', () => {
  const messages = [
    { id: 'u', role: 'user' as const, content: 'Use exactly 12.5 US survey feet.', timestamp: 1 },
    { id: 'a', role: 'assistant' as const, content: 'Secret value from an old source.', timestamp: 2 },
  ]
  expect(disclosureDialogue(messages, [], true)).toBe(messages)
  expect(disclosureDialogue(messages, ['environment:.GlobalEnv:private'], true)).toEqual([messages[0]])
  expect(disclosureDialogue(messages, [], false)).toEqual([messages[0]])
})

it('does not let generic execution bypass a private-source exclusion', () => {
  for (const name of ['execute_r_code', 'run_ui_action', 'run_toolbox_tool', 'write_document', 'edit_document']) {
    expect(executionBlocked(name, {}, ['environment:.GlobalEnv:private'], true)).toBe(true)
    expect(executionBlocked(name, {}, [], false)).toBe(true)
    expect(executionBlocked(name, {}, ['skill:spatial'], true)).toBe(false)
  }
  expect(executionBlocked('context_search', {}, ['document:private'], true)).toBe(false)
  expect(executionBlocked('run_ui_action', { id: 'theme:duplicate' }, ['memory:preference'], true)).toBe(false)
  expect(executionBlocked('run_ui_action', { id: 'plugin:theme:duplicate' }, ['memory:preference'], true)).toBe(true)
})

it('distinguishes a provider-session reset from unsaved conversation work', () => {
  const chat = makeChat('claude-cli', 'fixture')
  expect(chatContentChanged([{ ...chat, claudeSessionId: 'another-session' }], [chat])).toBe(false)
  expect(chatContentChanged([{ ...chat, lastSessionContext: null }], [chat])).toBe(false)
  expect(chatContentChanged([{ ...chat, title: 'A user-renamed conversation' }], [chat])).toBe(true)
  expect(chatContentChanged([{ ...chat, messages: [...chat.messages, { id: 'u', role: 'user', content: 'A new request', timestamp: 1 }] }], [chat])).toBe(true)
})
