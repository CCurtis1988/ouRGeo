# Raster engine internals — warp/overview cache, XYZ tile math, symbology
# rendering (stretch + colormap -> RGBA PNG), band stats, tile LRU.
#
# Live SpatRaster objects are registered as map layers: the object is warped
# once to EPSG:3857 (tiled GTiff + internal overviews) under a session temp
# dir, then GET /raster/tile/{id}/{z}/{x}/{y}.png reads a 256x256 window per
# tile (GDAL picks the overview), colorizes it in vectorized R and returns
# PNG bytes. See handlers-raster.R for the HTTP surface.

.WEB_MERCATOR_ORIGIN <- 20037508.342789244  # pi * 6378137

.ourgeo_raster_dir <- function() {
  d <- file.path(tempdir(), "ourgeo-raster")
  if (!dir.exists(d)) dir.create(d, recursive = TRUE)
  d
}

.ourgeo_raster_deps_ok <- function() {
  missing <- c("terra", "sf", "png")[!vapply(
    c("terra", "sf", "png"), requireNamespace, logical(1), quietly = TRUE)]
  if (length(missing) == 0) return(NULL)
  paste0("Raster support requires: ", paste(missing, collapse = ", "),
         ". Install via the Packages panel.")
}

# ---------------------------------------------------------------------------
# Object resolution + identity
# ---------------------------------------------------------------------------

# Resolve an env object into a SpatRaster (coercing legacy Raster*).
.ourgeo_raster_resolve <- function(name, env_name) {
  env <- resolve_env(env_name %||% ".GlobalEnv")
  obj <- get(name, envir = env)
  if (inherits(obj, c("RasterLayer", "RasterStack", "RasterBrick"))) {
    obj <- terra::rast(obj)
  }
  if (!inherits(obj, "SpatRaster")) {
    stop(paste0("'", name, "' is not a SpatRaster"))
  }
  if (!nzchar(terra::crs(obj))) {
    stop(paste0("'", name, "' has no CRS; assign one with terra::crs(", name,
                ") <- \"EPSG:...\" before mapping it"))
  }
  obj
}

# Cheap identity signature: shape + crs + extent + backing files (+ mtimes),
# plus a fixed 64-cell regular sample so most in-memory edits are caught.
.ourgeo_raster_fingerprint <- function(r) {
  tryCatch({
    srcs <- terra::sources(r)
    srcs <- srcs[nzchar(srcs)]
    mtimes <- if (length(srcs)) {
      paste(format(file.info(srcs)$mtime, "%Y%m%d%H%M%OS3"), collapse = ",")
    } else ""
    smp <- tryCatch({
      v <- terra::spatSample(r, size = 64, method = "regular",
                             na.rm = FALSE, warn = FALSE)
      sum(as.matrix(v), na.rm = TRUE)
    }, error = function(e) 0)
    paste(paste(dim(r), collapse = "x"), terra::crs(r, proj = TRUE),
          paste(as.vector(terra::ext(r)), collapse = ","),
          paste(srcs, collapse = ";"), mtimes,
          format(smp, digits = 12), sep = "|")
  }, error = function(e) paste0("err:", conditionMessage(e)))
}

# ---------------------------------------------------------------------------
# Extent / tile math (EPSG:3857 XYZ scheme, y from the top)
# ---------------------------------------------------------------------------

# Source extent projected to 3857, clamped to the mercator square. Returns
# c(xmin, ymin, xmax, ymax) or NULL when the projection fails entirely.
.ourgeo_raster_ext_3857 <- function(r) {
  e <- tryCatch(
    as.vector(terra::project(terra::ext(r), from = terra::crs(r),
                             to = "EPSG:3857")),  # xmin xmax ymin ymax
    error = function(err) NULL)
  if (is.null(e)) {
    e <- tryCatch({
      bb <- sf::st_bbox(c(xmin = terra::xmin(r), ymin = terra::ymin(r),
                          xmax = terra::xmax(r), ymax = terra::ymax(r)),
                        crs = sf::st_crs(terra::crs(r)))
      p <- sf::st_as_sfc(bb)
      b2 <- sf::st_bbox(sf::st_transform(p, 3857))
      c(b2[["xmin"]], b2[["xmax"]], b2[["ymin"]], b2[["ymax"]])
    }, error = function(err) NULL)
  }
  if (is.null(e)) return(NULL)
  O <- .WEB_MERCATOR_ORIGIN
  e[!is.finite(e)] <- c(-O, O, -O, O)[!is.finite(e)]
  c(max(e[1], -O), max(e[3], -O), min(e[2], O), min(e[4], O))
}

