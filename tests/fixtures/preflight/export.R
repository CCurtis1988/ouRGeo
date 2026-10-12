if (dir.exists('.cache/preflight-r/s2')) .libPaths(c(normalizePath('.cache/preflight-r'),.libPaths()))
suppressPackageStartupMessages(library(sf))
library(jsonlite)
source('r/lib/util-core.R');source('r/lib/util-env.R')
Sys.setenv(OURGEO_PREFLIGHT_SECRET='export-test-secret')
source('r/lib/data-preflight.R')
if(file.exists('r/lib/vector-export.R')) source('r/lib/vector-export.R')
folder<-tempfile('ourgeo-export-fixture-');dir.create(folder)
x<-st_sf(key=c('01','1'),value=c(0,NA_real_),flag=c(TRUE,FALSE),geometry=st_sfc(st_point(c(500000,4100000)),st_point(c(500003,4100004)),crs=32610))
original<-serialize(x,NULL)
req<-function(format='gpkg',path=file.path(folder,paste0('points.',if(format=='gpkg') 'gpkg' else 'geojson')),mode='new',extra=list()) list(operationType=paste0('export-',format),inputs=list(list(name='x')),parameters=c(list(path=path,layer='points',mode=mode,precision='15'),extra))
request<-req();report<-dq_validate(request)
if(report$status!='ready')print(report$issues)
stopifnot(report$status=='ready')
saved<-dq_export_run(request,report$validationFingerprint,character())
read<-st_read(request$parameters$path,layer='points',quiet=TRUE)
stopifnot(nrow(read)==2L,identical(read$key,c('01','1')),identical(read$value,c(0,NA_real_)),identical(read$flag,c(TRUE,FALSE)),isTRUE(st_crs(read)==st_crs(x)),identical(unname(st_coordinates(read)),unname(st_coordinates(x))),identical(original,serialize(x,NULL)),saved$verified)
issues<-function(report) vapply(report$issues,`[[`,'','stableCode')
approved<-function(request) {
  report<-dq_validate(request)
  if(report$status=='blocked') {print(report$issues);stop('Unexpected blocked export fixture')}
  invisible(dq_export_run(request,report$validationFingerprint,vapply(Filter(function(i)i$requiresAcknowledgment,report$issues),`[[`,'','stableCode')))
}
expect_error<-function(code,pattern='') {
  error<-tryCatch({force(code);NULL},error=function(e)conditionMessage(e))
  stopifnot(!is.null(error));if(nzchar(pattern))stopifnot(grepl(pattern,error,ignore.case=TRUE));invisible(error)
}
# The approved operation controls replacement of one layer, not a whole file.
old_point<-x
unrelated<-st_sf(label='do not change',geometry=st_sfc(st_point(c(500010,4100010)),crs=32610))
st_write(unrelated,request$parameters$path,layer='unrelated',quiet=TRUE,append=NA)
old_unrelated<-st_read(request$parameters$path,layer='unrelated',quiet=TRUE,fid_column_name='saved_id')
x<-x[1,,drop=FALSE];x$key<-'replacement'
replacement<-req(mode='replace');rp<-dq_validate(replacement)
stopifnot(rp$status=='needs_confirmation',any(grepl('EXP-DESTINATION',issues(rp))))
before_file<-dq_file_revision(replacement$parameters$path)
expect_error(dq_export_run(replacement,rp$validationFingerprint,character()),'Review')
stopifnot(identical(before_file,dq_file_revision(replacement$parameters$path)))
approved(replacement)
stopifnot(st_read(replacement$parameters$path,layer='points',quiet=TRUE)$key=='replacement',
  identical(old_unrelated,st_read(replacement$parameters$path,layer='unrelated',quiet=TRUE,fid_column_name='saved_id')))
addition<-req(mode='add');addition$parameters$layer<-'third';approved(addition)
stopifnot(setequal(st_layers(addition$parameters$path)$name,c('points','unrelated','third')),
  identical(old_unrelated,st_read(addition$parameters$path,layer='unrelated',quiet=TRUE,fid_column_name='saved_id')))
