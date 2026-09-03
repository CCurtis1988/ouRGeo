// Turning a manifest's declarative contributions into the objects the app's
// registries already consume.
//
// This is the reason the manifest can be JSON at all. `UiAction`, `ToolDef`,
// `ToolbarButtonDef` and a docs topic are each "a data object plus at most one
// function"; the function is the only part a spec cannot state, and in every
// case here it can be GENERATED — from an R template, from a list of existing
// actions, from a lucide icon name.
//
// A model writing JSON against a schema is on far better ground than one
// writing JavaScript against an API it has to remember, so this path is the one
// the documentation pushes and `main.ts` is the exception.

import { Circle } from 'lucide-react'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { actionById } from '@/lib/ai-actions/registry'
import { validateArgs, ok, fail, type UiAction, type Args, type Tier } from '@/lib/ai-actions/types'
import type { ToolDef, Values } from '@/components/toolbox/tools'
import type { ToolbarButtonDef } from '@/lib/layout/toolbar'
import type { ActionSpec, ToolSpec, ToolbarButtonSpec, PluginManifest } from './types'

export interface CompiledContribution<T> {
  value: T
  warning?: string
}

// ── R templating ───────────────────────────────────────────────────────────

/**
 * Fill `{name}` placeholders in an R template.
 *
 * Values are quoted according to what they look like, using the same rule the
 * toolbox has always used for its own fields: a number, a logical or one of R's
 * specials goes in bare; anything else is a double-quoted string with its
 * backslashes and quotes escaped. `{{name}}` inserts the raw value, for the
 * cases where the template is building an expression rather than passing a
 * datum — a variable name, a column list.
 *
 * This is the whole of a declarative tool's implementation, so the escaping is
 * load-bearing: it is what stops a value the user typed from becoming R code.
 */
export function fillRTemplate(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_m, key: string) => values[key] ?? '')
    .replace(/\{(\w+)\}/g, (_m, key: string) => rValue(values[key] ?? ''))
}

function rValue(raw: string): string {
  const t = raw.trim()
  if (t === '') return '""'
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return t
  if (['TRUE', 'FALSE', 'NA', 'NULL', 'NaN', 'Inf', '-Inf'].includes(t)) return t
  return `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** The placeholders a template uses, so a spec can be checked against its own
 *  fields instead of failing at run time with an empty string in the R. */
export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(/\{\{?(\w+)\}?\}/g)].map((m) => m[1])
}

// ── Actions ────────────────────────────────────────────────────────────────

/**
 * Compile one declarative action.
 *
 * `sequence` composes existing actions BY ID and re-validates each step, so a
 * plugin cannot use composition to get past a tier: a step that needs Autopilot
 * still needs it, because the step runs through the same registry lookup the
 * assistant would have used.
 */
export function compileAction(
  manifest: PluginManifest, spec: ActionSpec,
): CompiledContribution<UiAction> | { error: string } {
  const name = String(spec.name ?? '').trim()
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
    return { error: `Action name "${spec.name}" must be letters and digits, starting with a letter — it becomes "${manifest.id}:${spec.name}".` }
  }
  const id = `${manifest.id}:${name}`
  const summary = String(spec.summary ?? '')
  if (summary.length < 11) {
    return { error: `Action "${id}" needs a summary of at least 11 characters saying what it does.` }
  }
  const run = spec.run
  if (!run || typeof run !== 'object') return { error: `Action "${id}" has no "run".` }

  let handler: UiAction['run']
  let warning: string | undefined

  if (run.kind === 'r') {
    if (typeof run.code !== 'string' || run.code.trim() === '') {
      return { error: `Action "${id}" is kind "r" but has no "code".` }
    }
    const declared = new Set((spec.params ?? []).map((p) => p.name))
    const unknown = templatePlaceholders(run.code).filter((k) => !declared.has(k))
    if (unknown.length > 0) {
      warning = `Action "${id}" uses {${unknown.join('}, {')}} but declares no such parameter; they will be empty.`
    }
    handler = async (args: Args) => {
      const values: Record<string, string> = {}
      for (const p of spec.params ?? []) values[p.name] = String(args[p.name] ?? p.default ?? '')
      const code = fillRTemplate(run.code, values)
      useSessionStore.getState().addConsoleEntry('input', code)
      const res = await rClient.execute(code)
      if (res.error) {
        useSessionStore.getState().addConsoleEntry('error', res.error)
        return fail(`${id} failed in R: ${res.error}`)
      }
      if (res.output) useSessionStore.getState().addConsoleEntry('output', res.output)
      return ok(`Ran ${id}.`, res.output || undefined)
    }
  } else if (run.kind === 'sequence') {
    const steps = Array.isArray(run.steps) ? run.steps : []
    if (steps.length === 0) return { error: `Action "${id}" is kind "sequence" but lists no steps.` }
    handler = async () => {
      const done: string[] = []
      for (const step of steps) {
        const action = actionById(step.id)
        if (!action) return fail(`${id} stopped: there is no action "${step.id}".`)
        const args = (step.params ?? {}) as Args
        const invalid = validateArgs(action, args)
        if (invalid) return fail(`${id} stopped at ${step.id}: ${invalid}`)
        const res = await action.run(args)
        if (!res.ok) return fail(`${id} stopped at ${step.id}: ${res.message}`)
        done.push(step.id)
      }
      return ok(`Ran ${id}: ${done.join(' → ')}.`)
    }
  } else if (run.kind === 'js') {
    return { error: `Action "${id}" is kind "js"; that form is registered from the plugin's code, not its manifest.` }
  } else {
    return { error: `Action "${id}" has run.kind "${String((run as { kind: string }).kind)}" — expected "r" or "sequence".` }
  }

  return {
    warning,
    value: {
      id,
      group: `plugin.${manifest.id}`,
      summary,
      params: spec.params ?? [],
      tier: (spec.tier ?? 'autopilot') as Tier,
      run: handler,
    },
  }
}

