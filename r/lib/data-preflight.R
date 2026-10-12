# Non-mutating inspection and operation plans. HTTP never accepts executable R,
# caller acknowledgments, or a caller's claim that a check passed.
dq_state <- new.env(parent = emptyenv())
dq_state$jobs <- new.env(parent = emptyenv())
dq_state$selections <- new.env(parent = emptyenv())
dq_state$approvals <- new.env(parent = emptyenv())
dq_state$profiles <- new.env(parent = emptyenv())
# Ordinary object/environment viewers must not expose the approval token.
# Arbitrary user-authored R can introspect R itself and remains outside this
# controlled-handler boundary; the renderer never receives this closure state.
dq_review_authority <- local({
  secret <- Sys.getenv('OURGEO_PREFLIGHT_SECRET')
  Sys.unsetenv('OURGEO_PREFLIGHT_SECRET')
  function(candidate) nzchar(secret) && identical(candidate,secret)
})

dq_hash <- function(x) {
  # openssl is already a core httr2 dependency. SHA-256 binds consent to bytes;
  # a short metadata signature is inadequate for input-revision authority.
  if(!requireNamespace('openssl',quietly=TRUE)) stop('Data checks require the core openssl dependency; run Settings → Health check')
  unclass(as.character(openssl::sha256(serialize(x,NULL,version=3))))
}
dq_key <- function(ref) paste(ref$accessPath %||% ref$name, ref$envName %||% '.GlobalEnv', sep='::')
dq_object <- function(ref) {
  env <- resolve_env(ref$envName %||% '.GlobalEnv')
  # Accessors only: inspecting a nested object must never evaluate a function.
  walk <- function(expr) {
    if (is.symbol(expr)) return(get(as.character(expr), envir=env, inherits=FALSE))
    if (is.call(expr) && as.character(expr[[1]]) %in% c('$','[[') && length(expr)==3) {
      key <- expr[[3]]
      if (is.symbol(key) && as.character(expr[[1]])=='$') key <- as.character(key)
      if (!is.character(key) && !is.numeric(key)) stop('Unsupported inspection accessor')
      return(walk(expr[[2]])[[key]])
    }
    stop('Choose an existing object; inspection does not execute expressions')
  }
  path <- ref$accessPath %||% ref$name
  x <- if (exists(path,envir=env,inherits=FALSE)) get(path,envir=env,inherits=FALSE) else walk(parse(text=path)[[1]])
  if (exists('.rgeo_resolve_proxy',mode='function')) {
    proxy<-.rgeo_resolve_proxy(x)
    if(!is.null(proxy)) {
      meta<-.rgeo_make_meta(proxy$handle,proxy$name)
      if(meta$kind %in% c('sf','geos') && !is.na(meta$spatial_format) && meta$spatial_format=='duckdb_geometry') x<-.rgeo_materialize_sf(meta,keep_identity=TRUE)
      else {
        x<-DBI::dbGetQuery(meta$con,sprintf('SELECT * FROM %s ORDER BY %s',.rgeo_qid(meta$table_name),.rgeo_qid(meta$pk_column)))
        attr(x,'ourgeo_source_pk')<-meta$pk_column
      }
    }
  }
  if (inherits(x,'tbl_dbi')) x <- dplyr::collect(x)
  if (inherits(x,'geos_geometry')) x <- sf::st_sf(geometry=sf::st_as_sfc(x))
  if (inherits(x,'sfc')) x <- sf::st_sf(geometry=x)
  if (inherits(x,'sfg')) x <- sf::st_sf(geometry=sf::st_sfc(x))
  if (!is.data.frame(x)) stop('Outside V1 validation scope: choose an sf layer or attribute table')
  x
}
dq_ids <- function(x, ref) {
  # The database primary key is project-generated, not a business identifier.
  pk <- attr(x,'ourgeo_source_pk')
  if (!is.null(pk) && pk %in% names(x)) paste0(dq_key(ref),':pk:',x[[pk]])
  else paste0(dq_key(ref),':row:',rownames(x))
}
dq_issue <- function(code, message, severity='blocked', rows=NULL, ref=NULL, field=NULL,
                     consequence=message, action='Change the data or parameters, then check again.', status=NULL) {
  list(stableCode=code, checkStatus=status %||% if(severity=='blocked') 'blocked' else 'warning',
       severity=severity, layerId=if(is.null(ref)) NULL else dq_key(ref), field=field,
       affectedCount=if(is.null(rows)) NULL else length(rows), rowIdentityReference=code, boundedExamples=as.list(head(rows,10)),
       message=message, consequence=consequence, suggestedActions=list(action),
       requiresAcknowledgment=severity=='warning', overridable=FALSE)
}
dq_geometry_crs <- function(x) tryCatch({declared<-sf::st_crs(x);if(is.na(declared)) declared else sf::st_crs(declared$wkt)},error=function(e) sf::NA_crs_)
dq_crs <- function(x) {
  crs <- dq_geometry_crs(x)
  if(is.null(crs)||is.na(crs)) return(list(known=FALSE,description=NULL,identifier=NULL,units=NULL))
  list(known=TRUE,description=crs$Name %||% crs$input, identifier=if(is.na(crs$epsg)) NULL else paste0('EPSG:',crs$epsg),
       wkt=crs$wkt, units=crs$units_gdal, geographic=isTRUE(sf::st_is_longlat(crs)))
}
dq_geometry_row <- function(g, crs) {
  tryCatch({
    s <- sf::st_sfc(g,crs=crs)
    if(isTRUE(sf::st_is_empty(s))) return(list(status='empty',reason='Empty geometry',type=class(g)[2],dimension=class(g)[1]))
    coordinates <- unlist(g,use.names=FALSE)
    if(!is.numeric(coordinates)||any(!is.finite(coordinates))) return(list(status='uncheckable',reason='Non-finite or unsupported coordinates',type=class(g)[2],dimension=class(g)[1]))
    old_s2<-sf::sf_use_s2()
    if(isTRUE(sf::st_is_longlat(s))) suppressMessages(sf::sf_use_s2(TRUE))
    on.exit(suppressMessages(sf::sf_use_s2(old_s2)),add=TRUE)
    if(isTRUE(sf::st_is_longlat(s)) && !identical(sf::st_crs(s)$units_gdal,'degree')) stop('This geographic validity path requires degree coordinates; transform a copy from its known CRS before checking geometry')
    if(isTRUE(sf::st_is_longlat(s))) tryCatch(loadNamespace('s2'),error=function(e) stop('Geographic data checks require a working s2 package. Run Settings → Health check and repair s2, then restart R. ',conditionMessage(e),call.=FALSE))
    why <- sf::st_is_valid(s,reason=TRUE,NA_on_exception=TRUE)
    valid <- sf::st_is_valid(s,NA_on_exception=TRUE)
    list(status=if(length(valid)!=1||is.na(valid)) 'uncheckable' else if(valid) 'valid' else 'invalid',
         reason=if(length(why)==1&&!is.na(why)) why else 'Validity could not be established',type=class(g)[2],dimension=class(g)[1])
  },error=function(e) list(status='uncheckable',reason=conditionMessage(e),type=class(g)[2] %||% 'UNKNOWN',dimension=class(g)[1] %||% 'UNKNOWN'))
}
dq_profile <- function(x, ref, geometry=NULL) {
  ids <- dq_ids(x,ref); spatial <- inherits(x,'sf')
  if(spatial && is.null(geometry)) geometry <- lapply(sf::st_geometry(x),dq_geometry_row,crs=dq_geometry_crs(x))
  fields <- lapply(setdiff(names(x),if(spatial) attr(x,'sf_column') else character()),function(nm) {
    v <- x[[nm]]
    list(name=nm,type=paste(class(v),collapse='/'),nullCount=sum(is.na(v)),
         blankCount=if(is.character(v)||is.factor(v)) sum(!is.na(v)&grepl('^\\s*$',as.character(v))) else 0,
         nonFiniteCount=if(is.numeric(v)) sum(!is.na(v)&!is.finite(v)) else 0,
         duplicateCount=if(is.atomic(v)) sum(duplicated(v[!is.na(v)])) else NULL,
         units=if(inherits(v,'units')) units::deparse_unit(v) else NULL)
  })
  summary <- if(spatial) setNames(lapply(c('valid','invalid','empty','uncheckable'),function(s) sum(vapply(geometry,function(g) g$status==s,logical(1)))),c('valid','invalid','empty','uncheckable')) else NULL
  list(layerId=dq_key(ref),sourceName=ref$name,totalRows=nrow(x),selectedRows=length(ref$rows %||% seq_len(nrow(x))),
       identityKind=if(!is.null(attr(x,'ourgeo_source_pk'))) 'project database primary key' else 'project source row identity (revision bound)',
       fields=fields,crs=if(spatial) dq_crs(x) else NULL,
       geometry=summary,geometryTypes=if(spatial) as.list(unique(vapply(geometry,`[[`,'','type'))) else list(),
       dimensions=if(spatial) as.list(unique(vapply(geometry,`[[`,'','dimension'))) else list(),
       extent=if(spatial) as.list(tryCatch(unname(sf::st_bbox(x)),error=function(e) rep(NA_real_,4))) else NULL,
       geometryCheck=if(spatial) {if(summary$uncheckable>0) 'check_failed' else if(summary$invalid>0||summary$empty>0) 'warning' else 'passed'} else 'not_applicable', geometryRows=geometry,
       rowIdentities=as.list(ids))
}
# Strict transformations use installed resources only. The prior session/network
# settings survive errors and interrupts; partial/ballpark loss is never approved.
dq_transform <- function(x,target) {
  old_network <- Sys.getenv('PROJ_NETWORK',unset=NA_character_)
  old_axis <- sf::st_axis_order()
  old_proj_network <- suppressWarnings(sf::sf_proj_network())
  on.exit({sf::sf_proj_network(old_proj_network);sf::st_axis_order(old_axis); if(is.na(old_network)) Sys.unsetenv('PROJ_NETWORK') else Sys.setenv(PROJ_NETWORK=old_network)})
  Sys.setenv(PROJ_NETWORK='OFF');sf::sf_proj_network(FALSE); sf::st_axis_order(FALSE)
  network_disabled<-withCallingHandlers(sf::sf_proj_network(),warning=function(w) stop('Installed-resource transformation cannot confirm that GDAL and PROJ networking are both disabled. Restart R with networking disabled.'))
  if(!identical(network_disabled,FALSE)) stop('The installed projection engine could not disable networking; transformation is blocked')
  dst <- sf::st_crs(target)
  if(is.na(sf::st_crs(x))||is.na(dst)||!sf::st_can_transform(sf::st_crs(x),dst)) stop('A supported source-to-target transformation is unavailable')
  if(utils::compareVersion(sf::sf_extSoftVersion()[['GDAL']],'3.3.0')<0) stop('Strict transformations require GDAL 3.3 or newer; no ballpark fallback')
  if(isTRUE(sf::st_crs(x)==dst)) return(x)
  out <- sf::st_transform(x,dst,allow_ballpark=FALSE,partial=FALSE)
  if(nrow(out)!=nrow(x)) stop('Transformation changed feature count')
  if(!identical(vapply(sf::st_geometry(x),function(g) class(g)[1],''),vapply(sf::st_geometry(out),function(g) class(g)[1],''))) stop('Transformation changed coordinate dimensions; no silent Z/M loss is supported')
  old_empty <- sf::st_is_empty(x); new_empty <- sf::st_is_empty(out)
  if(any(new_empty & !old_empty)) stop('Transformation produced newly empty geometries')
  if(any(vapply(sf::st_geometry(out),function(g) any(!is.finite(unlist(g))),logical(1)))) stop('Transformation produced non-finite coordinates')
  out
}

