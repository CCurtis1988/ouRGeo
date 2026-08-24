# Environment introspection helpers
# (extracted from server.R — behavior-preserving modularization)

# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------
resolve_env <- function(name_str, visited = character(0)) {
  if (name_str %in% visited) stop("Circular environment reference detected")
  visited <- c(visited, name_str)

  if (name_str == ".GlobalEnv") return(.GlobalEnv)
  if (grepl("^package:", name_str)) return(as.environment(name_str))
  # Custom env object in .GlobalEnv
  tryCatch(
    get(name_str, envir = .GlobalEnv),
    error = function(e) stop(paste0("Environment '", name_str, "' not found"))
  )
}

object_summary <- function(obj) {
  cls <- if (inherits(obj, "tbl_dbi")) "tbl_dbi" else class(obj)[1]
  sz <- as.numeric(object.size(obj))
  len <- if (is.environment(obj)) NULL else length(obj)
  dm <- if (!is.null(dim(obj))) as.integer(dim(obj)) else NULL
  is_list <- is.list(obj) && !is.data.frame(obj) && !is.environment(obj) && !inherits(obj, c("sf", "sfc"))

  preview <- tryCatch({
    if (is.data.frame(obj)) {
      paste0(nrow(obj), " obs. of ", ncol(obj), " variables")
    } else if (is.function(obj)) {
      args <- paste(names(formals(obj)), collapse = ", ")
      paste0("function(", args, ")")
    } else if (is.environment(obj)) {
      "<environment>"
    } else if (is.list(obj) && !inherits(obj, c("sf", "sfc"))) {
      paste0("List of ", length(obj))
    } else if (is.atomic(obj) && length(obj) <= 6) {
      paste(format(obj), collapse = " ")
    } else if (is.atomic(obj)) {
      paste(c(format(obj[1:5]), "..."), collapse = " ")
    } else {
      cls
    }
  }, error = function(e) cls)

  columns <- if (is.data.frame(obj) && !inherits(obj, c("sf", "sfc"))) {
    col_names <- names(obj)
    col_types <- sapply(obj, function(x) class(x)[1])
    mapply(function(n, t) list(name = n, type = t),
           col_names, col_types, SIMPLIFY = FALSE, USE.NAMES = FALSE)
  } else NULL

  list(class = cls, size = sz, length = len, dim = dm, preview = preview, isList = is_list, columns = columns)
}

list_env_objects <- function(env, env_name, is_package = FALSE, depth = 0, visited_envs = character(0)) {
  obj_names <- tryCatch(ls(envir = env), error = function(e) character(0))
  lapply(obj_names, function(nm) {
    obj <- tryCatch(get(nm, envir = env), error = function(e) NULL)
    if (is.null(obj) && !exists(nm, envir = env)) return(NULL)

    is_env <- is.environment(obj)
    is_list_obj <- is.list(obj) && !is.data.frame(obj) && !is.environment(obj) && !inherits(obj, c("sf", "sfc"))

    if (is_package) {
      info <- list(name = nm, class = class(obj)[1], size = 0, length = NULL,
                   dim = NULL, preview = "", isEnvironment = is_env, isList = FALSE)
    } else {
      summ <- object_summary(obj)
      info <- list(name = nm, class = summ$class, size = summ$size,
                   length = summ$length, dim = summ$dim, preview = summ$preview,
                   isEnvironment = is_env, isList = isTRUE(summ$isList),
                   columns = summ$columns)
      # Attach proxy info so the renderer can route ops through /dataset/*.
      proxy <- .ourgeo_env$rgeo_proxies[[nm]]
      if (!is.null(proxy) && env_name == ".GlobalEnv") {
        info$rgeoProxy <- list(
          handle          = proxy$handle,
          name            = proxy$name,
          kind            = proxy$kind,
          spatialFormat   = if (is.na(proxy$spatial_format)) NULL else proxy$spatial_format,
          geometryType    = if (is.null(proxy$geometry_type) || is.na(proxy$geometry_type)) NULL else proxy$geometry_type,
          geometryColumn  = if (is.na(proxy$geometry_column)) NULL else proxy$geometry_column,
          pkColumn        = proxy$pk_column,
          crs             = if (is.na(proxy$crs)) NULL else proxy$crs
        )
      }
    }

    # Recurse into nested environments (max depth 3)
    if (is_env && depth < 3) {
      env_id <- format(obj)
      if (!(env_id %in% visited_envs)) {
        info$children <- list_env_objects(obj, nm, FALSE, depth + 1,
                                          c(visited_envs, env_id))
      }
    }

    # Recurse into lists (max depth 3) — show children like environments
    if (is_list_obj && depth < 3) {
      children <- list()
      nms <- names(obj)
      for (i in seq_along(obj)) {
        child <- obj[[i]]
        child_name <- if (!is.null(nms) && nchar(nms[i]) > 0) nms[i] else paste0("[[", i, "]]")
        child_summ <- object_summary(child)
        child_is_env <- is.environment(child)
        child_is_list <- isTRUE(child_summ$isList)
        child_info <- list(
          name = child_name, class = child_summ$class, size = child_summ$size,
          length = child_summ$length, dim = child_summ$dim, preview = child_summ$preview,
          isEnvironment = child_is_env, isList = child_is_list
        )
        # Recurse into nested list children
        if (child_is_list && depth + 1 < 3) {
          sub_children <- list()
          sub_nms <- names(child)
          for (j in seq_along(child)) {
            sub <- child[[j]]
            sub_name <- if (!is.null(sub_nms) && nchar(sub_nms[j]) > 0) sub_nms[j] else paste0("[[", j, "]]")
            sub_summ <- object_summary(sub)
            sub_children[[j]] <- list(
              name = sub_name, class = sub_summ$class, size = sub_summ$size,
              length = sub_summ$length, dim = sub_summ$dim, preview = sub_summ$preview,
              isEnvironment = is.environment(sub), isList = isTRUE(sub_summ$isList)
            )
          }
          child_info$children <- sub_children
        }
        if (child_is_env && depth + 1 < 3) {
          env_id <- format(child)
          if (!(env_id %in% visited_envs)) {
            child_info$children <- list_env_objects(child, child_name, FALSE, depth + 2,
                                                     c(visited_envs, env_id))
          }
        }
        children[[i]] <- child_info
      }
      info$children <- children
    }

    info
  })
}

