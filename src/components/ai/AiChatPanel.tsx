import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  Zap, ZapOff, Plus, Send, Square, ChevronDown, Globe, GlobeLock, SlidersHorizontal,
  SquareTerminal, Terminal as TerminalIcon,
} from 'lucide-react'
import { Button } from '../ui/button'
import { AiChatMessage } from './AiChatMessage'
import { ModelSelectorPopup } from './ModelSelectorPopup'
import { AutopilotWarningDialog } from './AutopilotWarningDialog'
import { VoiceButton, VoiceStatusLine } from './VoiceButton'
import { AiPermissionsDialog } from './AiPermissionsDialog'
import { AiChatSwitcher } from './AiChatSwitcher'
import { AiActionConfirmDialog } from './AiActionConfirmDialog'
import { useAiStore, selectMessages, selectActiveChat } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'
import { useEditorStore } from '@/store/editor'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { rClient } from '@/lib/r-client'
import type { AiTool, ToolCall } from '@/lib/ai-client'
import { sendMessage, truncateForModel, detectMentionedObjects, getContextSize, resolveContextSize, fetchLocalContextSize, localCtxOverride, PROVIDER_LABELS, isLocalProvider, localBaseUrl, localApiKey, requiresApiKey, EXECUTE_R_TOOL } from '@/lib/ai-client'
import { WEB_TOOLS, WEB_TOOL_NAMES, runWebTool, describeWebCall } from '@/lib/ai-web-tools'
import {
  AI_BASE_PROMPT, buildProvenanceRules, buildToolGuidance, buildToolNaming, buildSwitchGuidance,
} from '@/lib/ai-system-prompt'
import { buildDocumentSkill } from '@/lib/ai-skill-documents'
import {
  fullSessionContext, incrementalSessionContext, NOTHING_SENT, type SessionInput,
} from '@/lib/ai-session-context'
import { DOC_TOOLS, DOC_TOOL_NAMES, runDocTool, describeDocCall } from '@/lib/ai-doc-tools'
import { UI_TOOLS, UI_TOOL_NAMES, runUiTool, describeUiCall } from '@/lib/ai-ui-tools'
import { actionCallInCode, actionCodeRefusal } from '@/lib/ai-actions/action-code-guard'
import { buildOurgeoCore } from '@/lib/ai-skill-ourgeo'
import { cn } from '@/lib/utils'

