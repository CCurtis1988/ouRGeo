/* SPDX-License-Identifier: AGPL-3.0-or-later
 * Synthetic readiness-control and network SQEs validate the observer. No
 * application state or payload is read. Run inside the loopback namespace. */
#include <linux/io_uring.h>
#include <sys/syscall.h>
#include <sys/mman.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>

int main(int argc, char **argv) {
 struct io_uring_params params = {0};
 params.flags = IORING_SETUP_NO_SQARRAY;
 int ring = syscall(__NR_io_uring_setup, 8, &params);
 if (ring < 0) { perror("io_uring_setup"); return 1; }
 size_t length = params.cq_off.cqes + params.cq_entries * sizeof(struct io_uring_cqe);
 void *queue = mmap(NULL, length, PROT_READ | PROT_WRITE, MAP_SHARED, ring, IORING_OFF_SQ_RING);
 struct io_uring_sqe *sqes = mmap(NULL, params.sq_entries * sizeof(*sqes), PROT_READ | PROT_WRITE, MAP_SHARED, ring, IORING_OFF_SQES);
 if (queue == MAP_FAILED || sqes == MAP_FAILED) { perror("mmap"); return 1; }
 struct sockaddr_in address = { .sin_family = AF_INET, .sin_port = htons(443) };
 struct epoll_event event = { .events = EPOLLIN };
 int pipes[2];
 if (argc > 1 && !strcmp(argv[1], "network")) {
   inet_pton(AF_INET, "198.51.100.42", &address.sin_addr);
   sqes[0].opcode = IORING_OP_CONNECT;
   sqes[0].fd = socket(AF_INET, SOCK_DGRAM, 0);
   sqes[0].addr = (uint64_t)(uintptr_t)&address;
   sqes[0].off = sizeof(address);
 } else {
   if (pipe(pipes)) return 1;
   sqes[0].opcode = IORING_OP_EPOLL_CTL;
   sqes[0].fd = epoll_create1(EPOLL_CLOEXEC);
   sqes[0].off = pipes[0]; sqes[0].len = EPOLL_CTL_ADD;
   sqes[0].addr = (uint64_t)(uintptr_t)&event;
 }
 *(uint32_t *)((char *)queue + params.sq_off.tail) = 1;
 int submitted = syscall(__NR_io_uring_enter, ring, 1, 1, IORING_ENTER_GETEVENTS, NULL, 0);
 if (submitted != 1) { perror("io_uring_enter"); return 1; }
 printf("Submitted synthetic opcode %u.\n", sqes[0].opcode);
 return 0;
}
