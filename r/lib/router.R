# HTTP route dispatch + WebSocket handler
# (extracted from server.R — behavior-preserving modularization)

route <- function(req) {
  method <- req$REQUEST_METHOD
  path   <- req$PATH_INFO

  if (method == "OPTIONS") return(options_response())

  tryCatch({
    if (path == "/session/init" && method == "POST") {
      return(handle_session_init())
    }

    if (path == "/r/execute" && method == "POST") {
      body <- parse_body(req)
      return(handle_execute(body))
    }

    if (path == "/kaggle/files" && method == "POST") {
      body <- parse_body(req)
      return(handle_kaggle_files(body))
    }

    if (path == "/rmarkdown/deps" && method == "GET") {
      return(handle_rmarkdown_deps())
    }

    if (path == "/r/chunk/execute" && method == "POST") {
      body <- parse_body(req)
      return(handle_chunk_execute(body))
    }

    if (path == "/r/plot/export" && method == "POST") {
      body <- parse_body(req)
      return(handle_plot_export(body))
    }

    if (path == "/session/wd" && method == "GET") {
      return(handle_wd_get())
    }

    if (path == "/session/setwd" && method == "POST") {
      body <- parse_body(req)
      return(handle_wd_set(body))
    }

    if (path == "/health") {
      return(ok_response(message = "ok"))
    }

    if (path == "/env/list" && method == "GET") {
      return(handle_env_list())
    }

    if (path == "/env/remove" && method == "POST") {
      body <- parse_body(req)
      return(handle_env_remove(body))
    }

    if (path == "/env/rename" && method == "POST") {
      body <- parse_body(req)
      return(handle_env_rename(body))
    }

    if (path == "/env/copy" && method == "POST") {
      body <- parse_body(req)
      return(handle_env_copy(body))
    }

    if (path == "/env/move" && method == "POST") {
      body <- parse_body(req)
      return(handle_env_move(body))
    }

    if (path == "/env/create" && method == "POST") {
      body <- parse_body(req)
      return(handle_env_create(body))
    }

    if (path == "/env/duplicate" && method == "POST") {
      body <- parse_body(req)
      return(handle_env_duplicate(body))
    }

    if (path == "/env/save" && method == "POST") {
      body <- parse_body(req)
      return(handle_env_save(body))
    }

    if (path == "/env/load" && method == "POST") {
      body <- parse_body(req)
      return(handle_env_load(body))
    }

    if (path == "/session/reset" && method == "POST") {
      body <- parse_body(req)
      return(handle_session_reset(body))
    }

    if (path == "/packages/list" && method == "GET") {
      return(handle_packages_list())
    }

    if (path == "/packages/load" && method == "POST") {
      body <- parse_body(req)
      return(handle_packages_load(body))
    }

    if (path == "/packages/unload" && method == "POST") {
      body <- parse_body(req)
      return(handle_packages_unload(body))
    }

    if (path == "/packages/install" && method == "POST") {
      body <- parse_body(req)
      return(handle_packages_install(body))
    }

    if (path == "/packages/addlibpath" && method == "POST") {
      body <- parse_body(req)
      return(handle_packages_addlibpath(body))
    }

    if (path == "/packages/cran-list" && method == "GET") {
      return(handle_packages_cran_list())
    }

    if (path == "/packages/check-version" && method == "POST") {
      body <- parse_body(req)
      return(handle_packages_check_version(body))
    }

    if (path == "/object/function" && method == "POST") {
      body <- parse_body(req)
      return(handle_object_function(body))
    }

    if (path == "/object/formals" && method == "POST") {
      body <- parse_body(req)
      return(handle_object_formals(body))
    }

    if (path == "/object/dataframe" && method == "POST") {
      body <- parse_body(req)
      return(handle_object_dataframe(body))
    }

    if (path == "/object/matrix" && method == "POST") {
      body <- parse_body(req)
      return(handle_object_matrix(body))
    }

    if (path == "/object/vector" && method == "POST") {
      body <- parse_body(req)
      return(handle_object_vector(body))
    }

    if (path == "/spatial/list" && method == "GET") {
      return(handle_spatial_list())
    }

    if (path == "/spatial/geojson" && method == "POST") {
      body <- parse_body(req)
      return(handle_spatial_geojson(body))
    }

    if (path == "/spatial/wkt" && method == "POST") {
      body <- parse_body(req)
      return(handle_spatial_wkt(body))
    }

    if (path == "/spatial/crs" && method == "POST") {
      body <- parse_body(req)
      return(handle_spatial_crs(body))
    }

    if (path == "/spatial/traverse" && method == "POST") {
      body <- parse_body(req)
      return(handle_spatial_traverse(body))
    }

    if (path == "/data/preview" && method == "POST") {
      body <- parse_body(req)
      return(handle_data_preview(body))
    }

    if (path == "/r/plot-preview" && method == "POST") {
      body <- parse_body(req)
      return(handle_plot_preview(body))
    }

    if (path == "/help/search" && method == "POST") {
      body <- parse_body(req)
      return(handle_help_search(body))
    }

    if (path == "/help/doc" && method == "POST") {
      body <- parse_body(req)
      return(handle_help_doc(body))
    }

    if (path == "/help/package" && method == "POST") {
      body <- parse_body(req)
      return(handle_help_package(body))
    }

    if (path == "/help/vignettes" && method == "POST") {
      body <- parse_body(req)
      return(handle_help_vignettes(body))
    }

    if (path == "/help/vignette" && method == "POST") {
      body <- parse_body(req)
      return(handle_help_vignette(body))
    }

    if (path == "/selection/query" && method == "POST") {
      body <- parse_body(req)
      return(handle_selection_query(body))
    }

    if (path == "/db/create" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_create(body))
    }
    if (path == "/db/open" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_open(body))
    }
    if (path == "/db/close" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_close(body))
    }
    if (path == "/db/list-objects" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_list_objects(body))
    }
    if (path == "/db/delete-object" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_delete_object(body))
    }
    if (path == "/db/connect-object" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_connect_object(body))
    }
    if (path == "/db/preview-object" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_preview_object(body))
    }
    if (path == "/db/import-object" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_import_object(body))
    }
    if (path == "/db/preview-tbl" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_preview_tbl(body))
    }
    if (path == "/db/proxies" && method == "GET") {
      return(handle_db_proxies())
    }
    if (path == "/db/reconnect" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_reconnect(body))
    }
    if (path == "/db/recents" && method == "GET") {
      return(handle_db_recents())
    }
    if (path == "/db/recents-add" && method == "POST") {
      body <- parse_body(req)
      return(handle_db_recents_add(body))
    }

    if (path == "/dataset/preview" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_preview(body))
    }
    if (path == "/dataset/update-cell" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_update_cell(body))
    }
    if (path == "/dataset/add-column" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_add_column(body))
    }
    if (path == "/dataset/delete-rows" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_delete_rows(body))
    }
    if (path == "/dataset/rename-column" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_rename_column(body))
    }
    if (path == "/dataset/delete-column" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_delete_column(body))
    }
    if (path == "/dataset/spatial-tile" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_spatial_tile(body))
    }
    if (path == "/dataset/update-geometry" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_update_geometry(body))
    }
    if (path == "/dataset/row-wkt" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_row_wkt(body))
    }
    if (path == "/dataset/collect" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_collect(body))
    }
    if (path == "/dataset/bbox" && method == "POST") {
      body <- parse_body(req)
      return(handle_dataset_bbox(body))
    }

    if (path == "/raster/info" && method == "POST") {
      body <- parse_body(req)
      return(handle_raster_info(body))
    }
    if (path == "/raster/register" && method == "POST") {
      body <- parse_body(req)
      return(handle_raster_register(body))
    }
    if (path == "/raster/unregister" && method == "POST") {
      body <- parse_body(req)
      return(handle_raster_unregister(body))
    }
    if (path == "/raster/histogram" && method == "POST") {
      body <- parse_body(req)
      return(handle_raster_histogram(body))
    }
    if (path == "/raster/value" && method == "POST") {
      body <- parse_body(req)
      return(handle_raster_value(body))
    }
    if (grepl("^/raster/tile/", path) && method == "GET") {
      m <- regmatches(path, regexec(
        "^/raster/tile/([^/]+)/(\\d+)/(\\d+)/(\\d+)\\.png$", path))[[1]]
      if (length(m) == 5) {
        return(handle_raster_tile(m[2], as.integer(m[3]), as.integer(m[4]),
                                  as.integer(m[5]), req$QUERY_STRING %||% ""))
      }
      return(error_response("Bad tile path", 404L))
    }

    if (grepl("^/widget/", path) && method == "GET") {
      id <- sub("^/widget/", "", path)
      return(handle_widget_serve(id))
    }

    if (grepl("^/widget-files/", path) && method == "GET") {
      rest <- sub("^/widget-files/", "", path)
      parts <- strsplit(rest, "/", fixed = TRUE)[[1]]
      id <- parts[1]
      rel_path <- if (length(parts) > 1) paste(parts[-1], collapse = "/") else ""
      return(handle_widget_files(id, rel_path))
    }

    error_response("Not found", 404L)
  }, error = function(e) {
    message("Router error: ", conditionMessage(e))
    error_response(conditionMessage(e))
  })
}

ws_handler <- function(ws) {
  client_id <- as.character(runif(1))
  .ourgeo_env$ws_clients[[client_id]] <- ws
  cat("[WS] Client connected:", client_id, "\n")

  ws$onMessage(function(binary, message) {
    if (!binary && message == "ping") ws$send('{"type":"pong"}')
  })

  ws$onClose(function() {
    .ourgeo_env$ws_clients[[client_id]] <- NULL
    cat("[WS] Client disconnected:", client_id, "\n")
  })
}

