# Core helpers: htmlwidget coercion, WS broadcast, %||%, body parsing, JSON responses
# (extracted from server.R — behavior-preserving modularization)

# Coerce deferred-htmlwidget objects (tmap view mode, mapview) into real
# htmlwidgets so print(..., view = TRUE) reaches the viewer hook above.
# Returns NULL if the value is not interactive — caller falls back to print().
.as_htmlwidget <- function(x) {
  if (inherits(x, "htmlwidget")) return(x)

  # tmap "view" mode -> leaflet htmlwidget. "plot" mode must fall through so
  # the PNG capture device handles it as a static plot.
  if (inherits(x, "tmap") && requireNamespace("tmap", quietly = TRUE)) {
    mode <- tryCatch(tmap::tmap_mode(), error = function(e) NA_character_)
    if (isTRUE(mode == "view")) {
      return(tryCatch(tmap::tmap_leaflet(x), error = function(e) NULL))
    }
    return(NULL)
  }

  # mapview: S4 with a leaflet htmlwidget at @map
  if (isS4(x) && methods::is(x, "mapview") && .hasSlot(x, "map")) {
    return(tryCatch(x@map, error = function(e) NULL))
  }

  NULL
}

# WebSocket console broadcast
broadcast_console <- function(text, type = "stdout") {
  msg <- toJSON(list(type = type, text = text), auto_unbox = TRUE)
  for (client in .ourgeo_env$ws_clients) {
    tryCatch(
      client$send(msg),
      error = function(e) NULL
    )
  }
}

# WebSocket system broadcast (structured messages, no envelope wrapping)
broadcast_system <- function(data) {
  msg <- toJSON(data, auto_unbox = TRUE)
  for (client in .ourgeo_env$ws_clients) {
    tryCatch(client$send(msg), error = function(e) NULL)
  }
}

`%||%` <- function(x, y) if (!is.null(x)) x else y

parse_body <- function(req) {
  body <- req$rook.input$read()
  if (length(body) == 0 || nchar(rawToChar(body)) == 0) return(list())
  tryCatch(fromJSON(rawToChar(body), simplifyVector = FALSE), error = function(e) list())
}

# `digits` is jsonlite's, and its default of 4 is the reason this parameter
# exists: every number in every response is rounded to four decimal places
# before it leaves R. That is fine for a band statistic and wrong for a
# coordinate — 0.0001° of longitude is eleven metres, which would quietly
# undo the whole point of typing a distance and a bearing. Callers carrying
# positions pass `digits = NA` (full precision); everything else keeps the
# behaviour it has always had.
json_response <- function(data, status = 200L, digits = 4) {
  list(
    status = status,
    headers = list("Content-Type" = "application/json",
                   "Access-Control-Allow-Origin" = "*",
                   "Access-Control-Allow-Methods" = "GET, POST, OPTIONS",
                   "Access-Control-Allow-Headers" = "Content-Type"),
    body = toJSON(data, auto_unbox = TRUE, null = "null", digits = digits)
  )
}

error_response <- function(msg, status = 500L) {
  json_response(list(success = FALSE, error = msg), status)
}

ok_response <- function(result = NULL, code = "", message = "") {
  json_response(list(success = TRUE, result = result, code = code, message = message))
}

options_response <- function() {
  list(
    status = 204L,
    headers = list(
      "Access-Control-Allow-Origin" = "*",
      "Access-Control-Allow-Methods" = "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers" = "Content-Type"
    ),
    # An empty string is still a body to httpuv: with Accept-Encoding: gzip it
    # emits a compressed chunk after this 204. Chromium leaves those forbidden
    # bytes on the keep-alive connection and rejects the next preflight POST as
    # ERR_INVALID_HTTP_RESPONSE (Axios reports only "Network Error").
    body = NULL
  )
}

# ---------------------------------------------------------------------------
# Data preview handler

