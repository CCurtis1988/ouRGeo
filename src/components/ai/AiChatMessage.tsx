import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Copy, Check, X, ChevronDown, ChevronRight, Terminal } from 'lucide-react'
import type { ChatMessage } from '@/store/ai'
import { cn } from '@/lib/utils'

interface Props {
  message: ChatMessage
  isStreaming?: boolean
  streamingContent?: string
}

/**
 * Put `text` on the clipboard and say so.
 *
 * `failed` is a real state, not defensive padding: the old version set
 * `copied` before the write had resolved, so a rejected write — no permission,
 * a non-secure context — showed a tick over an unchanged clipboard, and the
 * user only found out when they pasted. A copy button that lies is worse than
 * one that is missing.
 */
function CopyButton({ text, className, title }: {
  text: string
  className?: string
  title?: string
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = (e: React.MouseEvent): void => {
    // Inside the message, which in a chat panel is a click target for other
    // things (a code block's own selection, a link).
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(
      () => setState('copied'),
      () => setState('failed'),
    ).finally(() => { setTimeout(() => setState('idle'), 1500) })
  }
  return (
    <button
      onClick={copy}
      title={state === 'failed' ? 'Could not reach the clipboard' : title ?? 'Copy'}
      aria-label={title ?? 'Copy'}
      className={cn(
        'p-1 rounded text-geo-muted hover:text-foreground hover:bg-white/5 transition-colors',
        className,
      )}
    >
      {state === 'copied' ? <Check className="w-3 h-3 text-geo-success" />
        : state === 'failed' ? <X className="w-3 h-3 text-geo-error" />
        : <Copy className="w-3 h-3" />}
    </button>
  )
}

function ToolCallBlock({ code, result }: { code: string; result?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-2 rounded border border-geo-border bg-geo-bg text-[11px]">
      <button
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-geo-muted hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
        <Terminal className="w-3 h-3 flex-shrink-0" />
        <span className="flex-1 truncate font-mono">{code.split('\n')[0]}{code.includes('\n') ? ' …' : ''}</span>
      </button>
      {open && (
        <div className="border-t border-geo-border">
          <pre className="px-3 py-2 text-foreground font-mono whitespace-pre-wrap overflow-x-auto">{code}</pre>
          {result !== undefined && (
            <>
              <div className="h-px bg-geo-border" />
              <pre className={cn(
                'px-3 py-2 font-mono whitespace-pre-wrap overflow-x-auto',
                result.startsWith('Error') ? 'text-geo-error' : 'text-geo-success'
              )}>{result || '(no output)'}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function AiChatMessage({ message, isStreaming, streamingContent }: Props): React.ReactElement {
  const isUser = message.role === 'user'
  const content = isStreaming ? streamingContent ?? '' : message.content

  return (
    <div className={cn('group flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      {/* Tool calls (Autopilot) */}
      {message.toolCalls?.map((tc, i) => (
        <ToolCallBlock
          key={tc.id}
          code={tc.code}
          result={message.toolResults?.[i]?.output}
        />
      ))}

      {/* Message bubble */}
      <div
        className={cn(
          'max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed',
          isUser
            ? 'bg-geo-accent/20 text-foreground'
            : 'bg-geo-panel border border-geo-border text-foreground'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose-ai">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                pre: ({ children, ...props }) => (
                  <div className="relative group my-2">
                    <pre
                      className="bg-geo-bg border border-geo-border rounded p-3 overflow-x-auto text-[11px]"
                      {...props}
                    >
                      {children}
                    </pre>
                    {/* Extract text from code node for copy */}
                    <CopyButton
                      text={extractText(children)}
                      title="Copy this code"
                      className="absolute top-2 right-2 bg-geo-panel/80 opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                ),
                code: ({ className, children, ...props }) => {
                  const isBlock = className?.includes('language-')
                  return isBlock ? (
                    <code className={cn(className, 'text-[11px]')} {...props}>{children}</code>
                  ) : (
                    <code className="bg-geo-bg border border-geo-border rounded px-1 py-0.5 text-[11px] font-mono text-geo-accent" {...props}>
                      {children}
                    </code>
                  )
                },
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
                li: ({ children }) => <li className="text-xs">{children}</li>,
                h1: ({ children }) => <h1 className="text-sm font-semibold mb-2 mt-3 first:mt-0">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xs font-semibold mb-1.5 mt-2.5 first:mt-0">{children}</h2>,
                h3: ({ children }) => <h3 className="text-xs font-medium mb-1 mt-2 first:mt-0">{children}</h3>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-geo-accent/50 pl-3 text-geo-muted italic my-2">{children}</blockquote>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-2">
                    <table className="text-[11px] border-collapse w-full">{children}</table>
                  </div>
                ),
                th: ({ children }) => <th className="border border-geo-border px-2 py-1 bg-geo-bg text-left font-medium">{children}</th>,
                td: ({ children }) => <td className="border border-geo-border px-2 py-1">{children}</td>,
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer" className="text-geo-accent hover:underline">{children}</a>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 bg-geo-accent/80 animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        )}
      </div>

      {/*
        One copy button per message, on the side its bubble is on.

        BELOW the bubble, not in a corner of it: the assistant's own code
        blocks already carry a copy button at their top-right, and a second one
        in the bubble's corner would sit on top of the first whenever a message
        opens with code. Below, the two can never collide, and it reads as what
        it is — an action on the whole message rather than on part of it.

        The row is always in the layout and only its opacity changes. Revealing
        it on hover would grow the column by its height at the moment the
        pointer arrives, nudging every message below it — a list that moves
        under the cursor is a list you cannot click accurately.

        Not shown while streaming: the answer is not finished, and a button
        offering to copy a partial one is offering the wrong thing.
      */}
      {!isStreaming && content.trim() !== '' && (
        <div className={cn(
          'flex h-4 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity',
          isUser ? 'pr-0.5' : 'pl-0.5',
        )}>
          <CopyButton
            text={content}
            title={isUser ? 'Copy your message' : 'Copy this reply'}
            className="-my-1"
          />
        </div>
      )}
    </div>
  )
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) return extractText((node.props as { children?: React.ReactNode }).children)
  return ''
}
