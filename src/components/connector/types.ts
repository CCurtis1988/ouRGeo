/**
 * One option in a `select` param.
 *
 * A bare string is both the value and the label, which is right for a state
 * abbreviation and wrong for anything coded: "00060" tells a user nothing, and
 * the value it sends has to stay "00060". The object form separates them.
 */
export type ParamOption = string | { value: string; label: string }

export interface ParamDef {
  id: string
  label: string
  type: 'text' | 'select' | 'number' | 'textarea'
  options?: ParamOption[]
  default?: string
  placeholder?: string
  required?: boolean
  /** A line under the control — the rule the API will otherwise enforce with a 400. */
  hint?: string
}

export interface StaticDataSet {
  id: string
  label: string
  description: string
  params: ParamDef[]
  buildCode: (params: Record<string, string>, varName: string, keys: Record<string, string>) => string
}

export interface DataSource {
  id: string
  label: string
  category: SourceCategory
  description: string
  rPackage: string
  requiresKey?: string  // key ID in the API keys store
  /**
   * The API's own documentation, opened by the Help button.
   *
   * Every source has one. A connector is a thin shell over somebody else's
   * API, and the questions it cannot answer — what a parameter code means,
   * which sites carry it, why a query returned nothing — are all answered on
   * that page. Sending the user to look for it themselves is the failure.
   */
  docsUrl: string
  datasets: StaticDataSet[]
  dynamicCatalogue?: boolean
  dynamicType?: 'socrata' | 'ckan' | 'fred' | 'kaggle'
  dynamicDomain?: string  // for Socrata: the base domain
}

export type SourceCategory =
  | 'External Platforms'
  | 'Census & Demographics'
  | 'Environmental & Climate'
  | 'Economic & Financial'
  | 'Geospatial'
  | 'Open Data Portals'

export interface DynamicResult {
  id: string
  label: string
  description: string
  url?: string  // for Socrata: resource URL; for CKAN: CSV/JSON resource URL
}

export interface KaggleFile {
  name: string
  totalBytes: number
}
