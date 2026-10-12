// The R environment and the Packages panel.
//
// These wrap the /env and /packages endpoints the Environment and Packages
// panels use, so an assistant that renames an object moves the same panel the
// user is looking at. Every one of them could be done with `execute_r_code`
// instead; going through the endpoints is what keeps the panels in step and the
// operation echoed the way the GUI echoes it.

import { rClient } from '@/lib/r-client'
import { GLOBAL_ENV, panelEnvironments } from '@/lib/environments'
import { setWorkingEnv, workingEnv } from '@/lib/working-env'
import { useEnvironmentStore } from '@/store/environment'
import { usePackagesStore } from '@/store/packages'
import { useEditorStore } from '@/store/editor'
import { useSessionStore } from '@/store/session'
import { ok, fail, argStr, argBool, type UiAction } from './types'

async function refreshEnvironments(): Promise<void> {
  const res = await rClient.listEnvironments().catch(() => null)
  if (res?.success) useEnvironmentStore.getState().setEnvironments(res.environments)
}

/**
 * The environments the user keeps objects in — .GlobalEnv and the ones they
 * made. The same list the panel draws, promoted the same way, so "list the
 * objects in scratch" answers instead of coming back empty: a user environment
 * is an OBJECT in .GlobalEnv, and `!isSearchPath` alone never reaches inside it.
 */
function userEnvironments(): ReturnType<typeof panelEnvironments> {
  const { environments, envPlacement } = useEnvironmentStore.getState()
  return panelEnvironments(environments, envPlacement).filter((e) => !e.isSearchPath)
}

/** Which environment holds an object, for actions that take a bare name. */
function envOf(name: string): string | null {
  const hit = userEnvironments().find((e) => e.objects.some((o) => o.name === name))
  return hit?.name ?? null
}

/** Whether `name` in `env` is itself an environment — copying one is not the
 *  same operation, see `env:copy`. */
function isEnvObject(name: string, env: string): boolean {
  const envs = userEnvironments()
  // An environment listed BESIDE .GlobalEnv is lifted out of .GlobalEnv's own
  // object list, so looking only in `objects` answers "no" for exactly the
  // environments the user made — and env:copy would then alias one instead of
  // copying it.
  if (envs.some((e) => e.isUserEnv && e.name === name && (e.parentEnv ?? GLOBAL_ENV) === env)) {
    return true
  }
  return envs.find((e) => e.name === env)?.objects.find((o) => o.name === name)?.isEnvironment === true
}

