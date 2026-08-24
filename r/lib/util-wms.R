# OGC WMS import helper. ourgeo_read_wms() exports a layer as *rendered*
# imagery (styled RGB pictures, not data values) via chunked GetMap requests,
# mosaicked into a file-backed, georeferenced terra SpatRaster.
#
# Requests use WMS 1.1.1 with SRS=EPSG:4326 — 1.1.1 keeps lon/lat axis order,
# sidestepping the 1.3.0 EPSG:4326 lat/lon axis flip that breaks naive bboxes.

.wms_num <- function(x) format(x, scientific = FALSE, trim = TRUE, digits = 15)

# Chunk soft cap: many servers cap GetMap around 2048-4096px, and smaller
# chunks retry cheaply. Matches WMS_CHUNK_PX in the renderer's estimate.
.wms_chunk_px <- 2048L

.wms_ext_for <- function(format) {
  if (grepl("tiff", format, ignore.case = TRUE)) ".tif"
  else if (grepl("jpe?g", format, ignore.case = TRUE)) ".jpg"
  else ".png"
}

# Download one GetMap response; XML bodies are service exceptions, not images.
.wms_download <- function(url, fileext) {
  tf <- tempfile(fileext = fileext)
  httr2::req_perform(httr2::req_timeout(httr2::request(url), 600), path = tf)
  head <- readBin(tf, "raw", 1L)
  if (length(head) == 1 && head == charToRaw("<")) {
    txt <- paste(readLines(tf, warn = FALSE), collapse = " ")
    m <- regmatches(txt, regexec("<ServiceException[^>]*>\\s*(.*?)\\s*</", txt))[[1]]
    unlink(tf)
    stop("GetMap failed: ", if (length(m) >= 2) m[2] else substr(txt, 1, 300))
  }
  tf
}

# Public entry point. Export a WMS layer as a SpatRaster of rendered imagery.
#
# `base_url` — the WMS endpoint (query-string bases like NASA GIBS work too).
# `layer`    — a named layer from GetCapabilities.
# `bbox`     — c(xmin, ymin, xmax, ymax) in EPSG:4326 (required — WMS has no
#              server-side "whole layer" request).
# `size`     — pixels on the long side; chunked at 2048px per request.
# `format`   — GetMap format; a (Geo)TIFF format keeps the server's
#              georeferencing, PNG/JPEG chunks are georeferenced locally.
# `time`     — TIME parameter for time-enabled layers (e.g. NASA GIBS).
ourgeo_read_wms <- function(base_url, layer, bbox, size = 2048L,
                            format = "image/png", time = NULL, max_tiles = 64L) {
  if (!requireNamespace("terra", quietly = TRUE)) stop("Package 'terra' is required.")
  if (!requireNamespace("httr2", quietly = TRUE)) stop("Package 'httr2' is required.")
  if (is.null(bbox)) stop("bbox is required: c(xmin, ymin, xmax, ymax) in EPSG:4326")
  bbox <- as.numeric(bbox)
  if (length(bbox) != 4 || bbox[3] <= bbox[1] || bbox[4] <= bbox[2]) {
    stop("bbox must be c(xmin, ymin, xmax, ymax) with xmax > xmin and ymax > ymin")
  }

  # Output size honoring the bbox aspect ratio, tiled to the chunk cap.
  size <- max(1L, as.integer(size))
  aspect <- (bbox[3] - bbox[1]) / (bbox[4] - bbox[2])
  px_w <- if (aspect >= 1) size else max(1L, as.integer(round(size * aspect)))
  px_h <- if (aspect >= 1) max(1L, as.integer(round(size / aspect))) else size
  nx <- as.integer(ceiling(px_w / .wms_chunk_px))
  ny <- as.integer(ceiling(px_h / .wms_chunk_px))
  if (nx * ny > max_tiles) {
    stop(sprintf(paste0(
      "This export needs %d GetMap requests (%dx%d px against a %dpx ",
      "per-request cap). Lower size=, shrink bbox=, or raise max_tiles=."),
      nx * ny, px_w, px_h, .wms_chunk_px))
  }

  sep <- if (grepl("\\?", base_url)) "&" else "?"
  fileext <- .wms_ext_for(format)
  dx <- (bbox[3] - bbox[1]) / nx
  dy <- (bbox[4] - bbox[2]) / ny
  cw <- as.integer(ceiling(px_w / nx))
  ch <- as.integer(ceiling(px_h / ny))

  tiles <- vector("list", nx * ny)
  k <- 0L
  for (iy in seq_len(ny)) {
    for (ix in seq_len(nx)) {
      k <- k + 1L
      cb <- c(bbox[1] + (ix - 1) * dx, bbox[2] + (iy - 1) * dy,
              bbox[1] + ix * dx,       bbox[2] + iy * dy)
      q <- c(
        "service=WMS", "version=1.1.1", "request=GetMap",
        paste0("layers=", utils::URLencode(layer, reserved = TRUE)),
        "styles=",
        "srs=EPSG:4326",
        paste0("bbox=", paste(vapply(cb, .wms_num, character(1)), collapse = ",")),
        paste0("width=", cw), paste0("height=", ch),
        paste0("format=", utils::URLencode(format, reserved = TRUE)),
        "transparent=TRUE"
      )
      if (!is.null(time)) q <- c(q, paste0("time=", utils::URLencode(as.character(time), reserved = TRUE)))
      url <- paste0(base_url, sep, paste(q, collapse = "&"))
      if (nx * ny > 1) message(sprintf("[WMS] GetMap tile %d/%d...", k, nx * ny))
      # One retry per chunk — busy map servers fail transiently.
      tf <- tryCatch(.wms_download(url, fileext), error = function(e) {
        message(sprintf("[WMS] tile %d failed (%s) — retrying...", k, conditionMessage(e)))
        Sys.sleep(2)
        .wms_download(url, fileext)
      })
      # PNG/JPEG chunks warn "unknown extent" before we assign one — expected.
      r <- withCallingHandlers(terra::rast(tf), warning = function(w) {
        if (grepl("unknown extent", conditionMessage(w))) invokeRestart("muffleWarning")
      })
      # PNG/JPEG (and some TIFFs) carry no georeferencing — the chunk bbox is
      # authoritative, since we asked for exactly it.
      if (terra::crs(r) == "") {
        terra::ext(r) <- terra::ext(cb[1], cb[3], cb[2], cb[4])
        terra::crs(r) <- "EPSG:4326"
      }
      tiles[[k]] <- r
    }
  }

  # Always land in a georeferenced GeoTIFF: a PNG/JPEG-backed raster only holds
  # its extent/CRS in memory, and downstream consumers (the map tile engine)
  # read the backing file directly.
  out <- if (length(tiles) == 1) {
    terra::writeRaster(tiles[[1]], tempfile(fileext = ".tif"), overwrite = TRUE,
                       gdal = c("TILED=YES", "COMPRESS=DEFLATE"))
  } else {
    terra::merge(terra::sprc(tiles),
                 filename = tempfile(fileext = ".tif"),
                 overwrite = TRUE,
                 wopt = list(gdal = c("TILED=YES", "COMPRESS=DEFLATE")))
  }
  if (terra::nlyr(out) %in% c(3L, 4L)) {
    names(out) <- c("red", "green", "blue", "alpha")[seq_len(terra::nlyr(out))]
    terra::RGB(out) <- 1:3
  }
  message(sprintf("[WMS] Imported %d x %d px (%d band%s) of rendered imagery from %s",
                  terra::ncol(out), terra::nrow(out), terra::nlyr(out),
                  if (terra::nlyr(out) == 1) "" else "s", layer))
  out
}
