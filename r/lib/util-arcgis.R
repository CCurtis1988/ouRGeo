# ArcGIS REST reader for the Data Connector's Esri provider.
#
# Why this exists: sf::st_read() cannot reliably read an ArcGIS ".../query" URL
# directly — GDAL misidentifies the response and yields empty geometry — and
# GDAL's ESRIJSON driver silently drops true curves (curveRings/curvePaths),
# returning EMPTY. So we fetch EsriJSON ourselves (requesting true curves),
# read attributes via GDAL, and rebuild geometry as curved OGC WKT
# (CIRCULARSTRING / COMPOUNDCURVE / CURVEPOLYGON) whenever the layer is curved —
# preserving arcs exactly for sfarc rather than linearizing them. Straight
# layers take a fast path straight through GDAL.
#
# Registered into .GlobalEnv at session init (see handlers-exec.R) so the
# Data Connector's generated, echoed import code can call ourgeo_read_arcgis().

# Format a coordinate number without scientific notation, at full useful precision.
.arcgis_num <- function(x) format(x, scientific = FALSE, trim = TRUE, digits = 15)

# One [x, y] EsriJSON vertex (a 2-element unnamed list) -> "x y".
.arcgis_pt <- function(p) paste(.arcgis_num(p[[1]]), .arcgis_num(p[[2]]))

# True for a plain coordinate element (unnamed length-2 list); FALSE for a
# curve segment object ({"c":…}, {"a":…}, {"b":…}).
.arcgis_is_point <- function(el) is.null(names(el)) && length(el) == 2

# Endpoint of a curve segment object (first element of its parameter array).
.arcgis_curve_end <- function(el) el[[1]][[1]]

# Resolve a curve segment to a CIRCULARSTRING through-point + endpoint, given
# the previous vertex `prev`. Circular arcs ("c") are exact; elliptic ("a") are
# treated as circular through their midpoint (exact when circular, a close
# approximation otherwise); anything else falls back to a straight segment.
.arcgis_curve_mid_end <- function(el, prev) {
  nm <- names(el)[1]
  par <- el[[1]]
  if (nm == "c") {
    # {"c": [end, throughPoint]}  -> CIRCULARSTRING(prev, through, end)
    return(list(mid = par[[2]], end = par[[1]], curved = TRUE))
  }
  if (nm == "a") {
    # {"a": [end, center, minor, clockwise, rotation, axis, ratio]}
    end <- par[[1]]; center <- par[[2]]
    cx <- center[[1]]; cy <- center[[2]]
    sx <- prev[[1]];  sy <- prev[[2]]
    ex <- end[[1]];   ey <- end[[2]]
    r  <- sqrt((sx - cx)^2 + (sy - cy)^2)
    a0 <- atan2(sy - cy, sx - cx)
    a1 <- atan2(ey - cy, ex - cx)
    clockwise <- length(par) >= 4 && isTRUE(as.logical(par[[4]]))
    d <- a1 - a0
    if (clockwise) { if (d > 0) d <- d - 2 * pi } else { if (d < 0) d <- d + 2 * pi }
    am <- a0 + d / 2
    mid <- list(cx + r * cos(am), cy + r * sin(am))
    return(list(mid = mid, end = end, curved = TRUE))
  }
  # Unsupported ("b" bezier or unknown): degrade to a straight segment.
  list(mid = NULL, end = .arcgis_curve_end(el), curved = FALSE)
}

# Flatten a ring/path's vertices (endpoints only) for orientation tests.
.arcgis_ring_coords <- function(path) {
  out <- list()
  for (el in path) out[[length(out) + 1L]] <- if (.arcgis_is_point(el)) el else .arcgis_curve_end(el)
  out
}

# Signed area (shoelace) of a ring's endpoint polygon. Esri exterior rings are
# clockwise (negative area here); holes are counter-clockwise (positive).
.arcgis_signed_area <- function(coords) {
  n <- length(coords)
  if (n < 3) return(0)
  s <- 0
  for (i in seq_len(n)) {
    a <- coords[[i]]; b <- coords[[if (i == n) 1L else i + 1L]]
    s <- s + (a[[1]] * b[[2]] - b[[1]] * a[[2]])
  }
  s / 2
}

