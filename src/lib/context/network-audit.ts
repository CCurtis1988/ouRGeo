/** Classify a Linux strace from process launch with descendants attached.
 * Payload strings must be suppressed by the collector (-s 0). Unix desktop IPC
 * and network activity performed by services outside this tree remain separate.
 * An opaque io_uring submission cannot certify absence of network attempts. */
export function auditLinuxNetworkTrace(trace: string): {
  outboundCalls: number; loopbackCalls: number; unixCalls: number
  externalAttempts: { pid: number; call: string; address: string; result: string }[]
  unclassifiedInternetCalls: string[]; ioUringCalls: number
  tracedTasks: number; passed: boolean
} {
  const externalAttempts: { pid: number; call: string; address: string; result: string }[] = []
  const unclassifiedInternetCalls: string[] = []
  let outboundCalls = 0, loopbackCalls = 0, unixCalls = 0, ioUringCalls = 0
  const tasks = new Set<number>()
  const loopback = (address: string): boolean => {
    const ip = address.toLowerCase().replace(/^::ffff:/, '')
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true
    const bytes = ip.split('.')
    return bytes.length === 4 && bytes[0] === '127' && bytes.every(byte => /^\d{1,3}$/.test(byte) && Number(byte) <= 255)
  }
  for (const line of trace.split('\n')) {
    const pid = Number(line.match(/^(?:\[pid\s+)?(\d+)/)?.[1] ?? 0)
    if (pid) tasks.add(pid)
    if (/\bio_uring_(?:setup|register|enter)\(/.test(line) && !/= -1\b/.test(line)) ioUringCalls++
    const call = line.match(/\b(connect|sendto|sendmsg|sendmmsg)\(/)?.[1]
    if (!call) continue
    if (line.includes('AF_UNIX') || line.includes('AF_LOCAL')) unixCalls++
    if (!line.includes('AF_INET')) continue
    outboundCalls++
    const addresses = [...line.matchAll(/inet_addr\("([^"]+)"\)|inet_pton\(AF_INET6, "([^"]+)"/g)].map(match => match[1] ?? match[2])
    if (!addresses.length) { unclassifiedInternetCalls.push(line.slice(0, 1000)); continue }
    for (const address of addresses) {
      if (loopback(address)) loopbackCalls++
      else externalAttempts.push({ pid, call, address, result: line.slice(line.lastIndexOf(' = ') + 3, line.lastIndexOf(' = ') + 243) })
    }
  }
  return { outboundCalls, loopbackCalls, unixCalls, externalAttempts, unclassifiedInternetCalls, ioUringCalls,
    tracedTasks: tasks.size, passed: externalAttempts.length === 0 && unclassifiedInternetCalls.length === 0 && ioUringCalls === 0 && tasks.size > 0 }
}
