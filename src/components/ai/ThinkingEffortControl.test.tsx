// @vitest-environment jsdom
import React from 'react'
import { beforeEach, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThinkingEffortControl } from './ThinkingEffortControl'
import { thinkingCapability, thinkingKey } from '@/lib/ai-thinking'
import { useAiThinkingStore } from '@/store/ai-thinking'
let files: Map<string, string>
beforeEach(() => {
  files = new Map()
  useAiThinkingStore.setState({ initialized: true, selections: {}, error: null })
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { app: { getDataPath: async () => '/data' }, file: {
    read: async (path: string) => files.get(path) ?? '{}', write: async (path: string, text: string) => { files.set(path, text) },
  } } })
})
it('hides unsupported models, remembers each choice, and disables changes during a turn', async () => {
  const view = render(<ThinkingEffortControl provider="openai" model="o3" capability={thinkingCapability('openai', 'o3')} disabled={false} />)
  const select = screen.getByRole('combobox', { name: 'Thinking effort' })
  expect(select).toHaveValue('default')
  fireEvent.change(select, { target: { value: 'high' } })
  await waitFor(() => expect(select).toHaveValue('high'))
  view.rerender(<ThinkingEffortControl provider="openai" model="gpt-4o" capability={null} disabled={false} />)
  expect(screen.queryByRole('combobox')).toBeNull()
  view.rerender(<ThinkingEffortControl provider="openai" model="o3" capability={thinkingCapability('openai', 'o3')} disabled />)
  expect(screen.getByRole('combobox')).toHaveValue('high')
  expect(screen.getByRole('combobox')).toBeDisabled()
  expect(useAiThinkingStore.getState().selections[thinkingKey('openai', 'o3')]).toBe('high')
})
it('shows a truthful default for Gemini budgets and safely falls back for obsolete selections', () => {
  useAiThinkingStore.setState({ selections: { [thinkingKey('google', 'gemini-2.5-pro')]: 'obsolete-value' } })
  render(<ThinkingEffortControl provider="google" model="gemini-2.5-pro" capability={thinkingCapability('google', 'gemini-2.5-pro')} disabled={false} />)
  expect(screen.getByRole('combobox', { name: 'Thinking budget' })).toHaveValue('default')
  expect(screen.getByRole('option', { name: 'Provider default · Dynamic' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Off' })).toBeNull()
})
