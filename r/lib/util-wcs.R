# OGC WCS import helper. ourgeo_read_wcs() exports a coverage subset as a
# GeoTIFF via GetCoverage 2.0.1 and returns a file-backed terra SpatRaster.
#
# DescribeCoverage is parsed with targeted regexes (srsName / axisLabels /
# corner elements of the GML envelope) rather than a full XML parser — these
# three fields are stable across GeoServer, MapServer, rasdaman and EOX
# deployments, and it keeps xml2 out of ouRGeo's R dependencies.

.wcs_url <- function(base_url, params) {
  sep <- if (grepl("\\?", base_url)) "&" else "?"
  paste0(base_url, sep, paste(names(params), unname(params), sep = "=", collapse = "&"))
}

.wcs_num <- function(x) format(x, scientific = FALSE, trim = TRUE, digits = 15)

.wcs_fetch_text <- function(url) {
  resp <- httr2::req_perform(httr2::req_timeout(httr2::request(url), 120))
  httr2::resp_body_string(resp)
}

# First regex capture group in `text`, or NULL.
.wcs_extract <- function(text, pattern) {
  m <- regmatches(text, regexec(pattern, text))[[1]]
  if (length(m) >= 2) m[2] else NULL
}

# "an axis is vertical" heuristic from its GML label (Lat/N/y vs Long/E/x).
.wcs_axis_is_y <- function(label) {
  grepl("^(lat|n|northing|y)", label, ignore.case = TRUE)
}

# Sniff a downloaded GetCoverage body: XML = an OWS exception, not a raster.
.wcs_check_tif <- function(tf) {
  head <- readBin(tf, "raw", 1L)
  if (length(head) == 1 && head == charToRaw("<")) {
    txt <- paste(readLines(tf, warn = FALSE), collapse = " ")
    msg <- .wcs_extract(txt, "<[a-zA-Z0-9:]*ExceptionText>\\s*(.*?)\\s*</") %||%
      substr(txt, 1, 300)
    unlink(tf)
    stop("GetCoverage failed: ", msg)
  }
  tf
}

.wcs_download <- function(url) {
  tf <- tempfile(fileext = ".tif")
  # Never throw on HTTP status: WCS errors arrive as XML exception bodies
  # (often HTTP 404/500) whose text we need — e.g. to detect read limits.
  resp <- httr2::req_perform(
    httr2::req_error(httr2::req_timeout(httr2::request(url), 600),
                     is_error = function(resp) FALSE),
    path = tf
  )
  tf <- .wcs_check_tif(tf)
  if (httr2::resp_status(resp) >= 300) {
    unlink(tf)
    stop("GetCoverage failed: HTTP ", httr2::resp_status(resp))
  }
  tf
}

