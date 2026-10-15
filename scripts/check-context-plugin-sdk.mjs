/* global document, window */
import { waitForAsync as pollAsync } from './lib/wait-async.mjs'
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, realpath, copyFile, readdir, chmod } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join, resolve } from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Plugin reload invalidates in-flight provider metadata even in the same
// workspace. Retry that refresh request, while retaining the actual scope guard.
async function waitForAsync(page, predicate, argument, options) {
  const initial = await page.evaluate(() => window.electronAPI.context.lease())
  return pollAsync(page, predicate, argument, { ...options, retryError: async error => {
    if (!String(error).includes('SCOPE_CHANGED')) return false
    const current = await page.evaluate(() => window.electronAPI.context.lease())
    return current.id === initial.id
  } })
}

// Built Electron, real plugin compilation and broker/tool transport. All files
// and model replies are synthetic; no paid model or user profile is opened.
const root = resolve(import.meta.dirname, '..'), { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const directory = await mkdtemp(join(tmpdir(), 'ourgeo-context-plugin-sdk-')), data = join(directory, 'profile')
const managedProfile = process.argv.includes('--managed-profile')
const localServerProfile = process.argv.includes('--local-server')
const hindsightProfile = process.argv.includes('--hindsight')
let hindsightServer, hindsightDirectory, hindsightExited
assert(!localServerProfile || managedProfile, 'Local-server acceptance needs the managed-profile fixture assets.')
if (managedProfile) {
  const catalogue = join(directory, 'catalogue.mjs')
  await build({ entryPoints: [join(root, 'electron/main/context/runtime-catalogue.ts')], outfile: catalogue, format: 'esm', platform: 'node' })
  const { MNEMOSYNE_LOCAL_CANDIDATE: candidate } = await import(pathToFileURL(catalogue).href)
  const downloads = join(data, 'memory-runtimes', 'downloads'); await mkdir(downloads, { recursive: true })
  for (const [path, archive] of [['/tmp/ourgeo-mnemosyne-python.tar.gz', candidate.python.profiles['linux-x64']], ['/tmp/ourgeo-mnemosyne-source.tar.gz', candidate.provider.archive], ['/tmp/ourgeo-mnemosyne-pyyaml.tar.gz', candidate.yaml.archive]]) await copyFile(path, join(downloads, `${archive.sha256}.tar.gz`))
}
await mkdir(join(data, 'plugins', 'sdk-reference', 'docs'), { recursive: true, mode: 0o700 })
await mkdir(join(data, 'plugins', 'sdk-dynamic'), { recursive: true, mode: 0o700 })
await mkdir(join(data, 'plugins', 'sdk-provider'), { recursive: true, mode: 0o700 })
await chmod(data, 0o700)
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
const reference = { id: 'sdk-reference', name: 'Synthetic reference plugin', version: '1.0.0', permissions: ['context-source'], context: { version: 1, required: ['sources', 'skill-sections'], skills: [{ id: 'workflow', summary: 'Synthetic SDK workflow', bodyFile: 'docs/workflow.md', sections: [{ id: 'safety', summary: 'SYNTHETIC_SECTION_CONTRACT', bodyFile: 'docs/safety.md', required: true }] }], sources: [{ id: 'reference', title: 'Synthetic SDK reference', summary: 'SYNTHETIC_REFERENCE_METRIC', bodyFile: 'docs/reference.md' }] } }
const dynamic = { id: 'sdk-dynamic', name: 'Synthetic dynamic plugin', version: '1.0.0', main: 'main.js', permissions: ['context-source'], context: { version: 1, required: ['dynamic-sources'] } }
const provider = { id: 'sdk-provider', name: 'Synthetic provider plugin', version: '1.0.0', permissions: ['memory-provider'], context: { version: 1, required: ['memory-providers'], providers: [{ id: 'lexical', label: 'Synthetic lexical profile', profileId: 'mnemosyne-lexical-v1' }, { id: 'unknown', label: 'Synthetic unknown profile', profileId: 'unreviewed-implementation' }] } }
await writeFile(join(data, 'plugins', 'sdk-provider', 'ourgeo-plugin.json'), JSON.stringify(provider))
const manifestPath = join(data, 'plugins', 'sdk-reference', 'ourgeo-plugin.json')
await writeFile(manifestPath, JSON.stringify(reference))
await writeFile(join(data, 'plugins', 'sdk-reference', 'docs', 'reference.md'), 'SYNTHETIC_REFERENCE_METRIC: use metre units for fixture buffers.')
await writeFile(join(data, 'plugins', 'sdk-reference', 'docs', 'workflow.md'), 'Synthetic SDK workflow root.')
await writeFile(join(data, 'plugins', 'sdk-reference', 'docs', 'safety.md'), 'SYNTHETIC_SECTION_CONTRACT: verify units before the synthetic action.')
await writeFile(join(data, 'plugins', 'sdk-dynamic', 'ourgeo-plugin.json'), JSON.stringify(dynamic))
await writeFile(join(data, 'plugins', 'sdk-dynamic', 'main.js'), `export function activate(ctx) {
  if (!ctx.context) throw new Error('Separate context source permission was not supplied.');
  let reads = 0;
  ctx.context.publish({ id: 'result', title: 'Synthetic SDK result', summary: 'SYNTHETIC_DYNAMIC_METRIC', revision: '1', read: async request => {
    await ctx.plugin.storage.write({ reads: ++reads, callbackKeys: Object.keys(request), contextKeys: Object.keys(ctx.context), rAvailable: Boolean(ctx.r), networkAvailable: Boolean(ctx.http) });
    return 'SYNTHETIC_DYNAMIC_METRIC: synthetic parcel buffer result in metres.';
  } });
}`)
// The old flag is deliberately insufficient for the new sharing permission.
await writeFile(join(data, 'plugins.json'), JSON.stringify({ enabled: { 'sdk-reference': true } }))
const requests = [], answers = [], errors = [], checks = []
const server = createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part
  if (req.url === '/api/tags') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'sdk-fixture', context_length: 32768 }] })); return }
  if (req.url !== '/api/chat') { res.setHeader('Content-Type', 'application/json'); res.end('{}'); return }
  const payload = JSON.parse(raw); requests.push(payload)
  const current = payload.messages.slice(payload.messages.findLastIndex(message => message.role === 'user'))
  const user = current[0].content, tool = current.filter(message => message.role === 'tool').at(-1)
  const query = user.includes('section') ? 'SYNTHETIC_SECTION_CONTRACT' : user.includes('dynamic') ? 'SYNTHETIC_DYNAMIC_METRIC' : 'SYNTHETIC_REFERENCE_METRIC'
  const evidence = tool ? JSON.parse(tool.content) : undefined
  let call, content = ''
  if (user.includes('Bootstrap')) content = 'Synthetic SDK bootstrap complete.'
  else if (!evidence) call = { name: 'context_search', arguments: { query, kinds: [user.includes('section') ? 'skill' : 'document'] } }
  else if (evidence.results?.length) call = { name: 'context_read', arguments: { ref: evidence.results[0].ref } }
  else if (evidence.content) { content = `Synthetic SDK evidence verified: ${evidence.content.includes('SECTION') ? 'section' : evidence.content.includes('DYNAMIC') ? 'dynamic' : 'reference'}.`; answers.push(evidence) }
  else content = 'No authorised plugin evidence.'
  res.setHeader('Content-Type', 'application/x-ndjson')
  res.end(JSON.stringify({ message: call ? { content: '', tool_calls: [{ function: call }] } : { content }, done: true, prompt_eval_count: 1000, eval_count: 20 }) + '\n')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
