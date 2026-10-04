if (dir.exists('.cache/preflight-r/s2')) .libPaths(c(normalizePath('.cache/preflight-r'),.libPaths()))
suppressPackageStartupMessages(library(sf))
library(jsonlite)
source('r/lib/util-core.R')
source('r/lib/util-env.R')
Sys.setenv(OURGEO_PREFLIGHT_SECRET='test-only-private-main-secret')
source('r/lib/data-preflight.R')
stopifnot(!exists('secret',dq_state,inherits=FALSE),!nzchar(Sys.getenv('OURGEO_PREFLIGHT_SECRET')))
broadcast_env_if_changed <- function() invisible(NULL)
point <- st_sf(key = 'A', optional = NA_character_, geometry = st_sfc(st_point(c(500000,4100000)), crs=32610))
x <- point
before <- serialize(x,NULL)
request <- list(operationType='inspect', inputs=list(list(name='x',envName='.GlobalEnv')), parameters=list())
p <- dq_validate(request)
stopifnot(p$status=='ready', identical(before,serialize(x,NULL)), p$profiles[[1]]$totalRows==1)
stopifnot(is.character(json_response(dq_public(p))$body))
cat('Preflight acceptance passed\n')
check <- function(op,params=list(),refs=list(list(name='x',envName='.GlobalEnv'))) dq_validate(list(operationType=op,inputs=refs,parameters=params))
run <- function(op,params=list(),refs=list(list(name='x',envName='.GlobalEnv'))) {
  req <- list(operationType=op,inputs=refs,parameters=params)
  report <- dq_validate(req)
  if(report$status=='blocked') {print(op);print(report$issues)}
  dq_run(req, report$validationFingerprint, vapply(Filter(function(i)i$requiresAcknowledgment,report$issues),`[[`,'','stableCode'))
}
x <- st_sf(key=c('A','B'),geometry=st_sfc(st_point(c(500000,4100000)),st_point(c(500003,4100004)),crs=32610))
y <- x[2,,drop=FALSE];x<-x[1,,drop=FALSE]
stopifnot(st_crs(x)$units_gdal=='metre')
stopifnot(abs(as.numeric(run('geos-distance',list(workingCRS='native'),list(list(name='x'),list(name='y'))))[1]-5)<1e-8)
rectangle <- function(xmin,xmax) st_polygon(list(rbind(c(xmin,4100000),c(xmax,4100000),c(xmax,4100010),c(xmin,4100010),c(xmin,4100000))))
x <- st_sf(key='A',geometry=st_sfc(rectangle(500000,500010),crs=32610))
y <- st_sf(key='B',geometry=st_sfc(rectangle(500005,500015),crs=32610))
stopifnot(abs(as.numeric(run('sf-add-area',list(workingCRS='native',colname='area'))$area)-100)<1e-8)
result <- run('sf-intersection',list(workingCRS='native'),list(list(name='x'),list(name='y')))
stopifnot(abs(as.numeric(st_area(result))-50)<1e-8)
# Native unit library, independently established conversion factors.
stopifnot(abs(as.numeric(units::set_units(units::set_units(10,'ft',mode='standard'),'m',mode='standard'))-3.048)<1e-12)
stopifnot(abs(as.numeric(units::set_units(units::set_units(10,'US_survey_foot',mode='standard'),'m',mode='standard'))-3.048006096012192)<1e-12)
no_crs <- x; st_crs(no_crs) <- NA; x <- no_crs
stopifnot(check('inspect')$status=='ready',check('sf-buffer',list(dist='100',units='m',workingCRS='native'))$status=='blocked')
original <- st_coordinates(x)
assigned <- run('assign-crs',list(crs='32610'))
stopifnot(identical(original,st_coordinates(assigned)))
x <- assigned
transformed <- run('sf-transform',list(crs='OGC:CRS84'))
stopifnot(!identical(st_coordinates(x),st_coordinates(transformed)))
custom <- st_crs('+proj=tmerc +lat_0=0 +lon_0=-123 +k=0.9996 +x_0=500000 +y_0=0 +ellps=WGS84 +units=m +no_defs')
st_crs(x) <- custom
stopifnot(is.na(st_crs(x)$epsg),check('sf-add-area',list(workingCRS='native',colname='area'))$status=='ready')
# Axis order: explicitly labelled longitude=7, latitude=52.
x <- st_sf(key='axis',geometry=st_sfc(st_point(c(7,52)),crs='OGC:CRS84'))
xy <- st_coordinates(run('sf-transform',list(crs='3857')))[1,1:2]
stopifnot(abs(xy[1]-6378137*7*pi/180)<1e-6,abs(xy[2]-6378137*log(tan(pi/4+52*pi/360)))<1e-6)
# Independent haversine radius 6371010 m; S2 buffered region covers the
# 100 m disk. Approximation bound tested at 99 and 105 metres, not exact arcs.
x <- st_sf(key='origin',geometry=st_sfc(st_point(c(0,0)),crs='OGC:CRS84'))
buf <- run('sf-buffer',list(dist='100',units='m',workingCRS='native',method='s2',maxCells='10000'))
point_at <- function(m) st_sfc(st_point(c(m/6371010*180/pi,0)),crs='OGC:CRS84')
stopifnot(lengths(st_intersects(point_at(99),buf))==1,lengths(st_intersects(point_at(105),buf))==0)
stopifnot(check('sf-buffer',list(dist='100',units='degrees',workingCRS='native'))$status=='blocked',check('sf-buffer',list(dist='100',units='m',workingCRS='native',method='planar'))$status=='blocked')
old_s2 <- sf_use_s2(); run('sf-add-area',list(workingCRS='native',colname='area')); stopifnot(identical(old_s2,sf_use_s2()))
# Invalid, empty, and non-finite are distinct and never repaired.
bow <- st_polygon(list(rbind(c(0,0),c(2,2),c(0,2),c(2,0),c(0,0))))
x <- st_sf(key=c('bad','empty','unknown'),geometry=st_sfc(bow,st_point(),st_point(c(Inf,1)),crs=32610))
before <- serialize(x,NULL); pr <- check('inspect')
stopifnot(pr$profiles[[1]]$geometry$invalid==1,pr$profiles[[1]]$geometry$empty==1,pr$profiles[[1]]$geometry$uncheckable==1,identical(before,serialize(x,NULL)),grepl('row:1',pr$issues[[1]]$boundedExamples[[1]]))
stopifnot(check('sf-add-area',list(workingCRS='native',colname='area'))$status=='blocked')
# Join outcome is established by enumerating L1->R1,R2; L2/L3 unmatched.
x <- data.frame(key=c('A','B','C'),value=1:3,row.names=c('L1','L2','L3'))
y <- data.frame(key=c('A','A','D'),value=4:6,row.names=c('R1','R2','R3'))
refs <- list(list(name='x'),list(name='y'))
jp <- list(leftkey='key',rightkey='key',relationship='many-to-one',suffixLeft='.x',suffixRight='.y')
stopifnot(check('left-join',jp,refs)$status=='blocked')
jp$relationship <- 'one-to-many'; plan <- check('left-join',jp,refs)
stopifnot(plan$status=='needs_confirmation',plan$executionPlan$joinPolicy$predictedRows==4,plan$executionPlan$joinPolicy$unmatchedLeft==2,plan$executionPlan$joinPolicy$unmatchedRight==1)
j <- run('left-join',jp,refs)
stopifnot(nrow(j)==4,identical(j$key,c('A','A','B','C')),identical(j$value.y,c(4L,5L,NA_integer_,NA_integer_)),length(attr(j,'ourgeo_trace')$left)==4)
# Null/blank/leading-zero exact semantics and deliberate many-to-many.
x <- data.frame(key=c('01','1','',NA,'A','A'),value=1:6)
y <- data.frame(key=c('1','',NA,'A','A'),value=7:11)
jp$relationship <- 'many-to-many'; plan <- check('left-join',jp,refs)
stopifnot(plan$status=='needs_confirmation',plan$executionPlan$joinPolicy$predictedRows==8,plan$executionPlan$joinPolicy$missingLeft==2)
j <- run('left-join',jp,refs)
stopifnot(is.na(j$value.y[1]),j$value.y[2]==7,is.na(j$value.y[3]),is.na(j$value.y[4]),nrow(j)==8)
y$key <- seq_len(nrow(y)); stopifnot(check('left-join',jp,refs)$status=='blocked')
y$key <- c('1','',NA,'A','A'); jp$suffixRight <- '.x';stopifnot(check('left-join',jp,refs)$status=='blocked')
x <- data.frame(group=c('a','a','b','b'),v=c(1,NA,NA,Inf),optional=NA)
sp <- list(groupcol='group',aggcol='v',fn='sum',newcol='total',missingPolicy='block')
stopifnot(check('group-summarize',sp)$status=='blocked')
sp$missingPolicy <- 'omit'; s <- run('group-summarize',sp)
stopifnot(s$total[1]==1,is.na(s$total[2]),identical(s$.used_rows,c(1L,0L)))
sp$missingPolicy <- 'propagate'; s <- run('group-summarize',sp);stopifnot(all(is.na(s$total)))
cat('Metric, geometry, join and summary acceptance passed\n')
# Async jobs, cancellation, adversarial approval, stale data and selection.
await_job <- function(req) {
  started <- dq_start(req); id <- started$operationId
  for(i in seq_len(20000)) { later::run_now(0.001);j<-dq_find(id);if(j$status!='checking')return(j) }
  stop('Async fixture did not complete')
}
request <- function(op,p=list(),refs=list(list(name='x'))) list(operationType=op,inputs=refs,parameters=p)
x <- st_sf(key='ok',geometry=st_sfc(st_point(c(500000,4100000)),crs=32610))
buffer <- request('sf-buffer',list(dist='100',units='m',workingCRS='native',out='checked_result'))
j <- await_job(buffer)
stopifnot(j$status=='ready')
x$key <- 'edited'
stopifnot(inherits(try(dq_commit(list(operationId=j$id,fingerprint=j$report$validationFingerprint)),silent=TRUE),'try-error'),!exists('checked_result'))
j<-await_job(buffer);j$status<-'cancelled'
stopifnot(inherits(try(dq_commit(list(operationId=j$id,fingerprint=j$report$validationFingerprint)),silent=TRUE),'try-error'))
x <- st_transform(x,4326)
buffer$parameters$workingCRS <- '32610'
j<-await_job(buffer);stopifnot(j$status=='needs_confirmation')
stopifnot(inherits(try(dq_commit(list(operationId=j$id,fingerprint=j$report$validationFingerprint,acknowledgments=lapply(j$report$issues,`[[`,'stableCode'))),silent=TRUE),'try-error'))
stopifnot(inherits(try(dq_approve(list(operationId=j$id,fingerprint=j$report$validationFingerprint,secret='invented')),silent=TRUE),'try-error'))
test_review_secret<-'test-only-private-main-secret'
stopifnot(dq_approve(list(operationId=j$id,fingerprint=j$report$validationFingerprint,secret=test_review_secret)))
result <- dq_commit(list(operationId=j$id,fingerprint=j$report$validationFingerprint))
stopifnot(result$success,exists('checked_result'),grepl('32610',result$code),grepl('workingCRS',result$code),!grepl(test_review_secret,result$code))
# Reusing the identical plan before execution does not repeat consent.
rm(checked_result)
j<-await_job(buffer);stopifnot(j$approved)
# Parameter changes cannot borrow an earlier fingerprint.
changed<-buffer;changed$parameters$dist<-'200';k<-await_job(changed)
stopifnot(k$report$validationFingerprint!=j$report$validationFingerprint,!k$approved)
# Exclusions carry complete local identities; excluding everything blocks.
x<-st_sf(key=c('bad','ok'),geometry=st_sfc(st_point(),st_point(c(-123,37)),crs=4326))
refs<-list(list(name='x',excludedRows=list(0),exclusionReason='Empty survey row'))
j<-await_job(request('sf-buffer',list(dist='100',units='m',workingCRS='native',out='exclusion_result'),refs))
stopifnot(j$status=='needs_confirmation',length(j$report$rowRecords[['x::.GlobalEnv:excluded']])==1)
refs[[1]]$excludedRows<-list(0,1)
stopifnot(dq_validate(request('sf-buffer',list(dist='100',units='m',workingCRS='native'),refs))$status=='blocked')
# Transform loss: invalid latitude cannot produce an apparently successful empty.
x<-st_sf(key='lost',geometry=st_sfc(st_point(c(0,100)),crs='OGC:CRS84'))
stopifnot(inherits(try(dq_transform(x,3857),silent=TRUE),'try-error'))
# Different projected inputs require an explicit working CRS.
x<-st_sf(key='A',geometry=st_sfc(st_point(c(500000,4100000)),crs=32610));y<-st_transform(x,3857)
stopifnot(dq_validate(request('sf-intersection',list(workingCRS='native'),list(list(name='x'),list(name='y'))))$status=='blocked')
# Output/export absence is honestly blocked, never a passed driver badge.
stopifnot(dq_validate(request('export-gpkg'))$status=='blocked',dq_validate(request('export-geojson',list(precision='7')))$status=='blocked')
# Selection revision is checked at execution, not just at button enablement.
refs<-list(list(name='x',rows=list(0),selectionVersion=1))
assign('x::.GlobalEnv',list(version=1,rows=list(0)),dq_state$selections)
j<-await_job(request('sf-add-area',list(workingCRS='native',colname='area',out='selection_result'),refs))
assign('x::.GlobalEnv',list(version=2,rows=list()),dq_state$selections)
stopifnot(inherits(try(dq_commit(list(operationId=j$id,fingerprint=j$report$validationFingerprint)),silent=TRUE),'try-error'),!exists('selection_result'))
# Chunked inspection yields progress and a cancellable state; no new result.
x<-st_sf(key=seq_len(8192),geometry=st_sfc(rep(list(st_point(c(500000,4100000))),8192),crs=32610))
start<-dq_start(request('inspect'));j<-dq_find(start$operationId)
later::run_now(0.005);stopifnot(j$status=='checking',j$checked>0,j$checked<8192)
j$status<-'cancelled';checked<-j$checked;later::run_now(0.01);stopifnot(j$checked==checked,j$status=='cancelled')
cat('Authority, revision, cancellation and missing export integration acceptance passed\n')