# Build one ring/path as a WKT member: a linear "(x y, …)" ring, or a
# "COMPOUNDCURVE(…)" when it contains curve segments.
.arcgis_path_member <- function(path) {
  if (length(path) == 0) return(list(member = "()", curved = FALSE))
  prev <- path[[1]]
  run <- list(prev)          # accumulating straight vertices
  comps <- list()            # COMPOUNDCURVE components (strings)
  curved <- FALSE
  flush_run <- function() {
    if (length(run) >= 2) {
      comps[[length(comps) + 1L]] <<- paste0("(", paste(vapply(run, .arcgis_pt, ""), collapse = ", "), ")")
    }
  }
  for (i in seq_along(path)[-1]) {
    el <- path[[i]]
    if (.arcgis_is_point(el)) {
      run[[length(run) + 1L]] <- el
      prev <- el
    } else {
      me <- .arcgis_curve_mid_end(el, prev)
      if (isTRUE(me$curved)) {
        flush_run()
        comps[[length(comps) + 1L]] <- paste0(
          "CIRCULARSTRING(", .arcgis_pt(prev), ", ", .arcgis_pt(me$mid), ", ", .arcgis_pt(me$end), ")")
        curved <- TRUE
        prev <- me$end
        run <- list(me$end)
      } else {
        run[[length(run) + 1L]] <- me$end
        prev <- me$end
      }
    }
  }
  flush_run()
  if (!curved) {
    # Pure linear ring: a single "(…)" component is the whole ring.
    return(list(member = comps[[1]], curved = FALSE))
  }
  list(member = paste0("COMPOUNDCURVE(", paste(unlist(comps), collapse = ", "), ")"), curved = TRUE)
}

# EsriJSON polygon (rings or curveRings) -> MULTIPOLYGON / MULTISURFACE WKT.
.arcgis_polygon_wkt <- function(rings) {
  if (length(rings) == 0) return("MULTIPOLYGON EMPTY")
  polys <- list()      # each: list(members = chr[], curved = bool)
  for (ring in rings) {
    coords <- .arcgis_ring_coords(ring)
    area <- .arcgis_signed_area(coords)
    m <- .arcgis_path_member(ring)
    is_hole <- area > 0 && length(polys) > 0     # CCW ring following an exterior
    if (is_hole) {
      cur <- polys[[length(polys)]]
      cur$members <- c(cur$members, m$member)
      cur$curved <- cur$curved || m$curved
      polys[[length(polys)]] <- cur
    } else {
      polys[[length(polys) + 1L]] <- list(members = m$member, curved = m$curved)
    }
  }
  any_curved <- any(vapply(polys, function(p) p$curved, logical(1)))
  body <- vapply(polys, function(p) {
    if (any_curved) paste0("CURVEPOLYGON(", paste(p$members, collapse = ", "), ")")
    else paste0("(", paste(p$members, collapse = ", "), ")")
  }, "")
  if (any_curved) paste0("MULTISURFACE(", paste(body, collapse = ", "), ")")
  else paste0("MULTIPOLYGON(", paste(paste0("(", vapply(polys, function(p) paste(p$members, collapse = ", "), ""), ")"), collapse = ", "), ")")
}

# EsriJSON polyline (paths or curvePaths) -> MULTILINESTRING / MULTICURVE WKT.
.arcgis_polyline_wkt <- function(paths) {
  if (length(paths) == 0) return("MULTILINESTRING EMPTY")
  ms <- lapply(paths, .arcgis_path_member)
  any_curved <- any(vapply(ms, function(m) m$curved, logical(1)))
  members <- vapply(ms, function(m) m$member, "")
  if (any_curved) paste0("MULTICURVE(", paste(members, collapse = ", "), ")")
  else paste0("MULTILINESTRING(", paste(members, collapse = ", "), ")")
}

# One EsriJSON feature geometry -> WKT string, dispatched on the layer type.
.arcgis_feature_wkt <- function(geom, gtype) {
  if (is.null(geom)) {
    return(switch(gtype,
      esriGeometryPoint = "POINT EMPTY", esriGeometryMultipoint = "MULTIPOINT EMPTY",
      esriGeometryPolyline = "MULTILINESTRING EMPTY", "MULTIPOLYGON EMPTY"))
  }
  if (gtype == "esriGeometryPoint") {
    if (is.null(geom$x) || is.null(geom$y) || is.na(geom$x)) return("POINT EMPTY")
    return(paste0("POINT(", .arcgis_num(geom$x), " ", .arcgis_num(geom$y), ")"))
  }
  if (gtype == "esriGeometryMultipoint") {
    pts <- geom$points %||% list()
    if (!length(pts)) return("MULTIPOINT EMPTY")
    return(paste0("MULTIPOINT(", paste(vapply(pts, .arcgis_pt, ""), collapse = ", "), ")"))
  }
  if (gtype == "esriGeometryPolyline") {
    return(.arcgis_polyline_wkt(geom$curvePaths %||% geom$paths %||% list()))
  }
  # Polygon (default)
  .arcgis_polygon_wkt(geom$curveRings %||% geom$rings %||% list())
}

