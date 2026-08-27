// The AI tools that expose the GUI.
//
// Five tools cover ~90 actions and 87 toolbox tools, because a tool definition
// costs context on every single request and a local model with a 32k window
// cannot afford ninety of them. Discovery is a tool call instead
// (`list_ui_actions`), and the system prompt carries only the id index.
//
// Same shape as ai-web-tools.ts and ai-doc-tools.ts — TOOLS / TOOL_NAMES /
// run… / describe…Call — so AiChatPanel dispatches all four families
// identically.

import type { AiTool } from '@/lib/ai-client'
import { ALL_ACTIONS, actionById, listActions, actionIndex } from '@/lib/ai-actions/registry'
import { checkAllowed, resolveTier } from '@/lib/ai-actions/permissions'
import { validateArgs, GROUP_LABELS, type Args } from '@/lib/ai-actions/types'
import {
  findTool, searchTools, toolLine, describeTool, runToolboxTool, categoryListing,
} from '@/lib/ai-actions/toolbox'
import { OURGEO_TOPICS, topicListing, readTopic } from '@/lib/ai-skill-ourgeo'
import { useUiStore } from '@/store/ui'
import type { Values } from '@/components/toolbox/tools'

export const LIST_UI_ACTIONS_TOOL: AiTool = {
  name: 'list_ui_actions',
  description:
    'Search the things you can do in the ouRGeo interface — open panels and dialogs, add and ' +
    'style map layers, import data, manage the R environment, point at controls. Returns each ' +
    'action id with its parameters and its permission tier. Call this when you need an action\'s ' +
    'parameters; the ids themselves are already listed in your context.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Free text, e.g. "symbology", "import", "highlight".' },
      group: {
        type: 'string',
        description: `Restrict to one group: ${Object.keys(GROUP_LABELS).join(', ')}.`,
      },
    },
    required: [],
  },
}

export const RUN_UI_ACTION_TOOL: AiTool = {
  name: 'run_ui_action',
  description:
    'Perform one ouRGeo interface action by id, with its parameters. Actions that change the R ' +
    'session or the filesystem need Autopilot; destructive ones also ask the user to confirm. ' +
    'The result tells you what actually happened — read it before describing it.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'Action id, e.g. "map:addLayer".' },
      params: {
        type: 'object',
        description: 'Parameters for the action, as named in list_ui_actions.',
      },
    },
    required: ['id'],
  },
}

export const TOOLBOX_TOOLS_TOOL: AiTool = {
  name: 'toolbox_tools',
  description:
    'Search ouRGeo\'s Toolbox — 87 geoprocessing tools across table operations, joins, ' +
    'aggregation, type/string handling, sf, geos and terra raster. Pass a query to search, or a ' +
    'toolId to see one tool\'s fields.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Free text, e.g. "buffer", "join", "reproject".' },
      toolId: { type: 'string', description: 'Describe this one tool\'s fields in full.' },
      category: { type: 'string', description: 'Restrict a search to one category.' },
    },
    required: [],
  },
}

export const RUN_TOOLBOX_TOOL_TOOL: AiTool = {
  name: 'run_toolbox_tool',
  description:
    'Run one Toolbox tool, generating the same R the dialog would generate. Use dryRun to show ' +
    'the user the code without running it — which is usually the right thing in a tutorial.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      toolId: { type: 'string', description: 'Tool id from toolbox_tools.' },
      values: {
        type: 'object',
        description: 'Field values keyed by field id, all as strings.',
      },
      dryRun: {
        type: 'boolean',
        description: 'Return the generated R without executing it. Default false.',
      },
    },
    required: ['toolId', 'values'],
  },
}

export const OURGEO_DOCS_TOOL: AiTool = {
  name: 'ourgeo_docs',
  description:
    'Read ouRGeo\'s own documentation: how a part of the application works, what a panel does, ' +
    'what the toolbox categories contain, how data import or projects or documents work. Call ' +
    'this before explaining any part of ouRGeo you are not certain about.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      topic: {
        type: 'string',
        description: `One of: ${Object.keys(OURGEO_TOPICS).join(', ')}. Omit to list the topics.`,
      },
    },
    required: [],
  },
}

export const UI_TOOLS: AiTool[] = [
  LIST_UI_ACTIONS_TOOL, RUN_UI_ACTION_TOOL,
  TOOLBOX_TOOLS_TOOL, RUN_TOOLBOX_TOOL_TOOL,
  OURGEO_DOCS_TOOL,
]

export const UI_TOOL_NAMES: ReadonlySet<string> = new Set(UI_TOOLS.map((t) => t.name))

/** Re-exported so AiChatPanel can put the id index in the system prompt. */
export { actionIndex }

// ── Dispatch ───────────────────────────────────────────────────────────────

function asArgs(v: unknown): Args {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Args
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v)
      if (parsed && typeof parsed === 'object') return parsed as Args
    } catch { /* fall through */ }
  }
  return {}
}

function renderArgs(args: Args): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return '(no parameters)'
  return entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
}