export const environmentActions: UiAction[] = [
  {
    id: 'env:list',
    group: 'environment',
    tier: 'always',
    summary: 'List the objects in the R environment, with class and dimensions.',
    params: [
      { name: 'env', type: 'string', default: '.GlobalEnv', description: 'Environment name.' },
      { name: 'pattern', type: 'string', description: 'Only names containing this text.' },
    ],
    run: async (args) => {
      await refreshEnvironments()
      const wantEnv = argStr(args, 'env')
      const pattern = argStr(args, 'pattern').toLowerCase()
      const envs = userEnvironments().filter((e) => !wantEnv || e.name === wantEnv)
      const lines: string[] = []
      for (const env of envs) {
        const objs = env.objects.filter((o) => !pattern || o.name.toLowerCase().includes(pattern))
        if (objs.length === 0) continue
        lines.push(`${env.name}:`)
        for (const o of objs) {
          const dim = o.dim ? ` [${o.dim.join('×')}]` : o.length != null ? ` (length ${o.length})` : ''
          lines.push(`  ${o.name}: ${o.class}${dim} — ${o.preview}`)
        }
      }
      // Where code runs matters to every later call: an object listed under
      // `scratch` can be named bare only while the console is working there.
      const where = workingEnv()
      if (where !== GLOBAL_ENV) lines.push(`(the console is working in ${where})`)
      return lines.length > 0 ? ok(lines.join('\n')) : ok('No matching objects in the R environment.')
    },
  },

  {
    id: 'env:view',
    group: 'environment',
    tier: 'always',
    summary: 'Open an object in the Data Viewer, the way clicking it in the Environment panel does.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Object name.' },
      { name: 'env', type: 'string', default: '.GlobalEnv', description: 'Environment it lives in.' },
    ],
    run: async (args) => {
      const name = argStr(args, 'name')
      await refreshEnvironments()
      const env = argStr(args, 'env') || envOf(name)
      if (!env) return fail(`No object called "${name}" in the R environment.`)
      const info = useEnvironmentStore.getState().environments
        .find((e) => e.name === env)?.objects.find((o) => o.name === name)
      if (!info) return fail(`No object called "${name}" in ${env}.`)
      const viewer = info.class === 'function' ? 'function-editor' : 'data-viewer'
      useEditorStore.getState().addObjectTab(name, env, info.class, name, viewer)
      return ok(`Opened "${name}" (${info.class}) in the ${viewer === 'data-viewer' ? 'Data Viewer' : 'function editor'}.`)
    },
  },

  {
    id: 'env:remove',
    group: 'environment',
    // rm() with no undo.
    tier: 'confirm',
    summary: 'Delete an object from the R environment.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Object to remove.' },
      { name: 'env', type: 'string', default: '.GlobalEnv', description: 'Environment it lives in.' },
    ],
    run: async (args) => {
      const name = argStr(args, 'name')
      const env = argStr(args, 'env') || envOf(name) || '.GlobalEnv'
      const res = await rClient.envRemove(name, env)
      await refreshEnvironments()
      return res.success ? ok(`Removed "${name}" from ${env}.`) : fail(res.error ?? 'Remove failed.')
    },
  },

  {
    id: 'env:rename',
    group: 'environment',
    tier: 'autopilot',
    summary: 'Rename an object in the R environment.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Current name.' },
      { name: 'newName', type: 'string', required: true, description: 'New name.' },
      { name: 'env', type: 'string', default: '.GlobalEnv', description: 'Environment it lives in.' },
    ],
    run: async (args) => {
      const name = argStr(args, 'name')
      const newName = argStr(args, 'newName')
      const env = argStr(args, 'env') || envOf(name) || '.GlobalEnv'
      const res = await rClient.envRename(name, newName, env)
      await refreshEnvironments()
      return res.success ? ok(`Renamed "${name}" to "${newName}".`) : fail(res.error ?? 'Rename failed.')
    },
  },

  {
    id: 'env:copy',
    group: 'environment',
    tier: 'autopilot',
    summary: 'Copy an object into another environment.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Object to copy.' },
      { name: 'from', type: 'string', default: '.GlobalEnv', description: 'Source environment.' },
      { name: 'to', type: 'string', required: true, description: 'Destination environment.' },
      { name: 'newName', type: 'string', description: 'Name in the destination; defaults to the same.' },
    ],
    run: async (args) => {
      const name = argStr(args, 'name')
      const from = argStr(args, 'from') || envOf(name) || '.GlobalEnv'
      const to = argStr(args, 'to')
      const newName = argStr(args, 'newName') || name
      // An environment is a reference: `assign(new, get(old))` makes a second
      // name for the same environment, so a later change through either shows
      // up in both. Copying one means copying its contents.
      const res = isEnvObject(name, from)
        ? await rClient.envDuplicate(name, newName, from, to)
        : await rClient.envCopy(name, from, to, newName)
      await refreshEnvironments()
      return res.success ? ok(`Copied "${name}" from ${from} to ${to}.`) : fail(res.error ?? 'Copy failed.')
    },
  },

  {
    id: 'env:move',
    group: 'environment',
    tier: 'autopilot',
    summary: 'Move an object to another environment.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Object to move.' },
      { name: 'from', type: 'string', default: '.GlobalEnv', description: 'Source environment.' },
      { name: 'to', type: 'string', required: true, description: 'Destination environment.' },
    ],
    run: async (args) => {
      const name = argStr(args, 'name')
      const from = argStr(args, 'from') || envOf(name) || '.GlobalEnv'
      const to = argStr(args, 'to')
      const res = await rClient.envMove(name, from, to)
      await refreshEnvironments()
      return res.success ? ok(`Moved "${name}" from ${from} to ${to}.`) : fail(res.error ?? 'Move failed.')
    },
  },

  {
    id: 'env:create',
    group: 'environment',
    tier: 'autopilot',
    summary:
      'Create a new R environment. It is created in .GlobalEnv and listed beside it in the panel; ' +
      'its objects are named env$object. A name already in use is refused rather than overwritten.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Name for the environment.' },
      { name: 'parent', type: 'string', description: 'Parent environment; defaults to .GlobalEnv.' },
    ],
    run: async (args) => {
      const name = argStr(args, 'name')
      const res = await rClient.envCreate(name, argStr(args, 'parent') || undefined)
      await refreshEnvironments()
      return res.success ? ok(`Created environment "${name}".`) : fail(res.error ?? 'Create failed.')
    },
  },

  {
    id: 'env:workIn',
    group: 'environment',
    // It changes where every later `execute_r_code` evaluates and where the
    // objects it creates land, which is exactly what the Autopilot switch is
    // about — even though nothing in R has run yet.
    tier: 'autopilot',
    summary:
      'Run console and tool code inside an environment instead of .GlobalEnv, so its objects ' +
      'can be named directly (R looks names up outwards, never into an environment). ' +
      'Pass .GlobalEnv to go back.',
    params: [
      { name: 'env', type: 'string', default: GLOBAL_ENV, description: 'Environment to work in.' },
    ],
    run: async (args) => {
      const name = argStr(args, 'env') || GLOBAL_ENV
      await refreshEnvironments()
      if (name !== GLOBAL_ENV && !userEnvironments().some((e) => e.name === name)) {
        return fail(`There is no environment called "${name}". ` +
          `Working environments are ${userEnvironments().map((e) => e.name).join(', ')}.`)
      }
      setWorkingEnv(name)
      return ok(name === GLOBAL_ENV
        ? 'Working in .GlobalEnv again.'
        : `Working in ${name}. Code now runs as evalq({ … }, ${name}); .GlobalEnv is still ` +
          'visible through it, and new objects are created there.')
    },
  },

  {
    id: 'env:save',
    group: 'environment',
    tier: 'autopilot',
    summary: 'Save environment objects to an .RData file.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Absolute path to write.' },
      { name: 'env', type: 'string', default: '.GlobalEnv', description: 'Environment to save.' },
    ],
    run: async (args) => {
      const path = argStr(args, 'path')
      const env = argStr(args, 'env') || '.GlobalEnv'
      // excludeSystem keeps the server's own source()d helpers out of the file.
      const res = await rClient.envSave([env], path, undefined, true)
      return res.success ? ok(`Saved ${env} to ${path}.`) : fail(res.error ?? 'Save failed.')
    },
  },

  {
    id: 'env:load',
    group: 'environment',
    tier: 'autopilot',
    summary: 'Load an .RData file into an environment.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Absolute path to the .RData file.' },
      { name: 'env', type: 'string', default: '.GlobalEnv', description: 'Environment to load into.' },
    ],
    run: async (args) => {
      const path = argStr(args, 'path')
      const env = argStr(args, 'env') || '.GlobalEnv'
      const res = await rClient.envLoad(path, env)
      await refreshEnvironments()
      if (!res.success) return fail(res.error ?? 'Load failed.')
      const loaded = res.rdataLoadedNames ?? []
      return ok(`Loaded ${path} into ${env}${loaded.length ? `: ${loaded.join(', ')}` : ''}.`)
    },
  },
]