# Extract an sf crs from an EsriJSON spatialReference block.
.arcgis_crs <- function(sr) {
  if (is.null(sr)) return(sf::NA_crs_)
  wkid <- sr$latestWkid %||% sr$wkid
  if (!is.null(wkid)) return(sf::st_crs(as.integer(wkid)))
  if (!is.null(sr$wkt)) return(sf::st_crs(sr$wkt))
  sf::NA_crs_
}

# Read one already-fetched EsriJSON page (raw text + parsed object) as sf.
# Straight pages go through GDAL's ESRIJSON driver; curved pages read attributes
# via GDAL and rebuild geometry from the parsed curves.
.arcgis_read_page <- function(txt, obj) {
  tf <- tempfile(fileext = ".json")
  writeLines(txt, tf)
  on.exit(unlink(tf), add = TRUE)

  has_curve <- grepl('"curve(Rings|Paths)"', txt)
  x <- sf::st_read(tf, quiet = TRUE, drivers = "ESRIJSON")
  if (!has_curve) return(x)

  gtype <- obj$geometryType %||% "esriGeometryPolygon"
  crs <- .arcgis_crs(obj$spatialReference)
  wkts <- vapply(obj$features, function(ft) .arcgis_feature_wkt(ft$geometry, gtype), "")
  if (length(wkts) != nrow(x)) return(x)   # row mismatch — keep GDAL's result
  sf::st_set_geometry(x, sf::st_as_sfc(wkts, crs = crs))
}