async function runAction(id: string, args: Args, opts: { autoPilot: boolean }): Promise<string> {
  const action = actionById(id)
  if (!action) {
    return `Error: no action called "${id}". Use list_ui_actions to find the right id. ` +
      `Groups: ${Object.keys(GROUP_LABELS).join(', ')}.`
  }

  const invalid = validateArgs(action, args)
  if (invalid) return `Error: ${invalid}`

  const decision = checkAllowed(action, opts)
  if (!decision.allowed && decision.reason === 'autopilot') return decision.message
  if (!decision.allowed && decision.reason === 'confirm') {
    const allowed = await useUiStore.getState().askConfirm({
      actionId: action.id,
      summary: action.summary,
      details: renderArgs(args),
    })
    if (!allowed) {
      return `Refused: the user declined "${action.id}". Do not retry it. Say what you were going ` +
        'to do and let them decide; you can point at the control with ui:highlight instead.'
    }
  }

  try {
    const result = await action.run(args)
    const body = typeof result.data === 'string' && result.data ? `\n\n${result.data}` : ''
    return `${result.ok ? '' : 'Failed: '}${result.message}${body}`
  } catch (e) {
    return `Error running ${action.id}: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function runToolbox(input: Record<string, unknown>): Promise<string> {
  const toolId = typeof input.toolId === 'string' ? input.toolId : ''
  const tool = findTool(toolId)
  if (!tool) {
    return `Error: no toolbox tool called "${toolId}". Search for one with toolbox_tools.`
  }
  const rawValues = asArgs(input.values)
  const values: Values = {}
  for (const [k, v] of Object.entries(rawValues)) {
    values[k] = typeof v === 'string' ? v : String(v)
  }
  const unknown = Object.keys(values).filter((k) => !tool.fields.some((f) => f.id === k))
  if (unknown.length > 0) {
    return `Error: "${tool.label}" has no field(s) ${unknown.map((u) => `"${u}"`).join(', ')}.\n\n` +
      describeTool(tool)
  }
  const res = await runToolboxTool(tool, values, input.dryRun === true)
  return res.ok ? res.message : `Failed: ${res.message}`
}

/** Dispatch, matching the other tool families: every failure is a string the
 *  model can recover from, never a thrown error. */
export async function runUiTool(
  name: string, input: Record<string, unknown>, opts: { autoPilot: boolean },
): Promise<string> {
  switch (name) {
    case LIST_UI_ACTIONS_TOOL.name:
      return listActions(
        typeof input.query === 'string' ? input.query : '',
        typeof input.group === 'string' ? input.group : undefined,
      )

    case RUN_UI_ACTION_TOOL.name:
      return runAction(
        typeof input.id === 'string' ? input.id : '',
        asArgs(input.params),
        opts,
      )

    case TOOLBOX_TOOLS_TOOL.name: {
      const toolId = typeof input.toolId === 'string' ? input.toolId : ''
      if (toolId) {
        const tool = findTool(toolId)
        return tool ? describeTool(tool) : `Error: no toolbox tool called "${toolId}".`
      }
      const query = typeof input.query === 'string' ? input.query : ''
      const category = typeof input.category === 'string' ? input.category : undefined
      const hits = searchTools(query, category)
      if (hits.length === 0) {
        return `No toolbox tools match "${query}". Categories:\n${categoryListing()}`
      }
      const head = hits.slice(0, 40)
      return `${hits.length} tool(s):\n${head.map(toolLine).join('\n')}` +
        (hits.length > head.length ? `\n… and ${hits.length - head.length} more` : '')
    }

    case RUN_TOOLBOX_TOOL_TOOL.name:
      return runToolbox(input)

    case OURGEO_DOCS_TOOL.name: {
      const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
      return topic ? readTopic(topic) : topicListing()
    }

    default:
      return `Error: unknown interface tool "${name}".`
  }
}

/** The console line logged before the call, so the console stays a complete
 *  record of what the assistant did to the application. */
export function describeUiCall(name: string, input: Record<string, unknown>): string {
  if (name === RUN_UI_ACTION_TOOL.name) {
    const id = typeof input.id === 'string' ? input.id : '?'
    const args = renderArgs(asArgs(input.params)).replace(/\n/g, ', ')
    const action = actionById(id)
    const tier = action ? resolveTier(action) : 'always'
    return `AI: ${id}${args === '(no parameters)' ? '' : ` (${args})`}` +
      (tier === 'always' ? '' : ` [${tier}]`)
  }
  if (name === RUN_TOOLBOX_TOOL_TOOL.name) {
    const id = typeof input.toolId === 'string' ? input.toolId : '?'
    return `AI: toolbox ${id}${input.dryRun === true ? ' (preview only)' : ''}`
  }
  if (name === LIST_UI_ACTIONS_TOOL.name) return 'AI: searched the interface actions'
  if (name === TOOLBOX_TOOLS_TOOL.name) return 'AI: searched the toolbox'
  if (name === OURGEO_DOCS_TOOL.name) {
    return `AI: read the ouRGeo docs${typeof input.topic === 'string' && input.topic ? ` (${input.topic})` : ''}`
  }
  return `AI: ${name}`
}

/** Every action id, for tests and the permissions dialog. */
export const ACTION_IDS = ALL_ACTIONS.map((a) => a.id)
