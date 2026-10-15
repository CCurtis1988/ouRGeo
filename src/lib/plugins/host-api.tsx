// What a plugin is handed.
//
// One frozen object, built per plugin. Everything a plugin can reach goes
// through it, and it is deliberately small: `register`, R, HTTP, a little UI,
// read-only views of the session, storage scoped to the plugin, and logging.
//
// The renderer has no filesystem or electronAPI. A declared `service`
// permission can start the plugin's installed native entry in a separate
// process; it grants native system access, not a restricted filesystem.
// The renderer supplies neither an executable path nor shell commands.
//
// Permissions gate by ABSENCE, not by refusal: a plugin without `network` has
// no `ctx.http` at all. A method that exists and always says no is a method a
// model will keep calling, and a user reading the manifest cannot tell the
// difference between "asked for it" and "uses it".

import React from 'react'
import { jsx, jsxs, Fragment } from 'react/jsx-runtime'
import { rClient } from '@/lib/r-client'
import { proxyFetch, type ProxyFetchInit, type ProxyResponse } from '@/lib/ai-proxy-fetch'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { useSpatialStore } from '@/store/spatial'
import { useEnvironmentStore } from '@/store/environment'
import { useUiStore, type DialogId } from '@/store/ui'
import { useLayoutStore } from '@/store/layout'
import { createJsonFileStore } from '@/lib/persistence'
import type { PluginManifest, PluginPermission } from './types'
import type { ServiceConnection } from './service-policy'
import type { PluginContextSourceDef } from '@/lib/context/sources/plugin'

/** A registration's undo. Every `register` call returns one, and the loader
 *  keeps them so disabling a plugin can be exact rather than a full reload. */
export type Disposer = () => void

export interface PluginHost {
  /** Supply only this plugin's own resources. No query, chat, memory or host
   * context is given to the callback. Requires separate context-source consent. */
  context?: { publish(source: PluginContextSourceDef): Disposer }
  /** Available only for a declared, permitted service. No commands or paths are accepted. */
  service?: { start(): Promise<ServiceConnection> }
  /** Who this plugin is. */
  plugin: {
    id: string
    version: string
    /** Absolute path to the plugin folder — for messages, not for reading:
     *  there is no filesystem here. */
    dir: string
    /** A JSON file of the plugin's own, under the app data directory. */
    storage: {
      read<T = Record<string, unknown>>(): Promise<T>
      write(data: unknown): Promise<void>
    }
  }

  /** Contribute things. Each returns a disposer. */
  register: {
    action(spec: unknown): Disposer
    connector(spec: unknown): Disposer
    toolboxTool(spec: unknown): Disposer
    panel(spec: unknown): Disposer
    toolbarButton(spec: unknown): Disposer
    docs(spec: unknown): Disposer
  }

  /** Present only with the `r` permission. */
  r?: {
    /** Run code in the live session. Echoed to the console, like everything
     *  else ouRGeo does on the user's behalf. */
    execute(code: string): Promise<{ output?: string; error?: string }>
    /** `source()` one of the plugin's own R files. */
    source(file: string): Promise<void>
  }

  /**
   * Present only with the `network` permission.
   *
   * `proxyFetch`, not `fetch`: the request runs in the main process, so
   * `webSecurity` stays on for the renderer and the same path the connectors
   * already use is the one plugins get. Its response is a small subset of the
   * real one — `ok`, `status`, `json()`, `text()` — which is what a connector
   * needs and what a plugin should be relying on.
   */
  http?: {
    fetch(url: string, init?: ProxyFetchInit): Promise<ProxyResponse>
  }

  /** Present only with the `ui` permission. */
  ui?: {
    React: typeof React
    jsxRuntime: { jsx: typeof jsx; jsxs: typeof jsxs; jsxDEV: typeof jsx; Fragment: typeof Fragment }
    showDialog(id: DialogId, arg?: string): void
    hideDialog(id?: DialogId): void
    openPanel(panel: string): void
    /** A line in the R console, tagged with the plugin's name. The audit trail
     *  is the point: the console stays a complete record of what ran. */
    notify(message: string): void
  }

  /** Read-only views. A plugin observes the session; it changes it through
   *  actions and R, which are visible, rather than by writing to a store. */
  read: {
    layers(): { id: string; name: string; visible: boolean }[]
    objects(): string[]
    tabs(): { id: string; fileName: string; language: string }[]
    workingDir(): string | null
    rReady(): boolean
  }

