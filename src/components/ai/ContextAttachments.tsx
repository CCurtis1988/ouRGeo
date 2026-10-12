import React, { useState } from 'react'
import { useSpatialStore } from '@/store/spatial'
import { useEditorStore } from '@/store/editor'
import { useProjectStore } from '@/store/project'
import { useContextStore } from '@/store/context'
import { workspaceSources } from '@/lib/context/sources/workspace'
import { environmentSourceId } from '@/lib/context/source-identity'
import { snapshotDocument } from '@/lib/context/document-snapshots'
import { addAttachment, attachmentSections, stageAttachment, type AttachmentSection, type StagedAttachment } from '@/lib/context/attachments'
import type { ContextSource } from '@/lib/context/types'

interface Choices { layer?: ContextSource; failure?: ContextSource; execution?: ContextSource; document?: ContextSource; sections: AttachmentSection[]; epoch: number; bufferAvailable: boolean }

/** Discovery happens on a deliberate click. Staging stores identity and range,
 * never a hidden copy of editor text or an R observation. */
export function ContextAttachments({ value, onChange, disabled }: { value: StagedAttachment[]; onChange: (value: StagedAttachment[]) => void; disabled: boolean }): React.ReactElement {
  const [choices, setChoices] = useState<Choices | null>(null)
  const [page, setPage] = useState(0)
  const [notice, setNotice] = useState('')
  const [startLine, setStartLine] = useState('1')
  const [endLine, setEndLine] = useState('20')
  const open = (): void => {
    if (choices) { setChoices(null); return }
    const privacy = useContextStore.getState()
    if (!privacy.exclusionsLoaded) { setNotice('Source access is loading. Try attaching again shortly.'); return }
    const sources = workspaceSources(['environment', 'console', 'document']).filter(source => !privacy.excluded.includes(source.id) && !source.legacyIds?.some(id => privacy.excluded.includes(id)))
    const spatial = useSpatialStore.getState()
    const layer = spatial.layers.find(item => item.id === spatial.selectedLayerId)
    const editor = useEditorStore.getState()
    const tab = editor.tabs.find(item => item.id === editor.activeTabId)
    const document = tab && sources.find(source => source.id === `document:${tab.id}`)
    const text = tab && document ? tab.viewMode === 'visual' ? snapshotDocument(tab.id) : tab.content : null
    setChoices({ epoch: useProjectStore.getState().workspaceEpoch,
      layer: layer ? sources.find(source => source.id === environmentSourceId(layer.envName || '.GlobalEnv', layer.name)) : undefined,
      failure: sources.find(source => source.kind === 'console' && source.title.startsWith('Failure')),
      execution: sources.find(source => source.kind === 'console'), document, bufferAvailable: text !== null && text !== undefined,
      sections: text !== null && text !== undefined && text.length <= 1_000_000 ? attachmentSections(text) : [] })
    setPage(0)
    setStartLine('1'); setEndLine('20')
    setNotice(document && text === null ? 'Activate the document so its editor can snapshot current Visual changes.' : document && text && text.length > 1_000_000 ? 'This large document supports selected line ranges. Choose a span under 1 MB; selected content is read progressively when you send.' : '')
  }
  const stage = (source: ContextSource, section?: AttachmentSection): void => {
    if (!choices) return
    try {
      if (choices.epoch !== useProjectStore.getState().workspaceEpoch) throw new Error('The workspace changed. Reopen the attachment picker.')
      const item = stageAttachment(source, choices.epoch, section ? { startLine: section.startLine, endLine: section.endLine } : undefined)
      onChange(addAttachment(value, section ? { ...item, title: `${item.title} · ${section.title}`.slice(0, 160) } : item))
      setNotice('Attachment staged. Current authorised content is read when you send; large sections are delivered progressively.')
      setChoices(null)
    } catch (error) { setNotice((error as Error).message) }
  }
  const action = (source: ContextSource | undefined, label: string): React.ReactElement => <button type="button" disabled={disabled || !source} onClick={() => source && stage(source)} className="text-left text-xs text-geo-accent disabled:text-geo-muted disabled:opacity-50">{label}{source ? `: ${source.title.slice(0, 80)}` : ' (unavailable)'}</button>
  return <div className="space-y-1 text-[11px]">
    <button type="button" disabled={disabled} onClick={open} aria-expanded={Boolean(choices)} className="text-geo-accent disabled:opacity-50">Attach context</button>
    {choices && <div className="border border-geo-border rounded p-2 space-y-2" aria-label="Available context attachments">
      <p className="text-geo-muted">Choose up to three sources for this message. Attaching a layer reads its schema, without data rows.</p>
      <div className="flex flex-col gap-2">{action(choices.layer, 'Active layer schema')}{action(choices.failure, 'Latest failed command')}{action(choices.execution, 'Latest execution')}</div>
      {choices.document && choices.sections.length > 0 && <div className="space-y-1">
        <p className="text-geo-muted">Current document: {choices.document.title.slice(0, 100)}</p>
        {choices.sections.slice(page * 20, (page + 1) * 20).map(section => <button type="button" disabled={disabled} key={section.startLine} onClick={() => stage(choices.document!, section)} className="block text-left text-geo-accent">{section.title} (lines {section.startLine}–{section.endLine})</button>)}
        {choices.sections.length > 20 && <div className="flex gap-2"><button type="button" disabled={!page} onClick={() => setPage(page - 1)}>Previous sections</button><span>{page + 1}/{Math.ceil(choices.sections.length / 20)}</span><button type="button" disabled={(page + 1) * 20 >= choices.sections.length} onClick={() => setPage(page + 1)}>Next sections</button></div>}
      </div>}
      {choices.document && choices.bufferAvailable && <div className="space-y-1">
        <p className="text-geo-muted">Attach selected lines from {choices.document.title.slice(0, 100)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-geo-muted">Start line <input aria-label="Attachment start line" type="number" min="1" step="1" value={startLine} onChange={event => setStartLine(event.target.value)} className="w-20 bg-geo-bg border border-geo-border rounded px-1 text-foreground" /></label>
          <label className="text-geo-muted">End line <input aria-label="Attachment end line" type="number" min="1" step="1" value={endLine} onChange={event => setEndLine(event.target.value)} className="w-20 bg-geo-bg border border-geo-border rounded px-1 text-foreground" /></label>
          <button type="button" disabled={disabled} onClick={() => stage(choices.document!, { title: 'Selected lines', startLine: Number(startLine), endLine: Number(endLine) })} className="text-geo-accent disabled:opacity-50">Attach line range</button>
        </div>
        <p className="text-geo-muted">Up to 1 MB per selected span. Choose fewer lines if it is too large.</p>
      </div>}
    </div>}
    {value.map(item => <div key={item.sourceId} className="flex items-start gap-2 border border-geo-border rounded px-2 py-1"><span className="flex-1 text-geo-muted">Staged: {item.title}{item.range ? ` · lines ${item.range.startLine}–${item.range.endLine}` : ''}</span><button type="button" disabled={disabled} aria-label={`Remove attachment ${item.title}`} onClick={() => onChange(value.filter(other => other.sourceId !== item.sourceId))} className="text-geo-accent">Remove</button></div>)}
    {notice && <p role="status" className="text-geo-muted">{notice}</p>}
  </div>
}