dq_spatial_ops <- c('sf-buffer','sf-intersection','sf-difference','sf-erase','sf-clip','sf-union-dissolve','sf-union-merge','sf-spatial-filter','sf-spatial-join','sf-add-area','sf-add-length','sf-transform','assign-crs','geos-buffer','geos-area','geos-distance','geos-intersection','geos-difference','geos-union')
dq_join_ops <- paste0(c('left','right','inner','full','anti','semi'),'-join')
dq_output_name <- function(name) {
  if(!is.character(name)||length(name)!=1L||is.na(name)||!identical(make.names(name),name)||!grepl('^[A-Za-z.][A-Za-z0-9._]*$',name)) return(FALSE)
  reserved<-c('.GlobalEnv','.BaseNamespaceEnv','.EmptyEnv','dq_state','dq_review_authority')
  if(exists('.ourgeo_env',envir=.GlobalEnv,inherits=FALSE)) reserved<-c(reserved,.ourgeo_env$system_names)
  else reserved<-c(reserved,ls(.GlobalEnv,pattern='^dq_'))
  !name %in% reserved && !startsWith(name,'.ourgeo')
}
dq_inputs <- function(request) {
  if(!is.list(request$inputs)||!length(request$inputs)) stop('Choose at least one existing input layer or attribute table')
  lapply(request$inputs,function(ref) {
    x <- dq_object(ref); ids <- dq_ids(x,ref)
    source_rows <- function(values) {
      values<-unlist(values)
      if(length(values) && (!is.numeric(values)||any(!is.finite(values))||any(values!=floor(values))||any(values<0|values>=nrow(x)))) stop('Source row indices must be finite whole numbers within the input revision')
      as.integer(values)+1L
    }
    rows <- if(is.null(ref$rows)) seq_len(nrow(x)) else source_rows(ref$rows)
    if(anyNA(rows)||any(rows<1|rows>nrow(x))||anyDuplicated(rows)) stop('Selection contains invalid source rows')
    excluded <- source_rows(ref$excludedRows %||% list())
    if(anyNA(excluded)||any(!excluded %in% rows)||anyDuplicated(excluded)) stop('Exclusions must name selected source rows')
    if(length(excluded) && !nzchar(ref$exclusionReason %||% '')) stop('Record a reason for the explicit exclusions')
    included <- setdiff(rows,excluded)
    list(original=x,object=x[included,,drop=FALSE],ref=ref,revision=dq_hash(x),rows=included,selected=rows,excluded=excluded,ids=ids)
  })
}

