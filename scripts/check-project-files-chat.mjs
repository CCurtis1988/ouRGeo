/* global window, document */
// Actual Linux renderer + main IPC + extraction + chat transport, using only
// self-authored fixtures and a deterministic loopback Ollama server. Real-model
// visual comprehension is qualified separately by check-project-files-vision.
import { _electron as electron } from 'playwright-core'
import electronExecutable from 'electron'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, writeFile, readFile, chmod, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { jsPDF } from 'jspdf'
import { waitForAsync } from './lib/wait-async.mjs'

const linkedActions = process.argv.includes('--linked-actions')
const root = resolve(import.meta.dirname, '..'), output = join(root, '.cache/project-files-chat')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'run-')), profileRoot = join(directory, 'profile'), data = join(profileRoot, 'ourgeo'), temporary = join(directory, 'tmp')
await mkdir(data, { recursive: true, mode: 0o700 }); await chmod(data, 0o700); await mkdir(temporary)
const projectPath = join(directory, 'Chat references.ourgeoproj'), sha = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { version: 1, measuredAt: new Date().toISOString(), directory, platform: `${process.platform}-${process.arch}`, linkedActions, passed: false, checks: {}, screenshots: [], limitations: ['Deterministic loopback model verifies assembly, native image bytes and tool dispatch; real-model comprehension has a separate qualification report.', 'Native Windows/macOS and operating-system picker pointer interactions remain deferred.'] }
let app, page, activeFiles, expectedImageHash, staleResponse, serverError, activeLinkedFolderId
const requests = [], errors = []
const answer = (res, content, call) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ message: call ? { content: '', tool_calls: [{ function: call }] } : { content }, done: true, prompt_eval_count: 1100, eval_count: 30 })) }
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const part of req) raw += part
    if (req.url === '/api/show') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ capabilities: ['completion', 'vision', 'tools'], model_info: { 'gemma4.context_length': 32768 } })); return }
    if (req.url === '/api/tags') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'gemma4:e2b', size: 0 }] })); return }
    if (req.url !== '/api/chat') { res.setHeader('Content-Type', 'application/json'); res.end('{}'); return }
    const payload = JSON.parse(raw), users = payload.messages.filter(message => message.role === 'user' && !message.content.startsWith('Visual evidence ')), task = users.at(-1)?.content.match(/\bPF_[A-Z_]+\b/)?.[0]
    requests.push({ task, payload })
    const lastTool = payload.messages.filter(message => message.role === 'tool').at(-1)
    const result = lastTool?.content.startsWith('{') ? JSON.parse(lastTool.content) : undefined
    const images = payload.messages.flatMap(message => message.images ?? [])
    if (task === 'PF_IMAGE') {
      assert.equal(images.length, 1, 'A native image attachment must carry actual bytes.')
      assert.equal(sha(Buffer.from(images[0], 'base64')), expectedImageHash, 'Dispatch bytes must match the authorised main-process rendition.')
      answer(res, 'PF_IMAGE_CONFIRMED: the authorised image rendition reached the native images field.'); return
    }
    if (task === 'PF_CHAT_UPLOAD') {
      assert(JSON.stringify(payload).includes('PF_UPLOADED_REQUIREMENT: retain the original reference.'))
      answer(res, 'PF_CHAT_UPLOAD_CONFIRMED: the chat import was retrieved from the shared project library.'); return
    }
    if (['PF_CREATE_FOLDER', 'PF_RESCAN_FOLDER', 'PF_FORGET_FOLDER'].includes(task)) {
      const action = task === 'PF_CREATE_FOLDER' ? { id: 'project:createFolder', params: { parentPath: directory, name: 'Agent-created linked folder', label: 'Agent folder' } }
        : task === 'PF_RESCAN_FOLDER' ? { id: 'project:rescanFolders', params: { ids: [activeLinkedFolderId] } }
          : { id: 'project:forgetFolder', params: { id: activeLinkedFolderId } }
      if (!lastTool) { answer(res, '', { name: 'run_ui_action', arguments: action }); return }
      assert(!/^(?:Failed:|Refused:|SOURCE_UNAVAILABLE)/.test(lastTool.content), lastTool.content)
      assert(lastTool.content.includes(task === 'PF_CREATE_FOLDER' ? 'Created and linked' : task === 'PF_RESCAN_FOLDER' ? 'Local rescan requested' : 'Folder link forgotten'), lastTool.content)
      answer(res, `${task}_CONFIRMED: the approved linked-folder action completed through the production dispatcher.`); return
    }
    if (task === 'PF_STALE') { staleResponse = res; return }
    if (task === 'PF_UNRELATED') {
      assert(!JSON.stringify(payload).includes('PF_DEEP_REQUIREMENT'), 'An unrelated turn must not reload library bodies.')
      assert.equal(images.length, 0, 'An earlier image must not be replayed as a persistent payload.')
      answer(res, 'PF_UNRELATED_CONFIRMED: ordinary conversation required no fresh library evidence.'); return
    }
    if (['PF_TEXT', 'PF_PDF', 'PF_PDF_VISUAL', 'PF_EXCLUDED', 'PF_LINKED_TEXT'].includes(task)) {
      const query = task === 'PF_LINKED_TEXT' ? 'PF_LINKED_REQUIREMENT' : task === 'PF_TEXT' ? 'PF_DEEP_REQUIREMENT' : task === 'PF_EXCLUDED' ? 'PF_CHANGED_REQUIREMENT' : 'PF_PDF_SECOND'
      if (!result) { answer(res, '', { name: 'context_search', arguments: { query, kinds: ['document'], group: 'project-files' } }); return }
      if (result.results) {
        if (task === 'PF_EXCLUDED') { assert.equal(result.results.length, 0, 'Excluded source must not appear in content search.'); answer(res, 'PF_EXCLUSION_CONFIRMED: the excluded project file was unavailable.'); return }
        assert(result.results.length > 0, `Deep content search found no ${task} evidence.`)
        answer(res, '', { name: 'context_read', arguments: { ref: result.results[0].ref, ...(task === 'PF_PDF_VISUAL' ? { location: { kind: 'pdf', page: 2 }, visual: true } : {}) } }); return
      }
      assert.equal(result.status, 'ok', `Context read failed: ${JSON.stringify(result)}`)
      assert(result.citation?.startsWith('ourgeo-project-file:'), 'Read must return an immutable portable citation.')
      if (task === 'PF_LINKED_TEXT') { assert(result.content.includes('PF_LINKED_REQUIREMENT: keep this original on disk.')); answer(res, `PF_LINKED_TEXT_CONFIRMED: current linked evidence was read. [Linked requirement](${result.citation})`); return }
      if (task === 'PF_TEXT') { assert(result.content.includes('PF_DEEP_REQUIREMENT: minimum freeboard is 0.6 m.')); answer(res, `PF_TEXT_CONFIRMED: minimum freeboard is 0.6 m. [Project drainage requirement](${result.citation})`); return }
      if (task === 'PF_PDF_VISUAL') { assert.equal(images.length, 1); assert(Buffer.from(images[0], 'base64').subarray(1, 4).equals(Buffer.from('PNG'))); answer(res, `PF_PDF_VISUAL_CONFIRMED: the selected physical page arrived as a bounded image. [Visual page two](${result.citation})`); return }
      assert(result.content.includes('PF_PDF_SECOND: retain north arrows.')); assert.equal(result.location.page, 2)
      answer(res, `PF_PDF_CONFIRMED: retain north arrows. [PDF physical page two](${result.citation})`); return
    }
    throw new Error(`Unexpected fixture task: ${task}`)
  } catch (error) { serverError = error; res.statusCode = 500; answer(res, `Fixture failure: ${error.message}`) }
})
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
await writeFile(join(data, '.context-acceptance'), 'synthetic-context-profile-v1\n', { mode: 0o600 })
await writeFile(join(data, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
await writeFile(join(data, 'ai-preferences.json'), JSON.stringify({ provider: 'ollama', modelByProvider: { ollama: 'gemma4:e2b' }, webAccessEnabled: false, autopilotWarningDismissed: true }))
await writeFile(join(data, 'api-keys.json'), JSON.stringify({ ollama_url: `http://127.0.0.1:${server.address().port}`, ollama_ctx: '32768' }))
await writeFile(join(profileRoot, 'launch.cjs'), `const {app}=require('electron');app.setPath('userData',${JSON.stringify(data)});require(${JSON.stringify(join(root, 'out/main/index.js'))});`)
const click = locator => locator.evaluate(element => element.click())
async function library() { return page.evaluate(async () => window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)) }
async function menu(label) { await click(page.locator('[data-ourgeo-id="project.dropdown"]')); await click(page.getByRole('button', { name: label, exact: true })) }
async function shot(name) { const path = join(directory, `${name}.png`); await page.screenshot({ path, animations: 'disabled' }); report.screenshots.push(path) }
async function send(text, marker) {
  await page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)').fill(text)
  await click(page.getByRole('button', { name: 'Send', exact: true }))
  if (marker) await page.getByText(marker, { exact: false }).first().waitFor({ timeout: 60_000 })
  if (marker) await page.getByRole('button', { name: 'Send', exact: true }).waitFor({ timeout: 30_000 })
  if (serverError) throw serverError
}
async function selectFile(file) {
  await menu('Project Files')
  const closeDetails = page.getByRole('button', { name: /Back to project files|Close file details/ })
  if (await closeDetails.count()) await click(closeDetails)
  await page.getByRole('listbox', { name: 'Project files' }).getByRole('option').filter({ hasText: file.name }).evaluate(element => element.click())
  const preview = page.getByRole('button', { name: 'Preview / details', exact: true })
  if (await preview.count()) await click(preview)
}
try {
  const mdPath = join(directory, 'Drainage report.md'), pdfPath = join(directory, 'Figure standard.pdf'), imagePath = join(root, 'tests/fixtures/project-files/visual-reference.png'), replacementPath = join(directory, 'Revised drainage report.md')
  await writeFile(mdPath, '# Project report\n' + Array.from({ length: 180 }, (_, index) => `General reference line ${index + 1}.`).join('\n') + '\n\n## Drainage\nPF_DEEP_REQUIREMENT: minimum freeboard is 0.6 m.\n')
  await writeFile(replacementPath, '# Revised report\nPF_CHANGED_REQUIREMENT: minimum freeboard is 0.8 m.\n')
  const pdf = new jsPDF(); pdf.text('Figure standard: labelled axes.', 20, 20); pdf.addPage(); pdf.text('PF_PDF_SECOND: retain north arrows.', 20, 20)
  await writeFile(pdfPath, Buffer.from(pdf.output('arraybuffer')))
  app = await electron.launch({ executablePath: electronExecutable, args: ['--no-sandbox', join(profileRoot, 'launch.cjs')], cwd: root, env: { ...process.env, TMPDIR: temporary, XDG_CONFIG_HOME: profileRoot, OURGEO_CONTEXT_TEST_PROFILE: await realpath(data) }, timeout: 60_000 })
  app.process().stderr.on('data', chunk => { void writeFile(join(directory, 'stderr.log'), chunk, { flag: 'a' }) })
  page = app.windows().find(window => !window.url().startsWith('devtools:')) ?? await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForSelector('[data-ourgeo-id="project.dropdown"]', { timeout: 60_000 })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), resolve(data))
  await app.evaluate(({ BrowserWindow, session }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({ width: 1440, height: 1000 })
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(details.url).hostname) }))
  })
  const onboarding = page.getByRole('button', { name: 'Maybe later', exact: true }); if (await onboarding.count()) await click(onboarding)
  await page.waitForFunction(() => document.querySelector('[data-ourgeo-id="project.dropdown"]')?.title === 'R connected', undefined, { timeout: 60_000 })
  await app.evaluate(({ dialog }, paths) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.projectPath }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths.files }) }, { projectPath, files: [mdPath, pdfPath, imagePath] })
  await menu('Project Files'); await click(page.locator('[data-ourgeo-id="projectFiles.add"]'))
  await waitForAsync(page, async () => { const files = (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files; return files.length === 3 && files.every(file => !['queued', 'indexing'].includes(file.status)) }, undefined, { timeout: 90_000 })
  activeFiles = (await library()).files
  const markdown = activeFiles.find(file => file.name === 'Drainage report.md'), pdfFile = activeFiles.find(file => file.name === 'Figure standard.pdf'), image = activeFiles.find(file => file.name === 'visual-reference.png')
  assert(markdown && pdfFile && image)
  await selectFile(image)
  const rendition = await page.evaluate(async id => { const lease = await window.electronAPI.context.lease(); const file = (await window.electronAPI.projectFiles.catalogue(lease.id)).files.find(file => file.id === id); return window.electronAPI.projectFiles.preview(id, file.revision, lease.id) }, image.id)
  expectedImageHash = sha(Buffer.from(rendition.url.split(',')[1], 'base64'))
  const aiButton = page.locator('[data-ourgeo-id="toolbar.ai"]')
  if (await page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)').count()) await click(aiButton)
  assert.equal(await page.getByPlaceholder('Message… (Enter to send, Shift+Enter for new line)').count(), 0)
  await click(page.locator('[data-ourgeo-id="projectFiles.attach"]'))
  await page.getByRole('button', { name: /^Staged: visual-reference.png/ }).waitFor()
  report.checks.attachOpensHiddenAssistant = true; console.log("chat acceptance: hidden assistant attachment staged")
  await send('PF_IMAGE: inspect the attached reference figure.', 'PF_IMAGE_CONFIRMED')
  await shot('native-image-delivery')
  report.checks.authorisedNativeImageBytes = true; console.log("chat acceptance: native image bytes confirmed")
  await send('PF_TEXT: find the project drainage criterion.', 'PF_TEXT_CONFIRMED')
  await click(page.getByRole('button', { name: 'Project drainage requirement', exact: true }))
  await page.getByRole('region', { name: 'Details for Drainage report.md' }).waitFor()
  report.checks.deepTextSearchReadAndCitation = true; console.log("chat acceptance: deep text and citation confirmed")
  await send('PF_PDF: find the second-page figure rule.', 'PF_PDF_CONFIRMED')
  await click(page.getByRole('button', { name: 'PDF physical page two', exact: true }))
  await page.getByRole('img', { name: 'Figure standard.pdf, page 2', exact: true }).waitFor({ timeout: 45_000 })
  report.checks.pdfCitationCorrectPhysicalPage = true; console.log("chat acceptance: PDF page citation confirmed")
  await page.getByRole('img', { name: 'Figure standard.pdf, page 2', exact: true }).scrollIntoViewIfNeeded()
  await shot('pdf-citation-page-two')
  await send('PF_PDF_VISUAL: inspect the appearance of physical page two.', 'PF_PDF_VISUAL_CONFIRMED')
  report.checks.pdfPageTypedImageDelivery = true; console.log("chat acceptance: PDF visual delivery confirmed")
  await send('PF_UNRELATED: explain the R assignment operator briefly.', 'PF_UNRELATED_CONFIRMED')
  report.checks.unrelatedTurnNoFreshLibraryBodyOrImage = true
  const uploadedPath = join(directory, 'Uploaded reference.md')
  await writeFile(uploadedPath, '# Uploaded reference\nPF_UPLOADED_REQUIREMENT: retain the original reference.\n')
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, uploadedPath)
  await click(page.locator('[data-ourgeo-id="ai.addFiles"]'))
  await page.getByRole('button', { name: /^Staged: Uploaded reference.md/ }).waitFor()
  await send('PF_CHAT_UPLOAD: read the file just added through chat.', 'PF_CHAT_UPLOAD_CONFIRMED')
  assert((await library()).files.some(file => file.name === 'Uploaded reference.md'))
  report.checks.chatImportImmediatelyReadableInSharedLibrary = true
  if (linkedActions) {
    await click(page.getByRole('button', { name: 'Autopilot OFF', exact: true }))
    await send(`PF_CREATE_FOLDER: Create a new physical folder named Agent-created linked folder inside ${directory} and link it to this project.`)
    const consent = page.getByRole('dialog', { name: 'Let the assistant do this?', exact: true })
    await consent.waitFor()
    assert((await consent.innerText()).includes('project:createFolder'))
    assert((await consent.innerText()).includes(directory))
    await consent.getByRole('button', { name: 'Allow', exact: true }).click()
    await page.getByText('PF_CREATE_FOLDER_CONFIRMED:', { exact: false }).first().waitFor({ timeout: 60_000 })
    const linked = (await library()).linkedFolders?.find(folder => folder.name === 'Agent folder')
    assert(linked)
    activeLinkedFolderId = linked.id
    const createdPath = join(directory, 'Agent-created linked folder'), keepPath = join(createdPath, 'Keep this original.md'), originalBytes = Buffer.from('# Linked evidence\nPF_LINKED_REQUIREMENT: keep this original on disk.\n')
    await writeFile(keepPath, originalBytes)
    await send('PF_RESCAN_FOLDER: Refresh the linked Agent folder.', 'PF_RESCAN_FOLDER_CONFIRMED:')
    await waitForAsync(page, async id => { const catalogue = await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id); return catalogue.linkedFolders?.find(folder => folder.id === id)?.status === 'ready' && catalogue.files.some(file => file.storage?.folderId === id && file.status === 'searchable') }, linked.id, { timeout: 60_000 })
    await send('PF_LINKED_TEXT: Read the newly scanned linked requirement.', 'PF_LINKED_TEXT_CONFIRMED:')
    report.checks.assistantCreatesPhysicalFolderWithNativeConfirmation = true
    report.checks.assistantRescansAndReadsLinkedFile = true
    await send('Forget the Agent folder link and preserve every file in its physical directory.\nPF_FORGET_FOLDER')
    await consent.waitFor()
    assert((await consent.innerText()).includes('project:forgetFolder'))
    await shot('linked-folder-forget-consent')
    await consent.getByRole('button', { name: 'Allow', exact: true }).click()
    await page.getByText('PF_FORGET_FOLDER_CONFIRMED:', { exact: false }).first().waitFor({ timeout: 60_000 })
    const after = await library()
    assert(!after.linkedFolders?.some(folder => folder.id === linked.id))
    assert(!after.files.some(file => file.storage?.folderId === linked.id))
    assert.equal(sha(await readFile(keepPath)), sha(originalBytes))
    report.checks.assistantForgetsLinkButPreservesPhysicalContents = true
    console.log('chat acceptance: assistant create/rescan/read/forget linked folder confirmed with real UI consent')
  }
  await selectFile(markdown); await click(page.locator('[data-ourgeo-id="projectFiles.attach"]'))
  await page.getByRole('button', { name: /^Staged: Drainage report.md/ }).waitFor()
  await send('PF_STALE: wait while the source is replaced.')
  const deadline = Date.now() + 30_000; while (!staleResponse && Date.now() < deadline) await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  assert(staleResponse)
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, replacementPath)
  await page.evaluate(async id => { const lease = await window.electronAPI.context.lease(); const file = (await window.electronAPI.projectFiles.catalogue(lease.id)).files.find(file => file.id === id); await window.electronAPI.projectFiles.replace(id, file.revision, lease.id) }, markdown.id)
  await page.getByText('A project file used by this response changed or was removed.', { exact: false }).waitFor({ timeout: 30_000 })
  staleResponse.end(JSON.stringify({ message: { content: 'STALE ANSWER MUST NEVER APPEAR' }, done: true })); staleResponse = undefined
  await waitForAsync(page, async id => { const file = (await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id)).files.find(file => file.id === id); return file && !['queued', 'indexing'].includes(file.status) }, markdown.id, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Project drainage requirement (Earlier version)', exact: true }).waitFor()
  assert.equal(await page.getByText('STALE ANSWER MUST NEVER APPEAR', { exact: true }).count(), 0)
  report.checks.replacementCancelsInFlightAndMarksOldCitation = true
  const removeAttachment = page.getByRole('button', { name: 'Remove attachment Drainage report.md', exact: true }); if (await removeAttachment.count()) await click(removeAttachment)
  await selectFile(markdown)
  await page.getByRole('checkbox', { name: 'Available to the assistant', exact: true }).uncheck()
  await page.getByText('Excluded from assistant discovery and reading.', { exact: false }).waitFor()
  await send('PF_EXCLUDED: find the revised drainage criterion.', 'PF_EXCLUSION_CONFIRMED')
  report.checks.exclusionBlocksLocalContentSearch = true
  await menu('Save')
  await waitForAsync(page, async () => { const catalogue = await window.electronAPI.projectFiles.catalogue((await window.electronAPI.context.lease()).id); return catalogue.revision === catalogue.savedRevision }, undefined, { timeout: 60_000 })
  const manifest = JSON.parse(new AdmZip(await readFile(projectPath)).readAsText('project.json'))
  const chats = JSON.stringify(manifest.ui.chats)
  assert(!chats.includes('data:image/')); assert(!chats.includes(rendition.url.split(',')[1])); assert(chats.includes('ourgeo-project-file:')); assert(chats.includes('projectFileReferences'))
  report.checks.portableReferencesWithoutBase64ChatPersistence = true
  report.checks.requestCounts = Object.fromEntries([...new Set(requests.map(request => request.task))].map(task => [task, requests.filter(request => request.task === task).length]))
  assert.equal(errors.length, 0, errors.join('; ')); if (serverError) throw serverError
  report.rendererErrors = errors; report.passed = true
  await shot('completed-chat-evidence')
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error)
  if (page && !page.isClosed()) { await writeFile(join(directory, 'failure.txt'), await page.locator('body').innerText()); await shot('failure').catch(() => undefined) }
  throw error
} finally {
  staleResponse?.end()
  if (app) { await page?.evaluate(() => window.electronAPI.app.confirmQuit()).catch(() => undefined); await app.close().catch(() => undefined) }
  await new Promise(resolveClose => server.close(resolveClose))
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); await writeFile(join(output, 'latest.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
}
