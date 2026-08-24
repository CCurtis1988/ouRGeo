import { useDatabaseStore } from '@/store/database'
import { createJsonFileStore } from '@/lib/persistence'

interface DbPrefs {
  workspaceFolder: string | null
}

const store = createJsonFileStore('database-prefs.json', 'DatabasePrefs')

export async function saveDatabasePrefs(): Promise<void> {
  const data: DbPrefs = {
    workspaceFolder: useDatabaseStore.getState().workspaceFolder,
  }
  await store.write(data)
}

export async function loadDatabasePrefs(): Promise<void> {
  const data = await store.read<Partial<DbPrefs>>()
  if (data.workspaceFolder) {
    useDatabaseStore.getState().setWorkspaceFolder(data.workspaceFolder)
  }
}