// ── Token usage bar ────────────────────────────────────────────────────────
function TokenBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0
  const color = pct < 50 ? 'bg-geo-success' : pct < 80 ? 'bg-yellow-500' : 'bg-geo-error'
  const fmt = (n: number) => n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`
  return (
    <div className="flex items-center gap-1.5" title={`${fmt(used)} / ${fmt(total)} tokens`}>
      <span className="text-[10px] text-geo-muted whitespace-nowrap">{fmt(used)}/{fmt(total)}</span>
      <div className="w-14 h-1.5 bg-geo-border rounded-full overflow-hidden flex-shrink-0">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Autocomplete ───────────────────────────────────────────────────────────
function useAutocomplete(value: string, envNames: string[]) {
  const lastOpen = value.lastIndexOf('[')
  if (lastOpen < 0 || value.indexOf(']', lastOpen) >= 0) {
    return { partial: '', suggestions: [] }
  }
  const partial = value.slice(lastOpen + 1)
  const suggestions = envNames.filter(
    (n) => n.toLowerCase().startsWith(partial.toLowerCase()) && n !== partial
  )
  return { partial, suggestions: suggestions.slice(0, 8) }
}

// ── Main panel ────────────────────────────────────────────────────────────
export function AiChatPanel(): React.ReactElement {
  const provider = useAiStore((s) => s.provider)
  const currentModel = useAiStore((s) => s.currentModel())
  // Selectors, not fields: a conversation is now one of a set. Both return a
  // stable reference when nothing changed — see NO_MESSAGES in store/ai.ts.
  const messages = useAiStore(selectMessages)
  const activeChat = useAiStore(selectActiveChat)
  const chatCount = useAiStore((s) => s.chats.length)
  const isStreaming = useAiStore((s) => s.isStreaming)
  const streamingContent = useAiStore((s) => s.streamingContent)
  const autoPilotEnabled = useAiStore((s) => s.autoPilotEnabled)
  const autopilotWarningDismissed = useAiStore((s) => s.autopilotWarningDismissed)
  const webAccessEnabled = useAiStore((s) => s.webAccessEnabled)
  const tokenUsage = activeChat?.tokenUsage ?? { used: 0, total: 0 }
  const init = useAiStore((s) => s.init)
  const addMessage = useAiStore((s) => s.addMessage)
  const appendStreamChunk = useAiStore((s) => s.appendStreamChunk)
  const finalizeStream = useAiStore((s) => s.finalizeStream)
  const cancelStream = useAiStore((s) => s.cancelStream)
  const newChat = useAiStore((s) => s.newChat)
  const setAutoPilot = useAiStore((s) => s.setAutoPilot)
  const setAutopilotWarningDismissed = useAiStore((s) => s.setAutopilotWarningDismissed)
  const setWebAccess = useAiStore((s) => s.setWebAccess)
  const terminalEnabled = useAiStore((s) => s.terminalEnabled)
  const setTerminalAccess = useAiStore((s) => s.setTerminalAccess)
  const setTokenUsage = useAiStore((s) => s.setTokenUsage)
  const beginStream = useAiStore((s) => s.beginStream)

  const keys = useApiKeysStore((s) => s.keys)
  const initKeys = useApiKeysStore((s) => s.init)
  const environments = useEnvironmentStore((s) => s.environments)
  const setEnvironments = useEnvironmentStore((s) => s.setEnvironments)
  const addConsoleEntry = useSessionStore((s) => s.addConsoleEntry)

  const [input, setInput] = useState('')
  const [modelPopupOpen, setModelPopupOpen] = useState(false)
  const [autopilotDialogOpen, setAutopilotDialogOpen] = useState(false)
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [acSelected, setAcSelected] = useState(0)
  // Resolved context window (manual override → auto-detected → static → 128k)
  const [contextSize, setContextSize] = useState(() => getContextSize(currentModel))

  // A turn is in flight. A ref, not state: it has to be readable and writable
  // within one event's dispatch, which is where the double send happened.
  const sendingRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modelBtnRef = useRef<HTMLButtonElement>(null)

  // Collect user-environment object names for autocomplete (exclude packages)
  const allEnvNames = environments
    .filter((e) => !e.isSearchPath)
    .flatMap((e) => e.objects.map((o) => o.name))
  const { suggestions } = useAutocomplete(input, allEnvNames)

  useEffect(() => { init(); initKeys() }, [init, initKeys])

  // Resolve the context window for the token bar / usage reporting. For local
  // providers this probes the server (llama.cpp /props, vLLM max_model_len) and
  // honours a manual override; cloud providers use the static per-model size.
  useEffect(() => {
    let cancelled = false
    // Immediate best-effort value (override or static) so the bar isn't stale…
    setContextSize(resolveContextSize(provider, currentModel, keys))
    if (isLocalProvider(provider) && localCtxOverride(provider, keys) == null) {
      fetchLocalContextSize(provider, localBaseUrl(provider, keys), localApiKey(provider, keys), currentModel)
        .then((detected) => {
          if (!cancelled) setContextSize(resolveContextSize(provider, currentModel, keys, detected))
        })
    }
    return () => { cancelled = true }
  }, [provider, currentModel, keys])

  // Fetch environments when the AI panel mounts so autocomplete and context are always populated
  useEffect(() => {
    rClient.listEnvironments().then((res) => {
      if (res.success) setEnvironments(res.environments)
    }).catch(() => { /* ignore — R may not be ready yet */ })
  }, [setEnvironments])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Reset autocomplete selection when suggestions change
  useEffect(() => { setAcSelected(0) }, [suggestions.length])

  const getApiKey = () => {
    if (provider === 'openai') return keys.openai ?? ''
    if (provider === 'anthropic') return keys.anthropic ?? ''
    if (provider === 'google') return keys.google_gemini ?? ''
    return '' // local providers don't require a cloud key
  }

  /**
   * Everything after the send is committed: gather the session's state, build
   * the prompt, stream the answer.
   *
   * Split out so `handleSend` is short enough to see the ordering rule in one
   * screen — claim, commit, then await.
   */
  const runTurn = useCallback(async (
    userMsg: { id: string; role: 'user'; content: string; timestamp: number },
    text: string,
    apiKey: string,
    local: boolean,
    ac: AbortController,
  ) => {
    // Refresh environment data so the prompt reflects the current session state
    const envRes = await rClient.listEnvironments().catch(() => null)
    const currentEnvs = envRes?.success ? envRes.environments : environments
    if (envRes?.success) setEnvironments(envRes.environments)
    // Stop pressed while R was answering: the turn was never sent, so there is
    // nothing to finalize and nothing to say.
    if (ac.signal.aborted) return

    // The prompt has two halves, and which half a piece belongs in is a cost
    // decision for any provider that caches a prefix (see
    // `SendOptions.sessionContext`): the STABLE half is the same bytes every
    // turn, the VOLATILE half changes with the session and must never sit in
    // front of the stable one.
    // A transport that keeps its own transcript is sent the volatile half beside
    // the turn; everything else is posted the whole conversation each time and
    // has no prefix to protect, so it keeps the shape it has always had.
    const keepsTranscript = provider === 'claude-cli'

    const switchOpts = {
      autoPilot: autoPilotEnabled,
      webAccess: webAccessEnabled,
      terminal: terminalEnabled,
      viaMcp: keepsTranscript,
    }
    // The switch positions are volatile for the CLI and stable for everyone
    // else. In the prompt's TAIL they re-sent the whole conversation as a cache
    // write every time anyone reached for a toggle; on the turn, a flip extends
    // the cached prefix instead. See `buildToolNaming`.
    const switchGuidance = buildSwitchGuidance(switchOpts)
    const stablePrompt = [
      AI_BASE_PROMPT,
      buildOurgeoCore(),
      buildProvenanceRules(),
      // Documents are always in the prompt: the model has to know a .Rmd renders
      // in a session of its own before it writes one, not after the knit fails.
      buildDocumentSkill({ hasDocumentTools: true }),
      keepsTranscript ? buildToolNaming(switchOpts) : buildToolGuidance(switchOpts),
    ].filter(Boolean).join('\n\n')

    // The live session: the objects, the console the user has been typing in,
    // and the documents that are open.
    const editorState = useEditorStore.getState()

    // Fetch rich context for mentioned objects
    let previews = ''
    const mentioned = detectMentionedObjects(text, currentEnvs)
    if (mentioned.length > 0) {
      const snippets: string[] = []
      for (const name of mentioned) {
        try {
          const envName = currentEnvs.find((e) => e.objects.some((o) => o.name === name))?.name ?? '.GlobalEnv'
          const df = await rClient.getObjectDataFrame(name, envName, name, 0, 5)
          if (df.success && df.columns.length > 0) {
            const header = df.columns.map((c) => c.name).join(' | ')
            const sep = df.columns.map(() => '---').join(' | ')
            snippets.push(`### \`${name}\` preview\n| ${header} |\n| ${sep} |\n${df.rows.length > 0 ? df.rows.map(r => `| ${r.join(' | ')} |`).join('\n') : ''}`)
          }
        } catch { /* ignore */ }
      }
      if (snippets.length > 0) {
        previews = `## Referenced Object Previews\n${snippets.join('\n\n')}`
      }
    }

    const sessionInput: SessionInput = {
      environments: currentEnvs,
      consoleHistory: useSessionStore.getState().consoleHistory,
      tabs: editorState.tabs,
      activeTabId: editorState.activeTabId,
      switches: switchGuidance,
      previews,
    }

    // What rides the turn, and what the chat then remembers having said.
    //
    // Only the transcript-keeping transport gets a DELTA, and it gets one for a
    // reason the other transports do not have: what it is sent once stays in
    // the conversation and is re-read on every turn after. Everything else
    // rebuilds its prompt from the message array each time, so sending less
    // would buy nothing and cost the model a complete picture.
    const update = keepsTranscript
      ? incrementalSessionContext(
          sessionInput,
          selectActiveChat(useAiStore.getState())?.lastSessionContext ?? NOTHING_SENT,
        )
      : null
    const fullContext = keepsTranscript ? '' : fullSessionContext(sessionInput)

    const sessionContext = update?.block ?? ''
    const systemPrompt = keepsTranscript || !fullContext
      ? stablePrompt
      : `${stablePrompt}\n\n${fullContext}`

    const sendContext = sessionContext !== ''

    // Only the enabled capabilities are attached to the request, so a switch that
    // is off is invisible to the model rather than merely discouraged.
    const tools: AiTool[] = []
    if (autoPilotEnabled) tools.push(EXECUTE_R_TOOL)
    // Document tools carry no switch: they write into a visible, undoable editor
    // tab and never touch disk or the R session.
    tools.push(...DOC_TOOLS)
    // Interface tools are likewise unswitched: discovery and navigation are
    // harmless, and everything that isn't is gated per action by its tier.
    tools.push(...UI_TOOLS)
    if (webAccessEnabled) tools.push(...WEB_TOOLS)

    // Every tool re-checks its switch at call time: flipping one off mid-answer
    // stops the next call rather than waiting for the turn to end.
    const runTool = async (call: ToolCall): Promise<string> => {
      if (call.name === EXECUTE_R_TOOL.name) {
        if (!useAiStore.getState().autoPilotEnabled) {
          return 'Refused: the user turned Autopilot off. Do not run code — give the user code to run and wait for their output.'
        }
        const code = String(call.input.code ?? '')
        // An interface action written as R is the model confusing the two
        // namespaces. Correct it rather than letting R say "could not find
        // function" — see lib/ai-actions/action-code-guard.ts.
        const mistakenAction = actionCallInCode(code)
        if (mistakenAction) return actionCodeRefusal(mistakenAction)
        // Marked as the assistant's own: a transcript-keeping provider is
        // handed this back as a tool result in a moment, and the session-state
        // block must not then read it out a second time.
        addConsoleEntry('input', code, 'ai')
        const res = await rClient.execute(code)
        // /r/execute returns console text at the top level (`output`), not res.result
        if (res.output) addConsoleEntry('output', res.output, 'ai')
        else if (res.error) addConsoleEntry('error', res.error, 'ai')
        return truncateForModel(res.output || res.error || '(no output)')
      }
      if (DOC_TOOL_NAMES.has(call.name)) {
        addConsoleEntry('info', describeDocCall(call.name, call.input), 'ai')
        return truncateForModel(await runDocTool(call.name, call.input), 24000)
      }
      if (UI_TOOL_NAMES.has(call.name)) {
        addConsoleEntry('info', describeUiCall(call.name, call.input), 'ai')
        // Autopilot is re-read at call time, so turning it off mid-answer stops
        // the next action rather than waiting for the turn to end.
        return truncateForModel(
          await runUiTool(call.name, call.input, {
            autoPilot: useAiStore.getState().autoPilotEnabled,
            terminal: useAiStore.getState().terminalEnabled,
          }),
          24000,
        )
      }
      if (WEB_TOOL_NAMES.has(call.name)) {
        if (!useAiStore.getState().webAccessEnabled) {
          return 'Refused: the user has cut off your internet access. Do not attempt further web calls. Continue from the session\'s data alone and tell the user what you could not look up.'
        }
        // Log every network action so the console stays a complete record of
        // what the assistant did on the user's behalf.
        addConsoleEntry('info', describeWebCall(call.name, call.input), 'ai')
        return truncateForModel(await runWebTool(call.name, call.input), 16000)
      }
      return `Error: unknown tool "${call.name}".`
    }

    // The ACTIVE chat's history, read fresh — the user may have switched chats
    // while R was answering, and the turn belongs to the one it was sent from.
    const prior = selectMessages(useAiStore.getState()).filter((m) => m.id !== userMsg.id)
    const conversationMessages = [...prior, userMsg]

    try {
      // The Claude Code transport keeps its own transcript, so it takes a
      // session to resume rather than the whole conversation, and reports a
      // subscription window rather than a token count. Everything else — the
      // tools, `runTool`, the system prompt — is identical, which is the point.
      const chat = selectActiveChat(useAiStore.getState())
      const fullContent = await sendMessage({
        provider,
        model: currentModel,
        apiKey,
        localUrl: local ? localBaseUrl(provider, keys) : undefined,
        localApiKey: local ? localApiKey(provider, keys) : undefined,
        contextSize,
        messages: conversationMessages,
        systemPrompt,
        sessionContext: sendContext ? sessionContext : undefined,
        tools,
        onChunk: (chunk) => appendStreamChunk(chunk),
        onToolCall: tools.length > 0 ? runTool : undefined,
        onUsage: (used, total) => setTokenUsage(used, total),
        signal: ac.signal,
        claudeSessionId: chat?.claudeSessionId ?? undefined,
        claudeResume: !!chat?.claudeSessionId,
        claudeCwd: useSessionStore.getState().workingDir || undefined,
        onClaudeSession: (id) => useAiStore.getState().setClaudeSession(id),
        // The stored transcript was not on this machine — a project opened
        // elsewhere. The turn is being replayed as a new session, so drop the
        // dead id rather than trying it again next turn.
        onClaudeSessionLost: () => useAiStore.getState().clearClaudeSession(),
        onClaudeRateLimit: (f, s7, r) => useAiStore.getState().setClaudeUsage(f, s7, r),
      })

      // Recorded only on success: a turn that failed may never have reached
      // the model, and the next one must not assume it has this state. The
      // whole `SentContext` is recorded, not just what was sent — the console
      // mark advances past the assistant's own lines, which were deliberately
      // not sent and must not be reconsidered next turn.
      if (update) useAiStore.getState().setLastSessionContext(update.sent)
      // Stop was pressed: `cancelStream` has already kept whatever had been
      // streamed, and finalizing again would post the answer twice.
      if (!ac.signal.aborted) finalizeStream(fullContent)
    } catch (e) {
      // Stop was pressed — by name, or because the controller says so, since a
      // transport is free to reject with something of its own once aborted.
      if (ac.signal.aborted || (e as Error).name === 'AbortError') return
      setSendError(String(e))
      // The partial answer is READ HERE, not closed over.
      //
      // `streamingContent` in this callback's scope is the value from the
      // render that built it — empty, always, because the turn had not
      // started. So a transport that failed mid-answer (a local server
      // dropping the connection is the ordinary case) finalized an EMPTY
      // message, and everything the user had been reading disappeared at the
      // moment the error appeared. Same class of bug as `useGeometryCommit`,
      // and the same fix.
      finalizeStream(useAiStore.getState().streamingContent)
    }
  }, [provider, currentModel, keys, environments, autoPilotEnabled, webAccessEnabled, terminalEnabled, contextSize,
      appendStreamChunk, finalizeStream, setTokenUsage, addConsoleEntry, setEnvironments])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    const local = isLocalProvider(provider)
    const apiKey = getApiKey()
    if (requiresApiKey(provider) && !apiKey) {
      setSendError(`${PROVIDER_LABELS[provider]} API key not set. Add it in Settings → AI Assistant.`)
      return
    }

    // A send is claimed SYNCHRONOUSLY, before the first await.
    //
    // Preparing a turn asks R for the environment listing and a preview of
    // every object the message names, and R is serial: with a long command
    // running, that wait is as long as the command. On the old order nothing
    // said a send was under way until all of it had finished — the box still
    // held the text, Send was still enabled, `isStreaming` was still false —
    // so a user who clicked again because nothing had happened sent the
    // message twice, and two turns then ran against the same model at once.
    // The ref covers the same tick (Enter and a click, a double click); the
    // state below covers every tick after it.
    if (sendingRef.current) return
    sendingRef.current = true

    setSendError(null)

    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: text,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setInput('')
    // Streaming starts here, not after the preparation: it is what puts the
    // Stop button up, disables the box, and makes a second Enter a no-op.
    const ac = beginStream()

    try {
      await runTurn(userMsg, text, apiKey, local, ac)
    } catch (e) {
      // `runTurn` handles its own send failures; this is the belt for a throw
      // while the turn is being PREPARED. Without it the panel would be left
      // streaming for ever — a Stop button over a turn that is not running,
      // and no way back to a Send button.
      setSendError(String(e))
      finalizeStream(useAiStore.getState().streamingContent)
    } finally {
      sendingRef.current = false
    }
  }, [input, isStreaming, provider, keys, addMessage, beginStream, finalizeStream, runTurn])

  /**
   * Put a transcript into the message box at the caret.
   *
   * At the caret rather than replacing the box, so dictation can finish a
   * half-typed sentence — and spaced against what is already there, because a
   * transcript butted straight onto the previous word is the one mistake that
   * makes voice input feel broken rather than imperfect.
   */
  const insertTranscript = useCallback((text: string) => {
    const el = textareaRef.current
    setInput((current) => {
      const at = el && el.selectionStart != null ? el.selectionStart : current.length
      const before = current.slice(0, at)
      const after = current.slice(at)
      const gap = before && !/\s$/.test(before) ? ' ' : ''
      const next = `${before}${gap}${text}${after}`
      // Restore the caret after React has written the new value.
      requestAnimationFrame(() => {
        const pos = before.length + gap.length + text.length
        el?.focus()
        el?.setSelectionRange(pos, pos)
      })
      return next
    })
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Autocomplete navigation
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcSelected((v) => Math.min(v + 1, suggestions.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcSelected((v) => Math.max(v - 1, 0)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && suggestions.length > 0 && !e.shiftKey)) {
        e.preventDefault()
        insertSuggestion(suggestions[acSelected])
        return
      }
      if (e.key === 'Escape') { setInput((v) => v) /* trigger re-render to clear */; return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const insertSuggestion = (name: string) => {
    const lastOpen = input.lastIndexOf('[')
    const before = input.slice(0, lastOpen + 1)
    setInput(before + name + ']')
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleAutopilotToggle = () => {
    if (!autoPilotEnabled) {
      if (!autopilotWarningDismissed) {
        setAutopilotDialogOpen(true)
      } else {
        setAutoPilot(true)
      }
    } else {
      setAutoPilot(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-geo-panel">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-geo-border flex-shrink-0">
        <div className="relative flex-1 min-w-0">
          <button
            ref={modelBtnRef as React.RefObject<HTMLButtonElement>}
            onClick={() => setModelPopupOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-foreground hover:text-geo-accent transition-colors max-w-full"
          >
            <span className="truncate font-medium">{currentModel || 'Select model'}</span>
            <ChevronDown className="w-3 h-3 flex-shrink-0 text-geo-muted" />
          </button>
          <ModelSelectorPopup
            open={modelPopupOpen}
            onClose={() => setModelPopupOpen(false)}
            anchorRef={modelBtnRef as React.RefObject<HTMLElement>}
          />
        </div>
        {/* The provider's own reported window wins when there is one: a
            Claude Code alias resolves to a model whose window only that run
            can name. `contextSize` is the fallback until it has. */}
        <TokenBar used={tokenUsage.used} total={tokenUsage.total || contextSize} />
        {/* The switcher lists every chat in this project; `+` starts another
            without disturbing them. This used to be one button that DELETED
            the conversation, which is why it said "New" and meant "discard". */}
        <AiChatSwitcher />
        <button
          onClick={() => newChat()}
          data-ourgeo-id="ai.newChat"
          className="flex items-center gap-1 text-[10px] text-geo-muted hover:text-foreground px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors flex-shrink-0"
          title="Start a new chat — the current one is kept"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 opacity-50">
            <p className="text-xs text-geo-muted">Ask anything about your data or R code.</p>
            <p className="text-[10px] text-geo-muted">
              {allEnvNames.length > 0
                ? `${allEnvNames.length} object${allEnvNames.length !== 1 ? 's' : ''} in environment`
                : 'No objects loaded yet'}
            </p>
            {/* An empty chat used to be the only chat, so there was nothing to
                say. Now it can mean "you started a new one" — and the ones you
                were in are a click away rather than gone. */}
            {chatCount > 1 && (
              <p className="text-[10px] text-geo-muted">
                {chatCount - 1} other chat{chatCount === 2 ? '' : 's'} in this project.
              </p>
            )}
          </div>
        )}
        {messages.map((msg) => (
          <AiChatMessage key={msg.id} message={msg} />
        ))}
        {isStreaming && (
          <AiChatMessage
            message={{ id: '__streaming__', role: 'assistant', content: '', timestamp: Date.now() }}
            isStreaming={true}
            streamingContent={streamingContent}
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-geo-border px-2 pt-2 pb-2 space-y-2">
        {/* Capability toggles */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={handleAutopilotToggle}
            className={cn(
              'flex items-center gap-1.5 text-[10px] px-2 py-1 rounded transition-colors',
              autoPilotEnabled
                ? 'bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25'
                : 'text-geo-muted hover:text-foreground hover:bg-white/5'
            )}
            title={autoPilotEnabled ? 'Disable Autopilot' : 'Enable Autopilot — allows AI to run R code'}
          >
            {autoPilotEnabled ? <Zap className="w-3 h-3" /> : <ZapOff className="w-3 h-3" />}
            <span>Autopilot {autoPilotEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={() => setPermissionsOpen(true)}
            className="flex items-center gap-1 text-[10px] px-1.5 py-1 rounded text-geo-muted
                       hover:text-foreground hover:bg-white/5 transition-colors"
            title="Choose what the assistant may do in the interface"
          >
            <SlidersHorizontal className="w-3 h-3" />
          </button>

          {/* Internet kill switch — with web off, the only route to the network
              left to the assistant is R code the user watches run in the console. */}
          <button
            onClick={() => setWebAccess(!webAccessEnabled)}
            className={cn(
              'flex items-center gap-1.5 text-[10px] px-2 py-1 rounded transition-colors',
              webAccessEnabled
                ? 'bg-geo-accent/15 text-geo-accent hover:bg-geo-accent/25'
                : 'bg-geo-error/10 text-geo-error hover:bg-geo-error/20'
            )}
            title={webAccessEnabled
              ? 'Cut off the AI\'s internet access — it can then only reach the network through R code you see in the console'
              : 'Internet access is cut off. Click to let the AI search and fetch web pages.'}
          >
            {webAccessEnabled ? <Globe className="w-3 h-3" /> : <GlobeLock className="w-3 h-3" />}
            <span>Web {webAccessEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* Shell access, AND-ed with Autopilot: both must be on. Off by
              default and only ever turned on deliberately. Not a containment
              boundary — R's `system()` already reaches the OS from behind
              Autopilot alone — but the moment the user decides that running
              commands on their machine is part of what the assistant does. */}
          <button
            onClick={() => setTerminalAccess(!terminalEnabled)}
            data-ourgeo-id="ai.terminalSwitch"
            className={cn(
              'flex items-center gap-1.5 text-[10px] px-2 py-1 rounded transition-colors',
              terminalEnabled
                ? 'bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25'
                : 'text-geo-muted hover:text-foreground hover:bg-white/5'
            )}
            title={terminalEnabled
              ? 'The AI can run shell commands in the Terminal panel (Autopilot must also be on). Click to stop it.'
              : 'Let the AI run shell commands in the Terminal panel. Autopilot must be on as well; every command is typed into a tab you can see and logged to the console.'}
          >
            {terminalEnabled
              ? <SquareTerminal className="w-3 h-3" />
              : <TerminalIcon className="w-3 h-3" />}
            <span>Terminal {terminalEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* Error */}
        {sendError && (
          <p className="text-[11px] text-geo-error px-1">{sendError}</p>
        )}

        {/* Input area */}
        <div className="relative">
          {/* Autocomplete dropdown */}
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 mb-1 z-20 w-48 bg-geo-panel border border-geo-border rounded shadow-lg overflow-hidden">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  onClick={() => insertSuggestion(s)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors',
                    i === acSelected ? 'bg-geo-accent/20 text-geo-accent' : 'text-foreground hover:bg-white/5'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message… (Enter to send, Shift+Enter for new line)"
            rows={3}
            disabled={isStreaming}
            className={cn(
              'w-full bg-geo-bg border border-geo-border rounded px-3 py-2 text-xs text-foreground',
              'placeholder:text-geo-muted focus:outline-none focus:border-geo-accent resize-none',
              'disabled:opacity-50'
            )}
          />
        </div>

        <VoiceStatusLine />

        <div className="flex justify-end gap-2">
          <VoiceButton onTranscript={insertTranscript} disabled={isStreaming} />
          {isStreaming ? (
            <Button size="sm" variant="ghost" onClick={cancelStream} className="text-geo-error hover:text-geo-error h-6 px-2">
              <Square className="w-3 h-3 mr-1 fill-geo-error" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!input.trim()}
              className="h-6 px-3"
            >
              <Send className="w-3 h-3 mr-1" />
              Send
            </Button>
          )}
        </div>
      </div>

      <AiPermissionsDialog open={permissionsOpen} onOpenChange={setPermissionsOpen} />
      <AiActionConfirmDialog />

      {/* Autopilot warning dialog */}
      <AutopilotWarningDialog
        open={autopilotDialogOpen}
        onOpenChange={setAutopilotDialogOpen}
        onConfirm={(dismissForever) => {
          setAutoPilot(true)
          if (dismissForever) setAutopilotWarningDismissed(true)
        }}
      />
    </div>
  )
}
