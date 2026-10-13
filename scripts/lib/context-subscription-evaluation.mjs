// The evaluation owns an isolated Electron process and no memory/project stores.
// Only the existing account module reads/refreshes configured credentials; OAuth
// tokens never cross the native boundary or enter reports.
import { _electron as electron } from 'playwright-core'
import executablePath from 'electron'
import { build } from 'esbuild'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function subscriptionEvaluation(directory, maximumRequests) {
  const profile = await mkdtemp(join(directory, 'subscription-'))
  const bundle = join(profile, 'account.mjs'), wrapper = join(profile, 'launch.cjs')
  const source = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ourgeo')
  await build({ entryPoints: ['electron/main/chatgpt-subscription.ts'], bundle: true, platform: 'node', format: 'esm', outfile: bundle, plugins: [{ name: 'account-only', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, args => args.namespace === 'account-only' ? { path: 'electron', external: true } : { path: 'electron', namespace: 'account-only' })
    builder.onLoad({ filter: /.*/, namespace: 'account-only' }, () => ({ contents: `import {app as nativeApp,net,safeStorage,shell} from 'electron';export const app={getPath:name=>name==='userData'?globalThis.__evaluationAccountDirectory:nativeApp.getPath(name)};export {net,safeStorage,shell};`, loader: 'js' }))
  } }] })
  await writeFile(wrapper, `globalThis.__evaluationRequire=require;const {app}=require('electron');app.setName('ourgeo');app.setPath('userData',${JSON.stringify(profile)});globalThis.__evaluationAccountDirectory=${JSON.stringify(source)};globalThis.__evaluationAccount=app.whenReady().then(()=>import(${JSON.stringify(pathToFileURL(bundle).href)}));globalThis.__evaluationCalls=0;`, { mode: 0o600 })
  const app = await electron.launch({ executablePath, args: ['--no-sandbox', wrapper] })
  try {
    const configuration = await app.evaluate(async () => {
      const account = await globalThis.__evaluationAccount, status = await account.chatGptStatus()
      if (!status.activeId || !status.planEnabled) throw new Error('Enable the configured ChatGPT subscription before evaluation.')
      const { readFile } = globalThis.__evaluationRequire('node:fs/promises'), { join } = globalThis.__evaluationRequire('node:path')
      const settings = JSON.parse(await readFile(join(globalThis.__evaluationAccountDirectory, 'ai-preferences.json'), 'utf8'))
      const model = settings.modelByProvider?.['openai-subscription']
      if (!(await account.chatGptModels()).some(item => item.id === model)) throw new Error('The configured subscription model is not currently eligible.')
      globalThis.__evaluationAccountId = status.activeId
      globalThis.__evaluationModel = model
      return { model, provider: 'openai-subscription', credentialBoundary: 'Existing native OAuth account module; no credential export or memory/project store access.' }
    })
    return { configuration, close: () => app.close(), request: async (url, init) => {
      if (url !== 'https://api.openai.com/v1/responses' || init.billing !== 'chatgpt' || init.method !== 'POST') throw new Error('Only authorised subscription Responses requests are available.')
      const payload = JSON.parse(init.body)
      if (payload.model !== configuration.model || payload.store !== false || payload.stream !== true || !Array.isArray(payload.input) || !(payload.max_output_tokens > 0 && payload.max_output_tokens <= 2048)) throw new Error('Subscription evaluation payload exceeds the bounded profile.')
      return app.evaluate(async ({ net }, { payload, maximumRequests }) => {
        if (++globalThis.__evaluationCalls > maximumRequests) throw new Error('Evaluation request allowance exhausted.')
        const account = await globalThis.__evaluationAccount
        const token = await account.chatGptRequestToken(globalThis.__evaluationAccountId)
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000)
        try {
          const response = await net.fetch('https://api.openai.com/v1/responses', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: controller.signal })
          const reader = response.body?.getReader(), decoder = new TextDecoder()
          let text = ''
          if (reader) for (;;) {
            const part = await reader.read()
            if (part.done) break
            text += decoder.decode(part.value, { stream: true })
            if (text.length > 2_000_000) throw new Error('Synthetic subscription response exceeds 2 MB.')
          }
          text += decoder.decode()
          return { ok: response.ok, status: response.status, requestId: response.headers.get('x-request-id'), text }
        } finally { clearTimeout(timer) }
      }, { payload, maximumRequests })
    } }
  } catch (error) { await app.close(); throw error }
}
