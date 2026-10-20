// Projects: the .ourgeoproj bundle and the scratch workspace.
//
// Everything here delegates to project-persistence.ts, which already owns the
// order these have to happen in (reset → hydrate stores → /env/load →
// /db/reconnect). Re-implementing any of it for the assistant would produce a
// project that loads *almost* correctly.
//
// New and Open are `confirm`: both discard the current session, and a project
// with unsaved work is exactly the thing a user does not want an assistant to
// decide about on its own.

import { useProjectStore } from '@/store/project'
import {
  saveCurrentProject, saveProjectAs,
} from '@/lib/project-persistence'
import { ok, fail, argStr, argNum, argList, type UiAction, type ActionResult } from './types'
import { switchProject } from '@/lib/project-leave'
import { useContextStore } from '@/store/context'
import { hasColumnExclusions } from '@/store/column-disclosure'
import { projectFileSourceId, type ProjectFileEntry, type ProjectFileRole, type ProjectLinkedFolder } from '@/lib/project-files'
import { openProjectFiles } from '@/lib/project-files-ui'
import { projectFileDescription } from '@/lib/project-file-description'
import { projectFileAvailable } from '@/lib/project-file-availability'
import { validProjectFileLocation } from '@/lib/project-file-citations'

async function projectFileScope() {
  const project = useProjectStore.getState(), policyRevision = useContextStore.getState().policyRevision
  const validate = (): void => {
    const current = useProjectStore.getState(), disclosure = useContextStore.getState()
    if (!project.path || !project.projectId || current.workspaceEpoch !== project.workspaceEpoch || current.projectId !== project.projectId || current.phase !== 'ready') throw new Error('Save and open a named project, then retry Project Files.')
    if (!disclosure.exclusionsLoaded || disclosure.policyRevision !== policyRevision || hasColumnExclusions()) throw new Error('Project-file access is unavailable under the current source privacy controls. Review Privacy & sources and retry.')
  }
  validate()
  const lease = await window.electronAPI.context.lease()
  validate()
  const catalogue = await window.electronAPI.projectFiles.catalogue(lease.id)
  validate()
  if (catalogue.projectId !== project.projectId) throw new Error('The project changed. List its files again before acting.')
  const files = catalogue.files.filter(file => projectFileAvailable(file, catalogue) && !useContextStore.getState().excluded.includes(projectFileSourceId(project.projectId!, file.id)))
  return { project, files, folders: catalogue.linkedFolders ?? [], lease: lease.id, validate }
}
async function fileAction(run: (scope: Awaited<ReturnType<typeof projectFileScope>>) => ActionResult | Promise<ActionResult>): Promise<ActionResult> {
  try { return await run(await projectFileScope()) }
  catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
}
function selectedFile(files: ProjectFileEntry[], id: string, revision?: string): ProjectFileEntry {
  const file = files.find(file => file.id === id)
  if (!file) throw new Error('This project file is unavailable or excluded. Use project:files to choose an authorised file.')
  if (revision && file.revision !== revision) throw new Error('The file changed. Use project:files for its current revision and ask again.')
  return file
}

function selectedFolder(folders: ProjectLinkedFolder[], id: string): ProjectLinkedFolder {
  const folder = folders.find(folder => folder.id === id)
  if (!folder) throw new Error('This linked folder is unavailable. Use project:folders to choose a current folder reference.')
  return folder
}
function absoluteFolderPath(path: string): string {
  // Explicitly reject control characters before the main process resolves a path.
  // eslint-disable-next-line no-control-regex
  if (path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path) || !(path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(path))) throw new Error('Provide an explicit absolute folder path. The assistant cannot open a native folder picker.')
  return path
}
function physicalFolderName(name: string): string {
  // A single cross-platform child name cannot contain path/control characters.
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > 240 || name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name) || /[. ]$/.test(name)) throw new Error('Choose a new folder name without path separators, reserved characters or a trailing dot/space. Supply its parent separately.')
  return name
}

