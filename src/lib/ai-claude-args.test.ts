import { describe, it, expect } from 'vitest'
import {
  buildClaudeArgs, mcpConfigJson, prefixedToolName, userMessageLine,
  type ClaudeRunSpec, type ClaudeToolSpec,
} from './ai-claude-args'

const tool = (name: string): ClaudeToolSpec => ({
  name, description: `does ${name}`,
  inputSchema: { type: 'object', properties: {}, required: [] },
})

const spec = (over: Partial<ClaudeRunSpec> = {}): ClaudeRunSpec => ({
  binary: '/usr/bin/claude',
  systemPromptFile: '/tmp/sp.txt',
  model: 'sonnet',
  sessionId: '11111111-2222-3333-4444-555555555555',
  resume: false,
  mcpConfigFile: '/tmp/mcp.json',
  tools: [tool('execute_r_code'), tool('run_ui_action')],
  cwd: '/home/u',
  ...over,
})

/** `--flag value` as one pair, so order-insensitive assertions read plainly. */
const pair = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag)
  return i < 0 ? undefined : args[i + 1]
}

describe('the command line for one headless run', () => {
  it('switches every built-in tool off', () => {
    // Not `--disallowedTools`: an allowlist that starts empty cannot be
    // widened by a settings file ouRGeo did not write, and a CLI that can
    // quietly Bash or Write has stepped outside the console audit trail that
    // the whole assistant rests on.
    expect(pair(buildClaudeArgs(spec()), '--tools')).toBe('')
  })

  it('ignores the user’s own Claude Code configuration', () => {
    const args = buildClaudeArgs(spec())
    expect(pair(args, '--setting-sources')).toBe('')
    expect(args).toContain('--strict-mcp-config')
  })

  it('denies rather than hangs when something would prompt', () => {
    // A headless run has nobody to ask, and a request that waits forever for
    // an answer nobody can give is worse than a refusal the model can read.
    expect(pair(buildClaudeArgs(spec()), '--permission-prompts')).toBe('none')
  })

  it('puts the system prompt in a file, never on the command line', () => {
    // It carries the environment listing, the console tail and the open
    // documents — tens of thousands of characters — and Windows caps a
    // command line at 32,767.
    const args = buildClaudeArgs(spec())
    expect(pair(args, '--system-prompt-file')).toBe('/tmp/sp.txt')
    expect(args.some((a) => a.includes('You are'))).toBe(false)
  })

  it('names the session on the first turn and resumes it after', () => {
    const first = buildClaudeArgs(spec({ resume: false }))
    expect(first).toContain('--session-id')
    expect(first).not.toContain('--resume')
    const later = buildClaudeArgs(spec({ resume: true }))
    expect(later).toContain('--resume')
    expect(later).not.toContain('--session-id')
    expect(pair(later, '--resume')).toBe(spec().sessionId)
  })

  it('allows exactly the ouRGeo tools it was given, by their prefixed names', () => {
    // The CLI lists an MCP tool as mcp__<server>__<tool>; without the
    // allowlist every call is a permission prompt, and a prompt is a refusal.
    expect(pair(buildClaudeArgs(spec()), '--allowedTools'))
      .toBe('mcp__ourgeo__execute_r_code,mcp__ourgeo__run_ui_action')
  })

  it('offers no MCP server, and no allowlist, when there are no tools', () => {
    const args = buildClaudeArgs(spec({ mcpConfigFile: null, tools: [] }))
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--allowedTools')
  })

  it('passes the MCP config as a path, never as inline JSON', () => {
    // Inline, a Windows `.cmd` shim spawned through the shell would have to
    // quote a blob full of braces and quotes correctly, on the one platform
    // this repository cannot test.
    expect(pair(buildClaudeArgs(spec()), '--mcp-config')).toBe('/tmp/mcp.json')
  })

  it('carries the bearer token the bridge minted', () => {
    const cfg = JSON.parse(mcpConfigJson({ url: 'http://127.0.0.1:9/mcp', token: 'abc' }))
    expect(cfg.mcpServers.ourgeo.type).toBe('http')
    expect(cfg.mcpServers.ourgeo.headers.Authorization).toBe('Bearer abc')
  })

  it('asks for the output format the rest of the transport depends on', () => {
    const args = buildClaudeArgs(spec())
    expect(pair(args, '--output-format')).toBe('stream-json')
    expect(pair(args, '--input-format')).toBe('stream-json')
    expect(args).toContain('--include-partial-messages')
    // stream-json output is only emitted with --verbose.
    expect(args).toContain('--verbose')
  })

  it('names a tool the way the CLI will', () => {
    expect(prefixedToolName('ourgeo_docs')).toBe('mcp__ourgeo__ourgeo_docs')
  })

  it('sends one user turn as a single NDJSON line', () => {
    const line = userMessageLine('what is in the session?')
    expect(line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(line)
    expect(parsed.type).toBe('user')
    expect(parsed.message.content[0].text).toBe('what is in the session?')
  })

  it('escapes a prompt that would otherwise break the line', () => {
    const line = userMessageLine('line one\nline two "quoted"')
    expect(line.split('\n')).toHaveLength(2) // the trailing newline only
    expect(JSON.parse(line).message.content[0].text).toBe('line one\nline two "quoted"')
  })
})