  log(...args: unknown[]): void
}

export interface HostOptions {
  manifest: PluginManifest
  dir: string
  /** Filled in by the loader; each call appends to the plugin's disposer list. */
  register: PluginHost['register']
  context?: PluginHost['context']
}

function has(manifest: PluginManifest, p: PluginPermission): boolean {
  return (manifest.permissions ?? []).includes(p)
}

/**
 * Build the object a plugin's `activate` receives.
 *
 * The host and each namespace on it are frozen, so a plugin cannot swap a
 * method out from under a later-loading plugin that shares the realm. It is
 * NOT a deep freeze: the first version walked every value it could reach,
 * which meant it walked into React's module namespace and froze the mutable
 * `current` refs React uses internally. The whole renderer died on the next
 * render, with an error — "Cannot assign to read only property 'current'" —
 * that points nowhere near here. Freeze what this function builds; never
 * freeze what it merely hands through.
 */
export function createHost({ manifest, dir, register, context }: HostOptions): PluginHost {
  const id = manifest.id
  const tag = `[${manifest.name}]`
  const console_ = (type: 'info' | 'error', text: string): void => {
    useSessionStore.getState().addConsoleEntry(type === 'error' ? 'error' : 'info', `${tag} ${text}`)
  }

  const storage = createJsonFileStore(`plugin-${id}.json`, `Plugin ${manifest.name}`)

  const host: PluginHost = {
    plugin: {
      id,
      version: manifest.version,
      dir,
      storage: { read: storage.read, write: storage.write },
    },

    register,

    read: {
      layers: () => useSpatialStore.getState().layers.map((l) => ({
        id: l.id, name: l.name, visible: l.visible,
      })),
      objects: () => useEnvironmentStore.getState().environments
        .flatMap((e) => e.objects.map((o) => o.name)),
      tabs: () => useEditorStore.getState().tabs.map((t) => ({
        id: t.id, fileName: t.fileName, language: t.language ?? 'r',
      })),
      workingDir: () => useSessionStore.getState().workingDir ?? null,
      rReady: () => useSessionStore.getState().rStatus === 'ready',
    },

    log: (...args) => console.log(tag, ...args),
  }

  if (has(manifest, 'r')) {
    host.r = {
      execute: async (code: string) => {
        useSessionStore.getState().addConsoleEntry('input', code)
        const res = await rClient.execute(code)
        if (res.output) useSessionStore.getState().addConsoleEntry('output', res.output)
        else if (res.error) useSessionStore.getState().addConsoleEntry('error', res.error)
        return { output: res.output, error: res.error }
      },
      source: async (file: string) => {
        // The path is built here from the plugin's own directory, never taken
        // from the plugin, so `source()` cannot be pointed at the user's disk.
        if (file.includes('..') || file.startsWith('/')) {
          throw new Error(`Refused: "${file}" is outside the plugin folder.`)
        }
        const path = `${dir}/${file}`.replace(/\\/g, '/')
        const code = `source("${path}")`
        useSessionStore.getState().addConsoleEntry('input', code)
        const res = await rClient.execute(code)
        if (res.error) throw new Error(res.error)
      },
    }
  }

  if (has(manifest, 'network')) {
    host.http = {
      fetch: async (url: string, init?: ProxyFetchInit) => {
        console_('info', `fetched ${url}`)
        return proxyFetch(url, init)
      },
    }
  }

  if (has(manifest, 'service') && manifest.service) {
    host.service = { start: () => window.electronAPI.plugins.services.start(id) }
  }

  if (has(manifest, 'context-source') && context) host.context = context

  if (has(manifest, 'ui')) {
    host.ui = {
      React,
      jsxRuntime: { jsx, jsxs, jsxDEV: jsx, Fragment },
      showDialog: (dialogId, arg) => useUiStore.getState().showDialog(dialogId, arg ?? null),
      hideDialog: (dialogId) => useUiStore.getState().hideDialog(dialogId),
      openPanel: (panel) => useLayoutStore.getState().setPanelOpen(panel, true),
      notify: (msg) => console_('info', msg),
    }
  }

  for (const ns of [host.plugin, host.register, host.read, host.r, host.http, host.ui, host.service, host.context]) {
    if (ns) Object.freeze(ns)
  }
  Object.freeze(host)
  return host
}