dq_join_plan <- function(a,b,p) {
  if(!p$leftkey %in% names(a)||!p$rightkey %in% names(b)) stop('Choose existing join keys on both sides')
  l <- a[[p$leftkey]]; r <- b[[p$rightkey]]
  if(!identical(class(l),class(r))||!is.atomic(l)||!is.atomic(r)||!class(l)[1] %in% c('character','integer','numeric','logical','factor','Date','POSIXct','units')) stop('Join key types differ or are unsupported. Use an explicit type-conversion tool first.')
  if(inherits(l,'units')&&!identical(units::deparse_unit(l),units::deparse_unit(r))) stop('Join key units differ; no implicit unit conversion is supported')
  if(inherits(l,'POSIXct')&&!identical(attr(l,'tzone'),attr(r,'tzone'))) stop('Join key timezone declarations differ; prepare them explicitly first')
  bad <- function(v) is.na(v) | if(is.character(v)||is.factor(v)) grepl('^\\s*$',as.character(v)) else FALSE
  lb <- bad(l); rb <- bad(r)
  # Match exact typed keys. Blank and missing keys never match; no source field
  # is trimmed, case folded, coerced, deduplicated or converted to null.
  keys <- unique(c(l[!lb],r[!rb])); li <- match(l,keys); ri <- match(r,keys)
  li[lb] <- NA_integer_; ri[rb] <- NA_integer_
  lc <- tabulate(li,nbins=max(1,length(keys))); rc <- tabulate(ri,nbins=max(1,length(keys)))
  matches <- split(which(!rb),ri[!rb]); pairs <- vector('list',length(l))
  kind <- p$joinType
  if(kind %in% c('right','full') && is.factor(l) && !identical(levels(l),levels(r))) stop('Factor keys have different levels; a right/full join could lose unmatched key values. Use an explicit type-conversion tool first.')
  for(i in seq_along(l)) {
    right <- if(is.na(li[i])) integer() else matches[[as.character(li[i])]] %||% integer()
    pairs[[i]] <- if(kind=='semi') {if(length(right)) matrix(c(i,NA_integer_),nrow=1) else NULL}
      else if(kind=='anti') {if(!length(right)) matrix(c(i,NA_integer_),nrow=1) else NULL}
      else if(length(right)) cbind(i,right)
      else if(kind %in% c('left','full')) matrix(c(i,NA_integer_),nrow=1) else NULL
  }
  matched_r <- !rb & !is.na(ri) & lc[ifelse(is.na(ri),1,ri)]>0
  # cbind(NA_integer_, integer()) is a one-column matrix, not an empty
  # two-column pair table. Fully matched right/full joins must append no rows.
  if(kind %in% c('right','full') && any(!matched_r)) pairs <- c(pairs,list(cbind(NA_integer_,which(!matched_r))))
  pair <- do.call(rbind,pairs); if(is.null(pair)) pair <- matrix(integer(),ncol=2)
  matched_l <- !lb & !is.na(li) & rc[ifelse(is.na(li),1,li)]>0
  list(joinType=kind,leftKey=p$leftkey,rightKey=p$rightkey,keyTypes=list(left=class(l),right=class(r)),leftRows=length(l),rightRows=length(r),
       nullLeft=sum(is.na(l)),nullRight=sum(is.na(r)),blankLeft=sum(lb&!is.na(l)),blankRight=sum(rb&!is.na(r)),missingLeft=sum(lb),missingRight=sum(rb),duplicateLeft=sum(lc>1),duplicateRight=sum(rc>1),
       unmatchedLeft=sum(!matched_l),unmatchedRight=sum(!matched_r),predictedRows=nrow(pair),
       relationship=p$relationship %||% 'many-to-one',keyPolicy='Exact typed keys; missing and blank keys never match',
       suffixes=list(p$suffixLeft %||% '.x',p$suffixRight %||% '.y'),pairs=pair,
       keyRows=list(left=list(missing=which(lb),duplicate=which(!lb & lc[ifelse(is.na(li),1,li)]>1),unmatched=which(!matched_l)),
                    right=list(missing=which(rb),duplicate=which(!rb & rc[ifelse(is.na(ri),1,ri)]>1),unmatched=which(!matched_r))))
}

