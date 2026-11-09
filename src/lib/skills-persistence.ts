// The user's skills on disk, in their own file, like custom-themes.json.
//
// A preference, never session state: a skill the user (or the assistant, for them)
// wrote is kept until they delete it, so this file is NOT on the session-scoped
// delete list. Project skills are not here; they travel inside their .ourgeoproj.

import { createJsonFileStore } from '@/lib/persistence'
import { fromFile, toFile } from '@/lib/skills/stored'
import { EMPTY_LIBRARY, type SkillLibraryState } from '@/lib/skills/types'

const store = createJsonFileStore('skills.json', 'Skills')

/**
 * False after reading a file from a newer ouRGeo. Saving over it would replace the
 * user's newer skills with the empty library this version could read, so this
 * version refuses to write rather than strip (as older project writers do).
 */
let writable = true
export const skillLibraryWritable = (): boolean => writable

export async function loadSkillLibrary(): Promise<SkillLibraryState> {
  try {
    const state = fromFile(await store.read(), message => console.warn('[Skills]', message))
    if (!state) { writable = false; console.warn('[Skills] skills.json was written by a newer ouRGeo; it is read-only in this version.'); return EMPTY_LIBRARY }
    writable = true
    return state
  } catch {
    return EMPTY_LIBRARY
  }
}

export async function saveSkillLibrary(state: SkillLibraryState): Promise<void> {
  if (!writable) return
  await store.write(toFile(state))
}
