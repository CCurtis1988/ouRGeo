import React, { useEffect, useState } from 'react'
import type { ProjectFileEntry, ProjectFilePreview } from '@/lib/project-files'
import { useProjectFilesStore } from '@/store/project-files'

type Table = NonNullable<ProjectFilePreview['table']>
type Cell = Table['rows'][number]['cells'][number]

export function TablePreview({ file, table }: { file: ProjectFileEntry; table: Table }): React.ReactElement {
  const [selected, setSelected] = useState<Cell | null>(null)
  useEffect(() => setSelected(null), [file.id, file.revision, table.sheet, table.rows])
  const workbook = file.mediaType.includes('spreadsheetml') || /\.xlsx$/i.test(file.originalName)
  return <div className="space-y-2 text-xs mt-2">
    {workbook && <label className="flex items-center gap-2">Worksheet<select aria-label="Preview worksheet" value={table.sheet} className="rounded border border-geo-border bg-geo-bg px-2 py-1 text-foreground" onChange={event => { setSelected(null); useProjectFilesStore.getState().select([file.id], { kind: 'sheet', sheet: event.target.value }) }}>{table.sheets.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label>}
    <div className="overflow-auto max-h-80 border border-geo-border" tabIndex={0} aria-label="Scrollable table preview">
      <table className="border-collapse min-w-full text-left font-mono" aria-label={`${file.name} preview`}>
        <thead className="sticky top-0 bg-geo-panel"><tr><th className="border-b border-r border-geo-border px-2 py-1" scope="col">Row</th>{table.columns.map(column => <th className="border-b border-r border-geo-border px-2 py-1" key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{table.rows.map(row => { const cells = new Map(row.cells.map(cell => [cell.address.replace(/\d+$/, ''), cell])); return <tr key={row.row}><th className="border-b border-r border-geo-border px-2 py-1 font-normal bg-geo-panel" scope="row">{row.row}</th>{table.columns.map(column => { const cell = cells.get(column); return <td key={column} className="border-b border-r border-geo-border p-0"><button type="button" className="block min-w-20 max-w-56 truncate px-2 py-1 text-left w-full hover:bg-geo-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-geo-accent" title={cell?.value ?? ''} aria-label={`${column}${row.row}: ${cell?.value || 'Empty'}`} onClick={() => setSelected(cell ?? { address: `${column}${row.row}`, value: '' })}>{cell?.value || '\u00a0'}</button></td> })}</tr> })}</tbody>
      </table>
    </div>
    {selected && <div className="rounded border border-geo-border p-2 space-y-1" aria-label="Selected cell details"><p className="font-medium">{workbook ? `${table.sheet}!` : ''}{selected.address}</p><p className="whitespace-pre-wrap break-words">Value: {selected.value || '(empty)'}</p>{selected.type && <p>Type: {selected.type}</p>}{selected.raw !== undefined && selected.raw !== selected.value && <p className="break-words">Raw value: {selected.raw}</p>}{selected.formula && <p className="font-mono break-words">Formula: {selected.formula}<br />Cached result shown; formulas are not recalculated.</p>}</div>}
    <p>{table.truncated ? 'Bounded preview. Select a smaller range or read further through the assistant.' : 'Read-only values from the original file.'}</p>
  </div>
}
