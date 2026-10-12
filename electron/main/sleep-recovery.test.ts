import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { createSleepRecovery, repaintWindow } from './sleep-recovery'

const windowFixture = () => {
  const state = { visible: true, minimized: false, maximized: false, destroyed: false, size: [1000, 700] }
  const win = {
    isDestroyed: () => state.destroyed, isVisible: () => state.visible,
    isMinimized: () => state.minimized, isMaximized: () => state.maximized, isFullScreen: () => false,
    getSize: () => state.size, setSize: vi.fn((width: number, height: number) => { state.size = [width, height] }),
    show: vi.fn(() => { state.visible = true }),
    webContents: { isDestroyed: () => state.destroyed, invalidate: vi.fn(), send: vi.fn(), reload: vi.fn() },
  }
  return { state, win, window: win as unknown as BrowserWindow }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
describe('application recovery after sleep', () => {
  it('repaints and reconnects without reloading the renderer or restarting surviving R', async () => {
    const fixture = windowFixture()
    const bridge = { shouldRestart: false, port: 12345, start: vi.fn() }
    const recovery = createSleepRecovery(() => fixture.window, bridge)
    recovery.suspend(); await recovery.resume()
    expect(fixture.win.webContents.send).toHaveBeenCalledWith('system:resume')
    expect(fixture.win.webContents.invalidate).toHaveBeenCalled()
    expect(fixture.win.webContents.reload).not.toHaveBeenCalled()
    expect(bridge.start).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(80)
    expect(fixture.state.size).toEqual([1000, 700])
  })
  it('restores a visible window that the desktop hid during sleep', async () => {
    const fixture = windowFixture()
    const recovery = createSleepRecovery(() => fixture.window, { shouldRestart: false, port: null, start: vi.fn() })
    recovery.suspend(); fixture.state.visible = false
    await recovery.resume()
    expect(fixture.win.show).toHaveBeenCalledOnce()
  })
  it('preserves a window the user intentionally minimized before sleep', async () => {
    const fixture = windowFixture(); fixture.state.minimized = true
    const recovery = createSleepRecovery(() => fixture.window, { shouldRestart: false, port: null, start: vi.fn() })
    recovery.suspend(); fixture.state.visible = false
    await recovery.resume()
    expect(fixture.win.show).not.toHaveBeenCalled()
    expect(fixture.win.setSize).not.toHaveBeenCalled()
  })
  it('coalesces resume and screen-unlock events while recovering a dead R process', async () => {
    const fixture = windowFixture()
    let complete!: () => void
    const bridge = { shouldRestart: true, port: 12345, start: vi.fn(() => new Promise<void>((resolve) => { complete = resolve })) }
    const recovery = createSleepRecovery(() => fixture.window, bridge)
    const resumed = recovery.resume(); const unlocked = recovery.resume()
    expect(bridge.start).toHaveBeenCalledOnce()
    complete(); await Promise.all([resumed, unlocked])
    expect(fixture.win.webContents.send.mock.calls.filter(([channel]) => channel === 'r:restarted')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(80)
    expect(fixture.state.size).toEqual([1000, 700])
  })
  it('does not restart R deliberately stopped for a repair', async () => {
    const fixture = windowFixture()
    const bridge = { shouldRestart: false, port: null, start: vi.fn() }
    await createSleepRecovery(() => fixture.window, bridge).resume()
    expect(bridge.start).not.toHaveBeenCalled()
    expect(fixture.win.webContents.send).toHaveBeenCalledWith('system:resume')
  })
  it('does not overwrite a user resize or maximized geometry after wake', async () => {
    const fixture = windowFixture()
    repaintWindow(fixture.window)
    fixture.state.size = [1200, 800]
    await vi.advanceTimersByTimeAsync(80)
    expect(fixture.state.size).toEqual([1200, 800])
    fixture.win.setSize.mockClear(); fixture.state.maximized = true
    repaintWindow(fixture.window)
    expect(fixture.win.setSize).not.toHaveBeenCalled()
  })
  it('tolerates window destruction during wake recovery', async () => {
    const fixture = windowFixture()
    let complete!: () => void
    const bridge = { shouldRestart: true, port: null, start: vi.fn(() => new Promise<void>((resolve) => { complete = resolve })) }
    const promise = createSleepRecovery(() => fixture.window, bridge).resume()
    fixture.state.destroyed = true
    complete(); await promise; await vi.advanceTimersByTimeAsync(80)
    expect(fixture.win.webContents.send).toHaveBeenCalledTimes(1)
  })
})
