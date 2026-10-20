/** Device-local image folders are presentation preferences, never project files
 * or AI context grants. Their URLs only resolve while the folder stays linked. */
export interface ThemeFolderImage {
  id: string
  folderId: string
  name: string
  url: string
  posterUrl?: string
  animated: boolean
  width?: number
  height?: number
}

export interface ThemeImageFolder {
  id: string
  themeId: string
  name: string
  path: string
  status: 'ready' | 'missing'
  images: ThemeFolderImage[]
  warning?: string
}

export interface ThemeBackgroundFolderApi {
  list(): Promise<ThemeImageFolder[]>
  link(themeId: string): Promise<ThemeImageFolder | null>
  rescan(folderId: string): Promise<ThemeImageFolder>
  relink(folderId: string): Promise<ThemeImageFolder | null>
  forget(folderId: string): Promise<void>
  onChanged(callback: () => void): () => void
}