await writeFile(join(data, 'ai-preferences.json'), JSON.stringify({ provider: 'ollama', modelByProvider: { ollama: 'sdk-fixture' }, webAccessEnabled: false, autopilotWarningDismissed: true }))
await writeFile(join(data, 'api-keys.json'), JSON.stringify({ ollama_url: `http://127.0.0.1:${server.address().port}`, ollama_ctx: '32768' }))
const wrapper = join(directory, 'launch.cjs')
await writeFile(wrapper, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(data)});
globalThis.fixtureCredentialHash=()=>{const db=new(require('node:sqlite').DatabaseSync)(${JSON.stringify(join(data, 'context/canonical.sqlite'))},{readOnly:true});try{const rows=db.prepare('SELECT payload FROM memory_credentials').all();if(rows.length!==1)throw new Error('Expected one synthetic protected credential.');return require('node:crypto').createHash('sha256').update(Buffer.from(rows[0].payload)).digest('hex')}finally{db.close()}};
require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
let app, page
async function launch() {
  app = await electron.launch({ executablePath: electronExecutable, args: ['--no-sandbox', wrapper], cwd: root, env: { ...process.env, XDG_CONFIG_HOME: directory, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60000 })
  const diagnostics = []
  app.process().stderr.on('data', data => { diagnostics.push(String(data)); void writeFile(join(directory, 'electron-diagnostics.log'), diagnostics.join('')) })
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), data)
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1120, height: 900 })
  page.on('pageerror', error => errors.push(String(error)))
  await page.waitForFunction(() => document.body.innerText.includes('R session ready.'), { timeout: 30000 })
}
try {
  await launch()
  const onboarding = page.getByRole('button', { name: "Let's go", exact: true })
  if (await onboarding.count()) await onboarding.evaluate(button => button.click())
  await page.locator('[data-ourgeo-id="toolbar.ai"]').evaluate(button => button.click())
  await page.getByText('sdk-fixture', { exact: false }).first().waitFor()
  async function send(text, response) {
    await page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)').fill(text)
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Send' && !button.disabled))
    const before = await page.getByText(response, { exact: false }).count()
    await page.getByRole('button', { name: 'Send', exact: true }).evaluate(button => button.click())
    await page.getByText(response, { exact: false }).nth(before).waitFor({ timeout: 30000 })
  }
  async function manager() {
    await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(button => button.click())
    await page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'Plugins', exact: true }).click()
    await page.locator('[data-ourgeo-id="settings.plugins"]').evaluate(button => button.click())
    await page.getByRole('dialog', { name: 'Plugins', exact: true }).waitFor()
  }
  const row = name => page.getByRole('dialog', { name: 'Plugins', exact: true }).locator('div.rounded-md.border').filter({ has: page.getByText(name, { exact: true }) })
  await send('Bootstrap SDK fixture.', 'Synthetic SDK bootstrap complete.')
  await manager()
  await page.getByText('new permissions: context-source', { exact: false }).waitFor()
  assert.equal(await row(reference.name).getByRole('checkbox').isChecked(), false)
  checks.push('Legacy enablement does not grant context sharing')
  await row(reference.name).getByRole('checkbox').evaluate(input => input.click())
  await row(reference.name).locator('input:checked').waitFor()
  await row(dynamic.name).getByRole('checkbox').evaluate(input => input.click())
  await row(dynamic.name).locator('input:checked').waitFor()
  assert.deepEqual(await page.evaluate(() => window.electronAPI.context.providerContributions()), [])
  await row(provider.name).getByRole('checkbox').evaluate(input => input.click())
  await row(provider.name).locator('input:checked').waitFor()
  const offered = await page.evaluate(() => window.electronAPI.context.providerContributions())
  assert.equal(offered.length, 2)
  assert.equal(offered.find(item => item.id === 'lexical').available, true)
  assert.equal(offered.find(item => item.id === 'unknown').available, false)
  const canonical = await page.evaluate(() => window.electronAPI.context.listGlobal())
  const beforeConnections = await page.evaluate(() => window.electronAPI.context.connections())
  const blockedActivation = await page.evaluate(async item => {
    const lease = await window.electronAPI.context.lease()
    try { await window.electronAPI.context.previewContributedProvider({ pluginId: item.pluginId, id: item.id, manifestSha256: item.manifestSha256 }, 'global', lease.id); return false } catch { return true }
  }, offered.find(item => item.id === 'lexical'))
  assert.equal(blockedActivation, true)
  assert.deepEqual(await page.evaluate(() => window.electronAPI.context.connections()), beforeConnections)
  assert.deepEqual(await page.evaluate(() => window.electronAPI.context.listGlobal()), canonical)
  checks.push('Separate provider grants expose only host-reviewed implementations; enablement grants no memory access and absent runtime blocks activation')
  await page.getByText('context source sdk-dynamic:result', { exact: false }).waitFor()
  await page.screenshot({ path: join(directory, 'permissions.png') })
  await page.keyboard.press('Escape')
  await send('Retrieve reference plugin evidence.', 'Synthetic SDK evidence verified: reference.')
  await send('Retrieve dynamic plugin evidence.', 'Synthetic SDK evidence verified: dynamic.')
  await send('Retrieve skill section guidance.', 'Synthetic SDK evidence verified: section.')
  assert.equal(answers.length, 3)
  assert(answers.every(answer => answer.trust === 'untrusted'))
  assert(answers.slice(0, 2).every(answer => answer.sourceId.startsWith('document:plugin:')))
  assert.equal(answers[2].sourceId, 'skill:sdk-reference:workflow:safety')
  checks.push('Addressable skill Markdown sections reach the actual broker and model tool transport')
  const observed = JSON.parse(await readFile(join(data, 'plugin-sdk-dynamic.json'), 'utf8'))
  assert.deepEqual(observed.callbackKeys, ['signal']); assert.deepEqual(observed.contextKeys, ['publish'])
  assert.equal(observed.rAvailable, false); assert.equal(observed.networkAvailable, false)
  checks.push('Declarative Markdown and compiled dynamic sources reach broker evidence', 'Callbacks receive cancellation only; no chat, query, memory or unrelated permissions')
  await page.locator('summary').filter({ hasText: 'Context:' }).first().evaluate(element => element.click())
  const browser = page.getByRole('region', { name: 'Current context sources' }).first()
  await browser.getByRole('button', { name: 'Browse current context sources', exact: true }).click()
  await browser.getByLabel('Search current context sources').fill('SYNTHETIC_REFERENCE_METRIC')
  await browser.locator('li').filter({ hasText: 'Synthetic SDK reference' }).getByRole('button', { name: 'Exclude source', exact: true }).click()
  await send('Retrieve reference plugin evidence after exclusion.', 'No authorised plugin evidence.')
  assert.equal(answers.length, 3)
  checks.push('Source exclusion prevents later retrieval')
  let contributedRecord, retainedDatabase
  if (managedProfile) {
    await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(button => button.click())
    await page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'AI Assistant', exact: true }).click()
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    const runtime = page.getByLabel('Managed memory runtime', { exact: true })
    await runtime.locator(':scope > summary').evaluate(element => element.click())
    await runtime.getByLabel('Acknowledge experimental native memory runtime', { exact: true }).check()
    await runtime.getByRole('button', { name: 'Stage verified runtime', exact: true }).evaluate(button => button.click())
    await runtime.getByText('Mnemosyne on this device · 4.0.0b4 · ready-for-certification', { exact: true }).waitFor({ timeout: 90000 })
    const connections = page.getByLabel('Memory provider connections', { exact: true })
    await connections.locator(':scope > summary').evaluate(element => element.click())
    const profiles = page.locator('[data-ourgeo-id="context.pluginProviders"]')
    await profiles.getByText('This profile has no host-reviewed implementation on this platform.', { exact: false }).waitFor()
    await app.evaluate(({ dialog }) => { globalThis.originalProfileDialog = dialog.showMessageBox; dialog.showMessageBox = async options => options.title === 'Activate memory processing' ? { response: 0, checkboxChecked: false } : globalThis.originalProfileDialog(options) })
    await profiles.getByRole('button', { name: 'Review Synthetic lexical profile for About you', exact: true }).evaluate(button => button.click())
    await waitForAsync(page, async () => (await window.electronAPI.context.activationStatus()).some(item => item.state === 'ready'))
    assert(!(await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.state === 'active'))
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async options => options.title === 'Activate memory processing' ? { response: 1, checkboxChecked: false } : globalThis.originalProfileDialog(options) })
    await profiles.getByRole('button', { name: 'Review Synthetic lexical profile for About you', exact: true }).evaluate(button => button.click())
    await waitForAsync(page, async () => { try { return (await window.electronAPI.context.activationStatus()).some(item => item.state === 'active') } catch { return false } })
    await page.getByRole('tab', { name: 'Memory Library', exact: true }).click()
    const library = page.getByRole('dialog', { name: 'Settings' }).getByRole('region', { name: 'Memory library' })
    await library.getByRole('button', { name: 'About you', exact: true }).evaluate(button => button.click())
    await library.getByLabel('New memory').fill('SYNTHETIC_PLUGIN_APPROVED_METRIC')
    await library.getByRole('button', { name: 'Remember about you', exact: true }).evaluate(button => button.click())
    await library.getByText('SYNTHETIC_PLUGIN_APPROVED_METRIC', { exact: true }).first().waitFor()
    contributedRecord = (await page.evaluate(() => window.electronAPI.context.listGlobal())).find(record => record.statement === 'SYNTHETIC_PLUGIN_APPROVED_METRIC')
    assert(contributedRecord)
    await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
    await connections.locator(':scope > summary').evaluate(element => element.click())
    const installation = JSON.parse(await readFile(join(data, 'memory-runtimes', 'active.json'), 'utf8')), derived = join(data, 'memory-runtimes', installation.folder, 'derived')
    const deadline = Date.now() + 20000
    while (!retainedDatabase) {
      try { for (const name of await readdir(derived)) if (name.endsWith('.sqlite') && (await readFile(join(derived, name))).includes(Buffer.from(contributedRecord.id))) retainedDatabase = join(derived, name) } catch { /* Wait for the approved first snapshot. */ }
      if (Date.now() > deadline) throw new Error('Contributed provider did not acknowledge its approved synthetic update.')
      if (!retainedDatabase) await new Promise(done => setTimeout(done, 50))
    }
    await page.screenshot({ path: join(directory, 'provider-profiles.png') })
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.originalProfileDialog; delete globalThis.originalProfileDialog })
    await page.keyboard.press('Escape')
    checks.push('Contributed profile stages a pinned private runtime, cancels native approval and synchronises only after explicit scoped approval')
    if (localServerProfile) {
      await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(button => button.click())
      await page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'AI Assistant', exact: true }).click()
      await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
      const runtime = page.getByLabel('Managed memory runtime', { exact: true })
      await runtime.locator(':scope > summary').evaluate(element => element.click())
      await runtime.getByLabel('Acknowledge experimental native memory runtime', { exact: true }).check()
      await runtime.getByRole('button', { name: 'Review local server for About you', exact: true }).evaluate(button => button.click())
      await waitForAsync(page, async () => (await window.electronAPI.context.connections()).some(item => item.localServer))
      const connections = page.getByLabel('Memory provider connections', { exact: true })
      await connections.locator(':scope > summary').evaluate(element => element.click())
      await connections.getByRole('button', { name: 'Refresh provider settings', exact: true }).evaluate(button => button.click())
      const migration = connections.getByLabel('Migrate memories to Mnemosyne local server · experimental', { exact: true })
      await migration.locator(':scope > summary').evaluate(element => element.click())
      await migration.getByRole('checkbox').check()
      await app.evaluate(({ dialog }) => { globalThis.originalMigrationDialog = dialog.showMessageBox; dialog.showMessageBox = async options => ['Migrate memory provider', 'Remove old-provider copies'].includes(options.title) ? { response: 1, checkboxChecked: false } : globalThis.originalMigrationDialog(options) })
      await migration.getByRole('button', { name: 'Review migration of 1 memory', exact: true }).evaluate(button => button.click())
      await waitForAsync(page, async () => (await window.electronAPI.context.memoryMigrations()).some(item => item.state === 'ready'))
      const recalled = await page.evaluate(async () => {
        const initial = await window.electronAPI.context.lease(), deadline = Date.now() + 10000
        while (true) {
          const lease = await window.electronAPI.context.lease()
          if (lease.id !== initial.id) throw new Error('The fixture workspace changed during recall.')
          try {
            const result = await window.electronAPI.context.recallMemory({ query: 'APPROVED_METRIC', scope: 'global' }, crypto.randomUUID(), lease.id)
            if (result.status === 'ok') return result
          } catch (error) { if (!String(error).includes('SCOPE_CHANGED')) throw error }
          if (Date.now() > deadline) throw new Error('Local-server recall did not settle after migration.')
          await new Promise(done => setTimeout(done, 100))
        }
      })
      assert.equal(recalled.status, 'ok'); assert.deepEqual(recalled.hits.map(hit => hit.id), [contributedRecord.id])
      const progress = page.locator('[data-ourgeo-id="context.providerMigrations"]')
      await progress.getByRole('button', { name: 'Refresh migration progress', exact: true }).evaluate(button => button.click())
      await progress.getByRole('button', { name: 'Review removal of old-provider copies', exact: true }).evaluate(button => button.click())
      await waitForAsync(page, async () => (await window.electronAPI.context.memoryMigrations()).some(item => item.state === 'complete'))
      assert((await page.evaluate(() => window.electronAPI.context.listGlobal())).some(record => record.id === contributedRecord.id))
      await page.screenshot({ path: join(directory, 'local-server-migration.png') })
      const localConnection = (await page.evaluate(() => window.electronAPI.context.connections())).find(item => item.localServer)
      const health = await page.evaluate(id => window.electronAPI.context.probeConnection(id), localConnection.id)
      assert.equal(health.state, 'reachable')
      assert((await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.connectionId === localConnection.id && item.state === 'active'))
      checks.push('Owned local-server health uses its MCP snapshot tool and preserves unchanged scoped activation')
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.originalMigrationDialog; delete globalThis.originalMigrationDialog })
      await page.keyboard.press('Escape')
      checks.push('Native migration to authenticated local-server transport acknowledges canonical IDs, recalls through protected credentials and deletes approved old copies without deleting canonical memory')
    }
  }
  await manager()
  await row(dynamic.name).getByRole('checkbox').evaluate(input => input.click())
  await row(dynamic.name).locator('input:not(:checked)').waitFor()
  await row(provider.name).getByRole('checkbox').evaluate(input => input.click())
  await row(provider.name).locator('input:not(:checked)').waitFor()
  assert.deepEqual(await page.evaluate(() => window.electronAPI.context.providerContributions()), [])
  checks.push('Disabling a provider plugin withdraws its native registration')
  if (managedProfile) {
    const afterDisable = { ...contributedRecord, id: crypto.randomUUID(), statement: 'SYNTHETIC_PLUGIN_DISABLED_MUST_STAY_LOCAL' }
    await page.evaluate(record => window.electronAPI.context.saveGlobal(record), afterDisable)
    const oldBytes = await readFile(retainedDatabase).catch(error => { if (error.code === 'ENOENT') return Buffer.alloc(0); throw error })
    assert(!oldBytes.includes(Buffer.from(afterDisable.id)))
    await row(provider.name).getByRole('checkbox').evaluate(input => input.click())
    await row(provider.name).locator('input:checked').waitFor()
    await waitForAsync(page, async () => (await window.electronAPI.context.activationStatus()).some(item => item.state === 'paused'))
    if (!localServerProfile) assert(!(await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.state === 'active'))
    else {
      const local = (await page.evaluate(() => window.electronAPI.context.connections())).find(item => item.localServer)
      assert((await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.connectionId === local.id && item.state === 'active'))
    }
    await row(provider.name).getByRole('checkbox').evaluate(input => input.click())
    await row(provider.name).locator('input:not(:checked)').waitFor()
    checks.push('Disable pauses contributed bindings durably; re-enable requires fresh scoped approval and disabled updates stay canonical only')
  }
  await page.keyboard.press('Escape')
  await send('Retrieve dynamic plugin evidence after disable.', 'No authorised plugin evidence.')
  assert.equal(JSON.parse(await readFile(join(data, 'plugin-sdk-dynamic.json'), 'utf8')).reads, observed.reads)
  checks.push('Disable withdraws dynamic context and prevents callback invocation')
  await writeFile(manifestPath, JSON.stringify({ ...reference, version: '1.0.1', permissions: ['context-source', 'network'] }))
  await manager(); await page.getByRole('button', { name: 'Reload all', exact: true }).click()
  await page.getByText('new permissions: network', { exact: false }).waitFor()
  assert.equal(await row(reference.name).getByRole('checkbox').isChecked(), false)
  await page.screenshot({ path: join(directory, 'permission-renewal.png') })
  checks.push('Added update permissions require explicit renewed enablement')
  if (localServerProfile) {
    await page.keyboard.press('Escape')
    const local = (await page.evaluate(() => window.electronAPI.context.connections())).find(item => item.localServer)
    async function credentialHash() {
      return await app.evaluate(() => globalThis.fixtureCredentialHash())
    }
    const previousCredentialHash = await credentialHash()
    await app.close(); await launch()
    assert(!(await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.connectionId === local.id && item.state === 'active'))
    await page.evaluate(async () => { const lease = await window.electronAPI.context.lease(); return window.electronAPI.context.previewLocalServerActivation('global', lease.id, true) })
    assert(!(await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.connectionId === local.id && item.state === 'active'))
    assert.notEqual(await credentialHash(), previousCredentialHash)
    const preview = await page.evaluate(async () => { const lease = await window.electronAPI.context.lease(); return window.electronAPI.context.previewLocalServerActivation('global', lease.id, true) })
    await app.evaluate(({ dialog }) => { globalThis.fixtureDialog = dialog.showMessageBox; dialog.showMessageBox = async options => options.title === 'Activate memory processing' ? { response: 1, checkboxChecked: false } : globalThis.fixtureDialog(options) })
    try { assert.equal(await page.evaluate(ref => window.electronAPI.context.activateProvider(ref), preview.ref), true) }
    finally { await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.fixtureDialog; delete globalThis.fixtureDialog }) }
    await waitForAsync(page, async id => (await window.electronAPI.context.activationStatus()).some(item => item.connectionId === id && item.state === 'active'), local.id)
    const recalled = await page.evaluate(async () => {
      // Three short retrieval failures deliberately open the 30 s breaker.
      // Allow one recovery interval without relaxing the production deadline.
      const initial = await window.electronAPI.context.lease(), deadline = Date.now() + 45000
      let last
      while (Date.now() < deadline) {
        const lease = await window.electronAPI.context.lease()
        if (lease.id !== initial.id) throw new Error('Workspace changed during cold recall.')
        try { last = await window.electronAPI.context.recallMemory({ query: 'APPROVED_METRIC', scope: 'global' }, crypto.randomUUID(), lease.id); if (last.status === 'ok') return last }
        catch (error) { if (!String(error).includes('SCOPE_CHANGED')) throw error }
        await new Promise(done => setTimeout(done, 300))
      }
      throw new Error(`Cold recall did not recover: ${JSON.stringify(last)}`)
    })
    assert.equal(recalled.status, 'ok'); assert(recalled.hits.some(hit => hit.id === contributedRecord.id))
    checks.push('Cold app restart rotates protected server credentials, requires renewed scoped approval and recalls only previously approved current memories')
  }
  if (hindsightProfile) {
    const cache = join(root, '.cache/stage34/hindsight')
    hindsightDirectory = await mkdtemp(join(cache, 'fixture-'))
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(key)))
    hindsightServer = spawn(join(cache, 'venv/bin/python'), ['-I', '-B', join(root, 'electron/main/context/hindsight-local-server.py'), '--state', hindsightDirectory, '--postgres', join(homedir(), '.pg0/installation/18.1.0/bin/postgres')], { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    hindsightExited = once(hindsightServer, 'close')
    let output = ''
    for (const stream of [hindsightServer.stdout, hindsightServer.stderr]) stream.on('data', data => { output = (output + data).slice(-65536) })
    const deadline = Date.now() + 60000
    while (true) {
      assert.equal(hindsightServer.exitCode, null, output)
      try {
        const metadata = JSON.parse(await readFile(join(hindsightDirectory, 'server.json'), 'utf8')), namespace = crypto.randomUUID()
        const token = namespace + '.' + createHmac('sha256', await readFile(join(hindsightDirectory, 'server-secret'))).update(namespace).digest('hex')
        if ((await fetch(metadata.endpoint+'/health', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(500) })).ok) break
      } catch { /* Await the isolated schema and provider startup. */ }
      assert(Date.now() < deadline, 'Dedicated Hindsight startup did not finish. '+output)
      await new Promise(done => setTimeout(done, 100))
    }
    await app.evaluate(({ dialog }, folder) => {
      globalThis.hindsightOpen = dialog.showOpenDialog; globalThis.hindsightApproval = dialog.showMessageBox
      dialog.showOpenDialog = async options => options.title === 'Choose the dedicated Hindsight server directory' ? { canceled: false, filePaths: [folder] } : globalThis.hindsightOpen(options)
      dialog.showMessageBox = async options => ['Activate memory processing', 'Migrate memory provider', 'Remove old-provider copies'].includes(options.title) ? { response: 1, checkboxChecked: false } : globalThis.hindsightApproval(options)
    }, hindsightDirectory)
    try {
      await page.locator('[data-ourgeo-id="toolbar.settings"]').evaluate(button => button.click())
      await page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: 'AI Assistant', exact: true }).click()
      await page.getByRole('tab', { name: 'Advanced', exact: true }).click()
      const connections = page.getByLabel('Memory provider connections', { exact: true })
      await connections.locator(':scope > summary').evaluate(element => element.click())
      await connections.getByRole('button', { name: 'Review dedicated Hindsight for About you', exact: true }).evaluate(button => button.click())
      await waitForAsync(page, async () => (await window.electronAPI.context.connections()).some(item => item.localProfile === 'hindsight-local-chunks-v1'))
      const connection = (await page.evaluate(() => window.electronAPI.context.connections())).find(item => item.localProfile)
      const selected = contributedRecord?.id ?? (await page.evaluate(() => window.electronAPI.context.listGlobal()))[0]?.id
      if (selected && (await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.connectionId !== connection.id && item.state === 'active')) {
        const preview = await page.evaluate(async ({ id, selected }) => { const lease = await window.electronAPI.context.lease(); return window.electronAPI.context.previewMemoryMigration(id, [selected], lease.id) }, { id: connection.id, selected })
        assert.equal(await page.evaluate(ref => window.electronAPI.context.activateProvider(ref), preview.ref), true)
        await waitForAsync(page, async () => (await window.electronAPI.context.memoryMigrations()).some(item => item.state === 'ready'))
        const migration = (await page.evaluate(() => window.electronAPI.context.memoryMigrations())).find(item => item.state === 'ready')
        await page.evaluate(async id => { const lease = await window.electronAPI.context.lease(); return window.electronAPI.context.finishMemoryMigration(id, 'delete', lease.id) }, migration.id)
        await waitForAsync(page, async id => (await window.electronAPI.context.memoryMigrations()).some(item => item.id === id && item.state === 'complete'), migration.id)
      }
      await waitForAsync(page, async id => (await window.electronAPI.context.activationStatus()).some(item => item.connectionId === id && item.state === 'active'), connection.id)
      const record = await page.evaluate(async () => {
        const now = new Date().toISOString(), record = { id: crypto.randomUUID(), revision: 1, scope: 'global', projectId: null, category: 'finding', statement: 'SYNTHETIC_HINDSIGHT_NATIVE_METRIC', evidence: [], assertion: 'user-declared', status: 'active', supersedes: [], createdAt: now, updatedAt: now }
        await window.electronAPI.context.saveGlobal(record); return record
      })
      await waitForAsync(page, async id => {
        try { const lease = await window.electronAPI.context.lease(); const result = await window.electronAPI.context.recallMemory({ query: 'HINDSIGHT_NATIVE_METRIC', scope: 'global' }, crypto.randomUUID(), lease.id); return result.status === 'ok' && result.hits.some(hit => hit.id === id) } catch { return false }
      }, record.id, { timeout: 30000 })
      await page.screenshot({ path: join(directory, 'hindsight-profile.png') })
      const receipt = await page.evaluate(id => window.electronAPI.context.forget(id, { scope: 'global', projectId: null, sources: [] }), record.id)
      assert.equal(receipt.local, 'excluded')
      const expires = Date.now() + 20000
      while (true) {
        const files = async directory => { const entries = await readdir(directory, { withFileTypes: true }); return (await Promise.all(entries.map(async entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat() }
        const paths = await files(join(hindsightDirectory, 'postgres-data'))
        let changed = false, retained = false
        for (const path of paths) {
          try { if ((await readFile(path)).includes(Buffer.from(record.statement))) { retained = true; break } }
          catch (error) { if (error.code !== 'ENOENT') throw error; changed = true }
        }
        if (!changed && !retained) break
        assert(Date.now() < expires, 'Forgotten Hindsight plaintext remained after native deletion.')
        await new Promise(done => setTimeout(done, 100))
      }
      assert(!(await page.evaluate(() => window.electronAPI.context.listGlobal())).some(item => item.id === record.id))
      assert.equal((await page.evaluate(id => window.electronAPI.context.probeConnection(id), connection.id)).state, 'reachable')
      await page.evaluate(id => window.electronAPI.context.pauseProvider(id), connection.id)
      assert(!(await page.evaluate(() => window.electronAPI.context.activationStatus())).some(item => item.connectionId === connection.id && item.state === 'active'))
      checks.push('Native Hindsight folder verification, protected bank credentials, scoped migration, future writes, canonical recall, pause and physical plaintext deletion pass on the real pinned server')
      await writeFile(join(directory, 'hindsight-diagnostics.log'), output)
    } finally {
      await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.hindsightOpen; dialog.showMessageBox = globalThis.hindsightApproval; delete globalThis.hindsightOpen; delete globalThis.hindsightApproval })
    }
  }
  assert.deepEqual(errors, [])
  const report = { version: 1, appVersion: version, measuredAt: new Date().toISOString(), profile: directory, builtMainSha256: createHash('sha256').update(await readFile(join(root, 'out/main/index.js'))).digest('hex'), builtRendererIndexSha256: createHash('sha256').update(await readFile(join(root, 'out/renderer/index.html'))).digest('hex'), checks, modelRequests: requests.length, rendererErrors: errors, passed: true, qualification: 'Synthetic Linux SDK integration; not a provider deployment or hostile-code sandbox certificate' }
  await writeFile(join(directory, 'evidence.json'), JSON.stringify(report, null, 2))
  await writeFile(join(tmpdir(), 'ourgeo-context-plugin-sdk-evidence.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  await writeFile(join(directory, 'failure-renderer.txt'), await page?.locator('body').innerText().catch(() => '') ?? '')
  await writeFile(join(directory, 'failure.json'), JSON.stringify({ checks, error: String(error), stack: error.stack, status: await page?.evaluate(async () => ({ runtime: await window.electronAPI.context.runtimeStatus(), activation: await window.electronAPI.context.activationStatus() })).catch(() => null) }, null, 2))
  await page?.screenshot({ path: join(directory, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app?.close().catch(() => undefined)
  if (hindsightServer?.exitCode === null) { hindsightServer.kill('SIGTERM'); await hindsightExited }
  await new Promise(done => server.close(done))
}
