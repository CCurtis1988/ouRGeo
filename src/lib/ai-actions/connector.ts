// Data connectors: looking at them, adding servers, and writing new ones.
//
// The Data Connector's Web APIs tab is where a user reaches an API ouRGeo has
// heard of. This group is for the other case — an API it has not — and the two
// actions that matter most are `connector:probe` and `connector:test`.
//
// A connector spec is a description of a JSON API's SHAPE: where the list of
// datasets lives in the response, which key is the id, where the rows are.
// A model cannot know any of that, and guessing produces a spec that compiles,
// installs, and then returns an empty dropdown with nothing to explain it.
// `connector:probe` fetches a URL and reports the shape; `connector:test` runs
// the compiled spec against a real server and says which stage failed. Writing
// a connector without them is writing one blind.

import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { providerList, providerById } from '@/lib/api-connectors/registry'
import { compileProvider, type DeclarativeProviderSpec } from '@/lib/api-connectors/declarative'
import { getServerStore, normalizeServerUrl } from '@/lib/api-connectors/apiServers'
import { DEFAULT_QUERY } from '@/lib/api-connectors/query-model'
import { useApiKeysStore } from '@/store/apiKeys'
import { useUiStore } from '@/store/ui'
import { ok, fail, argStr, argJson, argNum, type UiAction } from './types'

function providerIds(): string[] {
  return providerList().map((p) => p.id)
}

function resolveProvider(want: string): ReturnType<typeof providerById> {
  const q = want.trim().toLowerCase()
  return providerById(want)
    ?? providerList().find((p) => p.id.toLowerCase() === q)
    ?? providerList().find((p) => p.label.toLowerCase() === q)
}

function unknownProvider(want: string): string {
  return `No connector called "${want}". Installed: ${providerList().map((p) => `${p.id} (${p.label})`).join(', ')}.`
}

function keys(): Record<string, string> {
  return useApiKeysStore.getState().keys ?? {}
}

/** A compact description of a JSON value's shape — what a spec author needs. */
function shapeOf(value: unknown, path = '', depth = 0, out: string[] = []): string[] {
  if (out.length > 60 || depth > 4) return out
  if (Array.isArray(value)) {
    out.push(`${path || '(root)'}: array of ${value.length}`)
    if (value.length > 0) shapeOf(value[0], `${path}[0]`, depth + 1, out)
    return out
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (path) out.push(`${path}: object with ${entries.length} key(s)`)
    for (const [k, v] of entries.slice(0, 25)) {
      const child = path ? `${path}.${k}` : k
      if (v !== null && typeof v === 'object') shapeOf(v, child, depth + 1, out)
      else out.push(`${child}: ${typeof v}${typeof v === 'string' && v.length < 40 ? ` = ${JSON.stringify(v)}` : ''}`)
    }
    return out
  }
  out.push(`${path || '(root)'}: ${typeof value}`)
  return out
}