dq_validate <- function(request, loaded=NULL, profiles=NULL) {
  input <- loaded %||% dq_inputs(request)
  p <- request$parameters %||% list(); op <- request$operationType
  if(is.null(profiles)) profiles <- lapply(input,function(i) dq_profile(i$original,i$ref))
  issues <- list(); records <- list()
  add <- function(code,msg,severity='blocked',rows=NULL,index=1L,field=NULL,status=NULL,action=NULL) {
    ref <- if(length(input)>=index) input[[index]]$ref else NULL
    ids <- if(is.null(rows)) NULL else if(length(input)>=index) input[[index]]$ids[rows] else character()
    item <- dq_issue(paste0(code,':',index,if(!is.null(field)) paste0(':',field) else ''),msg,severity,ids,ref,field,status=status)
    if(!is.null(action)) item$suggestedActions <- list(action)
    issues[[length(issues)+1L]] <<- item; records[[item$rowIdentityReference]] <<- as.list(ids)
  }
  supported <- c('inspect',dq_spatial_ops,dq_join_ops,'group-summarize','export-gpkg','export-geojson')
  binary<-c(dq_join_ops,'sf-intersection','sf-difference','sf-erase','sf-clip','sf-union-merge','sf-spatial-filter','sf-spatial-join','geos-distance','geos-intersection','geos-difference')
  expected_inputs<-if(op %in% binary) 2L else 1L
  if(op!='inspect' && op %in% supported && length(input)!=expected_inputs) add('OP-INPUT-COUNT',paste('This operation requires exactly',expected_inputs,'input datasets; no input is silently ignored.'))
  if(!op %in% supported) add('OP-UNSUPPORTED','This operation has no controlled V1 validation integration.',status='not_checked')
  for(k in seq_along(input)) {
    i <- input[[k]]; profile <- profiles[[k]]
    if(length(i$excluded)) add('SCOPE-EXCLUSIONS',sprintf('%d of %d selected source rows will be excluded: %s',length(i$excluded),length(i$selected),i$ref$exclusionReason),'warning',i$excluded,k)
    if(op!='inspect' && !length(i$rows)) add('SCOPE-EMPTY','No eligible input rows remain.',index=k)
    if(op %in% dq_spatial_ops) {
      if(!inherits(i$object,'sf')) { add('SCOPE-TYPE','Spatial checks require an sf layer with declared CRS. Raw geos data has no supported CRS/units contract.',index=k); next }
      if(op!='assign-crs' && !isTRUE(profile$crs$known)) add('CRS-MISSING','The CRS is missing or unparseable. Inspect attributes or explicitly assign the known coordinate CRS.',rows=i$rows,index=k)
      if(!op %in% c('assign-crs','sf-transform')) {
        dimension_rows<-i$rows[vapply(profile$geometryRows[i$rows],function(g) !g$dimension %in% c('XY','UNKNOWN'),logical(1))]
        if(length(dimension_rows)) add('GEO-DIMENSIONS','This V1 analytical path validates XY geometry only. It cannot silently flatten Z/M.',rows=dimension_rows,index=k)
        for(status in c('invalid','empty','uncheckable')) {
          rows <- i$rows[vapply(profile$geometryRows[i$rows],function(g) g$status==status,logical(1))]
          if(length(rows)) {
            reason <- if(status=='uncheckable') paste(unique(vapply(profile$geometryRows[rows],`[[`,'','reason'))[1],collapse='') else ''
            add(paste0('GEO-',toupper(status)),paste(length(rows),status,'geometries cannot enter this spatial operation. No repair or exclusion is automatic.',reason),rows=rows,index=k,status=if(status=='uncheckable') 'check_failed' else 'blocked')
          }
        }
      }
    }
    if(inherits(i$original,'sf') && isTRUE(profile$crs$geographic) && identical(profile$crs$units,'degree')) {
      coords <- tryCatch(sf::st_coordinates(i$object),error=function(e) NULL)
      if(!is.null(coords)&&nrow(coords)>0 && any(abs(coords[,'X'])>180|abs(coords[,'Y'])>90,na.rm=TRUE)) add('CRS-PLAUSIBILITY','Coordinates exceed longitude/latitude bounds for the declared CRS. This does not establish the correct CRS.',if(op %in% dq_spatial_ops && op!='assign-crs') 'blocked' else 'info',index=k)
    }
    if(inherits(i$object,'sf') && isTRUE(profile$crs$known) && !isTRUE(profile$crs$geographic)) {
      epsg<-tryCatch(sf::st_crs(i$object)$epsg,error=function(e) NA_integer_)
      bb<-tryCatch(sf::st_bbox(i$object),error=function(e) rep(NA_real_,4))
      if(!is.na(epsg) && (epsg %in% c(32601:32660,32701:32760)) && all(is.finite(bb)) && all(abs(bb[c(1,3)])<=180) && all(abs(bb[c(2,4)])<=90)) add('CRS-PLAUSIBILITY','The declared UTM metre CRS has coordinates resembling angular ranges. This is a plausibility finding, not evidence of a replacement CRS.',if(op %in% dq_spatial_ops && op!='assign-crs') 'warning' else 'info',index=k)
    }
    if(op=='inspect' && inherits(i$original,'sf')) {
      if(!isTRUE(profile$crs$known)) add('CRS-MISSING','CRS is unknown; attribute inspection is available. Spatial correspondence is not established.','info',index=k,status='not_checked')
      for(status in c('invalid','empty','uncheckable')) {
        rows <- which(vapply(profile$geometryRows,function(g) g$status==status,logical(1)))
        if(length(rows)) add(paste0('GEO-',toupper(status)),paste(length(rows),status,'geometries. See affected source rows and reasons.'),'info',rows,k,status=if(status=='uncheckable') 'check_failed' else 'warning')
      }
    }
  }
  plan <- list(workingCRS=NULL,method=NULL,inputAndOutputUnits=NULL,explicitTransformations=list(),
    includedAndExcludedRows=lapply(input,function(i) list(layerId=dq_key(i$ref),selectedCount=length(i$selected),includedCount=length(i$rows),excludedCount=length(i$excluded),includedReference=paste0(dq_key(i$ref),':included'),excludedReference=paste0(dq_key(i$ref),':excluded'),reason=i$ref$exclusionReason)),
    joinPolicy=NULL,missingValuePolicy=NULL,exportProfileAndOptions=NULL)
  for(i in input) {records[[paste0(dq_key(i$ref),':included')]] <- as.list(i$ids[i$rows]);records[[paste0(dq_key(i$ref),':excluded')]] <- as.list(i$ids[i$excluded])}
  if(op!='inspect' && !op %in% c('export-gpkg','export-geojson') && !is.null(p$out)) {
    if(!dq_output_name(p$out)) add('OUTPUT-NAME','Choose a simple derived R object name; application internals and reserved names cannot be replaced.')
    if(any(vapply(input,function(i) p$out==(i$ref$name %||% i$ref$accessPath),logical(1)))) add('OUTPUT-SOURCE','Choose a derived output name; controlled data checks preserve source objects.')
    else if(exists(p$out,envir=resolve_env(request$outputEnv %||% '.GlobalEnv'),inherits=FALSE)) add('OUTPUT-REPLACE',paste('The existing result object',p$out,'will be replaced.'),'warning')
  }
  blocked <- function() any(vapply(issues,function(i) i$severity=='blocked',logical(1)))
  if(op %in% c('export-gpkg','export-geojson')) {
    if(!blocked()) tryCatch({
      plan$exportProfileAndOptions<-dq_export_plan(input[[1]],profiles[[1]],p,op,add)
      plan$workingCRS<-plan$exportProfileAndOptions$destinationCRS
      plan$method<-'Staged GDAL vector write with complete readback verification'
      plan$workingCRSDescription<-if(op=='export-geojson') 'WGS 84 longitude/latitude (RFC 7946)' else profiles[[1]]$crs$description
      plan$inputAndOutputUnits<-list(input=lapply(profiles,function(profile) profile$crs$units),parameter=NULL,output=if(op=='export-geojson') 'degree (Z, if declared, metres)' else profiles[[1]]$crs$units)
      dq_export_prepare(input[[1]],plan$exportProfileAndOptions)
    },error=function(e)add('EXP-PROFILE',conditionMessage(e)))
  }
  if(op %in% dq_spatial_ops && !blocked()) {
    tryCatch({
      x <- input[[1]]$object; source <- sf::st_crs(x)
      target_text <- p$workingCRS %||% 'native'
      if(op %in% c('sf-transform','assign-crs')) target_text <- p$crs %||% ''
      if(target_text %in% c('auto','')) stop('Choose a known working CRS or the explicit native/S2 method. No UTM zone is inferred.')
      target <- if(target_text=='native') source else sf::st_crs(if(grepl('^[0-9]+$',target_text)) as.integer(target_text) else target_text)
      if(is.na(target)) stop('The chosen CRS is unparseable')
      geographic <- isTRUE(sf::st_is_longlat(sf::st_sfc(sf::st_point(c(0,0)),crs=target)))
      plan$workingCRS <- target$wkt
      plan$workingCRSDescription <- target$Name %||% target$input
      plan$method <- if(op=='assign-crs') 'Assign CRS metadata; coordinates unchanged' else if(geographic) 'S2 spherical metric' else 'Projected planar (GEOS)'
      if(op=='sf-transform') plan$method<-'PROJ coordinate transformation (installed resources; traditional GIS x/y)'
      if(op=='sf-buffer'&&!geographic&&'sfarc' %in% loadedNamespaces()&&tolower(p$linearize %||% 'false')!='true') plan$method <- 'Projected planar (sfarc exact curved buffer)'
      plan$inputAndOutputUnits <- list(input=lapply(profiles,function(pr) pr$crs$units),parameter=if(op %in% c('sf-buffer','geos-buffer')) p$units %||% 'm' else NULL,output=if(op=='sf-add-area'||op=='geos-area') 'm^2' else if(op %in% c('sf-add-length','geos-distance')) 'm' else if(op %in% c('sf-transform','assign-crs')) target$units_gdal else profiles[[1]]$crs$units)
      if(op %in% c('sf-add-area','sf-add-length') && (p$colname %||% if(op=='sf-add-area') 'area' else 'length') %in% names(x)) add('FIELD-REPLACE','The chosen measurement column already exists and will be replaced in the derived copy. Choose a new column name to retain it.','warning',input[[1]]$rows,field=p$colname)
      if(op=='assign-crs') add('CRS-ASSIGN','Assign CRS: these existing coordinates are already expressed in the chosen CRS. Values will not change.','warning')
      if(op=='sf-buffer'||op=='geos-buffer') {
        distance <- suppressWarnings(as.numeric(p$dist))
        if(length(distance)!=1||!is.finite(distance)||distance<=0) stop('Positive buffer distance must be finite and greater than zero')
        unit <- p$units %||% 'm'
        if(!unit %in% c('m','km','ft','US_survey_foot','mi')) stop('Select metres, kilometres, international feet, US survey feet or miles; angular degrees are not metres')
        units::set_units(units::set_units(distance,unit,mode='standard'),'m',mode='standard')
        segments <- as.numeric(if(op=='geos-buffer') p$quad_segs %||% 30 else p$nquadsegs %||% 30)
        if(length(segments)!=1||!is.finite(segments)||segments<1||segments!=floor(segments)||segments>10000) stop('Segments per quadrant must be an integer from 1 to 10000')
        cells <- as.numeric(p$maxCells %||% 10000)
        if(length(cells)!=1||!is.finite(cells)||cells<1||cells!=floor(cells)||cells>1000000) stop('S2 cell budget must be a positive integer no greater than 1000000')
        plan$methodSettings<-list(bufferDistance=distance,bufferDistanceUnit=unit,maxCells=if(geographic) as.integer(cells) else NULL,segmentsPerQuadrant=if(!geographic&&!grepl('sfarc exact',plan$method)) as.integer(segments) else NULL)
      }
      if(startsWith(op,'geos-')) {
        if(!requireNamespace('geos',quietly=TRUE)) stop('This tool requires geos; run Settings → Health check')
        plan$method<-'Projected planar (geos native element-wise operations)'
        if(length(input)>1 && !(nrow(input[[1]]$object)==nrow(input[[2]]$object) || min(nrow(input[[1]]$object),nrow(input[[2]]$object))==1)) stop('Native geos element-wise inputs must have equal row counts or one side must have one row')
      }
      if(op %in% c('sf-buffer','geos-buffer','sf-add-area','sf-add-length','geos-area','geos-distance') && !geographic && is.null(target$ud_unit)) stop('The projected CRS has no supported linear-unit conversion')
      if(geographic && !op %in% c('assign-crs','sf-transform') && !identical(target$units_gdal,'degree')) stop('S2 requires degree coordinate units. Explicitly transform a copy to a supported geographic or projected CRS first.')
      if(geographic && startsWith(op,'geos-')) stop('This planar GEOS workflow requires an explicitly chosen projected working CRS')
      if(geographic && op %in% c('sf-buffer','sf-add-area','sf-add-length') && (p$method %||% 's2')!='s2') stop('Geographic metric measurements require the explicit S2 method; degrees cannot be interpreted as metres')
      if(geographic && any(op %in% c('sf-intersection','sf-difference','sf-erase','sf-clip','sf-union-dissolve','sf-union-merge','sf-spatial-filter','sf-spatial-join'))) plan$method <- 'S2 spherical topology'
      for(k in seq_along(input)) {
        if(op=='assign-crs') next
        src <- sf::st_crs(input[[k]]$object)
        if(!isTRUE(src==target)) {
          # A real test on all operation rows proves resources and failure/loss
          # behavior before approval, not merely that the CRS has an EPSG number.
          curved<-any(grepl('CURVE|CIRCULAR|SURFACE',vapply(profiles[[k]]$geometryRows[input[[k]]$rows],function(g)g$type,'')))
          if(curved) stop('This strict V1 transform cannot establish exact preservation of curved inputs; use a supported separately reviewed workflow')
          if(grepl('sfarc exact',plan$method)) stop('Returning an exact curved buffer through a different projection cannot establish arc preservation. Explicitly choose polygon approximation, or transform a copy first and buffer in its native projected CRS.')
          transformed<-dq_transform(input[[k]]$object,target)
          if(!op %in% c('assign-crs','sf-transform')) {
            checks<-lapply(sf::st_geometry(transformed),dq_geometry_row,crs=target)
            if(any(vapply(checks,function(g)g$status!='valid',logical(1)))) stop('The working-CRS transformation produced invalid, empty or uncheckable geometry')
          }
          plan$explicitTransformations[[length(plan$explicitTransformations)+1]] <- list(layerId=dq_key(input[[k]]$ref),source=src$wkt,target=target$wkt,allowBallpark=FALSE,partial=FALSE,network=FALSE,axisOrder='traditional GIS x/y')
          add('CRS-TRANSFORM','Coordinates will be transformed to the specified working CRS using installed resources; ballpark and partial transformations are disabled.','warning',rows=input[[k]]$rows,index=k)
        }
      }
      if(!geographic && any(vapply(seq_along(input),function(k) {
        if(!isTRUE(profiles[[k]]$crs$geographic)) return(FALSE)
        bb<-sf::st_bbox(input[[k]]$object)
        all(is.finite(bb)) && ((bb[['xmax']]-bb[['xmin']])>6 || max(abs(bb[c('ymin','ymax')]))>84)
      },logical(1)))) add('CRS-EXTENT','The geographic input extent is broad, spans multiple zones or is near a pole. The projected CRS is your explicit choice; its analytical suitability and ground accuracy are not established.','warning')
      if(length(input)>1 && !isTRUE(sf::st_crs(input[[1]]$object)==sf::st_crs(input[[2]]$object)) && target_text=='native') stop('Different CRSs require an explicit working-CRS plan; choose the CRS in the dialog')
      if(op=='sf-buffer' && !geographic && tolower(p$linearize %||% 'false')=='true') add('GEO-APPROXIMATION','The buffer will use a GEOS polygon approximation with the specified segments per quadrant. Source geometry is unchanged.','warning')
      if(!op %in% c('assign-crs','sf-transform') && any(vapply(seq_along(profiles),function(k) any(grepl('CURVE|CIRCULAR|SURFACE',vapply(profiles[[k]]$geometryRows[input[[k]]$rows],function(g)g$type,''))),logical(1)))) stop('Curved inputs need a separately reviewed exact/linearisation workflow; V1 will not silently flatten them')
    },error=function(e) add('CRS-METHOD',conditionMessage(e),status='check_failed'))
  }
  if(op %in% dq_join_ops && !blocked()) {
    tryCatch({
      p$joinType <- sub('-join$','',op)
      if(inherits(input[[2]]$object,'sf')) stop('The right join input must be an attribute table; explicitly prepare its geometry separately')
      j <- dq_join_plan(input[[1]]$object,input[[2]]$object,p)
      rel <- j$relationship
      if(!rel %in% c('one-to-one','many-to-one','one-to-many','many-to-many')) stop('Choose a supported join relationship')
      for(k in 1:2) {
        key<-if(k==1) p$leftkey else p$rightkey
        found<-j$keyRows[[k]]
        violates<-if(k==1) rel %in% c('one-to-one','one-to-many') else rel %in% c('one-to-one','many-to-one')
        if(length(found$duplicate)) add('JOIN-CARDINALITY',sprintf('%d source rows contain repeated %s keys. %s',length(found$duplicate),key,if(violates) 'They violate the declared relationship; change it deliberately or change the data.' else 'The declared relationship permits these keys; no first-match selection or deduplication occurs.'),if(violates) 'blocked' else 'info',input[[k]]$rows[found$duplicate],k,key)
        if(length(found$missing)) add('JOIN-MISSING',sprintf('%d source rows have missing/blank %s keys and will never match.',length(found$missing),key),'warning',input[[k]]$rows[found$missing],k,key)
        if(length(found$unmatched)) add('JOIN-UNMATCHED',sprintf('%d of %d source rows have no matching key on the other side.',length(found$unmatched),nrow(input[[k]]$object)),'info',input[[k]]$rows[found$unmatched],k,key)
      }
      if(j$predictedRows>j$leftRows || rel=='many-to-many') add('JOIN-EXPANSION',sprintf('%s %s join: predicted %d result rows from %d left and %d right source rows; unmatched source rows: left %d, right %d.',rel,j$joinType,j$predictedRows,j$leftRows,j$rightRows,j$unmatchedLeft,j$unmatchedRight),'warning')
      left_names <- names(input[[1]]$object); right_names <- setdiff(names(input[[2]]$object),p$rightkey)
      collision <- intersect(left_names,right_names)
      suffix <- unlist(j$suffixes)
      names_after <- c(ifelse(left_names %in% collision,paste0(left_names,suffix[1]),left_names),ifelse(right_names %in% collision,paste0(right_names,suffix[2]),right_names))
      if(anyDuplicated(names_after)) stop('Chosen suffixes still collide with source field names. Choose distinct suffixes.')
      if(length(collision)) add('JOIN-COLLISION',paste('Fields receive explicit left/right suffixes:',paste(collision,collapse=', '),paste(suffix,collapse=' / ')),'warning')
      j$pairs <- NULL;j$keyRows<-NULL; plan$joinPolicy <- j
    },error=function(e) add('JOIN-KEYS',conditionMessage(e)))
  }
  if(op=='group-summarize' && !blocked()) {
    tryCatch({
      x <- input[[1]]$object; field <- p$aggcol; fn <- p$fn %||% 'sum'
      if(!p$groupcol %in% names(x)) stop('Choose an existing grouping field')
      if(!fn %in% c('sum','mean','n','min','max','sd','median')) stop('Unsupported summary function')
      v <- x[[field]]
      if(fn!='n' && (!field %in% names(x)||!is.numeric(v))) stop('Choose a numeric summary field')
      bad <- if(fn=='n') rep(FALSE,nrow(x)) else is.na(v)|!is.finite(v)
      policy <- p$missingPolicy %||% 'block'
      if(!policy %in% c('block','propagate','omit')) stop('Choose a supported missing-value policy')
      plan$missingValuePolicy <- list(policy=policy,totalRows=nrow(x),missingOrNonFinite=sum(bad),usableRows=sum(!bad),units=if(inherits(v,'units')) units::deparse_unit(v) else NULL,allMissingResult='NA, never implicit zero',geometryPolicy='Attribute summary; result is a table without geometry')
      if(any(bad)) add('SUM-MISSING',sprintf('%d of %d rows in %s are missing/non-finite. Policy: %s. Per-group denominators are included in the result.',sum(bad),nrow(x),field,policy),if(policy=='block') 'blocked' else 'warning',input[[1]]$rows[bad],field=field)
      if(p$newcol %in% c(p$groupcol,'.total_rows','.used_rows','.missing_rows')) stop('Summary result name collides with grouping or denominator fields')
    },error=function(e) add('SUM-FIELD',conditionMessage(e)))
  }
  if(!is.null(p$out)) {
    output_env<-resolve_env(request$outputEnv %||% '.GlobalEnv')
    plan$outputRevision<-if(exists(p$out,envir=output_env,inherits=FALSE)) dq_hash(get(p$out,envir=output_env,inherits=FALSE)) else NULL
  }
  fingerprint_request <- request
  fingerprint_request$inputs <- lapply(request$inputs,function(ref) {ref$selectionVersion<-NULL;ref})
  fingerprint <- dq_hash(list(request=fingerprint_request,revisions=lapply(input,`[[`,'revision'),plan=plan))
  list(schemaVersion=1L,operationType=op,operationId=request$operationId %||% fingerprint,
       inputRevisions=lapply(input,function(i) list(layerId=dq_key(i$ref),revision=i$revision)),
       selectionRevision=dq_hash(lapply(request$inputs,function(i) i$rows)),parametersDigest=dq_hash(p),validationFingerprint=fingerprint,
       status=if(blocked()) 'blocked' else if(any(vapply(issues,function(i) i$requiresAcknowledgment,logical(1)))) 'needs_confirmation' else 'ready',
       coverage=list(scope='entire operation input',complete=TRUE,rowsChecked=sum(vapply(input,function(i) length(i$selected),integer(1)))),
       checkedAt=format(Sys.time(),tz='UTC',usetz=TRUE),issues=issues,profiles=profiles,executionPlan=plan,acknowledgments=list(),rowRecords=records)
}

