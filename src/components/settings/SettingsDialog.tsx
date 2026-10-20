import { AppUpdateSettings } from './AppUpdateDialog'
import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X, Eye, EyeOff, HelpCircle,
  Palette, Paintbrush, Puzzle, Cpu, Globe, Map, KeyRound, Bot, FileText, LayoutGrid, Mic,
  SquareTerminal, Store, HeartPulse, ArrowUpCircle, Package, FolderCog, BellRing,
} from 'lucide-react'
import { VersionHistoryDialog } from './VersionHistoryDialog'
import { APP_VERSION } from './versionHistory'
import { ThemePicker } from './ThemePicker'
import { ThemeBackgroundSettings } from './ThemeBackgroundSettings'
import { ThemeBackgroundVisibility } from './ThemeBackgroundVisibility'
import { CodeThemePicker, MarkdownThemePicker } from './EditorThemePicker'
import { RVersionPicker } from './RVersionPicker'
import { InitialExtentPicker } from './InitialExtentPicker'
import { AttributePopupToggle } from './AttributePopupToggle'
import { CrsSettings } from './CrsSettings'
import { ContextMemorySettings } from './ContextMemorySettings'
import { VoiceSettings } from './VoiceSettings'
import { MapChunkEngineSetting } from './MapChunkEngineSetting'
import { LayoutSettings } from './LayoutSettings'
import { TerminalSettings } from './TerminalSettings'
import { ProjectFileSettings } from './ProjectFileSettings'
import { ProjectSettings } from './ProjectSettings'
import { PromptSettings } from './PromptSettings'
import { useApiKeysStore } from '@/store/apiKeys'
import { useUiStore } from '@/store/ui'

const BASEMAP_API_DEFS = [
  {
    id: 'mapbox',
    label: 'Mapbox',
    description: 'Streets, satellite, and navigation styles. Free tier available at mapbox.com/account/access-tokens',
  },
  {
    id: 'maptiler',
    label: 'MapTiler',
    description: 'Open-source-friendly alternative with terrain and dataviz styles. Free at cloud.maptiler.com/account/keys',
  },
  {
    id: 'stadia',
    label: 'Stadia Maps',
    description: 'Stamen-style maps: terrain, watercolor, toner, and smooth. Free at client.stadiamaps.com',
  },
]

const API_KEY_DEFS = [
  { id: 'kaggle_username', label: 'Kaggle Username', description: 'Your Kaggle account username — found at kaggle.com/settings' },
  { id: 'kaggle', label: 'Kaggle API Key', description: 'From kaggle.com/settings → API → Create New Token (downloads kaggle.json containing the key)' },
  { id: 'census', label: 'US Census Bureau', description: 'Required for tidycensus (ACS, Decennial). Free at api.census.gov/data/key_signup.html' },
  { id: 'cancensus', label: 'Statistics Canada (cancensus)', description: 'Required for cancensus. Free at censusmapper.ca/api' },
  { id: 'noaa', label: 'NOAA Climate Data', description: 'Required for rnoaa. Free at www.ncdc.noaa.gov/cdo-web/token' },
  { id: 'fred', label: 'FRED — Federal Reserve', description: 'Required for fredr. Free at fred.stlouisfed.org/docs/api/api_key.html' },
  { id: 'socrata', label: 'Socrata App Token', description: 'Optional for NYC/Chicago open data portals — increases rate limits' },
]

function ApiKeyEntry({ id, label, description }: { id: string; label: string; description: string }) {
  const value = useApiKeysStore((s) => s.keys[id] ?? '')
  const setKey = useApiKeysStore((s) => s.setKey)
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground">{label}</span>
      </div>
      <p className="text-[11px] text-geo-muted">{description}</p>
      <div className="flex items-center gap-1">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => setKey(id, e.target.value)}
          placeholder="Paste API key here"
          className="flex-1 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent font-mono"
        />
        <button
          className="text-geo-muted hover:text-foreground p-1"
          onClick={() => setShow(v => !v)}
          title={show ? 'Hide' : 'Show'}
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}

