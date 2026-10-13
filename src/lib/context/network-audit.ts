/** Classify payload-suppressed strace output, including connected socket writes.
 * The collector must use -yy and trace write/writev as well as %network. Shared
 * desktop services outside this process tree and opaque io_uring stay separate.
 * A pinned payload-free tracer extension may prove individual submissions contain
 * only epoll-control operations. Unobserved or unsupported queues still fail. */
export function auditLinuxNetworkTrace(trace: string, options: { ringObserver?: boolean } = {}): {
  outboundCalls: number; loopbackCalls: number; unixCalls: number
  externalAttempts: { pid: number; call: string; address: string; result: string }[]
  successfulExternalCalls: number; blockedExternalCalls: number; unresolvedExternalCalls: number
  unclassifiedInternetCalls: string[]; ioUringCalls: number
  decodedIoUringCalls: number; opaqueIoUringCalls: number; ioUringOpcodes: number[]
  tracedTasks: number; passed: boolean
} {
  const externalAttempts: { pid: number; call: string; address: string; result: string }[] = []
  const unclassifiedInternetCalls: string[] = []
  let outboundCalls = 0, loopbackCalls = 0, unixCalls = 0, ioUringCalls = 0, decodedIoUringCalls = 0
  const ioUringOpcodes = new Set<number>()
  const tasks = new Set<number>(), pending = new Map<number, string>()
  const lines: { pid: number; text: string }[] = []
  const loopback = (address: string): boolean => {
    const ip = address.toLowerCase().replace(/^::ffff:/, '')
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true
    const bytes = ip.split('.')
    return bytes.length === 4 && bytes[0] === '127' && bytes.every(byte => /^\d{1,3}$/.test(byte) && Number(byte) <= 255)
  }
  // A thread has at most one pending syscall. Keep its arguments until the
  // resumed result arrives; an unfinished call is never presumed successful.
  for (const text of trace.split('\n')) {
    const pid = Number(text.match(/^(?:\[pid\s+)?(\d+)/)?.[1] ?? 0)
    if (pid) tasks.add(pid)
    if (text.includes('<unfinished ...>')) {
      const prior = pending.get(pid)
      if (prior) lines.push({ pid, text: prior })
      pending.set(pid, text.slice(0, text.indexOf(' <unfinished ...>')))
    } else if (text.includes(' resumed>')) {
      const prior = pending.get(pid)
      if (prior) {
        lines.push({ pid, text: prior + text.slice(text.indexOf(' resumed>') + ' resumed>'.length) })
        pending.delete(pid)
      } else lines.push({ pid, text })
    } else lines.push({ pid, text })
  }
  for (const [pid, text] of pending) lines.push({ pid, text })
  for (const { pid, text } of lines) {
    const result = text.match(/ = (.*)$/)?.[1] ?? 'unfinished; outcome unknown'
    const ringCall = text.match(/\bio_uring_(setup|register|enter)\(/)?.[1]
    if (ringCall && (ringCall === 'enter' || !result.startsWith('-1 '))) {
      ioUringCalls++
      if (options.ringObserver && ringCall === 'setup' && text.includes('/* ourgeo-ring:v1 setup=observed */')) decodedIoUringCalls++
      else if (options.ringObserver && ringCall === 'enter') {
        const observed = text.match(/\/\* ourgeo-ring:v1 entries=(\d+) opcodes=\[([\d:,]*)\] \*\//)
        const submitted = text.match(/io_uring_enter\((?:\s*\/\*[^*]*\*\/)?\s*\d+(?:<[^>]*>)?,\s*(\d+),/)?.[1]
        const ops = observed?.[2] ? observed[2].split(',') : []
        for (const op of ops) if (/^\d+:\d+$/.test(op)) ioUringOpcodes.add(Number(op.split(':')[0]))
        // IORING_OP_EPOLL_CTL (29) changes readiness registration, never sends
        // bytes. No SQE flags, extra operations, missing entries or guessed
        // runtime/version exemptions can turn an unknown queue into a pass.
        if (observed && submitted !== undefined && Number(observed[1]) === Number(submitted)
          && ops.length === Number(submitted) && ops.every(op => op === '29:0')) decodedIoUringCalls++
      }
    }
    const call = text.match(/\b(connect|sendto|sendmsg|sendmmsg|send|write|writev)\(/)?.[1]
    if (!call) continue
    if (/AF_UNIX|AF_LOCAL|UNIX(?:-STREAM|-DGRAM)?:\[/.test(text)) unixCalls++
    const internet = /AF_INET|<(?:TCP|UDP)(?:v6)?:\[/.test(text)
    if (!internet) continue
    outboundCalls++
    // Explicit destinations win over the descriptor's existing peer. A UDP
    // sendto may target a different address from the one shown in -yy output.
    let addresses = [...text.matchAll(/inet_addr\("([^"]+)"\)|inet_pton\(AF_INET6, "([^"]+)"/g)].map(match => match[1] ?? match[2])
    if (!addresses.length) addresses = [...text.matchAll(/->(?:\[([0-9a-fA-F:.]+)\]|(\d+(?:\.\d+){3})):\d+/g)].map(match => match[1] ?? match[2])
    if (!addresses.length) { unclassifiedInternetCalls.push(text.slice(0, 1000)); continue }
    for (const address of addresses) {
      if (loopback(address)) loopbackCalls++
      else externalAttempts.push({ pid, call, address, result: result.slice(0, 240) })
    }
  }
  const successfulExternalCalls = externalAttempts.filter(item => /^\d+(?:\s|$)/.test(item.result)).length
  const blockedExternalCalls = externalAttempts.filter(item => item.result.startsWith('-1 ') && !/EINPROGRESS|EALREADY/.test(item.result)).length
  return { outboundCalls, loopbackCalls, unixCalls, externalAttempts, successfulExternalCalls, blockedExternalCalls,
    unresolvedExternalCalls: externalAttempts.length - successfulExternalCalls - blockedExternalCalls,
    unclassifiedInternetCalls, ioUringCalls, decodedIoUringCalls, opaqueIoUringCalls: ioUringCalls - decodedIoUringCalls, ioUringOpcodes: [...ioUringOpcodes], tracedTasks: tasks.size,
    passed: externalAttempts.length === 0 && unclassifiedInternetCalls.length === 0 && ioUringCalls === decodedIoUringCalls && tasks.size > 0 }
}
