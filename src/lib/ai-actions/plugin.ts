// Authoring plugins.
//
// This is the group that makes ouRGeo extensible by conversation rather than by
// clone-and-build. A user asks for a capability; the assistant scaffolds a
// plugin, writes its manifest, validates it, and asks to turn it on.
//
// ── Where the tiers fall, and why ──────────────────────────────────────────
//
// Reading is `always`. Writing files is `autopilot` — it is the filesystem,
// even though the main process confines every path to the plugins folder.
//
// **Enabling is `confirm`, and that is the whole trust model.** Writing a
// plugin changes nothing; enabling one is the moment code starts running with
// everything ouRGeo can do. The modal shows what it contributes and what it
// asked for, and closing it is a no — the safe answer has to be the one you
// get by doing nothing.
//
// The assistant is told, in the docs, to prefer a DECLARATIVE plugin: a
// manifest with no `main` runs no code at all, so the consent it asks for is
// cheap and the model's success rate is far higher.

import {
  loadedPlugins, pluginEnabled, setPluginEnabled, reloadPlugins,
} from '@/lib/plugins/loader'
import { readManifest } from '@/lib/plugins/manifest'
import { MANIFEST_FILE, PERMISSION_LABELS, type LoadedPlugin } from '@/lib/plugins/types'
import { APP_VERSION } from '@/components/settings/versionHistory'
import { ok, fail, argStr, argBool, type UiAction } from './types'

function installedIds(): string[] {
  return loadedPlugins().map((p) => p.manifest.id)
}

function find(id: string): LoadedPlugin | undefined {
  const want = id.trim().toLowerCase()
  const all = loadedPlugins()
  return all.find((p) => p.manifest.id.toLowerCase() === want)
    ?? all.find((p) => p.manifest.name.toLowerCase() === want)
}

/**
 * Why a store plugin's code is not the assistant's to read or hand out.
 *
 * One function for all three surfaces, because a rule enforced at each call
 * site holds until somebody adds a fourth. It names the recovery move — the
 * plugin's page — since "you cannot read this" alone reads as a fault the
 * model should work around, and a model that works around it will try
 * `execute_r_code` and `readLines()` next.
 */
function storeRefusal(p: LoadedPlugin, verb: string): string {
  const o = p.origin!
  return (
    `"${p.manifest.name}" was installed from the plugin store, so ouRGeo does not ${verb} it. ` +
    'What ships from the store is a built, minified bundle rather than the author’s sources, ' +
    'and it is not ouRGeo’s to pass on. ' +
    `Its page is ourgeo.dev/plugin.html?slug=${o.slug} — the description, the permissions and the ` +
    'author are all there. To build something like it, scaffold a new plugin with plugin:scaffold.'
  )
}

function unknown(id: string): string {
  const ids = installedIds()
  return ids.length === 0
    ? `No plugin called "${id}" — none are installed. plugin:scaffold makes one.`
    : `No plugin called "${id}". Installed: ${ids.join(', ')}.`
}

