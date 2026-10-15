/* global window, document */
// Built-app export acceptance with a fresh profile; the normal user session is
// untouched. Native dialog responses are stubbed per the repository run skill.
import { waitForAsync } from './lib/wait-async.mjs'
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
const cwd=process.cwd(),require=createRequire(path.join(cwd,'package.json'))
const {_electron}=require('playwright-core')
const directory=`/tmp/ourgeo-vector-export-${Date.now()}`
await mkdir(path.join(directory,'profile'),{recursive:true})
await writeFile(path.join(directory,'profile/health-check.json'),JSON.stringify({prompted:true,report:null}))
const wrapper=path.join(directory,'main.cjs')
await writeFile(wrapper,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory,'profile'))});require(${JSON.stringify(path.join(cwd,'out/main/index.js'))});`)
const app=await _electron.launch({executablePath:path.join(cwd,'node_modules/electron/dist/electron'),args:['--no-sandbox',wrapper],cwd,env:{...process.env,R_LIBS:[path.join(cwd,'.cache/preflight-r'),process.env.R_LIBS].filter(Boolean).join(path.delimiter)},timeout:60000})
try {
  const page=await app.firstWindow();page.setDefaultTimeout(60000)
  // Playwright screenshots can wait indefinitely for a stable Electron frame
  // on this desktop (documented in the run skill). Capture the actual native
  // frame without animation/font stabilisation, then inspect the saved PNG.
  const screenshot=async name=>{
    const png=await app.evaluate(async({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.focus();return (await win.webContents.capturePage()).toPNG().toString('base64')})
    await writeFile(path.join(directory,name),Buffer.from(png,'base64'))
  }
  await waitForAsync(page, async()=>window.electronAPI.r.isReady())
  await app.evaluate(({BrowserWindow,dialog})=>{BrowserWindow.getAllWindows()[0].setSize(1280,900);globalThis.exportReviews=[];dialog.showMessageBox=async(...args)=>{globalThis.exportReviews.push(args.at(-1));return {response:1,checkboxChecked:false}}})
  const post=(action,body)=>page.evaluate(async({action,body})=>{const port=await window.electronAPI.r.getPort();return (await fetch(`http://127.0.0.1:${port}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json()},{action,body})
  const setup=await post('r/execute',{code:`if (dir.exists(${JSON.stringify(path.join(cwd,'.cache/preflight-r/s2'))})) .libPaths(c(${JSON.stringify(path.join(cwd,'.cache/preflight-r'))}, .libPaths())); export_points <- sf::st_as_sf(data.frame(key=c("01","1"),value=c(0,NA_real_),x=c(500000,500003),y=c(4100000,4100004)),coords=c("x","y"),crs=32610); export_original <- serialize(export_points,NULL)`})
  if(!setup.success)throw new Error(setup.error)
  await page.locator('[data-ourgeo-id="toolbar.environment"]').evaluate(el=>el.click())
  await page.getByText('export_points',{exact:true}).first().waitFor();await page.getByText('export_points',{exact:true}).first().click({button:'right'})
  await page.getByText('View/Edit',{exact:true}).click();await page.locator('[data-ourgeo-id="dataViewer.exportVector"]').click()
  const gpkg=path.join(directory,'points.gpkg'),geojson=path.join(directory,'points.geojson')
  await page.getByLabel('Destination file',{exact:true}).fill(gpkg)
  await page.getByRole('button',{name:/^Check (data|again)$/}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="Data checks"]')?.textContent.includes('ready'))
  await screenshot('gpkg-plan.png')
  await page.getByRole('button',{name:'Check and save',exact:true}).click();await page.getByText(/Saved and verified 2 features/).waitFor()
  if((await app.evaluate(()=>globalThis.exportReviews)).length)throw new Error('Clean GeoPackage export was buried in a warning dialog')
  await screenshot('gpkg-saved.png')
  await page.getByLabel('Export format').selectOption('geojson');await page.getByLabel('Destination file',{exact:true}).fill(geojson)
  await page.getByLabel('Coordinate decimal places').fill('7');await page.getByRole('button',{name:'Check data',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="Data checks"]')?.textContent.includes('needs confirmation'))
  await screenshot('geojson-plan.png')
  await page.getByRole('button',{name:'Check and save',exact:true}).click();await page.getByText(/Saved and verified 2 features/).waitFor()
  const reviews=await app.evaluate(()=>globalThis.exportReviews)
  if(reviews.length!==1||!reviews[0].detail.includes('RFC7946=YES')||!reviews[0].detail.includes('COORDINATE_PRECISION=7'))throw new Error('Native review omitted the effective GeoJSON profile')
  const json=JSON.parse(await readFile(geojson,'utf8'))
  if(json.features.length!==2||json.features[0].properties.key!=='01'||json.crs)throw new Error('Published GeoJSON did not have its approved row/key/CRS profile')
  const verify=await post('r/execute',{code:`readback <- sf::st_read(${JSON.stringify(gpkg)},quiet=TRUE);stopifnot(nrow(readback)==2L,identical(readback$key,c("01","1")),identical(export_original,serialize(export_points,NULL)),sf::st_crs(readback)$epsg==32610)`})
  if(!verify.success)throw new Error(verify.error)
  await page.getByLabel('Destination mode').selectOption('new')
  await page.getByRole('button',{name:/^Check (data|again)$/}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="Data checks"]')?.textContent.includes('blocked'))
  if(!await page.getByRole('button',{name:'Check and save',exact:true}).isDisabled())throw new Error('Existing-file block did not prevent saving')
  await screenshot('blocked-destination.png')
  console.log(JSON.stringify({directory,features:2,nativeReviews:reviews.length,verified:true}))
  console.log('Real Electron GeoPackage export, GeoJSON approval/recording, source preservation and destination block passed.')
} catch(error) {console.log(String(error));const page=await app.firstWindow();console.log(await page.locator('body').innerText());throw error}
finally {await app.close()}
