# SDMX-CSV reader for the Data Connector's SDMX provider.
#
# Why this exists: the old generated code used read.csv() on the data URL, which
# opens R's base url() connection — that fails on some systems with "SSL connect
# error" and is bound by options(timeout) (default 60s), so large SDMX dumps
# (e.g. ECB BLS has ~22k series) time out. This helper fetches over httr2
# (libcurl — robust TLS, its own generous timeout) and reads the SDMX-CSV from
# the response text. `last_n_obs` / `first_n_obs` cap the observations per series
# so a runaway "all" query can be bounded (see the capacity dialog).
#
# Registered into .GlobalEnv at session init (see handlers-exec.R) so the
# Data Connector's echoed import code can call ourgeo_read_sdmx().

ourgeo_read_sdmx <- function(url, last_n_obs = NULL, first_n_obs = NULL, timeout = 300) {
  if (!requireNamespace("httr2", quietly = TRUE)) stop("Package 'httr2' is required.")

  extra <- character(0)
  if (!is.null(last_n_obs))  extra <- c(extra, paste0("lastNObservations=",  as.integer(last_n_obs)))
  if (!is.null(first_n_obs)) extra <- c(extra, paste0("firstNObservations=", as.integer(first_n_obs)))
  if (length(extra)) {
    sep <- if (grepl("?", url, fixed = TRUE)) "&" else "?"
    url <- paste0(url, sep, paste(extra, collapse = "&"))
  }

  resp <- httr2::request(url) |>
    httr2::req_timeout(timeout) |>
    httr2::req_headers(Accept = "application/vnd.sdmx.data+csv, text/csv") |>
    httr2::req_perform()

  txt <- httr2::resp_body_string(resp)
  if (!nzchar(trimws(txt))) stop("SDMX server returned an empty response.")
  utils::read.csv(text = txt, check.names = FALSE)
}