# Row indices are identities: fractional values must never be truncated.
stopifnot(inherits(try(dq_inputs(request('inspect',refs=list(list(name='x',rows=list(0.5))))),silent=TRUE),'try-error'))
cat('Strict source-row identity acceptance passed\n')

# Preserve the existing geos engine/output rather than silently substituting sf
# cross-product overlay semantics. A declared CRS survives the native wrapper.
x<-st_sf(key='A',geometry=st_sfc(rectangle(500000,500010),crs=32610))
y<-st_sf(key='B',geometry=st_sfc(rectangle(500005,500015),crs=32610))
g<-run('geos-intersection',list(workingCRS='native'),list(list(name='x'),list(name='y')))
stopifnot(inherits(g,'geos_geometry'),abs(geos::geos_area(g)-50)<1e-8)
z<-geos::as_geos_geometry(x)
stopifnot(check('inspect',refs=list(list(name='z')))$profiles[[1]]$crs$known)
cat('Native geos engine acceptance passed\n')

# A failed/NA validity result is uncheckable, never a passed geometry check.
x<-st_sf(key='arc',geometry=st_as_sfc('CIRCULARSTRING (0 0,1 1,2 0)',crs=32610))
p<-check('inspect');stopifnot(p$profiles[[1]]$geometry$uncheckable==1,p$profiles[[1]]$geometryCheck=='check_failed')
original<-st_as_text(st_geometry(x));source_before<-serialize(x,NULL)
a<-run('assign-crs',list(crs='32610'))
stopifnot(identical(original,st_as_text(st_geometry(a))),identical(source_before,serialize(x,NULL)))
x<-st_sf(key='z',geometry=st_sfc(st_point(c(500000,4100000,7)),crs=32610))
stopifnot(check('inspect')$profiles[[1]]$dimensions[[1]]=='XYZ',check('sf-buffer',list(dist='10',units='m',workingCRS='native'))$status=='blocked')
x<-st_sf(key='zero',value=0,optional=NA_real_,geometry=st_sfc(st_point(c(500000,4100000)),crs=32610))
stopifnot(check('inspect')$profiles[[1]]$fields[[2]]$nullCount==0,check('sf-buffer',list(dist='10',units='m',workingCRS='native'))$status=='ready')
suppressPackageStartupMessages(library(sfarc))
exact<-run('sf-buffer',list(dist='10',units='m',workingCRS='native'))
stopifnot(grepl('CURVE|CIRCULAR',as.character(st_geometry_type(exact))[1]),grepl('sfarc exact',attr(exact,'ourgeo_validation')$executionPlan$method))
approx<-run('sf-buffer',list(dist='10',units='m',workingCRS='native',linearize='TRUE',nquadsegs='30'))
stopifnot(as.character(st_geometry_type(approx))[1]=='POLYGON',any(grepl('GEO-APPROXIMATION',unlist(attr(approx,'ourgeo_validation')$acknowledgments))))
# Engine settings survive geographic success, transform failure and chunk cancellation.
suppressMessages(sf_use_s2(FALSE));old_axis<-st_axis_order();old_network<-Sys.getenv('PROJ_NETWORK',unset=NA_character_)
x<-st_sf(key='g',geometry=st_sfc(st_point(c(0,0)),crs='OGC:CRS84'))
invisible(run('sf-buffer',list(dist='100',units='m',workingCRS='native',method='s2')))
stopifnot(!sf_use_s2(),identical(old_axis,st_axis_order()))
x<-st_sf(key='bad',geometry=st_sfc(st_point(c(0,100)),crs='OGC:CRS84'))
invisible(try(dq_transform(x,3857),silent=TRUE))
stopifnot(!sf_use_s2(),identical(old_axis,st_axis_order()),identical(old_network,Sys.getenv('PROJ_NETWORK',unset=NA_character_)))
x<-st_sf(key=1:256,geometry=st_sfc(rep(list(st_point(c(0,0))),256),crs='OGC:CRS84'))
j<-dq_find(dq_start(request('inspect'))$operationId);later::run_now(0.001);j$status<-'cancelled';later::run_now(0.01)
stopifnot(!sf_use_s2());suppressMessages(sf_use_s2(TRUE))
# Exact matching when both sides contain only missing/blank keys.
x<-data.frame(key=c(NA_character_,''));y<-data.frame(key=c(NA_character_,''))
jp<-list(leftkey='key',rightkey='key',relationship='one-to-one')
j<-run('left-join',jp,list(list(name='x'),list(name='y')));stopifnot(nrow(j)==2,all(is.na(attr(j,'ourgeo_trace')$right)))
# Recorded R replays the actual policy for the same unchanged source revision.
j<-await_job(request('left-join',c(jp,list(out='recorded_join')),list(list(name='x'),list(name='y'))))
dq_approve(list(operationId=j$id,fingerprint=j$report$validationFingerprint,secret=test_review_secret))
r<-dq_commit(list(operationId=j$id,fingerprint=j$report$validationFingerprint));before<-recorded_join;rm(recorded_join)
eval(parse(text=r$code));stopifnot(identical(before,recorded_join))
cat('Curves, dimensions, engine restoration and recording acceptance passed\n')
# Native database identities: deliberately unordered PKs, installed spatial
# extension only. No extension installation or network access is requested.
source('r/lib/db-core.R')
con<-DBI::dbConnect(duckdb::duckdb());DBI::dbExecute(con,'LOAD spatial')
DBI::dbExecute(con,'CREATE TABLE fixture (_rgeo_rowid INTEGER, key VARCHAR, geometry GEOMETRY)')
DBI::dbExecute(con,"INSERT INTO fixture VALUES (20,'B',ST_Point(500003,4100004)),(10,'A',ST_Point(500000,4100000))")
meta<-list(con=con,geometry_column='geometry',table_name='fixture',pk_column='_rgeo_rowid',crs='EPSG:32610',kind='sf',name='fixture')
x<-.rgeo_materialize_sf(meta,keep_identity=TRUE)
stopifnot(identical(x[['_rgeo_rowid']],c(10L,20L)),grepl(':pk:10',dq_ids(x,list(name='fixture'))[1]))
legacy<-.rgeo_materialize_sf(meta);stopifnot(!'_rgeo_rowid' %in% names(legacy))
DBI::dbDisconnect(con,shutdown=TRUE)
cat('Installed DuckDB materialisation identity acceptance passed\n')

