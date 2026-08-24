# .Rgeo raster tile pyramid (format v3) — GeoPackage-style block storage.
#
# DuckDB's spatial extension has no raster type, so rasters are stored as
# compressed 256px blocks across overview levels in _rgeo_raster_tiles, with
# shape/stats metadata in _rgeo_raster_meta. Save streams the raster in
# block-row strips (never whole in RAM); connect streams the level-0 blocks
# back into a file-backed temp GeoTIFF, so the environment object is a real,
# GDAL-lazy SpatRaster. Legacy (format v2) whole-object BLOBs in _rgeo_rasters
# remain readable and are upgraded to a pyramid on first access.

.RGEO_RASTER_BLOCK <- 256L

# ---------------------------------------------------------------------------
# dtype handling
# ---------------------------------------------------------------------------

# terra datatype code -> writeBin/readBin spec + default integer NA sentinel.
.rgeo_raster_dtype_spec <- function(dtype) {
  switch(dtype,
    INT1U = list(what = "integer", size = 1L, signed = FALSE, sentinel = 255),
    INT1S = list(what = "integer", size = 1L, signed = TRUE,  sentinel = -128),
    INT2U = list(what = "integer", size = 2L, signed = FALSE, sentinel = 65535),
    INT2S = list(what = "integer", size = 2L, signed = TRUE,  sentinel = -32768),
    INT4S = list(what = "integer", size = 4L, signed = TRUE,  sentinel = -2147483647L),
    FLT4S = list(what = "double",  size = 4L, signed = TRUE,  sentinel = NA_real_),
    # FLT8S, INT4U (exceeds R integer range) and anything unknown store as
    # IEEE float64 with NaN-coded missing values.
    list(what = "double", size = 8L, signed = TRUE, sentinel = NA_real_)
  )
}

# Storage dtype for an object: keep the native type when it is safe, promote
# to FLT8S when an integer type has no usable NA sentinel (declared nodata
# absent AND the default sentinel collides with observed values).
.rgeo_raster_storage_dtype <- function(r, stats) {
  dtype <- tryCatch(terra::datatype(r)[1], error = function(e) "FLT8S")
  if (!is.character(dtype) || is.na(dtype) || !nzchar(dtype)) dtype <- "FLT8S"
  spec <- .rgeo_raster_dtype_spec(dtype)
  nodata <- tryCatch({
    nf <- terra::NAflag(r)
    if (all(is.na(nf))) NA_real_ else nf[1]
  }, error = function(e) NA_real_)

  if (spec$what == "integer") {
    sentinel <- if (!is.na(nodata)) nodata else spec$sentinel
    collides <- any(vapply(stats$bands, function(b) {
      sentinel >= b$min && sentinel <= b$max
    }, logical(1)))
    if (collides && is.na(nodata)) {
      return(list(dtype = "FLT8S", spec = .rgeo_raster_dtype_spec("FLT8S"),
                  nodata = NA_real_))
    }
    return(list(dtype = dtype, spec = spec, nodata = sentinel))
  }
  list(dtype = dtype, spec = spec, nodata = NA_real_)
}

# ---------------------------------------------------------------------------
# Block encode / decode (band-sequential within one blob)
# ---------------------------------------------------------------------------

.rgeo_raster_encode_block <- function(v, spec, nodata) {
  if (spec$what == "integer") {
    v[is.na(v)] <- nodata
    bytes <- writeBin(as.integer(v), raw(), size = spec$size, endian = "little")
  } else {
    bytes <- writeBin(as.double(v), raw(), size = spec$size, endian = "little")
  }
  memCompress(bytes, type = "gzip")
}

.rgeo_raster_decode_block <- function(blob, spec, n_values, nodata) {
  bytes <- memDecompress(blob, type = "gzip", asChar = FALSE)
  if (spec$what == "integer") {
    v <- as.numeric(readBin(bytes, "integer", n = n_values, size = spec$size,
                            signed = spec$signed, endian = "little"))
    if (!is.na(nodata)) v[v == nodata] <- NA_real_
  } else {
    v <- readBin(bytes, "double", n = n_values, size = spec$size,
                 endian = "little")
    v[is.nan(v)] <- NA_real_
  }
  v
}

# ---------------------------------------------------------------------------
# Level / block-grid math
# ---------------------------------------------------------------------------

