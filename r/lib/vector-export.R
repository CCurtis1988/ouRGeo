# Vector files are a separate commit boundary from derived R objects. Never
# write the user's destination until staged readback matches the approved plan.
dq_export_ops <- c('export-gpkg','export-geojson')
dq_file_revision <- function(path) {
  if(!file.exists(path)) return(NULL)
  con<-file(path,'rb');on.exit(close(con))
  unclass(as.character(openssl::sha256(con)))
}
dq_export_path <- function(path,driver) {
  if(!is.character(path)||length(path)!=1L||!nzchar(path)||grepl('^(https?://|/vsi)',path)) stop('Choose a local file destination, not a URL or GDAL virtual path')
  path<-path.expand(path)
  if(!grepl('^(/|[A-Za-z]:[/\\\\])',path)) stop('Choose an absolute local file path')
  parent<-dirname(path)
  if(!dir.exists(parent)||file.access(parent,2)!=0) stop('The destination directory must exist and be writable')
  cursor<-path
  repeat {
    link<-Sys.readlink(cursor)
    if(!is.na(link)&&nzchar(link)) stop('Symlink destinations or directories are outside the safe export scope; choose a direct local path')
    next_cursor<-dirname(cursor);if(identical(cursor,next_cursor))break;cursor<-next_cursor
  }
  if(dir.exists(path)) stop('Choose a file, not a directory')
  path<-file.path(normalizePath(parent,winslash='/',mustWork=TRUE),basename(path))
  suffix<-if(driver=='GPKG') '\\.gpkg$' else '\\.(geojson|json)$'
  if(!grepl(suffix,path,ignore.case=TRUE)) stop(paste('Use a',if(driver=='GPKG') '.gpkg' else '.geojson or .json','filename'))
  path
}
# Project Files destinations. The bundle is not a filesystem, so the checked
# export runs against a staging file and the verified result is handed to the
# library (put, add-or-replace by name) at publication. The staging path is
# fixed per name rather than per call: the plan is fingerprinted, and
# preflight, approval and publication each re-validate it, so a fresh
# temporary path each time would read as a changed destination. Adding or
# replacing a layer starts from the project's current copy, and that copy's
# hash becomes the destination revision, so a project file changed between
# check and save is refused exactly as a changed file on disk is.
dq_export_project_stage <- function(p,driver) {
  name<-p$projectFile;.ourgeo_pf_check_name(name,'projectFile')
  status<-.ourgeo_pf_request('status')
  if(is.null(status$project)) stop('This is the scratch workspace, which has no Project Files. Save the project (Project menu > Save As...) and export again')
  key<-substr(unclass(as.character(openssl::sha256(tolower(name)))),1,16)
  # Normalised: macOS tempdir() sits under /var, a symlink the destination
  # check below rightly refuses.
  dir<-file.path(normalizePath(tempdir(),winslash='/'),'ourgeo-project-export',key)
  dir.create(dir,recursive=TRUE,showWarnings=FALSE,mode='0700')
  path<-file.path(dir,basename(gsub('\\\\','/',name)))
  mode<-p$mode %||% 'new'
  if(mode=='new') {if(file.exists(path)) unlink(path);return(path)}
  if(driver!='GPKG') stop('A GeoJSON file in Project Files is written whole. Choose New file; it replaces a project file of the same name')
  found<-tryCatch(.ourgeo_pf_request('resolve',list(name=name,location='project')),error=function(e) stop(paste0(conditionMessage(e),' To create it, choose New file')))
  if(!identical(dq_file_revision(path),found$sha256)) {
    if(file.exists(path)) {Sys.chmod(path,'0644');unlink(path)}
    if(!file.copy(found$path,path,overwrite=TRUE)) stop('Could not stage the project copy of ',name,' for updating')
    Sys.chmod(path,'0644')
  }
  path
}
dq_export_to_project <- function(p) !is.null(p$projectFile)&&nzchar(p$projectFile)
dq_export_closed <- function(path) {
  if(any(file.exists(paste0(path,c('-wal','-shm','-journal'))))) stop('The destination has SQLite journal/WAL companions. Close it in other applications and finish their transactions before exporting')
}
dq_export_fields <- function(x,p) {
  fields<-setdiff(names(x),attr(x,'sf_column'))
  split_fields<-function(value) {if(is.null(value)||!nzchar(value)) character() else trimws(strsplit(value,',',fixed=TRUE)[[1]])}
  omitted<-split_fields(p$omitFields);converted<-split_fields(p$textFields)
  if(anyDuplicated(c(omitted,converted))||any(!c(omitted,converted) %in% fields)) stop('Choose distinct existing attribute fields for omission or text conversion')
  retained<-setdiff(fields,omitted)
  schema<-lapply(retained,function(nm) {
    v<-x[[nm]]
    plain<-identical(class(v),'character')||identical(class(v),'integer')||identical(class(v),'numeric')||identical(class(v),'logical')
    if(nm %in% converted) {
      if(!plain&&!inherits(v,c('factor','Date','POSIXct','units'))) stop(paste('Text conversion is unsupported for',nm,'; omit it explicitly or prepare a scalar field first'))
      if(inherits(v,c('Date','POSIXct'))&&any(is.nan(as.numeric(v))|(!is.na(v)&!is.finite(as.numeric(v))))) stop(paste('Non-finite date/time values in',nm,'cannot become valid timestamps; omit the field explicitly or prepare supported values'))
      if(inherits(v,'Date')&&any(!is.na(v)&as.numeric(v)!=floor(as.numeric(v)))) stop(paste('Fractional Date values in',nm,'cannot silently become whole-day strings; prepare a supported field first'))
    } else if(!plain) stop(paste('Unsupported attribute type in',nm,':',paste(class(v),collapse='/'),'; explicitly omit or convert a supported scalar field to text'))
    if(is.numeric(v)&&any(is.nan(v)|(!is.na(v)&!is.finite(v)))&&!nm %in% converted) stop(paste('Non-finite attribute values in',nm,'require an explicit text conversion or omission'))
    list(name=nm,sourceType=paste(class(v),collapse='/'),destinationType=if(nm %in% converted) 'character' else class(v)[1],
      conversion=if(nm %in% converted) if(inherits(v,'units')) paste('17 significant numeric digits with',units::deparse_unit(v),'unit labels; class metadata omitted') else if(inherits(v,'POSIXct')) 'UTC ISO-8601 text, 6 fractional decimal places; finer fractions truncated and timezone/class metadata omitted' else if(plain&&is.numeric(v)) '17 significant numeric digits as text; NaN/Infinity remain literal strings and NA remains null' else 'Explicit character values; class metadata omitted' else 'none')
  })
  list(retained=as.list(retained),omitted=as.list(omitted),converted=as.list(converted),schema=schema)
}
dq_export_plan <- function(input,profile,p,op,add) {
  x<-input$object;driver<-if(op=='export-gpkg') 'GPKG' else 'GeoJSON'
  if(!inherits(x,'sf')) stop('Export requires an sf-compatible vector layer')
  path<-dq_export_path(if(dq_export_to_project(p)) dq_export_project_stage(p,driver) else p$path,driver);if(driver=='GPKG') dq_export_closed(path)
  if(!isTRUE(profile$crs$known)) stop('The source CRS is missing or unparseable. Explicitly assign the known CRS to a copy before export')
  source_files<-attr(input$original,'ourgeo_source_files') %||% character()
  if(path %in% source_files) stop('Choose a derived destination; the imported source file cannot be replaced')
  # Enumerating drivers can warn about unrelated optional GDAL plugins. Actual
  # selected-driver writer warnings below remain fatal and protect the file.
  drivers<-suppressWarnings(sf::st_drivers());if(!any(drivers$name==driver & drivers$write)) stop(paste('The installed GDAL driver cannot write',driver,'; run Settings → Health check'))
  mode<-p$mode %||% 'new';exists<-file.exists(path)
  if(!mode %in% c('new','add','replace') || (driver=='GeoJSON' && mode=='add')) stop('Choose new file, add GeoPackage layer, or replace the named destination')
  if(mode=='new'&&exists) stop('The destination already exists. Choose another path or deliberately change the destination mode')
  if(mode!='new'&&!exists) stop('That destination does not exist. Choose New file instead')
  layer<-p$layer %||% 'layer'
  if(!grepl('^[A-Za-z][A-Za-z0-9_]{0,62}$',layer)||grepl('^(gpkg_|sqlite_)',layer,ignore.case=TRUE)) stop('Choose a layer name starting with a letter, followed by up to 62 letters, numbers or underscores; database system names are reserved')
  layers<-if(exists&&driver=='GPKG') as.list(sf::st_layers(path)$name) else list()
  if(exists&&driver=='GPKG') {
    contents<-sf::st_read(path,query='SELECT data_type FROM gpkg_contents',quiet=TRUE)
    if(any(!contents$data_type %in% c('features','attributes'))) stop('Updating a container with raster/unknown content is outside this vector-only preservation profile. Export to a new GeoPackage instead')
  }
  if(driver=='GPKG'&&mode=='add'&&layer %in% unlist(layers)) stop('That layer already exists. Choose another layer name or Replace named layer')
  if(driver=='GPKG'&&mode=='replace'&&!layer %in% unlist(layers)) stop('The named layer does not exist. Choose Add layer instead')
  if(exists&&dq_export_to_project(p)) add('EXP-DESTINATION',paste(if(mode=='add') 'Add' else 'Replace',layer,'in the project file',p$projectFile,'; every unrelated layer will be retained and verified.'),'warning')
  else if(exists) add('EXP-DESTINATION',if(driver=='GPKG') paste(if(mode=='add') 'Add' else 'Replace',layer,'in',path,'; every unrelated layer will be retained and verified.') else paste('Replace the existing GeoJSON file',path,'after staged verification.'),'warning')
  fields<-dq_export_fields(x,p)
  if(anyDuplicated(names(x))) stop('Duplicate field names are not a supported export schema')
  for(nm in unlist(fields$omitted)) add('EXP-OMIT',paste('Attribute field',nm,'will be omitted from the file; the source remains intact.'),'warning',rows=input$rows,field=nm)
  for(s in fields$schema) if(s$conversion!='none') add('EXP-TEXT',paste('Attribute field',s$name,'will change from',s$sourceType,'to text:',s$conversion),'warning',rows=input$rows,field=s$name)
  geom<-sf::st_geometry(x);types<-unique(as.character(sf::st_geometry_type(geom)));dimensions<-unique(vapply(geom,function(g) class(g)[1],''))
  curves<-any(grepl('CURVE|CIRCULAR',types))
  known_types<-c('POINT','MULTIPOINT','LINESTRING','MULTILINESTRING','POLYGON','MULTIPOLYGON','GEOMETRYCOLLECTION','CIRCULARSTRING','COMPOUNDCURVE','CURVEPOLYGON','MULTICURVE','MULTISURFACE')
  if(any(!types %in% known_types)) stop('This profile has no verified contract for these geometry types; prepare a supported derived layer or choose another workflow')
  if(any(vapply(geom,function(g) any(!is.finite(unlist(g)))&&!isTRUE(sf::st_is_empty(sf::st_sfc(g))),logical(1)))) stop('Non-finite geometry coordinates cannot be exported; explicitly exclude affected rows or change the data')
  target<-sf::st_crs(x);precision<-NULL;options<-character();dataset_options<-character()
  if(driver=='GPKG') {
    if(!all(dimensions %in% c('XY','XYZ','XYM','XYZM'))||length(dimensions)!=1L) stop('This GeoPackage profile requires one known coordinate dimension; no silent dimension coercion')
    unknown<-input$rows[vapply(profile$geometryRows[input$rows],function(g) g$status %in% c('invalid','uncheckable'),logical(1))]
    if(length(unknown)) add('EXP-GEOMETRY',paste(length(unknown),'geometries have invalid or unestablished analytical validity. Export preserves their coordinates/types; it does not repair them or grant analysis permission.'),'warning',rows=unknown,status='not_checked')
    fid<-'ourgeo_fid';while(fid %in% names(x)) fid<-paste0(fid,'_')
    options<-c(paste0('FID=',fid),paste0('GEOMETRY_NAME=',attr(x,'sf_column')),'SPATIAL_INDEX=NO')
    # Fix the container profile rather than inherit a version-dependent default.
    dataset_options<-if(exists) character() else 'VERSION=1.3'
  } else {
    precision<-suppressWarnings(as.numeric(p$precision %||% '15'))
    if(length(precision)!=1L||!is.finite(precision)||precision!=floor(precision)||precision<0||precision>15) stop('GeoJSON decimal precision must be a whole number from 0 to 15')
    if(curves) stop('RFC 7946 GeoJSON cannot preserve these canonical curves. Choose GeoPackage; curve approximation is not offered by this exporter')
    if(!all(dimensions %in% c('XY','XYZ'))||length(dimensions)!=1L) stop('GeoJSON supports a uniform XY or XYZ profile; M/mixed dimensions cannot silently disappear. Choose a tested GeoPackage profile')
    if('XYZ' %in% dimensions && !isTRUE(sf::st_crs(x)==sf::st_crs(4979))) stop('GeoJSON Z means WGS 84 ellipsoidal altitude in metres. This source lacks that declared 3D CRS; choose GeoPackage to retain its Z without a vertical assumption')
    if('XYZ' %in% dimensions) add('EXP-Z','GeoJSON retains declared WGS 84 ellipsoidal altitude in metres. Z values are preserved; no vertical datum conversion is performed.','info',status='passed')
    if(any(vapply(profile$geometryRows[input$rows],function(g) g$status!='valid',logical(1)))) stop('This GeoJSON profile requires established valid, non-empty geometry; exclusions must be explicit')
    if('geometry' %in% unlist(fields$retained)) stop('The attribute name geometry collides with the GeoJSON readback geometry column; explicitly rename or omit that attribute')
    for(s in fields$schema) if(s$destinationType!='character'&&all(is.na(x[[s$name]]))) stop(paste('GeoJSON cannot establish the type of all-null field',s$name,'; explicitly omit it or convert it to text'))
    target<-sf::st_crs('OGC:CRS84')
    native_wgs84<-isTRUE(sf::st_crs(x)==target)||isTRUE(sf::st_crs(x)==sf::st_crs(4326))||isTRUE(sf::st_crs(x)==sf::st_crs(4979))
    preview<-dq_transform(x,target)
    if(!native_wgs84) {
      add('EXP-CRS','GeoJSON coordinates will be transformed from the declared source CRS to WGS 84 longitude/latitude using installed resources; the source remains unchanged.','warning',rows=input$rows)
    }
    needs_rounding<-any(vapply(sf::st_geometry(preview),function(g) any(unlist(g)!=round(unlist(g),precision)),logical(1)))
    orientation_change<-function(g) {
      polygon<-function(rings) any(vapply(seq_along(rings),function(k) {r<-rings[[k]];area<-sum(r[-nrow(r),1]*r[-1,2]-r[-1,1]*r[-nrow(r),2]);if(k==1) area<0 else area>0},logical(1)))
      if(inherits(g,'POLYGON')) polygon(g) else if(inherits(g,'MULTIPOLYGON')) any(vapply(g,polygon,logical(1))) else if(inherits(g,'GEOMETRYCOLLECTION')) any(vapply(g,orientation_change,logical(1))) else FALSE
    }
    if(needs_rounding||any(vapply(sf::st_geometry(preview),orientation_change,logical(1)))) add('EXP-PRECISION',paste('GeoJSON coordinates will be written with',precision,'decimal places.',if(needs_rounding) 'Some ordinates will be rounded.' else 'Ordinates retain their values.', 'Polygon ring orientation/start may be normalised for RFC 7946. Numeric properties use 17 significant figures; dateline splitting is disabled.'),'warning')
    options<-c('RFC7946=YES',paste0('COORDINATE_PRECISION=',precision),'SIGNIFICANT_FIGURES=17','WRAPDATELINE=NO','WRITE_NON_FINITE_VALUES=NO','AUTODETECT_JSON_STRINGS=NO')
  }
  list(driver=driver,path=path,layer=layer,mode=mode,destinationRevision=dq_file_revision(path),existingLayers=layers,
    sourceCRS=sf::st_crs(x)$wkt,destinationCRS=target$wkt,axisConvention=if(driver=='GeoJSON') 'longitude, latitude[, altitude]' else 'native source x/y[, z/m]',
    geometryTypes=as.list(types),dimensions=as.list(dimensions),curves=if(curves) 'canonical curves retained, subject to exact readback' else 'none',fields=fields,
    coordinatePrecision=precision,geometryTolerance=if(driver=='GeoJSON') 0.5*10^-precision else 0,
    datasetOptions=as.list(dataset_options),layerOptions=as.list(options),readbackOptions=as.list(if(driver=='GeoJSON') 'DATE_AS_STRING=YES' else character()),featureCount=nrow(x),
    driverVersions=as.list(sf::sf_extSoftVersion()),coverage='full staged readback required before publication',sizeLimit='local filesystem and installed driver; no Desktop server quota')
}
dq_export_prepare <- function(input,plan) {
  x<-input$object
  for(nm in unlist(plan$fields$omitted)) x[[nm]]<-NULL
  for(nm in unlist(plan$fields$converted)) {
    v<-x[[nm]]
    numeric_text<-function(values) {out<-sprintf('%.17g',as.numeric(values));out[is.na(values)&!is.nan(as.numeric(values))]<-NA_character_;out}
    x[[nm]]<-if(inherits(v,'units')) {out<-numeric_text(v);ifelse(is.na(out),NA_character_,paste(out,units::deparse_unit(v)))} else if(inherits(v,'POSIXct')) format(v,tz='UTC',format='%Y-%m-%dT%H:%M:%OS6Z') else if(is.numeric(v)) numeric_text(v) else as.character(v)
  }
  attr(x,'ourgeo_validation')<-NULL;attr(x,'ourgeo_trace')<-NULL;attr(x,'ourgeo_source_pk')<-NULL;attr(x,'ourgeo_source_files')<-NULL
  if(plan$driver=='GeoJSON') {
    x<-dq_transform(x,plan$destinationCRS)
    for(g in sf::st_geometry(x)) {
      bb<-sf::st_bbox(sf::st_sfc(g));if(bb['xmax']-bb['xmin']>180 && !inherits(g,'POINT')) stop('This feature spans the dateline or a broad longitude range. No implicit split/axis change is supported; prepare an explicit export copy first')
    }
    round_geometry<-function(g) {
      if(is.numeric(g)) {g[]<-round(g,plan$coordinatePrecision);return(g)}
      attributes_before<-attributes(g);g<-lapply(g,round_geometry);attributes(g)<-attributes_before;g
    }
    sf::st_geometry(x)<-sf::st_sfc(lapply(sf::st_geometry(x),round_geometry),crs='OGC:CRS84')
    if(!requireNamespace('s2',quietly=TRUE)) stop('GeoJSON geographic verification requires a working s2 package. Run Settings → Health check to repair it, then restart R')
    old<-sf::sf_use_s2();on.exit(suppressMessages(sf::sf_use_s2(old)),add=TRUE);suppressMessages(sf::sf_use_s2(TRUE))
    validity<-sf::st_is_valid(x,NA_on_exception=TRUE)
    if(anyNA(validity)||!all(validity)||any(sf::st_is_empty(x))) stop('The selected precision/transform produces invalid or empty geometry. Choose more precision or prepare a supported copy')
  }
  x
}
# RFC 7946 may reverse or rotate a polygon ring. Compare all ordinates through
# canonical rings; this never changes either dataset or treats topology as proof
# of Z/M preservation. Non-polygon and canonical curve structures stay ordered.
dq_export_canonical <- function(g,normalise_rings=FALSE) {
  ring<-function(m) {
    if(nrow(m)<2) return(m)
    m<-m[-nrow(m),,drop=FALSE]
    candidates<-list(m,m[nrow(m):1,,drop=FALSE])
    rotate<-function(a) {key<-apply(a,1,function(r)paste(sprintf('%+.17e',r),collapse=','));start<-order(key)[1];a[c(seq.int(start,nrow(a)),if(start>1)seq_len(start-1) else integer()),,drop=FALSE]}
    candidates<-lapply(candidates,rotate);keys<-vapply(candidates,function(a)paste(sprintf('%+.17e',as.vector(a)),collapse=','),'')
    unname(candidates[[order(keys)[1]]])
  }
  if(normalise_rings&&inherits(g,'POLYGON')) return(lapply(g,ring))
  if(normalise_rings&&inherits(g,'MULTIPOLYGON')) return(lapply(g,function(p) lapply(p,ring)))
  attributes(g)<-attributes(g)[intersect(names(attributes(g)),c('dim','dimnames'))];g
}
dq_export_compare <- function(expected,actual,plan) {
  if(nrow(expected)!=nrow(actual)) stop('Readback changed the feature count; destination was not published')
  a<-if(inherits(expected,'sf')) sf::st_drop_geometry(expected) else expected
  b<-if(inherits(actual,'sf')) sf::st_drop_geometry(actual) else actual
  if(!identical(names(a),names(b))) stop('Readback changed field names/order; destination was not published')
  for(nm in names(a)) if(!identical(class(a[[nm]]),class(b[[nm]]))||!identical(unname(a[[nm]]),unname(b[[nm]]))) stop(paste('Readback changed attribute type/values in',nm,'; destination was not published'))
  if(inherits(expected,'sf')) {
    same_crs<-isTRUE(sf::st_crs(expected)==sf::st_crs(actual))
    # sf reads RFC 7946 as EPSG:4326 (authority latitude/longitude axes), while
    # the file/profile explicitly use longitude/latitude. Accept this specific
    # documented representation only; full ordinate comparison still catches
    # an actual axis reversal. Other formats need genuine CRS equivalence.
    expected_epsg<-if('XYZ' %in% unlist(plan$dimensions)) 4979 else 4326
    if(identical(plan$driver,'GeoJSON')&&isTRUE(sf::st_crs(actual)$epsg==expected_epsg)&&isTRUE(sf::st_crs(expected)==sf::st_crs('OGC:CRS84'))) same_crs<-TRUE
    if(!inherits(actual,'sf')||!same_crs) stop(paste('Readback changed or lost the CRS/geometry column:',sf::st_crs(expected)$input,'versus',sf::st_crs(actual)$input,'EPSG',sf::st_crs(actual)$epsg))
    eg<-sf::st_geometry(expected);ag<-sf::st_geometry(actual)
    for(k in seq_along(eg)) {
      e<-eg[[k]];g<-ag[[k]]
      if(!identical(class(e)[1:2],class(g)[1:2])) stop(paste('Readback changed geometry type or dimensions for source row',k))
      ec<-dq_export_canonical(e,identical(plan$driver,'GeoJSON'));ac<-dq_export_canonical(g,identical(plan$driver,'GeoJSON'))
      # all.equal scales tolerance; explicit absolute ordinate comparisons below
      # avoid a coordinate magnitude turning a precision promise into metres.
      shape<-function(v) if(is.numeric(v)) list(length=length(v),dimensions=dim(v)) else list(type=if(inherits(v,'sfg'))class(v)[1:2] else NULL,children=lapply(v,shape))
      if(!identical(shape(ec),shape(ac))) stop('Readback changed geometry structure')
      ev<-unlist(ec);av<-unlist(ac)
      allowance<-if(plan$geometryTolerance==0) 0 else plan$geometryTolerance+16*.Machine$double.eps*pmax(1,abs(ev))
      if(!identical(is.na(ev),is.na(av))||any(abs(ev-av)>allowance,na.rm=TRUE)) stop(paste('Readback changed geometry coordinates beyond the approved tolerance for source row',k))
    }
  }
  invisible(TRUE)
}
dq_export_context <- function(request,fingerprint,acknowledged) {
  loaded<-dq_inputs(request);report<-dq_validate(request,loaded)
  if(!identical(report$validationFingerprint,fingerprint)||!report$status %in% c('ready','needs_confirmation')) stop('Source, destination or export plan changed. Rerun preflight')
  needed<-vapply(Filter(function(i)i$requiresAcknowledgment,report$issues),`[[`,'','stableCode')
  if(!all(needed %in% acknowledged)) stop('Review the exact export changes before execution')
  plan<-report$executionPlan$exportProfileAndOptions
  context<-new.env(parent=emptyenv());context$request<-request;context$report<-report;context$plan<-plan;context$loaded<-loaded;context$fingerprint<-fingerprint;context$acknowledged<-acknowledged
  context$lock<-paste0(plan$path,'.ourgeo-export-lock')
  if(!dir.create(context$lock,showWarnings=FALSE,mode='0700')) stop('Another export holds the destination lock. Wait for it to finish; a stale lock needs deliberate removal')
  context$directory<-tempfile('.ourgeo-export-',tmpdir=dirname(plan$path))
  if(!dir.create(context$directory,mode='0700')) {unlink(context$lock,recursive=TRUE);stop('Could not create staging directory')}
  context$stage<-file.path(context$directory,basename(plan$path));context$published<-FALSE
  context
}
dq_export_cleanup <- function(context) {
  if(is.null(context)) return(invisible(NULL))
  unlink(context$directory,recursive=TRUE);unlink(context$lock,recursive=TRUE)
}
dq_export_write <- function(context) {
  p<-context$plan;context$expected<-dq_export_prepare(context$loaded[[1]],p);context$unrelated<-list()
  if(p$driver=='GPKG'&&!is.null(p$destinationRevision)) {
    dq_export_closed(p$path)
    if(!identical(dq_file_revision(p$path),p$destinationRevision)) stop('Destination changed before staging')
    if(!file.copy(p$path,context$stage,overwrite=FALSE)||!identical(dq_file_revision(context$stage),p$destinationRevision)||!identical(dq_file_revision(p$path),p$destinationRevision)) stop('Could not obtain a stable copy of the closed destination')
    for(layer in setdiff(unlist(p$existingLayers),if(p$mode=='replace')p$layer else character())) context$unrelated[[layer]]<-sf::st_read(context$stage,layer=layer,quiet=TRUE,fid_column_name='ourgeo_readback_fid')
  }
  withCallingHandlers(sf::st_write(context$expected,context$stage,layer=p$layer,driver=p$driver,
    dataset_options=unlist(p$datasetOptions),layer_options=unlist(p$layerOptions),quiet=TRUE,
    append=NA,delete_layer=p$mode=='replace'&&p$driver=='GPKG',delete_dsn=FALSE,factorsAsCharacter=FALSE),
    warning=function(w) stop(paste('Unexpected writer warning:',conditionMessage(w))))
}
dq_export_verify <- function(context) {
  p<-context$plan
  if(p$driver=='GPKG') dq_export_closed(context$stage)
  actual<-sf::st_read(context$stage,layer=p$layer,quiet=TRUE,stringsAsFactors=FALSE,options=unlist(p$readbackOptions))
  dq_export_compare(context$expected,actual,p)
  if(p$driver=='GPKG') {
    layers<-sf::st_layers(context$stage)$name
    if(!setequal(layers,unique(c(unlist(p$existingLayers),p$layer)))) stop('Readback changed unrelated container layers')
    for(layer in names(context$unrelated)) dq_export_compare(context$unrelated[[layer]],sf::st_read(context$stage,layer=layer,quiet=TRUE,fid_column_name='ourgeo_readback_fid'),list(geometryTolerance=0))
  }
  context$verified<-TRUE
  context$verifiedRevision<-dq_file_revision(context$stage)
}
dq_export_publish <- function(context) {
  if(!isTRUE(context$verified)) stop('Complete staged verification is required before publication')
  if(!identical(dq_file_revision(context$stage),context$verifiedRevision)) stop('The verified staged file changed; it cannot be published')
  p<-context$plan;fresh<-dq_validate(context$request)
  if(p$driver=='GPKG') dq_export_closed(context$stage)
  if(!identical(fresh$validationFingerprint,context$fingerprint)) stop('Source, selection, destination or profile changed before publication; check again')
  for(ref in context$request$inputs) if(!is.null(ref$selectionVersion)) {
    selected<-get(dq_key(ref),dq_state$selections,inherits=FALSE)
    if(!identical(as.numeric(selected$version),as.numeric(ref$selectionVersion))) stop('Selection changed before publication')
  }
  if(p$driver=='GPKG') dq_export_closed(p$path)
  # Exclusive creation prevents a late-arriving new destination being overwritten.
  # Existing files use same-filesystem rename: never unlink the old file first.
  ok<-if(is.null(p$destinationRevision)) file.link(context$stage,p$path) else file.rename(context$stage,p$path)
  if(!ok) stop('The filesystem could not safely publish the export. Close locked destinations or choose a new local path; the previous file was retained')
  context$published<-TRUE
  where<-p$path
  if(dq_export_to_project(context$request$parameters)) {
    name<-context$request$parameters$projectFile
    saved<-tryCatch(.ourgeo_pf_request('put',list(path=p$path,name=name,overwrite=TRUE)),error=function(e)
      stop(paste0('The export was verified but not saved into Project Files: ',conditionMessage(e),' The verified file is kept at ',p$path,'; ourgeo_project_save("',p$path,'", "',name,'") saves it once fixed')))
    unlink(p$path)
    where<-paste0('Project Files: ',if(nzchar(saved$folder %||% '')) paste0(saved$folder,'/') else '',saved$name,if(identical(saved$action,'unchanged')) ' (unchanged)' else ' (save the project to keep it)')
  }
  result<-list(path=where,layer=p$layer,driver=p$driver,featureCount=nrow(context$expected),verified=TRUE,
    fingerprint=context$fingerprint,plan=p,rowRecords=context$report$rowRecords,inputRevisions=context$report$inputRevisions,
    acknowledged=as.list(context$acknowledged))
  if(is.null(dq_state$exportRecords)) dq_state$exportRecords<-list()
  dq_state$exportRecords<-tail(c(dq_state$exportRecords,list(result)),32L)
  result
}
dq_export_code <- function(request,fingerprint,ack) {
  json<-jsonlite::toJSON(request,auto_unbox=TRUE,null='null',digits=NA)
  sprintf('dq_export_run(jsonlite::fromJSON(%s, simplifyVector = FALSE), fingerprint = %s, acknowledged = c(%s))',encodeString(json,quote='"'),encodeString(fingerprint,quote='"'),paste(vapply(ack,encodeString,'',quote='"'),collapse=', '))
}
# Replayable user-authored R; controlled HTTP approval is enforced by dq_commit.
dq_export_run <- function(request,fingerprint,acknowledged=character()) {
  context<-dq_export_context(request,fingerprint,acknowledged);on.exit(dq_export_cleanup(context))
  dq_export_write(context);dq_export_verify(context);invisible(dq_export_publish(context))
}
dq_export_start <- function(job,ack) {
  job$exportContext<-dq_export_context(job$request,job$report$validationFingerprint,ack)
  job$status<-'checking';job$executionPhase<-'writing staged output'
  tick<-function() {
    if(job$status!='checking') {dq_export_cleanup(job$exportContext);return(invisible(NULL))}
    cat('OURGEO_PREFLIGHT_BUSY:',job$id,'\n',sep='');on.exit(cat('OURGEO_PREFLIGHT_IDLE:',job$id,'\n',sep=''))
    tryCatch({
      if(job$executionPhase=='writing staged output') {dq_export_write(job$exportContext);job$executionPhase<-'verifying staged output'}
      else if(job$executionPhase=='verifying staged output') {dq_export_verify(job$exportContext);job$executionPhase<-'ready to publish'}
      else {
        result<-dq_export_publish(job$exportContext);job$used<-TRUE;job$status<-'ready';job$executionPhase<-'saved and verified'
        job$executionResult<-list(success=TRUE,code=dq_export_code(job$request,job$report$validationFingerprint,ack),path=result$path,featureCount=result$featureCount,verified=TRUE)
        dq_export_cleanup(job$exportContext);return(invisible(NULL))
      }
      # Yield between native stages so queued cancellation is processed before
      # the irreversible publication point, including cooperative Windows jobs.
      later::later(tick,0.05)
    },error=function(e){job$status<-'failed';job$approved<-FALSE;job$error<-conditionMessage(e);dq_export_cleanup(job$exportContext)},
    interrupt=function(e){job$status<-'cancelled';job$approved<-FALSE;job$error<-'Export cancelled; no staged output was published';dq_export_cleanup(job$exportContext)})
  }
  later::later(tick,0.05)
  list(success=TRUE,pending=TRUE)
}
