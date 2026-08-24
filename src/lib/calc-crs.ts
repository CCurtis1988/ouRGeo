/**
 * Curated projected CRS choices for planar spatial calculations, shared by
 * the Settings dropdown and each tool's Calculation CRS override.
 *
 * 'auto' resolves per input in R at run time via `ourgeo_calc_crs()`:
 * projected data passes through unchanged; geographic data maps to the UTM
 * zone of its bbox centre. The regional entries are equal-area / national
 * grids that keep distances and areas faithful over their region. Every
 * EPSG code below is validated against the PROJ database (regions best
 * served by strip/zone systems — e.g. Turkey, Argentina — are deliberately
 * left to auto-detect).
 */
export interface CalcCrsChoice {
  value: string
  label: string
}

export const CALC_CRS_CHOICES: CalcCrsChoice[] = [
  { value: 'auto', label: 'Auto-detect (UTM zone from data centroid)' },
  { value: '3857', label: 'World — Web Mercator (EPSG:3857)' },
  // Americas
  { value: '5070', label: 'United States — CONUS Albers (EPSG:5070)' },
  { value: '3338', label: 'Alaska — NAD83 Alaska Albers (EPSG:3338)' },
  { value: '3347', label: 'Canada — Statistics Canada Lambert (EPSG:3347)' },
  { value: '6372', label: 'Mexico — ITRF2008 / LCC (EPSG:6372)' },
  { value: '9377', label: 'Colombia — MAGNA-SIRGAS 2018 Origen-Nacional (EPSG:9377)' },
  { value: '5880', label: 'Brazil — SIRGAS 2000 Polyconic (EPSG:5880)' },
  { value: '9155', label: 'Chile — SIRGAS-Chile / UTM 19S (EPSG:9155)' },
  // Europe
  { value: '3035', label: 'Europe — ETRS89-extended LAEA (EPSG:3035)' },
  { value: '27700', label: 'United Kingdom — British National Grid (EPSG:27700)' },
  { value: '2157', label: 'Ireland — Irish Transverse Mercator (EPSG:2157)' },
  { value: '2154', label: 'France — RGF93 Lambert-93 (EPSG:2154)' },
  { value: '25830', label: 'Spain & Portugal — ETRS89 / UTM 30N (EPSG:25830)' },
  { value: '25832', label: 'Central Europe — ETRS89 / UTM 32N (EPSG:25832)' },
  { value: '28992', label: 'Netherlands — Amersfoort / RD New (EPSG:28992)' },
  { value: '2056', label: 'Switzerland — CH1903+ / LV95 (EPSG:2056)' },
  { value: '2180', label: 'Poland — ETRF2000-PL / CS92 (EPSG:2180)' },
  { value: '3006', label: 'Sweden — SWEREF99 TM (EPSG:3006)' },
  { value: '3067', label: 'Finland — TM35FIN (EPSG:3067)' },
  // Asia & Middle East
  { value: '7755', label: 'India — WGS 84 / India NSF LCC (EPSG:7755)' },
  { value: '5179', label: 'South Korea — KGD2002 Unified CS (EPSG:5179)' },
  { value: '3100', label: 'Japan — JGD2000 / UTM 54N (EPSG:3100)' },
  { value: '3414', label: 'Singapore — SVY21 / Singapore TM (EPSG:3414)' },
  { value: '2039', label: 'Israel — Israeli TM Grid (EPSG:2039)' },
  // Oceania
  { value: '3577', label: 'Australia — GDA94 Australian Albers (EPSG:3577)' },
  { value: '2193', label: 'New Zealand — NZTM2000 (EPSG:2193)' },
  // Africa
  { value: '9221', label: 'South Africa — Hartebeesthoek94 / ZAF Albers (EPSG:9221)' },
  // Polar
  { value: '32661', label: 'Arctic — WGS 84 / UPS North (EPSG:32661)' },
  { value: '3031', label: 'Antarctic — Polar Stereographic (EPSG:3031)' },
]

export function calcCrsLabel(value: string): string {
  return CALC_CRS_CHOICES.find((c) => c.value === value)?.label ?? `EPSG:${value}`
}
