// The list of available Web-API providers, grouped by category for the picker.
// Add a provider here to surface it as a new connector in the Web APIs tab.

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

export const API_PROVIDERS: ApiProvider[] = [
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

export const API_CATEGORY_ORDER: ApiCategory[] = [
  'Open Data', 'Geospatial', 'Raster / Image Layers', 'Scientific', 'Statistics',
]

/** Providers grouped by category, in display order, skipping empty groups. */
export function providersByCategory(): { category: ApiCategory; providers: ApiProvider[] }[] {
  return API_CATEGORY_ORDER
    .map((category) => ({ category, providers: API_PROVIDERS.filter((p) => p.category === category) }))
    .filter((g) => g.providers.length > 0)
}
