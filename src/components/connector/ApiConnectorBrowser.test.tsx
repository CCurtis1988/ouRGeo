// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock the CKAN client data calls with canned data shaped like the real API.
// Pure helpers (queryNeedsSql/buildFiltersJson/buildSelectSql) are kept real.
vi.mock('@/lib/ckan-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ckan-client')>()
  return {
    ...actual,
    listOrganizations: vi.fn().mockResolvedValue([
      { id: 'org1', name: 'org1', title: 'Org One', packageCount: 1 },
    ]),
    listDatasets: vi.fn().mockResolvedValue([
      {
        id: 'ds1', name: 'ds1', title: 'Dataset One', notes: '',
        resources: [{ id: 'res1', name: 'Measurements', format: 'CSV', datastoreActive: true, url: '' }],
      },
    ]),
    getFields: vi.fn().mockResolvedValue({
      fields: [{ id: 'site_code', type: 'text' }, { id: 'gwe', type: 'numeric' }],
      total: 100,
    }),
    sqlAvailable: vi.fn().mockResolvedValue(false),
    searchRecords: vi.fn().mockResolvedValue({
      records: [
        { _id: 1, site_code: 'AAA', gwe: 10 },
        { _id: 2, site_code: 'BBB', gwe: 20 },
      ],
      total: 100,
    }),
    searchSql: vi.fn().mockResolvedValue({ records: [] }),
    distinctValues: vi.fn().mockResolvedValue([]),
  }
})

beforeEach(() => {
  ;(globalThis as unknown as { window: { electronAPI: unknown } }).window.electronAPI = {
    app: { getDataPath: async () => '/tmp' },
    file: { read: async () => { throw new Error('none') }, write: async () => {} },
  }
})

import { ApiConnectorBrowser } from './ApiConnectorBrowser'
import { ckanProvider } from '@/lib/api-connectors/ckan'

async function pick(triggerName: RegExp, optionText: string) {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: triggerName }))
  await user.click(await screen.findByText(optionText))
}

describe('ApiConnectorBrowser (CKAN provider)', () => {
  it('renders preview rows after walking the cascade', async () => {
    render(<ApiConnectorBrowser provider={ckanProvider} onClose={() => {}} />)

    await pick(/Select an organization/, 'Org One')
    await pick(/Select a dataset/, 'Dataset One')
    await pick(/Select a resource/, 'Measurements')

    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument())
    expect(screen.getByText('BBB')).toBeInTheDocument()
    expect(screen.getByText('site_code')).toBeInTheDocument()
  })

  it('shows preview rows when Run preview is clicked', async () => {
    const user = userEvent.setup()
    render(<ApiConnectorBrowser provider={ckanProvider} onClose={() => {}} />)

    await pick(/Select an organization/, 'Org One')
    await pick(/Select a dataset/, 'Dataset One')
    await pick(/Select a resource/, 'Measurements')
    await screen.findByText('AAA')

    await user.click(screen.getByRole('button', { name: /Run preview/ }))
    await waitFor(() => expect(screen.getByText('AAA')).toBeInTheDocument())
  })
})
