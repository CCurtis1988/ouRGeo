// Built Linux app, isolated profile, real package diagnostics; stops before
// approving installations, clearing objects or performing any AI inference.
import { _electron as electron } from 'playwright-core'
import executablePath from 'electron'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve('.'), profile = await mkdtemp(join(tmpdir(), 'ourgeo-s2-health-ui-')), data = join(profile, 'ourgeo')
await mkdir(data, { mode: 0o700 })
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: false, report: null }))
const wrapper = join(profile, 'launch.cjs')
await writeFile(wrapper, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(data)});require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
const app = await electron.launch({ executablePath, args: ['--no-sandbox', wrapper], cwd: root,
  timeout: 60000, env: { ...process.env, OURGEO_CONTEXT_TEST_PROFILE: data } })
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(30000)
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus() })
  await page.getByRole('button', { name: 'Confirm and run health check' }).click()
  await page.getByRole('button', { name: 'Next: R packages' }).click()
  const engine = page.getByText('S2 spherical geometry engine', { exact: true })
  await engine.waitFor({ timeout: 180000 })
  const result = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ourgeo.health-check.checkpoint')).runtime)
  assert.equal(result.s2.ok, true)
  assert.match(result.s2.detail, /three valid 100-metre/)
  assert.match(result.s2.repair, /Linux:.*bundled Abseil/)
  assert(!result.s2.library.includes('protected'), result.s2.library)
  assert.equal(result.packages.find(p => p.name === 's2').loaded, true)
  const keep = page.getByRole('button', { name: 'Keep all copies and continue' })
  if (await keep.count()) await keep.click()
  const skip = page.getByRole('button', { name: 'Skip repairs', exact: true })
  if (await skip.count()) await skip.click()
  await page.getByRole('button', { name: 'Next: System', exact: true }).waitFor()
  await engine.evaluate(el => el.scrollIntoView({ block: 'center' }))
  // Let Chromium commit the scroll before capturePage reads the compositor.
  await page.waitForTimeout(500)
  const bounds = await engine.boundingBox()
  assert(bounds && bounds.y > 140 && bounds.y < 280, JSON.stringify(bounds))
  const image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  const screenshot = join(profile, 's2-engine-health.png')
  await writeFile(screenshot, Buffer.from(image, 'base64'))
  console.log(JSON.stringify({ profile, screenshot, s2: result.s2, approvedInstallations: 0, aiRequests: 0 }))
} finally { await app.close() }
