/**
 * The command line for one headless Claude Code run.
 *
 * Pure, and tested, for the same reason the voice services' request builders
 * are: every mistake in here is a child process that exits with a sentence
 * about a flag, and a builder exercised only by launching Electron is one
 * nobody exercises. The flags were read off `claude --help` and each one was
 * confirmed against the real CLI (2.1.263) before it was written down.
 *
 * It lives under `src/lib` and is listed in `tsconfig.node.json`, the pattern
 * `terminal/shells.ts` set: the main process imports it, and the renderer's
 * Vitest suite is what covers it. That is also why it declares its own tool
 * shape instead of importing `AiTool` — reaching into `ai-client.ts` from here
 * would pull the whole renderer into the main process's project.
 */

/** Structurally `AiTool` (ai-client.ts) and `McpToolDef` (claude-mcp.ts): one
 *  shape, declared where both a renderer module and a main-process module can
 *  see it. */
export interface ClaudeToolSpec {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] }
}

/** The MCP server name the CLI prefixes our tools with: `mcp__ourgeo__<tool>`. */
export const MCP_SERVER_NAME = 'ourgeo'

/** What the CLI calls one of our tools, which is not what we call it. The
 *  allowlist needs the prefixed form; `tools/call` arrives with the bare one. */
export const prefixedToolName = (name: string): string =>
  `mcp__${MCP_SERVER_NAME}__${name}`

export interface ClaudeRunSpec {
  /** Absolute path to the `claude` binary. */
  binary: string
  /** Where the system prompt was written. Not argv: it can run to tens of
   *  thousands of characters, and Windows caps a command line at 32,767. */
  systemPromptFile: string
  /** Model alias — `opus`, `sonnet`, `haiku` — not a dated model id. Which
   *  model an alias resolves to is the user's plan's business, and the
   *  `result` event reports what actually answered. */
  model: string
  effort?: string
  /** Conversation continuity is the CLI's: a uuid we mint on the first turn
   *  and resume on every one after. */
  sessionId: string
  /** False on the first turn of a conversation, true afterwards. */
  resume: boolean
  /**
   * Path to the written `--mcp-config`, or null for a run with no tools.
   *
   * A file rather than the JSON inline, because on Windows a `.cmd` shim has
   * to be spawned through the shell, and a shell would have to quote a blob
   * containing `{`, `"` and `:` correctly on a platform this repository cannot
   * test. `--mcp-config` takes "JSON files or strings"; the file removes the
   * question.
   */
  mcpConfigFile: string | null
  /** The tools the model may call this turn. Membership is decided by the
   *  caller — Autopilot off means `execute_r_code` is ABSENT, not refused
   *  afterwards, which is the rule the web tools set. */
  tools: ClaudeToolSpec[]
  /** R's working directory, so anything path-shaped means what it means in
   *  the console. */
  cwd: string
}

/** The `--mcp-config` payload: one bearer-guarded loopback HTTP server. */
export function mcpConfigJson(mcp: { url: string; token: string }): string {
  return JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url: mcp.url,
        headers: { Authorization: `Bearer ${mcp.token}` },
      },
    },
  })
}

export function buildClaudeArgs(spec: ClaudeRunSpec): string[] {
  const args = [
    '--print',
    // The input side is stdin for the same reason the system prompt is a file.
    '--input-format', 'stream-json',
    // stream-json is not optional: --input-format requires it, and it is also
    // the only output format that carries per-token deltas, the session id,
    // usage and the rate-limit windows.
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--system-prompt-file', spec.systemPromptFile,
    '--model', spec.model,
    // Every built-in tool off — Bash, Read, Write, Edit, WebFetch, all of it.
    // An allowlist that starts empty cannot be widened by a settings file we
    // did not write, which `--disallowedTools` cannot promise. ouRGeo's whole
    // audit story is that what the assistant does appears in the R console,
    // and a CLI that can quietly write a file has stepped outside it.
    '--tools', '',
    // Headless cannot answer a permission prompt, so anything that would ask
    // is denied instead of hanging until the request times out.
    '--permission-prompts', 'none',
    // The user's own CLAUDE.md, hooks, skills and MCP servers are not ouRGeo's
    // business and must not join this prompt: a repository instruction telling
    // an agent to run the test suite has no place in a spatial IDE's chat.
    '--setting-sources', '',
    '--strict-mcp-config',
  ]

  if (spec.effort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(spec.effort)) args.push('--effort', spec.effort)

  if (spec.mcpConfigFile) {
    args.push('--mcp-config', spec.mcpConfigFile)
    if (spec.tools.length > 0) {
      // Without the allowlist every call would be a permission prompt, and
      // `--permission-prompts none` turns a prompt into a refusal.
      args.push('--allowedTools', spec.tools.map((t) => prefixedToolName(t.name)).join(','))
    }
  }

  args.push(spec.resume ? '--resume' : '--session-id', spec.sessionId)
  return args
}

/** One user turn, as the CLI reads it from stdin. Only the newest turn is
 *  sent: the transcript is the CLI's, kept under `spec.sessionId`. */
export function userMessageLine(text: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })}\n`
}
