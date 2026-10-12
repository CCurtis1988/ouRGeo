import type { DocumentRange } from './types'

export interface FolderDocument { id: string; folderId: string; title: string; summary: string; revision: string }
export interface ContextFolder { id: string; title: string; files: number; omitted: number; limited: boolean; needsRefresh?: boolean }
export interface FolderCatalogue { folders: ContextFolder[]; documents: FolderDocument[] }
export interface FolderContextApi {
  folderCatalogue(lease: string): Promise<FolderCatalogue>
  chooseContextFolder(lease: string): Promise<FolderCatalogue>
  refreshContextFolder(id: string, lease: string): Promise<FolderCatalogue>
  removeContextFolder(id: string, lease: string): Promise<FolderCatalogue>
  readContextFile(id: string, revision: string, lease: string, range?: DocumentRange): Promise<string>
}