# 4326 extent [w, s, e, n] for the frontend fit-bounds.
.ourgeo_raster_ext_4326 <- function(r) {
  e <- tryCatch(
    as.vector(terra::project(terra::ext(r), from = terra::crs(r),
                             to = "EPSG:4326")),
    error = function(err) NULL)
  if (is.null(e)) return(NULL)
  c(max(e[1], -180), max(e[3], -90), min(e[2], 180), min(e[4], 90))
}

.ourgeo_raster_tile_bbox <- function(z, x, y) {
  O <- .WEB_MERCATOR_ORIGIN
  span <- 2 * O / 2^z
  xmin <- -O + x * span
  ymax <-  O - y * span
  c(xmin, ymax - span, xmin + span, ymax)   # xmin ymin xmax ymax
}

# ---------------------------------------------------------------------------
# Warp + overviews (registration-time, once per layer)
# ---------------------------------------------------------------------------

# Path GDAL can read the object from: its own file when it is a clean whole-
# file reference, otherwise a temp GTiff. Returns list(path, temp).
.ourgeo_raster_source_path <- function(r) {
  srcs <- unique(terra::sources(r))
  whole_file <- length(srcs) == 1 && nzchar(srcs[1]) && file.exists(srcs[1]) &&
    !any(terra::inMemory(r)) &&
    isTRUE(tryCatch({
      f <- terra::rast(srcs[1])
      # The object must match the file exactly — including CRS, which the
      # user may have overridden in memory (crs(x) <- ...) after loading.
      all(dim(r) == dim(f)) && terra::same.crs(r, f)
    }, error = function(e) FALSE))
  if (whole_file) return(list(path = srcs[1], temp = FALSE))
  tmp <- tempfile(tmpdir = .ourgeo_raster_dir(), fileext = ".tif")
  terra::writeRaster(r, tmp, overwrite = TRUE,
                     gdal = c("TILED=YES", "COMPRESS=LZW"))
  list(path = tmp, temp = TRUE)
}

# Warp to a tiled EPSG:3857 file with an alpha validity band + overviews.
# Preferred: gdalwarp straight to the COG driver, which builds internal
# overviews itself (sf::gdal_utils has no "addo"/gdaladdo utility, so
# overviews cannot be added after the fact). Fallback for GDAL builds without
# the COG driver (< 3.1): a plain tiled GTiff — correct but with no
# overviews, so low-zoom tiles read more cells. Returns the destination path.
.ourgeo_raster_warp_3857 <- function(r, layer_id, categorical) {
  src <- .ourgeo_raster_source_path(r)
  on.exit(if (src$temp) unlink(src$path), add = TRUE)

  te <- .ourgeo_raster_ext_3857(r)
  if (is.null(te)) stop("Could not project the raster extent to EPSG:3857")

  dst <- file.path(.ourgeo_raster_dir(), paste0(layer_id, ".tif"))
  unlink(dst)
  method <- if (categorical) "near" else "bilinear"
  common <- c(
    "-t_srs", "EPSG:3857",
    "-r", method,
    "-dstalpha",
    "-wo", "NUM_THREADS=ALL_CPUS", "-multi",
    "-te", format(te, scientific = FALSE, trim = TRUE)
  )

  cog_ok <- tryCatch({
    sf::gdal_utils("warp", source = src$path, destination = dst, options = c(
      common,
      "-of", "COG",
      "-co", "COMPRESS=DEFLATE", "-co", "BLOCKSIZE=256",
      "-co", "NUM_THREADS=ALL_CPUS",  # parallel DEFLATE — dominates warp time
      "-co", paste0("OVERVIEW_RESAMPLING=",
                    if (categorical) "NEAREST" else "AVERAGE")
    ), quiet = TRUE)
    file.exists(dst)
  }, error = function(e) FALSE)

  if (!cog_ok) {
    unlink(dst)
    sf::gdal_utils("warp", source = src$path, destination = dst, options = c(
      common,
      "-of", "GTiff",
      "-co", "TILED=YES", "-co", "BLOCKXSIZE=256", "-co", "BLOCKYSIZE=256",
      "-co", "COMPRESS=DEFLATE", "-co", "PREDICTOR=2",
      "-co", "NUM_THREADS=ALL_CPUS"
    ), quiet = TRUE)
  }
  if (!file.exists(dst)) stop("gdalwarp failed to produce the reprojected raster")
  dst
}

