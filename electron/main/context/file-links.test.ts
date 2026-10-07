import { expect, it } from 'vitest'
import { authorisedDatabaseLinks, collectFileLinks } from './file-links'

it('reconnects only databases previously linked by a local save on this profile', () => {
  const databases = [{ filePath: '/authorised/data.gpkg', proxies: [] }]
  const links = collectFileLinks([], databases)
  expect(authorisedDatabaseLinks(databases, links)).toEqual(['/authorised/data.gpkg'])
  expect(authorisedDatabaseLinks(databases, [])).toEqual([])
  expect(authorisedDatabaseLinks([{ filePath: '/unrelated/private.gpkg' }], links)).toEqual([])
  expect(authorisedDatabaseLinks(databases, [{ ...links[0], filePath: '/unrelated/private.gpkg' }])).toEqual([])
})
