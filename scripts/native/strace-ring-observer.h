/* SPDX-License-Identifier: LGPL-2.1-or-later
 * Payload-free observer for strace 7.2. Read queued SQE opcodes at the syscall
 * stop; never print buffers, paths, user_data or sockaddr contents. Only fully
 * decoded epoll-control operations can qualify as non-network activity.
 * SQPOLL, registered rings, alternate layouts and unreadable mappings stay
 * opaque. The ordinary strace output remains the network source of truth. */
#include <sys/stat.h>
#include <sys/sysmacros.h>

struct ourgeo_ring {
 dev_t device;
 ino_t inode;
 struct io_uring_params params;
 struct ourgeo_ring *next;
};
static struct ourgeo_ring *ourgeo_rings;

static bool ourgeo_ring_stat(struct tcb *tcp, int fd, struct stat *st) {
 char path[96], target[96];
 snprintf(path, sizeof(path), "/proc/%d/fd/%d", tcp->pid, fd);
 ssize_t length = readlink(path, target, sizeof(target) - 1);
 if (length < 0) return false;
 target[length] = 0;
 return !strcmp(target, "anon_inode:[io_uring]") && !stat(path, st);
}

static bool ourgeo_ring_layout(const struct io_uring_params *p) {
 return !(p->flags & ~(IORING_SETUP_NO_SQARRAY | IORING_SETUP_CQSIZE | IORING_SETUP_CLAMP))
   && p->sq_entries && p->sq_entries <= 32768;
}

static void ourgeo_ring_setup(struct tcb *tcp, const struct io_uring_params *params) {
 struct stat st;
 if (tcp->u_error || !ourgeo_ring_stat(tcp, tcp->u_rval, &st)) return;
 struct ourgeo_ring *ring = ourgeo_rings;
 while (ring && (ring->device != st.st_dev || ring->inode != st.st_ino)) ring = ring->next;
 if (!ring) {
   ring = xcalloc(1, sizeof(*ring)); ring->next = ourgeo_rings; ourgeo_rings = ring;
 }
 ring->device = st.st_dev; ring->inode = st.st_ino; ring->params = *params;
 if (ourgeo_ring_layout(params)) tprints_string(" /* ourgeo-ring:v1 setup=observed */");
}

struct ourgeo_mapping { kernel_ulong_t start, size; };
static bool ourgeo_ring_maps(struct tcb *tcp, const struct stat *st,
 struct ourgeo_mapping *queue, struct ourgeo_mapping *entries) {
 char path[64], line[1024], perms[5];
 snprintf(path, sizeof(path), "/proc/%d/maps", tcp->pid);
 FILE *maps = fopen(path, "r");
 if (!maps) return false;
 unsigned long long start, end, offset, inode;
 unsigned dev_major, dev_minor;
 while (fgets(line, sizeof(line), maps)) {
   if (sscanf(line, "%llx-%llx %4s %llx %x:%x %llu", &start, &end, perms, &offset, &dev_major, &dev_minor, &inode) != 7
       || inode != st->st_ino || dev_major != major(st->st_dev) || dev_minor != minor(st->st_dev)
       || !strstr(line, "anon_inode:[io_uring]") || end <= start) continue;
   struct ourgeo_mapping *mapping = offset == IORING_OFF_SQ_RING ? queue : offset == IORING_OFF_SQES ? entries : NULL;
   if (mapping) { mapping->start = start; mapping->size = end - start; }
 }
 fclose(maps);
 return queue->start && entries->start;
}

static bool ourgeo_ring_u32(struct tcb *tcp, struct ourgeo_mapping mapping, uint32_t offset, uint32_t *value) {
 return mapping.size >= sizeof(*value) && offset <= mapping.size - sizeof(*value)
   && tfetch_mem(tcp, mapping.start + offset, sizeof(*value), value);
}

static void ourgeo_ring_enter(struct tcb *tcp) {
 struct stat st;
 if (!ourgeo_ring_stat(tcp, tcp->u_arg[0], &st)) return;
 struct ourgeo_ring *ring = ourgeo_rings;
 while (ring && (ring->device != st.st_dev || ring->inode != st.st_ino)) ring = ring->next;
 if (!ring || !ourgeo_ring_layout(&ring->params)) return;
 struct ourgeo_mapping queue = {0}, entries = {0};
 if (!ourgeo_ring_maps(tcp, &st, &queue, &entries)) return;
 uint32_t head, tail, mask, count;
 struct io_uring_params *p = &ring->params;
 if (!ourgeo_ring_u32(tcp, queue, p->sq_off.head, &head)
     || !ourgeo_ring_u32(tcp, queue, p->sq_off.tail, &tail)
     || !ourgeo_ring_u32(tcp, queue, p->sq_off.ring_mask, &mask)
     || !ourgeo_ring_u32(tcp, queue, p->sq_off.ring_entries, &count)
     || count != p->sq_entries || mask != count - 1 || tail - head > count
     || tcp->u_arg[1] > tail - head || tcp->u_arg[1] > 4096) return;
 unsigned submitted = tcp->u_arg[1];
 struct io_uring_sqe *sqes = xcalloc(submitted ? submitted : 1, sizeof(*sqes));
 bool complete = true;
 for (unsigned i = 0; i < submitted; ++i) {
   uint32_t index = (head + i) & mask;
   if (!(p->flags & IORING_SETUP_NO_SQARRAY)
       && !ourgeo_ring_u32(tcp, queue, p->sq_off.array + index * sizeof(uint32_t), &index)) { complete = false; break; }
   if (index >= count || (uint64_t)index * sizeof(*sqes) + sizeof(*sqes) > entries.size
       || !tfetch_mem(tcp, entries.start + (uint64_t)index * sizeof(*sqes), sizeof(*sqes), &sqes[i])) { complete = false; break; }
 }
 if (complete) {
   tprintf_string(" /* ourgeo-ring:v1 entries=%u opcodes=[", submitted);
   for (unsigned i = 0; i < submitted; ++i) tprintf_string("%s%u:%u", i ? "," : "", sqes[i].opcode, sqes[i].flags);
   tprints_string("] */");
 }
 free(sqes);
}
