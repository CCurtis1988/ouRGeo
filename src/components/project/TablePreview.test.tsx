// @vitest-environment jsdom
import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ProjectFileEntry, ProjectFilePreview } from '@/lib/project-files'
const { select } = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('@/store/project-files', () => ({ useProjectFilesStore: { getState: () => ({ select }) } }))
import { TablePreview } from './TablePreview'
const file: ProjectFileEntry = { id: 'f1', name: 'Renamed note.txt', originalName: 'Original.xlsx', folder: '', role: 'reference', userDescription: '', generatedDescription: '', sha256: '', bytes: 100, mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', revision: 'r1', importedAt: '', updatedAt: '', status: 'searchable', coverage: '', saved: true }
const table: NonNullable<ProjectFilePreview['table']> = { sheets: ['Measurements', 'Summary'], sheet: 'Measurements', columns: ['A', 'B'], rows: [{ row: 2, cells: [{ address: 'A2', value: 'Site A', type: 'string' }, { address: 'B2', value: '0.60', raw: '0.6', type: 'number', formula: '=SUM(B3:B4)' }] }], truncated: true }
beforeEach(() => select.mockReset())

it('keeps real worksheet controls after a display rename and exposes cell evidence separately from the grid', () => {
  render(<TablePreview file={file} table={table} />)
  expect(screen.getByRole('table', { name: 'Renamed note.txt preview' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'B2: 0.60' }))
  expect(screen.getByText('Measurements!B2')).toBeTruthy()
  expect(screen.getByText(/Raw value: 0.6/)).toBeTruthy()
  expect(screen.getByText(/Formula: =SUM\(B3:B4\)/)).toBeTruthy()
  expect(screen.getByText(/Cached result shown/)).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Preview worksheet' }), { target: { value: 'Summary' } })
  expect(select).toHaveBeenCalledWith(['f1'], { kind: 'sheet', sheet: 'Summary' })
})

it('shows CSV fields as strings without inventing worksheets', () => {
  render(<TablePreview file={{ ...file, name: 'Measurements.csv', originalName: 'Measurements.csv', mediaType: 'text/csv' }} table={{ ...table, sheets: [], sheet: '', rows: [{ row: 1, cells: [{ address: 'A1', value: 'm, verified', type: 'string' }] }] }} />)
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByRole('button', { name: 'A1: m, verified' })).toBeTruthy()
})
