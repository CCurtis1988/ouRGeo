/* global window, document */
// Isolated built-app acceptance check; never deletes the user's normal profile.
import { waitForAsync } from './lib/wait-async.mjs'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const cwd = process.cwd()
const require = createRequire(path.join(cwd, 'package.json'))
const { _electron } = require('playwright-core')
const dir = '/tmp/ourgeo-data-preflight'
await mkdir(dir, { recursive: true })
const dataDir = path.join(dir, `profile-${Date.now()}`)
await mkdir(dataDir, { recursive: true })
await writeFile(path.join(dataDir, 'health-check.json'), JSON.stringify({ prompted: true, report: null }))
const wrapper = path.join(dir, 'main.cjs')
await writeFile(wrapper, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(dataDir)});require(${JSON.stringify(path.join(cwd,'out/main/index.js'))});`)
const app = await _electron.launch({ executablePath: path.join(cwd, 'node_modules/electron/dist/electron'), args: ['--no-sandbox',wrapper], cwd, env: { ...process.env, R_LIBS: [path.join(cwd,'.cache/preflight-r'), process.env.R_LIBS].filter(Boolean).join(path.delimiter) }, timeout: 60000 })
try {
  const page = await app.firstWindow({ timeout: 90000 });page.setDefaultTimeout(30000)
  page.on('response',async res=>{if(res.url().includes('/preflight/')){const body=await res.json();if(body.success===false)console.log('Local fixture check:',body.error)}})
  await waitForAsync(page, async () => window.electronAPI.r.isReady())
  const post = (action,body) => page.evaluate(async ({action,body}) => {
    const port=await window.electronAPI.r.getPort()
    const response=await fetch(`http://127.0.0.1:${port}/${action}`,{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) })
    return response.json()
  },{action,body})
  const setup=await post('r/execute',{code:'survey_points <- sf::st_as_sf(data.frame(key=c("A","B"),optional=c(NA,""),x=c(500000,500003),y=c(4100000,4100004)),coords=c("x","y"),crs=32610); unknown_crs <- survey_points; sf::st_crs(unknown_crs) <- NA; join_left <- data.frame(key=c("A","B","C")); join_right <- data.frame(key=c("A","A","D"))'})
  if(!setup.success)throw new Error(setup.error)
  await page.locator('[data-ourgeo-id="toolbar.environment"]').evaluate(el=>el.click())
  await page.getByText('survey_points',{exact:true}).first().waitFor()
  await page.getByText('survey_points',{exact:true}).first().click({button:'right'})
  await page.getByText('View/Edit',{exact:true}).click()
  await page.getByRole('button',{name:'Data checks',exact:true}).click()
  await page.getByRole('button',{name:'Check data',exact:true}).click()
  await page.getByText(/Whole-source geometry: 2 valid/).waitFor()
  await page.getByRole('button',{name:'Data checks',exact:true}).waitFor()
  await page.screenshot({path:path.join(dir,'inspection.png')})
  await page.getByRole('button',{name:'Data checks',exact:true}).click()
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,900))
  await page.locator('[data-ourgeo-id="toolbar.toolbox"]').evaluate(el=>el.click())
  await page.getByPlaceholder('Search tools…').fill('Buffer')
  await page.getByPlaceholder('Search tools…').press('Enter')
  const field = label => page.locator('label').filter({hasText:label}).filter({hasNot:page.locator('input')}).locator('..').locator('input').first()
  await field('sf Dataset').fill('unknown_crs')
  await page.getByRole('button',{name:'Check data',exact:true}).click()
  await page.getByRole('button',{name:'Check and run',exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelector('[aria-label="Data checks"]')?.textContent.includes('blocked'))
  if(!await page.getByRole('button',{name:'Check and run',exact:true}).isDisabled())throw new Error('Blocked dialog offered execution')
  await page.screenshot({path:path.join(dir,'blocked-tool.png')})
  await field('sf Dataset').fill('survey_points')
  await page.getByRole('button',{name:'Check data',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="Data checks"]')?.textContent.includes('ready'))
  await page.getByRole('button',{name:'Check and run',exact:true}).click()
  await page.getByText('Done — opened in Data Viewer',{exact:true}).waitFor()
  await page.screenshot({path:path.join(dir,'ready-tool.png')})
  // Exercise the native data-validation route with the real app backend.
  let r=await post('preflight/start',{operationType:'sf-buffer',inputs:[{name:'unknown_crs'}],parameters:{dist:'100',units:'m',workingCRS:'native',out:'blocked_result'}})
  while(r.status==='checking'){await new Promise(resolve=>setTimeout(resolve,30));r=await post('preflight/status',{operationId:r.operationId})}
  if(r.status!=='blocked')throw new Error('Missing CRS was not blocked')
  const rejected=await post('preflight/execute',{operationId:r.operationId,fingerprint:r.validationFingerprint,acknowledgments:['CRS-MISSING']})
  if(rejected.success)throw new Error('Forged approval bypassed a block')
  const unknownMap=await post('spatial/geojson',{name:'unknown_crs',envName:'.GlobalEnv'})
  if(unknownMap.success||!unknownMap.error.includes('CRS'))throw new Error('Mapping assumed a missing CRS')
  const knownMap=await post('spatial/geojson',{name:'survey_points',envName:'.GlobalEnv'})
  if(!knownMap.success)throw new Error(knownMap.error)
  // Measure renderer heartbeat during a complete 8192-feature backend scan.
  await post('r/execute',{code:'large_fixture <- sf::st_sf(key=seq_len(8192),geometry=sf::st_sfc(rep(list(sf::st_point(c(500000,4100000))),8192),crs=32610))'})
  await page.evaluate(()=>{window._preflightTicks=0;window._preflightTimer=setInterval(()=>window._preflightTicks++,10)})
  const began=Date.now();r=await post('preflight/start',{operationType:'inspect',inputs:[{name:'large_fixture'}],parameters:{}})
  let partial=false
  while(r.status==='checking'){if(r.coverage.rowsChecked>0&&r.coverage.rowsChecked<8192)partial=true;await new Promise(resolve=>setTimeout(resolve,50));r=await post('preflight/status',{operationId:r.operationId})}
  const ticks=await page.evaluate(()=>{clearInterval(window._preflightTimer);return window._preflightTicks})
  if(r.status!=='ready'||r.coverage.rowsChecked!==8192||!partial||ticks<10)throw new Error(`Large inspection did not complete responsively: ${JSON.stringify({r,partial,ticks})}`)
  console.log(JSON.stringify({inspection:r.status,testedFeatures:8192,elapsedMs:Date.now()-began,rendererHeartbeatTicks:ticks,partialProgressObserved:partial}))
  await post('r/execute',{code:'cancel_fixture <- large_fixture; cancel_fixture$key[1] <- -1L'})
  r=await post('preflight/start',{operationType:'inspect',inputs:[{name:'cancel_fixture'}],parameters:{}})
  while(r.status==='checking'&&r.coverage.rowsChecked===0){await new Promise(resolve=>setTimeout(resolve,30));r=await post('preflight/status',{operationId:r.operationId})}
  if(r.status!=='checking'||r.coverage.rowsChecked>=8192)throw new Error('Cancellation fixture did not expose partial coverage')
  r=await post('preflight/cancel',{operationId:r.operationId})
  if(r.status!=='cancelled'||r.coverage.complete)throw new Error('Cancellation gave execution permission')
  console.log(JSON.stringify({cancelledFeatures:8192,checkedBeforeCancellation:r.coverage.rowsChecked,status:r.status}))
  // Real native confirmation authority, with the OS response stubbed as the
  // repository driver does for native dialogs; no fake renderer acknowledgment.
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async (...args)=>{globalThis.preflightReviewOptions=args.at(-1);return {response:1,checkboxChecked:false}}})
  r=await post('preflight/start',{operationType:'left-join',inputs:[{name:'join_left'},{name:'join_right'}],parameters:{leftkey:'key',rightkey:'key',relationship:'one-to-many',suffixLeft:'.x',suffixRight:'.y',out:'joined_fixture'}})
  while(r.status==='checking'){await new Promise(resolve=>setTimeout(resolve,30));r=await post('preflight/status',{operationId:r.operationId})}
  if(r.status!=='needs_confirmation'||r.executionPlan.joinPolicy.predictedRows!==4)throw new Error('Join plan incorrect')
  const approved=await page.evaluate(id=>window.electronAPI.preflight.review(id),r.operationId)
  if(!approved)throw new Error('Main-process review did not approve real backend plan')
  const executed=await post('preflight/execute',{operationId:r.operationId,fingerprint:r.validationFingerprint})
  if(!executed.success)throw new Error(executed.error)
  console.log('Real Electron inspection, CRS block, responsive full scan, native review and four-row join passed.')
} catch(error) { const page=await app.firstWindow();console.log(await page.locator('body').innerText());await page.screenshot({path:path.join(dir,'failure.png')});throw error } finally { await app.close() }