/** A path inside a plugin, or a message saying why it is not one. */
function pluginPath(id: string, file: string): { path: string } | { error: string } {
  const clean = file.trim().replace(/^\.\//, '')
  if (!clean) return { error: 'Pass a file name relative to the plugin folder, e.g. "main.ts".' }
  if (clean.startsWith('/') || clean.includes('..')) {
    return { error: `"${file}" points outside the plugin folder. Use a plain relative path.` }
  }
  return { path: `${id}/${clean}` }
}

function describe(p: LoadedPlugin): string {
  const m = p.manifest
  const lines = [
    `${m.name} (${m.id}) v${m.version} — ${p.state}${pluginEnabled(m.id) ? '' : ', switched off'}`,
  ]
  if (m.description) lines.push(m.description)
  lines.push(m.main ? `Ships code: ${m.main}` : 'Declarative only — no code.')
  if ((m.permissions ?? []).length > 0) {
    lines.push(`Permissions: ${(m.permissions ?? []).map((x) => PERMISSION_LABELS[x] ?? x).join('; ')}.`)
  }
  if (p.origin) lines.push(`From the plugin store, version ${p.origin.version}.`)
  if (p.registered.length > 0) lines.push(`Registered: ${p.registered.join(', ')}.`)
  if (p.error) lines.push(`Problems:\n${p.error}`)
  return lines.join('\n')
}

const SCAFFOLD_NOTE =
  'Written but NOT enabled. Check it with plugin:validate, then plugin:enable — enabling is when ' +
  'the user is asked, because that is when it starts affecting their session.'

export const pluginActions: UiAction[] = [
  {
    id: 'plugin:list',
    group: 'plugin',
    tier: 'always',
    summary: 'Every installed plugin: what it is, whether it is on, and what it contributes.',
    params: [],
    run: () => {
      const all = loadedPlugins()
      if (all.length === 0) {
        return ok('No plugins are installed. plugin:scaffold creates one from a description.')
      }
      return ok(`${all.length} plugin(s) installed.`, all.map(describe).join('\n\n'))
    },
  },

  {
    id: 'plugin:inspect',
    group: 'plugin',
    tier: 'always',
    summary: 'One plugin in detail, including its file list and any load errors in full.',
    params: [
      {
        name: 'id', type: 'enum', valuesAt: installedIds, lenient: true, required: true,
        description: 'Which plugin — its id or its name.',
      },
    ],
    run: async (args) => {
      const want = argStr(args, 'id')
      const p = find(want)
      if (!p) return fail(unknown(want))
      // A store plugin still describes itself — version, permissions, what it
      // registered. Only the file listing is withheld, because that is the
      // step towards reading the code.
      if (p.origin) {
        return ok(`${p.manifest.name}:`,
          `${describe(p)}\nInstalled from the plugin store (ourgeo.dev/plugin.html?slug=${p.origin.slug}). ` +
          'Its files are a built bundle and are not listed.')
      }
      let files: string[] = []
      try { files = await window.electronAPI.plugins.listFiles(p.manifest.id) } catch { /* fine */ }
      return ok(`${p.manifest.name}:`, `${describe(p)}\nFiles: ${files.join(', ') || '(none)'}`)
    },
  },

  {
    id: 'plugin:readFile',
    group: 'plugin',
    tier: 'always',
    summary: 'Read one of a plugin’s files. Read before you rewrite — the user may have edited it.',
    params: [
      { name: 'id', type: 'enum', valuesAt: installedIds, lenient: true, required: true, description: 'Which plugin.' },
      { name: 'file', type: 'string', required: true, description: 'Path inside the plugin folder, e.g. "main.ts".' },
    ],
    run: async (args) => {
      const id = argStr(args, 'id')
      const p = find(id)
      if (!p) return fail(unknown(id))
      if (p.origin) return fail(storeRefusal(p, 'read the files of'))
      const target = pluginPath(p.manifest.id, argStr(args, 'file'))
      if ('error' in target) return fail(target.error)
      try {
        return ok(`${target.path}:`, await window.electronAPI.plugins.readFile(target.path))
      } catch (e) {
        return fail(`Could not read ${target.path}: ${msg(e)}`)
      }
    },
  },

  {
    id: 'plugin:scaffold',
    group: 'plugin',
    tier: 'autopilot',
    summary:
      'Create a new plugin folder with a manifest. Start here, then add contributions with ' +
      'plugin:writeFile. Prefer a declarative plugin — one with no code needs no trust decision.',
    params: [
      { name: 'id', type: 'string', required: true, description: 'Lowercase, hyphenated, e.g. "noaa-tides". Namespaces everything it adds.' },
      { name: 'name', type: 'string', required: true, description: 'What the user sees, e.g. "NOAA Tides".' },
      { name: 'description', type: 'string', description: 'One line saying what it is for.' },
      {
        name: 'permissions', type: 'strings',
        description: 'Any of: network (fetch), r (run R), ui (dialogs and panels). Ask for none you do not use.',
      },
      {
        name: 'withCode', type: 'boolean', default: false,
        description: 'Add a main.ts entry point. Leave false unless a schema genuinely cannot express it.',
      },
    ],
    run: async (args) => {
      const id = argStr(args, 'id').trim().toLowerCase()
      const name = argStr(args, 'name').trim()
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
        return fail(`"${id}" is not a usable plugin id — lowercase letters, digits and hyphens, starting with a letter.`)
      }
      if (find(id)) {
        return fail(`A plugin called "${id}" is already installed. Edit it with plugin:writeFile, or pick another id.`)
      }
      const withCode = argBool(args, 'withCode')
      const permissions = (Array.isArray(args.permissions) ? args.permissions : [])
        .map(String).filter((p) => ['network', 'r', 'ui'].includes(p))

      const manifest = {
        id, name, version: '1.0.0',
        description: argStr(args, 'description') || undefined,
        ourgeoVersion: `>=${APP_VERSION}`,
        permissions,
        ...(withCode ? { main: 'main.ts' } : {}),
        contributes: {},
      }

      try {
        await window.electronAPI.plugins.writeFile(
          `${id}/${MANIFEST_FILE}`, `${JSON.stringify(manifest, null, 2)}\n`)
        if (withCode) {
          await window.electronAPI.plugins.writeFile(`${id}/main.ts`, STARTER_MAIN)
        }
        await reloadPlugins(APP_VERSION)
      } catch (e) {
        return fail(`Could not create the plugin: ${msg(e)}`)
      }
      return ok(`Created the plugin "${name}" (${id}).`,
        `Add contributions by rewriting ${id}/${MANIFEST_FILE}. ${SCAFFOLD_NOTE}`)
    },
  },

  {
    id: 'plugin:writeFile',
    group: 'plugin',
    tier: 'autopilot',
    summary:
      'Write one of a plugin’s files, replacing it. Use it for the manifest and for code. ' +
      'Every path is confined to the plugin folder.',
    params: [
      { name: 'id', type: 'enum', valuesAt: installedIds, lenient: true, required: true, description: 'Which plugin.' },
      { name: 'file', type: 'string', required: true, description: 'Path inside the plugin folder, e.g. "ourgeo-plugin.json".' },
      { name: 'content', type: 'string', required: true, description: 'The whole new contents.' },
    ],
    run: async (args) => {
      const id = argStr(args, 'id')
      const p = find(id)
      if (!p) return fail(unknown(id))
      // Editing a store plugin in place would leave the user running something
      // that is neither what the store shipped nor anything they chose, under
      // a badge saying it came from the store.
      if (p.origin) return fail(storeRefusal(p, 'edit'))
      const target = pluginPath(p.manifest.id, argStr(args, 'file'))
      if ('error' in target) return fail(target.error)
      const content = argStr(args, 'content')

      // The manifest is checked BEFORE it is written. A plugin whose manifest
      // does not parse cannot be read back, so the assistant would lose the
      // ability to fix its own mistake through plugin:readFile.
      if (target.path.endsWith(MANIFEST_FILE)) {
        const check = readManifest(content, APP_VERSION)
        if (!check.ok) return fail(`Not written — that manifest is invalid: ${check.error}`)
      }

      try {
        await window.electronAPI.plugins.writeFile(target.path, content)
        await reloadPlugins(APP_VERSION)
      } catch (e) {
        return fail(`Could not write ${target.path}: ${msg(e)}`)
      }
      const after = find(p.manifest.id)
      return ok(`Wrote ${target.path}.`,
        after?.error ? `It loaded with problems:\n${after.error}` : undefined)
    },
  },

  {
    id: 'plugin:validate',
    group: 'plugin',
    tier: 'always',
    summary:
      'Check a plugin without turning it on: does its manifest parse, did every contribution ' +
      'compile, what was dropped. Run this before plugin:enable.',
    params: [
      { name: 'id', type: 'enum', valuesAt: installedIds, lenient: true, required: true, description: 'Which plugin.' },
    ],
    run: async (args) => {
      const want = argStr(args, 'id')
      const p = find(want)
      if (!p) return fail(unknown(want))
      try {
        const text = await window.electronAPI.plugins.readFile(`${p.manifest.id}/${MANIFEST_FILE}`)
        const check = readManifest(text, APP_VERSION)
        if (!check.ok) return fail(`${p.manifest.id}: ${check.error}`)
        const notes = [...check.warnings]
        if (p.error) notes.push(p.error)
        if (notes.length === 0) {
          return ok(`${p.manifest.id} is valid${pluginEnabled(p.manifest.id) ? ' and running' : ''}.`)
        }
        return ok(`${p.manifest.id} is valid, with notes:`, notes.join('\n'))
      } catch (e) {
        return fail(`Could not read that plugin's manifest: ${msg(e)}`)
      }
    },
  },

  {
    id: 'plugin:reload',
    group: 'plugin',
    tier: 'autopilot',
    summary: 'Re-read every plugin from disk and re-register what is enabled. Use it after editing files.',
    params: [],
    run: async () => {
      const all = await reloadPlugins(APP_VERSION)
      const bad = all.filter((p) => p.state === 'failed')
      return ok(`Reloaded ${all.length} plugin(s).`,
        bad.length > 0 ? bad.map(describe).join('\n\n') : undefined)
    },
  },

  {
    id: 'plugin:enable',
    group: 'plugin',
    tier: 'confirm',
    summary:
      'Turn a plugin on. If it ships code, that code starts running in the user’s session with ' +
      'everything ouRGeo can do — which is why this one asks.',
    params: [
      { name: 'id', type: 'enum', valuesAt: installedIds, lenient: true, required: true, description: 'Which plugin.' },
    ],
    run: async (args) => {
      const want = argStr(args, 'id')
      const p = find(want)
      if (!p) return fail(unknown(want))
      if (pluginEnabled(p.manifest.id)) return ok(`"${p.manifest.name}" is already on.`)
      await setPluginEnabled(p.manifest.id, true, APP_VERSION)
      const after = find(p.manifest.id)
      if (after?.state === 'failed') {
        return fail(`"${p.manifest.name}" failed to start:\n${after.error ?? 'no reason given'}`)
      }
      return ok(`"${p.manifest.name}" is on.`,
        after ? `Registered: ${after.registered.join(', ') || 'nothing yet'}.` : undefined)
    },
  },

  {
    id: 'plugin:disable',
    group: 'plugin',
    tier: 'always',
    summary:
      'Turn a plugin off. Always allowed: switching something off is never the risky direction, ' +
      'and it is the first thing to try when the app is misbehaving.',
    params: [
      { name: 'id', type: 'enum', valuesAt: installedIds, lenient: true, required: true, description: 'Which plugin.' },
    ],
    run: async (args) => {
      const want = argStr(args, 'id')
      const p = find(want)
      if (!p) return fail(unknown(want))
      if (!pluginEnabled(p.manifest.id)) return ok(`"${p.manifest.name}" was already off.`)
      await setPluginEnabled(p.manifest.id, false, APP_VERSION)
      return ok(`"${p.manifest.name}" is off. Its files are still there; plugin:enable turns it back on.`)
    },
  },

  {
    id: 'plugin:delete',
    group: 'plugin',
    tier: 'confirm',
    summary:
      'Delete a plugin’s folder for good. There is no undo and no copy elsewhere — offer ' +
      'plugin:export first if the user might want it back.',
    params: [
      { name: 'id', type: 'enum', valuesAt: installedIds, lenient: true, required: true, description: 'Which plugin.' },
    ],
    run: async (args) => {
      const want = argStr(args, 'id')
      const p = find(want)
      if (!p) return fail(unknown(want))
      try {
        await window.electronAPI.plugins.delete(p.manifest.id)
        await setPluginEnabled(p.manifest.id, false, APP_VERSION)
      } catch (e) {
        return fail(`Could not delete it: ${msg(e)}`)
      }
      return ok(`Deleted "${p.manifest.name}".`)
    },
  },

  {
    id: 'plugin:export',
    group: 'plugin',
    tier: 'autopilot',
    summary: 'Write a plugin out as a portable .ourgeoplugin file the user can keep or share.',
    params: [
      { name: 'id', type: 'enum', valuesAt: installedIds, lenient: true, required: true, description: 'Which plugin.' },
      { name: 'path', type: 'string', required: true, description: 'Where to write it, e.g. "~/noaa-tides.ourgeoplugin".' },
    ],
    run: async (args) => {
      const want = argStr(args, 'id')
      const p = find(want)
      if (!p) return fail(unknown(want))
      if (p.origin) return fail(storeRefusal(p, 'export'))
      try {
        await window.electronAPI.plugins.pack(p.manifest.id, argStr(args, 'path'))
      } catch (e) {
        return fail(`Could not export it: ${msg(e)}`)
      }
      return ok(`Exported "${p.manifest.name}" to ${argStr(args, 'path')}.`)
    },
  },

  {
    id: 'plugin:import',
    group: 'plugin',
    tier: 'confirm',
    summary:
      'Install a .ourgeoplugin file from disk. It arrives switched OFF — installing is not ' +
      'consent to run it, and plugin:enable is a separate question.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'The .ourgeoplugin file to install.' },
    ],
    run: async (args) => {
      try {
        const id = await window.electronAPI.plugins.unpack(argStr(args, 'path'))
        await reloadPlugins(APP_VERSION)
        return ok(`Installed "${id}". It is switched off — plugin:enable turns it on.`)
      } catch (e) {
        return fail(`Could not install that file: ${msg(e)}`)
      }
    },
  },
]

const STARTER_MAIN = `// Entry point. \`activate\` runs when the plugin is enabled.
//
// Everything you can reach comes through \`ctx\`; there is no filesystem and no
// \`window.electronAPI\`. Prefer declaring contributions in ourgeo-plugin.json —
// this file is for what a schema cannot express.

export function activate(ctx: any): void {
  ctx.log('loaded')
}
`

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
