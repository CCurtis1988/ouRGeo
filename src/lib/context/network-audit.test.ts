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