# ---------------------------------------------------------------------------
# Incremental .GlobalEnv change tracking
#
# A full /env/list walks the entire search path (every attached package —
# thousands of symbols), which is far too heavy to run after every execution.
# But only .GlobalEnv changes when user code runs, so we (1) compute a cheap
# O(1)-per-object fingerprint (name + class + dim/length only — no object.size
# or preview), and (2) rebuild + broadcast just the .GlobalEnv entry when that
# fingerprint changes. Value-only edits (same shape) don't trigger a rebuild.
# ---------------------------------------------------------------------------

globalenv_fingerprint <- function() {
  nms <- ls(envir = .GlobalEnv)
  if (length(nms) == 0) return("")
  sigs <- vapply(nms, function(nm) {
    obj <- tryCatch(get(nm, envir = .GlobalEnv, inherits = FALSE),
                    error = function(e) NULL)
    if (is.null(obj)) return("?")
    d <- tryCatch(dim(obj), error = function(e) NULL)
    dstr <- if (is.null(d)) tryCatch(as.character(length(obj)), error = function(e) "?")
            else paste(d, collapse = "x")
    paste0(class(obj)[1], ":", dstr)
  }, character(1))
  paste0(nms, "=", sigs, collapse = ";")
}

# Build only the .GlobalEnv environment entry, in the same shape /env/list uses.
globalenv_entry <- function() {
  objects <- list_env_objects(.GlobalEnv, ".GlobalEnv", FALSE, 0, format(.GlobalEnv))
  objects <- Filter(Negate(is.null), objects)
  list(name = ".GlobalEnv", isSearchPath = FALSE, objects = objects)
}

# Broadcast the .GlobalEnv entry over the console WebSocket iff it changed since
# the last broadcast. Safe to call after any handler that may mutate .GlobalEnv.
broadcast_env_if_changed <- function() {
  fp <- tryCatch(globalenv_fingerprint(), error = function(e) NULL)
  if (is.null(fp) || identical(fp, .ourgeo_env$env_fingerprint)) return(invisible(NULL))
  .ourgeo_env$env_fingerprint <- fp
  entry <- tryCatch(globalenv_entry(), error = function(e) NULL)
  if (!is.null(entry)) broadcast_system(list(type = "env", data = entry))
  # Registered raster map layers may be backed by an object that just changed
  # or vanished — sweep them so the map never serves stale tiles.
  tryCatch(.ourgeo_raster_check_stale(), error = function(e) NULL)
  invisible(NULL)
}

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