// ── Toolbox tools ──────────────────────────────────────────────────────────

export function compileTool(
  manifest: PluginManifest, spec: ToolSpec,
): CompiledContribution<{ tool: ToolDef; category: string; categoryLabel: string }> | { error: string } {
  const name = String(spec.name ?? '').trim()
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) {
    return { error: `Tool name "${spec.name}" must be letters, digits and hyphens, starting with a letter.` }
  }
  const id = `${manifest.id}-${name}`
  if (typeof spec.rTemplate !== 'string' || spec.rTemplate.trim() === '') {
    return { error: `Tool "${id}" has no "rTemplate" — that template is the tool.` }
  }
  const fields = Array.isArray(spec.fields) ? spec.fields : []
  const declared = new Set(fields.map((f) => f.id))
  const unknown = templatePlaceholders(spec.rTemplate).filter((k) => !declared.has(k))
  const warning = unknown.length > 0
    ? `Tool "${id}" uses {${unknown.join('}, {')}} but has no such field; they will be empty.`
    : undefined

  return {
    warning,
    value: {
      category: spec.category || `plugin-${manifest.id}`,
      categoryLabel: spec.categoryLabel || manifest.name,
      tool: {
        id,
        label: spec.label,
        description: spec.description ?? '',
        fields,
        output: spec.output,
        buildCode: (v: Values) => fillRTemplate(spec.rTemplate, v),
      },
    },
  }
}

// ── Toolbar buttons ────────────────────────────────────────────────────────

/**
 * Look up a lucide icon by name.
 *
 * Passed in rather than imported, because `import * as icons from
 * 'lucide-react'` defeats tree-shaking and put all ~1,500 icons — about 670 kB
 * — into the startup bundle for a feature most users never touch. The loader
 * imports the namespace dynamically, and only when a plugin actually declares
 * a button.
 */
export type IconLookup = (name: string) => ToolbarButtonDef['icon'] | undefined

export function compileToolbarButton(
  manifest: PluginManifest, spec: ToolbarButtonSpec, iconFor: IconLookup = () => undefined,
): CompiledContribution<ToolbarButtonDef> | { error: string } {
  const name = String(spec.name ?? '').trim()
  if (!name) return { error: 'A toolbar button needs a "name".' }
  const id = `${manifest.id}.${name}`

  // A lucide name that does not exist falls back to a dot rather than failing
  // the button: a missing icon is not worth losing a feature, and the user can
  // still read the tooltip.
  const icon = iconFor(spec.icon)
  const warning = icon ? undefined : `Toolbar button "${id}": no lucide icon called "${spec.icon}"; using a dot.`

  if (!spec.action && !spec.panel) {
    return { error: `Toolbar button "${id}" needs either "action" (an action id to run) or "panel" (one to toggle).` }
  }

  return {
    warning,
    value: {
      id,
      targetId: `toolbar.${id}`,
      label: spec.label || name,
      icon: icon ?? Circle,
      panel: spec.panel,
      // Namespaced for the plugin unless it already named a full id, so a
      // manifest can say `action: "fetch"` and mean its own.
      action: spec.action
        ? (spec.action.includes(':') ? spec.action : `${manifest.id}:${spec.action}`)
        : undefined,
    },
  }
}
