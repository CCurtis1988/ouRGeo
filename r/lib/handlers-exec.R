# Handlers: session init, code execution, map render, plot preview/export
# (extracted from server.R — behavior-preserving modularization)

# How many recorded plots to keep for re-rendering. Each entry holds a full
# display list, so the history is bounded — older plots fall back to the
# fixed-size PNG the renderer already cached.
OURGEO_PLOT_HISTORY_MAX <- 30L

handle_session_init <- function() {
  db_pkgs <- c("DBI", "duckdb", "dbplyr", "dplyr")
  missing_db <- db_pkgs[!sapply(db_pkgs, requireNamespace, quietly = TRUE)]
  if (length(missing_db) > 0) {
    broadcast_console(
      paste0("Database support requires: ",
             paste(missing_db, collapse = ", "),
             ". Install via the Packages panel."),
      "stderr"
    )
  }

  if (!requireNamespace("png", quietly = TRUE)) {
    broadcast_console(
      "Raster map rendering requires the 'png' package. Install via the Packages panel.",
      "stderr"
    )
  }

  # Helpers exposed to .GlobalEnv so toolbox-generated code can use them.
  # Reused by collect() injection logic.
  assign("ourgeo_db_collect", function(x) dplyr::collect(x), envir = .GlobalEnv)
  # Expose the materialize helper so tmap/ggplot codegen can wrap db-backed
  # layer references and have them render as proper sf objects.
  assign("rgeo_materialize", rgeo_materialize, envir = .GlobalEnv)

  # Spatial: attach sf then sfarc (order matters — sfarc masks st_length and
  # registers curved-geometry methods on sf's generics). Guarded so a missing
  # sfarc never breaks session startup; without it, ouRGeo simply has no
  # curved-geometry support.
  sfarc_loaded <- FALSE
  if (requireNamespace("sf", quietly = TRUE)) {
    suppressPackageStartupMessages(library(sf))
    if (requireNamespace("sfarc", quietly = TRUE)) {
      suppressPackageStartupMessages(library(sfarc))
      sfarc_loaded <- TRUE
    }
  }

  # Linearize wrapper used by toolbox-generated code ("Linearize curved
  # geometry" checkbox). No-op passthrough when sfarc is not installed, so
  # echoed code never errors on machines without it.
  assign("ourgeo_linearize", function(x, tolerance = NULL) {
    if (requireNamespace("sfarc", quietly = TRUE))
      sfarc::st_linearize(x, tolerance = tolerance)
    else x
  }, envir = .GlobalEnv)

  # Auto-detected calculation CRS for toolbox-generated code. Planar tools
  # (buffer/overlays/centroid/simplify) transform into this before computing
  # and transform the result back. Projected input passes through unchanged
  # (the subsequent st_transform is then a no-op); geographic input maps to
  # the UTM zone of the dataset's bbox centre.
  assign("ourgeo_calc_crs", function(x) {
    if (!requireNamespace("sf", quietly = TRUE)) return(NA)
    crs <- sf::st_crs(x)
    if (is.na(crs) || !isTRUE(sf::st_is_longlat(x))) return(crs)
    bb <- sf::st_bbox(x)
    lon <- (bb[["xmin"]] + bb[["xmax"]]) / 2
    lat <- (bb[["ymin"]] + bb[["ymax"]]) / 2
    # All-empty geometry (e.g. rows not yet drawn, or edits not yet saved)
    # has an all-NA bbox — no UTM zone can be detected, so compute in the
    # native CRS (the surrounding st_transform becomes a no-op).
    if (!is.finite(lon) || !is.finite(lat)) return(crs)
    zone <- max(1L, min(60L, floor((lon + 180) / 6) + 1L))
    sf::st_crs(if (lat >= 0) 32600L + zone else 32700L + zone)
  }, envir = .GlobalEnv)

  json_response(list(
    success = TRUE,
    message = "R session ready",
    sfarcLoaded = sfarc_loaded,
    systemNames = as.list(.ourgeo_env$system_names %||% character(0))
  ))
}

