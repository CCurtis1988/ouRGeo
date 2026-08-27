// The Help panel.
//
// These drive the panel rather than returning documentation into the chat, on
// purpose: the point of a tutorial is that the user ends up knowing where R's
// help lives. The assistant can read the same content through `execute_r_code`
// when it needs the text for itself.

import { useHelpStore } from '@/store/help'
import { rClient } from '@/lib/r-client'
import { ok, fail, argStr, type UiAction } from './types'

export const helpActions: UiAction[] = [
  {
    id: 'help.search',
    group: 'help',
    tier: 'always',
    summary: 'Search R documentation and show the results in the Help panel.',
    params: [{ name: 'query', type: 'string', required: true, description: 'What to search for.' }],
    run: async (args) => {
      const query = argStr(args, 'query')
      if (!query) return fail('query is required.')
      useHelpStore.getState().request({ kind: 'search', query })
      // Also fetch the hits so the assistant can talk about what the user is
      // now looking at instead of guessing.
      const res = await rClient.searchHelp(query, 10).catch(() => null)
      const hits = res?.success ? res.result?.results ?? [] : []
      return ok(
        `Help panel is showing results for "${query}".` +
        (hits.length ? `\nTop hits: ${hits.map((h) => `${h.name}${h.package ? ` (${h.package})` : ''}`).join(', ')}` : '')
      )
    },
  },

  {
    id: 'help.topic',
    group: 'help',
    tier: 'always',
    summary: 'Open one help page in the Help panel (the ?topic route).',
    params: [
      { name: 'topic', type: 'string', required: true, description: 'Function or topic name.' },
      { name: 'package', type: 'string', description: 'Package to disambiguate with.' },
    ],
    run: (args) => {
      const topic = argStr(args, 'topic')
      if (!topic) return fail('topic is required.')
      useHelpStore.getState().request({ kind: 'doc', topic, pkg: argStr(args, 'package') || undefined })
      return ok(`Help panel is showing ?${topic}.`)
    },
  },

  {
    id: 'help.package',
    group: 'help',
    tier: 'always',
    summary: 'Show a package overview — description, functions and vignettes.',
    params: [{ name: 'package', type: 'string', required: true, description: 'Package name.' }],
    run: (args) => {
      const pkg = argStr(args, 'package')
      if (!pkg) return fail('package is required.')
      useHelpStore.getState().request({ kind: 'package', pkg })
      return ok(`Help panel is showing the "${pkg}" package.`)
    },
  },

  {
    id: 'help.vignette',
    group: 'help',
    tier: 'always',
    summary: 'Open a package vignette in the Help panel.',
    params: [
      { name: 'package', type: 'string', required: true, description: 'Package name.' },
      { name: 'name', type: 'string', description: 'Vignette name; omit to list what is available.' },
    ],
    run: async (args) => {
      const pkg = argStr(args, 'package')
      const name = argStr(args, 'name')
      if (!pkg) return fail('package is required.')
      if (!name) {
        const res = await rClient.getVignettes(pkg).catch(() => null)
        const vs = res?.success ? res.result?.vignettes ?? [] : []
        useHelpStore.getState().request({ kind: 'package', pkg })
        return vs.length > 0
          ? ok(`"${pkg}" vignettes: ${vs.map((v) => `${v.name} — ${v.title}`).join('; ')}. ` +
               'Pass one as `name` to open it.')
          : ok(`"${pkg}" ships no vignettes. The Help panel is showing the package overview.`)
      }
      useHelpStore.getState().request({ kind: 'vignette', pkg, name })
      return ok(`Help panel is showing the "${name}" vignette from ${pkg}.`)
    },
  },

  {
    id: 'help.home',
    group: 'help',
    tier: 'always',
    summary: 'Return the Help panel to its home page.',
    params: [],
    run: () => {
      useHelpStore.getState().request({ kind: 'home' })
      return ok('Help panel is back at its home page.')
    },
  },
]
