# Handlers: selection query, spatial list / GeoJSON
# (extracted from server.R — behavior-preserving modularization)

handle_selection_query <- function(body) {
  source_name <- body$sourceName %||% return(error_response("sourceName required", 400L))
  source_env  <- body$sourceEnv  %||% return(error_response("sourceEnv required", 400L))
  code        <- body$code       %||% return(error_response("code required", 400L))

  tryCatch({
    env_obj <- tryCatch(
      as.environment(source_env),
      error = function(e) stop(paste("Environment not found:", source_env))
    )

    # Evaluate the pipeline expression — result is a subset of the source object
    result <- eval(parse(text = code), envir = env_obj)

    # R rownames are 1-based strings; convert to 0-based integers
    rn <- rownames(result)
    if (is.null(rn)) {
      row_indices <- seq_len(nrow(result)) - 1L
    } else {
      row_indices <- as.integer(rn) - 1L
    }
    row_indices <- row_indices[!is.na(row_indices)]

    json_response(list(success = TRUE, rowIndices = row_indices))
  }, error = function(e) {
    json_response(list(success = FALSE, error = conditionMessage(e)))
  })
}

# ---------------------------------------------------------------------------
# Plot export handler
# ---------------------------------------------------------------------------

handle_spatial_list <- function() {
  if (!requireNamespace("sf", quietly = TRUE)) {
    return(json_response(list(success = TRUE, objects = list())))
  }

  search_path <- search()
  results <- list()

  for (env_name in search_path) {
    env <- tryCatch(as.environment(env_name), error = function(e) NULL)
    if (is.null(env)) next

    obj_names <- tryCatch(ls(envir = env), error = function(e) character(0))
    for (nm in obj_names) {
      obj <- tryCatch(get(nm, envir = env), error = function(e) NULL)
      if (is.null(obj)) next

      if (inherits(obj, c("sf", "sfc", "sfg"))) {
        geom_type <- tryCatch({
          if (inherits(obj, "sf")) {
            types <- unique(as.character(sf::st_geometry_type(obj)))
            paste(types, collapse = ", ")
          } else if (inherits(obj, "sfc")) {
            types <- unique(as.character(sf::st_geometry_type(obj)))
            paste(types, collapse = ", ")
          } else {
            as.character(sf::st_geometry_type(obj))
          }
        }, error = function(e) "UNKNOWN")

        n_features <- tryCatch({
          if (inherits(obj, "sf")) nrow(obj)
          else if (inherits(obj, "sfc")) length(obj)
          else 1L
        }, error = function(e) 0L)

        crs_str <- tryCatch({
          crs <- sf::st_crs(obj)
          if (is.na(crs)) NULL else crs$input
        }, error = function(e) NULL)

        sf_col <- tryCatch({
          col <- attr(obj, "sf_column")
          if (is.null(col)) "geometry" else col
        }, error = function(e) "geometry")

        results[[length(results) + 1]] <- list(
          name = nm,
          envName = env_name,
          class = class(obj)[1],
          geometryType = geom_type,
          nFeatures = n_features,
          crs = crs_str,
          sfColumn = sf_col
        )
      } else if (inherits(obj, c("SpatRaster", "RasterLayer",
                                 "RasterStack", "RasterBrick")) &&
                 requireNamespace("terra", quietly = TRUE)) {
        r <- tryCatch({
          if (inherits(obj, "SpatRaster")) obj else terra::rast(obj)
        }, error = function(e) NULL)
        if (is.null(r)) next

        crs_str <- tryCatch({
          ci <- terra::crs(r, describe = TRUE)
          if (!is.na(ci$authority) && !is.na(ci$code)) {
            paste0(ci$authority, ":", ci$code)
          } else {
            p <- terra::crs(r, proj = TRUE)
            if (nzchar(p)) p else NULL
          }
        }, error = function(e) NULL)

        results[[length(results) + 1]] <- list(
          name = nm,
          envName = env_name,
          class = "SpatRaster",
          geometryType = "RASTER",
          nFeatures = tryCatch(terra::ncell(r), error = function(e) 0),
          crs = crs_str,
          nBands = tryCatch(terra::nlyr(r), error = function(e) 1L),
          dims = tryCatch(list(terra::nrow(r), terra::ncol(r)),
                          error = function(e) NULL)
        )
      }
    }
  }

  json_response(list(success = TRUE, objects = results))
}