# ---------------------------------------------------------------------------
# R execute handler — capture.output + withCallingHandlers
# ---------------------------------------------------------------------------
handle_execute <- function(body) {
  code <- body$code %||% stop("code required")

  warnings_collected <- character(0)
  messages_collected <- character(0)

  result <- tryCatch(
    withCallingHandlers(
      {
        captured <- capture.output({
          .result <- withVisible(eval(parse(text = code), envir = .GlobalEnv))
          if (.result$visible) {
            .widget <- .as_htmlwidget(.result$value)
            if (!is.null(.widget)) {
              print(.widget, view = TRUE)
            } else {
              print(.result$value)
            }
          }
        }, type = "output")
        list(success = TRUE, output = paste(captured, collapse = "\n"))
      },
      warning = function(w) {
        warnings_collected <<- c(warnings_collected, conditionMessage(w))
        broadcast_console(paste("Warning:", conditionMessage(w)), "stderr")
        invokeRestart("muffleWarning")
      },
      message = function(m) {
        msg_text <- sub("\n$", "", conditionMessage(m))
        messages_collected <<- c(messages_collected, msg_text)
        broadcast_console(msg_text)
        invokeRestart("muffleMessage")
      }
    ),
    error = function(e) {
      list(success = FALSE, error = conditionMessage(e))
    },
    interrupt = function(e) {
      broadcast_console("Execution interrupted.", "stderr")
      list(success = FALSE, error = "Execution interrupted by user.")
    }
  )

  # Broadcast output only (not the "> code" input line — frontend handles that).
  # Warnings/messages are already broadcast live above, so broadcast only the
  # captured print/cat text here to avoid duplicating them in the console.
  if (!is.null(result$output) && nchar(result$output) > 0) {
    broadcast_console(result$output)
  }
  if (!is.null(result$error)) {
    broadcast_console(paste("Error:", result$error), "stderr")
  }

  # Fold warnings/messages into the RETURNED output (after broadcasting) so the
  # HTTP response — which the AI autopilot reads back as a tool result — carries
  # everything the user sees in the console, not just print/cat output.
  if (isTRUE(result$success)) {
    extra <- c(messages_collected, if (length(warnings_collected) > 0)
      paste0("Warning: ", warnings_collected))
    if (length(extra) > 0) {
      pieces <- c(if (nchar(result$output %||% "") > 0) result$output, extra)
      result$output <- paste(pieces, collapse = "\n")
    }
  }

  # Capture any plot that was drawn during this execution.
  # options(device=...) above ensures plot() writes to last_capture_file
  # via a headless PNG device — no X11/Wayland required.
  tryCatch({
    capture_file <- .ourgeo_env$last_capture_file
    if (!is.null(capture_file) && dev.cur() != 1L) {
      recorded <- recordPlot()               # save for re-render on export/resize
      .ourgeo_env$last_plot <- recorded
      .ourgeo_env$plot_seq <- .ourgeo_env$plot_seq + 1L
      plot_id <- paste0("p", .ourgeo_env$plot_seq)
      .ourgeo_env$plot_history[[plot_id]] <- recorded
      if (length(.ourgeo_env$plot_history) > OURGEO_PLOT_HISTORY_MAX) {
        .ourgeo_env$plot_history <- utils::tail(
          .ourgeo_env$plot_history, OURGEO_PLOT_HISTORY_MAX
        )
      }
      .ourgeo_env$last_capture_file <- NULL
      dev.off()  # flush and close the capture PNG device
      info <- file.info(capture_file)
      if (!is.na(info$size) && info$size > 0) {
        raw_bytes <- readBin(capture_file, "raw", info$size)
        encoded <- jsonlite::base64_enc(raw_bytes)
        broadcast_system(list(
          type = "plot",
          data = list(
            dataUrl = paste0("data:image/png;base64,", encoded),
            plotId  = plot_id
          )
        ))
      }
    }
  }, error = function(e) NULL)

  # Push a scoped .GlobalEnv update to the UI if user objects changed, so the
  # Environment panel and autocomplete stay current without a manual refresh.
  broadcast_env_if_changed()
  broadcast_wd_if_changed()

  # Likewise push a package-list update if code loaded/installed packages, so
  # the Packages panel and library()/require() autocomplete stay current.
  broadcast_packages_if_changed()

  json_response(c(result, list(code = code)))
}

