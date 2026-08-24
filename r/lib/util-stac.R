# STAC reader for the Data Connector's STAC provider.
#
# Why this exists: STAC's `limit` is a *per-page* cap, not a total, and servers
# enforce a maximum (Earth Search rejects limit>1000 with HTTP 502). The old
# generated code passed the user's total straight through as `limit` and never
# followed pagination links, so large requests failed and small ones silently
# truncated. This helper paginates via the `rel:"next"` link (token-based POST
# search), caps the page size, backs off on server errors, and assembles the
# collected item footprints into one sf object.
#
# Registered into .GlobalEnv at session init (see handlers-exec.R) so the
# Data Connector's echoed import code can call ourgeo_read_stac().

# Perform one STAC search request. `body` NULL → GET (query params already on
# the url); otherwise POST it as JSON. Returns the parsed response (a list).
.stac_fetch <- function(url, body) {
  req <- httr2::request(url) |>
    httr2::req_headers(Accept = "application/geo+json, application/json")
  if (!is.null(body)) req <- httr2::req_body_json(req, body, auto_unbox = TRUE)
  resp <- httr2::req_perform(req)
  jsonlite::fromJSON(httr2::resp_body_string(resp), simplifyVector = FALSE)
}

# The `rel:"next"` pagination link of a STAC response, or NULL.
.stac_next <- function(links) {
  for (l in links %||% list()) if (identical(l$rel, "next")) return(l)
  NULL
}

# Compute the request (url, body) for the next page from a `next` link. Per the
# STAC spec, `merge:true` means merge the link body into the previous body;
# otherwise the link body replaces it. A bodyless link is a GET on its href.
.stac_next_request <- function(prev_body, nx) {
  if (is.null(nx$body)) return(list(url = nx$href, body = NULL))
  body <- if (isTRUE(nx$merge)) modifyList(prev_body, nx$body) else nx$body
  list(url = nx$href, body = body)
}

# Assemble collected STAC features into an sf object (footprints, EPSG:4326).
.stac_features_to_sf <- function(feats) {
  if (!length(feats)) return(sf::st_sf(geometry = sf::st_sfc(crs = 4326)))
  fc <- list(type = "FeatureCollection", features = feats)
  tf <- tempfile(fileext = ".geojson")
  on.exit(unlink(tf), add = TRUE)
  writeLines(jsonlite::toJSON(fc, auto_unbox = TRUE, null = "null", na = "null", digits = NA), tf)
  sf::st_read(tf, quiet = TRUE)
}

# Public entry point. Paginate a STAC POST /search and return item footprints as
# sf. `body` is the search body as a JSON string (collections/datetime/query —
# NOT limit, which this manages). `max_items` caps the total collected; on a
# server error the page size is halved and retried (down to `min_page`) so
# stricter servers still import.
ourgeo_read_stac <- function(search_url, body, max_items = 5000L,
                             page_size = 500L, min_page = 25L) {
  if (!requireNamespace("httr2", quietly = TRUE)) stop("Package 'httr2' is required.")
  if (!requireNamespace("sf", quietly = TRUE)) stop("Package 'sf' is required.")
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Package 'jsonlite' is required.")

  b <- jsonlite::fromJSON(body, simplifyVector = FALSE)
  cur_page <- as.integer(page_size)
  url <- search_url
  feats <- list()
  repeat {
    want <- min(cur_page, max_items - length(feats))
    if (want <= 0) break
    if (!is.null(b)) b$limit <- want   # POST search; GET-next links carry their own params

    res <- tryCatch(.stac_fetch(url, b), error = function(e) list(.err = conditionMessage(e)))
    if (!is.null(res$.err)) {
      # Page too large (or transient) — shrink and retry the same page.
      if (cur_page > min_page) { cur_page <- max(min_page, cur_page %/% 2L); next }
      stop(sprintf("STAC search failed (page size %d): %s", want, res$.err))
    }

    fs <- res$features %||% list()
    feats <- c(feats, fs)
    if (length(feats) >= max_items || length(fs) == 0) break

    nx <- .stac_next(res$links)
    if (is.null(nx)) break
    step <- .stac_next_request(b, nx)
    url <- step$url %||% url
    b <- step$body
  }
  if (length(feats) > max_items) feats <- feats[seq_len(max_items)]
  .stac_features_to_sf(feats)
}

# Raster-asset entry point. Run the same paginated search, but instead of
# footprints read the named asset of each matched item as a SpatRaster via
# GDAL's /vsicurl/ (lazy HTTP range requests — the COG access pattern; no full
# download happens until pixels are pulled). Returns a single SpatRaster for
# one item, else a named list of SpatRasters (one per item id).
ourgeo_read_stac_rasters <- function(search_url, body, asset, max_items = 1L) {
  if (!requireNamespace("httr2", quietly = TRUE)) stop("Package 'httr2' is required.")
  if (!requireNamespace("terra", quietly = TRUE)) stop("Package 'terra' is required.")
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Package 'jsonlite' is required.")

  b <- jsonlite::fromJSON(body, simplifyVector = FALSE)
  b$limit <- as.integer(max_items)
  res <- .stac_fetch(search_url, b)
  feats <- res$features %||% list()
  if (length(feats) > max_items) feats <- feats[seq_len(max_items)]
  if (length(feats) == 0) stop("STAC search matched no items")

  rasters <- list()
  for (ft in feats) {
    a <- (ft$assets %||% list())[[asset]]
    href <- a$href %||% NULL
    if (is.null(href)) {
      message(sprintf("[STAC] Item '%s' has no asset '%s' — skipped",
                      ft$id %||% "?", asset))
      next
    }
    src <- if (grepl("^https?://", href)) paste0("/vsicurl/", href) else href
    r <- tryCatch(terra::rast(src), error = function(e) {
      message(sprintf("[STAC] Could not open asset of item '%s': %s",
                      ft$id %||% "?", conditionMessage(e)))
      NULL
    })
    if (!is.null(r)) rasters[[ft$id %||% as.character(length(rasters) + 1L)]] <- r
  }
  if (length(rasters) == 0) stop("No readable raster assets among the matched items")
  if (length(rasters) == 1) {
    message(sprintf("[STAC] Loaded raster asset '%s' (lazy /vsicurl/).", asset))
    return(rasters[[1]])
  }
  message(sprintf(
    "[STAC] Loaded %d raster assets as a named list (access items with $ or [[ ]]).",
    length(rasters)))
  rasters
}
