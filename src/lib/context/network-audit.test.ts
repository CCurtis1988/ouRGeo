import { expect, it } from 'vitest'
import { auditLinuxNetworkTrace } from './network-audit'

it('captures failed outbound attempts and child PIDs while allowing only literal loopback destinations', () => {
  const result = auditLinuxNetworkTrace(`101 12:00:00 connect(3, {sa_family=AF_INET, sin_addr=inet_addr("127.0.0.1")}, 16) = 0
102 12:00:00 connect(4, {sa_family=AF_INET6, sin6_addr=inet_pton(AF_INET6, "::1")}, 28) = 0
103 12:00:00 connect(5, {sa_family=AF_INET6, sin6_addr=inet_pton(AF_INET6, "::ffff:127.0.0.2")}, 28) = 0
104 12:00:00 sendto(6, "", 0, 0, {sa_family=AF_INET, sin_addr=inet_addr("198.51.100.42")}, 16) = -1 ENETUNREACH
105 12:00:00 connect(7, {sa_family=AF_INET6, sin6_addr=inet_pton(AF_INET6, "2001:db8::1")}, 28) = -1 ENETUNREACH
106 12:00:00 connect(8, {sa_family=AF_UNIX, sun_path=""}, 16) = 0`)
  expect(result.passed).toBe(false)
  expect(result.loopbackCalls).toBe(3)
  expect(result.unixCalls).toBe(1)
  expect(result.tracedTasks).toBe(6)
  expect(result.externalAttempts.map(item => item.address)).toEqual(['198.51.100.42', '2001:db8::1'])
  expect(result.externalAttempts[0].result).toContain('ENETUNREACH')
})

it('refuses empty, undecoded internet addresses and opaque kernel queue submissions', () => {
  expect(auditLinuxNetworkTrace('').passed).toBe(false)
  expect(auditLinuxNetworkTrace('123 connect(4, {sa_family=AF_INET, data=0x01}, 16) = 0').passed).toBe(false)
  expect(auditLinuxNetworkTrace('123 io_uring_setup(8, {}) = 4').passed).toBe(false)
  expect(auditLinuxNetworkTrace('123 io_uring_setup(8, {}) = -1 EPERM').passed).toBe(true)
  expect(auditLinuxNetworkTrace('123 connect(4, {sa_family=AF_INET, sin_addr=inet_addr("127.0.0.999")}, 16) = 0').passed).toBe(false)
})

it('sees connected TCP and UDP writes even when the syscall omits its destination', () => {
  const result = auditLinuxNetworkTrace(`101 write(7<TCP:[127.0.0.1:4000->198.51.100.42:443]>, "", 12) = 12
102 sendto(8<UDPv6:[[::1]:1234->[2001:db8::1]:53]>, "", 20, 0, NULL, 0) = 20
103 writev(9<TCPv6:[[::1]:4000->[::1]:5000]>, [], 0) = 0`)
  expect(result.externalAttempts.map(item => [item.call, item.address])).toEqual([['write', '198.51.100.42'], ['sendto', '2001:db8::1']])
  expect(result.successfulExternalCalls).toBe(2)
  expect(result.loopbackCalls).toBe(1)
  expect(result.passed).toBe(false)
})

it('uses explicit UDP destinations ahead of the annotated connected peer', () => {
  const result = auditLinuxNetworkTrace('101 sendto(7<UDP:[127.0.0.1:4000->127.0.0.1:5000]>, "", 10, 0, {sa_family=AF_INET, sin_addr=inet_addr("198.51.100.42")}, 16) = -1 ENETUNREACH')
  expect(result.externalAttempts[0].address).toBe('198.51.100.42')
  expect(result.blockedExternalCalls).toBe(1)
  expect(result.loopbackCalls).toBe(0)
})

it('joins interleaved resumed results by thread and preserves unresolved calls', () => {
  const result = auditLinuxNetworkTrace(`101 connect(4, {sa_family=AF_INET, sin_addr=inet_addr("198.51.100.42")}, 16 <unfinished ...>
102 io_uring_setup(8, {} <unfinished ...>
103 connect(5, {sa_family=AF_INET, sin_addr=inet_addr("203.0.113.9")}, 16 <unfinished ...>
102 <... io_uring_setup resumed>) = -1 EPERM
101 <... connect resumed>) = -1 ENETUNREACH`)
  expect(result.blockedExternalCalls).toBe(1)
  expect(result.unresolvedExternalCalls).toBe(1)
  expect(result.ioUringCalls).toBe(0)
  expect(result.externalAttempts.find(item => item.pid === 101)?.result).toBe('-1 ENETUNREACH')
  expect(result.externalAttempts.find(item => item.pid === 103)?.result).toContain('unknown')
  expect(result.passed).toBe(false)
})

it('fails closed for an internet write without a decoded peer and treats pending connects as unknown', () => {
  expect(auditLinuxNetworkTrace('101 write(4<TCP:[9876]>, "", 5) = 5').passed).toBe(false)
  const result = auditLinuxNetworkTrace('101 connect(4, {sa_family=AF_INET, sin_addr=inet_addr("198.51.100.42")}, 16) = -1 EINPROGRESS')
  expect(result.blockedExternalCalls).toBe(0)
  expect(result.unresolvedExternalCalls).toBe(1)
})
