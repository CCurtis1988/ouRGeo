import { describe, it, expect } from 'vitest'
import { SOURCES } from './sources'

const source = (id: string) => {
  const s = SOURCES.find((x) => x.id === id)
  if (!s) throw new Error(`no source ${id}`)
  return s
}
const dataset = (sourceId: string, datasetId: string) => {
  const d = source(sourceId).datasets.find((x) => x.id === datasetId)
  if (!d) throw new Error(`no dataset ${datasetId}`)
  return d
}
const build = (sourceId: string, datasetId: string, params: Record<string, string>) =>
  dataset(sourceId, datasetId).buildCode(params, 'x', {})

describe('every source names its documentation', () => {
  // The Help button is only as good as the link behind it, and a source added
  // without one would show a button that goes nowhere.
  it.each(SOURCES.map((s) => [s.id, s.docsUrl] as const))('%s', (_id, url) => {
    expect(url).toMatch(/^https:\/\//)
  })
})

describe('NWIS daily values', () => {
  const p = { parameterCd: '00060', stateCd: 'CO', startDate: '2020-01-01', endDate: '2020-12-31' }

  it('filters by state when no site is given', () => {
    const code = build('usgs_nwis', 'nwis_dv', p)
    expect(code).toContain('stateCd = "CO"')
    expect(code).not.toContain('sites =')
  })

  // NWIS takes exactly one major filter; sending both is an HTTP 400 rather
  // than a narrower query, which is the whole reason these two share a rule.
  it('swaps the state out for sites, never sends both', () => {
    const code = build('usgs_nwis', 'nwis_dv', { ...p, siteNumbers: '09058000, 09034900' })
    expect(code).toContain('sites = c("09058000", "09034900")')
    expect(code).not.toContain('stateCd')
  })

  it('splits sites on commas or whitespace and drops the gaps', () => {
    const code = build('usgs_nwis', 'nwis_dv', { ...p, siteNumbers: ' 09058000 ,,  09034900 ' })
    expect(code).toContain('sites = c("09058000", "09034900")')
  })

  it('sends the parameter code, not the label shown in the menu', () => {
    const code = build('usgs_nwis', 'nwis_dv', { ...p, parameterCd: '00065' })
    expect(code).toContain('parameterCd = "00065"')
  })

  it('pins the service to the dataset', () => {
    expect(build('usgs_nwis', 'nwis_dv', p)).toContain('service = "dv"')
  })

  it('quotes what the user typed', () => {
    const code = build('usgs_nwis', 'nwis_dv', { ...p, siteNumbers: '09058000"; system("rm -rf /")' })
    expect(code).toContain('\\"')
    expect(code).not.toMatch(/sites = c\("09058000"; /)
  })
})

describe('NWIS water quality', () => {
  // readNWISdata(service = "qw") is retired and errors outright in
  // dataRetrieval 2.7.25; the Water Quality Portal is where the data went.
  it('reads the Water Quality Portal, not the retired NWIS service', () => {
    const code = build('usgs_nwis', 'nwis_wq', { stateCd: 'CO', characteristicName: 'pH' })
    expect(code).toContain('readWQPdata(')
    expect(code).not.toContain('service = "qw"')
  })

  it('derives the FIPS statecode rather than carrying a table of them', () => {
    const code = build('usgs_nwis', 'nwis_wq', { stateCd: 'CO', characteristicName: 'pH' })
    expect(code).toContain('sprintf("US:%02d", stateCdLookup("CO", "id"))')
  })

  it('uses the site id alone when one is given', () => {
    const code = build('usgs_nwis', 'nwis_wq', { stateCd: 'CO', siteid: 'USGS-09058000' })
    expect(code).toContain('siteid = "USGS-09058000"')
    expect(code).not.toContain('statecode')
  })
})

describe('NWIS groundwater levels', () => {
  // `service = "gwlevels"` is not one dataRetrieval accepts any more.
  it('asks for depth to water as a daily value', () => {
    const code = build('usgs_nwis', 'nwis_gwl', { stateCd: 'CA' })
    expect(code).toContain('parameterCd = "72019"')
    expect(code).toContain('service = "dv"')
    expect(code).not.toContain('gwlevels')
  })

  it('takes sites instead of a state, like the other two', () => {
    const code = build('usgs_nwis', 'nwis_gwl', { stateCd: 'CA', siteNumbers: '393851075582501' })
    expect(code).toContain('sites = c("393851075582501")')
    expect(code).not.toContain('stateCd')
  })
})
