import type React from 'react'
import { create } from 'zustand'

// One question at a time, from anywhere: closing a document, leaving scratch,
// a project that changed elsewhere, a crash report. Every prompt in
// docs/project-persistence-spec.md is a title, some words, two to four answers
// and sometimes a checkbox — so they share one dialog (AskDialog) rather than
// growing a component each, and they queue: a second question waits for the
// first to be answered instead of covering it.
//
// The answer you get by doing nothing (Escape, clicking outside) is
// `cancelId`, which every caller treats as "stop, change nothing".

export interface AskChoice { id: string; label: string; variant?: 'primary' | 'danger' | 'default' }
export interface AskRequest {
  title: string
  body: React.ReactNode
  choices: AskChoice[]
  cancelId: string
  checkbox?: { label: string; hint?: string }
  /** Wider for lists and diffs. */
  wide?: boolean
}
export interface AskAnswer { choice: string; checked: boolean }

interface Pending extends AskRequest { resolve: (answer: AskAnswer) => void }

export const useAskStore = create<{ queue: Pending[]; answer: (choice: string, checked: boolean) => void }>((set, get) => ({
  queue: [],
  answer: (choice, checked) => {
    const [head, ...rest] = get().queue
    if (!head) return
    set({ queue: rest })
    head.resolve({ choice, checked })
  },
}))

export function ask(request: AskRequest): Promise<AskAnswer> {
  return new Promise(resolve => useAskStore.setState(state => ({ queue: [...state.queue, { ...request, resolve }] })))
}
