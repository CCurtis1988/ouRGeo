// The list of available Web-API providers, grouped by category for the picker.
// Add a provider here to surface it as a new connector in the Web APIs tab.
//
// The list is LIVE: a plugin can contribute a provider — usually a declarative
// JSON spec compiled by `declarative.ts`, sometimes real code — and the Web
// APIs tab has to see it the moment the plugin is enabled. Same contract as
// `THEMES` in lib/themes.ts: `registerPluginProviders` is the only writer, and
// React reads `usePluginStore` rather than subscribing to the array.

import type { ApiCategory, ApiProvider } from './types'
import { ckanProvider } from './ckan'
import { socrataProvider } from './socrata'
import { odataProvider } from './odata'
import { erddapProvider } from './erddap'
import { erddapGridProvider } from './erddap-grid'
import { sdmxProvider } from './sdmx'
import { esriProvider } from './esri'
import { esriImageProvider } from './esri-image'
import { macrostratProvider } from './macrostrat'
import { ogcapiProvider } from './ogcapi'
import { wcsProvider } from './wcs'
import { wfsProvider } from './wfs'
import { wmsProvider } from './wms'
import { stacProvider } from './stac'

const BUILTIN: ApiProvider[] = [
  ckanProvider,
  socrataProvider,
  esriProvider,
  ogcapiProvider,
  wfsProvider,
  macrostratProvider,
  esriImageProvider,
  wcsProvider,
  wmsProvider,
  stacProvider,
  erddapGridProvider,
  erddapProvider,
  sdmxProvider,
  odataProvider,
]

/** The providers ouRGeo ships. */
export const BUILTIN_PROVIDERS: readonly ApiProvider[] = BUILTIN

const BUILTIN_IDS = new Set(BUILTIN.map((p) => p.id))

let live: ApiProvider[] = BUILTIN

/** The live list — shipped first, then plugin-contributed. Don't cache it. */
export function providerList(): ApiProvider[] {
  return live
}

export function providerById(id: string): ApiProvider | undefined {
  return live.find((p) => p.id === id)
}

/**
 * Replace every plugin-contributed provider with `providers`, in one pass.
 *
 * A shipped id is never shadowed: a plugin claiming `esri` is dropped rather
 * than allowed to replace the built-in, because a user debugging an import
 * would have no way to tell which one had answered.
 */
export function registerPluginProviders(providers: ApiProvider[]): void {
  const kept: ApiProvider[] = []
  const seen = new Set<string>()
  for (const p of providers) {
    if (BUILTIN_IDS.has(p.id) || seen.has(p.id)) continue
    seen.add(p.id)
    kept.push(p)
  }
  live = kept.length === 0 ? BUILTIN : [...BUILTIN, ...kept]
}

export const API_CATEGORY_ORDER: ApiCategory[] = [
  'Open Data', 'Geospatial', 'Raster / Image Layers', 'Scientific', 'Statistics',
]

/** Providers grouped by category, in display order, skipping empty groups. */
export function providersByCategory(): { category: ApiCategory; providers: ApiProvider[] }[] {
  return API_CATEGORY_ORDER
    .map((category) => ({ category, providers: live.filter((p) => p.category === category) }))
    .filter((g) => g.providers.length > 0)
}
