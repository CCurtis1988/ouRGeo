# Rgeo/DuckDB: expression translation, dataset translators + dispatch
# (extracted from server.R — behavior-preserving modularization)

.rgeo_unary_fn_map <- list(
  st_x = "ST_X", st_y = "ST_Y",
  st_length = "ST_Length", st_area = "ST_Area",
  st_perimeter = "ST_Perimeter", st_centroid = "ST_Centroid",
  st_xmin = "ST_XMin", st_ymin = "ST_YMin",
  st_xmax = "ST_XMax", st_ymax = "ST_YMax",
  abs = "ABS", floor = "FLOOR", ceiling = "CEIL", round = "ROUND",
  sqrt = "SQRT", log = "LN", log2 = "LOG2", log10 = "LOG10",
  exp = "EXP", toupper = "UPPER", tolower = "LOWER",
  trimws = "TRIM", nchar = "LENGTH",
  as.numeric = "CAST", as.character = "CAST",
  as.integer = "CAST"
)

.rgeo_cast_target <- list(
  as.numeric  = "DOUBLE",
  as.character = "VARCHAR",
  as.integer  = "BIGINT"
)

.rgeo_translate_expr <- function(expr, columns, geom_col) {
  if (is.numeric(expr) || is.logical(expr)) {
    if (is.na(expr)) return("NULL")
    return(format(expr, scientific = FALSE))
  }
  if (is.character(expr)) {
    return(paste0("'", gsub("'", "''", expr, fixed = TRUE), "'"))
  }
  if (is.symbol(expr)) {
    nm <- as.character(expr)
    if (nm == "NA") return("NULL")
    if (nm == "TRUE") return("TRUE")
    if (nm == "FALSE") return("FALSE")
    # Symbols may be column refs. Match case-insensitively against known cols
    # or pass through if it looks like the geometry column.
    if (!is.null(geom_col) && !is.na(geom_col) && nm == geom_col) {
      return(.rgeo_qid(geom_col))
    }
    if (nm %in% columns) return(.rgeo_qid(nm))
    .rgeo_unsupported(paste0("Unknown column or symbol: ", nm))
  }
  if (is.call(expr)) {
    fn <- expr[[1]]
    if (!is.symbol(fn) && !is.character(fn)) {
      .rgeo_unsupported("Non-symbolic function call")
    }
    fn_name <- as.character(fn)
    args <- as.list(expr)[-1]
    rec  <- function(e) .rgeo_translate_expr(e, columns, geom_col)
    if (fn_name %in% c("(", "{")) {
      if (length(args) != 1L) .rgeo_unsupported("Empty parens")
      return(paste0("(", rec(args[[1]]), ")"))
    }
    if (fn_name %in% c("+", "-", "*", "/")) {
      if (length(args) == 1L) return(paste0(fn_name, rec(args[[1]])))
      return(paste0("(", rec(args[[1]]), " ", fn_name, " ", rec(args[[2]]), ")"))
    }
    if (fn_name %in% c("==", "!=", "<", "<=", ">", ">=")) {
      sql_op <- if (fn_name == "==") "=" else if (fn_name == "!=") "<>" else fn_name
      return(paste0("(", rec(args[[1]]), " ", sql_op, " ", rec(args[[2]]), ")"))
    }
    if (fn_name == "&" || fn_name == "&&") {
      return(paste0("(", rec(args[[1]]), " AND ", rec(args[[2]]), ")"))
    }
    if (fn_name == "|" || fn_name == "||") {
      return(paste0("(", rec(args[[1]]), " OR ", rec(args[[2]]), ")"))
    }
    if (fn_name == "!") {
      return(paste0("NOT (", rec(args[[1]]), ")"))
    }
    if (fn_name %in% c("ifelse", "if_else")) {
      if (length(args) < 3L) .rgeo_unsupported("ifelse needs 3 args")
      return(paste0("CASE WHEN ", rec(args[[1]]),
                    " THEN ", rec(args[[2]]),
                    " ELSE ", rec(args[[3]]), " END"))
    }
    if (fn_name %in% c("paste", "paste0")) {
      sep_str <- if (fn_name == "paste0") "" else " "
      sep_arg <- args[["sep"]]
      if (!is.null(sep_arg)) sep_str <- as.character(sep_arg)
      args <- args[setdiff(names(args), c("sep", "collapse"))]
      if (length(args) == 0L) .rgeo_unsupported("paste with no args")
      parts <- vapply(args, function(a) paste0("CAST(", rec(a), " AS VARCHAR)"), character(1))
      if (sep_str == "") return(paste0("CONCAT(", paste(parts, collapse = ", "), ")"))
      sep_sql <- paste0("'", gsub("'", "''", sep_str, fixed = TRUE), "'")
      return(paste0("CONCAT_WS(", sep_sql, ", ", paste(parts, collapse = ", "), ")"))
    }
    if (fn_name %in% c("substr", "substring")) {
      if (length(args) < 2L) .rgeo_unsupported("substr needs at least 2 args")
      start <- rec(args[[2]])
      stop_ <- if (length(args) >= 3L) rec(args[[3]]) else NULL
      if (is.null(stop_)) {
        return(paste0("SUBSTRING(", rec(args[[1]]), " FROM ", start, ")"))
      }
      # length = stop - start + 1
      return(paste0("SUBSTRING(", rec(args[[1]]),
                    " FROM ", start, " FOR (", stop_, " - ", start, " + 1))"))
    }
    if (fn_name %in% names(.rgeo_unary_fn_map)) {
      sql_fn <- .rgeo_unary_fn_map[[fn_name]]
      if (fn_name %in% names(.rgeo_cast_target)) {
        if (length(args) != 1L) .rgeo_unsupported(paste0(fn_name, " needs 1 arg"))
        return(paste0("CAST(", rec(args[[1]]), " AS ",
                      .rgeo_cast_target[[fn_name]], ")"))
      }
      if (length(args) != 1L) .rgeo_unsupported(paste0(fn_name, " needs 1 arg"))
      return(paste0(sql_fn, "(", rec(args[[1]]), ")"))
    }
    # Namespaced calls like sf::st_length — drop the namespace and retry.
    if (fn_name %in% c("::", ":::")) {
      pkg <- as.character(args[[1]])
      sub <- as.character(args[[2]])
      bare <- as.call(c(as.symbol(sub), as.list(expr)[-1][-1]))
      # Reconstruct: f(arg1, arg2, ...)
      bare_call <- as.call(c(list(as.symbol(sub)), as.list(expr)[-c(1, 2)]))
      return(rec(bare_call))
    }
    .rgeo_unsupported(paste0("Unsupported function in formula: ", fn_name))
  }
  .rgeo_unsupported("Unsupported expression node")
}