stopifnot(dq_validate(req(mode='add'))$status=='blocked')
# Custom WKT, mixed shapes, XYZ/XYM and empty geometries are independent literals.
x<-old_point;custom<-st_crs(32610)$wkt;custom<-sub('ID\\["EPSG",32610\\]','',custom);custom<-sub(',[[:space:]]*\\]$',']',custom)
st_crs(x)<-suppressWarnings(st_crs(custom))
custom_request<-req(path=file.path(folder,'custom.gpkg'));approved(custom_request)
stopifnot(isTRUE(st_crs(st_read(custom_request$parameters$path,quiet=TRUE))==st_crs(x)))
for(dimension in c('XYZ','XYM','XYZM')) {
  coords<-if(dimension=='XYZM') c(500000,4100000,12,8) else c(500000,4100000,12)
  x<-st_sf(key='dimensional',geometry=st_sfc(st_point(coords,dim=dimension),crs=32610))
  dimensional<-req(path=file.path(folder,paste0(dimension,'.gpkg')));approved(dimensional)
  got<-st_read(dimensional$parameters$path,quiet=TRUE)
  stopifnot(identical(class(st_geometry(got)[[1]])[1],dimension),identical(unname(st_coordinates(got)),unname(st_coordinates(x))))
  if(grepl('M',dimension))stopifnot(dq_validate(req('geojson',file.path(folder,'measure.geojson')))$status=='blocked')
}
x<-st_sf(key=c('point','line'),geometry=st_sfc(st_point(c(500000,4100000)),st_linestring(rbind(c(500000,4100000),c(500003,4100004))),crs=32610))
mixed<-req(path=file.path(folder,'mixed.gpkg'));approved(mixed)
stopifnot(identical(as.character(st_geometry_type(st_read(mixed$parameters$path,quiet=TRUE))),c('POINT','LINESTRING')))
x<-st_sf(key='empty',geometry=st_sfc(st_point(),crs=32610))
empty<-req(path=file.path(folder,'empty.gpkg'));approved(empty)
stopifnot(st_is_empty(st_read(empty$parameters$path,quiet=TRUE)))
suppressPackageStartupMessages(library(sfarc))
x<-st_sf(key='arc',geometry=st_as_sfc('CIRCULARSTRING (500000 4100000,500001 4100001,500002 4100000)',crs=32610))
curve_before<-serialize(x,NULL);curve<-req(path=file.path(folder,'curve.gpkg'));approved(curve)
stopifnot(identical(curve_before,serialize(x,NULL)),identical(st_as_text(st_geometry(st_read(curve$parameters$path,quiet=TRUE))),st_as_text(st_geometry(x))))
stopifnot(dq_validate(req('geojson',file.path(folder,'curve.geojson')))$status=='blocked')
cat('GeoPackage container, dimensions and canonical curve preservation passed\n')
# Unsupported fields cannot be silently dropped. Explicit selected conversion is recorded.
x<-old_point;x$list<-list(list(a=1),list(a=2));x$factor<-factor(c('A','B'));x$metres<-units::set_units(c(3,4),'m')
rich<-req(path=file.path(folder,'rich.gpkg'));stopifnot(dq_validate(rich)$status=='blocked')
rich$parameters$omitFields<-'list';rich$parameters$textFields<-'factor,metres'
rich_report<-dq_validate(rich);stopifnot(rich_report$status=='needs_confirmation')
approved(rich);got<-st_read(rich$parameters$path,quiet=TRUE)
stopifnot(!'list' %in% names(got),identical(got$factor,c('A','B')),identical(got$metres,c('3 m','4 m')),inherits(x$factor,'factor'),inherits(x$metres,'units'))
cat('Explicit field omission and scalar text conversion passed\n')
x<-old_point;x$metres<-units::set_units(c(3.123456789123456,NA_real_),'m');x$stamp<-as.POSIXct(c(0.1234567,NA_real_),origin='1970-01-01',tz='UTC')
precise_text<-req(path=file.path(folder,'precise-text.gpkg'),extra=list(textFields='metres,stamp'))
text_report<-dq_validate(precise_text);stopifnot(any(grepl('6 fractional',vapply(text_report$issues,`[[`,'','message'))))
approved(precise_text);got<-st_read(precise_text$parameters$path,quiet=TRUE)
stopifnot(as.numeric(sub(' m$','',got$metres[1]))==as.numeric(x$metres[1]),is.na(got$metres[2]),identical(got$stamp,c('1970-01-01T00:00:00.123456Z',NA_character_)))
# Independent spherical Mercator coordinates (R=6378137), never implementation goldens.
radius<-6378137;lon<-7;lat<-52
x<-st_sf(key='01',value=3.25,geometry=st_sfc(st_point(c(radius*lon*pi/180,radius*log(tan(pi/4+lat*pi/360)))),crs=3857))
json_request<-req('geojson',file.path(folder,'reference.geojson'),extra=list())
json_request$parameters$precision<-'7';json_report<-dq_validate(json_request)
stopifnot(json_report$status=='needs_confirmation');approved(json_request)
raw<-jsonlite::fromJSON(json_request$parameters$path,simplifyVector=FALSE)
xy<-unlist(raw$features[[1]]$geometry$coordinates)
stopifnot(abs(xy[1]-7)<0.5e-7,abs(xy[2]-52)<0.5e-7,raw$features[[1]]$properties$key=='01',is.null(raw$crs))
stopifnot('RFC7946=YES' %in% unlist(json_report$executionPlan$exportProfileAndOptions$layerOptions),
  'COORDINATE_PRECISION=7' %in% unlist(json_report$executionPlan$exportProfileAndOptions$layerOptions))