# ---------------------------------------------------------------------------
# Band stats (sampled — display stretch does not need exact extremes)
# ---------------------------------------------------------------------------

# Regular sample of cell values as a matrix (<= `size` rows, one col per band).
.ourgeo_raster_sample_values <- function(r, size = 100000) {
  n <- terra::ncell(r)
  v <- if (n <= size) {
    terra::values(r, mat = TRUE)
  } else {
    as.matrix(terra::spatSample(r, size = size, method = "regular",
                                na.rm = FALSE, warn = FALSE))
  }
  if (!is.matrix(v)) v <- matrix(v, ncol = terra::nlyr(r))
  v
}

# Per-band stats list + categorical metadata. `sample` may be passed in to
# avoid re-reading.
.ourgeo_raster_stats <- function(r, sample = NULL) {
  if (is.null(sample)) sample <- .ourgeo_raster_sample_values(r)
  nb <- terra::nlyr(r)
  band_names <- names(r)
  is_fact <- tryCatch(terra::is.factor(r), error = function(e) rep(FALSE, nb))
  lv <- tryCatch(terra::levels(r), error = function(e) NULL)
  ct <- tryCatch(terra::coltab(r), error = function(e) NULL)

  bands <- lapply(seq_len(nb), function(i) {
    v <- sample[, i]
    v <- v[is.finite(v)]
    if (length(v) == 0) v <- 0
    q <- stats::quantile(v, c(0.02, 0.98), names = FALSE, type = 7)
    s_dev <- stats::sd(v)
    if (!is.finite(s_dev)) s_dev <- 0
    b <- list(
      index = i,
      name  = band_names[i] %||% paste0("band_", i),
      min   = min(v), max = max(v),
      mean  = mean(v), sd = s_dev,
      q02   = q[1], q98 = q[2],
      categorical = isTRUE(is_fact[i])
    )
    if (isTRUE(is_fact[i]) && !is.null(lv) && is.data.frame(lv[[i]])) {
      df <- lv[[i]]
      vals <- df[[1]]
      labels <- as.character(df[[2]])
      colors <- NULL
      if (!is.null(ct) && is.data.frame(ct[[i]]) && nrow(ct[[i]]) > 0) {
        cdf <- ct[[i]]
        m <- match(vals, cdf[[1]])
        ok <- !is.na(m)
        colors <- rep(NA_character_, length(vals))
        colors[ok] <- grDevices::rgb(cdf$red[m[ok]], cdf$green[m[ok]],
                                     cdf$blue[m[ok]], maxColorValue = 255)
      }
      if (is.null(colors) || all(is.na(colors))) {
        colors <- grDevices::hcl.colors(max(length(vals), 1), "Dark 3")
      }
      b$levels <- lapply(seq_along(vals), function(j) list(
        value = vals[j], label = labels[j], color = colors[j]
      ))
    }
    b
  })

  list(bands = bands, sd_valid = TRUE)
}

# ---------------------------------------------------------------------------
# Symbology resolution (stretch lo/hi, LUTs)
# ---------------------------------------------------------------------------

.OURGEO_DEFAULT_COLORMAP <- list(
  list(position = 0.00, color = "#440154"),
  list(position = 0.25, color = "#3b528b"),
  list(position = 0.50, color = "#21918c"),
  list(position = 0.75, color = "#5ec962"),
  list(position = 1.00, color = "#fde725")
)

