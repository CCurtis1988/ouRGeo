# Rgeo/DuckDB: /db/* endpoint handlers
# (extracted from server.R — behavior-preserving modularization)

handle_db_create <- function(body) {
  file_path <- body$filePath %||% stop("filePath required")
  tryCatch({
    .rgeo_require_db_pkgs()
    if (file.exists(file_path)) {
      return(error_response(paste0("File already exists: ", file_path)))
    }
    drv <- duckdb::duckdb()
    con <- DBI::dbConnect(drv, dbdir = file_path)
    .rgeo_init_schema(con)
    .rgeo_seed_meta(con)
    # Best-effort: persist the spatial extension so subsequent opens are fast.
    .rgeo_load_spatial_ext(con)
    DBI::dbDisconnect(con, shutdown = TRUE)
    json_response(list(success = TRUE, path = file_path))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_db_open <- function(body) {
  file_path <- body$filePath %||% stop("filePath required")
  tryCatch({
    .rgeo_require_db_pkgs()
    if (!file.exists(file_path)) {
      return(error_response(paste0("File not found: ", file_path)))
    }
    drv <- duckdb::duckdb()
    con <- DBI::dbConnect(drv, dbdir = file_path)
    .rgeo_init_schema(con)
    .rgeo_seed_meta(con)
    handle <- paste0("db_", as.character(round(as.numeric(Sys.time()) * 1000)),
                      "_", sample(1000:9999, 1))
    .ourgeo_env$db_conns[[handle]] <- list(con = con, file_path = file_path)
    .rgeo_load_spatial_ext(con, handle)
    .rgeo_migrate_legacy(con, handle)
    objects <- .rgeo_list_objects(con)
    json_response(list(success = TRUE, handle = handle, objects = objects))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_db_close <- function(body) {
  handle <- body$handle %||% stop("handle required")
  tryCatch({
    entry <- .ourgeo_env$db_conns[[handle]]
    if (!is.null(entry)) {
      tryCatch(DBI::dbDisconnect(entry$con, shutdown = TRUE), error = function(e) NULL)
    }
    .ourgeo_env$db_conns[[handle]] <- NULL
    # Sweep any proxy registrations bound to this handle.
    if (length(.ourgeo_env$rgeo_proxies) > 0L) {
      keep <- vapply(.ourgeo_env$rgeo_proxies,
                     function(p) !identical(p$handle, handle),
                     logical(1))
      .ourgeo_env$rgeo_proxies <- .ourgeo_env$rgeo_proxies[keep]
    }
    json_response(list(success = TRUE))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_db_list_objects <- function(body) {
  handle <- body$handle %||% stop("handle required")
  tryCatch({
    con <- .rgeo_get_con(handle)
    json_response(list(success = TRUE, objects = .rgeo_list_objects(con)))
  }, error = function(e) error_response(conditionMessage(e)))
}

# Snapshot the live dataset proxies for a project save: each connected proxy var
# with its source object name and the .Rgeo file it lives in (resolved from the
# handle). Consumed on project load by /db/reconnect to rebuild clean connections.
handle_db_proxies <- function() {
  tryCatch({
    proxies <- list()
    for (var_name in names(.ourgeo_env$rgeo_proxies)) {
      p <- .ourgeo_env$rgeo_proxies[[var_name]]
      entry <- .ourgeo_env$db_conns[[p$handle]]
      file_path <- if (!is.null(entry)) entry$file_path else NA_character_
      proxies[[length(proxies) + 1L]] <- list(
        varName  = var_name,
        name     = p$name,
        filePath = file_path
      )
    }
    json_response(list(success = TRUE, proxies = proxies))
  }, error = function(e) error_response(conditionMessage(e)))
}

# Re-establish clean database connections after a project load. `databases` is a
# list of { filePath, proxies: [{ varName, name }] }. Each file is reopened (fresh
# con + handle) and every proxy is rebound via the normal connect path, so the
# stale `dplyr::tbl` objects restored from the env .RData are replaced by live ones.
# Returns the filePath -> new handle map so the renderer can refresh its DB store.
handle_db_reconnect <- function(body) {
  dbs <- body$databases %||% list()
  tryCatch({
    .rgeo_require_db_pkgs()
    handles <- list()
    errors <- character(0)
    for (db in dbs) {
      fp <- db$filePath
      if (is.null(fp) || length(fp) == 0 || is.na(fp[1]) || !nzchar(fp[1])) next
      fp <- fp[1]
      if (!file.exists(fp)) {
        errors <- c(errors, paste0("File not found: ", fp))
        next
      }
      open_res <- handle_db_open(list(filePath = fp))
      parsed <- fromJSON(open_res$body, simplifyVector = FALSE)
      if (!isTRUE(parsed$success)) {
        errors <- c(errors, paste0("Open failed: ", fp, " — ", parsed$error %||% "unknown"))
        next
      }
      new_handle <- parsed$handle
      handles[[fp]] <- new_handle
      for (px in (db$proxies %||% list())) {
        cres <- handle_db_connect_object(list(
          handle  = new_handle,
          name    = px$name,
          varName = px$varName,
          mode    = "connect"
        ))
        cparsed <- fromJSON(cres$body, simplifyVector = FALSE)
        if (!isTRUE(cparsed$success)) {
          errors <- c(errors, paste0("Reconnect proxy '", px$varName %||% "?", "' failed: ",
                                     cparsed$error %||% "unknown"))
        }
      }
    }
    json_response(list(success = length(errors) == 0L, handles = handles,
                       errors = as.list(errors)))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_db_delete_object <- function(body) {
  handle <- body$handle %||% stop("handle required")
  name <- body$name %||% stop("name required")
  tryCatch({
    con <- .rgeo_get_con(handle)
    row <- .rgeo_obj_row(con, name)
    if (is.null(row)) return(error_response(paste0("Object not found: ", name)))
    DBI::dbBegin(con)
    tryCatch({
      tn <- row$table_name[1]
      if (!is.na(tn) && nzchar(tn)) {
        DBI::dbExecute(con, sprintf('DROP TABLE IF EXISTS "%s"', tn))
      }
      DBI::dbExecute(con, "DELETE FROM _rgeo_rasters WHERE name = ?", params = list(name))
      DBI::dbExecute(con, "DELETE FROM _rgeo_raster_meta  WHERE name = ?", params = list(name))
      DBI::dbExecute(con, "DELETE FROM _rgeo_raster_tiles WHERE name = ?", params = list(name))
      DBI::dbExecute(con, "DELETE FROM _rgeo_images  WHERE name = ?", params = list(name))
      DBI::dbExecute(con, "DELETE FROM _rgeo_objects WHERE name = ?", params = list(name))
      DBI::dbCommit(con)
    }, error = function(e) {
      DBI::dbRollback(con); stop(e)
    })
    json_response(list(success = TRUE))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_db_connect_object <- function(body) {
  handle   <- body$handle  %||% stop("handle required")
  name     <- body$name    %||% stop("name required")
  var_name <- body$varName %||% name
  mode     <- body$mode    %||% "connect"  # 'connect' = lazy tbl ref, 'load' = full materialize
  tryCatch({
    con <- .rgeo_get_con(handle)
    row <- .rgeo_obj_row(con, name)
    if (is.null(row)) return(error_response(paste0("Object not found: ", name)))
    kind <- row$kind[1]
    table_like  <- kind %in% c("data.frame", "tibble", "data.table")
    spatial_vec <- kind %in% c("sf", "geos")

    # Rasters: both modes stream the tile pyramid into a file-backed
    # SpatRaster (bounded RAM); connect additionally registers a proxy so
    # project save/reconnect can rebuild the binding. Legacy v2 BLOBs are
    # upgraded to a pyramid on first access inside .rgeo_raster_connect.
    if (kind == "raster") {
      is_connect <- identical(mode, "connect")
      .rgeo_raster_connect(handle, name, var_name, register_proxy = is_connect)
      return(json_response(list(
        success = TRUE,
        varName = var_name,
        kind    = kind,
        mode    = if (is_connect) "lazy" else "loaded",
        code    = sprintf(
          "# %s <- [Rgeo] raster '%s' streamed from tiled storage (file-backed SpatRaster)",
          var_name, name)
      )))
    }

    code <- if (mode == "connect") {
      if (!(table_like || spatial_vec)) {
        return(error_response(paste0(
          "'", kind, "' objects cannot be connected as a dataset reference; use 'Load to environment'."
        )))
      }
      tn <- if (spatial_vec) .rgeo_ensure_sf_table(con, name) else row$table_name[1]
      sprintf('%s <- dplyr::tbl(con, "%s")', var_name, tn)
    } else {
      if (table_like) {
        tn <- row$table_name[1]
        switch(kind,
          "tibble"     = sprintf('%s <- tibble::as_tibble(DBI::dbReadTable(con, "%s"))', var_name, tn),
          "data.table" = sprintf('%s <- data.table::as.data.table(DBI::dbReadTable(con, "%s"))', var_name, tn),
          sprintf('%s <- DBI::dbReadTable(con, "%s")', var_name, tn)
        )
      } else if (kind %in% c("sf", "geos")) {
        # Native-format sf/geos: rebuild from the queryable table. Legacy
        # serialized format: fall back to the BLOB read.
        fmt <- row$spatial_format[1]
        if (!is.na(fmt) && fmt == "duckdb_geometry") {
          sprintf('%s <- .rgeo_load_sf_from_table(con, "%s", as_geos = %s)',
                  var_name, name, if (kind == "geos") "TRUE" else "FALSE")
        } else {
          sprintf(
            '%s <- unserialize(DBI::dbGetQuery(con, "SELECT data FROM _rgeo_objects WHERE name = ?", params = list("%s"))$data[[1]])',
            var_name, name
          )
        }
      } else if (kind == "rds") {
        sprintf(
          '%s <- unserialize(DBI::dbGetQuery(con, "SELECT data FROM _rgeo_objects WHERE name = ?", params = list("%s"))$data[[1]])',
          var_name, name
        )
      } else if (kind == "image") {
        sprintf(
          '%s <- unserialize(DBI::dbGetQuery(con, "SELECT data FROM _rgeo_images WHERE name = ?", params = list("%s"))$data[[1]])',
          var_name, name
        )
      } else stop("Unsupported kind: ", kind)
    }

    eval_env <- new.env(parent = .GlobalEnv)
    eval_env$con <- con
    eval(parse(text = code), envir = eval_env)
    assign(var_name, get(var_name, envir = eval_env), envir = .GlobalEnv)

    # Register a proxy for this var so the UI can route ops through the
    # /dataset/* endpoints. Only 'connect' mode creates a live link;
    # 'load' mode produces a detached in-memory copy.
    if (mode == "connect") {
      .ourgeo_env$rgeo_proxies[[var_name]] <- list(
        handle           = handle,
        name             = name,
        kind             = kind,
        spatial_format   = if (is.na(row$spatial_format[1])) NA_character_ else row$spatial_format[1],
        geometry_type    = if (is.na(row$geometry_type[1]))  NA_character_ else row$geometry_type[1],
        geometry_column  = if (is.na(row$geometry_column[1])) NA_character_ else row$geometry_column[1],
        pk_column        = if (is.na(row$pk_column[1])) "_rgeo_rowid" else row$pk_column[1],
        crs              = if (is.na(row$crs[1])) NA_character_ else row$crs[1]
      )
    } else {
      # 'load' mode replaces any prior proxy for this var.
      .ourgeo_env$rgeo_proxies[[var_name]] <- NULL
    }

    json_response(list(
      success = TRUE,
      varName = var_name,
      kind    = kind,
      mode    = if (mode == "connect") "lazy" else "loaded",
      code    = code
    ))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_db_preview_object <- function(body) {
  handle <- body$handle %||% stop("handle required")
  name <- body$name %||% stop("name required")
  n <- as.integer(body$n %||% 100)
  tryCatch({
    con <- .rgeo_get_con(handle)
    row <- .rgeo_obj_row(con, name)
    if (is.null(row)) return(error_response(paste0("Object not found: ", name)))
    kind <- row$kind[1]

    if (kind %in% c("data.frame", "tibble", "data.table")) {
      tn <- row$table_name[1]
      df <- DBI::dbGetQuery(con, sprintf('SELECT * FROM "%s" LIMIT %d', tn, n))
      cols <- lapply(seq_along(df), function(i) {
        list(name = names(df)[i], type = class(df[[i]])[1])
      })
      rows <- lapply(seq_len(nrow(df)), function(i) {
        unname(lapply(df[i, , drop = FALSE], function(v) {
          v <- v[1]
          if (is.na(v)) NA else as.character(v)
        }))
      })
      json_response(list(success = TRUE, kind = kind, columns = cols, rows = rows))
    } else if (kind == "rds") {
      blob <- DBI::dbGetQuery(con, "SELECT data FROM _rgeo_objects WHERE name = ?",
                              params = list(name))$data[[1]]
      obj <- .rgeo_unserialize_rds(blob)
      summary_lines <- tryCatch(
        utils::capture.output(utils::str(obj, max.level = 1)),
        error = function(e) paste0("class: ", paste(class(obj), collapse = ", "))
      )
      summary_lines <- utils::head(summary_lines, 10)
      json_response(list(success = TRUE, kind = kind,
                         message = paste(summary_lines, collapse = "\n")))
    } else {
      json_response(list(success = TRUE, kind = kind,
                         message = "Preview not available for this object kind"))
    }
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_db_import_object <- function(body) {
  handle <- body$handle %||% stop("handle required")
  source_var <- body$sourceVarName %||% stop("sourceVarName required")
  target_name <- body$targetName %||% source_var
  notes <- body$notes %||% NA_character_
  tryCatch({
    con <- .rgeo_get_con(handle)
    # Use eval(parse()) so nested access paths like `mylist$child` or `xs[[1]]`
    # resolve correctly; plain names still work.
    obj <- tryCatch(
      eval(parse(text = source_var), envir = .GlobalEnv),
      error = function(e) stop("Variable not found in environment: ", source_var)
    )
    kind <- .rgeo_detect_kind(obj)
    geom_type <- .rgeo_geom_type(obj)
    crs <- .rgeo_crs(obj)
    size_bytes <- as.numeric(object.size(obj))
    n_rows <- if (is.data.frame(obj) || inherits(obj, "sf")) nrow(obj) else NA_integer_
    r_class_val <- if (kind == "rds") class(obj)[1] else NA_character_

    # Replace existing entry with the same name
    DBI::dbBegin(con)
    tryCatch({
      old_row <- .rgeo_obj_row(con, target_name)
      if (!is.null(old_row)) {
        old_tn <- old_row$table_name[1]
        if (!is.na(old_tn) && nzchar(old_tn)) {
          DBI::dbExecute(con, sprintf('DROP TABLE IF EXISTS "%s"', old_tn))
        }
        DBI::dbExecute(con, "DELETE FROM _rgeo_rasters WHERE name = ?", params = list(target_name))
        DBI::dbExecute(con, "DELETE FROM _rgeo_raster_meta  WHERE name = ?", params = list(target_name))
        DBI::dbExecute(con, "DELETE FROM _rgeo_raster_tiles WHERE name = ?", params = list(target_name))
        DBI::dbExecute(con, "DELETE FROM _rgeo_images  WHERE name = ?", params = list(target_name))
        DBI::dbExecute(con, "DELETE FROM _rgeo_objects WHERE name = ?", params = list(target_name))
      }

      table_name_val <- NA_character_
      if (kind %in% c("data.frame", "tibble", "data.table")) {
        tn <- paste0("data_", .rgeo_sanitize_id(target_name))
        stage <- paste0("_stage_", .rgeo_sanitize_id(target_name))
        df <- as.data.frame(obj, stringsAsFactors = FALSE)
        DBI::dbExecute(con, sprintf('DROP TABLE IF EXISTS "%s"', tn))
        DBI::dbExecute(con, sprintf('DROP TABLE IF EXISTS "%s"', stage))
        DBI::dbWriteTable(con, stage, df, overwrite = TRUE)
        # Materialise final table with a synthetic _rgeo_rowid PK for
        # stable per-row addressing during cell edits.
        attr_cols <- names(df)
        if (length(attr_cols) > 0L) {
          attr_cols_q <- paste(sprintf('"%s"', attr_cols), collapse = ", ")
          DBI::dbExecute(con, sprintf(
            'CREATE TABLE "%s" AS
               SELECT row_number() OVER () AS "_rgeo_rowid", %s FROM "%s"',
            tn, attr_cols_q, stage))
        } else {
          DBI::dbExecute(con, sprintf(
            'CREATE TABLE "%s" AS
               SELECT row_number() OVER () AS "_rgeo_rowid" FROM "%s"',
            tn, stage))
        }
        DBI::dbExecute(con, sprintf('DROP TABLE "%s"', stage))
        table_name_val <- tn
        DBI::dbExecute(con, "
          INSERT INTO _rgeo_objects
          (name, kind, geometry_type, crs, n_rows, size_bytes, notes, created_at,
           table_name, data, r_class, pk_column, spatial_format, editable, format_version)
          VALUES (?, ?, NULL, NULL, ?, ?, ?, current_timestamp,
                  ?, NULL, NULL, '_rgeo_rowid', 'none', TRUE, ?)",
          params = list(target_name, kind, n_rows, size_bytes,
                        if (is.na(notes)) NA else notes, tn,
                        .rgeo_format_version))
      } else if (kind %in% c("sf", "geos")) {
        # Native-geometry path: insert a metadata row first so
        # .rgeo_write_native_geom_table can UPDATE it. No BLOB is stored;
        # if the spatial extension isn't available we fall back to the
        # legacy serialized format so the data still round-trips.
        DBI::dbExecute(con, "
          INSERT INTO _rgeo_objects
          (name, kind, geometry_type, crs, n_rows, size_bytes, notes, created_at,
           table_name, data, r_class, spatial_format, editable, format_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, current_timestamp,
                  NULL, NULL, NULL, NULL, TRUE, ?)",
          params = list(target_name, kind,
                        if (is.na(geom_type)) NA else geom_type,
                        if (is.na(crs)) NA else crs,
                        n_rows, size_bytes,
                        if (is.na(notes)) NA else notes,
                        .rgeo_format_version))
        wrote_native <- tryCatch({
          .rgeo_write_native_geom_table(con, target_name, obj, kind, handle)
          TRUE
        }, error = function(e) FALSE)
        if (!wrote_native) {
          # Legacy fallback: persist as serialized BLOB so the data is
          # never lost. Connect-time will materialize a copy.
          blob <- .rgeo_serialize_rds(obj)
          DBI::dbExecute(con, "
            UPDATE _rgeo_objects
               SET data = ?, spatial_format = 'serialized'
             WHERE name = ?",
            params = list(list(blob), target_name))
        }
      } else if (kind == "raster") {
        # Format v3: stream the raster into the tile pyramid (block storage,
        # bounded RAM; connect streams it back without full materialization).
        wrote_pyramid <- requireNamespace("terra", quietly = TRUE) && tryCatch({
          .rgeo_write_raster_pyramid(con, target_name, obj, notes)
          TRUE
        }, error = function(e) {
          broadcast_console(paste0(
            "[Rgeo] Tiled raster storage failed (", conditionMessage(e),
            ") — falling back to serialized storage.\n"), "stderr")
          FALSE
        })
        if (!wrote_pyramid) {
          # Legacy fallback: whole-object BLOB so the data is never lost.
          packed <- if (inherits(obj, "SpatRaster") &&
                        requireNamespace("terra", quietly = TRUE)) {
            terra::wrap(obj)
          } else obj
          blob <- .rgeo_serialize_rds(packed)
          ext <- tryCatch(as.numeric(terra::ext(obj)), error = function(e) c(NA, NA, NA, NA))
          nb  <- tryCatch(as.integer(terra::nlyr(obj)), error = function(e) NA_integer_)
          nr  <- tryCatch(as.integer(terra::nrow(obj)), error = function(e) NA_integer_)
          nc  <- tryCatch(as.integer(terra::ncol(obj)), error = function(e) NA_integer_)
          DBI::dbExecute(con, "
            INSERT INTO _rgeo_rasters
            (name, data, crs, xmin, ymin, xmax, ymax, nrow, ncol, nbands, dtype)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params = list(target_name, list(blob),
                          if (is.na(crs)) NA else crs,
                          ext[1], ext[3], ext[2], ext[4],
                          nr, nc, nb, NA_character_))
          DBI::dbExecute(con, "
            INSERT INTO _rgeo_objects
            (name, kind, geometry_type, crs, n_rows, size_bytes, notes, created_at,
             table_name, data, r_class, spatial_format, editable, format_version)
            VALUES (?, 'raster', NULL, ?, NULL, ?, ?, current_timestamp,
                    NULL, NULL, NULL, 'serialized', FALSE, 2)",
            params = list(target_name,
                          if (is.na(crs)) NA else crs,
                          size_bytes,
                          if (is.na(notes)) NA else notes))
        }
      } else if (kind == "image") {
        blob <- .rgeo_serialize_rds(obj)
        DBI::dbExecute(con, "
          INSERT INTO _rgeo_images (name, data, format, width, height)
          VALUES (?, ?, 'rds', NULL, NULL)",
          params = list(target_name, list(blob)))
        DBI::dbExecute(con, "
          INSERT INTO _rgeo_objects
          (name, kind, geometry_type, crs, n_rows, size_bytes, notes, created_at,
           table_name, data, r_class, spatial_format, editable, format_version)
          VALUES (?, 'image', NULL, NULL, NULL, ?, ?, current_timestamp,
                  NULL, NULL, NULL, 'serialized', FALSE, ?)",
          params = list(target_name, size_bytes,
                        if (is.na(notes)) NA else notes,
                        .rgeo_format_version))
      } else if (kind == "rds") {
        blob <- .rgeo_serialize_rds(obj)
        DBI::dbExecute(con, "
          INSERT INTO _rgeo_objects
          (name, kind, geometry_type, crs, n_rows, size_bytes, notes, created_at,
           table_name, data, r_class, spatial_format, editable, format_version)
          VALUES (?, 'rds', NULL, NULL, NULL, ?, ?, current_timestamp,
                  NULL, ?, ?, 'serialized', FALSE, ?)",
          params = list(target_name, size_bytes,
                        if (is.na(notes)) NA else notes,
                        list(blob),
                        if (is.na(r_class_val)) NA else r_class_val,
                        .rgeo_format_version))
      } else {
        stop("Unsupported kind: ", kind)
      }

      DBI::dbExecute(con, "UPDATE _rgeo_meta SET last_modified = current_timestamp")
      DBI::dbCommit(con)
    }, error = function(e) {
      DBI::dbRollback(con); stop(e)
    })

    json_response(list(success = TRUE, name = target_name, kind = kind))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_db_preview_tbl <- function(body) {
  var_name <- body$varName %||% stop("varName required")
  n <- as.integer(body$n %||% 100)
  tryCatch({
    if (!exists(var_name, envir = .GlobalEnv, inherits = FALSE)) {
      return(error_response(paste0("Variable not found: ", var_name)))
    }
    obj <- get(var_name, envir = .GlobalEnv)
    if (!inherits(obj, "tbl_dbi")) {
      return(error_response("Variable is not a database tbl"))
    }
    df <- as.data.frame(dplyr::collect(dplyr::head(obj, n)))
    cols <- lapply(seq_along(df), function(i) {
      list(name = names(df)[i], type = class(df[[i]])[1])
    })
    rows <- lapply(seq_len(nrow(df)), function(i) {
      unname(lapply(df[i, , drop = FALSE], function(v) {
        v <- v[1]
        if (is.na(v)) NA else as.character(v)
      }))
    })
    json_response(list(success = TRUE, columns = cols, rows = rows))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_db_recents <- function() {
  path <- .rgeo_recents_path()
  if (!file.exists(path)) {
    return(json_response(list(success = TRUE, files = list())))
  }
  files <- tryCatch(
    fromJSON(readLines(path, warn = FALSE), simplifyVector = TRUE),
    error = function(e) character(0)
  )
  if (!is.character(files)) files <- character(0)
  json_response(list(success = TRUE, files = as.list(files)))
}

handle_db_recents_add <- function(body) {
  file_path <- body$filePath %||% stop("filePath required")
  path <- .rgeo_recents_path()
  current <- if (file.exists(path)) {
    tryCatch(fromJSON(readLines(path, warn = FALSE), simplifyVector = TRUE),
             error = function(e) character(0))
  } else character(0)
  if (!is.character(current)) current <- character(0)
  current <- unique(c(file_path, setdiff(current, file_path)))
  if (length(current) > 20) current <- current[1:20]
  writeLines(toJSON(current, auto_unbox = FALSE), path)
  json_response(list(success = TRUE, files = as.list(current)))
}

# ---------------------------------------------------------------------------
# WebSocket handler