# True (curve-preserving) WKT for one row's geometry — used by the drawing
# tools so re-editing a curved feature restores its symbolic arcs instead of
# the linearized vertex cloud shown on the map.
handle_spatial_wkt <- function(body) {
  name <- body$name %||% return(error_response("name required", 400L))
  env_name <- body$envName %||% ".GlobalEnv"
  row <- body$row %||% return(error_response("row required", 400L))

  if (!requireNamespace("sf", quietly = TRUE)) {
    return(error_response("sf package is not installed"))
  }

  tryCatch({
    env <- resolve_env(env_name)
    obj <- get(name, envir = env)
    geom <- if (!is.null(body$column) && !is.null(obj[[body$column]])) {
      obj[[body$column]]
    } else {
      sf::st_geometry(obj)
    }
    idx <- as.integer(row) + 1L
    if (idx < 1L || idx > length(geom)) {
      return(error_response(sprintf("row %s out of range", row), 400L))
    }
    g <- geom[[idx]]
    # WGS84 for the drawing surface (arc control points transform natively)
    crs <- sf::st_crs(geom)
    if (is.na(crs)) return(error_response('The coordinate CRS is unknown. Inspect attributes and explicitly assign the known CRS before drawing on the map.'))
    if (any(!is.finite(unlist(g)))) return(error_response('Non-finite coordinates cannot be drawn. Inspect Data checks for the affected source row.'))
    if (!is.na(crs) && !isTRUE(crs == sf::st_crs(4326L))) {
      g <- sf::st_transform(sf::st_sfc(g, crs = crs), 4326L)[[1L]]
    }
    has_curve <- if (requireNamespace("sfarc", quietly = TRUE)) {
      isTRUE(tryCatch(sfarc::st_has_curve(g), error = function(e) FALSE))
    } else FALSE
    json_response(list(
      success = TRUE,
      wkt = sf::st_as_text(g),
      hasCurve = has_curve
    ))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_spatial_geojson <- function(body) {
  name <- body$name %||% stop("name required")
  env_name <- body$envName %||% ".GlobalEnv"

  if (!requireNamespace("sf", quietly = TRUE)) {
    return(error_response("sf package is not installed"))
  }

  tryCatch({
    env <- resolve_env(env_name)
    obj <- get(name, envir = env)

    # Coerce sfc/sfg to sf if needed
    if (inherits(obj, "sfg")) {
      obj <- sf::st_sf(geometry = sf::st_sfc(obj))
    } else if (inherits(obj, "sfc")) {
      obj <- sf::st_sf(geometry = obj)
    }

    if (is.na(sf::st_crs(obj))) return(error_response('The layer CRS is unknown. Inspect attributes with Data checks, then explicitly assign the known CRS before mapping.'))
    # Map display needs finite coordinates, not a repeated full validity scan.
    # Operation geometry inspection remains asynchronous in Data checks.
    if (any(vapply(sf::st_geometry(obj), function(g) any(!is.finite(unlist(g))), logical(1)))) return(error_response('Non-finite coordinates cannot be mapped. Inspect Data checks for affected rows.'))

    # Curved geometry (CIRCULARSTRING/COMPOUNDCURVE/CURVEPOLYGON/...) cannot
    # be expressed in GeoJSON — linearize for display. The true curves stay
    # untouched in the user's object; this only affects the map payload.
    if (requireNamespace("sfarc", quietly = TRUE)) {
      has_curve <- tryCatch(any(sfarc::st_has_curve(obj)), error = function(e) FALSE)
      if (isTRUE(has_curve)) obj <- sfarc::st_linearize(obj)
    } else {
      gtypes <- as.character(unique(sf::st_geometry_type(obj)))
      if (any(grepl("CIRCULARSTRING|CURVE|SURFACE", gtypes))) {
        return(error_response(
          "Object contains curved geometry; install the 'sfarc' package to display it"))
      }
    }

    # Transform to WGS84. Guard the EPSG compare: a CRS set from WKT/proj4 may
    # have no EPSG code (crs$epsg is NA), which would make `!= 4326` return NA
    # and error the `if`; fall back to comparing against the WGS84 crs object.
    crs <- sf::st_crs(obj)
    if (!is.na(crs) && !isTRUE(crs == sf::st_crs(4326L))) {
      obj <- dq_transform(obj, "OGC:CRS84")
    }

    # GeoJSON writers (geojsonsf and GDAL) can't serialize list-columns, which
    # are common in API imports (e.g. STAC item properties like eo:bands or
    # proj:transform arrive as nested arrays). Stringify any non-geometry
    # list-column to JSON text so conversion succeeds and the values survive.
    geom_col <- attr(obj, "sf_column")
    for (nm in setdiff(names(obj), geom_col)) {
      col <- obj[[nm]]
      if (is.list(col) && !inherits(col, "sfc")) {
        obj[[nm]] <- vapply(col, function(v) {
          if (length(v) == 0) NA_character_
          else tryCatch(jsonlite::toJSON(v, auto_unbox = TRUE),
                        error = function(e) paste(unlist(v), collapse = ", "))
        }, character(1))
      }
    }

    # Convert to GeoJSON string.
    #
    # geojsonsf is skipped when the object carries NO attribute columns:
    # `sf_geojson` on a geometry-only sf returns bare geometries separated by
    # spaces rather than a FeatureCollection, so the renderer's
    # `geojson.features.map(...)` failed with "Cannot read properties of
    # undefined". `st_as_sf(data.frame(x, y), coords = c("x", "y"))` — the
    # first thing anyone does with sf — produces exactly that object.
    has_attrs <- length(setdiff(names(obj), geom_col)) > 0
    geojson_str <- if (has_attrs && requireNamespace("geojsonsf", quietly = TRUE)) {
      geojsonsf::sf_geojson(obj)
    } else {
      # Fallback: use sf's built-in GeoJSON writer via temp file
      tmp <- tempfile(fileext = ".geojson")
      on.exit(unlink(tmp))
      sf::st_write(obj, tmp, driver = "GeoJSON", quiet = TRUE)
      paste(readLines(tmp, warn = FALSE), collapse = "\n")
    }

    # Return raw GeoJSON string to avoid double-serialization
    list(
      status = 200L,
      headers = list("Content-Type" = "application/json",
                      "Access-Control-Allow-Origin" = "*",
                      "Access-Control-Allow-Methods" = "GET, POST, OPTIONS",
                      "Access-Control-Allow-Headers" = "Content-Type"),
      body = paste0('{"success":true,"geojson":', geojson_str, '}')
    )
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

# ---------------------------------------------------------------------------
# Database (.Rgeo) — DuckDB-backed file format
# ---------------------------------------------------------------------------

# All .Rgeo files share this internal schema. Tabular objects (data.frame /
# tibble / data.table) live as real DuckDB tables so dplyr / tbl() lazy
# refs work. As of format version 2, sf / geos objects also live in native
# DuckDB tables with a real GEOMETRY column (DuckDB spatial extension) plus
# an R-tree index — enabling viewport queries and SQL-pushdown editing.
# Raster / image / opaque rds objects still live in BLOB storage and
# materialize a full copy on connect.


