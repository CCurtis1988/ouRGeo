# ERDDAP griddap import helper. ourgeo_read_erddap_grid() exports one variable
# at one time slice and returns a file-backed terra SpatRaster.
#
# Format choice: ERDDAP's .geotif output is an 8-bit *grayscale picture*
# (0-255), not data, and reading .nc needs GDAL's netCDF driver (broken on
# some systems). .esriAscii carries the real float values through GDAL's
# universal AAIGrid driver; we convert it to a compressed GeoTIFF locally.

.erddap_get_json <- function(url) {
  fetch <- function() {
    resp <- httr2::req_perform(httr2::req_timeout(httr2::request(url), 120))
    jsonlite::fromJSON(httr2::resp_body_string(resp), simplifyVector = FALSE)
  }
  tryCatch(fetch(), error = function(e) { Sys.sleep(2); fetch() })
}

.erddap_num <- function(x) format(x, scientific = FALSE, trim = TRUE, digits = 15)

# Parse the info/{id}/index.json table into dimension metadata:
# a data.frame of dimensions in dataset axis order (name, spacing, min, max)
# plus the set of data-variable names.
.erddap_grid_info <- function(base_url, dataset_id) {
  obj <- .erddap_get_json(paste0(base_url, "/info/", dataset_id, "/index.json"))
  t <- obj$table
  if (is.null(t)) stop("Could not read dataset info from ERDDAP.")
  cols <- unlist(t$columnNames)
  ci <- function(name) which(cols == name)[1]
  row_type_i <- ci("Row Type"); name_i <- ci("Variable Name")
  attr_i <- ci("Attribute Name"); value_i <- ci("Value")

  dims <- list()      # in listed (= axis) order
  variables <- character(0)
  attrs <- new.env(parent = emptyenv())
  for (r in t$rows) {
    row_type <- as.character(r[[row_type_i]])
    name <- as.character(r[[name_i]])
    if (row_type == "dimension") {
      # Value looks like "nValues=4320, evenlySpaced=true, averageSpacing=0.0417"
      # (time axes report e.g. "averageSpacing=1 day").
      val <- as.character(r[[value_i]])
      spacing_m <- regmatches(val, regexec("averageSpacing=(-?[0-9.eE+]+)", val))[[1]]
      n_m <- regmatches(val, regexec("nValues=([0-9]+)", val))[[1]]
      dims[[length(dims) + 1]] <- list(
        name = name,
        spacing = if (length(spacing_m) >= 2) as.numeric(spacing_m[2]) else NA_real_,
        n = if (length(n_m) >= 2) as.integer(n_m[2]) else NA_integer_
      )
    } else if (row_type == "variable") {
      variables <- c(variables, name)
    } else if (row_type == "attribute") {
      assign(paste0(name, "|", as.character(r[[attr_i]])), as.character(r[[value_i]]), envir = attrs)
    }
  }
  range_of <- function(axis) {
    v <- suppressWarnings(as.numeric(strsplit(
      get0(paste0(axis, "|actual_range"), envir = attrs, ifnotfound = ""), ","
    )[[1]]))
    if (length(v) == 2 && all(is.finite(v))) sort(v) else NULL
  }
  list(dims = dims, variables = variables, range_of = range_of)
}