# Fetch one page of EsriJSON. Returns list(txt, obj); obj$error is left intact
# so the caller can react (e.g. back off) rather than aborting the whole import.
.arcgis_fetch_page <- function(base_url, where, out_fields, n, off, token) {
  q <- c(
    paste0("where=", utils::URLencode(where, reserved = TRUE)),
    paste0("outFields=", utils::URLencode(out_fields, reserved = TRUE)),
    "f=json", "returnGeometry=true", "returnTrueCurves=true",
    paste0("resultRecordCount=", n), paste0("resultOffset=", off)
  )
  if (!is.null(token)) q <- c(q, paste0("token=", utils::URLencode(token, reserved = TRUE)))
  url <- paste0(base_url, "?", paste(q, collapse = "&"))
  txt <- paste(readLines(url, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  list(txt = txt, obj = jsonlite::fromJSON(txt, simplifyVector = FALSE))
}

# Public entry point. Paginates an ArcGIS Feature/Map layer query endpoint and
# returns an sf object, preserving true curves when the layer has them.
#
# `page_size` is an upper bound, not a promise: some layers advertise a
# maxRecordCount they can't actually satisfy for detailed geometry and answer a
# large page with HTTP 500 ("Error performing query operation"). On any page
# error we halve the request size and retry the same offset (down to
# `min_page`), so such layers import instead of failing.
ourgeo_read_arcgis <- function(base_url, where = "1=1", max_records = 5000L,
                               page_size = 1000L, out_fields = "*", token = NULL,
                               min_page = 50L) {
  if (!requireNamespace("sf", quietly = TRUE)) stop("Package 'sf' is required.")
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Package 'jsonlite' is required.")
  parts <- list()
  off <- 0L
  cur_page <- as.integer(page_size)
  repeat {
    remaining <- max_records - off
    if (remaining <= 0) break
    n <- min(cur_page, remaining)

    res <- tryCatch(.arcgis_fetch_page(base_url, where, out_fields, n, off, token),
                    error = function(e) list(err = conditionMessage(e)))
    err_msg <- res$err %||% (if (!is.null(res$obj$error))
      (res$obj$error$message %||% paste("code", res$obj$error$code %||% "?")) else NULL)

    if (!is.null(err_msg)) {
      # Too many detailed features (or a transient failure) — shrink and retry.
      if (n > min_page) { cur_page <- max(min_page, n %/% 2L); next }
      stop(sprintf("ArcGIS query failed at offset %d (page size %d): %s", off, n, err_msg))
    }

    feats <- res$obj$features %||% list()
    if (length(feats) == 0) break
    parts[[length(parts) + 1L]] <- .arcgis_read_page(res$txt, res$obj)

    off <- off + length(feats)
    if (length(feats) < n) break                     # last (partial) page
    if (!isTRUE(res$obj$exceededTransferLimit)) break # server signalled all rows returned
    if (off >= max_records) break
  }
  if (!length(parts)) return(sf::st_sf(geometry = sf::st_sfc(), crs = sf::NA_crs_))
  do.call(rbind, parts)
}

# ---------------------------------------------------------------------------
# ArcGIS ImageServer reader (raster services, e.g. USGS 3DEP elevation).
#
# ImageServer is a different API from Feature/Map services: pixels come from
# /exportImage as a rendered GeoTIFF, capped per request by the server's
# maxImageWidth/Height. This helper fetches the requested bbox at the requested
# resolution, tiling into a grid of exportImage calls and mosaicking with terra
# when one request can't cover it, and returns a SpatRaster.
# ---------------------------------------------------------------------------

# GET a JSON endpoint (with optional token) via httr2 — libcurl TLS + generous
# timeout, matching util-sdmx's rationale (base url() connections are fragile).
# One quiet retry: government ArcGIS servers fail transiently under load.
.arcgis_get_json <- function(url) {
  fetch <- function() {
    resp <- httr2::req_perform(httr2::req_timeout(httr2::request(url), 120))
    jsonlite::fromJSON(httr2::resp_body_string(resp), simplifyVector = FALSE)
  }
  tryCatch(fetch(), error = function(e) { Sys.sleep(2); fetch() })
}

# Download a binary exportImage response to a temp file. ArcGIS reports errors
# as HTTP-200 JSON bodies, so sniff the leading byte before trusting the file.
.arcgis_download_image <- function(url) {
  tf <- tempfile(fileext = ".tif")
  httr2::req_perform(httr2::req_timeout(httr2::request(url), 600), path = tf)
  head <- readBin(tf, "raw", 1L)
  if (length(head) == 1 && head == charToRaw("{")) {
    obj <- tryCatch(jsonlite::fromJSON(readLines(tf, warn = FALSE), simplifyVector = FALSE),
                    error = function(e) NULL)
    msg <- obj$error$message %||% "server returned an error response"
    unlink(tf)
    stop("exportImage failed: ", msg)
  }
  tf
}

# Public entry point. Export an ArcGIS ImageServer's pixels as a SpatRaster.
#
# `service_url` — the .../ImageServer URL.
# `bbox`        — c(xmin, ymin, xmax, ymax) in `bbox_sr`; NULL = the service's
#                 full extent (in the service's own spatial reference).
# `size`        — pixels on the long side of the requested bbox. When this
#                 exceeds the server's per-request cap the export is tiled into
#                 up to `max_tiles` chunks and mosaicked.
ourgeo_read_esri_image <- function(service_url, bbox = NULL, bbox_sr = 4326,
                                   size = 2048L, token = NULL, max_tiles = 64L) {
  if (!requireNamespace("terra", quietly = TRUE)) stop("Package 'terra' is required.")
  if (!requireNamespace("httr2", quietly = TRUE)) stop("Package 'httr2' is required.")
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Package 'jsonlite' is required.")

  service_url <- sub("/+$", "", service_url)
  tok <- if (!is.null(token)) paste0("&token=", utils::URLencode(token, reserved = TRUE)) else ""
  info <- .arcgis_get_json(paste0(service_url, "?f=json",
                                  if (nzchar(tok)) sub("^&", "&", tok) else ""))
  if (!is.null(info$error)) {
    stop("ImageServer metadata request failed: ", info$error$message %||% "unknown error")
  }

  # Requested extent + spatial reference.
  if (is.null(bbox)) {
    fe <- info$fullExtent %||% info$extent
    if (is.null(fe)) stop("Service reports no extent; pass bbox= explicitly")
    bbox <- c(fe$xmin, fe$ymin, fe$xmax, fe$ymax)
    bbox_sr <- fe$spatialReference$latestWkid %||% fe$spatialReference$wkid %||% 4326
  }
  bbox <- as.numeric(bbox)
  if (length(bbox) != 4 || bbox[3] <= bbox[1] || bbox[4] <= bbox[2]) {
    stop("bbox must be c(xmin, ymin, xmax, ymax) with xmax > xmin and ymax > ymin")
  }

  # Output size honoring the bbox aspect ratio, tiled to the server's caps.
  # Chunks are additionally soft-capped at 2048px per side: servers often
  # *accept* their advertised maximum but time out rendering it (USGS 3DEP
  # 504s well below its advertised cap), and smaller chunks retry cheaply.
  max_w <- min(as.integer(info$maxImageWidth %||% 4000L), 2048L)
  max_h <- min(as.integer(info$maxImageHeight %||% 4000L), 2048L)
  aspect <- (bbox[3] - bbox[1]) / (bbox[4] - bbox[2])
  size <- max(1L, as.integer(size))
  px_w <- if (aspect >= 1) size else max(1L, as.integer(round(size * aspect)))
  px_h <- if (aspect >= 1) max(1L, as.integer(round(size / aspect))) else size

  nx <- as.integer(ceiling(px_w / max_w))
  ny <- as.integer(ceiling(px_h / max_h))
  if (nx * ny > max_tiles) {
    stop(sprintf(paste0(
      "This export needs %d exportImage requests (%dx%d px against a %dx%d ",
      "per-request cap). Lower size=, shrink bbox=, or raise max_tiles=."),
      nx * ny, px_w, px_h, max_w, max_h))
  }

  pixel_type <- info$pixelType %||% NULL
  sr_arg <- as.character(bbox_sr)
  dx <- (bbox[3] - bbox[1]) / nx
  dy <- (bbox[4] - bbox[2]) / ny
  cw <- as.integer(ceiling(px_w / nx))
  ch <- as.integer(ceiling(px_h / ny))

  tiles <- vector("list", nx * ny)
  temps <- character(0)
  k <- 0L
  for (iy in seq_len(ny)) {
    for (ix in seq_len(nx)) {
      k <- k + 1L
      cb <- c(bbox[1] + (ix - 1) * dx, bbox[2] + (iy - 1) * dy,
              bbox[1] + ix * dx,       bbox[2] + iy * dy)
      q <- c(
        paste0("bbox=", paste(vapply(cb, .arcgis_num, character(1)), collapse = ",")),
        paste0("bboxSR=", sr_arg), paste0("imageSR=", sr_arg),
        paste0("size=", cw, ",", ch),
        "format=tiff", "f=image",
        "interpolation=RSP_BilinearInterpolation"
      )
      if (!is.null(pixel_type)) q <- c(q, paste0("pixelType=", pixel_type))
      url <- paste0(service_url, "/exportImage?", paste(q, collapse = "&"), tok)
      if (nx * ny > 1) {
        message(sprintf("[ArcGIS] exportImage tile %d/%d...", k, nx * ny))
      }
      # One retry per chunk — busy imagery servers 504 transiently.
      tf <- tryCatch(.arcgis_download_image(url), error = function(e) {
        message(sprintf("[ArcGIS] tile %d failed (%s) — retrying...",
                        k, conditionMessage(e)))
        Sys.sleep(2)
        .arcgis_download_image(url)
      })
      temps <- c(temps, tf)
      tiles[[k]] <- terra::rast(tf)
    }
  }

  # Mosaic to a session temp file (not memory): a 6000px float mosaic is
  # ~200 MB — file-backed keeps the env object lazy and lets the map tile
  # engine read the file directly instead of copying it again.
  r <- if (length(tiles) == 1) tiles[[1]] else {
    terra::merge(terra::sprc(tiles),
                 filename = tempfile(fileext = ".tif"),
                 overwrite = TRUE,
                 wopt = list(gdal = c("TILED=YES", "COMPRESS=DEFLATE")))
  }
  if (terra::nlyr(r) == 1) {
    nm <- info$name %||% "image"
    names(r) <- gsub("[^A-Za-z0-9_.]+", "_", nm)
  }
  message(sprintf("[ArcGIS] Imported %d x %d px (%d band%s) from %s",
                  terra::ncol(r), terra::nrow(r), terra::nlyr(r),
                  if (terra::nlyr(r) == 1) "" else "s",
                  info$name %||% basename(service_url)))
  r
}