# Public entry point. Export an OGC WCS coverage as a SpatRaster.
#
# `base_url`    — the WCS endpoint (no query string needed).
# `coverage_id` — a CoverageId from GetCapabilities.
# `bbox`        — c(xmin, ymin, xmax, ymax) in `bbox_sr`; NULL = the coverage's
#                 full native envelope.
# `size`        — pixels on the long side (server-side scaling via SCALESIZE;
#                 servers without the scaling extension fall back to native
#                 resolution over the requested bbox).
ourgeo_read_wcs <- function(base_url, coverage_id, bbox = NULL, bbox_sr = 4326,
                            size = 2048L) {
  if (!requireNamespace("terra", quietly = TRUE)) stop("Package 'terra' is required.")
  if (!requireNamespace("httr2", quietly = TRUE)) stop("Package 'httr2' is required.")
  base_url <- sub("/+$", "", base_url)

  desc <- .wcs_fetch_text(.wcs_url(base_url, c(
    service = "WCS", version = "2.0.1", request = "DescribeCoverage",
    coverageId = coverage_id
  )))
  if (grepl("ExceptionReport", desc, fixed = TRUE)) {
    stop("DescribeCoverage failed: ",
         .wcs_extract(desc, "<[a-zA-Z0-9:]*ExceptionText>\\s*(.*?)\\s*</") %||% "unknown error")
  }

  srs <- .wcs_extract(desc, 'srsName="([^"]+)"')
  axes_raw <- .wcs_extract(desc, 'axisLabels="([^"]+)"')
  lower <- .wcs_extract(desc, "<[a-zA-Z0-9:]*lowerCorner>\\s*([^<]+)</")
  upper <- .wcs_extract(desc, "<[a-zA-Z0-9:]*upperCorner>\\s*([^<]+)</")
  if (is.null(axes_raw) || is.null(lower) || is.null(upper)) {
    stop("Could not read the coverage envelope from DescribeCoverage — ",
         "this server's response layout is unsupported.")
  }
  axes <- strsplit(trimws(axes_raw), "\\s+")[[1]]
  lo <- as.numeric(strsplit(trimws(lower), "\\s+")[[1]])
  hi <- as.numeric(strsplit(trimws(upper), "\\s+")[[1]])
  # srsName forms in the wild: ".../def/crs/EPSG/0/4326", "urn:ogc:def:crs:EPSG::4326",
  # "EPSG:4326" — the code is the trailing digit run.
  epsg <- suppressWarnings(as.integer(.wcs_extract(srs %||% "", "([0-9]+)[^0-9]*$")))
  if (length(epsg) == 0 || is.na(epsg)) epsg <- 4326L

  # Which envelope axis is vertical? (GML axis order is CRS-defined: 4326 is
  # Lat Long; projected CRSes are usually E N / x y.)
  y_first <- .wcs_axis_is_y(axes[1])
  x_i <- if (y_first) 2L else 1L
  y_i <- if (y_first) 1L else 2L

  # Requested extent in the coverage's native CRS.
  if (is.null(bbox)) {
    native <- c(lo[x_i], lo[y_i], hi[x_i], hi[y_i])
  } else {
    bbox <- as.numeric(bbox)
    if (length(bbox) != 4 || bbox[3] <= bbox[1] || bbox[4] <= bbox[2]) {
      stop("bbox must be c(xmin, ymin, xmax, ymax) with xmax > xmin and ymax > ymin")
    }
    if (as.integer(bbox_sr) == epsg) {
      native <- bbox
    } else {
      if (!requireNamespace("sf", quietly = TRUE)) stop("Package 'sf' is required for bbox reprojection.")
      poly <- sf::st_as_sfc(sf::st_bbox(
        c(xmin = bbox[1], ymin = bbox[2], xmax = bbox[3], ymax = bbox[4]),
        crs = sf::st_crs(as.integer(bbox_sr))
      ))
      nb <- sf::st_bbox(sf::st_transform(poly, sf::st_crs(epsg)))
      native <- as.numeric(nb[c("xmin", "ymin", "xmax", "ymax")])
    }
    # Clamp to the coverage envelope so servers don't reject edge overshoot.
    native[1] <- max(native[1], lo[x_i]); native[2] <- max(native[2], lo[y_i])
    native[3] <- min(native[3], hi[x_i]); native[4] <- min(native[4], hi[y_i])
    if (native[3] <= native[1] || native[2] >= native[4]) {
      stop("The requested bbox does not intersect this coverage's extent.")
    }
  }

  # Output size honoring the bbox aspect ratio.
  size <- max(1L, as.integer(size))
  aspect <- (native[3] - native[1]) / (native[4] - native[2])
  px_w <- if (aspect >= 1) size else max(1L, as.integer(round(size * aspect)))
  px_h <- if (aspect >= 1) max(1L, as.integer(round(size / aspect))) else size

  base_params <- c(
    service = "WCS", version = "2.0.1", request = "GetCoverage",
    coverageId = coverage_id, format = "image/tiff"
  )
  subsets <- function(bb) paste0(
    "SUBSET=", axes[x_i], "(", .wcs_num(bb[1]), ",", .wcs_num(bb[3]), ")",
    "&SUBSET=", axes[y_i], "(", .wcs_num(bb[2]), ",", .wcs_num(bb[4]), ")"
  )

  # A server that hits its input-read limit says so in the exception text
  # (e.g. GeoServer: "trying to read too much data, the limit is ...MB").
  is_limit_error <- function(e) grepl("too much data|limit is|exceeds.*limit|size limit",
                                      conditionMessage(e), ignore.case = TRUE)

  # One GetCoverage attempt. SCALESIZE axis labels vary by implementation:
  # GeoServer/MapServer want the grid axes (i, j); rasdaman wants the CRS axis
  # labels. An unscaled request (native resolution over the subset) is the
  # last resort for servers without the scaling extension.
  fetch_one <- function(bb, w, h) {
    base <- paste0(.wcs_url(base_url, base_params), "&", subsets(bb))
    styles <- list(
      ij = paste0(base, "&SCALESIZE=i(", w, "),j(", h, ")"),
      crs = paste0(base, "&SCALESIZE=", axes[x_i], "(", w, "),", axes[y_i], "(", h, ")"),
      none = base
    )
    last <- NULL
    for (nm in names(styles)) {
      tf <- tryCatch(.wcs_download(styles[[nm]]), error = function(e) e)
      if (!inherits(tf, "error")) return(tf)
      # A read-limit error means the subset itself is too big — scaling style
      # won't fix it (unscaled reads even more), so bubble up for a split.
      if (is_limit_error(tf)) stop(tf)
      last <- tf
    }
    stop(last)
  }

  # Fetch with adaptive bisection: when the server's read limit trips, split
  # the bbox along its longer pixel side and mosaic the halves.
  max_tiles <- 64L
  tile_count <- 0L
  fetch_tiles <- function(bb, w, h) {
    tf <- tryCatch(fetch_one(bb, w, h), error = function(e) e)
    if (!inherits(tf, "error")) {
      tile_count <<- tile_count + 1L
      if (tile_count > 1L) message(sprintf("[WCS] tile %d done...", tile_count))
      return(list(terra::rast(tf)))
    }
    if (!is_limit_error(tf) || max(w, h) < 2L) stop(tf)
    if (tile_count + 2L > max_tiles) {
      stop("GetCoverage failed even after splitting into ", max_tiles,
           " requests: ", conditionMessage(tf))
    }
    message("[WCS] server read limit hit — splitting the request...")
    if (w >= h) {
      xm <- (bb[1] + bb[3]) / 2
      c(fetch_tiles(c(bb[1], bb[2], xm, bb[4]), ceiling(w / 2), h),
        fetch_tiles(c(xm, bb[2], bb[3], bb[4]), floor(w / 2), h))
    } else {
      ym <- (bb[2] + bb[4]) / 2
      c(fetch_tiles(c(bb[1], ym, bb[3], bb[4]), w, ceiling(h / 2)),
        fetch_tiles(c(bb[1], bb[2], bb[3], ym), w, floor(h / 2)))
    }
  }

  message(sprintf("[WCS] GetCoverage %s (%d x %d px)...", coverage_id, px_w, px_h))
  tiles <- fetch_tiles(native, px_w, px_h)

  r <- if (length(tiles) == 1) tiles[[1]] else {
    terra::merge(terra::sprc(tiles),
                 filename = tempfile(fileext = ".tif"),
                 overwrite = TRUE,
                 wopt = list(gdal = c("TILED=YES", "COMPRESS=DEFLATE")))
  }
  if (terra::nlyr(r) == 1) {
    names(r) <- gsub("[^A-Za-z0-9_.]+", "_", coverage_id)
  }
  message(sprintf("[WCS] Imported %d x %d px (%d band%s) from %s",
                  terra::ncol(r), terra::nrow(r), terra::nlyr(r),
                  if (terra::nlyr(r) == 1) "" else "s", coverage_id))
  r
}
