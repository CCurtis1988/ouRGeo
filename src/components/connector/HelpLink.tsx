import React from 'react'
import { HelpCircle, ExternalLink } from 'lucide-react'

/**
 * A link to the API's own documentation.
 *
 * Every connector here is a thin shell over somebody else's service, and the
 * questions it cannot answer are the ones people actually get stuck on: what a
 * parameter code means, which sites carry it, why a query that looks right came
 * back empty. Those are all answered on the provider's page, so the panel says
 * where it is rather than leaving the user to search for it.
 *
 * `openExternal` rather than an <a>: the renderer is a file:// page and a plain
 * link would navigate the app away from itself.
 */
export function HelpLink({ url, label }: { url: string; label: string }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => void window.electronAPI.shell.openExternal(url)}
      title={`Open the ${label} documentation in your browser`}
      className="flex items-center gap-1 text-[11px] text-geo-muted hover:text-geo-accent
        border border-geo-border hover:border-geo-accent/50 rounded px-1.5 py-0.5 flex-shrink-0
        transition-colors"
    >
      <HelpCircle className="w-3 h-3" /> Help
      <ExternalLink className="w-2.5 h-2.5" />
    </button>
  )
}