dq_buffer <- function(x,p,exact=FALSE) {
  distance<-units::set_units(as.numeric(p$dist),p$units %||% 'm',mode='standard')
  if(exact) return(sf::st_buffer(x,dist=distance))
  # Call sf's base sfc method explicitly when the approved plan says GEOS/S2.
  # sfarc registers more specific classes and would otherwise make exact arcs
  # even after a user selected a polygon approximation.
  method<-getS3method('st_buffer','sfc',envir=asNamespace('sf'))
  sf::st_set_geometry(x,method(sf::st_geometry(x),dist=distance,nQuadSegs=as.integer(p$nquadsegs %||% p$quad_segs %||% 30),max_cells=as.integer(p$maxCells %||% 10000)))
}

dq_join_result <- function(a,b,p,ids) {
  j <- dq_join_plan(a,b,p); pair <- j$pairs
  l <- pair[,1]; r <- pair[,2]
  if(j$joinType %in% c('anti','semi')) out <- a[l,,drop=FALSE]
  else {
    right <- setdiff(names(b),p$rightkey); left <- names(a)
    collision <- intersect(left,right); suffix <- unlist(j$suffixes)
    aa <- a[l,,drop=FALSE]; bb <- b[r,right,drop=FALSE]
    if(j$joinType %in% c('right','full')) {
      missing_left <- which(is.na(l))
      aa[[p$leftkey]][missing_left] <- b[[p$rightkey]][r[missing_left]]
    }
    names(aa) <- ifelse(left %in% collision,paste0(left,suffix[1]),left)
    names(bb) <- ifelse(right %in% collision,paste0(right,suffix[2]),right)
    rownames(aa) <- NULL; rownames(bb) <- NULL
    out <- cbind(aa,bb)
  }
  if(nrow(out)!=j$predictedRows) stop('Actual join cardinality differs from the approved prediction')
  attr(out,'ourgeo_trace') <- list(left=ids[[1]][l],right=ids[[2]][r])
  out
}
dq_summary <- function(x,p) {
  if(inherits(x,'sf')) x<-sf::st_drop_geometry(x)
  fn <- p$fn %||% 'sum'; field <- p$aggcol; policy <- p$missingPolicy %||% 'block'
  aggregate <- function(v) {
    bad <- is.na(v)|!is.finite(v)
    if((policy=='propagate'&&any(bad))||all(bad)) return(v[NA_integer_])
    if(policy=='omit') v <- v[!bad]
    do.call(fn,list(v))
  }
  grouped <- dplyr::group_by(x,.data[[p$groupcol]])
  if(fn=='n') dplyr::summarise(grouped,!!(p$newcol %||% 'value'):=dplyr::n(),.total_rows=dplyr::n(),.used_rows=dplyr::n(),.missing_rows=0L,.groups='drop')
  else dplyr::summarise(grouped,!!(p$newcol %||% 'value'):=aggregate(.data[[field]]),
    .total_rows=dplyr::n(),.used_rows=if(policy=='propagate') dplyr::n() else sum(!is.na(.data[[field]]) & is.finite(.data[[field]])),
    .missing_rows=sum(is.na(.data[[field]]) | !is.finite(.data[[field]])),.groups='drop')
}
# This helper is also the recorded R. Its request contains every actual policy;
# fingerprint checking prevents replay against a different source revision.
# User-authored R is outside the controlled HTTP consent boundary.
dq_run <- function(request,fingerprint,acknowledged=character()) {
  loaded <- dq_inputs(request); report <- dq_validate(request,loaded)
  if(!identical(report$validationFingerprint,fingerprint)) stop('Input revision or plan changed. Rerun preflight.')
  if(!report$status %in% c('ready','needs_confirmation')) stop('Preflight blocks this operation')
  required <- vapply(Filter(function(i)i$requiresAcknowledgment,report$issues),`[[`,'','stableCode')
  if(!all(required %in% acknowledged)) stop('Review the exact consequential choices before execution')
  op <- request$operationType; p <- request$parameters %||% list()
  if(op=='inspect') stop('Inspection does not execute an operation')
  if(op %in% dq_join_ops) {p$joinType<-sub('-join$','',op);result<-dq_join_result(loaded[[1]]$object,loaded[[2]]$object,p,lapply(loaded,function(i)i$ids[i$rows]))}
  else if(op=='group-summarize') result<-dq_summary(loaded[[1]]$object,p)
  else {
    old_s2 <- sf::sf_use_s2(); old_axis <- sf::st_axis_order()
    on.exit({suppressMessages(sf::sf_use_s2(old_s2)); sf::st_axis_order(old_axis)},add=TRUE)
    suppressMessages(sf::sf_use_s2(TRUE));sf::st_axis_order(FALSE)
    target <- sf::st_crs(report$executionPlan$workingCRS)
    x <- loaded[[1]]$object
    if(op=='assign-crs') result <- suppressWarnings(sf::st_set_crs(x,target))
    else {
      objects <- lapply(loaded,function(i) dq_transform(i$object,target)); x<-objects[[1]];y<-if(length(objects)>1) objects[[2]] else NULL
      result <- switch(op,
        'sf-transform'=x,
        'sf-buffer'=dq_buffer(x,p,exact=grepl('sfarc exact',report$executionPlan$method)),
        'geos-buffer'=geos::geos_buffer(geos::as_geos_geometry(x),as.numeric(units::set_units(units::set_units(as.numeric(p$dist),p$units %||% 'm',mode='standard'),units::deparse_unit(target$ud_unit),mode='standard')),params=geos::geos_buffer_params(quad_segs=as.integer(p$quad_segs %||% 30))),
        'sf-add-area'={x[[p$colname %||% 'area']]<-units::set_units(sf::st_area(x),'m^2',mode='standard');x},
        'sf-add-length'={x[[p$colname %||% 'length']]<-units::set_units(sf::st_length(x),'m',mode='standard');x},
        'geos-area'=units::set_units(units::set_units(geos::geos_area(geos::as_geos_geometry(x)),paste0(units::deparse_unit(target$ud_unit),'^2'),mode='standard'),'m^2',mode='standard'),
        'geos-distance'=units::set_units(units::set_units(geos::geos_distance(geos::as_geos_geometry(x),geos::as_geos_geometry(y)),units::deparse_unit(target$ud_unit),mode='standard'),'m',mode='standard'),
        'sf-intersection'=sf::st_intersection(x,y),'geos-intersection'=geos::geos_intersection(geos::as_geos_geometry(x),geos::as_geos_geometry(y)),
        'sf-difference'=sf::st_difference(x,y),'geos-difference'=geos::geos_difference(geos::as_geos_geometry(x),geos::as_geos_geometry(y)),
        'sf-erase'=sf::st_difference(x,sf::st_union(y)),'sf-clip'=sf::st_intersection(x,sf::st_union(y)),
        'sf-union-dissolve'=sf::st_union(x),'geos-union'=geos::geos_unary_union(geos::as_geos_geometry(x)),
        'sf-union-merge'=sf::st_union(dplyr::bind_rows(x,y)),
        'sf-spatial-filter'={pred<-p$pred %||% 'st_intersects';if(!pred %in% c('st_intersects','st_within','st_contains','st_overlaps','st_touches','st_crosses','st_disjoint')) stop('Unsupported predicate');sf::st_filter(x,y,.predicate=getExportedValue('sf',pred))},
        'sf-spatial-join'=sf::st_join(x,y,join=sf::st_intersects,left=(p$join %||% 'left')!='inner'),
        stop('Unsupported controlled operation'))
      if(inherits(result,'geos_geometry')) result<-geos::as_geos_geometry(dq_transform(sf::st_sf(geometry=sf::st_as_sfc(result)),sf::st_crs(loaded[[1]]$object)))
      if(inherits(result,'sfc')) result<-sf::st_geometry(dq_transform(sf::st_sf(geometry=result),sf::st_crs(loaded[[1]]$object)))
      if(inherits(result,'sf') && !op %in% c('sf-transform','sf-add-area','sf-add-length')) result <- dq_transform(result,sf::st_crs(loaded[[1]]$object))
    }
  }
  output_checks<-if(inherits(result,c('sf','sfc','geos_geometry'))) {
    g<-if(inherits(result,'geos_geometry')) sf::st_as_sfc(result) else sf::st_geometry(result)
    if(op %in% dq_spatial_ops && op!='assign-crs' && any(vapply(g,function(v) any(!is.finite(unlist(v))),logical(1)))) stop('The result has non-finite coordinates; no output was assigned')
    list(featureCount=length(g),geometryTypes=as.list(unique(as.character(sf::st_geometry_type(g)))),geometryValidation='Not a certification; inspect the derived result before a further operation')
  } else list(rowCount=if(is.data.frame(result)) nrow(result) else length(result))
  attr(result,'ourgeo_validation') <- list(outputChecks=output_checks,schemaVersion=1L,fingerprint=fingerprint,operationType=op,
    inputRevisions=report$inputRevisions,executionPlan=report$executionPlan,acknowledgments=as.list(acknowledged),rowRecords=report$rowRecords)
  result
}
dq_public <- function(report) {
  report$rowRecords <- NULL
  report$profiles <- lapply(report$profiles,function(p) {p$geometryRows<-NULL;p$rowIdentities<-NULL;p})
  report
}
# Use R's own literal printer: the code is the checked request, with readable
# parameters rather than an escaped JSON transport envelope. Retain the exact
# fingerprint and approved choices so editing a request never reuses permission.
dq_execution_code <- function(request,report) {
  literal <- paste(deparse(request,width.cutoff=60L,control=c('keepInteger','keepNA','niceNames','showAttributes')),collapse='\n  ')
  ack <- vapply(report$acknowledgments,`[[`,'','issueCode')
  call <- paste0('dq_run(\n  request = ',literal,',\n  fingerprint = ',encodeString(report$validationFingerprint,quote='"'),
    ',\n  acknowledged = ',paste(deparse(ack),collapse=''), '\n)')
  out <- request$parameters$out %||% 'result'; env <- request$outputEnv %||% '.GlobalEnv'
  code <- if(env=='.GlobalEnv') paste0(out,' <- ',call) else paste0('assign(',encodeString(out,quote='"'),', ',call,', envir = resolve_env(',encodeString(env,quote='"'),'))')
  plan <- report$executionPlan
  if(!is.null(plan$method)) code <- paste0('# Method: ',plan$method,'\n# Working CRS: ',gsub('[\r\n]',' ',plan$workingCRSDescription %||% 'see request'),'\n',
    if(!is.null(plan$methodSettings)) paste0('# Buffer distance: ',plan$methodSettings$bufferDistance,' ',plan$methodSettings$bufferDistanceUnit,'\n') else '',code)
  if(request$operationType=='sf-buffer') code <- paste0('# Buffer operation: sf::st_buffer\n',code)
  if(report$status=='needs_confirmation' && !length(ack)) code <- paste0('# Review the reported choices before execution; approval is still required.\n',code)
  code
}
dq_job_report <- function(job) {
  if(is.null(job$report)) return(list(schemaVersion=1L,operationId=job$id,operationType=job$request$operationType,
    status=job$status,issues=list(),profiles=list(),coverage=list(complete=FALSE,rowsChecked=job$checked,totalRows=job$total),error=job$error))
  r <- dq_public(job$report);r$operationId<-job$id;r$status<-job$status;r$error<-job$error;r$executionPhase<-job$executionPhase;r$executionResult<-job$executionResult
  if(job$status %in% c('ready','needs_confirmation') && !job$request$operationType %in% c('inspect','export-gpkg','export-geojson')) r$executionCode <- dq_execution_code(job$request,job$report)
  r
}
dq_start <- function(request) {
  if(!request$operationType %in% c('inspect','export-gpkg','export-geojson') && is.null(request$parameters$out)) request$parameters$out<-'result'
  job <- new.env(parent=emptyenv()); job$id<-paste0('dq-',dq_hash(list(request,Sys.time(),runif(1))))
  job$request<-request;job$status<-'checking';job$checked<-0L;job$error<-NULL;job$report<-NULL;job$approved<-FALSE;job$used<-FALSE
  job$loaded<-dq_inputs(request);job$crses<-lapply(job$loaded,function(i) if(inherits(i$original,'sf')) dq_geometry_crs(i$original) else NULL);job$total<-sum(vapply(job$loaded,function(i)nrow(i$original),integer(1)))
  job$profiles<-vector('list',length(job$loaded));job$index<-1L;job$row<-1L;job$geometry<-list()
  # Keep a bounded session cache. Complete exclusion records also accompany
  # derived results and therefore travel through existing project persistence.
  existing <- ls(dq_state$jobs)
  if(length(existing)>=32L) {
    removable <- Filter(function(id) dq_find(id)$status!='checking',existing)
    if(length(removable)) rm(list=head(removable,length(existing)-31L),envir=dq_state$jobs)
  }
  assign(job$id,job,envir=dq_state$jobs)
  tick <- function() {
    if(job$status!='checking') return(invisible(NULL))
    tryCatch({
      if(job$index>length(job$loaded)) {
        cat('OURGEO_PREFLIGHT_BUSY:',job$id,'\n',sep='')
        on.exit(cat('OURGEO_PREFLIGHT_IDLE:',job$id,'\n',sep=''),add=TRUE)
        current <- dq_inputs(job$request)
        if(!identical(lapply(current,`[[`,'revision'),lapply(job$loaded,`[[`,'revision'))) stop('Inputs changed during inspection. Discard this result and check again.')
        job$report<-dq_validate(job$request,job$loaded,job$profiles);job$status<-job$report$status
        if(exists(job$report$validationFingerprint,dq_state$approvals,inherits=FALSE)) {job$approved<-TRUE;job$report$acknowledgments<-get(job$report$validationFingerprint,dq_state$approvals)}
        return(invisible(NULL))
      }
      input<-job$loaded[[job$index]];x<-input$original
      cache_key<-dq_hash(list(input$revision,dq_key(input$ref),input$ref$pkColumn,if(inherits(x,'sf')) sf::sf_use_s2() else NULL,'sfarc' %in% loadedNamespaces()))
      if(job$row==1L && exists(cache_key,dq_state$profiles,inherits=FALSE)) {
        profile<-get(cache_key,dq_state$profiles);profile$selectedRows<-length(input$selected)
        job$profiles[[job$index]]<-profile;job$checked<-job$checked+nrow(x)
        job$index<-job$index+1L;later::later(tick,0.001);return(invisible(NULL))
      }
      if(inherits(x,'sf') && job$row<=nrow(x)) {
        end<-min(job$row+127L,nrow(x));geom<-sf::st_geometry(x)
        for(r in seq.int(job$row,end)) job$geometry[[r]]<-dq_geometry_row(geom[[r]],job$crses[[job$index]])
        job$checked<-job$checked+end-job$row+1L;job$row<-end+1L
      } else {
        job$profiles[[job$index]]<-dq_profile(x,input$ref,job$geometry)
        profile<-job$profiles[[job$index]]
        if(is.null(profile$geometry)||profile$geometry$uncheckable==0) {
          old<-ls(dq_state$profiles);if(length(old)>=8L)rm(list=head(old,1),envir=dq_state$profiles)
          assign(cache_key,profile,dq_state$profiles)
        }
        if(!inherits(x,'sf')) job$checked<-job$checked+nrow(x)
        job$index<-job$index+1L;job$row<-1L;job$geometry<-list()
      }
      later::later(tick,0.001)
    },interrupt=function(e){job$status<-'cancelled';job$error<-'Validation interrupted; execution is not permitted'},
    error=function(e){job$status<-'failed';job$error<-conditionMessage(e)})
  }
  later::later(tick,0.001)
  dq_job_report(job)
}
dq_find <- function(id) {
  if(is.null(id)||!exists(id,envir=dq_state$jobs,inherits=FALSE)) stop('Validation expired or does not exist. Check again.')
  get(id,envir=dq_state$jobs)
}
dq_approve <- function(body) {
  if(!dq_review_authority(body$secret)) stop('Approval must come from the Desktop user review')
  j<-dq_find(body$operationId)
  if(j$status!='needs_confirmation'||!identical(body$fingerprint,j$report$validationFingerprint)) stop('This review is stale or blocked')
  fresh<-dq_validate(j$request)
  if(!identical(fresh$validationFingerprint,j$report$validationFingerprint)) stop('Inputs changed during review. Check again.')
  j$approved<-TRUE
  j$report$acknowledgments<-lapply(Filter(function(i)i$requiresAcknowledgment,j$report$issues),function(i)list(issueCode=i$stableCode,fingerprint=j$report$validationFingerprint))
  assign(j$report$validationFingerprint,j$report$acknowledgments,dq_state$approvals)
  TRUE
}
dq_commit <- function(body) {
  j<-dq_find(body$operationId)
  if(j$used||!j$status %in% c('ready','needs_confirmation')) stop('This operation has no current permission to execute')
  if(!identical(body$fingerprint,j$report$validationFingerprint)) stop('Parameters or validation fingerprint changed')
  if(j$status=='needs_confirmation'&&!j$approved) stop('User review is required; caller acknowledgments are not accepted')
  if(j$request$operationType=='inspect') stop('Inspection has no execution integration')
  for(ref in j$request$inputs) {
    key<-dq_key(ref)
    if(!is.null(ref$selectionVersion)) {
      current<-if(exists(key,envir=dq_state$selections,inherits=FALSE)) get(key,envir=dq_state$selections) else NULL
      if(is.null(current)||!identical(as.numeric(current$version),as.numeric(ref$selectionVersion))) stop('Selection changed. Check again.')
    }
  }
  if(j$request$operationType %in% c('export-gpkg','export-geojson')) {
    ack<-vapply(j$report$acknowledgments,`[[`,'','issueCode')
    return(tryCatch(dq_export_start(j,ack),error=function(e){j$status<-'failed';j$approved<-FALSE;j$error<-conditionMessage(e);stop(e)}))
  }
  out<-j$request$parameters$out %||% 'result'
  if(!dq_output_name(out)) stop('Choose a simple derived output name; application internals cannot be replaced')
  ack<-vapply(j$report$acknowledgments,`[[`,'','issueCode')
  value<-tryCatch(dq_run(j$request,j$report$validationFingerprint,ack),error=function(e){j$status<-'failed';j$approved<-FALSE;j$error<-conditionMessage(e);stop(e)},interrupt=function(e){j$status<-'cancelled';j$approved<-FALSE;j$error<-'Execution interrupted; no result was assigned';stop(e)})
  # All checks and work happen on copies before the only assignment. Denial,
  # failure and cancellation preserve both the source and previous result.
  code<-dq_execution_code(j$request,j$report)
  assign(out,value,envir=resolve_env(j$request$outputEnv %||% '.GlobalEnv'));j$used<-TRUE
  if(exists('broadcast_env_if_changed',mode='function')) broadcast_env_if_changed()
  list(success=TRUE,code=code,outputClass=class(value)[1],message='Preflight passed for this operation and input revision.',validation=dq_public(j$report))
}
handle_preflight <- function(action,body) {
  tryCatch({
    result<-switch(action,
      start=dq_start(body),status={j<-dq_find(body$operationId)
        if(j$status %in% c('ready','needs_confirmation')) {
          current<-dq_inputs(j$request)
          if(!identical(lapply(current,`[[`,'revision'),lapply(j$loaded,`[[`,'revision'))) {j$status<-'failed';j$approved<-FALSE;j$report<-NULL;j$error<-'Input revision changed; discard this result and check again'}
        };dq_job_report(j)},
      cancel={j<-dq_find(body$operationId);if(!j$used){j$status<-'cancelled';j$approved<-FALSE};dq_job_report(j)},
      approve=list(success=dq_approve(body)),execute=dq_commit(body),
      rows={j<-dq_find(body$operationId);if(is.null(j$report))stop('Checks are incomplete');current<-dq_inputs(j$request);if(!identical(lapply(current,`[[`,'revision'),lapply(j$loaded,`[[`,'revision')))stop('Input revision changed; check again before viewing or selecting affected rows');ref<-body$reference;list(success=TRUE,rowIdentities=j$report$rowRecords[[ref]] %||% list(),
        geometries=lapply(j$profiles,function(p)lapply(seq_along(p$geometryRows),function(r)list(row=r-1L,identity=p$rowIdentities[[r]],status=p$geometryRows[[r]]$status,reason=p$geometryRows[[r]]$reason))))},
      selection={key<-dq_key(body);old<-if(exists(key,dq_state$selections,inherits=FALSE))get(key,dq_state$selections) else NULL
        if(is.null(old)||body$version>=old$version)assign(key,list(version=body$version,rows=body$rows),dq_state$selections);list(success=TRUE)},
      stop('Unknown preflight action'))
    json_response(result,digits=NA)
  },interrupt=function(e) json_response(list(success=FALSE,status='cancelled',error='Cancelled; no result was assigned')),
  error=function(e) json_response(list(success=FALSE,status='failed',error=conditionMessage(e))))
}
