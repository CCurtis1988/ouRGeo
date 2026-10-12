import { inputCapacity } from './budget'

/** A retained provider owns bytes we cannot inspect. An observed last-call
 * occupancy is a conservative starting point, never a delivery acknowledgement. */
export function retainedResume(used: number | undefined, pending: number, window: number, output: number): boolean {
  return typeof used === 'number' && Number.isFinite(used) && used > 0
    && used + pending < inputCapacity(window, output) * .7
}

export function retainedHeadroom(used: number, pending: number, window: number, output: number): number {
  return Math.max(0, inputCapacity(window, output) - used - pending)
}
