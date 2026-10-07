type SnapshotReader = (tabId: string) => string | null
const readers = new Map<string, SnapshotReader>()

/** Editors own their unsaved Visual buffers. A read-only supported snapshot
 * avoids switching views, rewriting Markdown or destroying Monaco undo. */
export function registerDocumentSnapshot(editorId: string, read: SnapshotReader): () => void {
  readers.set(editorId, read)
  return () => { if (readers.get(editorId) === read) readers.delete(editorId) }
}
export function snapshotDocument(tabId: string): string | null {
  for (const read of readers.values()) {
    const snapshot = read(tabId)
    if (snapshot !== null) return snapshot
  }
  return null
}
