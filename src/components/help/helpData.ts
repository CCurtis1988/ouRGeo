// ── Help panel: types and static data ────────────────────────────────────────
import {
  Package, Code2, Terminal, Layers, Globe, ImageIcon, Bot, Wrench, FolderInput, Cloud,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HelpSearchResult } from '@/lib/r-client'

// Types
// ---------------------------------------------------------------------------
export type OurGeoPanel =
  | 'editor' | 'console' | 'environment' | 'packages'
  | 'spatial' | 'plotting' | 'ai'
  | 'toolbox' | 'loaddata' | 'connector'

export type HelpView =
  | { type: 'home' }
  | { type: 'ourgeo' }
  | { type: 'ourgeo-panel'; panel: OurGeoPanel }
  | { type: 'results'; query: string; results: HelpSearchResult[] }
  | { type: 'doc'; topic: string; pkg: string; html: string; examples: string }
  | { type: 'package'; pkg: string; title: string; description: string; functions: string[]; vignettes: { name: string; title: string }[] }
  | { type: 'vignette'; pkg: string; name: string; html: string }

// ---------------------------------------------------------------------------
// ouRGeo panel metadata
// ---------------------------------------------------------------------------
export const OURGEO_PANELS: { id: OurGeoPanel; label: string; Icon: LucideIcon; tagline: string }[] = [
  { id: 'editor',      label: 'Code Editor',    Icon: Code2,       tagline: 'Write and run R code' },
  { id: 'console',     label: 'R Console',      Icon: Terminal,    tagline: 'See output and type commands directly' },
  { id: 'environment', label: 'Environment',    Icon: Layers,      tagline: 'See everything stored in R\'s memory' },
  { id: 'packages',    label: 'Packages',       Icon: Package,     tagline: 'Install and manage R packages' },
  { id: 'spatial',     label: 'Spatial Editor', Icon: Globe,       tagline: 'View and edit geographic data' },
  { id: 'plotting',    label: 'Plotting Panel', Icon: ImageIcon,   tagline: 'Preview charts and graphs' },
  { id: 'ai',          label: 'AI Assistant',   Icon: Bot,         tagline: 'Get coding help from AI' },
  { id: 'toolbox',     label: 'Toolbox',        Icon: Wrench,      tagline: 'Run spatial tools without writing code' },
  { id: 'loaddata',    label: 'Load Data',      Icon: FolderInput, tagline: 'Import data files into R' },
  { id: 'connector',   label: 'Data Connector', Icon: Cloud,       tagline: 'Connect to external data sources' },
]

export const POPULAR_PACKAGES = [
  'ggplot2', 'dplyr', 'tidyr', 'sf', 'terra', 'data.table',
  'lubridate', 'stringr', 'purrr', 'readr', 'tibble', 'forcats',
  'ggthemes', 'scales', 'leaflet', 'tmap', 'sp', 'raster',
  'stats', 'base', 'utils', 'graphics'
]
