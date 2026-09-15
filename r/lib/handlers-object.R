# Handlers: object inspection (function/dataframe/matrix/vector)
# (extracted from server.R — behavior-preserving modularization)

resolve_object <- function(access_path, env_name) {
  env <- resolve_env(env_name)
  eval(parse(text = access_path), envir = env)
}

handle_object_function <- function(body) {
  name <- body$name %||% stop("name required")
  env_name <- body$envName %||% ".GlobalEnv"
  access_path <- body$accessPath %||% name

  tryCatch({
    obj <- resolve_object(access_path, env_name)
    if (!is.function(obj)) return(error_response("Object is not a function"))
    source <- paste(deparse(obj), collapse = "\n")
    json_response(list(success = TRUE, source = source, name = name))
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

# Return the formal argument names of a function, for argument-name completion.
# Resolves `name` optionally qualified by `package`; falls back to the global
# env and the search path. Uses args() so primitives (sum, c, ...) still yield
# a usable signature.
handle_object_formals <- function(body) {
  name <- body$name %||% stop("name required")
  pkg  <- body$package %||% NULL

  tryCatch({
    fn <- NULL
    if (!is.null(pkg) && nzchar(pkg)) {
      fn <- tryCatch(getExportedValue(pkg, name), error = function(e) NULL)
      if (is.null(fn))
        fn <- tryCatch(get(name, envir = asNamespace(pkg)), error = function(e) NULL)
    }
    if (is.null(fn))
      fn <- tryCatch(get(name, envir = globalenv()), error = function(e) NULL)
    if (is.null(fn))
      fn <- tryCatch(match.fun(name), error = function(e) NULL)
    # A CONSIDERED ANSWER, not a failure: HTTP 200 with success = FALSE, the
    # shape `handle_selection_query` already uses.
    #
    # The caller is autocomplete, asking about a token somebody is part way
    # through typing, so most of what it asks about does not resolve — and
    # `error_response` is HTTP 500, which axios rejects. That put a 500 in the
    # renderer console for every unfinished identifier, and made "no such
    # function" indistinguishable from "the R server is down", which is the
    # distinction the caller needs to decide whether asking again is worth it.
    if (is.null(fn) || !is.function(fn)) {
      return(json_response(list(
        success = FALSE,
        error = paste0("There is no function called ", name, " in this session.")
      )))
    }

    fmls <- formals(fn)
    if (is.null(fmls)) fmls <- tryCatch(formals(args(fn)), error = function(e) NULL)
    arg_names <- names(fmls)
    if (is.null(arg_names)) arg_names <- character(0)

    args <- lapply(arg_names, function(a) {
      d <- fmls[[a]]
      default_txt <- tryCatch(paste(deparse(d), collapse = " "), error = function(e) "")
      list(name = a, hasDefault = nzchar(default_txt), default = default_txt)
    })
    json_response(list(success = TRUE, args = args))
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_object_dataframe <- function(body) {
  name <- body$name %||% stop("name required")
  env_name <- body$envName %||% ".GlobalEnv"
  access_path <- body$accessPath %||% name
  offset <- body$offset %||% 0
  limit <- body$limit %||% 500

  tryCatch({
    obj <- resolve_object(access_path, env_name)
    if (!is.data.frame(obj)) return(error_response("Object is not a data.frame"))

    total_rows <- nrow(obj)
    start <- offset + 1
    end <- min(offset + limit, total_rows)

    columns <- lapply(seq_len(ncol(obj)), function(i) {
      list(name = colnames(obj)[i], type = class(obj[[i]])[1])
    })

    rows <- list()
    if (start <= end) {
      chunk <- obj[start:end, , drop = FALSE]
      for (r in seq_len(nrow(chunk))) {
        row_vals <- vapply(seq_len(ncol(chunk)), function(c) {
          tryCatch({
            val <- chunk[[c]][r]
            if (length(val) == 0) return("NA")
            na_check <- tryCatch(is.na(val), error = function(e) FALSE)
            if (length(na_check) == 1 && isTRUE(na_check)) return("NA")
            chr <- tryCatch(as.character(val), error = function(e) "<?>")
            if (length(chr) == 0) "NA" else chr[[1]]
          }, error = function(e) "<?>")
        }, character(1))
        rows[[r]] <- as.list(row_vals)
      }
    }

    json_response(list(
      success = TRUE, columns = columns, rows = rows,
      totalRows = total_rows, offset = offset, limit = limit
    ))
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_object_matrix <- function(body) {
  name <- body$name %||% stop("name required")
  env_name <- body$envName %||% ".GlobalEnv"
  access_path <- body$accessPath %||% name
  offset <- body$offset %||% 0
  limit <- body$limit %||% 500

  tryCatch({
    obj <- resolve_object(access_path, env_name)
    if (!is.matrix(obj)) return(error_response("Object is not a matrix"))

    total_rows <- nrow(obj)
    total_cols <- ncol(obj)
    start <- offset + 1
    end <- min(offset + limit, total_rows)

    mat_type <- typeof(obj)

    rows <- list()
    if (start <= end) {
      chunk <- obj[start:end, , drop = FALSE]
      for (r in seq_len(nrow(chunk))) {
        row_vals <- vapply(seq_len(ncol(chunk)), function(c) {
          tryCatch({
            val <- chunk[[c]][r]
            if (length(val) == 0) return("NA")
            na_check <- tryCatch(is.na(val), error = function(e) FALSE)
            if (length(na_check) == 1 && isTRUE(na_check)) return("NA")
            chr <- tryCatch(as.character(val), error = function(e) "<?>")
            if (length(chr) == 0) "NA" else chr[[1]]
          }, error = function(e) "<?>")
        }, character(1))
        rows[[r]] <- as.list(row_vals)
      }
    }

    json_response(list(
      success = TRUE, nrow = total_rows, ncol = total_cols, type = mat_type,
      rows = rows, offset = offset, limit = limit
    ))
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_object_vector <- function(body) {
  name <- body$name %||% stop("name required")
  env_name <- body$envName %||% ".GlobalEnv"
  access_path <- body$accessPath %||% name
  offset <- body$offset %||% 0
  limit <- body$limit %||% 500

  tryCatch({
    obj <- resolve_object(access_path, env_name)
    if (!is.atomic(obj) || !is.null(dim(obj))) return(error_response("Object is not a vector"))

    total_length <- length(obj)
    start <- offset + 1
    end <- min(offset + limit, total_length)

    values <- list()
    if (start <= end) {
      chunk <- obj[start:end]
      values <- as.list(vapply(chunk, function(v) {
        if (is.na(v)) "NA" else as.character(v)
      }, character(1)))
    }

    vec_type <- class(obj)[1]

    json_response(list(
      success = TRUE, type = vec_type, values = values,
      totalLength = total_length, offset = offset, limit = limit
    ))
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

# ---------------------------------------------------------------------------
# Spatial data handlers
# ---------------------------------------------------------------------------