# Parses an R expression string and translates to SQL. Returns the SQL string
# or signals .rgeo_unsupported.
.rgeo_formula_to_sql <- function(formula_text, columns, geom_col) {
  parsed <- tryCatch(parse(text = formula_text)[[1]],
                     error = function(e) .rgeo_unsupported(conditionMessage(e)))
  .rgeo_translate_expr(parsed, columns, geom_col)
}

# ---------- Tabular translator (data.frame / tibble / data.table) -----------

.rgeo_tabular_translator <- function() {
  list(
    preview = function(meta, body) {
      offset    <- as.integer(body$offset %||% 0L)
      limit     <- as.integer(body$limit %||% 500L)
      where     <- body$where  %||% NULL
      order_by  <- body$orderBy %||% meta$pk_column
      tn <- meta$table_name
      where_sql <- if (is.null(where) || !nzchar(where)) "" else paste0(" WHERE ", where)
      total <- DBI::dbGetQuery(meta$con,
        sprintf('SELECT COUNT(*) AS n FROM %s%s', .rgeo_qid(tn), where_sql))$n[1]
      df <- DBI::dbGetQuery(meta$con, sprintf(
        'SELECT * FROM %s%s ORDER BY %s LIMIT %d OFFSET %d',
        .rgeo_qid(tn), where_sql, .rgeo_qid(order_by), limit, offset))
      cols <- lapply(seq_along(df), function(i) {
        list(name = names(df)[i], type = class(df[[i]])[1])
      })
      rows <- lapply(seq_len(nrow(df)), function(i) {
        unname(lapply(df[i, , drop = FALSE], function(v) {
          v <- v[1]
          if (is.na(v)) NA else as.character(v)
        }))
      })
      list(success = TRUE, columns = cols, rows = rows,
           totalRows = as.numeric(total),
           pkColumn = meta$pk_column)
    },

    update_cell = function(meta, body) {
      row_id <- body$rowId
      col    <- body$column %||% stop("column required")
      val    <- body$value
      if (is.null(row_id)) stop("rowId required")
      sql <- sprintf('UPDATE %s SET %s = ? WHERE %s = ?',
                     .rgeo_qid(meta$table_name), .rgeo_qid(col),
                     .rgeo_qid(meta$pk_column))
      DBI::dbExecute(meta$con, sql, params = list(val, as.numeric(row_id)))
      list(success = TRUE)
    },

    add_column = function(meta, body) {
      new_col <- body$newColumn %||% stop("newColumn required")
      formula <- body$formula   %||% stop("formula required")
      cols_q  <- DBI::dbGetQuery(meta$con, sprintf(
        'SELECT * FROM %s LIMIT 0', .rgeo_qid(meta$table_name)))
      columns <- names(cols_q)
      sql_expr <- tryCatch(
        .rgeo_formula_to_sql(formula, columns, NA_character_),
        .rgeo_unsupported = function(e) NULL
      )
      if (!is.null(sql_expr)) {
        DBI::dbExecute(meta$con, sprintf(
          'ALTER TABLE %s ADD COLUMN %s', .rgeo_qid(meta$table_name),
          .rgeo_qid(new_col)))
        DBI::dbExecute(meta$con, sprintf(
          'UPDATE %s SET %s = %s', .rgeo_qid(meta$table_name),
          .rgeo_qid(new_col), sql_expr))
        return(list(success = TRUE, used_pushdown = TRUE))
      }
      # Fallback: collect, evaluate in R, write back.
      df <- DBI::dbReadTable(meta$con, meta$table_name)
      env <- list2env(df, parent = .GlobalEnv)
      val <- tryCatch(eval(parse(text = formula)[[1]], envir = env),
                      error = function(e) stop("Formula failed in R: ", conditionMessage(e)))
      if (length(val) == 1L) val <- rep(val, nrow(df))
      if (length(val) != nrow(df)) {
        stop(sprintf("Formula produced %d values for %d rows",
                     length(val), nrow(df)))
      }
      DBI::dbExecute(meta$con, sprintf(
        'ALTER TABLE %s ADD COLUMN %s', .rgeo_qid(meta$table_name),
        .rgeo_qid(new_col)))
      stage <- paste0("_addcol_", .rgeo_sanitize_id(meta$name))
      DBI::dbExecute(meta$con, sprintf('DROP TABLE IF EXISTS %s', .rgeo_qid(stage)))
      stage_df <- data.frame(
        `_rgeo_rowid` = df[[meta$pk_column]],
        new_value = val,
        check.names = FALSE,
        stringsAsFactors = FALSE
      )
      names(stage_df) <- c(meta$pk_column, new_col)
      DBI::dbWriteTable(meta$con, stage, stage_df, overwrite = TRUE)
      DBI::dbExecute(meta$con, sprintf(
        'UPDATE %1$s
            SET %2$s = (SELECT %2$s FROM %3$s WHERE %3$s.%4$s = %1$s.%4$s)',
        .rgeo_qid(meta$table_name),
        .rgeo_qid(new_col),
        .rgeo_qid(stage),
        .rgeo_qid(meta$pk_column)))
      DBI::dbExecute(meta$con, sprintf('DROP TABLE %s', .rgeo_qid(stage)))
      list(success = TRUE, used_pushdown = FALSE)
    },

    delete_rows = function(meta, body) {
      row_ids <- body$rowIds %||% stop("rowIds required")
      ids <- as.numeric(row_ids)
      if (length(ids) == 0L) return(list(success = TRUE, deleted = 0L))
      placeholders <- paste(rep("?", length(ids)), collapse = ", ")
      n <- DBI::dbExecute(meta$con, sprintf(
        'DELETE FROM %s WHERE %s IN (%s)',
        .rgeo_qid(meta$table_name), .rgeo_qid(meta$pk_column), placeholders),
        params = as.list(ids))
      DBI::dbExecute(meta$con,
        "UPDATE _rgeo_objects
            SET n_rows = (SELECT COUNT(*) FROM " %+% .rgeo_qid(meta$table_name) %+% ")
          WHERE name = ?", params = list(meta$name))
      list(success = TRUE, deleted = as.integer(n))
    },

    rename_column = function(meta, body) {
      old <- body$oldName %||% stop("oldName required")
      new_ <- body$newName %||% stop("newName required")
      DBI::dbExecute(meta$con, sprintf(
        'ALTER TABLE %s RENAME COLUMN %s TO %s',
        .rgeo_qid(meta$table_name), .rgeo_qid(old), .rgeo_qid(new_)))
      list(success = TRUE)
    },

    delete_column = function(meta, body) {
      col <- body$column %||% stop("column required")
      DBI::dbExecute(meta$con, sprintf(
        'ALTER TABLE %s DROP COLUMN %s',
        .rgeo_qid(meta$table_name), .rgeo_qid(col)))
      list(success = TRUE)
    },

    collect = function(meta, body) {
      var_name <- body$varName %||% paste0(meta$name, "_local")
      where    <- body$where %||% NULL
      cols     <- body$columns %||% NULL
      sel <- if (is.null(cols) || length(cols) == 0L) "*"
             else paste(vapply(cols, .rgeo_qid, character(1)), collapse = ", ")
      where_sql <- if (is.null(where) || !nzchar(where)) "" else paste0(" WHERE ", where)
      df <- DBI::dbGetQuery(meta$con, sprintf(
        'SELECT %s FROM %s%s', sel, .rgeo_qid(meta$table_name), where_sql))
      assign(var_name, df, envir = .GlobalEnv)
      list(success = TRUE, varName = var_name, kind = meta$kind, nRows = nrow(df))
    },

    bbox = function(meta, body) {
      list(success = TRUE, bbox = NULL)
    },

    spatial_tile = function(meta, body) {
      stop("spatial_tile not supported on tabular dataset")
    },

    update_geometry = function(meta, body) {
      stop("update_geometry not supported on tabular dataset")
    }
  )
}

# String concat helper used in delete_rows count update SQL.
`%+%` <- function(a, b) paste0(a, b)

# ---------- sf translator (sf / geos with native GEOMETRY column) -----------

.rgeo_sf_translator <- function() {
  base <- .rgeo_tabular_translator()
  list(
    preview = function(meta, body) {
      # Hide the native geometry column from the table preview; show a
      # WKT summary instead so the data viewer can render something.
      offset   <- as.integer(body$offset %||% 0L)
      limit    <- as.integer(body$limit %||% 500L)
      order_by <- body$orderBy %||% meta$pk_column
      gc <- meta$geometry_column
      total <- DBI::dbGetQuery(meta$con,
        sprintf('SELECT COUNT(*) AS n FROM %s', .rgeo_qid(meta$table_name)))$n[1]
      # Hide the internal curve companion column from the grid.
      exclude <- if (.rgeo_has_col(meta$con, meta$table_name, "_rgeo_wkt_true")) {
        paste0(.rgeo_qid(gc), ", ", .rgeo_qid("_rgeo_wkt_true"))
      } else {
        .rgeo_qid(gc)
      }
      df <- DBI::dbGetQuery(meta$con, sprintf(
        'SELECT * EXCLUDE (%s),
                ST_AsText(%s) AS %s
           FROM %s ORDER BY %s LIMIT %d OFFSET %d',
        exclude, .rgeo_qid(gc), .rgeo_qid(gc),
        .rgeo_qid(meta$table_name), .rgeo_qid(order_by), limit, offset))
      cols <- lapply(seq_along(df), function(i) {
        list(name = names(df)[i], type = class(df[[i]])[1])
      })
      rows <- lapply(seq_len(nrow(df)), function(i) {
        unname(lapply(df[i, , drop = FALSE], function(v) {
          v <- v[1]
          if (is.na(v)) NA else as.character(v)
        }))
      })
      list(success = TRUE, columns = cols, rows = rows,
           totalRows = as.numeric(total),
           pkColumn = meta$pk_column,
           geometryColumn = gc)
    },

    update_cell      = base$update_cell,
    delete_rows      = base$delete_rows,
    rename_column    = base$rename_column,
    delete_column    = base$delete_column,

    add_column = function(meta, body) {
      new_col <- body$newColumn %||% stop("newColumn required")
      formula <- body$formula   %||% stop("formula required")
      cols_q  <- DBI::dbGetQuery(meta$con, sprintf(
        'SELECT * FROM %s LIMIT 0', .rgeo_qid(meta$table_name)))
      columns <- setdiff(names(cols_q), meta$geometry_column)
      sql_expr <- tryCatch(
        .rgeo_formula_to_sql(formula, columns, meta$geometry_column),
        .rgeo_unsupported = function(e) NULL
      )
      if (!is.null(sql_expr)) {
        DBI::dbExecute(meta$con, sprintf(
          'ALTER TABLE %s ADD COLUMN %s', .rgeo_qid(meta$table_name),
          .rgeo_qid(new_col)))
        DBI::dbExecute(meta$con, sprintf(
          'UPDATE %s SET %s = %s', .rgeo_qid(meta$table_name),
          .rgeo_qid(new_col), sql_expr))
        return(list(success = TRUE, used_pushdown = TRUE))
      }
      # Fallback for sf: collect to a sf object, evaluate formula, write back
      # one column.
      obj <- .rgeo_load_sf_from_table(meta$con, meta$name, as_geos = FALSE)
      env <- list2env(as.list(sf::st_drop_geometry(obj)), parent = .GlobalEnv)
      env[[meta$geometry_column]] <- sf::st_geometry(obj)
      val <- tryCatch(eval(parse(text = formula)[[1]], envir = env),
                      error = function(e) stop("Formula failed in R: ", conditionMessage(e)))
      if (length(val) == 1L) val <- rep(val, nrow(obj))
      if (length(val) != nrow(obj)) {
        stop(sprintf("Formula produced %d values for %d rows",
                     length(val), nrow(obj)))
      }
      DBI::dbExecute(meta$con, sprintf(
        'ALTER TABLE %s ADD COLUMN %s', .rgeo_qid(meta$table_name),
        .rgeo_qid(new_col)))
      pk_vals <- DBI::dbGetQuery(meta$con, sprintf(
        'SELECT %s FROM %s ORDER BY %s',
        .rgeo_qid(meta$pk_column), .rgeo_qid(meta$table_name),
        .rgeo_qid(meta$pk_column)))[[1]]
      stage <- paste0("_addcol_", .rgeo_sanitize_id(meta$name))
      DBI::dbExecute(meta$con, sprintf('DROP TABLE IF EXISTS %s', .rgeo_qid(stage)))
      stage_df <- data.frame(pk_vals, val, stringsAsFactors = FALSE)
      names(stage_df) <- c(meta$pk_column, new_col)
      DBI::dbWriteTable(meta$con, stage, stage_df, overwrite = TRUE)
      DBI::dbExecute(meta$con, sprintf(
        'UPDATE %1$s
            SET %2$s = (SELECT %2$s FROM %3$s WHERE %3$s.%4$s = %1$s.%4$s)',
        .rgeo_qid(meta$table_name),
        .rgeo_qid(new_col),
        .rgeo_qid(stage),
        .rgeo_qid(meta$pk_column)))
      DBI::dbExecute(meta$con, sprintf('DROP TABLE %s', .rgeo_qid(stage)))
      list(success = TRUE, used_pushdown = FALSE)
    },

    spatial_tile = function(meta, body) {
      bbox  <- body$bbox %||% stop("bbox required (lon/lat: minx, miny, maxx, maxy)")
      zoom  <- as.numeric(body$zoom %||% 10)
      limit <- as.integer(body$limit %||% 5000L)
      gc    <- meta$geometry_column
      tn    <- meta$table_name
      # Pick a simplification tolerance based on zoom (in degrees, then we
      # transform back into native CRS units via ST_Simplify on transformed
      # geometry). At zoom >= 14, no simplification.
      tol <- if (zoom >= 14) 0
             else if (zoom >= 11) 0.0001
             else if (zoom >= 8)  0.001
             else if (zoom >= 5)  0.01
             else                  0.05
      crs <- meta$crs
      has_crs <- !is.na(crs) && nzchar(crs)
      transform_in <- if (has_crs) {
        sprintf('ST_Transform(ST_MakeEnvelope(?,?,?,?), \'EPSG:4326\', %s, true)',
                paste0("'", gsub("'", "''", crs, fixed = TRUE), "'"))
      } else {
        'ST_MakeEnvelope(?,?,?,?)'
      }
      transform_out <- if (has_crs) {
        sprintf('ST_Transform(%s, %s, \'EPSG:4326\', true)',
                if (tol > 0) sprintf('ST_Simplify(%s, %f)', .rgeo_qid(gc), tol)
                else .rgeo_qid(gc),
                paste0("'", gsub("'", "''", crs, fixed = TRUE), "'"))
      } else {
        if (tol > 0) sprintf('ST_Simplify(%s, %f)', .rgeo_qid(gc), tol)
        else .rgeo_qid(gc)
      }
      # Keep the internal curve companion column out of feature properties.
      exclude <- if (.rgeo_has_col(meta$con, tn, "_rgeo_wkt_true")) {
        paste0(.rgeo_qid(gc), ", ", .rgeo_qid("_rgeo_wkt_true"))
      } else {
        .rgeo_qid(gc)
      }
      sql <- sprintf(
        'SELECT * EXCLUDE (%s),
                ST_AsGeoJSON(%s) AS _geojson
           FROM %s
          WHERE ST_Intersects(%s, %s)
          LIMIT %d',
        exclude, transform_out, .rgeo_qid(tn),
        .rgeo_qid(gc), transform_in, limit + 1L)
      params <- list(bbox[[1]], bbox[[2]], bbox[[3]], bbox[[4]])
      res <- tryCatch(
        DBI::dbGetQuery(meta$con, sql, params = params),
        error = function(e) {
          # Fallback without simplification or transform if the spatial fn
          # signature isn't supported on this build.
          stop("spatial_tile failed: ", conditionMessage(e))
        }
      )
      truncated <- nrow(res) > limit
      if (truncated) res <- res[seq_len(limit), , drop = FALSE]
      features <- lapply(seq_len(nrow(res)), function(i) {
        gj <- res$`_geojson`[i]
        if (is.na(gj) || !nzchar(gj)) return(NULL)
        geom_obj <- tryCatch(fromJSON(gj, simplifyVector = FALSE),
                             error = function(e) NULL)
        if (is.null(geom_obj)) return(NULL)
        props <- as.list(res[i, setdiff(names(res), "_geojson"), drop = FALSE])
        list(type = "Feature", geometry = geom_obj, properties = props)
      })
      features <- Filter(Negate(is.null), features)
      list(success = TRUE,
           geojson = list(type = "FeatureCollection", features = features),
           truncated = truncated)
    },

    update_geometry = function(meta, body) {
      edits <- body$edits %||% stop("edits required (list of {rowId, wkt})")
      if (length(edits) == 0L) return(list(success = TRUE, applied = 0L))
      gc <- meta$geometry_column
      tn <- meta$table_name

      # Curve support: DuckDB's GEOMETRY type cannot hold OGC curves, so the
      # geometry column stores the linearized `wkt` while the exact curved
      # WKT (`wktTrue`, same CRS) lives in the `_rgeo_wkt_true` companion
      # column. The column is created on first curved edit; straight edits
      # then write NULL to clear any stale curve for that row.
      wants_true <- any(vapply(edits, function(e) {
        wt <- e$wktTrue
        !is.null(wt) && nzchar(wt)
      }, logical(1)))
      has_true <- .rgeo_has_col(meta$con, tn, "_rgeo_wkt_true")
      if (wants_true && !has_true) {
        DBI::dbExecute(meta$con, sprintf(
          'ALTER TABLE %s ADD COLUMN %s VARCHAR',
          .rgeo_qid(tn), .rgeo_qid("_rgeo_wkt_true")))
        has_true <- TRUE
      }

      # Explicit CAST is required: DuckDB types `?` placeholders during prepare
      # (before bind), so `ST_GeomFromText(?)` fails with "requires a string
      # argument" because the planner can't see a VARCHAR yet. CAST forces the
      # placeholder to VARCHAR before the function dispatch.
      sql <- if (has_true) {
        sprintf(
          'UPDATE %s SET %s = ST_GeomFromText(CAST(? AS VARCHAR)), %s = ? WHERE %s = ?',
          .rgeo_qid(tn), .rgeo_qid(gc), .rgeo_qid("_rgeo_wkt_true"),
          .rgeo_qid(meta$pk_column))
      } else {
        sprintf(
          'UPDATE %s SET %s = ST_GeomFromText(CAST(? AS VARCHAR)) WHERE %s = ?',
          .rgeo_qid(tn), .rgeo_qid(gc), .rgeo_qid(meta$pk_column))
      }

      # DuckDB's spatial RTREE is only maintained on INSERT/DELETE — UPDATEs
      # leave stale entries that ST_Intersects then uses, returning no rows
      # for the affected viewport. Drop the index for the batch and rebuild
      # afterwards so subsequent tile queries see consistent results.
      idx_name <- paste0(tn, "_geom_idx")
      had_index <- tryCatch({
        DBI::dbExecute(meta$con, sprintf(
          'DROP INDEX IF EXISTS %s', .rgeo_qid(idx_name)))
        TRUE
      }, error = function(e) FALSE)

      DBI::dbBegin(meta$con)
      applied <- 0L
      tryCatch({
        for (ed in edits) {
          row_id <- ed$rowId
          wkt    <- ed$wkt
          if (is.null(row_id) || is.null(wkt)) next
          params <- if (has_true) {
            wt <- ed$wktTrue
            list(as.character(wkt),
                 if (is.null(wt) || !nzchar(wt)) NA_character_ else as.character(wt),
                 as.numeric(row_id))
          } else {
            list(as.character(wkt), as.numeric(row_id))
          }
          DBI::dbExecute(meta$con, sql, params = params)
          applied <- applied + 1L
        }
        DBI::dbCommit(meta$con)
      }, error = function(e) {
        tryCatch(DBI::dbRollback(meta$con), error = function(e2) NULL)
        # Re-raise after attempting to restore the index so a later retry
        # isn't running without spatial acceleration.
        if (had_index) {
          tryCatch(DBI::dbExecute(meta$con, sprintf(
            'CREATE INDEX %s ON %s USING RTREE (%s)',
            .rgeo_qid(idx_name), .rgeo_qid(tn), .rgeo_qid(gc))),
            error = function(e2) NULL)
        }
        stop(e)
      })

      if (had_index) {
        tryCatch(DBI::dbExecute(meta$con, sprintf(
          'CREATE INDEX %s ON %s USING RTREE (%s)',
          .rgeo_qid(idx_name), .rgeo_qid(tn), .rgeo_qid(gc))),
          error = function(e) NULL)
      }

      .rgeo_refresh_bbox(meta$con, meta$name, tn, gc)
      list(success = TRUE, applied = applied)
    },

    # True (curve-preserving) WKT for one row, delivered in WGS84 for the
    # drawing surface — from the `_rgeo_wkt_true` companion column when the
    # row is curved, otherwise the linearized geometry.
    row_wkt = function(meta, body) {
      row_id <- body$rowId %||% stop("rowId required")
      tn <- meta$table_name
      gc <- meta$geometry_column
      crs <- meta$crs
      has_crs <- !is.na(crs) && nzchar(crs)

      if (.rgeo_has_col(meta$con, tn, "_rgeo_wkt_true")) {
        r <- DBI::dbGetQuery(meta$con, sprintf(
          'SELECT %s AS w FROM %s WHERE %s = ?',
          .rgeo_qid("_rgeo_wkt_true"), .rgeo_qid(tn), .rgeo_qid(meta$pk_column)),
          params = list(as.numeric(row_id)))
        if (nrow(r) == 1L && !is.na(r$w[1]) && nzchar(r$w[1])) {
          wkt <- r$w[1]
          if (has_crs && requireNamespace("sf", quietly = TRUE)) {
            g <- tryCatch(sf::st_as_sfc(wkt, crs = crs), error = function(e) NULL)
            if (!is.null(g) && !isTRUE(sf::st_crs(g) == sf::st_crs(4326L))) {
              wkt <- sf::st_as_text(sf::st_transform(g, 4326L)[[1L]])
            }
          }
          return(list(success = TRUE, wkt = wkt, hasCurve = TRUE))
        }
      }

      geom_expr <- if (has_crs) {
        sprintf("ST_AsText(ST_Transform(%s, %s, 'EPSG:4326', true))",
                .rgeo_qid(gc),
                paste0("'", gsub("'", "''", crs, fixed = TRUE), "'"))
      } else {
        sprintf('ST_AsText(%s)', .rgeo_qid(gc))
      }
      r <- DBI::dbGetQuery(meta$con, sprintf(
        'SELECT %s AS w FROM %s WHERE %s = ?',
        geom_expr, .rgeo_qid(tn), .rgeo_qid(meta$pk_column)),
        params = list(as.numeric(row_id)))
      if (nrow(r) == 0L || is.na(r$w[1])) stop("row not found: ", row_id)
      list(success = TRUE, wkt = r$w[1], hasCurve = FALSE)
    },

    collect = function(meta, body) {
      var_name <- body$varName %||% paste0(meta$name, "_local")
      obj <- .rgeo_materialize_sf(meta, bbox = body$bbox, where = body$where)
      assign(var_name, obj, envir = .GlobalEnv)
      n_rows <- if (inherits(obj, "sf")) nrow(obj) else length(obj)
      list(success = TRUE, varName = var_name, kind = meta$kind, nRows = n_rows)
    },

    bbox = function(meta, body) {
      vals <- meta$bbox
      if (any(is.na(vals))) {
        .rgeo_refresh_bbox(meta$con, meta$name, meta$table_name, meta$geometry_column)
        meta2 <- .rgeo_make_meta(meta$handle, meta$name)
        vals <- meta2$bbox
      }
      list(success = TRUE,
           bbox = if (any(is.na(vals))) NULL else as.numeric(vals),
           crs  = if (is.na(meta$crs)) NULL else meta$crs)
    }
  )
}

# ---------- Materialize fallback (raster, image, rds, legacy serialized) ----
# This translator ALWAYS materialises a copy into the environment, then
# performs the requested op on the in-memory object. The cost: full load
# every time. The benefit: every existing op keeps working.

.rgeo_materialize_translator <- function() {
  list(
    preview = function(meta, body) {
      stop("Preview not available for kind=", meta$kind,
           "; use 'Load to environment' instead.")
    },
    update_cell = function(meta, body) stop("Cells are not editable for ", meta$kind),
    add_column  = function(meta, body) stop("add_column not supported for ", meta$kind),
    delete_rows = function(meta, body) stop("delete_rows not supported for ", meta$kind),
    rename_column = function(meta, body) stop("rename_column not supported for ", meta$kind),
    delete_column = function(meta, body) stop("delete_column not supported for ", meta$kind),
    spatial_tile = function(meta, body) stop("spatial_tile not supported for ", meta$kind),
    update_geometry = function(meta, body) stop("update_geometry not supported for ", meta$kind),
    bbox = function(meta, body) {
      list(success = TRUE,
           bbox = if (any(is.na(meta$bbox))) NULL else as.numeric(meta$bbox),
           crs  = if (is.na(meta$crs)) NULL else meta$crs)
    },
    collect = function(meta, body) {
      # Defer to existing connect-object machinery in 'load' mode.
      var_name <- body$varName %||% paste0(meta$name, "_local")
      .rgeo_load_into_env(meta$con, meta$name, var_name)
      list(success = TRUE, varName = var_name, kind = meta$kind)
    }
  )
}

# Helper used by the materialize translator. Reproduces the load-mode code
# generation in handle_db_connect_object, but as a direct call rather than
# code emission — useful when the translator needs a copy in the env.
.rgeo_load_into_env <- function(con, name, var_name) {
  row <- .rgeo_obj_row(con, name)
  if (is.null(row)) stop("Object not found: ", name)
  kind <- row$kind[1]
  if (kind %in% c("data.frame", "tibble", "data.table")) {
    df <- DBI::dbReadTable(con, row$table_name[1])
    obj <- switch(kind,
      "tibble"     = if (requireNamespace("tibble", quietly = TRUE)) tibble::as_tibble(df) else df,
      "data.table" = if (requireNamespace("data.table", quietly = TRUE)) data.table::as.data.table(df) else df,
      df)
  } else if (kind %in% c("sf", "geos")) {
    fmt <- row$spatial_format[1]
    if (!is.na(fmt) && fmt == "duckdb_geometry") {
      obj <- .rgeo_load_sf_from_table(con, name, as_geos = (kind == "geos"))
    } else {
      blob <- DBI::dbGetQuery(con,
        "SELECT data FROM _rgeo_objects WHERE name = ?",
        params = list(name))$data[[1]]
      obj <- .rgeo_unserialize_rds(blob)
    }
  } else if (kind == "raster") {
    blob <- DBI::dbGetQuery(con,
      "SELECT data FROM _rgeo_rasters WHERE name = ?",
      params = list(name))$data[[1]]
    obj <- .rgeo_unserialize_rds(blob)
    if (inherits(obj, "PackedSpatRaster") && requireNamespace("terra", quietly = TRUE)) {
      obj <- terra::unwrap(obj)
    }
  } else if (kind == "image") {
    blob <- DBI::dbGetQuery(con,
      "SELECT data FROM _rgeo_images WHERE name = ?",
      params = list(name))$data[[1]]
    obj <- .rgeo_unserialize_rds(blob)
  } else if (kind == "rds") {
    blob <- DBI::dbGetQuery(con,
      "SELECT data FROM _rgeo_objects WHERE name = ?",
      params = list(name))$data[[1]]
    obj <- .rgeo_unserialize_rds(blob)
  } else {
    stop("Unsupported kind: ", kind)
  }
  assign(var_name, obj, envir = .GlobalEnv)
  invisible(obj)
}

# ---------- Dispatcher ------------------------------------------------------

.rgeo_translator_for <- function(kind, spatial_format) {
  if (kind %in% c("data.frame", "tibble", "data.table")) return(.rgeo_tabular_translator())
  if (kind %in% c("sf", "geos")) {
    if (!is.na(spatial_format) && spatial_format == "duckdb_geometry") {
      return(.rgeo_sf_translator())
    }
    return(.rgeo_materialize_translator())
  }
  if (kind == "raster" && !is.na(spatial_format) && spatial_format == "rgeo_pyramid") {
    return(.rgeo_raster_translator())
  }
  .rgeo_materialize_translator()
}

# ---------- Endpoint glue ---------------------------------------------------

.rgeo_dispatch <- function(op, body) {
  handle <- body$handle %||% stop("handle required")
  name   <- body$name   %||% stop("name required")
  tryCatch({
    meta <- .rgeo_make_meta(handle, name)
    translator <- .rgeo_translator_for(meta$kind, meta$spatial_format)
    fn <- translator[[op]]
    if (is.null(fn)) return(error_response(paste0("Operation not supported: ", op)))
    .rgeo_load_spatial_ext(meta$con, handle)
    res <- fn(meta, body)
    DBI::dbExecute(meta$con, "UPDATE _rgeo_meta SET last_modified = current_timestamp")
    json_response(res)
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_dataset_preview        <- function(body) .rgeo_dispatch("preview", body)
handle_dataset_update_cell    <- function(body) .rgeo_dispatch("update_cell", body)
handle_dataset_add_column     <- function(body) .rgeo_dispatch("add_column", body)
handle_dataset_delete_rows    <- function(body) .rgeo_dispatch("delete_rows", body)
handle_dataset_rename_column  <- function(body) .rgeo_dispatch("rename_column", body)
handle_dataset_delete_column  <- function(body) .rgeo_dispatch("delete_column", body)
handle_dataset_spatial_tile   <- function(body) .rgeo_dispatch("spatial_tile", body)
handle_dataset_update_geometry<- function(body) .rgeo_dispatch("update_geometry", body)
handle_dataset_row_wkt        <- function(body) .rgeo_dispatch("row_wkt", body)
handle_dataset_collect        <- function(body) .rgeo_dispatch("collect", body)
handle_dataset_bbox           <- function(body) .rgeo_dispatch("bbox", body)

