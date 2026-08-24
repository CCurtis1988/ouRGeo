// ── Export dialog: types, presets, and pure helpers ──────────────────────────
import type { TextAlign, FontFace, TmapCompassType } from '@/lib/map-annotations'
import type { NorthArrowStyle } from '@/store/spatial'

export type ExportFormat = 'png' | 'jpg' | 'pdf'
export type ExportUnit = 'px' | 'in' | 'cm'

export const DPI_PRESETS = [72, 96, 150, 300, 600]
export const FONT_FACES: { value: FontFace; label: string }[] = [
  { value: 'plain',       label: 'Normal' },
  { value: 'bold',        label: 'Bold' },
  { value: 'italic',      label: 'Italic' },
  { value: 'bold.italic', label: 'B+I' },
]
export const ALIGNS: { value: TextAlign; label: string }[] = [
  { value: 'left',   label: 'L' },
  { value: 'center', label: 'C' },
  { value: 'right',  label: 'R' },
]

// ── Aspect ratio helpers & presets ──────────────────────────────────

export type ArOrientation = 'landscape' | 'portrait'

export const AR_PRESETS = [
  { id: 'editor', label: 'Editor',  rw: 0,   rh: 0   },
  { id: 'none',   label: 'None',    rw: 0,   rh: 0   },
  { id: 'square', label: '1:1',     rw: 1,   rh: 1   },
  { id: '4-3',    label: '4:3',     rw: 4,   rh: 3   },
  { id: '16-9',   label: '16:9',    rw: 16,  rh: 9   },
  { id: 'a4',     label: 'A4',      rw: 297, rh: 210 },
  { id: 'a3',     label: 'A3',      rw: 420, rh: 297 },
  { id: 'a2',     label: 'A2',      rw: 594, rh: 420 },
  { id: 'a1',     label: 'A1',      rw: 841, rh: 594 },
  { id: 'letter', label: 'Letter',  rw: 110, rh: 85  },
  { id: 'legal',  label: 'Legal',   rw: 140, rh: 85  },
  { id: 'custom', label: 'Custom',  rw: 0,   rh: 0   },
] as const

export function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b) }

export function toRatioString(w: number, h: number): string {
  const scale = 100
  const g = gcd(Math.round(w * scale), Math.round(h * scale))
  const rw = Math.round(w * scale) / g
  const rh = Math.round(h * scale) / g
  if (rw <= 32 && rh <= 32 && Number.isInteger(rw) && Number.isInteger(rh)) return `${rw} : ${rh}`
  return `${(w / h).toFixed(2)} : 1`
}

export function adjustBboxForAspectRatio(
  bbox: [number, number, number, number],
  arW: number,
  arH: number,
): [number, number, number, number] {
  const [west, south, east, north] = bbox
  const centerLon = (west + east) / 2
  const centerLat = (south + north) / 2
  const lonSpan = east - west
  const latSpan = north - south
  const cosLat = Math.cos((centerLat * Math.PI) / 180)
  const targetAR = arW / arH
  const currentAR = (lonSpan * cosLat) / latSpan
  if (targetAR > currentAR) {
    const newLon = (latSpan * targetAR) / cosLat
    return [centerLon - newLon / 2, south, centerLon + newLon / 2, north]
  } else {
    const newLat = (lonSpan * cosLat) / targetAR
    return [west, centerLat - newLat / 2, east, centerLat + newLat / 2]
  }
}

export function northArrowStyleToTmap(style: NorthArrowStyle): TmapCompassType {
  switch (style) {
    case 'compass': return '4star'
    default:        return 'arrow'
  }
}
