// The plugin store, from the assistant's side.
//
// Searching, reading and installing. Not submitting, and not reviewing — see
// the note at the foot of this file for why those two are missing.
//
// ── Where the tiers fall ───────────────────────────────────────────────────
//
// Reading is `always`. **Installing is `confirm`**, and for the same reason
// `plugin:enable` is: it is the moment code somebody else wrote arrives on the
// user's machine. A store plugin has been through a moderator, which is worth
// something and is not the same as the user having decided; the modal is where
// they decide.
//
// And what arrives is switched OFF, exactly as a file install is. The
// assistant cannot enable it in the same breath — that is a second action with
// a second confirm, which is the point.

import { ok, fail, argStr, type UiAction } from './types'
import * as store from '@/lib/plugin-store/client'
import { installFromStore, updateFromStore } from '@/lib/plugin-store/install'
import { ensureUpdateCheck } from '@/lib/plugin-store/updates'
import { usePluginStoreBrowser, hasUpdate } from '@/store/pluginStore'
import { loadedPlugins } from '@/lib/plugins/loader'
import { checkAppVersion } from '@/lib/plugins/manifest'
import { APP_VERSION } from '@/components/settings/versionHistory'
import { useUiStore } from '@/store/ui'
import type { StoreDetail } from '@/lib/plugin-store/types'

/** The version a user would get: the newest approved one. */
function latestOf(d: StoreDetail) {
  return d.versions.find((v) => v.status === 'approved') ?? null
}

function installedVersion(slug: string): string | undefined {
  return loadedPlugins().find((p) => p.manifest.id === slug)?.manifest.version
}

function describe(d: StoreDetail): string {
  const latest = latestOf(d)
  const lines = [
    `${d.name} (${d.slug})${latest ? ` v${latest.version}` : ''} — by ${d.author.displayName}`,
    d.summary,
  ]
  if (latest) {
    lines.push(latest.hasCode
      ? 'Ships code: it runs inside ouRGeo once enabled.'
      : 'Declarative only: it adds data and runs no code of its own.')
    if (latest.permissions.length) lines.push(`Asks to: ${latest.permissions.join(', ')}.`)
    if (latest.ourgeoVersion) {
      const problem = checkAppVersion(latest.ourgeoVersion, APP_VERSION)
      lines.push(problem ?? `Needs ouRGeo ${latest.ourgeoVersion} — this one qualifies.`)
    }
  }
  lines.push(`${d.installCount} install${d.installCount === 1 ? '' : 's'}` +
    (d.ratingCount ? `, rated ${d.ratingAvg} from ${d.ratingCount}.` : '.'))
  const have = installedVersion(d.slug)
  if (have) lines.push(`Installed here: v${have}.`)
  if (d.description) lines.push('', d.description.slice(0, 1200))
  lines.push('', d.pageUrl)
  return lines.join('\n')
}

function unreachable(e: unknown): string {
  return `Could not reach the plugin store: ${store.storeErrorMessage(e)}`
}