# Dims + block grid for level k (level 0 = native resolution).
.rgeo_raster_level_dims <- function(nrow0, ncol0, level) {
  nr <- as.integer(ceiling(nrow0 / 2^level))
  nc <- as.integer(ceiling(ncol0 / 2^level))
  list(nrow = nr, ncol = nc,
       nbrow = as.integer(ceiling(nr / .RGEO_RASTER_BLOCK)),
       nbcol = as.integer(ceiling(nc / .RGEO_RASTER_BLOCK)))
}

.rgeo_raster_n_levels <- function(nrow0, ncol0) {
  1L + max(0L, as.integer(ceiling(log2(max(nrow0, ncol0) / .RGEO_RASTER_BLOCK))))
}

# Row-major cell indices of one block inside a strip matrix that covers the
# full level width (strip rows are level rows r0..r0+h-1).
.rgeo_raster_block_idx <- function(ncol_level, c0, w, h) {
  rep((seq_len(h) - 1L) * ncol_level, each = w) + rep(c0:(c0 + w - 1L), times = h)
}

# ---------------------------------------------------------------------------
# Save: SpatRaster -> pyramid tables (+ _rgeo_objects upsert)
# Caller manages the transaction.
# ---------------------------------------------------------------------------

.rgeo_write_raster_pyramid <- function(con, target_name, obj, notes = NA_character_) {
  if (!requireNamespace("terra", quietly = TRUE)) {
    stop("Raster storage requires the 'terra' package")
  }
  r <- if (inherits(obj, "SpatRaster")) obj else terra::rast(obj)

  nb <- terra::nlyr(r)
  nrow0 <- terra::nrow(r); ncol0 <- terra::ncol(r)
  ext <- as.vector(terra::ext(r))                    # xmin xmax ymin ymax
  crs_wkt <- terra::crs(r)                           # full WKT2
  band_names <- names(r)

  sample <- .ourgeo_raster_sample_values(r)
  stats <- .ourgeo_raster_stats(r, sample)
  st <- .rgeo_raster_storage_dtype(r, stats)
  categorical <- isTRUE(tryCatch(any(terra::is.factor(r)), error = function(e) FALSE))

  categories_json <- tryCatch({
    cats <- lapply(stats$bands, function(b) b$levels %||% NULL)
    if (all(vapply(cats, is.null, logical(1)))) NA_character_
    else as.character(toJSON(cats, auto_unbox = TRUE, null = "null"))
  }, error = function(e) NA_character_)

  band_stats_json <- as.character(toJSON(lapply(stats$bands, function(b) {
    list(min = b$min, max = b$max, mean = b$mean, sd = b$sd,
         q02 = b$q02, q98 = b$q98, categorical = isTRUE(b$categorical))
  }), auto_unbox = TRUE, null = "null"))

  n_levels <- .rgeo_raster_n_levels(nrow0, ncol0)

  # Clear any previous pyramid for this name.
  DBI::dbExecute(con, "DELETE FROM _rgeo_raster_tiles WHERE name = ?",
                 params = list(target_name))
  DBI::dbExecute(con, "DELETE FROM _rgeo_raster_meta WHERE name = ?",
                 params = list(target_name))

  DBI::dbExecute(con, "
    INSERT INTO _rgeo_raster_meta
    (name, crs, xmin, ymin, xmax, ymax, nrow, ncol, nbands, dtype, nodata,
     block_size, n_levels, band_names, band_stats, categories, compression,
     created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'gzip',
            current_timestamp)",
    params = list(
      target_name, crs_wkt, ext[1], ext[3], ext[2], ext[4],
      nrow0, ncol0, nb, st$dtype,
      if (is.na(st$nodata)) NA_real_ else as.numeric(st$nodata),
      .RGEO_RASTER_BLOCK, n_levels,
      as.character(toJSON(as.list(band_names), auto_unbox = TRUE)),
      band_stats_json,
      if (is.na(categories_json)) NA else categories_json))

  # Level files: 0 = the object itself; each next = x2 aggregate, file-backed
  # so terra streams the reduction.
  lvl <- r
  lvl_temps <- character(0)
  on.exit(unlink(lvl_temps), add = TRUE)

  B <- .RGEO_RASTER_BLOCK
  for (k in seq_len(n_levels) - 1L) {
    if (k > 0) {
      tmp <- tempfile(fileext = ".tif")
      lvl <- terra::aggregate(lvl, fact = 2,
                              fun = if (categorical) "modal" else "mean",
                              na.rm = TRUE, filename = tmp, overwrite = TRUE)
      lvl_temps <- c(lvl_temps, tmp)
    }
    ld <- .rgeo_raster_level_dims(nrow0, ncol0, k)

    terra::readStart(lvl)
    batch_rows <- list()
    flush_batch <- function() {
      if (length(batch_rows) == 0) return(invisible(NULL))
      df <- data.frame(
        name  = vapply(batch_rows, `[[`, character(1), "name"),
        level = vapply(batch_rows, `[[`, integer(1), "level"),
        brow  = vapply(batch_rows, `[[`, integer(1), "brow"),
        bcol  = vapply(batch_rows, `[[`, integer(1), "bcol"),
        stringsAsFactors = FALSE
      )
      df$data <- lapply(batch_rows, `[[`, "data")
      DBI::dbAppendTable(con, "_rgeo_raster_tiles", df)
      batch_rows <<- list()
      invisible(NULL)
    }

    tryCatch({
      for (brow in seq_len(ld$nbrow) - 1L) {
        r0 <- brow * B + 1L
        h <- min(B, ld$nrow - brow * B)
        strip <- terra::readValues(lvl, row = r0, nrows = h,
                                   col = 1, ncols = ld$ncol, mat = TRUE)
        if (!is.matrix(strip)) strip <- matrix(strip, ncol = nb)
        for (bcol in seq_len(ld$nbcol) - 1L) {
          c0 <- bcol * B + 1L
          w <- min(B, ld$ncol - bcol * B)
          idx <- .rgeo_raster_block_idx(ld$ncol, c0, w, h)
          block <- as.vector(strip[idx, , drop = FALSE])   # BSQ
          batch_rows[[length(batch_rows) + 1]] <- list(
            name = target_name, level = k, brow = brow, bcol = bcol,
            data = .rgeo_raster_encode_block(block, st$spec, st$nodata))
          if (length(batch_rows) >= 64) flush_batch()
        }
      }
      flush_batch()
    }, finally = terra::readStop(lvl))
  }

  # _rgeo_objects upsert (bbox in EPSG:4326 so listings/fit-bounds work).
  bbox4326 <- .ourgeo_raster_ext_4326(r)                # [w, s, e, n] or NULL
  crs_short <- tryCatch({
    ci <- terra::crs(r, describe = TRUE)
    if (!is.na(ci$authority) && !is.na(ci$code)) paste0(ci$authority, ":", ci$code)
    else terra::crs(r, proj = TRUE)
  }, error = function(e) NA_character_)
  size_bytes <- as.numeric(object.size(r))

  existing <- .rgeo_obj_row(con, target_name)
  if (!is.null(existing)) {
    DBI::dbExecute(con, "
      UPDATE _rgeo_objects
         SET kind = 'raster', spatial_format = 'rgeo_pyramid',
             format_version = 3, editable = FALSE, data = NULL,
             crs = ?, size_bytes = ?,
             bbox_minx = ?, bbox_miny = ?, bbox_maxx = ?, bbox_maxy = ?
       WHERE name = ?",
      params = list(
        if (is.na(crs_short)) NA else crs_short, size_bytes,
        if (is.null(bbox4326)) NA_real_ else bbox4326[1],
        if (is.null(bbox4326)) NA_real_ else bbox4326[2],
        if (is.null(bbox4326)) NA_real_ else bbox4326[3],
        if (is.null(bbox4326)) NA_real_ else bbox4326[4],
        target_name))
  } else {
    DBI::dbExecute(con, "
      INSERT INTO _rgeo_objects
      (name, kind, geometry_type, crs, n_rows, size_bytes, notes, created_at,
       table_name, data, r_class, spatial_format, editable, format_version,
       bbox_minx, bbox_miny, bbox_maxx, bbox_maxy)
      VALUES (?, 'raster', NULL, ?, NULL, ?, ?, current_timestamp,
              NULL, NULL, NULL, 'rgeo_pyramid', FALSE, 3, ?, ?, ?, ?)",
      params = list(
        target_name,
        if (is.na(crs_short)) NA else crs_short,
        size_bytes,
        if (is.na(notes)) NA else notes,
        if (is.null(bbox4326)) NA_real_ else bbox4326[1],
        if (is.null(bbox4326)) NA_real_ else bbox4326[2],
        if (is.null(bbox4326)) NA_real_ else bbox4326[3],
        if (is.null(bbox4326)) NA_real_ else bbox4326[4]))
  }
  invisible(NULL)
}