# A full factor join cannot quietly turn a right-only key into NA.
x<-data.frame(key=factor(c('A','B')));y<-data.frame(key=factor(c('A','D')))
stopifnot(check('full-join',list(leftkey='key',rightkey='key',relationship='one-to-one'),list(list(name='x'),list(name='y')))$status=='blocked')
# Attribute joins preserve native left geometry, including legitimate expansion.
x<-st_sf(key=c('A','B','C'),geometry=st_sfc(rep(list(st_point(c(500000,4100000))),3),crs=32610))
y<-data.frame(key=c('A','A','D'),other=1:3)
j<-run('left-join',list(leftkey='key',rightkey='key',relationship='one-to-many'),list(list(name='x'),list(name='y')))
stopifnot(inherits(j,'sf'),nrow(j)==4,all(st_is_valid(j)),identical(as.character(j$key),c('A','A','B','C')))
# Explicit assignment can resolve a declared geographic CRS on known metre
# coordinates; it never transforms from that implausible declaration.
st_crs(x)<-4326;before<-st_as_text(st_geometry(x));a<-run('assign-crs',list(crs='32610'))
stopifnot(identical(before,st_as_text(st_geometry(a))),st_crs(a)$epsg==32610)
# Exact curves cannot silently cross a projection in this strict V1 plan.
x<-st_sf(key='point',geometry=st_sfc(st_point(c(-123,37)),crs=4326))
stopifnot(check('sf-buffer',list(dist='100',units='m',workingCRS='32610',linearize='false'))$status=='blocked')
stopifnot(check('sf-buffer',list(dist='100',units='m',workingCRS='32610',linearize='true'))$status=='needs_confirmation')
cat('Field/key preservation and explicit transformation limits acceptance passed\n')