export const storeActions: UiAction[] = [
  {
    id: 'store:search',
    group: 'store',
    tier: 'always',
    summary:
      'Search the plugin store. Use it before offering to write a plugin — somebody may have ' +
      'written one already, and an installed plugin is reviewed code rather than new code.',
    params: [
      { name: 'query', type: 'string', description: 'Words to match against name, summary and tags.' },
      { name: 'category', type: 'string', description: 'One category slug, e.g. "connectors".' },
      {
        name: 'sort', type: 'enum', values: ['popular', 'rated', 'new', 'updated'],
        description: 'Default popular.',
      },
    ],
    run: async (args) => {
      try {
        const rows = await store.catalogue({
          query: argStr(args, 'query') || undefined,
          category: argStr(args, 'category') || undefined,
          sort: (argStr(args, 'sort') || 'popular') as 'popular',
          limit: 20,
        })
        if (rows.length === 0) return ok('Nothing in the store matches that.')
        return ok(`${rows.length} plugin${rows.length === 1 ? '' : 's'}:`, rows.map((r) => {
          const have = installedVersion(r.slug)
          return `${r.name} (${r.slug}) v${r.version} — ${r.summary}` +
            ` [${r.installCount} installs${r.ratingCount ? `, ★${r.ratingAvg}` : ''}` +
            `${have ? `, installed v${have}` : ''}]`
        }).join('\n'))
      } catch (e) {
        return fail(unreachable(e))
      }
    },
  },

  {
    id: 'store:inspect',
    group: 'store',
    tier: 'always',
    summary:
      'One plugin in detail — what it adds, what it asks to reach, whether it runs code, ' +
      'and whether this ouRGeo is new enough for it.',
    params: [
      { name: 'slug', type: 'string', required: true, description: 'The plugin id, as store:search reports it.' },
    ],
    run: async (args) => {
      const slug = argStr(args, 'slug')
      try {
        const d = await store.detail(slug)
        if (!d) return fail(`No plugin called "${slug}" in the store. store:search finds one by name.`)
        return ok(`${d.name}:`, describe(d))
      } catch (e) {
        return fail(unreachable(e))
      }
    },
  },

  {
    id: 'store:updates',
    group: 'store',
    tier: 'always',
    summary: 'Which installed store plugins have a newer version waiting.',
    params: [],
    run: async () => {
      try {
        await ensureUpdateCheck()
      } catch (e) {
        return fail(unreachable(e))
      }
      const updates = usePluginStoreBrowser.getState().updates
      const rows = loadedPlugins()
        .filter((p) => p.origin && hasUpdate(updates[p.manifest.id], p.manifest.version))
        .map((p) => `${p.manifest.name} (${p.manifest.id}): ` +
          `v${p.manifest.version} installed, v${updates[p.manifest.id].latestVersion} in the store.`)
      return rows.length === 0
        ? ok('Every store plugin here is up to date.')
        : ok(`${rows.length} update${rows.length === 1 ? '' : 's'} available:`, rows.join('\n'))
    },
  },

  {
    id: 'store:open',
    group: 'store',
    tier: 'always',
    summary: 'Open the Plugin Store so the user can look for themselves.',
    params: [
      { name: 'query', type: 'string', description: 'Optional: what to put in the search box.' },
    ],
    run: async (args) => {
      const query = argStr(args, 'query')
      if (query) usePluginStoreBrowser.getState().setQuery(query)
      useUiStore.getState().showDialog('plugin-store')
      return ok(query ? `Opened the Plugin Store, searching for "${query}".` : 'Opened the Plugin Store.')
    },
  },

  {
    id: 'store:install',
    group: 'store',
    // The trust moment. A store plugin has been through a moderator, which is
    // worth something and is not the same as the user having decided.
    tier: 'confirm',
    summary:
      'Install a plugin from the store. It arrives SWITCHED OFF — enabling it is a separate ' +
      'decision the user makes in Settings → Plugins.',
    params: [
      { name: 'slug', type: 'string', required: true, description: 'The plugin id.' },
    ],
    run: async (args) => {
      const slug = argStr(args, 'slug')
      let d: StoreDetail | null
      try {
        d = await store.detail(slug)
      } catch (e) {
        return fail(unreachable(e))
      }
      if (!d) return fail(`No plugin called "${slug}" in the store.`)

      const latest = latestOf(d)
      if (!latest) return fail(`"${d.name}" has no published version yet.`)
      if (installedVersion(slug) === latest.version) {
        return ok(`"${d.name}" v${latest.version} is already installed.`)
      }

      const result = await installFromStore(slug, latest.id, {
        version: latest.version,
        ourgeoVersion: latest.ourgeoVersion,
        name: d.name,
      })
      if (!result.ok) return fail(result.error ?? 'The install did not work.')

      return ok(
        `Installed "${d.name}" v${latest.version}. It is switched off.`,
        'Turn it on in Settings → Plugins, or ask and I will point you at the switch. ' +
        'Enabling is where you decide that code somebody else wrote may run.',
      )
    },
  },

  {
    id: 'store:update',
    group: 'store',
    tier: 'confirm',
    summary:
      'Update an installed store plugin to its newest published version. It keeps whatever ' +
      'on/off state it already had.',
    params: [
      { name: 'slug', type: 'string', required: true, description: 'The plugin id.' },
    ],
    run: async (args) => {
      const slug = argStr(args, 'slug')
      const installed = loadedPlugins().find((p) => p.manifest.id === slug)
      if (!installed) return fail(`"${slug}" is not installed here.`)
      if (!installed.origin) {
        return fail(
          `"${installed.manifest.name}" did not come from the store, so there is nothing to ` +
          'update it from. It is a plugin on this machine.',
        )
      }

      let d: StoreDetail | null
      try {
        d = await store.detail(slug)
      } catch (e) {
        return fail(unreachable(e))
      }
      const latest = d ? latestOf(d) : null
      if (!latest) return fail(`The store has no published version of "${slug}" any more.`)
      if (latest.version === installed.manifest.version) {
        return ok(`"${installed.manifest.name}" is already on v${latest.version}.`)
      }

      const result = await updateFromStore(slug, latest.id, { ourgeoVersion: latest.ourgeoVersion })
      return result.ok
        ? ok(`Updated "${installed.manifest.name}" to v${latest.version}.`)
        : fail(result.error ?? 'The update did not work.')
    },
  },
]

// ── What is deliberately missing ───────────────────────────────────────────
//
// **Submitting a plugin**, and **writing a review**. Both publish under the
// user's name to a public website, which is the line the forum is already on
// the far side of — `ai-actions` has never carried an action that posts. The
// distance between "help me write this plugin" and "and publish it as yours"
// is one the user should cross by pressing a button.
//
// **Approving anything.** Moderation is a person reading code, and an
// assistant that could approve a plugin could approve one it had written.
