# Handlers: raster map-layer endpoints (info, register, tile, unregister,
# histogram). Engine internals live in util-raster.R.

# Monotonic raster layer id (mirrors .ourgeo_next_widget_id — no RNG use).
.ourgeo_next_raster_id <- function() {
  .ourgeo_env$raster_seq <- (.ourgeo_env$raster_seq %||% 0L) + 1L
  paste0("rl_", as.character(round(as.numeric(Sys.time()) * 1000)),
         "_", .ourgeo_env$raster_seq)
}

# ---------------------------------------------------------------------------
# POST /raster/info {name, envName} — band stats + shape for the symbology UI
# ---------------------------------------------------------------------------
handle_raster_info <- function(body) {
  dep_err <- .ourgeo_raster_deps_ok()
  if (!is.null(dep_err)) return(error_response(dep_err))
  tryCatch({
    name <- body$name %||% ""
    if (!nzchar(name)) return(error_response("name is required"))
    r <- .ourgeo_raster_resolve(name, body$envName %||% ".GlobalEnv")

    sample <- .ourgeo_raster_sample_values(r)
    stats <- .ourgeo_raster_stats(r, sample)
    ext4326 <- .ourgeo_raster_ext_4326(r)
    dtype <- tryCatch(terra::datatype(r)[1], error = function(e) "FLT8S")
    if (!is.character(dtype) || !nzchar(dtype)) dtype <- "FLT8S"

    json_response(list(
      success = TRUE,
      bands = stats$bands,
      nbands = terra::nlyr(r),
      nrow = terra::nrow(r), ncol = terra::ncol(r),
      resolution = as.list(terra::res(r)),
      dtype = dtype,
      crs = tryCatch({
        ci <- terra::crs(r, describe = TRUE)
        if (!is.na(ci$authority) && !is.na(ci$code)) paste0(ci$authority, ":", ci$code)
        else terra::crs(r, proj = TRUE)
      }, error = function(e) NULL),
      extent4326 = if (is.null(ext4326)) NULL else as.list(ext4326),
      nodata = tryCatch({
        nf <- terra::NAflag(r)
        if (all(is.na(nf))) NULL else nf[1]
      }, error = function(e) NULL),
      approx = terra::ncell(r) > 100000
    ))
  }, error = function(e) error_response(conditionMessage(e)))
}