# Hex stops -> 256x4 RGBA lookup table in [0,1].
.ourgeo_raster_build_lut <- function(stops) {
  if (is.null(stops) || length(stops) == 0) stops <- .OURGEO_DEFAULT_COLORMAP
  pos <- vapply(stops, function(s) as.numeric(s$position), numeric(1))
  hex <- vapply(stops, function(s) as.character(s$color), character(1))
  o <- order(pos)
  pos <- pos[o]; hex <- hex[o]
  if (length(pos) == 1) { pos <- c(0, 1); hex <- c(hex, hex) }
  cols <- t(grDevices::col2rgb(hex, alpha = TRUE)) / 255
  xout <- seq(0, 1, length.out = 256)
  vapply(1:4, function(ch) {
    stats::approx(pos, cols[, ch], xout = xout, rule = 2)$y
  }, numeric(256))
}

# Resolve a stretch spec against band stats -> list(lo=..., hi=...) vectors
# aligned with `band_idx`.
.ourgeo_raster_resolve_stretch <- function(stretch, stats, band_idx) {
  type <- (stretch$type %||% "percent")
  lo <- numeric(length(band_idx)); hi <- numeric(length(band_idx))
  for (k in seq_along(band_idx)) {
    b <- stats$bands[[band_idx[k]]]
    if (type == "minmax") {
      lo[k] <- b$min; hi[k] <- b$max
    } else if (type == "stddev") {
      n <- as.numeric(stretch$nStd %||% 2)
      lo[k] <- max(b$min, b$mean - n * b$sd)
      hi[k] <- min(b$max, b$mean + n * b$sd)
    } else if (type == "custom") {
      mins <- stretch$min %||% list(); maxs <- stretch$max %||% list()
      lo[k] <- if (length(mins) > 0) as.numeric(mins[[min(k, length(mins))]] %||% b$min) else b$min
      hi[k] <- if (length(maxs) > 0) as.numeric(maxs[[min(k, length(maxs))]] %||% b$max) else b$max
    } else {  # percent clip (default 2-98)
      lo[k] <- b$q02; hi[k] <- b$q98
      p_lo <- as.numeric(stretch$pLow %||% 2); p_hi <- as.numeric(stretch$pHigh %||% 98)
      if (p_lo != 2 || p_hi != 98) {
        # Re-derive from the layer's cached sample when non-default percentiles
        # are requested; caller stores the sample on the entry.
        lo[k] <- NA_real_; hi[k] <- NA_real_
      }
    }
    if (!is.na(lo[k]) && !is.na(hi[k]) && hi[k] <= lo[k]) hi[k] <- lo[k] + 1e-9
  }
  list(lo = lo, hi = hi, type = type)
}

# Fill NA lo/hi (non-default percent clip) from a cached sample matrix.
.ourgeo_raster_percent_from_sample <- function(res, stretch, sample, band_idx) {
  p_lo <- as.numeric(stretch$pLow %||% 2) / 100
  p_hi <- as.numeric(stretch$pHigh %||% 98) / 100
  for (k in seq_along(band_idx)) {
    if (is.na(res$lo[k]) || is.na(res$hi[k])) {
      v <- sample[, band_idx[k]]
      v <- v[is.finite(v)]
      if (length(v) == 0) v <- c(0, 1)
      q <- stats::quantile(v, c(p_lo, p_hi), names = FALSE, type = 7)
      res$lo[k] <- q[1]; res$hi[k] <- q[2]
      if (res$hi[k] <= res$lo[k]) res$hi[k] <- res$lo[k] + 1e-9
    }
  }
  res
}

# ---------------------------------------------------------------------------
# Tile rendering
# ---------------------------------------------------------------------------

