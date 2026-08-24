# Handlers: data preview, widget serving, Kaggle file listing
# (extracted from server.R — behavior-preserving modularization)

handle_data_preview <- function(body) {
  file_path <- body$file_path %||% stop("file_path required")
  format    <- body$format    %||% stop("format required")
  sheet     <- if (!is.null(body$sheet) && nchar(body$sheet) > 0) body$sheet else NULL
  skip      <- as.integer(body$skip %||% 0)
  header    <- if (!is.null(body$header)) isTRUE(body$header) else TRUE
  sep       <- body$sep %||% ","

  map_type <- function(ct) {
    ct <- ct[1]
    if (ct %in% c("numeric", "double")) return("numeric")
    if (ct == "integer") return("integer")
    if (ct == "logical") return("logical")
    if (ct == "factor")  return("factor")
    if (ct %in% c("Date", "POSIXct", "POSIXlt", "hms", "difftime")) return("Date")
    if (ct %in% c("sfc", "sfc_POINT", "sfc_MULTIPOINT", "sfc_LINESTRING",
                  "sfc_MULTILINESTRING", "sfc_POLYGON", "sfc_MULTIPOLYGON",
                  "sfc_GEOMETRYCOLLECTION", "sfc_GEOMETRY")) return("sf")
    "character"
  }

  tryCatch({
    tmp <- switch(format,
      csv          = read.csv(file_path, nrows = 0, skip = skip, header = header,
                              sep = sep, stringsAsFactors = FALSE),
      tsv          = read.delim(file_path, nrows = 0, skip = skip, header = header,
                                stringsAsFactors = FALSE),
      txt          = read.delim(file_path, nrows = 0, skip = skip, header = header,
                                sep = sep, stringsAsFactors = FALSE),
      excel        = readxl::read_excel(file_path, sheet = sheet, skip = skip,
                                        col_names = header, n_max = 0),
      ods          = readODS::read_ods(file_path, sheet = sheet %||% 1L,
                                       skip = skip, col_names = header, n_max = 0),
      json_tabular = { d <- jsonlite::fromJSON(file_path); if (is.data.frame(d)) d[0, ] else as.data.frame(d)[0, ] },
      parquet      = as.data.frame(arrow::read_parquet(file_path))[0, ],
      feather      = as.data.frame(arrow::read_feather(file_path))[0, ],
      sas          = haven::read_sas(file_path, n_max = 0),
      spss         = haven::read_spss(file_path, n_max = 0),
      stata        = haven::read_stata(file_path, n_max = 0),
      geojson      = sf::st_read(file_path, quiet = TRUE)[0, ],
      shapefile    = sf::st_read(file_path, quiet = TRUE)[0, ],
      kml          = sf::st_read(file_path, quiet = TRUE)[0, ],
      spatial      = sf::st_read(file_path, quiet = TRUE)[0, ],
      stop(paste0("Unknown format: ", format))
    )

    col_names   <- names(tmp)
    col_types   <- sapply(tmp, function(x) map_type(class(x)))
    is_spatial  <- inherits(tmp, "sf")
    sheet_names <- tryCatch({
      if (format == "excel") readxl::excel_sheets(file_path)
      else if (format == "ods") as.character(readODS::ods_sheets(file_path))
      else character(0)
    }, error = function(e) character(0))

    cols <- lapply(seq_along(col_names), function(i) {
      list(name = col_names[i], type = unname(col_types[i]))
    })

    ok_response(result = list(
      columns     = cols,
      is_spatial  = is_spatial,
      sheet_names = as.list(sheet_names)
    ))
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_widget_serve <- function(id) {
  widget <- .ourgeo_env$widgets[[id]]
  if (is.null(widget)) {
    return(list(status = 404L, headers = list("Content-Type" = "text/plain"), body = "Not found"))
  }
  if (!file.exists(widget$file)) {
    return(list(status = 410L, headers = list("Content-Type" = "text/plain"), body = "Widget no longer available"))
  }
  html <- paste(readLines(widget$file, warn = FALSE), collapse = "\n")
  # Inject a same-origin <base> so relative `lib/...` paths resolve to our /widget-files
  # endpoint. Loading them as file:// from an http:// document is silently blocked by
  # Chromium even with webSecurity: false, so we serve assets through the R HTTP server.
  base_tag <- paste0('<base href="/widget-files/', id, '/">')

  # Documents (vignettes, R help pages opened via the browser hook) are long,
  # scrollable pages on a light background — the opposite of an htmlwidget,
  # which must fill a fixed viewport. Pick the styling to match.
  is_document <- isTRUE(widget$kind == "document")
  if (is_document) {
    style_tag <- paste0(
      '<style>',
      'html,body{margin:0;padding:0;height:auto;overflow:auto;background:#ffffff;}',
      'body{max-width:900px;margin:0 auto;padding:1.5rem;}',
      '</style>'
    )
    resize_script <- ''
  } else {
    # Stretch document and override hardcoded inline width/height htmlwidgets emits on the
    # container div, so widgets fill the inline iframe (and popout window) instead of
    # collapsing or rendering at fixed pixel dimensions.
    style_tag <- paste0(
      '<style>',
      'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0f1117;}',
      '.html-widget{width:100% !important;height:100% !important;}',
      '.leaflet,.leaflet-container{width:100% !important;height:100% !important;}',
      '.plotly,.plotly.html-widget,.js-plotly-plot,.plot-container{width:100% !important;height:100% !important;}',
      '</style>'
    )
    # Plotly autosizes only on resize; nudge it after load so it picks up the new dimensions.
    resize_script <- '<script>window.addEventListener("load",function(){setTimeout(function(){window.dispatchEvent(new Event("resize"));},50);});</script>'
  }
  html <- sub("(<head[^>]*>)", paste0("\\1\n  ", base_tag, "\n  ", style_tag), html, perl = TRUE)
  if (nzchar(resize_script))
    html <- sub("</body>", paste0(resize_script, "</body>"), html, fixed = TRUE)
  list(
    status = 200L,
    headers = list(
      "Content-Type" = "text/html; charset=utf-8",
      "Access-Control-Allow-Origin" = "*"
    ),
    body = html
  )
}

handle_widget_files <- function(id, rel_path) {
  widget <- .ourgeo_env$widgets[[id]]
  if (is.null(widget)) {
    return(list(status = 404L, headers = list("Content-Type" = "text/plain"), body = "Not found"))
  }
  # Reject any traversal attempts before touching the filesystem.
  segs <- strsplit(rel_path, "/", fixed = TRUE)[[1]]
  if (any(segs == "..") || grepl("\\\\", rel_path)) {
    return(list(status = 403L, headers = list("Content-Type" = "text/plain"), body = "Forbidden"))
  }
  dir_norm <- normalizePath(widget$dir, winslash = "/", mustWork = FALSE)
  full <- normalizePath(file.path(widget$dir, rel_path), winslash = "/", mustWork = FALSE)
  # Belt-and-braces: confine resolution to the widget's directory.
  if (full != dir_norm && !startsWith(full, paste0(dir_norm, "/"))) {
    return(list(status = 403L, headers = list("Content-Type" = "text/plain"), body = "Forbidden"))
  }
  if (!file.exists(full) || dir.exists(full)) {
    return(list(status = 404L, headers = list("Content-Type" = "text/plain"), body = "Not found"))
  }
  ext <- tolower(tools::file_ext(full))
  ctype <- switch(ext,
    js    = "application/javascript",
    css   = "text/css",
    html  = "text/html; charset=utf-8",
    htm   = "text/html; charset=utf-8",
    json  = "application/json",
    map   = "application/json",
    svg   = "image/svg+xml",
    png   = "image/png",
    jpg   = "image/jpeg",
    jpeg  = "image/jpeg",
    gif   = "image/gif",
    webp  = "image/webp",
    ico   = "image/x-icon",
    woff  = "font/woff",
    woff2 = "font/woff2",
    ttf   = "font/ttf",
    otf   = "font/otf",
    eot   = "application/vnd.ms-fontobject",
    "application/octet-stream"
  )
  size <- file.info(full)$size
  bytes <- readBin(full, "raw", size)
  list(status = 200L, headers = list("Content-Type" = ctype), body = bytes)
}

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Kaggle file-list handler — downloads the ZIP, uses unzip(list=TRUE) to
# read the central directory without extracting, then returns file names +
# sizes.  The ZIP is cached at a deterministic path so a subsequent Load
# call can skip the re-download.
# ---------------------------------------------------------------------------
handle_kaggle_files <- function(body) {
  ref      <- body$ref      %||% ""
  username <- body$username %||% ""
  api_key  <- body$apiKey   %||% ""

  if (!nzchar(ref) || !nzchar(username) || !nzchar(api_key)) {
    return(error_response("ref, username and apiKey are required"))
  }

  safe_ref <- gsub("[^a-zA-Z0-9_]", "_", ref)
  tmp_zip  <- file.path(tempdir(), paste0(".kaggle_", safe_ref, ".zip"))

  result <- tryCatch({
    if (!file.exists(tmp_zip) || file.info(tmp_zip)$size == 0) {
      url <- paste0("https://www.kaggle.com/api/v1/datasets/download/", ref)
      resp <- httr2::request(url) |>
        httr2::req_auth_basic(username, api_key) |>
        httr2::req_perform()
      writeBin(httr2::resp_body_raw(resp), tmp_zip)
    }

    file_df <- unzip(tmp_zip, list = TRUE)
    # Drop directory entries (names ending with /)
    file_df <- file_df[!grepl("/$", file_df$Name), ]

    files <- lapply(seq_len(nrow(file_df)), function(i) {
      list(name = file_df$Name[i], totalBytes = as.integer(file_df$Length[i]))
    })

    list(success = TRUE, files = files, zipPath = tmp_zip)
  }, error = function(e) {
    list(success = FALSE, error = conditionMessage(e))
  })

  json_response(result)
}

# ---------------------------------------------------------------------------
# Session init — lightweight, just return success
# ---------------------------------------------------------------------------

