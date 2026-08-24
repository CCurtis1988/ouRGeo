import React from 'react'
import {
  File, FileSpreadsheet, FileJson, FileText, FileCode, FileBox, FileBarChart,
  Sheet, Map, Layers, ImageIcon, Database
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface IconSpec {
  Icon: React.ComponentType<{ className?: string }>
  colorClass: string
}

const EXT_TABLE: Record<string, IconSpec> = {
  csv:      { Icon: FileSpreadsheet, colorClass: 'text-geo-success' },
  tsv:      { Icon: FileSpreadsheet, colorClass: 'text-geo-success' },
  tab:      { Icon: FileSpreadsheet, colorClass: 'text-geo-success' },
  txt:      { Icon: FileText,        colorClass: 'text-geo-muted'   },
  xlsx:     { Icon: Sheet,           colorClass: 'text-geo-success' },
  xls:      { Icon: Sheet,           colorClass: 'text-geo-success' },
  ods:      { Icon: Sheet,           colorClass: 'text-geo-success' },
  json:     { Icon: FileJson,        colorClass: 'text-geo-accent'  },
  geojson:  { Icon: Map,             colorClass: 'text-geo-accent'  },
  parquet:  { Icon: FileBox,         colorClass: 'text-geo-accent'  },
  feather:  { Icon: FileBox,         colorClass: 'text-geo-accent'  },
  sas7bdat: { Icon: FileBarChart,    colorClass: 'text-geo-muted'   },
  sav:      { Icon: FileBarChart,    colorClass: 'text-geo-muted'   },
  dta:      { Icon: FileBarChart,    colorClass: 'text-geo-muted'   },
  shp:      { Icon: Map,             colorClass: 'text-geo-accent'  },
  gpkg:     { Icon: Map,             colorClass: 'text-geo-accent'  },
  kml:      { Icon: Map,             colorClass: 'text-geo-accent'  },
  kmz:      { Icon: Map,             colorClass: 'text-geo-accent'  },
  gml:      { Icon: Map,             colorClass: 'text-geo-accent'  },
  gpx:      { Icon: Map,             colorClass: 'text-geo-accent'  },
  fgb:      { Icon: Map,             colorClass: 'text-geo-accent'  },
  dxf:      { Icon: Map,             colorClass: 'text-geo-accent'  },
  tif:      { Icon: Layers,          colorClass: 'text-geo-accent'  },
  tiff:     { Icon: Layers,          colorClass: 'text-geo-accent'  },
  img:      { Icon: Layers,          colorClass: 'text-geo-accent'  },
  grd:      { Icon: Layers,          colorClass: 'text-geo-accent'  },
  nc:       { Icon: Layers,          colorClass: 'text-geo-accent'  },
  png:      { Icon: ImageIcon,       colorClass: 'text-geo-muted'   },
  jpg:      { Icon: ImageIcon,       colorClass: 'text-geo-muted'   },
  jpeg:     { Icon: ImageIcon,       colorClass: 'text-geo-muted'   },
  gif:      { Icon: ImageIcon,       colorClass: 'text-geo-muted'   },
  bmp:      { Icon: ImageIcon,       colorClass: 'text-geo-muted'   },
  webp:     { Icon: ImageIcon,       colorClass: 'text-geo-muted'   },
  pdf:      { Icon: FileText,        colorClass: 'text-geo-error'   },
  r:        { Icon: FileCode,        colorClass: 'text-geo-accent'  },
  rmd:      { Icon: FileCode,        colorClass: 'text-geo-accent'  },
  qmd:      { Icon: FileCode,        colorClass: 'text-geo-accent'  },
  rgeo:     { Icon: Database,        colorClass: 'text-geo-accent'  },
}

function getExt(name: string): string {
  const i = name.lastIndexOf('.')
  if (i < 0) return ''
  return name.slice(i + 1).toLowerCase()
}

export function FileExtIcon({ name, className }: { name: string; className?: string }): React.ReactElement {
  const spec = EXT_TABLE[getExt(name)]
  const Icon = spec?.Icon ?? File
  const color = spec?.colorClass ?? 'text-geo-muted'
  return <Icon className={cn('w-3 h-3 flex-shrink-0', color, className)} />
}