# Read a 256x256 window for a 3857 tile bbox from the layer's warped file.
# Returns a 65536 x nbands(+alpha) numeric matrix (terra row-major order).
.ourgeo_raster_read_tile <- function(layer, bb) {
  tmp <- tempfile(tmpdir = .ourgeo_raster_dir(), fileext = ".tif")
  on.exit(unlink(tmp), add = TRUE)
  method <- if (identical(layer$symbology$resampling, "bilinear")) "bilinear" else "near"
  backend <- .ourgeo_env$raster_tile_backend %||% "warp"
  if (backend == "translate") {
    # -projwin is ulx uly lrx lry
    sf::gdal_utils("translate", source = layer$warped_path, destination = tmp,
                   options = c("-projwin",
                               format(c(bb[1], bb[4], bb[3], bb[2]), scientific = FALSE, trim = TRUE),
                               "-outsize", "256", "256", "-r", method,
                               "-of", "GTiff", "-co", "COMPRESS=NONE"),
                   quiet = TRUE)
  } else {
    sf::gdal_utils("warp", source = layer$warped_path, destination = tmp,
                   options = c("-te", format(bb, scientific = FALSE, trim = TRUE),
                               "-ts", "256", "256", "-r", method,
                               "-of", "GTiff", "-co", "COMPRESS=NONE"),
                   quiet = TRUE)
  }
  if (!file.exists(tmp)) return(NULL)
  terra::values(terra::rast(tmp), mat = TRUE)
}

# Clamp + scale a band vector into [0,1] against lo/hi.
.ourgeo_raster_scale01 <- function(v, lo, hi) {
  s <- (v - lo) / (hi - lo)
  s[!is.finite(s)] <- 0
  pmin.int(pmax.int(s, 0), 1)
}

# terra cell order is row-major; R matrices fill column-major, so byrow=TRUE
# puts cell i at image [row, col] directly.
.ourgeo_raster_channel <- function(v) matrix(v, nrow = 256, ncol = 256, byrow = TRUE)

# 65536 x (nb+alpha) matrix -> 256x256x4 RGBA array in [0,1].
.ourgeo_raster_colorize <- function(m, layer) {
  sym <- layer$symbology
  nb_data <- ncol(m) - 1L                       # last col = -dstalpha validity
  alpha <- m[, ncol(m)] / 255
  alpha[!is.finite(alpha)] <- 0
  nodata_transparent <- !isFALSE(sym$nodataTransparent)

  mode <- sym$mode %||% "singleband"
  if (mode == "rgb") {
    bi <- vapply(sym$bands, as.integer, integer(1))
    bi <- pmin.int(pmax.int(bi, 1L), nb_data)
    chans <- vector("list", 3)
    for (k in 1:3) {
      v <- m[, bi[min(k, length(bi))]]
      chans[[k]] <- .ourgeo_raster_scale01(
        v,
        layer$stretch$lo[min(k, length(layer$stretch$lo))],
        layer$stretch$hi[min(k, length(layer$stretch$hi))])
      if (nodata_transparent) alpha[is.na(v)] <- 0
    }
    R <- chans[[1]]; G <- chans[[2]]; B <- chans[[3]]
  } else if (mode == "categorical") {
    bi <- min(max(as.integer(sym$bands[[1]] %||% 1), 1L), nb_data)
    v <- m[, bi]
    idx <- match(v, layer$cat_values)
    miss <- is.na(idx)
    idx[miss] <- 1L
    R <- layer$cat_lut[idx, 1]; G <- layer$cat_lut[idx, 2]; B <- layer$cat_lut[idx, 3]
    alpha[miss] <- 0
  } else {  # singleband pseudocolor / gray (gray = a b/w colormap)
    bi <- min(max(as.integer(sym$bands[[1]] %||% 1), 1L), nb_data)
    v <- m[, bi]
    s <- .ourgeo_raster_scale01(v, layer$stretch$lo[1], layer$stretch$hi[1])
    idx <- as.integer(round(s * 255)) + 1L
    R <- layer$lut[idx, 1]; G <- layer$lut[idx, 2]; B <- layer$lut[idx, 3]
    if (nodata_transparent) alpha[is.na(v)] <- 0
    else { R[is.na(v)] <- layer$lut[1, 1]; G[is.na(v)] <- layer$lut[1, 2]; B[is.na(v)] <- layer$lut[1, 3] }
  }

  array(c(.ourgeo_raster_channel(R), .ourgeo_raster_channel(G),
          .ourgeo_raster_channel(B), .ourgeo_raster_channel(alpha)),
        dim = c(256, 256, 4))
}

