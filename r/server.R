#!/usr/bin/env Rscript
# ouRGeo R Server — httpuv-based HTTP + WebSocket server (v2 simplified)

suppressPackageStartupMessages({
  library(httpuv)
  library(jsonlite)
})

# ---------------------------------------------------------------------------
# Global session state
# ---------------------------------------------------------------------------
.ourgeo_env <- new.env(parent = emptyenv())
.ourgeo_env$ws_clients <- list()
.ourgeo_env$packages_cache <- NULL
.ourgeo_env$cran_pkg_cache <- NULL
.ourgeo_env$install_jobs <- list()
.ourgeo_env$last_plot <- NULL
.ourgeo_env$last_capture_file <- NULL
.ourgeo_env$plot_history <- list() # plotId -> recordedplot, for re-rendering a *historical* plot
.ourgeo_env$plot_seq <- 0L         # monotonic counter behind the plotIds
.ourgeo_env$widgets <- list()
.ourgeo_env$db_conns <- list()      # handle (UUID) -> list(con, file_path)
.ourgeo_env$rgeo_proxies <- list()  # var_name -> list(handle, name, kind, ...) — for proxy-aware UI dispatch
.ourgeo_env$env_fingerprint <- NULL # cheap signature of .GlobalEnv, for change-detected env broadcasts
.ourgeo_env$pkg_fingerprint <- NULL # cheap signature of installed+attached packages, for change-detected package broadcasts
.ourgeo_env$raster_layers <- list() # layerId -> warped-file cache entry for /raster/tile serving
.ourgeo_env$raster_tile_cache <- NULL # bounded LRU of encoded PNG tiles (built lazily)
.ourgeo_env$raster_tile_keys <- character(0)

# Redirect the default graphics device to a headless PNG capture device.
# This ensures plot() works without X11/Wayland and always goes to a file
# we control, regardless of the display environment.
options(device = function(...) {
  tmp <- tempfile(fileext = ".png")
  .ourgeo_env$last_capture_file <- tmp
  grDevices::png(tmp, width = 800L, height = 600L, res = 96L, units = "px")
  dev.control(displaylist = "enable")  # file devices inhibit the display list by default;
                                        # enabling it is required for recordPlot() / replayPlot()
})

# Intercept htmlwidget output (plotly, leaflet, tmap view mode, mapview, etc.)
# The htmlwidgets package calls getOption("viewer") when printing a widget
# outside a browser context. We capture the temp file path and serve it.
options(viewer = function(url, height = NULL) {
  id <- paste0("w_", as.character(round(as.numeric(Sys.time()) * 1000)))
  file_path <- gsub("^file://", "", url)
  .ourgeo_env$widgets[[id]] <- list(
    file = file_path,
    dir  = dirname(file_path)
  )
  broadcast_system(list(type = "widget", data = list(id = id)))
})

# Monotonic id source for viewer/browser widgets — avoids perturbing the
# user's RNG (sample()/runif()) just to mint a unique widget id.
.ourgeo_env$widget_seq <- 0L
.ourgeo_next_widget_id <- function() {
  .ourgeo_env$widget_seq <- .ourgeo_env$widget_seq + 1L
  paste0("w_", as.character(round(as.numeric(Sys.time()) * 1000)),
         "_", .ourgeo_env$widget_seq)
}

# R launched non-interactively via Rscript has no `browser`/`pdfviewer`
# option set, so base helpers that open a browser — browseURL(),
# vignette("x"), browseVignettes(), and HTML ?help — fail with
# "'browser' must be a non-empty character string". Intercept them: render
# local HTML (vignettes, help pages) inside ouRGeo via the same widget
# mechanism used for htmlwidgets above, and hand real web URLs / PDFs to the
# OS default opener so external links still work.
.ourgeo_os_open <- function(target) {
  sysname <- Sys.info()[["sysname"]]
  tryCatch({
    if (sysname == "Darwin") {
      system2("open", shQuote(target), wait = FALSE) == 0L
    } else if (sysname == "Windows") {
      shell.exec(target); TRUE
    } else {
      system2("xdg-open", shQuote(target), wait = FALSE,
              stdout = FALSE, stderr = FALSE) == 0L
    }
  }, error = function(e) FALSE)
}

# Render a local HTML file in-app via the widget mechanism. Returns TRUE if it
# handled the file, FALSE otherwise (so the caller can fall back). Tagged as a
# "document" so the serve handler styles it as a scrollable page rather than a
# viewport-filling htmlwidget.
.ourgeo_render_html <- function(path) {
  if (!nzchar(path) || !file.exists(path)) return(FALSE)
  ext <- tolower(tools::file_ext(path))
  if (!ext %in% c("html", "htm")) return(FALSE)
  id <- .ourgeo_next_widget_id()
  .ourgeo_env$widgets[[id]] <- list(file = path, dir = dirname(path), kind = "document")
  broadcast_system(list(type = "widget", data = list(id = id)))
  TRUE
}

