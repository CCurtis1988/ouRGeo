/** Playwright's waitForFunction polls a synchronous predicate. A Promise is
 * truthy even when it eventually resolves false, so IPC conditions need an
 * explicitly awaited poll. Errors remain failures unless the caller explicitly
 * recognises an expected transient. No overlapping IPC calls are started. */
export async function waitForAsync(page, predicate, argument, { timeout = 30000, polling = 100, retryError } = {}) {
  const deadline = Date.now() + timeout
  do {
    let result
    try { result = await page.evaluate(predicate, argument) }
    catch (error) { if (!retryError || !await retryError(error)) throw error }
    if (result) return result
    if (Date.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, Math.min(polling, Math.max(1, deadline - Date.now()))))
  } while (Date.now() <= deadline)
  throw new Error(`Asynchronous acceptance condition did not become true within ${timeout} ms.`)
}
