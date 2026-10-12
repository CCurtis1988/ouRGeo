/* global window, document */
// Linux built/dev renderer acceptance with an isolated app profile and synthetic
// R objects. Build first; never uses or clears the normal user's app profile.
import {_electron as electron} from 'playwright-core'
import executablePath from 'electron'
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import assert from 'node:assert/strict'
const root=resolve('.'),profile=await mkdtemp(join(tmpdir(),'ourgeo-toolbox-ui-')),data=join(profile,'ourgeo')
await mkdir(data,{mode:0o700})
await writeFile(join(data,'.context-acceptance'),'synthetic-context-profile-v1\n',{mode:0o600})
await writeFile(join(data,'health-check.json'),JSON.stringify({prompted:true,report:null}))
const wrapper=join(profile,'launch.cjs')
await writeFile(wrapper,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(data)});require(${JSON.stringify(join(root,'out/main/index.js'))});`)
let server
if(process.argv.includes('--dev')) {
 const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react')
 const {version}=JSON.parse(await readFile('package.json','utf8'))
 server=await createServer({configFile:false,root:join(root,'src'),plugins:[react()],resolve:{alias:{'@':join(root,'src')}},define:{__APP_VERSION__:JSON.stringify(version)},server:{host:'127.0.0.1',port:0}})
 await server.listen()
}
const app=await electron.launch({executablePath,args:['--no-sandbox',wrapper],cwd:root,timeout:60000,env:{...process.env,OURGEO_CONTEXT_TEST_PROFILE:data,...(server?{ELECTRON_RENDERER_URL:`http://127.0.0.1:${server.httpServer.address().port}`}:{})}})
try {
 const page=await app.firstWindow();page.setDefaultTimeout(30000)
 const failed=[]
 page.on('requestfailed',r=>{if(r.url().includes('/preflight/'))failed.push({url:r.url(),failure:r.failure()})})
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus()})
 await page.waitForFunction(()=>document.body.innerText.includes('R session ready.'))
 const post=(action,body)=>page.evaluate(async({action,body})=>{
  const port=await window.electronAPI.r.getPort()
  const response=await fetch(`http://127.0.0.1:${port}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  return response.json()
 },{action,body})
 const seed=await post('r/execute',{code:`x <- sf::st_as_sf(data.frame(id=1:3,lon=c(-123,-123.0001,-123.0002),lat=c(37,37.0001,37.0002)),coords=c('lon','lat'),crs=4326)
 projected_points <- sf::st_as_sf(data.frame(id=1:3,x=c(500000,500003,500006),y=c(4100000,4100004,4100008)),coords=c('x','y'),crs=32610)
 poly <- sf::st_as_sf(data.frame(id=1,wkt='POLYGON ((500000 4100000,500010 4100000,500010 4100010,500000 4100010,500000 4100000))'),wkt='wkt',crs=32610)
 source_before <- serialize(x,NULL)`})
 assert.equal(seed.success,true,seed.error)
 await page.locator('[data-ourgeo-id="toolbar.toolbox"]').evaluate(el=>el.click())
 const field=label=>page.locator('label').filter({hasText:label}).filter({hasNot:page.locator('input')}).locator('..').locator('input').first()
 const select=async label=>{await page.getByPlaceholder('Search tools…').fill(label);await page.getByRole('button',{name:label,exact:true}).first().click()}
 const close=()=>page.getByRole('heading',{name:'Toolbox',exact:true}).locator('..').locator('button').click()
 const open=()=>page.locator('[data-ourgeo-id="toolbar.toolbox"]').evaluate(el=>el.click())
 const check=async()=>{
  await page.getByRole('button',{name:'Check data',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="Data checks"]')?.textContent.includes('ready ·'))
 }
 await select('Buffer');await field('sf Dataset').fill('x')
 assert.match(await page.locator('pre').last().innerText(),/dq_validate\(\n {2}list\(/)
 await check()
 const preview=await page.locator('pre').last().innerText()
 assert.match(preview,/S2 spherical metric/);assert.match(preview,/dist = "100"/);assert.doesNotMatch(preview,/fromJSON/)
 await page.locator('pre').last().scrollIntoViewIfNeeded()
 await page.screenshot({path:join(profile,'buffer-preview.png')})
 await page.getByRole('button',{name:'Check and run',exact:true}).click()
 await page.getByText('Done — opened in Data Viewer',{exact:true}).waitFor()
 await page.getByText('x_buffer — sf — 3 x 2',{exact:true}).waitFor()
 await close()
 await page.screenshot({path:join(profile,'buffer-result.png')})
 assert.equal((await post('r/execute',{code:'stopifnot(identical(source_before,serialize(x,NULL)),nrow(x_buffer)==3,all(sf::st_is_valid(x_buffer)))'})).success,true)
 await open();await select('Buffer');await field('sf Dataset').fill('projected_points');await check()
 assert.match(await page.locator('pre').last().innerText(),/Projected planar/)
 await page.getByRole('button',{name:'Check and run',exact:true}).click()
 await page.getByText('projected_points_buffer — sf — 3 x 2',{exact:true}).waitFor()
 await select('Area');await field('Dataset').fill('poly')
 await page.getByRole('button',{name:'Check and run',exact:true}).click()
 await page.getByText('poly_area [units]',{exact:true}).waitFor()
 const area=await post('object/vector',{name:'poly_area',envName:'.GlobalEnv'})
 assert.equal(area.success,true);assert.equal(area.totalLength,1)
 assert.equal((await post('r/execute',{code:'stopifnot(abs(as.numeric(poly_area)-100)<1e-8)'})).success,true)
 await close();await page.getByText('100',{exact:true}).first().waitFor()
 await page.screenshot({path:join(profile,'area-result.png')})
 await open()
 await select('Union (Dissolve)');await field('sf Dataset').fill('poly')
 await page.getByRole('button',{name:'Check and run',exact:true}).click()
 await page.getByText('Done — result available in Environment',{exact:true}).waitFor()
 assert.equal((await post('r/execute',{code:'stopifnot(inherits(poly_union,"sfc"),abs(as.numeric(sf::st_area(poly_union))-100)<1e-8)'})).success,true)
 assert.deepEqual(failed,[])
 assert(!await page.getByText('Network Error',{exact:false}).count())
 console.log(JSON.stringify({mode:server?'development':'built',profile,geographicBufferRows:3,projectedBufferRows:3,areaSquareMetres:100,geometryResultRetained:true,failedPreflightRequests:failed.length}))
} finally {await app.close();await server?.close()}
