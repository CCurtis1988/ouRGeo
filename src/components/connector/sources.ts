import type { DataSource } from './types'

const US_STATES = [
  '', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR'
]

const CA_PROVINCES = [
  '01 - Alberta', '02 - British Columbia', '03 - Manitoba', '04 - New Brunswick',
  '05 - Newfoundland and Labrador', '07 - Nova Scotia', '08 - Ontario',
  '09 - Prince Edward Island', '10 - Quebec', '11 - Saskatchewan',
  '12 - Yukon', '13 - Northwest Territories', '14 - Nunavut'
]

export const SOURCES: DataSource[] = [
  // ─── External Platforms ───────────────────────────────────────────────────
  {
    id: 'kaggle',
    label: 'Kaggle',
    category: 'External Platforms',
    description: '600,000+ public datasets across ML, science, finance, health, climate, and more',
    rPackage: 'httr2',
    requiresKey: 'kaggle',
    datasets: [],
    dynamicCatalogue: true,
    dynamicType: 'kaggle',
  },

  // ─── Census & Demographics ───────────────────────────────────────────────
  {
    id: 'acs',
    label: 'US Census ACS',
    category: 'Census & Demographics',
    description: 'American Community Survey estimates from the US Census Bureau',
    rPackage: 'tidycensus',
    requiresKey: 'census',
    datasets: [
      {
        id: 'acs5',
        label: 'ACS 5-Year Estimates',
        description: '5-year rolling averages — most detailed, available down to block group and tract level',
        params: [
          { id: 'geography', label: 'Geography', type: 'select', options: ['state', 'county', 'tract', 'block group', 'zcta', 'congressional district'], default: 'county' },
          { id: 'state', label: 'State (abbrev. or FIPS — leave blank for all)', type: 'select', options: US_STATES, default: '' },
          { id: 'year', label: 'Year', type: 'select', options: ['2022', '2021', '2020', '2019', '2018', '2017'], default: '2022' },
          { id: 'variables', label: 'Variables (comma-separated)', type: 'text', placeholder: 'B01003_001, B19013_001', default: 'B01003_001', required: true },
        ],
        buildCode: (p, v, keys) => {
          const lines = ['library(tidycensus)']
          if (keys.census) lines.push(`census_api_key("${keys.census}", install = FALSE)`)
          const vars = (p.variables || 'B01003_001').split(',').map(s => s.trim()).filter(Boolean)
          const varStr = vars.map(s => `"${s}"`).join(', ')
          lines.push(`${v} <- get_acs(`)
          lines.push(`  geography = "${p.geography || 'county'}",`)
          lines.push(`  variables = c(${varStr}),`)
          if (p.state) lines.push(`  state = "${p.state}",`)
          lines.push(`  year = ${p.year || '2022'},`)
          lines.push(`  survey = "acs5"`)
          lines.push(')')
          return lines.join('\n')
        },
      },
      {
        id: 'acs1',
        label: 'ACS 1-Year Estimates',
        description: '1-year estimates — most current, available only for areas with population ≥ 65,000',
        params: [
          { id: 'geography', label: 'Geography', type: 'select', options: ['state', 'county', 'congressional district', 'metropolitan statistical area'], default: 'state' },
          { id: 'state', label: 'State (abbrev. or FIPS — leave blank for all)', type: 'select', options: US_STATES, default: '' },
          { id: 'year', label: 'Year', type: 'select', options: ['2022', '2021', '2019', '2018', '2017'], default: '2022' },
          { id: 'variables', label: 'Variables (comma-separated)', type: 'text', placeholder: 'B01003_001', default: 'B01003_001', required: true },
        ],
        buildCode: (p, v, keys) => {
          const lines = ['library(tidycensus)']
          if (keys.census) lines.push(`census_api_key("${keys.census}", install = FALSE)`)
          const vars = (p.variables || 'B01003_001').split(',').map(s => s.trim()).filter(Boolean)
          const varStr = vars.map(s => `"${s}"`).join(', ')
          lines.push(`${v} <- get_acs(`)
          lines.push(`  geography = "${p.geography || 'state'}",`)
          lines.push(`  variables = c(${varStr}),`)
          if (p.state) lines.push(`  state = "${p.state}",`)
          lines.push(`  year = ${p.year || '2022'},`)
          lines.push(`  survey = "acs1"`)
          lines.push(')')
          return lines.join('\n')
        },
      },
    ],
  },
  {
    id: 'decennial',
    label: 'US Census Decennial',
    category: 'Census & Demographics',
    description: 'Decennial Census counts (2020, 2010) from the US Census Bureau',
    rPackage: 'tidycensus',
    requiresKey: 'census',
    datasets: [
      {
        id: 'dec2020',
        label: 'Decennial Census 2020',
        description: 'Complete count data from the 2020 Decennial Census (PL 94-171 redistricting file)',
        params: [
          { id: 'geography', label: 'Geography', type: 'select', options: ['state', 'county', 'tract', 'block', 'block group'], default: 'county' },
          { id: 'state', label: 'State (abbrev. or FIPS — leave blank for all)', type: 'select', options: US_STATES, default: '' },
          { id: 'variables', label: 'Variables (comma-separated)', type: 'text', placeholder: 'P1_001N, P1_003N', default: 'P1_001N', required: true },
        ],
        buildCode: (p, v, keys) => {
          const lines = ['library(tidycensus)']
          if (keys.census) lines.push(`census_api_key("${keys.census}", install = FALSE)`)
          const vars = (p.variables || 'P1_001N').split(',').map(s => s.trim()).filter(Boolean)
          const varStr = vars.map(s => `"${s}"`).join(', ')
          lines.push(`${v} <- get_decennial(`)
          lines.push(`  geography = "${p.geography || 'county'}",`)
          lines.push(`  variables = c(${varStr}),`)
          if (p.state) lines.push(`  state = "${p.state}",`)
          lines.push(`  year = 2020,`)
          lines.push(`  sumfile = "pl"`)
          lines.push(')')
          return lines.join('\n')
        },
      },
      {
        id: 'dec2010',
        label: 'Decennial Census 2010',
        description: 'Complete count data from the 2010 Decennial Census',
        params: [
          { id: 'geography', label: 'Geography', type: 'select', options: ['state', 'county', 'tract', 'block', 'block group'], default: 'county' },
          { id: 'state', label: 'State (abbrev. or FIPS — leave blank for all)', type: 'select', options: US_STATES, default: '' },
          { id: 'variables', label: 'Variables (comma-separated)', type: 'text', placeholder: 'P001001, P003003', default: 'P001001', required: true },
        ],
        buildCode: (p, v, keys) => {
          const lines = ['library(tidycensus)']
          if (keys.census) lines.push(`census_api_key("${keys.census}", install = FALSE)`)
          const vars = (p.variables || 'P001001').split(',').map(s => s.trim()).filter(Boolean)
          const varStr = vars.map(s => `"${s}"`).join(', ')
          lines.push(`${v} <- get_decennial(`)
          lines.push(`  geography = "${p.geography || 'county'}",`)
          lines.push(`  variables = c(${varStr}),`)
          if (p.state) lines.push(`  state = "${p.state}",`)
          lines.push(`  year = 2010`)
          lines.push(')')
          return lines.join('\n')
        },
      },
    ],
  },
  {
    id: 'tigris',
    label: 'TIGER/Line Boundaries',
    category: 'Census & Demographics',
    description: 'US Census Bureau geographic boundary files — states, counties, tracts, roads, and more',
    rPackage: 'tigris',
    datasets: [
      {
        id: 'tigris_states',
        label: 'States',
        description: 'US state boundaries as an sf polygon layer',
        params: [
          { id: 'year', label: 'Year', type: 'select', options: ['2022', '2021', '2020', '2019', '2018'], default: '2022' },
        ],
        buildCode: (p, v) => [
          'library(tigris)',
          `${v} <- states(year = ${p.year || '2022'})`,
        ].join('\n'),
      },
      {
        id: 'tigris_counties',
        label: 'Counties',
        description: 'County boundaries — optionally filtered by state',
        params: [
          { id: 'state', label: 'State (abbrev. — leave blank for all)', type: 'select', options: US_STATES, default: '' },
          { id: 'year', label: 'Year', type: 'select', options: ['2022', '2021', '2020', '2019', '2018'], default: '2022' },
        ],
        buildCode: (p, v) => {
          const stateArg = p.state ? `state = "${p.state}", ` : ''
          return [
            'library(tigris)',
            `${v} <- counties(${stateArg}year = ${p.year || '2022'})`,
          ].join('\n')
        },
      },
      {
        id: 'tigris_tracts',
        label: 'Census Tracts',
        description: 'Census tract boundaries — state is required',
        params: [
          { id: 'state', label: 'State (abbrev. or FIPS)', type: 'select', options: US_STATES.filter(Boolean), default: 'CA', required: true },
          { id: 'county', label: 'County FIPS (leave blank for all)', type: 'text', placeholder: '037', default: '' },
          { id: 'year', label: 'Year', type: 'select', options: ['2022', '2021', '2020', '2019', '2018'], default: '2022' },
        ],
        buildCode: (p, v) => {
          const countyArg = p.county ? `, county = "${p.county}"` : ''
          return [
            'library(tigris)',
            `${v} <- tracts(state = "${p.state || 'CA'}"${countyArg}, year = ${p.year || '2022'})`,
          ].join('\n')
        },
      },
      {
        id: 'tigris_zctas',
        label: 'ZIP Code Tabulation Areas',
        description: 'ZIP code area boundaries (ZCTAs) for the entire US',
        params: [
          { id: 'year', label: 'Year', type: 'select', options: ['2022', '2021', '2020', '2019', '2018'], default: '2022' },
        ],
        buildCode: (p, v) => [
          'library(tigris)',
          `${v} <- zctas(year = ${p.year || '2022'})`,
        ].join('\n'),
      },
      {
        id: 'tigris_roads',
        label: 'Roads',
        description: 'Primary and secondary roads — state and county are required',
        params: [
          { id: 'state', label: 'State (abbrev. or FIPS)', type: 'select', options: US_STATES.filter(Boolean), default: 'CA', required: true },
          { id: 'county', label: 'County FIPS', type: 'text', placeholder: '037', default: '', required: true },
          { id: 'year', label: 'Year', type: 'select', options: ['2022', '2021', '2020', '2019'], default: '2022' },
        ],
        buildCode: (p, v) => [
          'library(tigris)',
          `${v} <- roads(state = "${p.state || 'CA'}", county = "${p.county || '037'}", year = ${p.year || '2022'})`,
        ].join('\n'),
      },
    ],
  },
  {
    id: 'cancensus',
    label: 'Statistics Canada',
    category: 'Census & Demographics',
    description: 'Canadian Census profiles via the cancensus R package',
    rPackage: 'cancensus',
    requiresKey: 'cancensus',
    datasets: [
      {
        id: 'ca21',
        label: 'Census 2021 (CA21)',
        description: '2021 Canadian Census profile data at various geographic levels',
        params: [
          { id: 'level', label: 'Geographic Level', type: 'select', options: ['PR', 'CMA', 'CD', 'CSD', 'CT', 'DA'], default: 'CSD' },
          { id: 'province', label: 'Province (2-digit FIPS)', type: 'select', options: CA_PROVINCES, default: '08 - Ontario' },
          { id: 'vectors', label: 'Vectors (comma-separated)', type: 'text', placeholder: 'v_CA21_1, v_CA21_6', default: 'v_CA21_1', required: true },
        ],
        buildCode: (p, v, keys) => {
          const prov = (p.province || '08 - Ontario').split(' - ')[0].trim()
          const vecs = (p.vectors || 'v_CA21_1').split(',').map(s => s.trim()).filter(Boolean)
          const vecStr = vecs.map(s => `"${s}"`).join(', ')
          const lines = ['library(cancensus)']
          if (keys.cancensus) lines.push(`options(cancensus.api_key = "${keys.cancensus}")`)
          lines.push(`${v} <- get_census(`)
          lines.push(`  dataset = "CA21",`)
          lines.push(`  regions = list(PR = c("${prov}")),`)
          lines.push(`  vectors = c(${vecStr}),`)
          lines.push(`  level = "${p.level || 'CSD'}"`)
          lines.push(')')
          return lines.join('\n')
        },
      },
      {
        id: 'ca16',
        label: 'Census 2016 (CA16)',
        description: '2016 Canadian Census profile data at various geographic levels',
        params: [
          { id: 'level', label: 'Geographic Level', type: 'select', options: ['PR', 'CMA', 'CD', 'CSD', 'CT', 'DA'], default: 'CSD' },
          { id: 'province', label: 'Province (2-digit FIPS)', type: 'select', options: CA_PROVINCES, default: '08 - Ontario' },
          { id: 'vectors', label: 'Vectors (comma-separated)', type: 'text', placeholder: 'v_CA16_1, v_CA16_6', default: 'v_CA16_1', required: true },
        ],
        buildCode: (p, v, keys) => {
          const prov = (p.province || '08 - Ontario').split(' - ')[0].trim()
          const vecs = (p.vectors || 'v_CA16_1').split(',').map(s => s.trim()).filter(Boolean)
          const vecStr = vecs.map(s => `"${s}"`).join(', ')
          const lines = ['library(cancensus)']
          if (keys.cancensus) lines.push(`options(cancensus.api_key = "${keys.cancensus}")`)
          lines.push(`${v} <- get_census(`)
          lines.push(`  dataset = "CA16",`)
          lines.push(`  regions = list(PR = c("${prov}")),`)
          lines.push(`  vectors = c(${vecStr}),`)
          lines.push(`  level = "${p.level || 'CSD'}"`)
          lines.push(')')
          return lines.join('\n')
        },
      },
    ],
  },

  // ─── Environmental & Climate ──────────────────────────────────────────────
  {
    id: 'usgs_nwis',
    label: 'USGS NWIS',
    category: 'Environmental & Climate',
    description: 'US Geological Survey National Water Information System — streamflow, water quality, groundwater',
    rPackage: 'dataRetrieval',
    datasets: [
      {
        id: 'nwis_dv',
        label: 'Daily Streamflow',
        description: 'Daily mean discharge (parameter 00060) by state or site number',
        params: [
          { id: 'stateCd', label: 'State (abbrev.)', type: 'select', options: US_STATES.filter(Boolean), default: 'CO' },
          { id: 'startDate', label: 'Start Date (YYYY-MM-DD)', type: 'text', placeholder: '2020-01-01', default: '2020-01-01' },
          { id: 'endDate', label: 'End Date (YYYY-MM-DD)', type: 'text', placeholder: '2020-12-31', default: '2020-12-31' },
        ],
        buildCode: (p, v) => [
          'library(dataRetrieval)',
          `${v} <- readNWISdata(`,
          `  stateCd = "${p.stateCd || 'CO'}",`,
          `  parameterCd = "00060",`,
          `  service = "dv",`,
          `  startDate = "${p.startDate || '2020-01-01'}",`,
          `  endDate = "${p.endDate || '2020-12-31'}"`,
          ')',
        ].join('\n'),
      },
      {
        id: 'nwis_wq',
        label: 'Water Quality',
        description: 'Water quality measurements — specify parameter code (e.g. 00300 = dissolved oxygen)',
        params: [
          { id: 'stateCd', label: 'State (abbrev.)', type: 'select', options: US_STATES.filter(Boolean), default: 'CO' },
          { id: 'parameterCd', label: 'Parameter Code', type: 'text', placeholder: '00300', default: '00300', required: true },
          { id: 'startDate', label: 'Start Date (YYYY-MM-DD)', type: 'text', placeholder: '2020-01-01', default: '2020-01-01' },
          { id: 'endDate', label: 'End Date (YYYY-MM-DD)', type: 'text', placeholder: '2020-12-31', default: '2020-12-31' },
        ],
        buildCode: (p, v) => [
          'library(dataRetrieval)',
          `${v} <- readNWISdata(`,
          `  stateCd = "${p.stateCd || 'CO'}",`,
          `  parameterCd = "${p.parameterCd || '00300'}",`,
          `  service = "qw",`,
          `  startDate = "${p.startDate || '2020-01-01'}",`,
          `  endDate = "${p.endDate || '2020-12-31'}"`,
          ')',
        ].join('\n'),
      },
      {
        id: 'nwis_gwl',
        label: 'Groundwater Levels',
        description: 'Groundwater level measurements from monitoring wells by state',
        params: [
          { id: 'stateCd', label: 'State (abbrev.)', type: 'select', options: US_STATES.filter(Boolean), default: 'CA' },
          { id: 'startDate', label: 'Start Date (YYYY-MM-DD)', type: 'text', placeholder: '2020-01-01', default: '2020-01-01' },
          { id: 'endDate', label: 'End Date (YYYY-MM-DD)', type: 'text', placeholder: '2020-12-31', default: '2020-12-31' },
        ],
        buildCode: (p, v) => [
          'library(dataRetrieval)',
          `${v} <- readNWISdata(`,
          `  stateCd = "${p.stateCd || 'CA'}",`,
          `  parameterCd = "72019",`,
          `  service = "gwlevels",`,
          `  startDate = "${p.startDate || '2020-01-01'}",`,
          `  endDate = "${p.endDate || '2020-12-31'}"`,
          ')',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'noaa',
    label: 'NOAA Climate Data',
    category: 'Environmental & Climate',
    description: 'National Oceanic and Atmospheric Administration climate and weather records',
    rPackage: 'rnoaa',
    requiresKey: 'noaa',
    datasets: [
      {
        id: 'noaa_ghcnd',
        label: 'GHCND Daily Summaries',
        description: 'Daily weather summaries (temperature, precipitation) from a specific station',
        params: [
          { id: 'stationid', label: 'Station ID', type: 'text', placeholder: 'GHCND:USW00094728', default: 'GHCND:USW00094728', required: true },
          { id: 'startDate', label: 'Start Date (YYYY-MM-DD)', type: 'text', placeholder: '2020-01-01', default: '2020-01-01' },
          { id: 'endDate', label: 'End Date (YYYY-MM-DD)', type: 'text', placeholder: '2020-12-31', default: '2020-12-31' },
          { id: 'variables', label: 'Variables (comma-separated)', type: 'text', placeholder: 'TMAX, TMIN, PRCP', default: 'TMAX, TMIN, PRCP' },
        ],
        buildCode: (p, v, keys) => {
          const vars = (p.variables || 'TMAX, TMIN, PRCP').split(',').map(s => s.trim()).filter(Boolean)
          const varStr = vars.map(s => `"${s}"`).join(', ')
          const lines = ['library(rnoaa)']
          if (keys.noaa) lines.push(`options(noaakey = "${keys.noaa}")`)
          lines.push(`${v} <- ghcnd_search(`)
          lines.push(`  stationid = "${p.stationid || 'GHCND:USW00094728'}",`)
          lines.push(`  var = c(${varStr}),`)
          lines.push(`  date_min = "${p.startDate || '2020-01-01'}",`)
          lines.push(`  date_max = "${p.endDate || '2020-12-31'}"`)
          lines.push(')')
          return lines.join('\n')
        },
      },
      {
        id: 'noaa_normals',
        label: 'Climate Normals',
        description: '30-year climate normals for a specific station',
        params: [
          { id: 'stationid', label: 'Station ID', type: 'text', placeholder: 'GHCND:USW00094728', default: 'GHCND:USW00094728', required: true },
          { id: 'period', label: 'Normal Period', type: 'select', options: ['1991-2020', '1981-2010'], default: '1991-2020' },
        ],
        buildCode: (p, v, keys) => {
          const lines = ['library(rnoaa)']
          if (keys.noaa) lines.push(`options(noaakey = "${keys.noaa}")`)
          lines.push(`${v} <- ncdc_data(`)
          lines.push(`  datasetid = "NORMAL_DLY",`)
          lines.push(`  stationid = "${p.stationid || 'GHCND:USW00094728'}",`)
          lines.push(`  startdate = "${(p.period || '1991-2020').split('-')[0]}-01-01",`)
          lines.push(`  enddate = "${(p.period || '1991-2020').split('-')[1]}-12-31",`)
          lines.push(`  limit = 1000`)
          lines.push(')$data')
          return lines.join('\n')
        },
      },
    ],
  },

  // ─── Economic & Financial ─────────────────────────────────────────────────
  {
    id: 'fred',
    label: 'FRED — Federal Reserve',
    category: 'Economic & Financial',
    description: 'Federal Reserve Bank of St. Louis economic data — 800,000+ time series',
    rPackage: 'fredr',
    requiresKey: 'fred',
    datasets: [],
    dynamicCatalogue: true,
    dynamicType: 'fred',
  },
  {
    id: 'worldbank',
    label: 'World Bank',
    category: 'Economic & Financial',
    description: 'World Bank development indicators — GDP, population, health, education and more',
    rPackage: 'wbstats',
    datasets: [
      {
        id: 'wb_indicators',
        label: 'Development Indicators',
        description: 'Fetch one or more World Bank indicators for selected countries',
        params: [
          { id: 'indicators', label: 'Indicators (comma-separated)', type: 'text', placeholder: 'NY.GDP.MKTP.CD, SP.POP.TOTL', default: 'NY.GDP.MKTP.CD', required: true },
          { id: 'country', label: 'Country ISO3 codes (comma-separated, or "countries_only" for all)', type: 'text', placeholder: 'USA, CAN, MEX', default: 'USA, CAN, MEX' },
          { id: 'startYear', label: 'Start Year', type: 'number', default: '2000' },
          { id: 'endYear', label: 'End Year', type: 'number', default: '2023' },
        ],
        buildCode: (p, v) => {
          const inds = (p.indicators || 'NY.GDP.MKTP.CD').split(',').map(s => s.trim()).filter(Boolean)
          const indStr = inds.map(s => `"${s}"`).join(', ')
          const ctry = (p.country || 'USA, CAN, MEX').split(',').map(s => s.trim()).filter(Boolean)
          const ctryStr = ctry.map(s => `"${s}"`).join(', ')
          return [
            'library(wbstats)',
            `${v} <- wb_data(`,
            `  indicator = c(${indStr}),`,
            `  country = c(${ctryStr}),`,
            `  start_date = ${p.startYear || '2000'},`,
            `  end_date = ${p.endYear || '2023'}`,
            ')',
          ].join('\n')
        },
      },
    ],
  },

  // ─── Geospatial ───────────────────────────────────────────────────────────
  {
    id: 'osm',
    label: 'OpenStreetMap Overpass',
    category: 'Geospatial',
    description: 'Download any OpenStreetMap feature — roads, buildings, amenities, land use, and more',
    rPackage: 'osmdata',
    datasets: [
      {
        id: 'osm_roads',
        label: 'Roads & Streets',
        description: 'Road network features for any bounding box or named area',
        params: [
          { id: 'bbox', label: 'Bounding Box or Place Name', type: 'text', placeholder: 'Toronto, Canada', default: 'Toronto, Canada', required: true },
          { id: 'highway', label: 'Road Type', type: 'select', options: ['(all)', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'path', 'footway', 'cycleway'], default: 'primary' },
        ],
        buildCode: (p, v) => {
          const valueArg = (p.highway && p.highway !== '(all)') ? `, value = "${p.highway}"` : ''
          return [
            'library(osmdata)',
            `${v} <- opq(bbox = "${p.bbox || 'Toronto, Canada'}") |>`,
            `  add_osm_feature(key = "highway"${valueArg}) |>`,
            '  osmdata_sf()',
          ].join('\n')
        },
      },
      {
        id: 'osm_buildings',
        label: 'Buildings',
        description: 'Building footprints for any bounding box or named area',
        params: [
          { id: 'bbox', label: 'Bounding Box or Place Name', type: 'text', placeholder: 'Vancouver, Canada', default: 'Vancouver, Canada', required: true },
        ],
        buildCode: (p, v) => [
          'library(osmdata)',
          `${v} <- opq(bbox = "${p.bbox || 'Vancouver, Canada'}") |>`,
          '  add_osm_feature(key = "building") |>',
          '  osmdata_sf()',
        ].join('\n'),
      },
      {
        id: 'osm_pois',
        label: 'Points of Interest',
        description: 'Amenity features (restaurants, schools, hospitals, parks, etc.)',
        params: [
          { id: 'bbox', label: 'Bounding Box or Place Name', type: 'text', placeholder: 'Chicago, Illinois', default: 'Chicago, Illinois', required: true },
          { id: 'amenity', label: 'Amenity Type', type: 'select', options: ['restaurant', 'school', 'hospital', 'park', 'library', 'cafe', 'bank', 'pharmacy', 'fuel', 'bus_station', 'parking'], default: 'restaurant' },
        ],
        buildCode: (p, v) => [
          'library(osmdata)',
          `${v} <- opq(bbox = "${p.bbox || 'Chicago, Illinois'}") |>`,
          `  add_osm_feature(key = "amenity", value = "${p.amenity || 'restaurant'}") |>`,
          '  osmdata_sf()',
        ].join('\n'),
      },
      {
        id: 'osm_water',
        label: 'Water Bodies',
        description: 'Rivers, lakes, coastlines, and other water features',
        params: [
          { id: 'bbox', label: 'Bounding Box or Place Name', type: 'text', placeholder: 'Minnesota', default: 'Minnesota', required: true },
          { id: 'waterType', label: 'Feature Type', type: 'select', options: ['water', 'waterway', 'coastline'], default: 'water' },
        ],
        buildCode: (p, v) => {
          const key = p.waterType === 'waterway' ? 'waterway' : p.waterType === 'coastline' ? 'natural' : 'natural'
          const value = p.waterType === 'coastline' ? 'coastline' : p.waterType === 'water' ? 'water' : undefined
          const valueArg = value ? `, value = "${value}"` : ''
          return [
            'library(osmdata)',
            `${v} <- opq(bbox = "${p.bbox || 'Minnesota'}") |>`,
            `  add_osm_feature(key = "${key}"${valueArg}) |>`,
            '  osmdata_sf()',
          ].join('\n')
        },
      },
    ],
  },
  {
    id: 'arcgis',
    label: 'ArcGIS REST Services',
    category: 'Geospatial',
    description: 'Load a feature layer from any ArcGIS REST endpoint (ArcGIS Online, ArcGIS Server, etc.)',
    rPackage: 'esri2sf',
    datasets: [
      {
        id: 'arcgis_layer',
        label: 'Feature Layer',
        description: 'Specify a full ArcGIS REST FeatureServer or MapServer layer URL',
        params: [
          { id: 'url', label: 'Layer URL', type: 'text', placeholder: 'https://services.arcgis.com/.../FeatureServer/0', default: '', required: true },
          { id: 'where', label: 'WHERE clause (optional)', type: 'text', placeholder: '1=1', default: '' },
        ],
        buildCode: (p, v) => {
          const whereArg = p.where ? `, where = "${p.where}"` : ''
          return [
            'library(esri2sf)',
            `${v} <- esri2sf("${p.url || ''}"${whereArg})`,
          ].join('\n')
        },
      },
    ],
  },

  // ─── Open Data Portals (Socrata) ──────────────────────────────────────────
  {
    id: 'nyc_opendata',
    label: 'NYC Open Data',
    category: 'Open Data Portals',
    description: 'City of New York open data portal — thousands of datasets on city services, infrastructure, demographics, and more',
    rPackage: 'RSocrata',
    requiresKey: 'socrata',
    datasets: [],
    dynamicCatalogue: true,
    dynamicType: 'socrata',
    dynamicDomain: 'data.cityofnewyork.us',
  },
  {
    id: 'chicago_data',
    label: 'Chicago Data Portal',
    category: 'Open Data Portals',
    description: 'City of Chicago open data — crime, permits, inspections, transit, and more',
    rPackage: 'RSocrata',
    requiresKey: 'socrata',
    datasets: [],
    dynamicCatalogue: true,
    dynamicType: 'socrata',
    dynamicDomain: 'data.cityofchicago.org',
  },
  {
    id: 'canada_opendata',
    label: 'Canada Open Data',
    category: 'Open Data Portals',
    description: 'Government of Canada open data portal — federal datasets across all departments',
    rPackage: 'httr2',
    datasets: [],
    dynamicCatalogue: true,
    dynamicType: 'ckan',
  },
]

export const CATEGORIES = [
  'External Platforms',
  'Census & Demographics',
  'Environmental & Climate',
  'Economic & Financial',
  'Geospatial',
  'Open Data Portals',
] as const
