// Real toolbox builders and checked HTTP operations on synthetic local data.
// No package downloads or normal app-profile changes; requires installed R spatial packages.
import {spawn} from 'node:child_process'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {createConnection} from 'node:net'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
const dir=await mkdtemp(join(tmpdir(),'ourgeo-toolbox-http-'));let logs=''
const registry=join(dir,'registry.cjs')
await build({stdin:{contents:"export { CHECKED_TOOLS, toolPreflightRequest } from './src/lib/data-preflight'; export { toolList } from './src/components/toolbox/tools'",resolveDir:process.cwd()},bundle:true,alias:{'@':resolve('src')},platform:'node',format:'cjs',outfile:registry})
const {toolList,CHECKED_TOOLS:checked,toolPreflightRequest}=createRequire(import.meta.url)(registry)
const r=spawn('Rscript',[resolve('r/server.R')],{cwd:dir,env:{...process.env,OURGEO_PREFLIGHT_SECRET:'synthetic-toolbox-test'},stdio:['ignore','pipe','pipe']})
r.stdout.on('data',c=>logs+=c);r.stderr.on('data',c=>logs+=c)
const results=[]
try {
 const port=await new Promise((done,fail)=>{const t=setTimeout(()=>fail(new Error(logs)),30000);r.stdout.on('data',()=>{const m=logs.match(/OURGEO_PORT:(\d+)/);if(m&&logs.includes('OURGEO_READY')){clearTimeout(t);done(Number(m[1]))}});r.on('exit',()=>{clearTimeout(t);fail(new Error(logs))})})
 const post=async(action,body)=>{const res=await fetch(`http://127.0.0.1:${port}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!res.ok)throw new Error(`${action}: HTTP ${res.status}`);return res.json()}

 // Chromium reuses CORS-preflight connections. With body='', httpuv gzips an
 // empty 204, leaving illegal bytes that corrupt the following POST. Read the
 // actual wire response; ordinary fetch-only tests do not send OPTIONS.
 for(const action of ['selection','start','status','execute','rows','cancel']) {
  const wire=await new Promise((done,fail)=>{
   const chunks=[];const socket=createConnection({host:'127.0.0.1',port},()=>socket.write(`OPTIONS /preflight/${action} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://localhost:5173\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type\r\nAccept-Encoding: gzip\r\nConnection: close\r\n\r\n`))
   socket.setTimeout(10000,()=>socket.destroy(new Error('CORS wire response timed out')))
   socket.on('data',c=>chunks.push(c));socket.on('end',()=>done(Buffer.concat(chunks)));socket.on('error',fail)
  })
  const boundary=wire.indexOf('\r\n\r\n');assert(boundary>=0)
  assert.match(wire.subarray(0,boundary).toString(),/^HTTP\/1\.1 204 No Content/)
  assert.equal(wire.length,boundary+4,`${action}: a 204 response must end at its headers`)
  assert.doesNotMatch(wire.subarray(0,boundary).toString(),/Content-Encoding|Transfer-Encoding|Content-Length/i)
 }
 console.log('Bodyless gzip-negotiated CORS responses passed for all six checked-operation routes.')
 const init=await post('session/init',{});assert.equal(init.success,true)

 const seed=await post('r/execute',{code:`
 tab <- data.frame(key=c('A','B','C'),value=c(1,2,3),other=c(3,2,1),text=c(' a,x ','b,y','c,z'),x=c(500001,500003,500006),y=c(4100001,4100004,4100008))
 rhs <- data.frame(key=c('A','B','C'),extra=4:6)
 poly <- sf::st_as_sf(data.frame(key='A',wkt='POLYGON ((500000 4100000,500010 4100000,500010 4100010,500000 4100010,500000 4100000))'),wkt='wkt',crs=32610)
 otherpoly <- sf::st_as_sf(data.frame(key='B',wkt='POLYGON ((500005 4100000,500015 4100000,500015 4100010,500005 4100010,500005 4100000))'),wkt='wkt',crs=32610)
 pts <- sf::st_as_sf(tab,coords=c('x','y'),crs=32610)
 shifted_points <- pts;sf::st_geometry(shifted_points)<-sf::st_sfc(lapply(sf::st_geometry(pts),function(g)sf::st_point(g+c(3,4))),crs=32610)
 geographic_points <- sf::st_as_sf(data.frame(id=1:3,lon=c(-123,-123.0001,-123.0002),lat=c(37,37.0001,37.0002)),coords=c('lon','lat'),crs=4326)
 line <- sf::st_sf(geometry=sf::st_sfc(sf::st_linestring(matrix(c(500000,4100000,500003,4100004),ncol=2,byrow=TRUE)),crs=32610))
 rast <- terra::rast(nrows=10,ncols=10,xmin=500000,xmax=500010,ymin=4100000,ymax=4100010,crs='EPSG:32610');terra::values(rast)<-seq_len(100)
 rast2 <- rast;terra::values(rast2)<-101:200
 zones <- rast;terra::values(zones)<-rep(1:2,each=50)
 xyz <- as.data.frame(rast,xy=TRUE)
 original_tab <- tab; original_points <- sf::st_coordinates(pts); original_raster_values <- terra::values(rast)
 `});if(!seed.success)throw new Error(seed.error)
 const overrides={
 'filter-rows':{conds:JSON.stringify([{col:'value',op:'>',rhsType:'value',rhsVal:'1',joinOp:'AND'}])},
 'arrange':{sortcols:JSON.stringify([{col:'value',dir:'desc'}])},'rename-column':{old:'value',new:'renamed'},'mutate':{colname:'doubled',expr:'value * 2'},'sample-rows':{val:'2'},'count':{col:'key'},
 'pivot-wider':{names_from:'key',values_from:'value'},'pivot-longer':{cols:'value,other'},'freq-table':{col:'key'},'cast-type':{col:'value'},'str-replace':{col:'text',pattern:'a',replacement:'A'},'str-case':{col:'text'},'trim-ws':{col:'text'},'fill-na':{col:'value',val:'0'},'coalesce':{primary:'value',fallback:'other'},'str-detect-filter':{col:'text',pattern:'a'},'separate':{col:'text',into:'first,second'},
 'sf-buffer':{ds:'pts'},'sf-add-length':{ds:'line'},'sf-transform':{crs:'3857'},'sf-points-from-cols':{ds:'tab',xcol:'x',ycol:'y',crs:'32610'},'assign-crs':{ds:'poly',crs:'32610'},
 'geos-buffer':{ds:'pts'},'geos-distance':{ds1:'pts',ds2:'shifted_points'},'geos-voronoi':{ds:'pts'},
 'raster-project':{crs:'32610'},'raster-reclassify':{rules:'0,50,1;50,101,2'},'raster-calculator':{expr:'A + B'},'raster-subset-bands':{bands:'1'},'raster-rename-bands':{names:'elevation'},'raster-band-index':{b1:'1',b2:'1'},'raster-rasterize':{field:'value',res:'1',v:'pts'},'raster-from-xyz':{df:'xyz',crs:'32610'},'raster-write':{path:join(dir,'export.tif')}
 }
 const areaExpectations={'sf-intersection':50,'sf-difference':50,'sf-erase':50,'sf-clip':50,'sf-union-dissolve':100,'sf-union-merge':150,'geos-intersection':50,'geos-difference':50,'geos-union':100}
 for(const tool of toolList()) {
  const v={}
  for(const f of tool.fields) {
   v[f.id]=f.type==='checkbox'?(f.default?'true':'false'):f.type==='select'?f.options[0]?.value??'':f.default??(f.type==='column'?'value':'')
   if(f.type==='dataset')v[f.id]=f.filter==='raster'?(f.id==='zones'?'zones':f.id==='r2'?'rast2':'rast'):f.id==='pts'?'pts':f.id==='v'?'poly':f.id==='right'?'rhs':tool.id.startsWith('sf-')||tool.id.startsWith('geos-')?(f.id==='ds2'?'otherpoly':'poly'):'tab'
  }
  Object.assign(v,{out:`result_${tool.id.replaceAll('-','_')}`,calccrs:'native',workingCRS:'native',groupcol:'key',aggcol:'value',leftkey:'key',rightkey:'key'},overrides[tool.id])
  try {
   let res
   if(checked.has(tool.id)) {
    const req=toolPreflightRequest(tool,v)
    for(const input of req.inputs)await post('preflight/selection',{name:input.name,envName:input.envName,rows:[],version:input.selectionVersion})
    let p=await post('preflight/start',req)
    while(p.status==='checking'){await new Promise(done=>setTimeout(done,20));p=await post('preflight/status',{operationId:p.operationId})}
    if(p.status==='needs_confirmation'){const a=await post('preflight/approve',{operationId:p.operationId,fingerprint:p.validationFingerprint,secret:'synthetic-toolbox-test'});if(!a.success)throw new Error(a.error)}
    if(!['ready','needs_confirmation'].includes(p.status))throw new Error(p.error||p.issues.map(i=>i.message).join('; '))
    res=await post('preflight/execute',{operationId:p.operationId,fingerprint:p.validationFingerprint})
   } else res=await post('r/execute',{code:tool.buildCode(v)})
   if(!res.success)throw new Error(res.error)
   let check=`stopifnot(exists('${v.out}',inherits=FALSE));`
   if(tool.id in areaExpectations) check+=`stopifnot(abs(sum(as.numeric(sf::st_area(if(inherits(${v.out},'geos_geometry'))sf::st_as_sfc(${v.out})else sf::st_geometry(${v.out}))))-${areaExpectations[tool.id]})<1e-8);`
   if(tool.id==='sf-add-area')check+=`stopifnot(abs(as.numeric(${v.out}$area)-100)<1e-8);`
   if(tool.id==='sf-add-length')check+=`stopifnot(abs(as.numeric(${v.out}$length)-5)<1e-8);`
   if(tool.id==='geos-distance')check+=`stopifnot(all(abs(as.numeric(${v.out})-5)<1e-8));`
   if(['sf-buffer','geos-buffer'].includes(tool.id))check+=`stopifnot(all(abs(as.numeric(sf::st_bbox(if(inherits(${v.out},'geos_geometry'))sf::st_as_sfc(${v.out})else ${v.out}))-c(499901,4099901,500106,4100108))<1e-7));`
   if(tool.id==='filter-rows')check+=`stopifnot(identical(${v.out}$value,c(2,3)));`
   if(tool.id==='mutate')check+=`stopifnot(identical(${v.out}$doubled,c(2,4,6)));`
   if(['right-join','full-join'].includes(tool.id))check+=`stopifnot(nrow(${v.out})==3,identical(${v.out}$extra,4:6));`
   if(tool.id==='raster-aggregate')check+=`stopifnot(terra::nrow(${v.out})==5,terra::ncol(${v.out})==5);`
   if(tool.id==='raster-calculator')check+=`stopifnot(all(terra::values(${v.out})==seq(102,300,by=2)));`
   const verify=await post('r/execute',{code:check+`cat(paste(class(${v.out}),collapse='/'))`});if(!verify.success)throw new Error(verify.error)
   if(checked.has(tool.id)) {
    assert.equal(res.outputClass,verify.output.trim().split('/')[0])
    const frame=['sf','data.frame','tbl_df'].includes(res.outputClass)
    const vector=['units','numeric','integer'].includes(res.outputClass)
    if(frame||vector) {
     const view=await post(frame?'object/dataframe':'object/vector',{name:v.out,envName:'.GlobalEnv'})
     assert.equal(view.success,true,view.error)
    }
   }
   results.push({tool:tool.id,status:'pass',class:verify.output.trim()})
  } catch(e){results.push({tool:tool.id,status:'FAIL',error:e.message})}
  console.log(JSON.stringify(results.at(-1)))
 }
 // The reported default-CRS case: three geographic points, 100 metres. S2's
 // covering cells enclose the circle, so compare with pi*r^2 using a bounded
 // approximation tolerance rather than claiming an exact polygon area.
 const buffer=toolList().find(t=>t.id==='sf-buffer')
 const req=toolPreflightRequest(buffer,{...overrides['sf-buffer'],ds:'geographic_points',dist:'100',units:'m',out:'geographic_buffer',workingCRS:'native',linearize:'false',method:'s2'})
 for(const input of req.inputs)await post('preflight/selection',{name:input.name,envName:input.envName,rows:[],version:input.selectionVersion})
 let p=await post('preflight/start',req)
 while(p.status==='checking'){await new Promise(done=>setTimeout(done,20));p=await post('preflight/status',{operationId:p.operationId})}
 assert.equal(p.status,'ready',JSON.stringify(p.issues));assert.equal(p.executionPlan.method,'S2 spherical metric')
 assert.match(p.executionCode,/dist = "100"/);assert.doesNotMatch(p.executionCode,/fromJSON/)
 const result=await post('preflight/execute',{operationId:p.operationId,fingerprint:p.validationFingerprint})
 assert.equal(result.success,true,result.error);assert.equal(result.code,p.executionCode)
 assert.equal(result.outputClass,'sf')
 const numeric=await post('r/execute',{code:`stopifnot(nrow(geographic_buffer)==3,all(sf::st_is_valid(geographic_buffer)),all(!sf::st_is_empty(geographic_buffer)),all(as.numeric(sf::st_area(geographic_buffer))>pi*100^2),all(as.numeric(sf::st_area(geographic_buffer))<1.02*pi*100^2),identical(original_tab,tab),identical(original_points,sf::st_coordinates(pts)),identical(original_raster_values,terra::values(rast)))`})
 assert.equal(numeric.success,true,numeric.error)
 console.log('Three default-CRS point buffers, independent area/distance/overlay/raster expectations and source preservation passed.')
 await writeFile(join(dir,'report.json'),JSON.stringify({dir,results},null,2));console.log('Report:',join(dir,'report.json'))
 console.log('TOTAL',results.length,'FAIL',results.filter(r=>r.status==='FAIL').length)
 if(results.some(r=>r.status==='FAIL'))process.exitCode=1
}finally{r.kill('SIGTERM')}
