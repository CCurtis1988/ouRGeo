import http from 'node:http'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'

/**
 * A loopback MCP server, so the Claude Code CLI can call ouRGeo's tools.
 *
 * The CLI owns its own agent loop: it does not hand a tool call back to its
 * caller the way the HTTP APIs do, it calls tools *it* can see. MCP is how it
 * sees ours — which is what keeps `SendOptions.tools` and
 * `AiChatPanel.runTool` the single definition of what the assistant may do,
 * across every provider.
 *
 * Written by hand rather than with `@modelcontextprotocol/sdk`. This
 * repository has two runtime dependencies and each one is a paragraph in
 * CLAUDE.md; three JSON-RPC methods is not a third. The shape below was read
 * off a real CLI handshake:
 *
 *     POST server/discover  → an error is fine, it is a probe
 *     POST initialize
 *     POST notifications/initialized   (no id — answer 202, no body)
 *     GET  /mcp                        (the SSE back-channel; 405 is fine)
 *     POST tools/list
 *     POST tools/call
 *
 * Bound to 127.0.0.1 on a random port, guarded by a bearer token minted per
 * run, and closed when the child exits. Loopback servers are the house
 * pattern already — R's httpuv server, and the forum's PKCE redirect.
 */

import type { ClaudeToolSpec } from '../../src/lib/ai-claude-args'

/** One definition of a tool's shape, shared with the argv builder and with
 *  `AiTool` in the renderer. */
export type McpToolDef = ClaudeToolSpec

export interface McpBridge {
  url: string
  token: string
  close: () => void
}

const PROTOCOL_VERSION = '2025-06-18'

/** How long a single tool call may take before the model is told it timed out.
 *  Generous on purpose: a `confirm`-tier action blocks on a human reading a
 *  modal, and the honest answer to "the user has not decided yet" is not a
 *  severed socket. */
const TOOL_TIMEOUT_MS = 10 * 60 * 1000

export async function startMcpBridge(
  tools: McpToolDef[],
  call: (name: string, input: Record<string, unknown>) => Promise<string>,
): Promise<McpBridge> {
  const token = crypto.randomBytes(24).toString('hex')

  const respond = async (msg: Record<string, unknown>): Promise<unknown | null> => {
    const id = msg.id
    const method = msg.method
    // A notification (no id) gets no reply, per JSON-RPC.
    if (id === undefined || id === null) return null

    if (method === 'initialize') {
      const params = (msg.params ?? {}) as Record<string, unknown>
      return {
        jsonrpc: '2.0', id,
        result: {
          // Echo the client's protocol version when it offers one: the CLI is
          // updated far more often than ouRGeo is.
          protocolVersion: typeof params.protocolVersion === 'string'
            ? params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'ourgeo', version: '1.0.0' },
        },
      }
    }
    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools } }
    }
    if (method === 'tools/call') {
      const params = (msg.params ?? {}) as Record<string, unknown>
      const name = String(params.name ?? '')
      const input = (params.arguments ?? {}) as Record<string, unknown>
      try {
        const text = await withTimeout(call(name, input))
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } }
      } catch (e) {
        // An error INSIDE the result rather than a JSON-RPC error: a tool that
        // refused is something the model should read and work around, not a
        // transport fault it cannot see.
        return {
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: `Error: ${String(e)}` }], isError: true },
        }
      }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${String(method)}` } }
  }

  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end()
      return
    }
    if (req.method === 'GET') { res.writeHead(405).end(); return }
    if (req.method === 'DELETE') { res.writeHead(200).end(); return }
    if (req.method !== 'POST') { res.writeHead(405).end(); return }

    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      void (async () => {
        let parsed: unknown
        try { parsed = JSON.parse(body) } catch { res.writeHead(400).end(); return }
        const batch = Array.isArray(parsed) ? parsed : [parsed]
        const replies = (await Promise.all(
          batch.map((m) => respond(m as Record<string, unknown>))
        )).filter((r) => r !== null)
        if (replies.length === 0) { res.writeHead(202).end(); return }
        if (res.destroyed) return
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]))
      })()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () => { server.closeAllConnections?.(); server.close() },
  }
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error('the user did not answer in time; nothing was done')),
      TOOL_TIMEOUT_MS,
    )
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