function ApiKeysPicker() {
  const init = useApiKeysStore((s) => s.init)
  useEffect(() => { init() }, [init])
  return (
    <div className="flex flex-col gap-4">
      {API_KEY_DEFS.map(def => (
        <ApiKeyEntry key={def.id} {...def} />
      ))}
    </div>
  )
}

/** The way into the Theme Studio.
 *
 *  It opens as a SIBLING of this dialog rather than inside it (see the render
 *  in `EditorLayout`), so Settings is closed on the way — leaving it open
 *  behind a second modal would stack two focus traps and leave the user with a
 *  dialog they cannot reach behind one they can. */
/** The way into the Plugin Manager. A sibling of this dialog, like the Theme
 *  Studio, and for the same focus-trap reason. */
function PluginManagerLink(): React.ReactElement {
  const showDialog = useUiStore((s) => s.showDialog)
  return (
    <button
      onClick={() => showDialog('plugins')}
      data-ourgeo-id="settings.plugins"
      className="mt-2 w-full flex items-center gap-2 rounded-md border border-geo-border
        px-2.5 py-2 text-left hover:border-geo-accent group transition-colors"
    >
      <Puzzle className="w-3.5 h-3.5 text-geo-muted group-hover:text-geo-accent shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-foreground">Plugins…</span>
        <span className="block text-[10px] text-geo-muted leading-snug">
          Capabilities added to ouRGeo without rebuilding it — data connectors, toolbox tools,
          panels. Install, enable and remove them here.
        </span>
      </span>
    </button>
  )
}

/** And the way into the store, beside it. Also a sibling, for the same reason. */
function PluginStoreLink(): React.ReactElement {
  const showDialog = useUiStore((s) => s.showDialog)
  return (
    <button
      onClick={() => showDialog('plugin-store')}
      data-ourgeo-id="settings.pluginStore"
      className="mt-2 w-full flex items-center gap-2 rounded-md border border-geo-border
        px-2.5 py-2 text-left hover:border-geo-accent group transition-colors"
    >
      <Store className="w-3.5 h-3.5 text-geo-muted group-hover:text-geo-accent shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-foreground">Plugin Store…</span>
        <span className="block text-[10px] text-geo-muted leading-snug">
          Plugins written by other ouRGeo users, reviewed before they appear. Anything you
          install arrives switched off.
        </span>
      </span>
    </button>
  )
}

function ThemeStudioLink(): React.ReactElement {
  const showDialog = useUiStore((s) => s.showDialog)
  return (
    <button
      onClick={() => showDialog('theme-studio')}
      data-ourgeo-id="settings.themeStudio"
      className="mt-2 w-full flex items-center gap-2 rounded-md border border-geo-border
        px-2.5 py-2 text-left hover:border-geo-accent group transition-colors"
    >
      <Paintbrush className="w-3.5 h-3.5 text-geo-muted group-hover:text-geo-accent shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-foreground">Theme Studio…</span>
        <span className="block text-[10px] text-geo-muted leading-snug">
          Build your own app, code and markdown themes — colours, editor backdrop,
          card image — or import and export them as files.
        </span>
      </span>
    </button>
  )
}

