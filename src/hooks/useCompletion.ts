import { useCallback, useMemo, useRef, useState } from 'react'
import type { ColumnInfo, RFormalArg } from '@/lib/r-client'
import { rClient } from '@/lib/r-client'
import { useEnvironmentStore } from '@/store/environment'
import { usePackagesStore } from '@/store/packages'
import { buildEnvIndex } from '@/lib/completion/env-index'
import { getCompletions } from '@/lib/completion/engine'
import { expandSnippet } from '@/lib/completion/snippet'
import type { CompletionCandidate, CompletionMode, EngineDeps, IndexedPackage } from '@/lib/completion/types'

export interface CompletionState {
  open: boolean
  candidates: CompletionCandidate[]
  selected: number
  /** replace range on the source buffer */
  from: number
  to: number
}

export interface AcceptResult {
  from: number
  to: number
  insertText: string
  /** final caret offset relative to the start of the inserted text */
  caret: number
  /**
   * Id of the accepted candidate. The editor host uses it to recognise the
   * markdown actions that can't be completed by inserting text — a link needs
   * its URL, a map chunk needs the live map — and route them to the same
   * backend the ribbon button uses instead.
   */
  candidateId?: string
}

const CLOSED: CompletionState = { open: false, candidates: [], selected: 0, from: 0, to: 0 }

/**
 * Surface-agnostic autocomplete controller. A host (Monaco editor or the
 * console textarea) calls `query` on edits/cursor moves, drives selection with
 * `move`, and applies `accept`. Async data (sf columns, function formals) is
 * fetched lazily, cached, and the query re-runs when it arrives.
 */
