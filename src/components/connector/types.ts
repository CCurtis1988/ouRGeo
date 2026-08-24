export interface ParamDef {
  id: string
  label: string
  type: 'text' | 'select' | 'number' | 'textarea'
  options?: string[]
  default?: string
  placeholder?: string
  required?: boolean
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
