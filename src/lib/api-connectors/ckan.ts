// CKAN provider — wraps the existing ckan-client + codegen behind the generic
// ApiProvider interface. Behavior matches the original CKAN Portals tab.

import {
  listOrganizations, listDatasets, getFields, sqlAvailable, distinctValues,
  searchRecords, searchSql, queryNeedsSql, buildFiltersJson, buildSelectSql,
  type CkanDataset, type CkanResource,
} from '@/lib/ckan-client'
import { buildCkanDatastoreCode, buildCkanResourceDownloadCode } from '@/components/connector/dataConnectorCode'
import type { FieldKind, FilterOp } from './query-model'
import type { ApiProvider, ProviderContext, ResourceMetadata, Selection } from './types'

interface CkanCaps { sql: boolean }

// Datasets (with embedded resources) cached per org so the resource level and
// metadata lookups don't need to refetch.
const datasetCache = new Map<string, CkanDataset[]>()
const dsKey = (baseUrl: string, orgId: string) => `${baseUrl}::${orgId}`

function findResource(ctx: ProviderContext, sel: Selection): { dataset?: CkanDataset; resource?: CkanResource } {
  const datasets = datasetCache.get(dsKey(ctx.baseUrl, sel.organization)) ?? []
  const dataset = datasets.find((d) => d.id === sel.dataset)
  const resource = dataset?.resources.find((r) => r.id === sel.resource)
  return { dataset, resource }
}

export const ckanProvider: ApiProvider = {
  id: 'ckan',
  label: 'CKAN Portals',
  category: 'Open Data',
  description: 'CKAN open-data portals (DataStore API). Browse organization → dataset → resource.',
  docsUrl: 'https://docs.ckan.org/en/latest/api/index.html',
  builtinServers: [
    { id: 'cnra', label: 'California Natural Resources (CNRA)', baseUrl: 'https://data.cnra.ca.gov', docsUrl: 'https://data.cnra.ca.gov/' },
    { id: 'canada', label: 'Open Canada', baseUrl: 'https://open.canada.ca/data/en', docsUrl: 'https://open.canada.ca/en/using-open-data' },
  ],
  cascade: [
    { key: 'organization', label: 'Organization', placeholder: 'Select an organization' },
    { key: 'dataset', label: 'Dataset', placeholder: 'Select a dataset' },
    { key: 'resource', label: 'Resource', placeholder: 'Select a resource' },
  ],

  async listLevel(levelKey, sel, ctx) {
    if (levelKey === 'organization') {
      const orgs = await listOrganizations(ctx.baseUrl)
      return orgs.map((o) => ({ value: o.id, label: o.title, hint: o.packageCount ? String(o.packageCount) : undefined }))
    }
    if (levelKey === 'dataset') {
      const datasets = await listDatasets(ctx.baseUrl, sel.organization)
      datasetCache.set(dsKey(ctx.baseUrl, sel.organization), datasets)
      return datasets.map((d) => ({ value: d.id, label: d.title, hint: `${d.resources.length} res` }))
    }
    // resource
    const { dataset } = findResource(ctx, sel)
    return (dataset?.resources ?? []).map((r) => ({
      value: r.id, label: r.name,
      hint: [r.format, r.datastoreActive ? 'API' : 'file'].filter(Boolean).join(' · '),
    }))
  },

  async getMetadata(sel, ctx): Promise<ResourceMetadata> {
    const { resource } = findResource(ctx, sel)
    if (!resource) return { fields: [], spatial: false, queryable: false, note: 'Resource not found.' }
    if (!resource.datastoreActive) {
      const spatial = ['geojson', 'kml', 'gpkg', 'gml', 'shp', 'zip', 'shapefile'].includes(resource.format.toLowerCase())
      return {
        fields: [], spatial, queryable: false,
        note: `This resource isn’t query-able (no DataStore API). It will be downloaded and read directly${resource.format ? ` as ${resource.format}` : ''}.`,
        downloadCode: (varName) => buildCkanResourceDownloadCode(resource, varName),
      }
    }
    const [{ fields, total }, sql] = await Promise.all([
      getFields(ctx.baseUrl, resource.id),
      sqlAvailable(ctx.baseUrl, resource.id),
    ])
    return { fields, total, spatial: false, queryable: true, caps: { sql } as CkanCaps }
  },

  opsFor(kind: FieldKind, caps?: unknown): FilterOp[] {
    const sql = (caps as CkanCaps | undefined)?.sql ?? false
    if (kind === 'text') return sql ? ['is', 'isAnyOf', 'contains'] : ['is', 'isAnyOf']
    if (kind === 'numeric') return sql ? ['eq', 'lt', 'lte', 'gt', 'gte', 'between'] : ['eq']
    return sql ? ['on', 'before', 'after', 'dateBetween'] : ['on']
  },

  async distinctValues(sel, field, ctx) {
    return distinctValues(ctx.baseUrl, sel.resource, field)
  },

  async preview(sel, query, ctx) {
    const resId = sel.resource
    if (queryNeedsSql(query)) {
      return (await searchSql(ctx.baseUrl, buildSelectSql(resId, query))).records
    }
    const r = await searchRecords(ctx.baseUrl, resId, {
      filters: buildFiltersJson(query) ?? undefined,
      q: query.q.trim() || undefined,
      limit: query.limit,
    })
    return r.records
  },

  buildCode(sel, query, varName, ctx) {
    const { resource } = findResource(ctx, sel)
    if (resource && !resource.datastoreActive) return buildCkanResourceDownloadCode(resource, varName)
    return buildCkanDatastoreCode(ctx.baseUrl, sel.resource, query, varName, 'CKAN')
  },
}
