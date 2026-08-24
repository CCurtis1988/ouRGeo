import React, { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Download, BarChart2 } from 'lucide-react'
import { Button } from '../ui/button'
import { usePlottingStore, buildPlotPopoutState } from '@/store/plotting'
import { useWidgetsStore } from '@/store/widgets'
import { useSessionStore } from '@/store/session'
import { ExportDialog } from './ExportDialog'
import { ChartBuilderDialog } from './ChartBuilderDialog'

type ActiveTab = 'plots' | 'active-views'

export function PlottingPanel(): React.ReactElement {
  const plots = usePlottingStore((s) => s.plots)
  const plotIndex = usePlottingStore((s) => s.currentIndex)
  const plotBack = usePlottingStore((s) => s.goBack)
  const plotForward = usePlottingStore((s) => s.goForward)

  const widgets = useWidgetsStore((s) => s.widgets)
  const widgetIndex = useWidgetsStore((s) => s.currentIndex)
  const widgetBack = useWidgetsStore((s) => s.goBack)
  const widgetForward = useWidgetsStore((s) => s.goForward)

  const rPort = useSessionStore((s) => s.rPort)

  const [activeTab, setActiveTab] = useState<ActiveTab>('plots')
  const [exportOpen, setExportOpen] = useState(false)
  const [chartBuilderOpen, setChartBuilderOpen] = useState(false)

  // Auto-switch to Active Views tab when a new widget arrives
  const widgetCount = widgets.length
  useEffect(() => {
    if (widgetCount > 0) setActiveTab('active-views')
  }, [widgetCount])

  const currentPlot = plotIndex >= 0 ? plots[plotIndex] : null
  const currentWidget = widgetIndex >= 0 ? widgets[widgetIndex] : null

  const handlePlotPopout = () => {
    if (!currentPlot) return
    window.electronAPI.plot.openPopout(buildPlotPopoutState())
  }

  const handleWidgetPopout = () => {
    if (!currentWidget) return
    window.electronAPI.widget.openPopout(currentWidget.id)
  }

  return (
    <div className="flex flex-col h-full bg-geo-panel">
      {/* Header toolbar */}
      <div className="flex items-center justify-between px-2 h-9 border-b border-geo-border flex-shrink-0">
        <div className="flex items-center gap-1">
          {/* Tab buttons */}
          <button
            className={`text-xs font-medium px-2 py-0.5 rounded transition-colors ${
              activeTab === 'plots'
                ? 'text-foreground bg-geo-bg'
                : 'text-geo-muted hover:text-foreground'
            }`}
            onClick={() => setActiveTab('plots')}
          >
            Plots
          </button>
          <button
            className={`text-xs font-medium px-2 py-0.5 rounded transition-colors ${
              activeTab === 'active-views'
                ? 'text-foreground bg-geo-bg'
                : 'text-geo-muted hover:text-foreground'
            }`}
            onClick={() => setActiveTab('active-views')}
          >
            Active Views
            {widgets.length > 0 && (
              <span className="ml-1 text-geo-muted">({widgets.length})</span>
            )}
          </button>

          {/* Navigation arrows — only when there are items in the active tab */}
          {activeTab === 'plots' && plots.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
                onClick={plotBack}
                disabled={plotIndex <= 0}
                title="Previous plot"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-xs text-geo-muted tabular-nums">
                {plotIndex + 1} / {plots.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
                onClick={plotForward}
                disabled={plotIndex >= plots.length - 1}
                title="Next plot"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </>
          )}

          {activeTab === 'active-views' && widgets.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
                onClick={widgetBack}
                disabled={widgetIndex <= 0}
                title="Previous view"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-xs text-geo-muted tabular-nums">
                {widgetIndex + 1} / {widgets.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
                onClick={widgetForward}
                disabled={widgetIndex >= widgets.length - 1}
                title="Next view"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
        </div>

        {/* Right-side action buttons */}
        <div className="flex items-center gap-1">
          {activeTab === 'plots' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
                onClick={() => setChartBuilderOpen(true)}
                title="Create chart"
              >
                <BarChart2 className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
                onClick={handlePlotPopout}
                disabled={!currentPlot}
                title="Open in separate window"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
                onClick={() => setExportOpen(true)}
                disabled={!currentPlot}
                title="Export plot"
              >
                <Download className="w-3.5 h-3.5" />
              </Button>
            </>
          )}

          {activeTab === 'active-views' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-geo-muted hover:text-foreground disabled:opacity-30"
              onClick={handleWidgetPopout}
              disabled={!currentWidget}
              title="Open in separate window"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content area */}
      {activeTab === 'plots' && (
        <div className="flex flex-1 min-h-0 items-center justify-center p-2 bg-geo-bg">
          {currentPlot ? (
            <img
              src={currentPlot.dataUrl}
              alt="R plot"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="text-xs text-geo-muted">No plots yet.</span>
              <span className="text-xs text-geo-muted">Run a plot command in the console.</span>
            </div>
          )}
        </div>
      )}

      {activeTab === 'active-views' && (
        <div className="flex flex-1 min-h-0 bg-geo-bg">
          {currentWidget && rPort ? (
            <iframe
              key={currentWidget.id}
              src={`http://127.0.0.1:${rPort}/widget/${currentWidget.id}`}
              className="w-full h-full border-0"
              title="Active View"
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <span className="text-xs text-geo-muted">No active views yet.</span>
              <span className="text-xs text-geo-muted">
                Run a plotly, leaflet, mapview, or tmap (view mode) command.
              </span>
            </div>
          )}
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        plotId={currentPlot?.plotId ?? null}
      />
      <ChartBuilderDialog open={chartBuilderOpen} onOpenChange={setChartBuilderOpen} />
    </div>
  )
}