options(browser = function(url, ...) {
  u <- as.character(url)[1]
  if (length(u) == 0L || is.na(u) || !nzchar(u)) return(invisible(NULL))
  is_web <- grepl("^(https?|ftp)://", u, ignore.case = TRUE)
  # Path without any #fragment/?query, for on-disk resolution.
  clean <- sub("[?#].*$", "", sub("^file://(localhost)?", "", u))

  # 1) A plain local HTML file (older R, or direct browseURL of a file).
  if (!is_web && .ourgeo_render_html(clean)) return(invisible(u))

  # 2) Modern R serves vignettes/package HTML through its dynamic help server:
  #    http://127.0.0.1:<port>/library/<pkg>/(doc|html)/<file>. That maps
  #    deterministically to an installed file — resolve and render in-app.
  m <- regmatches(u, regexec(
    "^https?://(?:127\\.0\\.0\\.1|localhost)(?::\\d+)?/library/([^/]+)/((?:doc|html)/.+)$",
    u))[[1]]
  if (length(m) == 3L) {
    f <- system.file(sub("[?#].*$", "", m[3]), package = m[2])
    if (.ourgeo_render_html(f)) return(invisible(u))
  }

  # 3) Genuine web URLs and non-HTML files (e.g. PDF vignettes, R help topic
  #    pages generated on the fly) → OS default opener.
  target <- if (is_web) u else clean
  if (!.ourgeo_os_open(target))
    broadcast_console(
      sprintf("[ouRGeo] Could not open a browser for: %s\n", target), "stderr")
  invisible(u)
})

# PDF vignettes call getOption("pdfviewer") (not the browser). If it's unset
# (as it can be under Rscript), point it at an OS opener so a PDF-only vignette
# opens instead of erroring; leave any existing/default value untouched.
if (!nzchar(getOption("pdfviewer", ""))) {
  .pv <- switch(Sys.info()[["sysname"]],
    Darwin  = Sys.which("open")[[1]],
    Windows = "",  # base R normally resolves this itself; don't guess
    Sys.which("xdg-open")[[1]]
  )
  if (nzchar(.pv)) options(pdfviewer = .pv)
  rm(.pv)
}

# ---------------------------------------------------------------------------
# Load server modules. All definitions are sourced into the global environment
# (so the post-startup ls(.GlobalEnv) snapshot below still sees them as
# server-internal). Order does not matter — modules only reference each other
# at call time.
# ---------------------------------------------------------------------------
.script_dir <- local({
  args <- commandArgs(trailingOnly = FALSE)
  fa <- grep("^--file=", args, value = TRUE)
  if (length(fa)) dirname(normalizePath(sub("^--file=", "", fa[1]))) else getwd()
})

for (.mod in c(
  "util-core.R", "util-env.R", "util-arcgis.R", "util-stac.R", "util-sdmx.R", "util-odata.R",
  "util-wcs.R", "util-wms.R", "util-erddap.R",
  "util-raster.R",
  "handlers-data-widget.R", "handlers-exec.R", "handlers-help.R",
  "handlers-spatial.R", "data-preflight.R", "handlers-cogo.R", "handlers-env.R", "context.R", "handlers-packages.R",
  "handlers-object.R", "handlers-raster.R", "handlers-rmarkdown.R", "handlers-wd.R",
  "db-core.R", "db-raster.R", "db-translate.R", "db-handlers.R",
  "router.R"
)) {
  source(file.path(.script_dir, "lib", .mod))
}
# ---------------------------------------------------------------------------
# Start server
app_def <- list(
  call = route,
  onWSOpen = ws_handler
)

port <- NULL
for (candidate in sample(10000:19999, 100)) {
  server <- tryCatch(
    startServer("127.0.0.1", candidate, app_def),
    error = function(e) NULL
  )
  if (!is.null(server)) {
    port <- candidate
    break
  }
}

if (is.null(port)) {
  cat("OURGEO_ERROR: Could not bind to any port in range 10000-19999\n")
  flush(stdout())
  quit(status = 1)
}

cat(sprintf("OURGEO_PORT:%d\n", port))
flush(stdout())
cat("OURGEO_READY\n")
flush(stdout())

cat(sprintf("[ouRGeo] R server listening on http://127.0.0.1:%d\n", port))

# Snapshot all GlobalEnv names after full startup (functions, app_def, port,
# server, candidate, .ourgeo_env, etc.). Anything here is server-internal and
# should be treated as non-user-created by the frontend filter.
.ourgeo_env$system_names <- ls(.GlobalEnv, all.names = TRUE)

# Keep alive
while (TRUE) {
  tryCatch({
    later::run_now(0.05)
  }, error = function(e) {
    NULL
  }, interrupt = function(e) {
    # SIGINT while idle (no code executing) — absorb and keep the server running
    NULL
  })
}
