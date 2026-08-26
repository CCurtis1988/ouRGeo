# Handlers: R Markdown chunk execution
#
# WHY THIS IS NOT /r/execute
# --------------------------
# `handle_execute` can surface at most ONE plot per call. server.R redirects the
# default device to a single fixed-name PNG (`png(tmp)`), and the handler does
# one `recordPlot()` + one `dev.off()`. A chunk that draws three plots would
# silently lose two. Plots are also broadcast over the WebSocket with no caller
# attribution, so the renderer could not tell which chunk produced what.
#
# So chunks get their own device and their own response:
#   * `png(".../chunk%03d.png")` — the %03d pattern makes R open a NEW file per
#     page, capturing every plot the chunk draws.
#   * everything (text, plots, warnings) comes back in the HTTP response rather
#     than being broadcast. Precedent: handle_plot_preview in handlers-exec.R.
#
# The chunk's code is still echoed to the console by the renderer, so the
# console remains a complete record of what ran.

# Read a PNG file and return a data URL, or NULL if it cannot be read.
.rmd_png_data_url <- function(path) {
  tryCatch({
    raw_bytes <- readBin(path, "raw", file.info(path)$size)
    paste0("data:image/png;base64,", jsonlite::base64_enc(raw_bytes))
  }, error = function(e) NULL)
}

# Chunk options arrive as strings from the fence header; coerce the few we honour.
.rmd_num_opt <- function(opts, name, default) {
  v <- opts[[name]]
  if (is.null(v)) return(default)
  n <- suppressWarnings(as.numeric(v))
  if (is.na(n) || n <= 0) default else n
}

.rmd_is_false <- function(v) {
  !is.null(v) && tolower(as.character(v)) %in% c("false", "f", "0", "no")
}

