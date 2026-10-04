# Rgeo/DuckDB: schema, connection, and spatial-table helpers
# (extracted from server.R — behavior-preserving modularization)
#
# Format v3 adds tiled raster storage (_rgeo_raster_meta + _rgeo_raster_tiles,
# see db-raster.R) replacing the whole-object BLOBs in _rgeo_rasters. Legacy
# BLOBs stay readable and upgrade lazily on first access.

.rgeo_format_version <- 3L

.rgeo_recents_path <- function() {
  d <- tools::R_user_dir("ouRGeo", "data")
  if (!dir.exists(d)) dir.create(d, recursive = TRUE, showWarnings = FALSE)
  file.path(d, "rgeo_recents.json")
}

.rgeo_sanitize_id <- function(name) {
  s <- gsub("[^A-Za-z0-9_]", "_", name)
  if (!grepl("^[A-Za-z_]", s)) s <- paste0("t_", s)
  s
}

.rgeo_require_db_pkgs <- function() {
  for (p in c("DBI", "duckdb", "dplyr")) {
    if (!requireNamespace(p, quietly = TRUE)) {
      stop("Required package not installed: ", p)
    }
  }
}

.rgeo_init_schema <- function(con) {
  DBI::dbExecute(con, "
    CREATE TABLE IF NOT EXISTS _rgeo_meta (
      format_version INTEGER,
      created_at TIMESTAMP,
      last_modified TIMESTAMP,
      app_version VARCHAR
    )
  ")
  DBI::dbExecute(con, "
    CREATE TABLE IF NOT EXISTS _rgeo_objects (
      name VARCHAR PRIMARY KEY,
      kind VARCHAR,
      geometry_type VARCHAR,
      crs VARCHAR,
      n_rows BIGINT,
      size_bytes BIGINT,
      notes VARCHAR,
      created_at TIMESTAMP,
      table_name VARCHAR,
      data BLOB,
      r_class VARCHAR,
      pk_column VARCHAR,
      geometry_column VARCHAR,
      bbox_minx DOUBLE,
      bbox_miny DOUBLE,
      bbox_maxx DOUBLE,
      bbox_maxy DOUBLE,
      spatial_format VARCHAR,
      has_spatial_index BOOLEAN,
      editable BOOLEAN,
      format_version INTEGER
    )
  ")
  # Backfill columns added in newer format versions. Each ALTER is best-effort
  # so opening an old DB never fails just because a column is missing.
  .rgeo_alter_add <- function(col, type) {
    has_col <- tryCatch(
      nrow(DBI::dbGetQuery(con, sprintf(
        "SELECT column_name FROM information_schema.columns
          WHERE table_name = '_rgeo_objects' AND column_name = '%s'", col))) > 0,
      error = function(e) FALSE
    )
    if (!has_col) {
      tryCatch(
        DBI::dbExecute(con, sprintf(
          'ALTER TABLE _rgeo_objects ADD COLUMN %s %s', col, type)),
        error = function(e) NULL
      )
    }
  }
  .rgeo_alter_add("r_class",           "VARCHAR")
  .rgeo_alter_add("pk_column",         "VARCHAR")
  .rgeo_alter_add("geometry_column",   "VARCHAR")
  .rgeo_alter_add("bbox_minx",         "DOUBLE")
  .rgeo_alter_add("bbox_miny",         "DOUBLE")
  .rgeo_alter_add("bbox_maxx",         "DOUBLE")
  .rgeo_alter_add("bbox_maxy",         "DOUBLE")
  .rgeo_alter_add("spatial_format",    "VARCHAR")
  .rgeo_alter_add("has_spatial_index", "BOOLEAN")
  .rgeo_alter_add("editable",          "BOOLEAN")
  .rgeo_alter_add("format_version",    "INTEGER")
  DBI::dbExecute(con, "
    CREATE TABLE IF NOT EXISTS _rgeo_rasters (
      name VARCHAR PRIMARY KEY,
      data BLOB,
      crs VARCHAR,
      xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE,
      nrow BIGINT, ncol BIGINT, nbands INTEGER,
      dtype VARCHAR
    )
  ")
  DBI::dbExecute(con, "
    CREATE TABLE IF NOT EXISTS _rgeo_images (
      name VARCHAR PRIMARY KEY,
      data BLOB,
      format VARCHAR,
      width BIGINT, height BIGINT
    )
  ")
  # Format v3: tiled raster pyramid (GeoPackage-style block storage).
  DBI::dbExecute(con, "
    CREATE TABLE IF NOT EXISTS _rgeo_raster_meta (
      name VARCHAR PRIMARY KEY,
      crs VARCHAR,
      xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE,
      nrow BIGINT, ncol BIGINT, nbands INTEGER,
      dtype VARCHAR,
      nodata DOUBLE,
      block_size INTEGER,
      n_levels INTEGER,
      band_names VARCHAR,
      band_stats VARCHAR,
      categories VARCHAR,
      compression VARCHAR,
      created_at TIMESTAMP
    )
  ")
  DBI::dbExecute(con, "
    CREATE TABLE IF NOT EXISTS _rgeo_raster_tiles (
      name VARCHAR NOT NULL,
      level INTEGER NOT NULL,
      brow INTEGER NOT NULL,
      bcol INTEGER NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (name, level, brow, bcol)
    )
  ")
}

.rgeo_seed_meta <- function(con) {
  has_row <- DBI::dbGetQuery(con, "SELECT count(*) AS n FROM _rgeo_meta")$n > 0
  if (!has_row) {
    DBI::dbExecute(con, sprintf(
      "INSERT INTO _rgeo_meta VALUES (%d, current_timestamp, current_timestamp, '%s')",
      .rgeo_format_version, "ouRGeo"
    ))
  }
}

.rgeo_get_con <- function(handle) {
  entry <- .ourgeo_env$db_conns[[handle]]
  if (is.null(entry)) stop("Unknown database handle: ", handle)
  entry$con
}

# Install + load the DuckDB spatial extension on a connection. Idempotent;
# caches a flag on the .ourgeo_env$db_conns entry so we only run it once.
# Returns TRUE if the extension is available, FALSE otherwise.
.rgeo_load_spatial_ext <- function(con, handle = NULL) {
  if (!is.null(handle)) {
    entry <- .ourgeo_env$db_conns[[handle]]
    if (!is.null(entry) && isTRUE(entry$spatial_loaded)) return(TRUE)
  }
  ok <- tryCatch({
    DBI::dbExecute(con, "INSTALL spatial")
    DBI::dbExecute(con, "LOAD spatial")
    TRUE
  }, error = function(e) FALSE)
  if (!is.null(handle) && ok) {
    .ourgeo_env$db_conns[[handle]]$spatial_loaded <- TRUE
  }
  ok
}

# Compute and persist the bbox of a native-geometry table on _rgeo_objects.
.rgeo_refresh_bbox <- function(con, name, table_name, geom_col = "geometry") {
  res <- tryCatch(
    DBI::dbGetQuery(con, sprintf(
      'SELECT
         min(ST_XMin(%1$s)) AS minx,
         min(ST_YMin(%1$s)) AS miny,
         max(ST_XMax(%1$s)) AS maxx,
         max(ST_YMax(%1$s)) AS maxy
       FROM "%2$s"', geom_col, table_name)),
    error = function(e) NULL
  )
  if (is.null(res) || nrow(res) == 0) return(invisible(NULL))
  DBI::dbExecute(con,
    "UPDATE _rgeo_objects
       SET bbox_minx = ?, bbox_miny = ?, bbox_maxx = ?, bbox_maxy = ?
     WHERE name = ?",
    params = list(
      if (is.na(res$minx[1])) NA_real_ else res$minx[1],
      if (is.na(res$miny[1])) NA_real_ else res$miny[1],
      if (is.na(res$maxx[1])) NA_real_ else res$maxx[1],
      if (is.na(res$maxy[1])) NA_real_ else res$maxy[1],
      name))
  invisible(NULL)
}

.rgeo_serialize_rds <- function(obj) {
  con <- rawConnection(raw(0), open = "wb")
  on.exit(close(con))
  saveRDS(obj, con)
  rawConnectionValue(con)
}

.rgeo_unserialize_rds <- function(blob) {
  con <- rawConnection(blob, open = "rb")
  on.exit(close(con))
  readRDS(con)
}

.rgeo_detect_kind <- function(obj) {
  if (inherits(obj, "sf"))                         return("sf")
  if (inherits(obj, "geos_geometry"))              return("geos")
  if (inherits(obj, "data.table"))                 return("data.table")
  if (inherits(obj, "tbl_df"))                     return("tibble")
  if (is.data.frame(obj))                          return("data.frame")
  if (inherits(obj, c("SpatRaster", "RasterLayer",
                       "RasterStack", "RasterBrick"))) return("raster")
  if (inherits(obj, c("magick-image", "raster",
                       "nativeRaster")))          return("image")
  return("rds")
}

.rgeo_geom_type <- function(obj) {
  if (inherits(obj, "sf") && requireNamespace("sf", quietly = TRUE)) {
    types <- tryCatch(unique(as.character(sf::st_geometry_type(obj))),
                      error = function(e) NULL)
    if (!is.null(types)) return(paste(types, collapse = ", "))
  }
  if (inherits(obj, "sfc") && requireNamespace("sf", quietly = TRUE)) {
    types <- tryCatch(unique(as.character(sf::st_geometry_type(obj))),
                      error = function(e) NULL)
    if (!is.null(types)) return(paste(types, collapse = ", "))
  }
  NA_character_
}

.rgeo_crs <- function(obj) {
  if (inherits(obj, c("sf", "sfc")) && requireNamespace("sf", quietly = TRUE)) {
    crs <- tryCatch(sf::st_crs(obj), error = function(e) NULL)
    if (!is.null(crs) && !is.na(crs)) return(crs$input)
  }
  if (inherits(obj, "SpatRaster") && requireNamespace("terra", quietly = TRUE)) {
    return(tryCatch(terra::crs(obj, proj = TRUE), error = function(e) NA_character_))
  }
  NA_character_
}

.rgeo_obj_row <- function(con, name) {
  q <- DBI::dbGetQuery(
    con,
    "SELECT name, kind, geometry_type, crs, n_rows, size_bytes, notes,
            table_name, r_class, pk_column, geometry_column,
            bbox_minx, bbox_miny, bbox_maxx, bbox_maxy,
            spatial_format, has_spatial_index, editable, format_version
       FROM _rgeo_objects WHERE name = ?",
    params = list(name)
  )
  if (nrow(q) == 0) return(NULL)
  q
}

# Build a native-geometry DuckDB table for an sf/geos object — the table has
# a synthetic _rgeo_rowid PK, all attribute columns, and a GEOMETRY column
# (DuckDB spatial extension) plus an R-tree spatial index. Updates the
# _rgeo_objects metadata row in place. Returns the table name on success;
# raises an error if the spatial extension isn't available.
#
# `obj` must already be coerced to sf (caller handles geos -> sf).
# Does a table have a given column? (cheap LIMIT 0 probe)
.rgeo_has_col <- function(con, tn, col) {
  cols <- tryCatch(
    names(DBI::dbGetQuery(con, sprintf('SELECT * FROM %s LIMIT 0', .rgeo_qid(tn)))),
    error = function(e) character(0)
  )
  col %in% cols
}

# Re-apply true (curve-preserving) WKT from the `_rgeo_wkt_true` companion
# column onto a materialized geometry vector. DuckDB's GEOMETRY type cannot
# represent OGC curves (CIRCULARSTRING/COMPOUNDCURVE/...), so the geometry
# column holds a linearized copy for spatial indexing/queries while this
# column preserves the exact arcs, in the SAME CRS as the geometry column.
.rgeo_apply_true_wkt <- function(geom, true_wkt) {
  if (is.null(true_wkt)) return(geom)
  idx <- which(!is.na(true_wkt) & nzchar(true_wkt))
  if (length(idx) == 0L) return(geom)
  crs <- sf::st_crs(geom)
  gl <- unclass(geom)
  # Strip the sfc attributes: st_sfc() trusts a pre-existing bbox/n_empty on
  # its input list instead of recomputing, so stale values would survive.
  attributes(gl) <- NULL
  for (i in idx) {
    g <- tryCatch(sf::st_as_sfc(true_wkt[i], crs = crs)[[1L]],
                  error = function(e) NULL)
    if (!is.null(g)) gl[[i]] <- g
  }
  sf::st_sfc(gl, crs = crs)
}

.rgeo_write_native_geom_table <- function(con, name, obj, kind, handle = NULL) {
  if (!.rgeo_load_spatial_ext(con, handle)) {
    stop("DuckDB spatial extension is required for native geometry tables")
  }
  if (!requireNamespace("sf", quietly = TRUE))
    stop("sf package required")
  if (inherits(obj, "geos_geometry")) {
    obj <- sf::st_as_sf(data.frame(.id = seq_along(obj)),
                        geometry = sf::st_as_sfc(obj))
  }
  if (!inherits(obj, "sf")) stop("expected sf object")

  tn <- paste0("data_", .rgeo_sanitize_id(name))
  DBI::dbExecute(con, sprintf('DROP TABLE IF EXISTS "%s"', tn))

  # Curved geometry cannot enter DuckDB's GEOMETRY type — store a linearized
  # copy there (keeps spatial indexes/queries working) plus the exact curved
  # WKT in the `_rgeo_wkt_true` companion column (same CRS as the geometry).
  true_wkt <- NULL
  geom_types <- as.character(unique(sf::st_geometry_type(obj)))
  obj_has_curves <- any(grepl("CIRCULARSTRING|CURVE|SURFACE", geom_types))
  if (obj_has_curves) {
    if (!requireNamespace("sfarc", quietly = TRUE)) {
      stop("Object contains curved geometry; the 'sfarc' package is required ",
           "to store it in a database (curves are kept losslessly in a ",
           "companion column, linearized for spatial indexing)")
    }
    has <- sfarc::st_has_curve(sf::st_geometry(obj))
    true_wkt <- rep(NA_character_, nrow(obj))
    true_wkt[has] <- vapply(sf::st_geometry(obj)[has], sf::st_as_text, character(1))
    sf::st_geometry(obj) <- sfarc::st_linearize(sf::st_geometry(obj))
  }

  # Stage attributes in a temp table (regular DBI write), then INSERT into
  # the final table with the GEOMETRY column. This avoids fighting DuckDB
  # over typing the GEOMETRY column via dbWriteTable.
  attrs <- sf::st_drop_geometry(obj)
  geom_col <- attr(obj, "sf_column") %||% "geometry"
  if (geom_col %in% names(attrs)) {
    # Defensive: should never happen since st_drop_geometry removes it.
    attrs[[geom_col]] <- NULL
  }
  if (!is.null(true_wkt)) attrs[["_rgeo_wkt_true"]] <- true_wkt
  attrs[["_rgeo_rowid"]] <- seq_len(nrow(obj))
  attrs[["_rgeo_geom_wkb"]] <- sf::st_as_binary(sf::st_geometry(obj))

  stage <- paste0("_stage_", .rgeo_sanitize_id(name))
  DBI::dbExecute(con, sprintf('DROP TABLE IF EXISTS "%s"', stage))
  DBI::dbWriteTable(con, stage, attrs, overwrite = TRUE)

  # Build column lists for the final table (preserving attribute types via
  # CREATE TABLE AS SELECT) and then ALTER to add the GEOMETRY column.
  attr_cols <- setdiff(names(attrs), c("_rgeo_rowid", "_rgeo_geom_wkb"))
  attr_cols_q <- paste(sprintf('"%s"', attr_cols), collapse = ", ")
  if (length(attr_cols) == 0L) {
    DBI::dbExecute(con, sprintf(
      'CREATE TABLE "%s" AS
         SELECT "_rgeo_rowid", ST_GeomFromWKB("_rgeo_geom_wkb") AS geometry
           FROM "%s"', tn, stage))
  } else {
    DBI::dbExecute(con, sprintf(
      'CREATE TABLE "%s" AS
         SELECT "_rgeo_rowid", %s,
                ST_GeomFromWKB("_rgeo_geom_wkb") AS geometry
           FROM "%s"', tn, attr_cols_q, stage))
  }
  DBI::dbExecute(con, sprintf('DROP TABLE "%s"', stage))

  has_index <- tryCatch({
    DBI::dbExecute(con, sprintf(
      'CREATE INDEX "%s_geom_idx" ON "%s" USING RTREE (geometry)', tn, tn))
    TRUE
  }, error = function(e) FALSE)

  geom_type <- .rgeo_geom_type(obj)
  crs       <- .rgeo_crs(obj)
  n_rows    <- nrow(obj)

  DBI::dbExecute(con, "
    UPDATE _rgeo_objects
       SET kind              = ?,
           geometry_type     = ?,
           crs               = ?,
           n_rows            = ?,
           table_name        = ?,
           pk_column         = '_rgeo_rowid',
           geometry_column   = 'geometry',
           spatial_format    = 'duckdb_geometry',
           has_spatial_index = ?,
           editable          = TRUE,
           format_version    = ?
     WHERE name = ?",
    params = list(
      kind,
      if (is.na(geom_type)) NA else geom_type,
      if (is.na(crs)) NA else crs,
      n_rows, tn, has_index,
      .rgeo_format_version, name))

  .rgeo_refresh_bbox(con, name, tn, "geometry")
  tn
}

# Reconstruct an sf object from a native-geometry DuckDB table. Reads all
# attribute columns plus the geometry column (as WKB) in one query and wraps
# the result with sf::st_as_sf. CRS is restored from _rgeo_objects metadata.
# Used by the 'Load to environment' connect mode and by the materialize
# translator fallback. Returns an sf object (or sfc, if as_geos=TRUE).
# Build an in-memory sf (or geos) object from a meta record, optionally
# filtered to a bbox in WGS84 (xmin, ymin, xmax, ymax) and/or an extra
# WHERE clause. Shared by the sf-translator collect op and by the public
# rgeo_materialize() function below — keep these in lock-step.
.rgeo_materialize_sf <- function(meta, bbox = NULL, where = NULL, keep_identity = FALSE) {
  if (!requireNamespace("sf", quietly = TRUE)) stop("sf package required")
  gc <- meta$geometry_column
  if (is.na(gc) || !nzchar(gc)) {
    stop("Object has no geometry column: ", meta$name)
  }
  where_clauses <- character()
  params <- list()
  if (!is.null(where) && nzchar(where)) where_clauses <- c(where_clauses, where)
  if (!is.null(bbox) && length(bbox) == 4L) {
    crs <- meta$crs
    has_crs <- !is.na(crs) && nzchar(crs)
    env_sql <- if (has_crs) {
      sprintf("ST_Transform(ST_MakeEnvelope(?,?,?,?), 'EPSG:4326', %s, true)",
              paste0("'", gsub("'", "''", crs, fixed = TRUE), "'"))
    } else {
      "ST_MakeEnvelope(?,?,?,?)"
    }
    where_clauses <- c(where_clauses,
      sprintf("ST_Intersects(%s, %s)", .rgeo_qid(gc), env_sql))
    params <- c(params, list(bbox[[1]], bbox[[2]], bbox[[3]], bbox[[4]]))
  }
  where_sql <- if (length(where_clauses) > 0L) {
    paste0(" WHERE ", paste(where_clauses, collapse = " AND "))
  } else ""
  sql <- sprintf(
    'SELECT * EXCLUDE (%s), ST_AsText(%s) AS _rgeo_geom_wkt
       FROM %s%s',
    .rgeo_qid(gc), .rgeo_qid(gc), .rgeo_qid(meta$table_name), where_sql)
  # Preflight follows the same primary-key order as the existing table viewer.
  # Other materialisation callers retain their established representation.
  if (keep_identity) sql <- paste(sql, "ORDER BY", .rgeo_qid(meta$pk_column))
  df <- DBI::dbGetQuery(meta$con, sql, params = params)
  wkt <- df[["_rgeo_geom_wkt"]]
  df[["_rgeo_geom_wkt"]] <- NULL
  crs_val <- meta$crs
  geom <- if (!is.na(crs_val) && nzchar(crs_val)) {
    sf::st_as_sfc(wkt, crs = crs_val)
  } else {
    sf::st_as_sfc(wkt)
  }
  # Restore true curves from the companion column (geos objects cannot hold
  # curves, so those stay on the linearized geometry).
  if ("_rgeo_wkt_true" %in% names(df)) {
    if (meta$kind != "geos") {
      geom <- .rgeo_apply_true_wkt(geom, df[["_rgeo_wkt_true"]])
    }
    df[["_rgeo_wkt_true"]] <- NULL
  }
  pk <- meta$pk_column
  if (!keep_identity && !is.null(pk) && !is.na(pk) && pk %in% names(df)) df[[pk]] <- NULL
  obj <- if (ncol(df) == 0L) sf::st_sf(geometry = geom) else sf::st_sf(df, geometry = geom)
  if (keep_identity) attr(obj, "ourgeo_source_pk") <- pk
  if (!keep_identity && meta$kind == "geos" && requireNamespace("geos", quietly = TRUE)) {
    obj <- geos::as_geos_geometry(sf::st_geometry(obj))
  }
  obj
}

# Resolve a tbl_dbi back to its (handle, name) pair by matching its
# underlying DBI connection against .ourgeo_env$db_conns and looking up
# the storage table name in _rgeo_objects. Returns NULL when the input
# isn't a recognised Rgeo proxy — callers should treat that as "leave
# the value alone".
.rgeo_resolve_proxy <- function(x) {
  if (!inherits(x, "tbl_dbi")) return(NULL)
  con <- tryCatch(dbplyr::remote_con(x), error = function(e) NULL)
  if (is.null(con)) {
    src <- tryCatch(x$src, error = function(e) NULL)
    if (!is.null(src)) con <- src$con
  }
  if (is.null(con)) return(NULL)
  table_id <- tryCatch(as.character(dbplyr::remote_name(x)),
                       error = function(e) NA_character_)
  if (is.na(table_id) || !nzchar(table_id)) return(NULL)
  handle <- NULL
  for (h in names(.ourgeo_env$db_conns)) {
    entry <- .ourgeo_env$db_conns[[h]]
    if (!is.null(entry) && identical(entry$con, con)) { handle <- h; break }
  }
  if (is.null(handle)) return(NULL)
  row <- tryCatch(
    DBI::dbGetQuery(con,
      "SELECT name FROM _rgeo_objects WHERE table_name = ?",
      params = list(table_id)),
    error = function(e) NULL
  )
  if (is.null(row) || nrow(row) == 0L) return(NULL)
  list(handle = handle, name = row$name[1])
}

# Public helper: turn a database-backed proxy into an in-memory sf object.
# Generated tmap/ggplot code wraps connection-backed layers in this so
# they render the same way as native sf objects. Idempotent for non-proxy
# inputs (returns x unchanged), so it's safe to wrap unconditionally.
#   x    — usually a dplyr::tbl(con, "...") returned by /db/connect-object
#   bbox — numeric length-4 c(xmin, ymin, xmax, ymax) in WGS84; only
#          features intersecting this envelope are pulled.
#   where — optional extra SQL predicate appended with AND.
rgeo_materialize <- function(x, bbox = NULL, where = NULL) {
  proxy <- .rgeo_resolve_proxy(x)
  if (is.null(proxy)) return(x)
  meta <- .rgeo_make_meta(proxy$handle, proxy$name)
  if (meta$kind %in% c("sf", "geos") &&
      !is.na(meta$spatial_format) && meta$spatial_format == "duckdb_geometry") {
    return(.rgeo_materialize_sf(meta, bbox = bbox, where = where))
  }
  # Non-spatial or legacy-format proxy: fall back to a plain dplyr collect.
  dplyr::collect(x)
}

.rgeo_load_sf_from_table <- function(con, name, as_geos = FALSE) {
  if (!requireNamespace("sf", quietly = TRUE)) stop("sf package required")
  row <- .rgeo_obj_row(con, name)
  if (is.null(row)) stop("Object not found: ", name)
  tn       <- row$table_name[1]
  geom_col <- row$geometry_column[1]
  pk_col   <- row$pk_column[1]
  if (is.na(tn) || !nzchar(tn) || is.na(geom_col)) {
    stop("Layer has no native geometry table: ", name)
  }
  df <- DBI::dbGetQuery(con, sprintf(
    'SELECT * EXCLUDE ("%s"), ST_AsText("%s") AS "_rgeo_geom_wkt" FROM "%s"',
    geom_col, geom_col, tn))
  wkt <- df[["_rgeo_geom_wkt"]]
  df[["_rgeo_geom_wkt"]] <- NULL
  crs_val <- row$crs[1]
  geom <- if (!is.na(crs_val) && nzchar(crs_val)) {
    sf::st_as_sfc(wkt, crs = crs_val)
  } else {
    sf::st_as_sfc(wkt)
  }
  # Restore true curves from the companion column (skipped for geos — it
  # cannot represent curves).
  if ("_rgeo_wkt_true" %in% names(df)) {
    if (!as_geos) geom <- .rgeo_apply_true_wkt(geom, df[["_rgeo_wkt_true"]])
    df[["_rgeo_wkt_true"]] <- NULL
  }
  if (as_geos && requireNamespace("geos", quietly = TRUE)) {
    return(geos::as_geos_geometry(geom))
  }
  if (!is.na(pk_col) && pk_col %in% names(df)) {
    df[[pk_col]] <- NULL
  }
  if (ncol(df) == 0L) {
    sf::st_sf(geometry = geom)
  } else {
    sf::st_sf(df, geometry = geom)
  }
}

# Backwards-compatible shim used by older code paths (handle_db_connect_object,
# handle_db_import_object). Returns the table_name of a queryable native table
# for an sf/geos object — migrating from legacy serialized BLOBs on demand.
.rgeo_ensure_sf_table <- function(con, name, handle = NULL) {
  row <- .rgeo_obj_row(con, name)
  if (is.null(row)) stop("Object not found: ", name)
  if (!(row$kind[1] %in% c("sf", "geos"))) {
    stop("Cannot create dataset reference for kind: ", row$kind[1])
  }
  fmt <- tryCatch(
    DBI::dbGetQuery(con,
      "SELECT spatial_format FROM _rgeo_objects WHERE name = ?",
      params = list(name))$spatial_format[1],
    error = function(e) NA_character_
  )
  tn <- row$table_name[1]
  if (!is.na(fmt) && fmt == "duckdb_geometry" && !is.na(tn) && nzchar(tn)) {
    return(tn)
  }
  # Migrate on demand from a serialized BLOB.
  if (!requireNamespace("sf", quietly = TRUE))
    stop("sf package required to build dataset reference")
  blob <- DBI::dbGetQuery(con,
    "SELECT data FROM _rgeo_objects WHERE name = ?",
    params = list(name))$data[[1]]
  if (is.null(blob)) stop("Layer has no native table and no serialized backup")
  obj <- .rgeo_unserialize_rds(blob)
  tn <- .rgeo_write_native_geom_table(con, name, obj, row$kind[1], handle)
  DBI::dbExecute(con,
    "UPDATE _rgeo_objects SET data = NULL WHERE name = ?",
    params = list(name))
  tn
}

# Best-effort migration: scan _rgeo_objects for sf/geos entries that aren't
# yet in the native-geometry format and rewrite them. Each object is migrated
# in its own transaction so a single failure doesn't poison the rest. Streams
# progress messages over the WS console so the user sees what's happening.
.rgeo_migrate_legacy <- function(con, handle = NULL) {
  if (!.rgeo_load_spatial_ext(con, handle)) {
    broadcast_console(
      "[Rgeo] DuckDB spatial extension unavailable; legacy sf/geos layers will use load-copy fallback.\n",
      type = "stderr")
    return(invisible(NULL))
  }
  rows <- tryCatch(
    DBI::dbGetQuery(con, "
      SELECT name, kind, spatial_format
        FROM _rgeo_objects
       WHERE kind IN ('sf','geos')
         AND (spatial_format IS NULL OR spatial_format <> 'duckdb_geometry')"),
    error = function(e) NULL
  )
  if (is.null(rows) || nrow(rows) == 0) return(invisible(NULL))

  for (i in seq_len(nrow(rows))) {
    nm <- rows$name[i]
    broadcast_console(sprintf("[Rgeo] Migrating layer '%s'...\n", nm),
                      type = "stdout")
    DBI::dbBegin(con)
    ok <- tryCatch({
      blob <- DBI::dbGetQuery(con,
        "SELECT data FROM _rgeo_objects WHERE name = ?",
        params = list(nm))$data[[1]]
      if (is.null(blob)) stop("missing serialized data")
      obj <- .rgeo_unserialize_rds(blob)
      .rgeo_write_native_geom_table(con, nm, obj, rows$kind[i], handle)
      # Drop the now-redundant serialized blob to reclaim space.
      DBI::dbExecute(con,
        "UPDATE _rgeo_objects SET data = NULL WHERE name = ?",
        params = list(nm))
      DBI::dbCommit(con)
      TRUE
    }, error = function(e) {
      tryCatch(DBI::dbRollback(con), error = function(e2) NULL)
      broadcast_console(sprintf(
        "[Rgeo] Migration failed for '%s': %s — falling back to load-copy.\n",
        nm, conditionMessage(e)), type = "stderr")
      DBI::dbExecute(con,
        "UPDATE _rgeo_objects SET spatial_format = 'serialized' WHERE name = ?",
        params = list(nm))
      FALSE
    })
    invisible(ok)
  }
  invisible(NULL)
}

.rgeo_list_objects <- function(con) {
  rows <- DBI::dbGetQuery(
    con,
    "SELECT name, kind, geometry_type, crs, n_rows, size_bytes, notes, r_class,
            pk_column, geometry_column,
            bbox_minx, bbox_miny, bbox_maxx, bbox_maxy,
            spatial_format, has_spatial_index, editable
       FROM _rgeo_objects ORDER BY name"
  )
  if (nrow(rows) == 0) return(list())
  na_or <- function(x) if (length(x) == 0 || is.na(x)) NULL else x
  bbox_or_null <- function(i) {
    vals <- c(rows$bbox_minx[i], rows$bbox_miny[i], rows$bbox_maxx[i], rows$bbox_maxy[i])
    if (any(is.na(vals))) NULL else as.numeric(vals)
  }
  lapply(seq_len(nrow(rows)), function(i) {
    list(
      name = rows$name[i],
      kind = rows$kind[i],
      geometry_type = na_or(rows$geometry_type[i]),
      crs = na_or(rows$crs[i]),
      n_rows = if (is.na(rows$n_rows[i])) NULL else as.numeric(rows$n_rows[i]),
      size_bytes = if (is.na(rows$size_bytes[i])) NULL else as.numeric(rows$size_bytes[i]),
      notes = na_or(rows$notes[i]),
      r_class = na_or(rows$r_class[i]),
      pk_column = na_or(rows$pk_column[i]),
      geometry_column = na_or(rows$geometry_column[i]),
      bbox = bbox_or_null(i),
      spatial_format = na_or(rows$spatial_format[i]),
      has_spatial_index = if (is.na(rows$has_spatial_index[i])) NULL else isTRUE(rows$has_spatial_index[i]),
      editable = if (is.na(rows$editable[i])) NULL else isTRUE(rows$editable[i])
    )
  })
}

# ---------------------------------------------------------------------------
# Dataset translators — uniform per-kind interface that the renderer drives
# through the /dataset/* endpoints. Each translator implements a small set
# of operations and is selected by the dispatcher based on (kind,
# spatial_format).
# ---------------------------------------------------------------------------

# Identifier quoting for column / table names. DuckDB uses double-quotes.
.rgeo_qid <- function(x) paste0('"', gsub('"', '""', x), '"')

# Build the meta record that every translator op receives.
.rgeo_make_meta <- function(handle, name) {
  con <- .rgeo_get_con(handle)
  row <- .rgeo_obj_row(con, name)
  if (is.null(row)) stop("Object not found: ", name)
  list(
    con              = con,
    handle           = handle,
    name             = name,
    kind             = row$kind[1],
    table_name       = row$table_name[1],
    pk_column        = if (is.na(row$pk_column[1])) "_rgeo_rowid" else row$pk_column[1],
    geometry_column  = if (is.na(row$geometry_column[1])) NA_character_ else row$geometry_column[1],
    crs              = if (is.na(row$crs[1])) NA_character_ else row$crs[1],
    spatial_format   = if (is.na(row$spatial_format[1])) NA_character_ else row$spatial_format[1],
    editable         = isTRUE(row$editable[1]),
    bbox             = c(row$bbox_minx[1], row$bbox_miny[1],
                         row$bbox_maxx[1], row$bbox_maxy[1]),
    row              = row
  )
}

# ---------- Formula -> SQL whitelist (used by add_column) -------------------
# Walks an R AST and emits DuckDB SQL. Throws ".rgeo_unsupported" condition
# on anything outside the whitelist; the caller catches it and falls back
# to evaluate-in-R-then-write-back.

.rgeo_unsupported <- function(reason) {
  cond <- structure(
    class = c(".rgeo_unsupported", "condition"),
    list(message = reason, call = sys.call(-1))
  )
  stop(cond)
}

# Single-arg unary functions: maps R name -> SQL name.