export function useCompletion() {
  const environments = useEnvironmentStore((s) => s.environments)
  const libraries = usePackagesStore((s) => s.libraries)
  const [state, setState] = useState<CompletionState>(CLOSED)

  const columnCache = useRef<Map<string, ColumnInfo[]>>(new Map())
  const formalsCache = useRef<Map<string, RFormalArg[]>>(new Map())
  const inFlight = useRef<Set<string>>(new Set())
  // Latest query inputs, so async fetches can re-run against current text.
  const last = useRef<{ text: string; offset: number; manual: boolean; mode: CompletionMode } | null>(null)
  const envRequested = useRef(false)
  const pkgRequested = useRef(false)

  const index = useMemo(() => buildEnvIndex(environments), [environments])

  // Flatten installed packages (dedup across libraries) for library()/require()
  // completion. Read through a ref so async re-runs see the latest list without
  // rebuilding `deps` (which would churn the memo on every package refresh).
  const packages = useMemo<IndexedPackage[]>(() => {
    const out: IndexedPackage[] = []
    const seen = new Set<string>()
    for (const lib of libraries) {
      for (const p of lib.packages) {
        if (seen.has(p.name)) continue
        seen.add(p.name)
        out.push({ name: p.name, version: p.version, loaded: p.loaded })
      }
    }
    return out
  }, [libraries])
  const packagesRef = useRef<IndexedPackage[]>(packages)
  packagesRef.current = packages

  const deps = useMemo<EngineDeps>(
    () => ({
      index,
      getColumns: (name, env) => columnCache.current.get(`${env}::${name}`),
      getFormals: (fn) => formalsCache.current.get(fn),
      getPackages: () => packagesRef.current,
    }),
    [index]
  )

  const run = useCallback(
    (text: string, offset: number, manual: boolean, mode: CompletionMode = 'r') => {
      const result = getCompletions(text, offset, deps, mode)

      // Kick off any lazy fetches the engine asked for, then re-query.
      for (const col of result.wants.columns) {
        const key = `${col.envName}::${col.name}`
        if (columnCache.current.has(key) || inFlight.current.has(key)) continue
        inFlight.current.add(key)
        rClient
          .getObjectDataFrame(col.name, col.envName, undefined, 0, 1)
          .then((r) => {
            if (r.success && r.columns) columnCache.current.set(key, r.columns)
          })
          .catch(() => {})
          .finally(() => {
            inFlight.current.delete(key)
            const l = last.current
            if (l) run(l.text, l.offset, l.manual, l.mode)
          })
      }
      for (const fn of result.wants.formals) {
        const key = `fn::${fn}`
        if (formalsCache.current.has(fn) || inFlight.current.has(key)) continue
        inFlight.current.add(key)
        rClient
          .getObjectFormals(fn)
          .then((r) => {
            if (r.success && r.args) formalsCache.current.set(fn, r.args)
          })
          .catch(() => {})
          .finally(() => {
            inFlight.current.delete(key)
            const l = last.current
            if (l) run(l.text, l.offset, l.manual, l.mode)
          })
      }

      const prefixLen = result.to - result.from
      const structural = result.from > 0 && /[$(:"[]/.test(text[result.from - 1] ?? '')
      // `autoOpen` rather than adding `/` to `structural`: widening that shared
      // character test would pop the menu on `a/b` in the R console.
      const shouldOpen =
        result.candidates.length > 0 &&
        (manual || prefixLen > 0 || structural || result.autoOpen === true)

      if (!shouldOpen) {
        setState((s) => (s.open ? CLOSED : s))
        return
      }
      setState((prev) => ({
        open: true,
        candidates: result.candidates,
        // keep the selection stable while narrowing if still in range
        selected: prev.open && prev.selected < result.candidates.length ? prev.selected : 0,
        from: result.from,
        to: result.to,
      }))
    },
    [deps]
  )

  const query = useCallback(
    (text: string, offset: number, manual = false, mode: CompletionMode = 'r') => {
      last.current = { text, offset, manual, mode }
      // Populate the environment index on first use if the panel never opened.
      if (!envRequested.current && index.objects.length === 0 && index.functions.length === 0) {
        envRequested.current = true
        rClient
          .listEnvironments()
          .then((r) => {
            if (r.success) useEnvironmentStore.getState().setEnvironments(r.environments)
          })
          .catch(() => {})
      }
      // Populate installed packages on first use (for library()/require()), then
      // re-run so the dropdown fills in as soon as the list arrives.
      if (!pkgRequested.current && packagesRef.current.length === 0) {
        pkgRequested.current = true
        usePackagesStore
          .getState()
          .refreshPackages()
          .then(() => {
            const l = last.current
            if (l) run(l.text, l.offset, l.manual, l.mode)
          })
          .catch(() => {})
      }
      run(text, offset, manual, mode)
    },
    [run, index]
  )

  const close = useCallback(() => setState((s) => (s.open ? CLOSED : s)), [])

  const move = useCallback((delta: number) => {
    setState((s) => {
      if (!s.open || s.candidates.length === 0) return s
      const n = s.candidates.length
      return { ...s, selected: (s.selected + delta + n) % n }
    })
  }, [])

  const setSelected = useCallback((i: number) => {
    setState((s) => (s.open ? { ...s, selected: i } : s))
  }, [])

  /** Resolve the accepted candidate into a concrete edit for the host to apply. */
  const accept = useCallback(
    (indexArg?: number): AcceptResult | null => {
      const s = state
      if (!s.open || s.candidates.length === 0) return null
      const cand = s.candidates[indexArg ?? s.selected]
      if (!cand) return null
      setState(CLOSED)

      if (cand.kind === 'snippet') {
        const { text, caret } = expandSnippet(cand.insertText)
        return { from: s.from, to: s.to, insertText: text, caret, candidateId: cand.id }
      }
      const caret = cand.insertText.length + (cand.cursorOffset ?? 0)
      return {
        from: s.from, to: s.to, insertText: cand.insertText, caret, candidateId: cand.id,
      }
    },
    [state]
  )

  return { state, query, close, move, setSelected, accept }
}