handle_chunk_execute <- function(body) {
  code <- body$code %||% stop("code required")
  opts <- body$options %||% list()

  # eval=FALSE means "show but don't run" — report it rather than pretending.
  if (.rmd_is_false(opts$eval)) {
    return(json_response(list(
      success = TRUE, output = "", error = NULL, plots = list(), plotIds = list(),
      skipped = TRUE, durationMs = 0
    )))
  }

  fig_w  <- .rmd_num_opt(opts, "fig.width", 7)
  fig_h  <- .rmd_num_opt(opts, "fig.height", 5)
  dpi    <- .rmd_num_opt(opts, "dpi", 96)
  quiet_warnings <- .rmd_is_false(opts$warning)
  quiet_messages <- .rmd_is_false(opts$message)

  plot_dir <- file.path(tempdir(), paste0("ourgeo-chunk-", as.integer(runif(1, 1, 1e9))))
  dir.create(plot_dir, showWarnings = FALSE, recursive = TRUE)

  # Save the interactive capture state — the shared device settings in
  # .ourgeo_env belong to /r/execute and must survive this call untouched.
  prev_capture <- .ourgeo_env$last_capture_file
  started <- Sys.time()

  warnings_collected <- character(0)
  messages_collected <- character(0)

  grDevices::png(
    filename = file.path(plot_dir, "plot%03d.png"),
    width = fig_w * dpi, height = fig_h * dpi, res = dpi, units = "px"
  )
  grDevices::dev.control(displaylist = "enable")  # parity with server.R
  chunk_dev <- grDevices::dev.cur()

  result <- tryCatch(
    withCallingHandlers(
      {
        captured <- utils::capture.output({
          # Expression by expression, so an error names the failing statement and
          # autoprinting matches knitr's visible-value semantics.
          exprs <- parse(text = code)
          for (e in exprs) {
            .res <- withVisible(eval(e, envir = .GlobalEnv))
            if (.res$visible) {
              .widget <- .as_htmlwidget(.res$value)
              if (!is.null(.widget)) print(.widget, view = FALSE) else print(.res$value)
            }
          }
        }, type = "output")
        list(success = TRUE, output = paste(captured, collapse = "\n"))
      },
      warning = function(w) {
        warnings_collected <<- c(warnings_collected, conditionMessage(w))
        invokeRestart("muffleWarning")
      },
      message = function(m) {
        messages_collected <<- c(messages_collected, sub("\n$", "", conditionMessage(m)))
        invokeRestart("muffleMessage")
      }
    ),
    error = function(e) list(success = FALSE, error = conditionMessage(e)),
    interrupt = function(e) list(success = FALSE, error = "Chunk interrupted by user.")
  )

  # Close only OUR device, even if the chunk opened others.
  tryCatch({
    if (chunk_dev %in% grDevices::dev.list()) {
      grDevices::dev.set(chunk_dev)
      grDevices::dev.off(chunk_dev)
    }
  }, error = function(e) NULL)
  .ourgeo_env$last_capture_file <- prev_capture

  # One file per page, in draw order.
  files <- sort(list.files(plot_dir, pattern = "^plot\\d+\\.png$", full.names = TRUE))
  plots <- list()
  plot_ids <- list()
  for (f in files) {
    url <- .rmd_png_data_url(f)
    if (is.null(url)) next
    plots[[length(plots) + 1L]] <- url
    # Register in the shared history so a chunk plot can be re-exported at a
    # different size through the existing /r/plot/export endpoint.
    .ourgeo_env$plot_seq <- (.ourgeo_env$plot_seq %||% 0L) + 1L
    plot_ids[[length(plot_ids) + 1L]] <- paste0("p", .ourgeo_env$plot_seq)
  }
  unlink(plot_dir, recursive = TRUE)

  extra <- c(
    if (!quiet_messages) messages_collected,
    if (!quiet_warnings && length(warnings_collected) > 0)
      paste0("Warning: ", warnings_collected)
  )
  out_text <- paste(c(
    if (nchar(result$output %||% "") > 0) result$output,
    extra
  ), collapse = "\n")

  # Chunks create objects and attach packages like any other code — the
  # Environment panel and autocomplete must see them.
  broadcast_env_if_changed()
  broadcast_wd_if_changed()
  broadcast_packages_if_changed()

  json_response(list(
    success   = isTRUE(result$success),
    output    = out_text,
    error     = result$error %||% NULL,
    plots     = plots,
    plotIds   = plot_ids,
    skipped   = FALSE,
    durationMs = as.numeric(difftime(Sys.time(), started, units = "secs")) * 1000
  ))
}

# ---------------------------------------------------------------------------
# Knit dependency pre-flight
# ---------------------------------------------------------------------------
# Knitting has FOUR independent requirements and only two are R packages. The
# common failure is a missing pandoc — which R does not bundle and cannot
# install as a normal dependency — producing an opaque render error. Reporting
# availability up front lets the UI disable a format and say exactly why, before
# the user clicks anything.
handle_rmarkdown_deps <- function() {
  safe <- function(expr) tryCatch(isTRUE(expr), error = function(e) FALSE)

  has_knitr     <- requireNamespace("knitr", quietly = TRUE)
  has_rmarkdown <- requireNamespace("rmarkdown", quietly = TRUE)
  has_pandoc    <- has_rmarkdown && safe(rmarkdown::pandoc_available())
  pandoc_ver    <- if (has_pandoc) {
    tryCatch(as.character(rmarkdown::pandoc_version()), error = function(e) NA_character_)
  } else NA_character_
  has_tinytex   <- requireNamespace("tinytex", quietly = TRUE) &&
    safe(tinytex::is_tinytex())
  system_latex  <- nzchar(Sys.which("pdflatex")) || nzchar(Sys.which("xelatex")) ||
    nzchar(Sys.which("lualatex"))

  json_response(list(
    success       = TRUE,
    knitr         = has_knitr,
    rmarkdown     = has_rmarkdown,
    pandoc        = has_pandoc,
    pandocVersion = if (is.na(pandoc_ver)) NULL else pandoc_ver,
    tinytex       = has_tinytex,
    systemLatex   = system_latex
  ))
}