// Small label used to separate sub-groups inside a section.
function SubLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-medium uppercase tracking-wider text-geo-muted mb-2 ${className}`}>
      {children}
    </p>
  )
}

interface SettingsDialogProps {
  children: React.ReactNode
  /** Controlled visibility. Omitted, the trigger owns it as before — passed,
   *  the ui store does, so Settings can be opened from outside this tree. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SettingsDialog({ children, open, onOpenChange }: SettingsDialogProps): React.ReactElement {
  const [selected, setSelected] = useState('Appearance')
  const sections = [
    {
      title: 'Health check', group: 'Application', icon: HeartPulse,
      description: 'Check your installation, repair R packages, and set up AI',
      content: <>
        <p className="text-xs text-geo-muted mb-3">Run guided diagnostics whenever something needs attention, including after updating R. Installations and AI credit use require your approval.</p>
        <button className="rounded border border-geo-border px-3 py-2 text-xs text-foreground hover:bg-geo-bg" onClick={() => useUiStore.getState().showDialog('health-check')}>Run health check…</button>
      </>,
    },
    { title: 'Updates', group: 'Application', icon: ArrowUpCircle, description: 'Published installers and update reminders', content: <AppUpdateSettings /> },
    {
      title: 'Appearance', group: 'Application', icon: Palette,
      description: 'Theme and visual style',
      content: <>
        <SubLabel>App Theme</SubLabel>
        <ThemePicker />
        <ThemeBackgroundSettings />
        <ThemeBackgroundVisibility />
        <ThemeStudioLink />
        <SubLabel className="mt-5">Code Editor Theme</SubLabel>
        <p className="text-[11px] text-geo-muted mb-2 leading-relaxed">
          Syntax colours for R — in .R files and in R Markdown chunks. The
          editor background and the artwork behind it come from the app
          theme, and never change with this.
        </p>
        <CodeThemePicker />
        <SubLabel className="mt-5">Markdown Theme</SubLabel>
        <p className="text-[11px] text-geo-muted mb-2 leading-relaxed">
          Prose colours for .md, .Rmd and .qmd — headings, links, quotes
          and inline code, in both Source and Visual mode.
        </p>
        <MarkdownThemePicker />
      </>,
    },
    {
      title: 'Projects', group: 'Application', icon: FolderCog,
      description: 'Unsaved work, R snapshots, and drafts kept on this computer',
      content: <ProjectSettings />,
    },
    {
      title: 'Prompts', group: 'Application', icon: BellRing,
      description: 'Every question you have told ouRGeo not to ask again — and the way back',
      content: <PromptSettings />,
    },
    {
      title: 'Workspace', group: 'Application', icon: LayoutGrid,
      description: 'Panel arrangement — dragging, saved layouts, and the way back',
      content: <>
        <LayoutSettings />
      </>,
    },
    {
      title: 'Terminal', group: 'Application', icon: SquareTerminal,
      description: 'Which shell opens, and how it looks',
      content: <>
        <TerminalSettings />
      </>,
    },
    {
      title: 'R Backend', group: 'Application', icon: Cpu,
      description: 'Which R installation powers ouRGeo',
      content: <>
        <p className="text-[11px] text-geo-muted mb-3 leading-relaxed">
          ouRGeo runs its analysis on a bundled R backend. Pick which R
          installation powers it below, or use “Browse for Rscript…” to point
          ouRGeo at a specific Rscript executable. Your choice is saved and R
          restarts against it.
        </p>
        <RVersionPicker />
      </>,
    },
    {
      title: 'Spatial Editor', group: 'Maps & data', icon: Globe,
      description: 'Map extent, drawing, and coordinate systems',
      content: <>
        <SubLabel>Initial Spatial Extent</SubLabel>
        <InitialExtentPicker />
        <SubLabel className="mt-5">Drawing</SubLabel>
        <AttributePopupToggle />
        <SubLabel className="mt-5">Coordinate Reference Systems</SubLabel>
        <CrsSettings />
      </>,
    },
    {
      title: 'Documents', group: 'Application', icon: FileText,
      description: 'Markdown and R Markdown authoring',
      content: <>
        <SubLabel>Map chunk code</SubLabel>
        <p className="text-[11px] text-geo-muted mb-2 leading-relaxed">
          The “Chunk: current map” and “Chunk: export current plot” ribbon
          buttons generate R from the layers currently on the map. Pick which
          mapping package that code uses.
        </p>
        <MapChunkEngineSetting />
      </>,
    },
    {
      title: 'Project Files', group: 'Maps & data', icon: Package,
      description: 'Saving exports into this project’s file library',
      content: <>
        <ProjectFileSettings onOpenPrompts={() => setSelected('Prompts')} />
      </>,
    },
    {
      title: 'Basemaps', group: 'Maps & data', icon: Map,
      description: 'Access tokens for basemap tile providers',
      content: <>
        <div className="flex flex-col gap-4">
          {BASEMAP_API_DEFS.map(def => (
            <ApiKeyEntry key={def.id} {...def} />
          ))}
        </div>
      </>,
    },
    {
      title: 'Data API Keys', group: 'Maps & data', icon: KeyRound,
      description: 'Keys for external data sources',
      content: <>
        <ApiKeysPicker />
      </>,
    },
    {
      title: 'AI Assistant', group: 'Assistant', icon: Bot,
      description: 'Memory, model, learning, privacy and budgets',
      content: <>
        <ContextMemorySettings />
      </>,
    },
    {
      title: 'Voice input', group: 'Assistant', icon: Mic,
      description: 'Dictate to the assistant — microphone, and who transcribes it',
      content: <>
        <VoiceSettings />
      </>,
    },
    {
      title: 'Plugins', group: 'Extensions', icon: Puzzle,
      description: 'Capabilities added to ouRGeo without rebuilding it',
      content: <>
        <PluginStoreLink />
        <PluginManagerLink />
      </>,
    },
  ]
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[880px] max-w-[95vw] h-[min(760px,85vh)] flex flex-col
            bg-geo-panel border border-geo-border rounded-lg shadow-xl
            focus:outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-geo-border shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <Dialog.Title className="text-sm font-semibold text-foreground">
                  Settings
                </Dialog.Title>
                <span className="text-[11px] font-medium text-geo-muted border border-geo-border rounded px-1.5 py-0.5">
                  ouRGeo v{APP_VERSION}
                </span>
                <VersionHistoryDialog>
                  <button
                    className="text-geo-muted hover:text-geo-accent transition-colors"
                    title="View version history"
                    aria-label="View version history"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                </VersionHistoryDialog>
              </div>
              <p className="text-[11px] text-geo-muted mt-1">
                Choose a category to find its settings
              </p>
            </div>
            <Dialog.Close aria-label="Close settings" className="text-geo-muted hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav aria-label="Settings categories" className="shrink-0 border-b sm:border-b-0 sm:border-r border-geo-border bg-geo-bg/40 p-3 sm:w-44 overflow-auto">
              <label className="sm:hidden text-xs text-geo-muted">Settings category
                <select aria-label="Settings category" className="mt-1 w-full rounded border border-geo-border bg-geo-bg p-2 text-foreground" value={selected} onChange={event => setSelected(event.target.value)}>
                  {sections.map(section => <option key={section.title}>{section.title}</option>)}
                </select>
              </label>
              <div className="hidden sm:block space-y-4">
                {['Application', 'Maps & data', 'Assistant', 'Extensions'].map(group => <div key={group}>
                  <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-geo-muted">{group}</p>
                  <div className="space-y-1">
                    {sections.filter(section => section.group === group).map(({ title, icon: Icon }) => <button
                      key={title} type="button" aria-current={selected === title ? 'page' : undefined}
                      onClick={() => setSelected(title)}
                      className={`w-full flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent ${selected === title ? 'border-geo-accent/40 bg-geo-accent/10 text-geo-accent font-semibold' : 'border-transparent text-geo-muted hover:bg-geo-panel hover:text-foreground'}`}
                    ><Icon className="w-4 h-4 shrink-0" />{title}</button>)}
                  </div>
                </div>)}
              </div>
            </nav>
            <div className="min-w-0 min-h-0 flex-1 overflow-hidden p-5">
              {sections.map(({ title, description, content }) => <section key={title} aria-label={`${title} settings`} hidden={selected !== title} className="h-full">
                <div className="flex h-full min-h-0 flex-col gap-4">
                  <div className="shrink-0 border-b border-geo-border pb-3">
                    <h2 className="text-base font-semibold text-foreground">{title}</h2>
                    <p className="mt-1 text-xs text-geo-muted">{description}</p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
                </div>
              </section>)}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