# Fully transparent tile, encoded once.
.ourgeo_raster_blank_tile <- function() {
  if (is.null(.ourgeo_env$raster_blank_tile)) {
    .ourgeo_env$raster_blank_tile <-
      png::writePNG(array(0, dim = c(256, 256, 4)))
  }
  .ourgeo_env$raster_blank_tile
}

# ---------------------------------------------------------------------------
# Encoded-tile LRU (bounded; keys "layerId|version|z/x/y")
# ---------------------------------------------------------------------------

.OURGEO_TILE_CACHE_MAX <- 512L

.ourgeo_tile_cache_get <- function(key) {
  cache <- .ourgeo_env$raster_tile_cache
  if (is.null(cache)) return(NULL)
  cache[[key]]
}

.ourgeo_tile_cache_put <- function(key, bytes) {
  if (is.null(.ourgeo_env$raster_tile_cache)) {
    .ourgeo_env$raster_tile_cache <- new.env(parent = emptyenv(), hash = TRUE)
    .ourgeo_env$raster_tile_keys <- character(0)
  }
  cache <- .ourgeo_env$raster_tile_cache
  if (is.null(cache[[key]])) {
    .ourgeo_env$raster_tile_keys <- c(.ourgeo_env$raster_tile_keys, key)
    if (length(.ourgeo_env$raster_tile_keys) > .OURGEO_TILE_CACHE_MAX) {
      oldest <- .ourgeo_env$raster_tile_keys[1]
      .ourgeo_env$raster_tile_keys <- .ourgeo_env$raster_tile_keys[-1]
      if (!is.null(cache[[oldest]])) rm(list = oldest, envir = cache)
    }
  }
  cache[[key]] <- bytes
  invisible(NULL)
}

.ourgeo_tile_cache_evict <- function(prefix) {
  cache <- .ourgeo_env$raster_tile_cache
  if (is.null(cache)) return(invisible(NULL))
  keys <- .ourgeo_env$raster_tile_keys
  hit <- startsWith(keys, prefix)
  if (any(hit)) {
    rm(list = intersect(keys[hit], ls(cache)), envir = cache)
    .ourgeo_env$raster_tile_keys <- keys[!hit]
  }
  invisible(NULL)
}

# ---------------------------------------------------------------------------
# Layer lifecycle
# ---------------------------------------------------------------------------

.ourgeo_raster_drop_layer <- function(layer_id) {
  entry <- .ourgeo_env$raster_layers[[layer_id]]
  if (is.null(entry)) return(invisible(NULL))
  .ourgeo_tile_cache_evict(paste0(layer_id, "|"))
  tryCatch(unlink(entry$warped_path), error = function(e) NULL)
  .ourgeo_env$raster_layers[[layer_id]] <- NULL
  invisible(NULL)
}

# Safety net: drop layers whose backing object vanished or changed shape.
# Called from broadcast_env_if_changed() after a .GlobalEnv fingerprint change.
.ourgeo_raster_check_stale <- function() {
  ids <- names(.ourgeo_env$raster_layers %||% list())
  for (id in ids) {
    entry <- .ourgeo_env$raster_layers[[id]]
    if (is.null(entry)) next
    fp <- tryCatch({
      r <- .ourgeo_raster_resolve(entry$name, entry$env_name)
      .ourgeo_raster_fingerprint(r)
    }, error = function(e) NULL)
    if (is.null(fp) || !identical(fp, entry$fingerprint)) {
      .ourgeo_raster_drop_layer(id)
      broadcast_system(list(type = "raster_layer_invalidated",
                            data = list(layerId = id)))
    }
  }
  invisible(NULL)
}

# Drop every registered raster layer (session reset / project switch).
.ourgeo_raster_reset <- function() {
  for (id in names(.ourgeo_env$raster_layers %||% list())) {
    .ourgeo_raster_drop_layer(id)
  }
  invisible(NULL)
}