# A stale affected-row record cannot select a different current input revision.
j<-await_job(request('inspect'));x$key<-'edited-after-check'
r<-jsonlite::fromJSON(handle_preflight('rows',list(operationId=j$id,reference='x::.GlobalEnv:included'))$body)
stopifnot(!r$success,r$status=='failed',grepl('revision changed',r$error))
cat('Stale affected-row record acceptance passed\n')

# Unparseable metadata stays attribute-inspectable and is never a spatial CRS.
x<-st_sf(key='malformed',geometry=st_sfc(st_point(c(500000,4100000)),crs=32610))
attr(x$geometry,'crs')<-structure(list(input='broken declaration',wkt='not a CRS'),class='crs')
p<-suppressWarnings(check('inspect'))
stopifnot(p$status=='ready',!p$profiles[[1]]$crs$known)
stopifnot(suppressWarnings(check('sf-buffer',list(dist='100',units='m',workingCRS='native')))$status=='blocked')
cat('Unparseable CRS attribute inspection acceptance passed\n')

# A direct handler cannot silently ignore additional inputs or invent a missing
# binary input. It must use the same supported operation contract as the GUI.
x<-point;y<-point
stopifnot(check('sf-buffer',list(dist='10',units='m'),list(list(name='x'),list(name='y')))$status=='blocked')
stopifnot(check('sf-intersection',refs=list(list(name='x')))$status=='blocked')
cat('Controlled input arity acceptance passed\n')
# Environment variables alone do not control an already-created PROJ context.
# Observe the engine at transform entry; restore the user's enabled setting.
old_proj_network<-sf::sf_proj_network();dq_transform_network_seen<-NA
trace('st_transform',where=asNamespace('sf'),tracer=function(){dq_transform_network_seen<<-sf::sf_proj_network()},print=FALSE)
sf::sf_proj_network(TRUE)
invisible(dq_transform(point,3857))
untrace('st_transform',where=asNamespace('sf'))
stopifnot(identical(dq_transform_network_seen,FALSE),sf::sf_proj_network())
sf::sf_proj_network(old_proj_network)
cat('Installed-resource PROJ context policy acceptance passed\n')