export const packagesActions: UiAction[] = [
  {
    id: 'packages:list',
    group: 'packages',
    tier: 'always',
    summary: 'List installed R packages and whether each is attached.',
    params: [
      { name: 'pattern', type: 'string', description: 'Only packages whose name contains this.' },
      { name: 'attachedOnly', type: 'boolean', default: false, description: 'Only currently attached packages.' },
    ],
    run: async (args) => {
      const res = await rClient.listPackages()
      if (!res.success) return fail(res.error ?? 'Could not list packages.')
      usePackagesStore.getState().setLibraries(res.libraries)
      const pattern = argStr(args, 'pattern').toLowerCase()
      const attachedOnly = argBool(args, 'attachedOnly')
      const rows: string[] = []
      for (const lib of res.libraries) {
        for (const p of lib.packages) {
          if (pattern && !p.name.toLowerCase().includes(pattern)) continue
          if (attachedOnly && !p.loaded) continue
          rows.push(`${p.name} ${p.version}${p.loaded ? ' (attached)' : ''} · ${lib.path}`)
        }
      }
      if (rows.length === 0) return ok('No matching packages.')
      const head = rows.slice(0, 80)
      return ok(`${rows.length} package(s):\n${head.join('\n')}` +
        (rows.length > head.length ? `\n… and ${rows.length - head.length} more` : ''))
    },
  },

  {
    id: 'packages:load',
    group: 'packages',
    tier: 'autopilot',
    summary: 'Attach a package (library()), as ticking its box in the Packages panel does.',
    params: [
      { name: 'name', type: 'string', required: true, description: 'Package name.' },
      { name: 'libPath', type: 'string', description: 'Library containing the selected package copy. Switches from another loaded copy when possible.' },
    ],
    run: async (args) => {
      const name = argStr(args, 'name')
      const res = await rClient.loadPackage(name, argStr(args, 'libPath') || undefined)
      await usePackagesStore.getState().refreshPackages()
      return res.success ? ok(`Attached "${name}".`) : fail(res.error ?? `Could not attach "${name}".`)
    },
  },

  {
    id: 'packages:unload',
    group: 'packages',
    tier: 'autopilot',
    summary: 'Detach a package.',
    params: [{ name: 'name', type: 'string', required: true, description: 'Package name.' }],
    run: async (args) => {
      const name = argStr(args, 'name')
      const res = await rClient.unloadPackage(name)
      await usePackagesStore.getState().refreshPackages()
      return res.success ? ok(`Detached "${name}".`) : fail(res.error ?? `Could not detach "${name}".`)
    },
  },

  {
    id: 'packages:install',
    group: 'packages',
    // Downloads and compiles code onto the user's machine.
    tier: 'confirm',
    summary: 'Install a package from CRAN. Downloads and compiles — it can take minutes.',
    params: [{ name: 'name', type: 'string', required: true, description: 'Package name.' }],
    run: async (args) => {
      const name = argStr(args, 'name')
      if (!/^[A-Za-z][A-Za-z0-9._]*$/.test(name)) {
        return fail(`"${name}" is not a package name. Pass one name, not R code.`)
      }
      const code = `install.packages("${name}")`
      const session = useSessionStore.getState()
      session.addConsoleEntry('input', code)
      const res = await rClient.installPackage(code)
      if (res.result?.output) session.addConsoleEntry('output', res.result.output)
      return res.success
        ? ok(`Installed "${name}".`)
        : fail(res.error ?? `Install of "${name}" failed.`)
    },
  },

  {
    id: 'packages:addLibraryPath',
    group: 'packages',
    tier: 'autopilot',
    summary: 'Add a directory to R\'s library paths.',
    params: [{ name: 'path', type: 'string', required: true, description: 'Absolute directory path.' }],
    run: async (args) => {
      const res = await rClient.addLibraryPath(argStr(args, 'path'))
      return res.success
        ? ok(`Library paths are now: ${res.result?.libPaths?.join(', ') ?? 'updated'}.`)
        : fail(res.error ?? 'Could not add the library path.')
    },
  },
]