# ---------------------------------------------------------------------------
# POST /raster/register {name, envName, layerId?, symbology}
# Full registration (warp + overviews + stats), or — when layerId matches an
# existing entry for the same unchanged object — a symbology-only restyle that
# keeps the warped file and just bumps the version.
# ---------------------------------------------------------------------------
handle_raster_register <- function(body) {
  dep_err <- .ourgeo_raster_deps_ok()
  if (!is.null(dep_err)) return(error_response(dep_err))
  tryCatch({
    name <- body$name %||% ""
    if (!nzchar(name)) return(error_response("name is required"))
    env_name <- body$envName %||% ".GlobalEnv"
    sym <- body$symbology %||% list()

    r <- .ourgeo_raster_resolve(name, env_name)
    fp <- .ourgeo_raster_fingerprint(r)

    layer_id <- body$layerId %||% ""
    existing <- if (nzchar(layer_id)) .ourgeo_env$raster_layers[[layer_id]] else NULL
    restyle <- !is.null(existing) &&
      identical(existing$name, name) && identical(existing$env_name, env_name) &&
      identical(existing$fingerprint, fp) && file.exists(existing$warped_path)

    if (restyle) {
      entry <- existing
    } else {
      if (!is.null(existing)) .ourgeo_raster_drop_layer(layer_id)
      if (!nzchar(layer_id)) layer_id <- .ourgeo_next_raster_id()

      categorical <- identical(sym$mode %||% "", "categorical") ||
        isTRUE(tryCatch(any(terra::is.factor(r)), error = function(e) FALSE))
      warped_path <- .ourgeo_raster_warp_3857(r, layer_id, categorical)

      sample <- .ourgeo_raster_sample_values(r)
      entry <- list(
        name = name, env_name = env_name,
        warped_path = warped_path,
        warped = terra::rast(warped_path),   # keep the GDAL dataset open
        version = 0L,
        stats = .ourgeo_raster_stats(r, sample),
        sample = sample,
        fingerprint = fp,
        bounds3857 = .ourgeo_raster_ext_3857(r),
        bounds4326 = .ourgeo_raster_ext_4326(r)
      )
    }

    # --- resolve symbology against stats -----------------------------------
    mode <- sym$mode %||% "singleband"
    nb <- length(entry$stats$bands)
    bands <- vapply(sym$bands %||% list(1L), as.integer, integer(1))
    bands <- pmin.int(pmax.int(bands, 1L), nb)
    if (mode == "rgb" && length(bands) < 3) bands <- rep(bands, length.out = 3)

    stretch <- sym$stretch %||% list(type = "percent", pLow = 2, pHigh = 98)
    resolved <- .ourgeo_raster_resolve_stretch(stretch, entry$stats, bands)
    resolved <- .ourgeo_raster_percent_from_sample(resolved, stretch, entry$sample, bands)

    entry$symbology <- list(
      mode = mode,
      bands = as.list(bands),
      nodataTransparent = !isFALSE(sym$nodataTransparent),
      resampling = sym$resampling %||% "nearest"
    )
    entry$stretch <- resolved
    entry$lut <- .ourgeo_raster_build_lut(sym$colormap)

    if (mode == "categorical") {
      cats <- sym$categories
      if (is.null(cats) || length(cats) == 0) {
        lv <- entry$stats$bands[[bands[1]]]$levels
        cats <- lv %||% list()
      }
      entry$cat_values <- vapply(cats, function(cc) as.numeric(cc$value), numeric(1))
      hex <- vapply(cats, function(cc) as.character(cc$color %||% "#8b949e"), character(1))
      if (length(hex) == 0) { entry$cat_values <- 0; hex <- "#8b949e" }
      entry$cat_lut <- t(grDevices::col2rgb(hex)) / 255
      entry$categories <- cats
    }

    entry$version <- (entry$version %||% 0L) + 1L
    .ourgeo_tile_cache_evict(paste0(layer_id, "|"))
    .ourgeo_env$raster_layers[[layer_id]] <- entry

    # Max useful zoom: where a 256px tile out-resolves the warped raster.
    res_dst <- tryCatch(terra::res(entry$warped)[1], error = function(e) NULL)
    maxzoom <- if (is.null(res_dst) || !is.finite(res_dst) || res_dst <= 0) 22L else {
      max(0L, min(24L, as.integer(ceiling(log2((2 * .WEB_MERCATOR_ORIGIN) / (256 * res_dst))))))
    }

    json_response(list(
      success = TRUE,
      layerId = layer_id,
      version = entry$version,
      tileUrl = paste0("/raster/tile/", layer_id, "/{z}/{x}/{y}.png?v=", entry$version),
      bounds4326 = if (is.null(entry$bounds4326)) NULL else as.list(entry$bounds4326),
      minzoom = 0L,
      maxzoom = maxzoom,
      bands = entry$stats$bands,
      nbands = nb,
      stretch = list(lo = as.list(resolved$lo), hi = as.list(resolved$hi))
    ))
  }, error = function(e) error_response(conditionMessage(e)))
}

