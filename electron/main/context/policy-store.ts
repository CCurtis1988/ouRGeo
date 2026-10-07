import { readdir } from 'node:fs/promises'

/** A new profile has no prior disclosure choices. An unreadable or non-empty
 * protected directory is not evidence that its policy is empty. This allows
 * zero-account source retrieval without bypassing an existing encrypted policy. */
export async function protectedPolicyAbsent(directory: string): Promise<boolean> {
  try { return (await readdir(directory)).length === 0 }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}