# Public entry point. Export one griddap variable slice as a SpatRaster.
#
# `bbox` — c(xmin, ymin, xmax, ymax) in EPSG:4326; NULL = the grid's full extent.
# `time` — "last" or an ISO time within the dataset's range. Extra dimensions
#          (altitude, depth, ...) take their first index.
# `size` — approximate pixels on the long side; the export subsamples the
#          native grid with an integer stride to stay near this.
ourgeo_read_erddap_grid <- function(base_url, dataset_id, variable,
                                    bbox = NULL, time = "last", size = 2048L) {
  if (!requireNamespace("terra", quietly = TRUE)) stop("Package 'terra' is required.")
  if (!requireNamespace("httr2", quietly = TRUE)) stop("Package 'httr2' is required.")
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Package 'jsonlite' is required.")
  base_url <- sub("/+$", "", base_url)

  info <- .erddap_grid_info(base_url, dataset_id)
  if (!(variable %in% info$variables)) {
    stop(sprintf("Variable '%s' not found in dataset '%s'. Available: %s",
                 variable, dataset_id, paste(info$variables, collapse = ", ")))
  }
  dim_names <- vapply(info$dims, function(d) d$name, character(1))
  if (!all(c("latitude", "longitude") %in% dim_names)) {
    stop("This dataset is not a latitude/longitude grid — ouRGeo's GeoTIFF export ",
         "needs one. Import it manually via the dataset's NetCDF (.nc) URL instead.")
  }

  lon_r <- info$range_of("longitude"); lat_r <- info$range_of("latitude")
  if (is.null(bbox)) {
    if (is.null(lon_r) || is.null(lat_r)) stop("Dataset reports no lat/lon range; pass bbox= explicitly.")
    bbox <- c(lon_r[1], lat_r[1], lon_r[2], lat_r[2])
  }
  bbox <- as.numeric(bbox)
  if (length(bbox) != 4 || bbox[3] <= bbox[1] || bbox[4] <= bbox[2]) {
    stop("bbox must be c(xmin, ymin, xmax, ymax) with xmax > xmin and ymax > ymin")
  }
  # Clamp to the grid's extent so ERDDAP doesn't reject edge overshoot.
  if (!is.null(lon_r)) { bbox[1] <- max(bbox[1], lon_r[1]); bbox[3] <- min(bbox[3], lon_r[2]) }
  if (!is.null(lat_r)) { bbox[2] <- max(bbox[2], lat_r[1]); bbox[4] <- min(bbox[4], lat_r[2]) }
  if (bbox[3] <= bbox[1] || bbox[4] <= bbox[2]) {
    stop("The requested bbox does not intersect this grid's extent ",
         "(note: some grids use 0-360 longitudes).")
  }

  # Integer stride keeping the long side near `size`.
  size <- max(1L, as.integer(size))
  stride_for <- function(axis, lo, hi) {
    d <- info$dims[[which(dim_names == axis)[1]]]
    if (!is.finite(d$spacing) || d$spacing == 0) return(1L)
    cells <- abs(hi - lo) / abs(d$spacing)
    max(1L, as.integer(ceiling(cells / size)))
  }
  stride <- max(stride_for("longitude", bbox[1], bbox[3]),
                stride_for("latitude", bbox[2], bbox[4]))

  # Dimension subscripts in the dataset's axis order. Latitude axes can run
  # north→south: ERDDAP wants start/stop in the axis's own direction, which
  # the averageSpacing sign reveals.
  time_val <- if (is.null(time) || !nzchar(time) || identical(time, "last")) "last" else time
  subs <- vapply(info$dims, function(d) {
    if (d$name == "time") {
      paste0("[(", time_val, ")]")
    } else if (d$name == "longitude") {
      paste0("[(", .erddap_num(bbox[1]), "):", stride, ":(", .erddap_num(bbox[3]), ")]")
    } else if (d$name == "latitude") {
      desc <- is.finite(d$spacing) && d$spacing < 0
      lo <- if (desc) bbox[4] else bbox[2]
      hi <- if (desc) bbox[2] else bbox[4]
      paste0("[(", .erddap_num(lo), "):", stride, ":(", .erddap_num(hi), ")]")
    } else {
      message(sprintf("[ERDDAP] dimension '%s' takes its first index", d$name))
      "[0]"
    }
  }, character(1))

  url <- paste0(base_url, "/griddap/", dataset_id, ".esriAscii?",
                variable, paste(subs, collapse = ""))
  message(sprintf("[ERDDAP] griddap export %s/%s (stride %d, time %s)...",
                  dataset_id, variable, stride, time_val))

  tf <- tempfile(fileext = ".asc")
  resp <- httr2::req_perform(
    httr2::req_error(httr2::req_timeout(httr2::request(url), 600),
                     is_error = function(resp) FALSE),
    path = tf
  )
  if (httr2::resp_status(resp) >= 300) {
    txt <- paste(readLines(tf, warn = FALSE), collapse = " ")
    unlink(tf)
    m <- regmatches(txt, regexec('message="([^"]+)"', txt))[[1]]
    stop("griddap export failed: ",
         if (length(m) >= 2) m[2] else substr(txt, 1, 300),
         " (this export needs an evenly spaced lat/lon grid; ",
         "for other grids import the dataset's NetCDF URL manually.)")
  }

  r <- terra::rast(tf)
  if (terra::crs(r) == "") terra::crs(r) <- "EPSG:4326"
  # Re-land in a compressed GeoTIFF: the ASCII grid is bulky text, and
  # downstream consumers (the map tile engine) read the backing file directly.
  r <- terra::writeRaster(r, tempfile(fileext = ".tif"), overwrite = TRUE,
                          gdal = c("TILED=YES", "COMPRESS=DEFLATE"))
  unlink(tf)
  if (terra::nlyr(r) == 1) names(r) <- variable
  message(sprintf("[ERDDAP] Imported %d x %d px (%s) from %s",
                  terra::ncol(r), terra::nrow(r), variable, dataset_id))
  r
}
