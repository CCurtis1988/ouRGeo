import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import dgram from 'node:dgram'
import tls from 'node:tls'
import { extractDocument } from './extraction'

// Electron's Node 24 permission model constrains filesystem/process access but
// does not yet constrain network. Parsers receive only bytes, and all exposed
// network entry points are disabled before any document is opened. This is a
// defence against accidental fetches, not a claim to sandbox hostile JS code.
const denied = (): never => { throw new Error('Network access is disabled during project-file indexing.') }
net.connect = denied; net.createConnection = denied; net.Socket.prototype.connect = denied
http.request = denied; http.get = denied; https.request = denied; https.get = denied
tls.connect = denied; dgram.createSocket = denied
Object.assign(dns, { lookup: denied, resolve: denied })
dns.promises.lookup = denied; dns.promises.resolve = denied
globalThis.fetch = denied
syncBuiltinESMExports()

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  input += chunk
  if (input.length > 8192) process.exit(1)
})
process.stdin.on('end', () => {
  void (async () => {
    const request = JSON.parse(input) as { path: string; mediaType: string; originalName: string; options?: { includeHidden?: boolean } }
    if (typeof request.path !== 'string' || typeof request.mediaType !== 'string' || typeof request.originalName !== 'string') throw new Error('Invalid extraction request')
    // PDF.js warnings belong to diagnostics; stdout is the one JSON response.
    console.log = console.warn = (...args: unknown[]) => process.stderr.write(`${args.map(String).join(' ')}\n`) && undefined
    const extraction = await extractDocument(request.path, request.mediaType, request.originalName, { includeHidden: request.options?.includeHidden === true })
    process.stdout.write(JSON.stringify(extraction), () => process.exit(0))
  })().catch(error => { process.stderr.write(String(error)); process.exit(1) })
})
