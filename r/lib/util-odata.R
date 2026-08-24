# OData v4 reader for the Data Connector's OData provider.
#
# Why this exists: the old generated code called req_perform() with no timeout or
# retry, so httr2's short default timeout turned any transient slowness from a
# shared service (e.g. services.odata.org) into "Connection timed out after
# 10002 milliseconds". This helper sets a generous timeout, retries transient
# failures, and paginates $top/$skip up to max_records — matching the ArcGIS /
# STAC / SDMX readers.
#
# Registered into .GlobalEnv at session init (see handlers-exec.R) so the
# Data Connector's echoed import code can call ourgeo_read_odata().

ourgeo_read_odata <- function(base_url, filter = NULL, select = NULL,
                              max_records = 5000L, page_size = 1000L, timeout = 300) {
  if (!requireNamespace("httr2", quietly = TRUE)) stop("Package 'httr2' is required.")
  pages <- list()
  skip <- 0L
  repeat {
    want <- min(page_size, max_records - skip)
    if (want <= 0) break
    req <- httr2::request(base_url) |>
      httr2::req_timeout(timeout) |>
      httr2::req_options(connecttimeout = 60) |>
      httr2::req_retry(max_tries = 3) |>
      httr2::req_url_query(`$top` = want, `$skip` = skip, `$format` = "json")
    if (!is.null(filter) && nzchar(filter)) req <- httr2::req_url_query(req, `$filter` = filter)
    if (!is.null(select) && nzchar(select)) req <- httr2::req_url_query(req, `$select` = select)

    d <- httr2::resp_body_json(httr2::req_perform(req), simplifyVector = TRUE)
    vals <- d$value
    if (is.null(vals) || NROW(vals) == 0) break
    pages[[length(pages) + 1L]] <- as.data.frame(vals, stringsAsFactors = FALSE)

    got <- NROW(vals)
    skip <- skip + got
    if (got < want) break          # last (partial) page
    if (skip >= max_records) break
  }
  if (!length(pages)) return(data.frame())
  do.call(rbind, pages)
}
