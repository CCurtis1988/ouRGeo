import { useId, useState } from 'react'

interface SettingsPage {
  id: string
  title: string
  description: string
  content: React.ReactNode
  headingPlacement?: 'page' | 'content'
}

/** Keep edits mounted when navigating, while hidden pages leave the tab order. */
export function SettingsPages({ label, pages, initialPage }: { label: string; pages: SettingsPage[]; initialPage: string }): React.ReactElement {
  const [selected, setSelected] = useState(initialPage)
  const id = useId()
  return <div className="flex h-full min-h-0 flex-col gap-4">
    <label className="sm:hidden shrink-0 text-xs text-geo-muted">Assistant settings page
      <select aria-label={label} value={selected} onChange={event => setSelected(event.target.value)} className="mt-1 w-full rounded border border-geo-border bg-geo-bg p-2 text-foreground">
        {pages.map(page => <option key={page.id} value={page.id}>{page.title}</option>)}
      </select>
    </label>
    <div role="tablist" aria-label={label} className="hidden sm:flex shrink-0 flex-wrap gap-2 border-b border-geo-border pb-3">
      {pages.map((page, index) => <button key={page.id} type="button" role="tab"
        id={`${id}-${page.id}-tab`} aria-controls={`${id}-${page.id}-panel`}
        aria-selected={selected === page.id} tabIndex={selected === page.id ? 0 : -1}
        onClick={() => setSelected(page.id)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % pages.length
            : event.key === 'ArrowLeft' ? (index + pages.length - 1) % pages.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : null
          if (next === null) return
          event.preventDefault()
          setSelected(pages[next].id)
          document.getElementById(`${id}-${pages[next].id}-tab`)?.focus()
        }}
        className={`rounded-md border px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent ${selected === page.id ? 'border-geo-accent bg-geo-accent/10 text-geo-accent font-semibold' : 'border-geo-border bg-geo-bg text-geo-muted hover:text-foreground hover:border-geo-muted'}`}
      >{page.title}</button>)}
    </div>
    {pages.map(page => <div key={page.id} role="tabpanel" id={`${id}-${page.id}-panel`}
      aria-labelledby={`${id}-${page.id}-tab`} hidden={selected !== page.id} tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-geo-accent">
      <div>
        {page.headingPlacement !== 'content' && <h3 className="text-sm font-semibold text-foreground">{page.title}</h3>}
        <p className="mt-1 text-xs text-geo-muted leading-relaxed">{page.description}</p>
      </div>
      {page.content}
    </div>)}
  </div>
}
