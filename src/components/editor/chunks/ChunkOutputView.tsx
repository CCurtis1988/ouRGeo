import React from 'react'
import { Loader2, X, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { useChunkStore } from '@/store/chunks'
import { cn } from '@/lib/utils'

interface Props {
  tabId: string
  chunkId: string
}

/**
 * One chunk's output, rendered inside a Monaco view zone.
 *
 * Mounted via createPortal from the CodeEditor tree (not a separate createRoot)
 * so it keeps React context — theme store, zustand subscriptions — and is torn
 * down with the tree instead of leaking a root nothing disposes.
 */
export function ChunkOutputView({ tabId, chunkId }: Props): React.ReactElement | null {
  const out = useChunkStore((s) => s.outputs[tabId]?.[chunkId])
  const toggle = useChunkStore((s) => s.toggleCollapsed)
  const clear = useChunkStore((s) => s.clearChunk)

  if (!out || out.status === 'idle') return null

  const running = out.status === 'running' || out.status === 'queued'
  const hasBody = !!out.stdout || !!out.error || out.plots.length > 0 || out.widgets.length > 0 || out.skipped

  return (
    <div
      className={cn(
        'ourgeo-chunk-output text-[11px] border-l-2 ml-[1px]',
        out.error ? 'border-geo-error/60' : 'border-geo-accent/40',
        // Stale output stays visible but visibly demoted — the code that
        // produced it has changed, so it is evidence of the past, not the present.
        out.stale && 'opacity-50'
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-0.5 text-geo-muted">
        {hasBody && (
          <button
            onClick={() => toggle(tabId, chunkId)}
            className="hover:text-foreground"
            title={out.collapsed ? 'Show output' : 'Hide output'}
          >
            {out.collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
        {running && <Loader2 className="w-3 h-3 animate-spin text-geo-accent" />}
        <span className="flex-1 truncate">
          {out.status === 'queued' && 'Queued…'}
          {out.status === 'running' && 'Running…'}
          {out.skipped && 'Not run (eval = FALSE)'}
          {out.status === 'error' && 'Error'}
          {out.status === 'done' && !out.skipped && (
            <>
              {out.plots.length > 0 && `${out.plots.length} plot${out.plots.length > 1 ? 's' : ''}`}
              {out.widgets.length > 0 && `${out.plots.length > 0 ? ' · ' : ''}${out.widgets.length} interactive figure${out.widgets.length > 1 ? 's' : ''}`}
              {(out.plots.length > 0 || out.widgets.length > 0) && (out.stdout ? ' · ' : '')}
              {out.stdout ? 'output' : ''}
              {!out.plots.length && !out.widgets.length && !out.stdout && 'No output'}
            </>
          )}
          {out.stale && ' · stale'}
        </span>
        {out.durationMs != null && out.status === 'done' && (
          <span className="flex items-center gap-0.5 text-[10px] opacity-70">
            <Clock className="w-2.5 h-2.5" />
            {out.durationMs < 1000
              ? `${Math.round(out.durationMs)} ms`
              : `${(out.durationMs / 1000).toFixed(1)} s`}
          </span>
        )}
        <button
          onClick={() => clear(tabId, chunkId)}
          className="hover:text-foreground"
          title="Clear output"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {!out.collapsed && (
        <div className="px-2 pb-1.5 space-y-1.5">
          {out.stdout && (
            <pre className="whitespace-pre-wrap font-mono text-foreground/90 overflow-x-auto m-0">
              {out.stdout}
            </pre>
          )}
          {out.error && (
            <pre className="whitespace-pre-wrap font-mono text-geo-error overflow-x-auto m-0">
              {out.error}
            </pre>
          )}
          {out.plots.map((p, i) => (
            <img
              key={i}
              src={p.dataUrl}
              alt={`Plot ${i + 1}`}
              className="max-w-full block rounded border border-geo-border"
              // Images report height 0 until decoded, which would leave the view
              // zone collapsed; nudge a re-measure once the real size is known.
              onLoad={(e) => e.currentTarget.dispatchEvent(
                new Event('ourgeo-img-loaded', { bubbles: true })
              )}
            />
          ))}
          {out.widgets.map((url) => (
            <iframe key={url} src={url} title="Interactive figure" className="w-full h-[420px] border border-geo-border rounded bg-white" />
          ))}
        </div>
      )}
    </div>
  )
}
