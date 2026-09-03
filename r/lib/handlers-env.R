# Handlers: environment object management
# (extracted from server.R — behavior-preserving modularization)

handle_env_list <- function() {
  search_path <- search()
  visited_envs <- character(0)

  environments <- lapply(search_path, function(env_name) {
    env <- tryCatch(as.environment(env_name), error = function(e) NULL)
    if (is.null(env)) return(NULL)

    is_pkg <- env_name != ".GlobalEnv" && grepl("^package:", env_name)
    env_id <- format(env)
    visited_envs <<- c(visited_envs, env_id)

    objects <- list_env_objects(env, env_name, is_pkg, 0, visited_envs)
    objects <- Filter(Negate(is.null), objects)

    list(name = env_name, isSearchPath = is_pkg, objects = objects)
  })

  environments <- Filter(Negate(is.null), environments)
  json_response(list(success = TRUE, environments = environments))
}

handle_env_remove <- function(body) {
  name <- body$name %||% stop("name required")
  env_name <- body$envName %||% ".GlobalEnv"

  tryCatch({
    env <- resolve_env(env_name)
    rm(list = name, envir = env)
    if (identical(env_name, ".GlobalEnv")) {
      .ourgeo_env$rgeo_proxies[[name]] <- NULL
    }
    ok_response()
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_env_rename <- function(body) {
  old_name <- body$oldName %||% stop("oldName required")
  new_name <- body$newName %||% stop("newName required")
  env_name <- body$envName %||% ".GlobalEnv"

  tryCatch({
    env <- resolve_env(env_name)
    assign(new_name, get(old_name, envir = env), envir = env)
    rm(list = old_name, envir = env)
    if (identical(env_name, ".GlobalEnv")) {
      proxy <- .ourgeo_env$rgeo_proxies[[old_name]]
      if (!is.null(proxy)) {
        .ourgeo_env$rgeo_proxies[[new_name]] <- proxy
        .ourgeo_env$rgeo_proxies[[old_name]] <- NULL
      }
    }
    ok_response()
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_env_copy <- function(body) {
  name <- body$name %||% stop("name required")
  from_env <- body$fromEnv %||% ".GlobalEnv"
  to_env <- body$toEnv %||% ".GlobalEnv"
  new_name <- body$newName %||% paste0(name, "_copy")

  tryCatch({
    from <- resolve_env(from_env)
    to <- resolve_env(to_env)
    assign(new_name, get(name, envir = from), envir = to)
    ok_response()
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_env_move <- function(body) {
  name <- body$name %||% stop("name required")
  from_env <- body$fromEnv %||% ".GlobalEnv"
  to_env <- body$toEnv %||% stop("toEnv required")

  tryCatch({
    from <- resolve_env(from_env)
    to <- resolve_env(to_env)
    assign(name, get(name, envir = from), envir = to)
    rm(list = name, envir = from)
    ok_response()
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_env_create <- function(body) {
  name <- body$name %||% stop("name required")
  parent_env <- body$parentEnv %||% ".GlobalEnv"

  tryCatch({
    parent <- resolve_env(parent_env)
    assign(name, new.env(parent = parent), envir = .GlobalEnv)
    ok_response()
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_env_save <- function(body) {
  file_path    <- body$filePath %||% stop("filePath required")
  env_names    <- body$envNames
  if (is.null(env_names)) {
    env_names <- list(body$envName %||% ".GlobalEnv")
  }
  rdata_loaded <- body$rdataLoadedNames  # character vector of rdata-sourced names, or NULL
  # When TRUE, saving .GlobalEnv skips the server's own source()d functions
  # (recorded in system_names) — used by the project snapshot so a bundle holds
  # only user objects, not the ~100 handler/util functions living in .GlobalEnv.
  exclude_system <- isTRUE(body$excludeSystem)

  tryCatch({
    tmp <- new.env(parent = emptyenv())
    pkg_names <- character(0)

    for (en in env_names) {
      if (grepl("^package:", en)) {
        pkg_name <- sub("^package:", "", en)
        pkg_names <- c(pkg_names, pkg_name)
        # Save package objects as fallback under a namespaced key
        src <- resolve_env(en)
        pkg_env <- new.env(parent = emptyenv())
        for (nm in ls(envir = src)) {
          assign(nm, get(nm, envir = src), envir = pkg_env)
        }
        assign(paste0(".ourgeo_pkg_", pkg_name), pkg_env, envir = tmp)
      } else {
        src <- resolve_env(en)
        names_to_save <- ls(envir = src)
        if (exclude_system && en == ".GlobalEnv") {
          names_to_save <- setdiff(names_to_save, .ourgeo_env$system_names %||% character(0))
        }
        for (nm in names_to_save) {
          assign(nm, get(nm, envir = src), envir = tmp)
        }
      }
    }

    # Build metadata — merge package info with object source info
    meta <- list()
    if (length(pkg_names) > 0) meta$packages <- pkg_names
    if (length(rdata_loaded) > 0) meta$rdata_loaded_names <- as.character(rdata_loaded)
    if (length(meta) > 0) assign(".ourgeo_save_meta", meta, envir = tmp)

    save(list = ls(envir = tmp, all.names = TRUE), file = file_path, envir = tmp)
    ok_response()
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_env_load <- function(body) {
  file_path <- body$filePath %||% stop("filePath required")
  env_name <- body$envName %||% ".GlobalEnv"

  tryCatch({
    tmp <- new.env(parent = emptyenv())
    load(file_path, envir = tmp)

    rdata_loaded_out <- character(0)

    # Restore packages and extract source metadata if present
    if (exists(".ourgeo_save_meta", envir = tmp)) {
      meta <- get(".ourgeo_save_meta", envir = tmp)

      for (pkg in meta$packages %||% character(0)) {
        loaded_ok <- tryCatch({
          library(pkg, character.only = TRUE)
          TRUE
        }, error = function(e) FALSE)

        fallback_key <- paste0(".ourgeo_pkg_", pkg)
        if (!loaded_ok && exists(fallback_key, envir = tmp)) {
          # Package not installed — load its objects into target env as fallback
          target <- resolve_env(env_name)
          broadcast_console(
            paste0("Warning: package '", pkg, "' is not installed. ",
                   "Its contents have been loaded into ", env_name, " as a fallback."),
            "stderr"
          )
          pkg_env <- get(fallback_key, envir = tmp)
          for (nm in ls(envir = pkg_env)) {
            assign(nm, get(nm, envir = pkg_env), envir = target)
          }
        }

        # Clean up fallback key regardless
        if (exists(fallback_key, envir = tmp)) {
          rm(list = fallback_key, envir = tmp)
        }
      }

      # Extract object source metadata
      if (!is.null(meta$rdata_loaded_names)) {
        rdata_loaded_out <- as.character(meta$rdata_loaded_names)
      }

      rm(".ourgeo_save_meta", envir = tmp)
      .ourgeo_env$packages_cache <- NULL
    }

    # Load remaining objects into target environment
    target <- resolve_env(env_name)
    loaded_names <- ls(envir = tmp)
    for (nm in loaded_names) {
      assign(nm, get(nm, envir = tmp), envir = target)
    }

    # What the panel should treat as NOT the user's own work: whatever the file
    # itself recorded, plus anything that is one of this server's own functions.
    #
    # This used to be "no metadata in the file → treat ALL of it as non-user",
    # and that is how opening a project left the Environment panel blank. A
    # project bundle is written with excludeSystem, so it holds nothing but
    # user objects — and therefore has no metadata to record, since there was
    # nothing to record. Every object it restored came back flagged, the
    # panel's "Hide non-user objects" filter hid the lot, and `ls()` in the
    # console listed everything the panel said was not there.
    rdata_loaded_out <- union(
      intersect(rdata_loaded_out, loaded_names),
      intersect(loaded_names, .ourgeo_env$system_names %||% character(0))
    )

    json_response(list(success = TRUE, rdataLoadedNames = as.list(rdata_loaded_out)))
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

# Reset the session to a clean slate: disconnect every tracked DuckDB connection,
# drop all proxy registrations, wipe .GlobalEnv, and invalidate the packages cache.
# Used by the project workflow's "New" action and before loading a project.
handle_session_reset <- function(body) {
  tryCatch({
    for (handle in names(.ourgeo_env$db_conns)) {
      entry <- .ourgeo_env$db_conns[[handle]]
      if (!is.null(entry)) {
        tryCatch(DBI::dbDisconnect(entry$con, shutdown = TRUE), error = function(e) NULL)
      }
    }
    .ourgeo_env$db_conns <- list()
    .ourgeo_env$rgeo_proxies <- list()
    # Registered raster map layers belong to the outgoing session too.
    tryCatch(.ourgeo_raster_reset(), error = function(e) NULL)

    # Recorded plots reference the outgoing session's objects — drop them so a
    # loaded project can't replay the previous project's plots.
    .ourgeo_env$last_plot <- NULL
    .ourgeo_env$plot_history <- list()
    .ourgeo_env$plot_seq <- 0L

    # Remove only user objects — never the server's own functions, which are
    # source()d into .GlobalEnv at startup and recorded in system_names.
    all_names <- ls(envir = .GlobalEnv, all.names = TRUE)
    user_names <- setdiff(all_names, .ourgeo_env$system_names %||% character(0))
    if (length(user_names) > 0) rm(list = user_names, envir = .GlobalEnv)

    .ourgeo_env$packages_cache <- NULL
    ok_response()
  }, error = function(e) error_response(conditionMessage(e)))
}

# ---------------------------------------------------------------------------
# Package management handlers
# ---------------------------------------------------------------------------