# A controlled result cannot overwrite validation authority or record invalid R.
x<-point
stopifnot(check('sf-buffer',list(dist='10',units='m',out='dq_state'))$status=='blocked')
stopifnot(check('sf-buffer',list(dist='10',units='m',out='.GlobalEnv'))$status=='blocked')
stopifnot(check('sf-buffer',list(dist='10',units='m',out='.1'))$status=='blocked')
cat('Controlled output name preservation acceptance passed\n')

# Geographic is not synonymous with degrees: EPSG:4807 declares grads. Never
# send its raw numbers to a degree-based spherical metric/validity path.
x<-st_sf(key='grad',geometry=st_sfc(st_point(c(0,50)),crs=4807))
stopifnot(st_crs(x)$units_gdal=='grad')
p<-check('inspect');stopifnot(p$status=='ready',p$profiles[[1]]$crs$known,p$profiles[[1]]$geometry$uncheckable==1)
stopifnot(check('sf-buffer',list(dist='100',units='m',workingCRS='native'))$status=='blocked')
cat('Declared angular coordinate unit guard acceptance passed\n')

# Non-finite geometry does not prohibit an unrelated attribute join; it is
# carried unchanged and still blocks subsequent spatial analysis.
x<-st_sf(key='A',geometry=st_sfc(st_point(c(Inf,4100000)),crs=32610));y<-data.frame(key='A',v=1)
j<-run('left-join',list(leftkey='key',rightkey='key',relationship='one-to-one'),list(list(name='x'),list(name='y')))
stopifnot(nrow(j)==1,is.infinite(st_coordinates(j)[1,1]))
# A failure invalidates the backend job, not merely a renderer button.
x<-point
job<-await_job(request('sf-buffer',list(dist='10',units='m',out='never_created')))
x$key<-'edited-before-commit'
invisible(try(dq_commit(list(operationId=job$id,fingerprint=job$report$validationFingerprint)),silent=TRUE))
stopifnot(job$status=='failed',!job$approved,!exists('never_created'))
cat('Attribute scope and failed execution authority acceptance passed\n')

# A geographic coordinate-plausibility finding does not block attribute work.
x<-st_sf(key='A',geometry=st_sfc(st_point(c(Inf,37)),crs=4326));y<-data.frame(key='A',v=1)
j<-run('left-join',list(leftkey='key',rightkey='key',relationship='one-to-one'),list(list(name='x'),list(name='y')))
stopifnot(nrow(j)==1,is.infinite(st_coordinates(j)[1,1]))
cat('Contextual coordinate plausibility acceptance passed\n')
