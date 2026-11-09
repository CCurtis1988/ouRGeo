// Skills the assistant can use: the shape every part of the skill system shares.
//
// Four sources feed one library. BUILT-IN skills are the 20 documentation topics
// ouRGeo ships (`OURGEO_TOPICS`); PLUGIN skills come with an installed plugin.
// Both are read-only here — a user who wants to change one duplicates it, as with
// shipped themes. USER skills live on this device; PROJECT skills travel inside a
// .ourgeoproj. Only those two are stored by this module.

/** When the assistant gets a skill. Off is `enabled: false`, not a mode. */
export type SkillMode =
  /** Listed in the catalog; the assistant loads it when it fits. */
  | 'auto'
  /** In context on every turn, as attributed guidance. */
  | 'always'
  /** Never offered; only when the user asks for it by name. */
  | 'manual'

export const SKILL_MODES: readonly SkillMode[] = ['auto', 'always', 'manual']

export type SkillSource = 'builtin' | 'plugin' | 'user' | 'project'

/** Who wrote the current text. Shown as a badge; agent-made skills are reviewed afterwards. */
export type SkillAuthor = 'user' | 'agent' | 'import'

/** Who brought a skill into a turn. */
export type SkillLoader = 'agent' | 'user' | 'router' | 'always'

/** What a SKILL.md file says. */
export interface SkillDefinition {
  /** Lower-case, hyphenated (agentskills.io). The word a user types: `short-report`. */
  name: string
  /** "Use when …": what the catalog shows the model. */
  description: string
  /** Markdown instructions. */
  body: string
  /** Words that make the host offer this skill without the model asking. */
  triggers: string[]
  /** Interface action ids the skill relies on. */
  actions: string[]
  category?: string
  /** Supporting text files by relative path (`references/x.md`). Read on request, never run. */
  resources: Record<string, string>
}

export interface SkillRevision {
  at: string
  by: SkillAuthor
  /** The full SKILL.md text BEFORE this change, so any revision can be restored. */
  text: string
  note?: string
}

export interface SkillUsage {
  loads: number
  lastUsed?: string
  by: Partial<Record<SkillLoader, number>>
}

/** A skill this device stores: a user skill, or a project skill loaded with a project. */
export interface StoredSkill {
  /** `@user/<name>` or `@project/<name>`. The `@` keeps it apart from plugin ids. */
  id: string
  scope: 'global' | 'project'
  definition: SkillDefinition
  enabled: boolean
  mode: SkillMode
  /** The assistant may not change a locked skill. */
  locked: boolean
  /** Hidden from the assistant and the default list, restorable. The assistant archives; it never deletes. */
  archived: boolean
  createdBy: SkillAuthor
  /** Who wrote the current text (an agent can patch a skill a user made). */
  updatedBy: SkillAuthor
  createdAt: string
  updatedAt: string
  history: SkillRevision[]
  usage: SkillUsage
}

/** Mode and on/off for a built-in or plugin skill, whose text cannot change. */
export interface SkillSettings {
  enabled?: boolean
  mode?: SkillMode
}

/** Everything the library persists. */
export interface SkillLibraryState {
  skills: StoredSkill[]
  /** By broker source id (`skill:maps`, `skill:<plugin>:<skill>`). Sparse: absent = shipped default. */
  settings: Record<string, SkillSettings>
  /** Content hashes approved on THIS device. A project bundle cannot add to it. */
  trusted: string[]
}

export const EMPTY_LIBRARY: SkillLibraryState = { skills: [], settings: {}, trusted: [] }

/** Broker source id for a stored skill. Built-in and plugin ids are unchanged (`skill:maps`). */
export const sourceIdOf = (skill: Pick<StoredSkill, 'id'>): string => `skill:${skill.id}`
