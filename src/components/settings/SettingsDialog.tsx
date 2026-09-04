import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  X, Eye, EyeOff, ChevronDown, HelpCircle,
  Palette, Paintbrush, Puzzle, Cpu, Globe, Map, KeyRound, Bot, FileText, LayoutGrid, Mic,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { VersionHistoryDialog } from './VersionHistoryDialog'
import { APP_VERSION } from './versionHistory'
import { ThemePicker } from './ThemePicker'
import { CodeThemePicker, MarkdownThemePicker } from './EditorThemePicker'
import { RVersionPicker } from './RVersionPicker'
import { InitialExtentPicker } from './InitialExtentPicker'
import { AttributePopupToggle } from './AttributePopupToggle'
import { CrsSettings } from './CrsSettings'
import { AiProviderSettings } from './AiProviderSettings'
import { VoiceSettings } from './VoiceSettings'
import { MapChunkEngineSetting } from './MapChunkEngineSetting'
import { LayoutSettings } from './LayoutSettings'
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

// A collapsible settings section: icon + title + description header that
// expands to reveal its content. Uses a CSS grid-rows trick for a smooth,
// dependency-free open/close animation. Content stays mounted (collapsed
// panels keep their state and effects) but is hidden from tab order.
function SettingsSection({
  icon: Icon,
  title,
  description,
  defaultOpen = false,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  defaultOpen?: boolean
  children: React.ReactNode
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="py-1">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group w-full flex items-center gap-3 py-2.5 text-left"
      >
        <div
          className={`flex items-center justify-center w-8 h-8 rounded-md border shrink-0 transition-colors ${
            open
              ? 'border-geo-accent/40 text-geo-accent bg-geo-accent/10'
              : 'border-geo-border text-geo-muted bg-geo-bg group-hover:text-foreground group-hover:border-geo-muted'
          }`}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-[11px] text-geo-muted truncate">{description}</div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-geo-muted shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="pt-2 pb-3 pl-11 pr-1" aria-hidden={!open}>
            {children}
          </div>
        </div>
      </div>
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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50
            w-[520px] max-h-[85vh] flex flex-col
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
                Configure ouRGeo — expand a section to see its options
              </p>
            </div>
            <Dialog.Close className="text-geo-muted hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-4 py-2 overflow-y-auto divide-y divide-geo-border">
            <SettingsSection
              icon={Palette}
              title="Appearance"
              description="Theme and visual style"
              defaultOpen
            >
              <SubLabel>App Theme</SubLabel>
              <ThemePicker />
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
            </SettingsSection>

            <SettingsSection
              icon={LayoutGrid}
              title="Workspace"
              description="Panel arrangement — dragging, saved layouts, and the way back"
            >
              <LayoutSettings />
            </SettingsSection>

            <SettingsSection
              icon={Cpu}
              title="R Backend"
              description="Which R installation powers ouRGeo"
            >
              <p className="text-[11px] text-geo-muted mb-3 leading-relaxed">
                ouRGeo runs its analysis on a bundled R backend. Pick which R
                installation powers it below, or use “Browse for Rscript…” to point
                ouRGeo at a specific Rscript executable. Your choice is saved and R
                restarts against it.
              </p>
              <RVersionPicker />
            </SettingsSection>

            <SettingsSection
              icon={Globe}
              title="Spatial Editor"
              description="Map extent, drawing, and coordinate systems"
            >
              <SubLabel>Initial Spatial Extent</SubLabel>
              <InitialExtentPicker />
              <SubLabel className="mt-5">Drawing</SubLabel>
              <AttributePopupToggle />
              <SubLabel className="mt-5">Coordinate Reference Systems</SubLabel>
              <CrsSettings />
            </SettingsSection>

            <SettingsSection
              icon={FileText}
              title="Documents"
              description="Markdown and R Markdown authoring"
            >
              <SubLabel>Map chunk code</SubLabel>
              <p className="text-[11px] text-geo-muted mb-2 leading-relaxed">
                The “Chunk: current map” and “Chunk: export current plot” ribbon
                buttons generate R from the layers currently on the map. Pick which
                mapping package that code uses.
              </p>
              <MapChunkEngineSetting />
            </SettingsSection>

            <SettingsSection
              icon={Map}
              title="Basemaps"
              description="Access tokens for basemap tile providers"
            >
              <div className="flex flex-col gap-4">
                {BASEMAP_API_DEFS.map(def => (
                  <ApiKeyEntry key={def.id} {...def} />
                ))}
              </div>
            </SettingsSection>

            <SettingsSection
              icon={KeyRound}
              title="Data API Keys"
              description="Keys for external data sources"
            >
              <ApiKeysPicker />
            </SettingsSection>

            <SettingsSection
              icon={Bot}
              title="AI Assistant"
              description="AI provider and model configuration"
            >
              <AiProviderSettings />
            </SettingsSection>

            <SettingsSection
              icon={Mic}
              title="Voice input"
              description="Dictate to the assistant — microphone, and who transcribes it"
            >
              <VoiceSettings />
            </SettingsSection>

            <SettingsSection
              icon={Puzzle}
              title="Plugins"
              description="Capabilities added to ouRGeo without rebuilding it"
            >
              <PluginManagerLink />
            </SettingsSection>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