# ---------------------------------------------------------------------------
# Map render handler (synchronous PNG/JPG/PDF/GIF from arbitrary R code)
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Plot preview handler (returns base64 PNG without broadcasting to WebSocket)
# ---------------------------------------------------------------------------
handle_plot_preview <- function(body) {
  code <- body$code
  if (is.null(code) || nchar(trimws(code)) == 0)
    return(error_response("No code provided", 400L))

  tryCatch({
    tmp <- tempfile(fileext = ".png")
    grDevices::png(tmp, width = 800L, height = 500L, res = 96L, units = "px")
    tryCatch({
      result <- eval(parse(text = code), envir = .GlobalEnv)
      if (!is.null(result)) print(result)
    }, finally = grDevices::dev.off())
    info <- file.info(tmp)
    if (is.na(info$size) || info$size == 0)
      return(error_response("Plot produced no output \u2014 check your aesthetic mappings", 400L))
    raw_bytes <- readBin(tmp, "raw", info$size)
    encoded <- jsonlite::base64_enc(raw_bytes)
    json_response(list(success = TRUE, data = paste0("data:image/png;base64,", encoded)))
  }, error = function(e) error_response(conditionMessage(e), 400L))
}

# ---------------------------------------------------------------------------
# Help handlers
# ---------------------------------------------------------------------------

handle_plot_export <- function(body) {
  # With no plotId this re-renders the most recent plot (the historical
  # behaviour). With one, it replays that specific recording — the popout
  # window and the export dialog both pin the plot the user is looking at.
  plot_id <- body$plotId
  if (is.null(plot_id) || !nzchar(as.character(plot_id))) {
    recorded <- .ourgeo_env$last_plot
    if (is.null(recorded)) return(error_response("No plot available"))
  } else {
    recorded <- .ourgeo_env$plot_history[[as.character(plot_id)]]
    if (is.null(recorded)) {
      # Distinct message: the caller falls back to its cached bitmap rather
      # than silently rendering a different plot.
      return(error_response("Plot is no longer available in this R session"))
    }
  }

  fmt    <- body$format  %||% "png"
  w_px   <- as.integer(body$widthPx  %||% 800L)
  h_px   <- as.integer(body$heightPx %||% 600L)
  dpi    <- as.integer(body$dpi      %||% 96L)

  tmp <- tempfile(fileext = paste0(".", fmt))

  tryCatch({
    if (fmt == "pdf") {
      # pdf() takes width/height in inches
      pdf(tmp, width = w_px / dpi, height = h_px / dpi)
    } else if (fmt == "jpg") {
      jpeg(tmp, width = w_px, height = h_px, res = dpi, units = "px", quality = 95)
    } else {
      png(tmp, width = w_px, height = h_px, res = dpi, units = "px")
    }
    replayPlot(recorded)
    dev.off()

    info <- file.info(tmp)
    if (is.na(info$size) || info$size == 0) {
      return(error_response("Plot rendering produced empty file"))
    }

    raw_bytes <- readBin(tmp, "raw", info$size)
    encoded   <- jsonlite::base64_enc(raw_bytes)
    json_response(list(success = TRUE, data = encoded, format = fmt))
  }, error = function(e) {
    tryCatch(dev.off(), error = function(e2) NULL)
    error_response(conditionMessage(e))
  })
}

# ---------------------------------------------------------------------------
# Environment management handlers
# ---------------------------------------------------------------------------

