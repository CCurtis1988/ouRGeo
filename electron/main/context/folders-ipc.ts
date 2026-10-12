import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { ContextFolders } from './folders'
import { contextLease, subscribeContextScope } from './scope'

/** Only a user-facing picker grants a root. Model tools receive opaque file IDs,
 * never paths, and imported project bundles cannot populate this registry. */
export function registerContextFolders(ipc: IpcMain, authorised: (event: IpcMainInvokeEvent) => void, choose: () => Promise<string | null>, changed: () => void): void {
  const folders = new ContextFolders(() => contextLease().id, changed)
  subscribeContextScope(() => { folders.clear(); changed() })
  ipc.handle('context:folderCatalogue', (event, lease) => { authorised(event); return folders.catalogue(lease) })
  ipc.handle('context:chooseFolder', async (event, lease) => {
    authorised(event); folders.catalogue(lease)
    const root = await choose()
    const result = root ? await folders.add(root, lease) : folders.catalogue(lease)
    changed(); return result
  })
  ipc.handle('context:refreshFolder', async (event, id, lease) => {
    authorised(event)
    const result = await folders.refresh(id, lease)
    changed(); return result
  })
  ipc.handle('context:removeFolder', (event, id, lease) => { authorised(event); const result = folders.remove(id, lease); changed(); return result })
  ipc.handle('context:readFolderFile', (event, id, revision, lease, range) => {
    authorised(event)
    if (typeof id !== 'string' || id.length > 128 || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision) || range !== undefined && (!range || !Number.isSafeInteger(range.startLine) || !Number.isSafeInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine || range.endLine - range.startLine > 10000)) throw new Error('Choose a current file and a bounded line range.')
    return folders.read(id, revision, lease, range)
  })
}