export const projectActions: UiAction[] = [
  {
    id: 'project:folders', group: 'project', tier: 'always', summary: 'Browse the current project’s linked-folder references, local paths and scan/recovery status. This does not read file contents.',
    params: [{ name: 'query', type: 'string', description: 'Optional words in a folder label.' }, { name: 'offset', type: 'number', description: 'Zero-based folder page offset; default zero.' }, { name: 'limit', type: 'number', description: 'Maximum folder references, from 1 to 50; default 20.' }],
    run: args => fileAction(({ folders }) => {
      const query = argStr(args, 'query').toLocaleLowerCase(), offset = argNum(args, 'offset', 0), limit = argNum(args, 'limit', 20)
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return fail('Choose a non-negative integer offset and a limit from 1 to 50.')
      const matching = folders.filter(folder => !query || folder.name.toLocaleLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      const entries = matching.slice(offset, offset + limit).map(folder => ({ id: folder.id, name: folder.name, status: folder.status, path: folder.path, lastScannedAt: folder.lastScannedAt, issue: folder.issue, omitted: folder.omitted, limited: folder.limited }))
      return ok('Linked-folder metadata only. Unlinked, missing, changed or unscanned folders cannot establish current file contents. Rescan or relink before reading; forgetting a link leaves the folder and its contents on disk.', JSON.stringify({ entries, total: matching.length, nextOffset: offset + entries.length < matching.length ? offset + entries.length : null }))
    }),
  },
  {
    id: 'project:linkFolder', group: 'project', tier: 'confirm', summary: 'Link an existing physical folder at an explicit path. Its files stay in place and are discovered by a bounded local scan.',
    params: [{ name: 'path', type: 'string', required: true, description: 'Explicit absolute path to the existing folder; no native picker is opened.' }, { name: 'name', type: 'string', description: 'Optional display label for this folder reference.' }],
    run: args => fileAction(async ({ lease, validate }) => {
      const path = absoluteFolderPath(argStr(args, 'path'))
      validate(); await window.electronAPI.projectFiles.linkFolder(lease, path, argStr(args, 'name') || undefined); validate()
      return ok('Folder linked in place. Review its scan status in Project Files and save the project to retain the reference. Its file bytes are not embedded in the project bundle.')
    }),
  },
  {
    id: 'project:createFolder', group: 'project', tier: 'confirm', summary: 'Create one new physical folder beneath an explicit parent and link it to this project. Existing folders are never overwritten.',
    params: [{ name: 'parentPath', type: 'string', required: true, description: 'Explicit absolute path of the existing parent directory.' }, { name: 'name', type: 'string', required: true, description: 'New physical folder name, without path separators.' }, { name: 'label', type: 'string', description: 'Optional label shown in Project Files.' }],
    run: args => fileAction(async ({ lease, validate }) => {
      const parent = absoluteFolderPath(argStr(args, 'parentPath')), name = physicalFolderName(argStr(args, 'name'))
      validate(); await window.electronAPI.projectFiles.createFolder(lease, name, parent, argStr(args, 'label') || undefined); validate()
      return ok('Created and linked the new physical folder. Files placed there remain on disk. Save the project to retain its reference.')
    }),
  },
  {
    id: 'project:forgetFolder', group: 'project', tier: 'confirm', summary: 'Forget a project’s folder reference and revoke access to its indexed files. The physical folder and all its contents are retained.',
    params: [{ name: 'id', type: 'string', required: true, description: 'Current folder reference ID returned by project:folders.' }],
    run: args => fileAction(async ({ folders, lease, validate }) => {
      const folder = selectedFolder(folders, argStr(args, 'id'))
      validate(); await window.electronAPI.projectFiles.forgetFolder(folder.id, lease); validate()
      return ok('Folder link forgotten. The physical folder and its contents remain on disk. Its previous indexed evidence is unavailable; save the project to retain this change.')
    }),
  },
  {
    id: 'project:rescanFolders', group: 'project', tier: 'autopilot', summary: 'Rescan selected locally linked folders, or all locally linked folders, for current file metadata and bounded text extraction.',
    params: [{ name: 'ids', type: 'strings', description: 'Folder reference IDs returned by project:folders; omit for all references with a current local link.' }],
    run: args => fileAction(async ({ folders, lease, validate }) => {
      const requested = argList(args, 'ids'), selected = requested.length ? [...new Set(requested)].map(id => selectedFolder(folders, id)) : folders.filter(folder => folder.path && folder.status !== 'unlinked')
      if (selected.some(folder => !folder.path || folder.status === 'unlinked')) return fail('A selected folder has no local link. Use project:relinkFolder with an explicit local path before rescanning.')
      if (!selected.length) return ok('There are no locally linked folders to rescan. Use project:folders to find references that need relinking.')
      validate(); await window.electronAPI.projectFiles.rescanFolders(selected.map(folder => folder.id), lease); validate()
      return ok(`Local rescan requested for ${selected.length} linked folder(s). Wait for Ready before reading evidence; scan limits and omitted files appear in Project Files. No paid model call was made.`)
    }),
  },
  {
    id: 'project:relinkFolder', group: 'project', tier: 'confirm', summary: 'Reconnect an existing project folder reference to an explicit local path, then rebuild its current catalogue. Old bytes are never assumed current.',
    params: [{ name: 'id', type: 'string', required: true, description: 'Folder reference ID returned by project:folders.' }, { name: 'path', type: 'string', required: true, description: 'Explicit absolute local folder path; no native picker is opened.' }],
    run: args => fileAction(async ({ folders, lease, validate }) => {
      const folder = selectedFolder(folders, argStr(args, 'id')), path = absoluteFolderPath(argStr(args, 'path'))
      validate(); await window.electronAPI.projectFiles.relinkFolder(folder.id, lease, path); validate()
      return ok('Folder relinked. Review its fresh scan status before relying on any contents; save the project to retain the reference.')
    }),
  },
  {
    id: 'project:renameFolder', group: 'project', tier: 'autopilot', summary: 'Change a linked folder’s display label in Project Files. Its physical directory name and path stay unchanged.',
    params: [{ name: 'id', type: 'string', required: true, description: 'Folder reference ID returned by project:folders.' }, { name: 'name', type: 'string', required: true, description: 'New display label, up to 240 characters.' }],
    run: args => fileAction(async ({ folders, lease, validate }) => {
      const folder = selectedFolder(folders, argStr(args, 'id')), name = argStr(args, 'name').trim()
      if (!name || name.length > 240) return fail('Choose a non-empty folder label of up to 240 characters.')
      validate(); await window.electronAPI.projectFiles.renameLinkedFolder(folder.id, name, lease); validate()
      return ok('Linked-folder display label updated. Save the project to retain this change.')
    }),
  },
  {
    id: 'project:files', group: 'project', tier: 'always',
    summary: 'Browse authorised project-file metadata by name, description, folder, role or status. Contents require context_search/read.',
    params: [
      { name: 'query', type: 'string', description: 'Words in the name or description; omit to browse.' },
      { name: 'folder', type: 'string', description: 'Exact logical folder path within the project library.' },
      { name: 'folderId', type: 'string', description: 'Optional linked root ID from project:folders; narrows the list to files in that root.' },
      { name: 'role', type: 'enum', values: ['reference', 'standard', 'example'], description: 'File role filter.' },
      { name: 'status', type: 'enum', values: ['queued', 'indexing', 'searchable', 'partial', 'preview', 'stored', 'password', 'error'], description: 'Processing status filter.' },
      { name: 'offset', type: 'number', description: 'Zero-based metadata page offset, initially zero.' },
      { name: 'limit', type: 'number', description: 'Maximum entries in the page, from 1 to 50; default 20.' },
    ],
    run: args => fileAction(({ files, project }) => {
      const query = argStr(args, 'query').toLocaleLowerCase(), folder = argStr(args, 'folder'), folderId = argStr(args, 'folderId'), role = argStr(args, 'role'), status = argStr(args, 'status')
      const offset = argNum(args, 'offset', 0), limit = argNum(args, 'limit', 20)
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return fail('Choose a non-negative integer offset and a limit from 1 to 50.')
      const matching = files.filter(file => (!query || `${file.name} ${projectFileDescription(file)} ${file.generatedDescription}`.toLocaleLowerCase().includes(query)) && (!folder || file.folder === folder) && (!folderId || file.storage?.folderId === folderId) && (!role || file.role === role) && (!status || file.status === status)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      const entries = matching.slice(offset, offset + limit).map(file => ({ id: file.id, sourceId: projectFileSourceId(project.projectId!, file.id), name: file.name, revision: file.revision, folder: file.folder, role: file.role, status: file.status, description: projectFileDescription(file).slice(0, 400), coverage: file.coverage.slice(0, 300), storage: file.storage ? { kind: 'linked', folderId: file.storage.folderId, relativePath: file.storage.relativePath, readable: file.sha256.length > 0 } : { kind: 'embedded' }, saved: file.saved }))
      return ok('Authorised project-file metadata only. A missing keyword match does not prove a file is absent; omit filters to browse. Use context_search with group project-files to search extracted contents.', JSON.stringify({ entries, total: matching.length, nextOffset: offset + entries.length < matching.length ? offset + entries.length : null }))
    }),
  },
  {
    id: 'project:showFile', group: 'project', tier: 'always', summary: 'Show an authorised current project file in its movable Project Files pane, optionally at a typed location.',
    params: [{ name: 'id', type: 'string', required: true, description: 'File ID returned by project:files.' }, { name: 'revision', type: 'string', description: 'Expected current file revision; refuses an earlier revision.' }, { name: 'location', type: 'json', description: 'Optional typed location: {kind:pdf,page:80}, {kind:docx,section:2}, {kind:sheet,sheet:Measurements,range:A1:D20}, {kind:lines,start:1,end:20}, or {kind:image}.' }],
    run: args => fileAction(({ files, validate }) => {
      const file = selectedFile(files, argStr(args, 'id'), argStr(args, 'revision'))
      if (args.location !== undefined && !validProjectFileLocation(args.location)) return fail('Choose one valid typed file location, then retry project:showFile.')
      validate(); openProjectFiles(file.id, args.location)
      return ok(`Showing ${file.name} in Project Files. Opening its preview does not send its contents to the model.`)
    }),
  },
  {
    id: 'project:updateFile', group: 'project', tier: 'autopilot', summary: 'Edit an authorised project file name, description, logical folder or role; originals remain unchanged and project Save persists metadata.',
    params: [{ name: 'id', type: 'string', required: true, description: 'File ID returned by project:files.' }, { name: 'revision', type: 'string', required: true, description: 'Expected current revision returned by project:files.' }, { name: 'name', type: 'string', description: 'New display name.' }, { name: 'description', type: 'string', description: 'User-authored description; an empty string clears it.' }, { name: 'folder', type: 'string', description: 'Logical folder; an empty string returns the file to the root.' }, { name: 'role', type: 'enum', values: ['reference', 'standard', 'example'], description: 'Reference, standard or figure/report example.' }],
    run: args => fileAction(async ({ files, lease, validate }) => {
      const file = selectedFile(files, argStr(args, 'id'), argStr(args, 'revision'))
      const changes: Partial<Pick<ProjectFileEntry, 'name' | 'folder' | 'role' | 'userDescription'>> = {}
      for (const key of ['name', 'folder'] as const) if (args[key] !== undefined) changes[key] = argStr(args, key)
      if (args.description !== undefined) changes.userDescription = argStr(args, 'description')
      if (args.role !== undefined) changes.role = argStr(args, 'role') as ProjectFileRole
      if (!Object.keys(changes).length) return fail('Provide a name, description, folder or role to change.')
      validate(); await window.electronAPI.projectFiles.update(file.id, file.revision, changes, lease); validate()
      return ok('Project file details updated. Save the project to include these changes in its portable bundle.')
    }),
  },
  {
    id: 'project:removeFile', group: 'project', tier: 'confirm', summary: 'Remove one authorised project-file reference and original from the current working library; project Save persists removal.',
    params: [{ name: 'id', type: 'string', required: true, description: 'File ID returned by project:files.' }, { name: 'revision', type: 'string', required: true, description: 'Expected current revision of the file to remove.' }],
    run: args => fileAction(async ({ files, lease, validate }) => {
      const file = selectedFile(files, argStr(args, 'id'), argStr(args, 'revision'))
      validate(); await window.electronAPI.projectFiles.remove([file.id], lease); validate()
      return ok('Removed this file reference from the project. The source file on disk is retained. Undo is available in Project Files until save.')
    }),
  },
  {
    id: 'project:reindexFiles', group: 'project', tier: 'autopilot', summary: 'Rebuild local extraction and generated metadata for selected authorised files, or all authorised files. Preserves user descriptions.',
    params: [{ name: 'ids', type: 'strings', description: 'File IDs from project:files; omit to reindex all authorised project files.' }],
    run: args => fileAction(async ({ files, lease, validate }) => {
      const requested = argList(args, 'ids'), ids = requested.length ? [...new Set(requested.map(id => selectedFile(files, id).id))] : files.map(file => file.id)
      if (!ids.length) return ok('There are no authorised project files to reindex.')
      validate(); await window.electronAPI.projectFiles.reindex(ids, lease); validate()
      return ok(`Local reindex requested for ${ids.length} authorised file(s). Processing and any incomplete extraction appear in Project Files; no paid model call was made.`)
    }),
  },
  {
    id: 'project:status',
    group: 'project',
    tier: 'always',
    summary: 'The current project: its name, path, whether it has unsaved changes, and the recents list.',
    params: [],
    run: () => {
      const s = useProjectStore.getState()
      const lines = [
        s.path
          ? `Project "${s.name}" — ${s.path}${s.isDirty ? ' (unsaved changes)' : ''}.`
          : `Scratch workspace ("${s.name}"). It is never saved in place; Save As makes it a real project.`,
      ]
      lines.push(s.recents.length > 0
        ? `Recent projects: ${s.recents.map((r) => `${r.name} (${r.path})`).join('; ')}.`
        : 'No recent projects.')
      return ok(lines.join('\n'))
    },
  },

  {
    id: 'project:save',
    group: 'project',
    tier: 'autopilot',
    summary: 'Save the current project in place. Not available for the scratch workspace.',
    params: [],
    run: async () => {
      const s = useProjectStore.getState()
      if (!s.path) {
        return fail('This is the scratch workspace, which cannot be saved in place. ' +
          'Use project:saveAs to turn it into a real .ourgeoproj.')
      }
      const saved = await saveCurrentProject()
      return saved ? ok(`Saved "${s.name}" to ${s.path}.`) : fail('Save failed.')
    },
  },

  {
    id: 'project:saveAs',
    group: 'project',
    tier: 'autopilot',
    summary: 'Save the session as a new .ourgeoproj bundle. Opens the system save dialog for the user to pick a location.',
    params: [],
    run: async () => {
      const saved = await saveProjectAs()
      if (!saved) return fail('Save As was cancelled or failed.')
      const s = useProjectStore.getState()
      return ok(`Saved as "${s.name}" (${s.path}).`)
    },
  },

  {
    id: 'project:open',
    group: 'project',
    // Loading resets the R session and replaces every open tab and layer.
    tier: 'confirm',
    summary:
      'Open a .ourgeoproj bundle. The current project\'s unsaved work is kept on this computer ' +
      '(scratch asks first); R and the workspace are replaced by the opened project. Omit the path to let the user pick the file.',
    params: [
      { name: 'path', type: 'string', description: 'Absolute path to the .ourgeoproj file.' },
    ],
    run: async (args) => {
      const path = argStr(args, 'path')
      // Through the same leave-then-open as the project menu: the current
      // project's work goes to its draft, and scratch asks before dropping
      // anything (lib/project-leave.tsx).
      const loaded = await switchProject(path ? { kind: 'open', path } : { kind: 'pick' })
      if (!loaded) return fail(path ? `Could not load "${path}".` : 'Open was cancelled or failed.')
      const s = useProjectStore.getState()
      return ok(`Opened project "${s.name}" (${s.path}).`)
    },
  },

  {
    id: 'project:new',
    group: 'project',
    // Clears every user object in R.
    tier: 'confirm',
    summary: 'Go to scratch: a clean R session with scratch\'s untitled documents restored.',
    params: [],
    run: async () => {
      if (!await switchProject({ kind: 'scratch' })) return fail('The user cancelled leaving the current workspace.')
      return ok('Started a new scratch workspace. The R session is clean.')
    },
  },
]