# ---------------------------------------------------------------------------
# Meta read
# ---------------------------------------------------------------------------

.rgeo_raster_read_meta <- function(con, name) {
  q <- tryCatch(DBI::dbGetQuery(con,
    "SELECT * FROM _rgeo_raster_meta WHERE name = ?", params = list(name)),
    error = function(e) NULL)
  if (is.null(q) || nrow(q) == 0) return(NULL)
  m <- as.list(q[1, ])
  m$band_names <- tryCatch(
    as.character(fromJSON(m$band_names)), error = function(e) NULL)
  m$band_stats <- tryCatch(
    fromJSON(m$band_stats, simplifyVector = FALSE), error = function(e) NULL)
  m$categories <- if (is.na(m$categories %||% NA)) NULL else tryCatch(
    fromJSON(m$categories, simplifyVector = FALSE), error = function(e) NULL)
  m
}

# ---------------------------------------------------------------------------
# Connect: stream level-0 blocks -> file-backed SpatRaster in .GlobalEnv
# ---------------------------------------------------------------------------

.rgeo_raster_connect <- function(handle, name, var_name, register_proxy = TRUE) {
  if (!requireNamespace("terra", quietly = TRUE)) {
    stop("Raster support requires the 'terra' package")
  }
  con <- .rgeo_get_con(handle)
  meta <- .rgeo_ensure_raster_pyramid(con, name)
  spec <- .rgeo_raster_dtype_spec(meta$dtype)
  nodata <- if (is.na(meta$nodata %||% NA)) NA_real_ else as.numeric(meta$nodata)
  nb <- as.integer(meta$nbands)
  B <- as.integer(meta$block_size %||% .RGEO_RASTER_BLOCK)

  templ <- terra::rast(nrows = as.integer(meta$nrow), ncols = as.integer(meta$ncol),
                       nlyrs = nb, crs = meta$crs,
                       xmin = meta$xmin, xmax = meta$xmax,
                       ymin = meta$ymin, ymax = meta$ymax)
  if (!is.null(meta$band_names) && length(meta$band_names) == nb) {
    names(templ) <- meta$band_names
  }

  out <- tempfile(tmpdir = .ourgeo_raster_dir(), fileext = ".tif")
  wopts <- list(filename = out, overwrite = TRUE,
                gdal = c("TILED=YES", "COMPRESS=DEFLATE"))
  # writeStart modifies `templ` by reference and returns blocking info —
  # writeValues/writeStop are then called on `templ` itself. Preserve the
  # storage datatype when terra accepts it.
  tryCatch(
    do.call(terra::writeStart, c(list(x = templ), wopts, list(datatype = meta$dtype))),
    error = function(e) do.call(terra::writeStart, c(list(x = templ), wopts)))

  ld <- .rgeo_raster_level_dims(as.integer(meta$nrow), as.integer(meta$ncol), 0L)
  ok <- FALSE
  tryCatch({
    for (brow in seq_len(ld$nbrow) - 1L) {
      r0 <- brow * B + 1L
      h <- min(B, ld$nrow - brow * B)
      strip <- matrix(NA_real_, nrow = h * ld$ncol, ncol = nb)
      rows <- DBI::dbGetQuery(con, "
        SELECT bcol, data FROM _rgeo_raster_tiles
         WHERE name = ? AND level = 0 AND brow = ?
         ORDER BY bcol", params = list(name, brow))
      for (i in seq_len(nrow(rows))) {
        bcol <- rows$bcol[i]
        c0 <- bcol * B + 1L
        w <- min(B, ld$ncol - bcol * B)
        v <- .rgeo_raster_decode_block(rows$data[[i]], spec, w * h * nb, nodata)
        idx <- .rgeo_raster_block_idx(ld$ncol, c0, w, h)
        strip[idx, ] <- matrix(v, ncol = nb)               # BSQ -> per-band cols
      }
      terra::writeValues(templ, strip, start = r0, nrows = h)
    }
    ok <- TRUE
  }, finally = tryCatch(terra::writeStop(templ), error = function(e) NULL))
  if (!ok) stop("Failed to reassemble raster '", name, "' from the database")

  obj <- terra::rast(out)
  # Reapply categorical levels/colors best-effort.
  if (!is.null(meta$categories)) {
    for (i in seq_along(meta$categories)) {
      lv <- meta$categories[[i]]
      if (is.null(lv) || length(lv) == 0) next
      tryCatch({
        df <- data.frame(
          value = vapply(lv, function(x) as.numeric(x$value), numeric(1)),
          label = vapply(lv, function(x) as.character(x$label %||% ""), character(1)))
        terra::set.cats(obj, layer = i, value = df)
      }, error = function(e) NULL)
    }
  }

  assign(var_name, obj, envir = .GlobalEnv)

  if (register_proxy) {
    .ourgeo_env$rgeo_proxies[[var_name]] <- list(
      handle          = handle,
      name            = name,
      kind            = "raster",
      spatial_format  = "rgeo_pyramid",
      geometry_type   = NA_character_,
      geometry_column = NA_character_,
      pk_column       = "_rgeo_rowid",
      crs             = NA_character_,
      path            = out
    )
  } else {
    .ourgeo_env$rgeo_proxies[[var_name]] <- NULL
  }
  invisible(obj)
}

# ---------------------------------------------------------------------------
# Lazy v2 -> v3 upgrade: legacy _rgeo_rasters BLOB -> pyramid on first access
# ---------------------------------------------------------------------------

.rgeo_ensure_raster_pyramid <- function(con, name) {
  meta <- .rgeo_raster_read_meta(con, name)
  if (!is.null(meta)) return(meta)

  q <- DBI::dbGetQuery(con, "SELECT data FROM _rgeo_rasters WHERE name = ?",
                       params = list(name))
  if (nrow(q) == 0) stop("Raster not found in database: ", name)
  obj <- .rgeo_unserialize_rds(q$data[[1]])
  if (inherits(obj, "PackedSpatRaster") && requireNamespace("terra", quietly = TRUE)) {
    obj <- terra::unwrap(obj)
  }
  if (!inherits(obj, "SpatRaster")) {
    stop("Legacy raster '", name, "' cannot be upgraded (not a SpatRaster)")
  }

  broadcast_console(paste0("[Rgeo] Upgrading raster '", name,
                           "' to tiled storage (one-time)...\n"))
  DBI::dbBegin(con)
  tryCatch({
    .rgeo_write_raster_pyramid(con, name, obj)
    DBI::dbExecute(con, "DELETE FROM _rgeo_rasters WHERE name = ?",
                   params = list(name))
    DBI::dbExecute(con, "UPDATE _rgeo_meta SET last_modified = current_timestamp")
    DBI::dbCommit(con)
  }, error = function(e) {
    tryCatch(DBI::dbRollback(con), error = function(e2) NULL)
    stop(e)
  })
  .rgeo_raster_read_meta(con, name)
}

# ---------------------------------------------------------------------------
# Translator (dispatched for kind == 'raster' && spatial_format == 'rgeo_pyramid')
# ---------------------------------------------------------------------------

.rgeo_raster_translator <- function() {
  list(
    preview = function(meta, body) {
      rm_ <- .rgeo_raster_read_meta(meta$con, meta$name)
      if (is.null(rm_)) stop("Raster metadata missing for ", meta$name)
      list(success = TRUE,
           kind = "raster",
           preview = list(
             nrow = rm_$nrow, ncol = rm_$ncol, nbands = rm_$nbands,
             dtype = rm_$dtype, crs = rm_$crs,
             extent = c(rm_$xmin, rm_$ymin, rm_$xmax, rm_$ymax),
             bandNames = rm_$band_names,
             bandStats = rm_$band_stats,
             levels = rm_$n_levels))
    },
    meta = function(meta, body) {
      rm_ <- .rgeo_raster_read_meta(meta$con, meta$name)
      list(success = TRUE, meta = rm_)
    },
    update_cell = function(meta, body) stop("Cells are not editable for raster"),
    add_column  = function(meta, body) stop("add_column not supported for raster"),
    delete_rows = function(meta, body) stop("delete_rows not supported for raster"),
    rename_column = function(meta, body) stop("rename_column not supported for raster"),
    delete_column = function(meta, body) stop("delete_column not supported for raster"),
    spatial_tile = function(meta, body) stop("spatial_tile not supported for raster"),
    update_geometry = function(meta, body) stop("update_geometry not supported for raster"),
    bbox = function(meta, body) {
      list(success = TRUE,
           bbox = if (any(is.na(meta$bbox))) NULL else as.numeric(meta$bbox),
           crs  = if (is.na(meta$crs)) NULL else meta$crs)
    },
    collect = function(meta, body) {
      var_name <- body$varName %||% paste0(meta$name, "_local")
      .rgeo_raster_connect(meta$handle, meta$name, var_name, register_proxy = FALSE)
      list(success = TRUE, varName = var_name, kind = "raster")
    }
  )
}
