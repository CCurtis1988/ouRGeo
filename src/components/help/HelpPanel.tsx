import React, { useState, useRef, useCallback } from 'react'
import { Search, Home, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { OURGEO_PANELS, type OurGeoPanel, type HelpView } from './helpData'
import {
  HtmlViewer, HomeView, OurGeoView, OurGeoPanelView, ResultsView, DocView, PackageView,
} from './helpViews'

export function HelpPanel(): React.ReactElement {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<HelpView[]>([{ type: 'home' }])
  const [histIdx, setHistIdx] = useState(0)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const current = history[histIdx]
  const canGoBack = histIdx > 0
  const canGoForward = histIdx < history.length - 1

  function navigate(view: HelpView) {
    setHistory((prev) => [...prev.slice(0, histIdx + 1), view])
    setHistIdx((i) => i + 1)
  }

  function goBack() {
    if (canGoBack) setHistIdx((i) => i - 1)
  }

  function goForward() {
    if (canGoForward) setHistIdx((i) => i + 1)
  }

  function goHome() {
    navigate({ type: 'home' })
  }

  // Search on input with debounce
  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return

    setLoading(true)
    try {
      const res = await rClient.searchHelp(trimmed)
      if (res.success && res.result) {
        navigate({ type: 'results', query: trimmed, results: res.result.results })
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [histIdx, history])

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (val.trim()) {
      searchTimeoutRef.current = setTimeout(() => runSearch(val), 400)
    }
  }

  const handleQueryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      runSearch(query)
    }
  }

  const navigateToDoc = useCallback(async (topic: string, pkg?: string) => {
    setLoading(true)
    try {
      const res = await rClient.getHelpDoc(topic, pkg)
      if (res.success && res.result) {
        navigate({
          type: 'doc',
          topic: res.result.topic,
          pkg: res.result.package,
          html: res.result.html,
          examples: res.result.examples,
        })
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [histIdx, history])

  const navigateToPackage = useCallback(async (pkg: string) => {
    setLoading(true)
    try {
      const [infoRes, vigRes] = await Promise.all([
        rClient.getPackageInfo(pkg),
        rClient.getVignettes(pkg),
      ])
      if (infoRes.success && infoRes.result) {
        navigate({
          type: 'package',
          pkg,
          title: infoRes.result.title,
          description: infoRes.result.description,
          functions: infoRes.result.functions,
          vignettes: vigRes.success && vigRes.result ? vigRes.result.vignettes : [],
        })
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [histIdx, history])

  const navigateToVignette = useCallback(async (pkg: string, name: string) => {
    setLoading(true)
    try {
      const res = await rClient.getVignetteContent(pkg, name)
      if (res.success && res.result) {
        navigate({ type: 'vignette', pkg, name, html: res.result.html })
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [histIdx, history])

  function navigateToOurGeo() {
    navigate({ type: 'ourgeo' })
  }

  function navigateToOurGeoPanel(panel: OurGeoPanel) {
    navigate({ type: 'ourgeo-panel', panel })
  }

  // Breadcrumb label for current view
  const breadcrumb = (() => {
    switch (current.type) {
      case 'home': return null
      case 'ourgeo': return 'ouRGeo'
      case 'ourgeo-panel': return `ouRGeo — ${OURGEO_PANELS.find((p) => p.id === current.panel)?.label ?? current.panel}`
      case 'results': return `Search: "${current.query}"`
      case 'doc': return `${current.pkg ? current.pkg + '::' : ''}${current.topic}`
      case 'package': return current.pkg
      case 'vignette': return `${current.pkg} / ${current.name}`
    }
  })()

  return (
    <div className="flex flex-col h-full bg-geo-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 h-9 border-b border-geo-border flex-shrink-0 bg-geo-panel">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
          onClick={goBack}
          disabled={!canGoBack}
          title="Back"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
          onClick={goForward}
          disabled={!canGoForward}
          title="Forward"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
          onClick={goHome}
          title="Home"
        >
          <Home className="w-3.5 h-3.5" />
        </Button>

        <div className="flex-1 relative mx-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-geo-muted pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleQueryKeyDown}
            placeholder="Search functions & packages..."
            className="w-full h-6 pl-6 pr-2 text-xs bg-geo-bg border border-geo-border rounded text-foreground placeholder:text-geo-muted focus:outline-none focus:border-geo-accent"
          />
        </div>

        {loading && <Loader2 className="w-3.5 h-3.5 text-geo-muted animate-spin flex-shrink-0" />}
      </div>

      {/* Breadcrumb */}
      {breadcrumb && (
        <div className="flex items-center px-3 h-6 border-b border-geo-border flex-shrink-0 bg-geo-panel/60">
          <span className="text-[11px] text-geo-muted truncate">{breadcrumb}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0">
        {current.type === 'home' && (
          <HomeView onPackage={navigateToPackage} onOurGeo={navigateToOurGeo} />
        )}
        {current.type === 'ourgeo' && (
          <OurGeoView onPanel={navigateToOurGeoPanel} />
        )}
        {current.type === 'ourgeo-panel' && (
          <OurGeoPanelView panel={current.panel} />
        )}
        {current.type === 'results' && (
          <ResultsView
            results={current.results}
            onDoc={navigateToDoc}
            onPackage={navigateToPackage}
          />
        )}
        {current.type === 'doc' && (
          <DocView view={current} onPackage={navigateToPackage} />
        )}
        {current.type === 'package' && (
          <PackageView
            view={current}
            onDoc={navigateToDoc}
            onVignette={navigateToVignette}
          />
        )}
        {current.type === 'vignette' && (
          <div className="h-full">
            <HtmlViewer html={current.html} />
          </div>
        )}
      </div>
    </div>
  )
}
