/** Loading/resetting R is not cancellable once it has reached the server.
 * Serialise workspace mutations so a late reset/load cannot affect a project
 * that a second request has already activated. A failed open releases the queue. */
export function createWorkspaceQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return operation => {
    const result = tail.then(operation)
    tail = result.catch(() => undefined)
    return result
  }
}