cat('Independent GeoJSON longitude/latitude and precision acceptance passed\n')
changed_profile<-json_request;changed_profile$parameters$precision<-'8'
stopifnot(!identical(json_report$validationFingerprint,dq_validate(changed_profile)$validationFingerprint))
# GeoJSON rings may rotate/reverse while all coordinates and holes are retained.
x<-st_sf(key='native',geometry=st_sfc(st_point(c(7,52)),crs='OGC:CRS84'))
clean_json<-req('geojson',file.path(folder,'clean.geojson'))
stopifnot(dq_validate(clean_json)$status=='ready');approved(clean_json)
x<-st_sf(key=c('01','1'),date_text=c('2025-01-02',NA_character_),stamp=as.POSIXct(c(0.1234567,NA_real_),origin='1970-01-01',tz='UTC'),geometry=st_sfc(st_point(c(7,52)),st_point(c(7.01,52.01)),crs='OGC:CRS84'))
json_text<-req('geojson',file.path(folder,'iso-text.geojson'),extra=list(textFields='stamp'))
stopifnot('DATE_AS_STRING=YES' %in% unlist(dq_validate(json_text)$executionPlan$exportProfileAndOptions$readbackOptions))
approved(json_text)
text_json<-jsonlite::fromJSON(json_text$parameters$path,simplifyVector=FALSE)
stopifnot(identical(text_json$features[[1]]$properties$date_text,'2025-01-02'),identical(text_json$features[[1]]$properties$stamp,'1970-01-01T00:00:00.123456Z'),is.null(text_json$features[[2]]$properties$date_text),is.null(text_json$features[[2]]$properties$stamp))
ring<-rbind(c(7,52),c(7,52.01),c(7.01,52.01),c(7.01,52),c(7,52))
x<-st_sf(key='polygon',geometry=st_sfc(st_polygon(list(ring)),crs='OGC:CRS84'))
approved(req('geojson',file.path(folder,'ring.geojson')))
x<-st_sf(key=c('point','line'),geometry=st_sfc(st_point(c(7,52)),st_linestring(rbind(c(7,52),c(7.01,52.01))),crs='OGC:CRS84'))
approved(req('geojson',file.path(folder,'mixed.geojson')))
x<-st_sf(key='height',geometry=st_sfc(st_point(c(7,52,12.25)),crs='OGC:CRS84'))
stopifnot(dq_validate(req('geojson',file.path(folder,'unknown-height.geojson')))$status=='blocked')
st_crs(x)<-suppressWarnings(st_crs(4979))
approved(req('geojson',file.path(folder,'height.geojson')))
stopifnot(unlist(jsonlite::fromJSON(file.path(folder,'height.geojson'),simplifyVector=FALSE)$features[[1]]$geometry$coordinates)[3]==12.25)
x<-st_sf(key='crossing',geometry=st_sfc(st_linestring(rbind(c(179,0),c(-179,1))),crs='OGC:CRS84'))
stopifnot(dq_validate(req('geojson',file.path(folder,'dateline.geojson')))$status=='blocked')
# Mutation of staged content must not replace the existing file.
x<-old_point
for(loss in c('rows','schema','value','geometry')) {
  request<-req(mode='replace');report<-dq_validate(request);ack<-vapply(Filter(function(i)i$requiresAcknowledgment,report$issues),`[[`,'','stableCode')
  previous<-dq_file_revision(request$parameters$path);context<-dq_export_context(request,report$validationFingerprint,ack)
  dq_export_write(context);bad<-context$expected
  if(loss=='rows')bad<-bad[1,,drop=FALSE]
  if(loss=='schema')bad$key<-NULL
  if(loss=='value')bad$key[1]<-'corrupted'
  if(loss=='geometry')st_geometry(bad)[[1]]<-st_point(c(500001,4100000))
  st_write(bad,context$stage,layer='points',quiet=TRUE,delete_layer=TRUE)
  expect_error(dq_export_verify(context),'Readback');expect_error(dq_export_publish(context),'verification')
  dq_export_cleanup(context);stopifnot(identical(previous,dq_file_revision(request$parameters$path)),!dir.exists(context$lock),!dir.exists(context$directory))
}
# External destination changes, source changes, source-file destinations and journals block.
request<-req(mode='replace');report<-dq_validate(request);ack<-vapply(Filter(function(i)i$requiresAcknowledgment,report$issues),`[[`,'','stableCode')
context<-dq_export_context(request,report$validationFingerprint,ack);dq_export_write(context);dq_export_verify(context)
bad<-context$expected;bad$key[1]<-'late staged corruption';st_write(bad,context$stage,layer='points',delete_layer=TRUE,quiet=TRUE)
previous<-dq_file_revision(request$parameters$path);expect_error(dq_export_publish(context),'staged');dq_export_cleanup(context)
stopifnot(identical(previous,dq_file_revision(request$parameters$path)))
request<-req(mode='replace');report<-dq_validate(request);ack<-vapply(Filter(function(i)i$requiresAcknowledgment,report$issues),`[[`,'','stableCode')
context<-dq_export_context(request,report$validationFingerprint,ack);dq_export_write(context);dq_export_verify(context)
x$key[1]<-'edit';expect_error(dq_export_publish(context),'changed');dq_export_cleanup(context);x<-old_point
context<-dq_export_context(request,report$validationFingerprint,ack);dq_export_write(context);dq_export_verify(context)
st_write(unrelated,request$parameters$path,layer='external',quiet=TRUE,append=NA)
external_revision<-dq_file_revision(request$parameters$path);expect_error(dq_export_publish(context),'changed');dq_export_cleanup(context)
stopifnot(identical(external_revision,dq_file_revision(request$parameters$path)))
attr(x,'ourgeo_source_files')<-normalizePath(request$parameters$path);stopifnot(dq_validate(request)$status=='blocked');attr(x,'ourgeo_source_files')<-NULL
file.create(paste0(request$parameters$path,'-wal'));stopifnot(dq_validate(request)$status=='blocked');unlink(paste0(request$parameters$path,'-wal'))
if(.Platform$OS.type=='unix') {link<-file.path(folder,'link.gpkg');file.symlink(request$parameters$path,link);stopifnot(dq_validate(req(path=link,mode='replace'))$status=='blocked')}
# Async controlled handler denial and stage cancellation cannot publish output.
request<-req(mode='replace');report<-dq_validate(request);ack<-vapply(Filter(function(i)i$requiresAcknowledgment,report$issues),`[[`,'','stableCode')
previous<-dq_file_revision(request$parameters$path)
trace('st_write',where=asNamespace('sf'),tracer=quote(stop('Fixture writer failure')),print=FALSE)
expect_error(dq_export_run(request,report$validationFingerprint,ack),'writer failure');untrace('st_write',where=asNamespace('sf'))
stopifnot(identical(previous,dq_file_revision(request$parameters$path)),!dir.exists(paste0(request$parameters$path,'.ourgeo-export-lock')))
context<-dq_export_context(request,report$validationFingerprint,ack)
expect_error(dq_export_context(request,report$validationFingerprint,ack),'lock');dq_export_cleanup(context)
selected_request<-req(path=file.path(folder,'selected.gpkg'));selected_request$inputs[[1]]$rows<-list(1)
approved(selected_request);stopifnot(st_read(selected_request$parameters$path,quiet=TRUE)$key=='1')
nan<-x;x$value[1]<-NaN;stopifnot(dq_validate(req(path=file.path(folder,'nan.gpkg')))$status=='blocked');x<-nan
wait_job<-function(request) {j<-dq_start(request);while(j$status=='checking'){later::run_now(0.1);j<-dq_job_report(dq_find(j$operationId))};j}
cancel_request<-req(path=file.path(folder,'cancelled.gpkg'));j<-wait_job(cancel_request)
stopifnot(j$status=='ready');dq_commit(list(operationId=j$operationId,fingerprint=j$validationFingerprint))
job<-dq_find(j$operationId);while(job$executionPhase=='writing staged output')later::run_now(0.01)
handle_preflight('cancel',list(operationId=j$operationId));later::run_now(0.2)
stopifnot(job$status=='cancelled',!file.exists(cancel_request$parameters$path),!dir.exists(job$exportContext$lock))
deny<-req('geojson',file.path(folder,'denied.geojson'));j<-wait_job(deny)
expect_error(dq_commit(list(operationId=j$operationId,fingerprint=j$validationFingerprint,acknowledged=issues(j))),'review')
stopifnot(!file.exists(deny$parameters$path))
approved_request<-req('geojson',file.path(folder,'approved.geojson'));j<-wait_job(approved_request)
dq_approve(list(operationId=j$operationId,fingerprint=j$validationFingerprint,secret='export-test-secret'))
dq_commit(list(operationId=j$operationId,fingerprint=j$validationFingerprint));job<-dq_find(j$operationId)
while(job$status=='checking')later::run_now(0.1)
stopifnot(job$status=='ready',job$executionResult$verified,file.exists(approved_request$parameters$path),grepl('dq_export_run',job$executionResult$code),grepl('precision',job$executionResult$code))
expect_error(dq_commit(list(operationId=j$operationId,fingerprint=j$validationFingerprint)),'permission')
unlink(folder,recursive=TRUE)
cat('Checked vector export acceptance passed\n')
