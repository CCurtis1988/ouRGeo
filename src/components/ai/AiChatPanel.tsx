import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Zap, ZapOff, Plus, Send, Square, ChevronDown, Globe, GlobeLock } from 'lucide-react'
import { Button } from '../ui/button'
import { AiChatMessage } from './AiChatMessage'
import { ModelSelectorPopup } from './ModelSelectorPopup'
import { AutopilotWarningDialog } from './AutopilotWarningDialog'
import { useAiStore } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'
import { useEditorStore } from '@/store/editor'
import { useEnvironmentStore } from '@/store/environment'
import { useSessionStore } from '@/store/session'
import { rClient } from '@/lib/r-client'
import type { AiTool, ToolCall } from '@/lib/ai-client'
import { sendMessage, buildEnvContext, buildConsoleContext, truncateForModel, detectMentionedObjects, getContextSize, resolveContextSize, fetchLocalContextSize, localCtxOverride, PROVIDER_LABELS, isLocalProvider, localBaseUrl, localApiKey, EXECUTE_R_TOOL } from '@/lib/ai-client'
import { WEB_TOOLS, WEB_TOOL_NAMES, runWebTool, describeWebCall } from '@/lib/ai-web-tools'
import { AI_BASE_PROMPT, buildProvenanceRules, buildToolGuidance } from '@/lib/ai-system-prompt'
import { buildDocumentSkill } from '@/lib/ai-skill-documents'
import { buildDocumentContext } from '@/lib/ai-doc-context'
import { DOC_TOOLS, DOC_TOOL_NAMES, runDocTool, describeDocCall } from '@/lib/ai-doc-tools'
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
  const messages = useAiStore((s) => s.messages)
  const isStreaming = useAiStore((s) => s.isStreaming)
  const streamingContent = useAiStore((s) => s.streamingContent)
  const autoPilotEnabled = useAiStore((s) => s.autoPilotEnabled)
  const autopilotWarningDismissed = useAiStore((s) => s.autopilotWarningDismissed)
  const webAccessEnabled = useAiStore((s) => s.webAccessEnabled)
  const tokenUsage = useAiStore((s) => s.tokenUsage)
  const init = useAiStore((s) => s.init)
  const addMessage = useAiStore((s) => s.addMessage)
  const appendStreamChunk = useAiStore((s) => s.appendStreamChunk)
  const finalizeStream = useAiStore((s) => s.finalizeStream)
  const cancelStream = useAiStore((s) => s.cancelStream)
  const clearMessages = useAiStore((s) => s.clearMessages)
  const setAutoPilot = useAiStore((s) => s.setAutoPilot)
  const setAutopilotWarningDismissed = useAiStore((s) => s.setAutopilotWarningDismissed)
  const setWebAccess = useAiStore((s) => s.setWebAccess)
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
  const [sendError, setSendError] = useState<string | null>(null)
  const [acSelected, setAcSelected] = useState(0)
  // Resolved context window (manual override → auto-detected → static → 128k)
  const [contextSize, setContextSize] = useState(() => getContextSize(currentModel))

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

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    const local = isLocalProvider(provider)
    const apiKey = getApiKey()
    if (!local && !apiKey) {
      setSendError(`${PROVIDER_LABELS[provider]} API key not set. Add it in Settings → AI Assistant.`)
      return
    }

    setSendError(null)

    // Refresh environment data so the system prompt reflects the current session state
    const envRes = await rClient.listEnvironments().catch(() => null)
    const currentEnvs = envRes?.success ? envRes.environments : environments
    if (envRes?.success) setEnvironments(envRes.environments)

    // Add user message
    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: text,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setInput('')

    // Build system prompt: role → evidence rules → the tools actually attached
    // this turn → live session context.
    const envContext = buildEnvContext(currentEnvs)
    let systemPrompt = [
      AI_BASE_PROMPT,
      buildProvenanceRules(),
      // Documents are always in the prompt: the model has to know a .Rmd renders
      // in a session of its own before it writes one, not after the knit fails.
      buildDocumentSkill({ hasDocumentTools: true }),
      buildToolGuidance({ autoPilot: autoPilotEnabled, webAccess: webAccessEnabled }),
      envContext,
    ].filter(Boolean).join('\n\n')
    // Give the model awareness of the live console — commands the user ran by
    // hand plus their output — so it knows the session's recent history.
    const consoleContext = buildConsoleContext(useSessionStore.getState().consoleHistory)
    if (consoleContext) systemPrompt += `\n\n${consoleContext}`
    // …and of the editor, so "write this up" can start from what is already open.
    const editorState = useEditorStore.getState()
    const docContext = buildDocumentContext(editorState.tabs, editorState.activeTabId)
    if (docContext) systemPrompt += `\n\n${docContext}`

    // Fetch rich context for mentioned objects
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
            const rows = df.rows.map((r) => r.join(' | ')).join('\n')
            snippets.push(`### \`${name}\` preview\n| ${header} |\n| ${sep} |\n${df.rows.length > 0 ? df.rows.map(r => `| ${r.join(' | ')} |`).join('\n') : ''}`)
          }
        } catch { /* ignore */ }
      }
      if (snippets.length > 0) {
        systemPrompt += `\n\n## Referenced Object Previews\n${snippets.join('\n\n')}`
      }
    }

    // Only the enabled capabilities are attached to the request, so a switch that
    // is off is invisible to the model rather than merely discouraged.
    const tools: AiTool[] = []
    if (autoPilotEnabled) tools.push(EXECUTE_R_TOOL)
    // Document tools carry no switch: they write into a visible, undoable editor
    // tab and never touch disk or the R session.
    tools.push(...DOC_TOOLS)
    if (webAccessEnabled) tools.push(...WEB_TOOLS)

    // Every tool re-checks its switch at call time: flipping one off mid-answer
    // stops the next call rather than waiting for the turn to end.
    const runTool = async (call: ToolCall): Promise<string> => {
      if (call.name === EXECUTE_R_TOOL.name) {
        if (!useAiStore.getState().autoPilotEnabled) {
          return 'Refused: the user turned Autopilot off. Do not run code — give the user code to run and wait for their output.'
        }
        const code = String(call.input.code ?? '')
        addConsoleEntry('input', code)
        const res = await rClient.execute(code)
        // /r/execute returns console text at the top level (`output`), not res.result
        if (res.output) addConsoleEntry('output', res.output)
        else if (res.error) addConsoleEntry('error', res.error)
        return truncateForModel(res.output || res.error || '(no output)')
      }
      if (DOC_TOOL_NAMES.has(call.name)) {
        addConsoleEntry('info', describeDocCall(call.name, call.input))
        return truncateForModel(await runDocTool(call.name, call.input), 24000)
      }
      if (WEB_TOOL_NAMES.has(call.name)) {
        if (!useAiStore.getState().webAccessEnabled) {
          return 'Refused: the user has cut off your internet access. Do not attempt further web calls. Continue from the session\'s data alone and tell the user what you could not look up.'
        }
        // Log every network action so the console stays a complete record of
        // what the assistant did on the user's behalf.
        addConsoleEntry('info', describeWebCall(call.name, call.input))
        return truncateForModel(await runWebTool(call.name, call.input), 16000)
      }
      return `Error: unknown tool "${call.name}".`
    }

    const ac = beginStream()
    const allMessages = [...useAiStore.getState().messages.filter((m) => m.id !== userMsg.id)]
    // include the new user message
    const conversationMessages = [...allMessages, userMsg]

    try {
      const fullContent = await sendMessage({
        provider,
        model: currentModel,
        apiKey,
        localUrl: local ? localBaseUrl(provider, keys) : undefined,
        localApiKey: local ? localApiKey(provider, keys) : undefined,
        contextSize,
        messages: conversationMessages,
        systemPrompt,
        tools,
        onChunk: (chunk) => appendStreamChunk(chunk),
        onToolCall: tools.length > 0 ? runTool : undefined,
        onUsage: (used, total) => setTokenUsage(used, total),
        signal: ac.signal,
      })

      // Attach tool calls/results to the finalized message if in autopilot
      finalizeStream(fullContent)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setSendError(String(e))
        finalizeStream(streamingContent || '')
      }
    }
  }, [input, isStreaming, provider, currentModel, keys, environments, autoPilotEnabled, webAccessEnabled, contextSize,
      addMessage, appendStreamChunk, finalizeStream, beginStream, setTokenUsage, addConsoleEntry, streamingContent, setEnvironments])

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
        <TokenBar used={tokenUsage.used} total={contextSize} />
        <button
          onClick={clearMessages}
          className="flex items-center gap-1 text-[10px] text-geo-muted hover:text-foreground px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors flex-shrink-0"
          title="New conversation"
        >
          <Plus className="w-3 h-3" />
          New
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

        <div className="flex justify-end gap-2">
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