export const connectorActions: UiAction[] = [
  {
    id: 'connector:list',
    group: 'connector',
    tier: 'always',
    summary: 'Every data connector available, shipped and plugin-contributed, grouped by category.',
    params: [],
    run: () => {
      const lines = providerList().map((p) => `${p.id} [${p.category}] — ${p.label}: ${p.description}`)
      return ok(`${lines.length} connector(s).`, lines.join('\n'))
    },
  },

  {
    id: 'connector:inspect',
    group: 'connector',
    tier: 'always',
    summary: 'One connector: its servers, its cascade levels, and the operators it supports.',
    params: [
      {
        name: 'id', type: 'enum', valuesAt: providerIds, lenient: true, required: true,
        description: 'Which connector — its id or its label.',
      },
    ],
    run: (args) => {
      const want = argStr(args, 'id')
      const p = resolveProvider(want)
      if (!p) return fail(unknownProvider(want))
      const store = getServerStore(p.id, p.builtinServers)
      const servers = store.getState().servers.map((s) => `${s.label} (${s.baseUrl})${s.builtin ? '' : ' [added]'}`)
      return ok(`${p.label}:`, [
        p.description,
        `Category: ${p.category}`,
        `Cascade: ${p.cascade.map((l) => l.key).join(' → ')}`,
        `Servers:\n  ${servers.join('\n  ')}`,
        `Text operators: ${p.opsFor('text').join(', ')}`,
        `Numeric operators: ${p.opsFor('numeric').join(', ')}`,
      ].join('\n'))
    },
  },

  {
    id: 'connector:open',
    group: 'connector',
    tier: 'always',
    summary: 'Open the Data Connector so the user can browse and query a connector themselves.',
    params: [],
    run: () => {
      useUiStore.getState().showDialog('data-connector')
      return ok('Opened the Data Connector. Its Web APIs tab lists every connector.')
    },
  },

  {
    id: 'connector:addServer',
    group: 'connector',
    tier: 'autopilot',
    summary:
      'Add a server to a connector — another CKAN portal, another WFS endpoint. Validated by ' +
      'listing its first cascade level, so a bad URL is refused now rather than at query time.',
    params: [
      { name: 'id', type: 'enum', valuesAt: providerIds, lenient: true, required: true, description: 'Which connector.' },
      { name: 'label', type: 'string', required: true, description: 'What to call it in the picker.' },
      { name: 'url', type: 'string', required: true, description: 'Its base URL.' },
    ],
    run: async (args) => {
      const want = argStr(args, 'id')
      const p = resolveProvider(want)
      if (!p) return fail(unknownProvider(want))
      const store = getServerStore(p.id, p.builtinServers)
      await store.getState().init()
      try {
        const server = await store.getState().addServer(
          argStr(args, 'label'), argStr(args, 'url'),
          // The same validator the dialog uses: a server is valid if its first
          // cascade level lists.
          (url) => p.listLevel(p.cascade[0].key, {}, { baseUrl: url, apiKeys: keys() }),
        )
        return ok(`Added "${server.label}" to ${p.label}.`)
      } catch (e) {
        return fail(`Could not add that server: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  },

  {
    id: 'connector:removeServer',
    group: 'connector',
    tier: 'autopilot',
    summary: 'Remove a server the user added. Built-in servers cannot be removed.',
    params: [
      { name: 'id', type: 'enum', valuesAt: providerIds, lenient: true, required: true, description: 'Which connector.' },
      { name: 'url', type: 'string', required: true, description: 'The server\'s base URL.' },
    ],
    run: async (args) => {
      const want = argStr(args, 'id')
      const p = resolveProvider(want)
      if (!p) return fail(unknownProvider(want))
      const store = getServerStore(p.id, p.builtinServers)
      await store.getState().init()
      const url = normalizeServerUrl(argStr(args, 'url'))
      const hit = store.getState().servers.find((s) => normalizeServerUrl(s.baseUrl) === url)
      if (!hit) return fail(`${p.label} has no server at ${url}.`)
      if (hit.builtin) return fail(`"${hit.label}" ships with ouRGeo and cannot be removed.`)
      store.getState().removeServer(hit.id)
      return ok(`Removed "${hit.label}" from ${p.label}.`)
    },
  },

  {
    id: 'connector:probe',
    group: 'connector',
    tier: 'autopilot',
    summary:
      'Fetch a URL and report the SHAPE of the JSON it returns — which key holds the array, ' +
      'what an item looks like. Do this before writing a connector spec: the paths cannot be guessed.',
    params: [
      { name: 'url', type: 'string', required: true, description: 'The URL to fetch. Include any query parameters.' },
      { name: 'path', type: 'string', description: 'Report the shape at this path only, e.g. "result.items".' },
    ],
    run: async (args) => {
      const url = argStr(args, 'url')
      if (!/^https?:\/\//i.test(url)) return fail('Pass a full http(s) URL.')
      let text: string
      let status: number
      try {
        const res = await proxyFetch(url, { headers: { Accept: 'application/json' } })
        status = res.status
        text = await res.text()
      } catch (e) {
        return fail(`Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (status >= 400) {
        // The body usually says why; a bare status sends the model to the
        // wrong problem for the next three turns.
        return fail(`HTTP ${status} from ${url}. Body: ${text.slice(0, 500)}`)
      }
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        return fail(`That URL did not return JSON. First 300 characters:\n${text.slice(0, 300)}`)
      }
      const at = argStr(args, 'path')
      const rooted = at ? at.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], data) : data
      if (rooted === undefined) return fail(`Nothing at path "${at}". Probe without a path to see the whole shape.`)
      return ok(`HTTP ${status} from ${url}.`, shapeOf(rooted, at).join('\n'))
    },
  },

  {
    id: 'connector:test',
    group: 'connector',
    tier: 'autopilot',
    summary:
      'Compile a connector spec and run it against a real server — cascade, metadata, preview, ' +
      'generated R — reporting which stage failed. Run this before asking to enable the plugin.',
    params: [
      { name: 'spec', type: 'json', required: true, description: 'The connector spec object, as it would appear in a manifest.' },
      { name: 'server', type: 'string', description: 'Base URL to test against. Defaults to the spec\'s first server.' },
      { name: 'limit', type: 'number', default: 5, description: 'Preview rows to request.' },
    ],
    run: async (args) => {
      const spec = argJson(args, 'spec') as DeclarativeProviderSpec | undefined
      if (!spec || typeof spec !== 'object') return fail('"spec" must be the connector spec object.')

      const compiled = compileProvider(spec, 'test')
      if (!compiled.ok || !compiled.provider) return fail(`The spec does not compile: ${compiled.error}`)
      const p = compiled.provider

      const baseUrl = normalizeServerUrl(argStr(args, 'server') || spec.servers?.[0]?.baseUrl || '')
      if (!baseUrl) return fail('No server to test against — the spec lists none and none was passed.')
      const ctx = { baseUrl, apiKeys: keys() }

      const log: string[] = [`Server: ${baseUrl}`]
      const sel: Record<string, string> = {}

      // Walk the cascade for real. Each level's options depend on the one
      // above, so a wrong `itemsPath` two levels down cannot be found any
      // other way.
      for (const level of p.cascade) {
        try {
          const options = await p.listLevel(level.key, sel, ctx)
          if (options.length === 0) {
            log.push(`✗ ${level.key}: returned no options — check "itemsPath" and "valuePath".`)
            return fail(log.join('\n'))
          }
          sel[level.key] = options[0].value
          log.push(`✓ ${level.key}: ${options.length} option(s); took "${options[0].label}".`)
        } catch (e) {
          log.push(`✗ ${level.key}: ${e instanceof Error ? e.message : String(e)}`)
          return fail(log.join('\n'))
        }
      }

      try {
        const meta = await p.getMetadata(sel, ctx)
        log.push(`✓ metadata: ${meta.fields.length} field(s)${meta.total !== undefined ? `, ${meta.total} row(s)` : ''}` +
          `${meta.fields.length > 0 ? ` — ${meta.fields.slice(0, 8).map((f) => f.id).join(', ')}` : ''}`)
        if (meta.fields.length === 0) {
          log.push('  (no fields: the query builder will be empty — check "fieldsPath" or "fieldsFrom")')
        }
      } catch (e) {
        log.push(`✗ metadata: ${e instanceof Error ? e.message : String(e)}`)
        return fail(log.join('\n'))
      }

      const query = { ...DEFAULT_QUERY, limit: argNum(args, 'limit', 5) }
      try {
        const rows = await p.preview(sel, query, ctx)
        log.push(`✓ preview: ${rows.length} row(s)${rows[0] ? ` — keys: ${Object.keys(rows[0]).slice(0, 8).join(', ')}` : ''}`)
      } catch (e) {
        log.push(`✗ preview: ${e instanceof Error ? e.message : String(e)}`)
      }

      log.push('', 'Generated R:', p.buildCode(sel, query, p.defaultVarName?.(sel) ?? 'data', ctx))
      return ok('Connector test finished.', log.join('\n'))
    },
  },
]
