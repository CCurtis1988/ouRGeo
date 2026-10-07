# Read-only context inspection is deliberately narrower than the Data Viewer:
# no parse/eval access paths, active bindings, print methods or lazy queries.
handle_context_schema <- function(body) {
  tryCatch({
    if (!requireNamespace("rlang", quietly = TRUE)) stop("Safe binding inspection needs rlang; run install.packages('rlang') in the visible R console")
    nm <- body$name
    env_name <- body$envName %||% ".GlobalEnv"
    if (!is.character(nm) || length(nm) != 1L || nchar(nm) > 256L) stop("Choose a named object")
    if (identical(env_name, ".GlobalEnv")) {
      env <- .GlobalEnv
    } else {
      if (!is.character(env_name) || length(env_name) != 1L || nchar(env_name) > 256L ||
          !base::exists(env_name, .GlobalEnv, inherits = FALSE) || base::bindingIsActive(env_name, .GlobalEnv) ||
          any(rlang::env_binding_are_lazy(.GlobalEnv, env_name))) stop("Environment inspection unavailable; evaluate its binding explicitly through visible R")
      env <- base::get(env_name, .GlobalEnv, inherits = FALSE)
      if (!is.environment(env)) stop("Choose an environment")
    }
    if (!base::exists(nm, env, inherits = FALSE) || base::bindingIsActive(nm, env) || any(rlang::env_binding_are_lazy(env, nm))) stop("Object unavailable or uses an active or lazy binding; inspect explicitly through visible R")
    obj <- base::get(nm, env, inherits = FALSE)
    cls <- attr(obj, "class", exact = TRUE)
    if (isS4(obj) || any(cls %in% c("tbl_dbi", "tbl_sql", "tbl_lazy", "arrow_dplyr_query", "Dataset"))) stop("Schema-only inspection cannot materialise this object; use its authorised connector")
    if (!is.list(obj) || !any(cls %in% c("data.frame", "sf", "tbl_df"))) stop("Schema inspection supports in-memory data frames; inspect other objects explicitly through visible R")
    raw <- unclass(obj)
    count <- length(raw)
    cols <- lapply(seq_len(min(count, 256L)), function(i) {
      column <- raw[[i]]
      type <- attr(column, "class", exact = TRUE) %||% typeof(column)
      if (!is.character(type)) type <- typeof(column)
      units <- attr(column, "units", exact = TRUE)
      list(name = substr(names(raw)[[i]], 1L, 256L), type = paste(substr(head(type, 8L), 1L, 128L), collapse = "/"),
           typeCompleteness = if (length(type) > 8L || any(nchar(type) > 128L)) "partial" else "complete",
           units = if (is.character(units) && length(units)) substr(units[[1L]], 1L, 128L) else NULL)
    })
    crs <- NULL
    geom_name <- attr(obj, "sf_column", exact = TRUE)
    if (is.character(geom_name) && length(geom_name) == 1L && geom_name %in% names(raw)) {
      declared <- attr(raw[[geom_name]], "crs", exact = TRUE)
      if (is.list(declared)) {
        declared <- unclass(declared)
        epsg <- declared[["epsg"]]
        input <- declared[["input"]]
        crs <- list(epsg = if (is.numeric(epsg) && length(epsg) == 1L) epsg else NULL,
                    input = if (is.character(input) && length(input)) substr(input[[1L]], 1L, 256L) else NULL)
      }
    }
    json_response(list(success = TRUE, columns = cols, crs = crs, totalColumns = count,
                       completeness = if (count > 256L) "partial" else "complete", observedAt = format(Sys.time(), tz = "UTC", usetz = TRUE)))
  }, error = function(e) error_response(conditionMessage(e)))
}