# ---------------------------------------------------------------------------
# GET /raster/tile/{layerId}/{z}/{x}/{y}.png?v={version}
# ---------------------------------------------------------------------------
handle_raster_tile <- function(layer_id, z, x, y, query) {
  not_found <- list(status = 404L,
                    headers = list("Content-Type" = "text/plain",
                                   "Access-Control-Allow-Origin" = "*"),
                    body = "Not found")
  entry <- .ourgeo_env$raster_layers[[layer_id]]
  if (is.null(entry)) return(not_found)

  # ?v= mismatch -> stale MapLibre request for an old style; kill it fast.
  v <- suppressWarnings(as.integer(sub("^.*[?&]v=(\\d+).*$", "\\1",
                                       paste0("?", query %||% ""))))
  if (!is.na(v) && v != entry$version) return(not_found)

  png_headers <- list(
    "Content-Type" = "image/png",
    "Cache-Control" = "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin" = "*"
  )

  key <- sprintf("%s|%d|%d/%d/%d", layer_id, entry$version, z, x, y)
  cached <- .ourgeo_tile_cache_get(key)
  if (!is.null(cached)) {
    return(list(status = 200L, headers = png_headers, body = cached))
  }

  bb <- .ourgeo_raster_tile_bbox(z, x, y)
  lb <- entry$bounds3857
  if (!is.null(lb) &&
      (bb[3] <= lb[1] || bb[1] >= lb[3] || bb[4] <= lb[2] || bb[2] >= lb[4])) {
    return(list(status = 200L, headers = png_headers,
                body = .ourgeo_raster_blank_tile()))
  }

  bytes <- tryCatch({
    m <- .ourgeo_raster_read_tile(entry, bb)
    if (is.null(m)) .ourgeo_raster_blank_tile()
    else png::writePNG(.ourgeo_raster_colorize(m, entry))
  }, error = function(e) NULL)
  if (is.null(bytes)) {
    return(list(status = 500L,
                headers = list("Content-Type" = "text/plain",
                               "Access-Control-Allow-Origin" = "*"),
                body = "Tile render failed"))
  }

  .ourgeo_tile_cache_put(key, bytes)
  list(status = 200L, headers = png_headers, body = bytes)
}

# ---------------------------------------------------------------------------
# POST /raster/unregister {layerId}
# ---------------------------------------------------------------------------
handle_raster_unregister <- function(body) {
  tryCatch({
    layer_id <- body$layerId %||% ""
    if (nzchar(layer_id)) .ourgeo_raster_drop_layer(layer_id)
    ok_response()
  }, error = function(e) error_response(conditionMessage(e)))
}

# ---------------------------------------------------------------------------
# POST /raster/histogram {name, envName, band, bins}
# ---------------------------------------------------------------------------
handle_raster_histogram <- function(body) {
  dep_err <- .ourgeo_raster_deps_ok()
  if (!is.null(dep_err)) return(error_response(dep_err))
  tryCatch({
    name <- body$name %||% ""
    if (!nzchar(name)) return(error_response("name is required"))
    r <- .ourgeo_raster_resolve(name, body$envName %||% ".GlobalEnv")
    band <- min(max(as.integer(body$band %||% 1), 1L), terra::nlyr(r))
    bins <- min(max(as.integer(body$bins %||% 48), 8L), 256L)

    sample <- .ourgeo_raster_sample_values(r)
    v <- sample[, band]
    v <- v[is.finite(v)]
    if (length(v) == 0) {
      return(json_response(list(success = TRUE, breaks = list(), counts = list())))
    }
    h <- graphics::hist(v, breaks = bins, plot = FALSE)
    json_response(list(
      success = TRUE,
      breaks = as.list(h$breaks),
      counts = as.list(h$counts)
    ))
  }, error = function(e) error_response(conditionMessage(e)))
}

# ---------------------------------------------------------------------------
# POST /raster/value {name, envName, lng, lat} — per-band pixel value at a
# 4326 point (info-click identify). Reprojects the point to the raster CRS.
# ---------------------------------------------------------------------------
handle_raster_value <- function(body) {
  dep_err <- .ourgeo_raster_deps_ok()
  if (!is.null(dep_err)) return(error_response(dep_err))
  tryCatch({
    name <- body$name %||% ""
    if (!nzchar(name)) return(error_response("name is required"))
    lng <- as.numeric(body$lng)
    lat <- as.numeric(body$lat)
    if (!is.finite(lng) || !is.finite(lat)) return(error_response("lng/lat are required"))
    r <- .ourgeo_raster_resolve(name, body$envName %||% ".GlobalEnv")

    pt <- terra::vect(cbind(lng, lat), crs = "EPSG:4326")
    pt <- terra::project(pt, terra::crs(r))
    vals <- terra::extract(r, pt, ID = FALSE)

    band_names <- names(r)
    bands <- lapply(seq_len(ncol(vals)), function(i) {
      v <- vals[[i]][1]
      list(
        name = if (i <= length(band_names) && nzchar(band_names[i])) band_names[i]
               else paste0("band ", i),
        value = if (is.na(v)) NULL else format(v)
      )
    })
    json_response(list(success = TRUE, bands = bands))
  }, error = function(e) error_response(conditionMessage(e)))
}
