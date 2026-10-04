import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { buildLoadCode, type LoadColumnDef } from './load-data-code'

it('an explicitly character CSV key preserves leading zeros before numeric inference can erase them', () => {
  const column: LoadColumnDef = { name: 'key', type: 'character', originalType: 'numeric', include: true, isGeometry: false, formula: '' }
  const code = buildLoadCode('keys', 'tests/fixtures/preflight/keys.csv', 'csv', {
    delimiter: ',', hasHeader: true, skipRows: 0, encoding: 'UTF-8', naStrings: 'NA', sheet: '', crsOverride: '', layerName: '',
  }, [column], [])
  const assertion = 'stopifnot(identical(keys$key,c("01","1","",NA_character_)));cat("Keys preserved")'
  expect(execFileSync('Rscript', ['-e', `${code}\n${assertion}`], { encoding: 'utf8' })).toContain('Keys preserved')
})

it('an import transformation is reviewed separately and does not transform the native source in generated import R', () => {
  const code = buildLoadCode('source', 'fixture.gpkg', 'spatial', {
    delimiter: ',', hasHeader: true, skipRows: 0, encoding: 'UTF-8', naStrings: 'NA', sheet: '', crsOverride: '32610', layerName: '',
  }, [], [])
  expect(code).toContain('sf::st_read'); expect(code).not.toContain('st_transform(')
  expect(code).toContain('source_reprojected')
})

it('the shipped GeoJSON import remains inspectable without changing its known longitude/latitude data', () => {
  const code = buildLoadCode('source', 'tests/fixtures/preflight/survey.geojson', 'geojson', {
    delimiter: ',', hasHeader: true, skipRows: 0, encoding: 'UTF-8', naStrings: 'NA', sheet: '', crsOverride: '', layerName: '',
  }, [], [])
  const assertion = `
if(dir.exists('.cache/preflight-r')) .libPaths(c(normalizePath('.cache/preflight-r'),.libPaths()))
source('r/lib/util-core.R');source('r/lib/util-env.R');source('r/lib/data-preflight.R')
before<-serialize(source,NULL)
p<-dq_validate(list(operationType='inspect',inputs=list(list(name='source')),parameters=list()))
stopifnot(p$status=='ready',sf::st_crs(source)$epsg==4326,identical(before,serialize(source,NULL)),identical(source$key,c('A','B')))
stopifnot(max(abs(sf::st_coordinates(source)-matrix(c(-123,-123.0001,37,37.0001),ncol=2)))<1e-12)
cat('Native GeoJSON import preserved')`
  expect(execFileSync('Rscript', ['-e', `${code}\n${assertion}`], { encoding: 'utf8', timeout: 30_000 })).toContain('Native GeoJSON import preserved')
})
