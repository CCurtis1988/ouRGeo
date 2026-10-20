# Project snapshots of the R environment: checkpoints, restore, and comparing
# versions for a merge. See docs/project-persistence-spec.md (§1.2, §1.9, §1.11).
#
# Three facts shape this file:
#
# - save() cannot keep everything. A terra SpatRaster/SpatVector is a C++
#   pointer, and saved raw it loads as an object whose every method fails. So
#   a project snapshot PACKS them: an in-memory raster keeps its values, a
#   file-backed one keeps a reference to its file (packing a 2 GB GeoTIFF into
#   a checkpoint every 30 seconds would be absurd), and restore unpacks them.
#   What cannot come back — a closed database connection, a raster whose file
#   is gone, a bare external pointer — is reported by name and reason, never
#   left behind as a corpse that errors on first use.
#
# - A checkpoint must never block a command. On Unix the snapshot is written by
#   a FORKED copy of this process (parallel::mcparallel): the fork sees the
#   environment exactly as it was at that instant, copy-on-write, while this
#   process goes on serving the console. Windows has no fork, so there the
#   snapshot is written in-process and the renderer only starts one when R is
#   idle.
#
# - Comparing two versions of an object needs no hash: both are loaded here,
#   and identical serialisations are identical objects.

.ourgeo_spatial_classes <- c("SpatRaster", "SpatVector", "SpatRasterDataset", "SpatRasterCollection", "SpatExtent")

.ourgeo_pack_object <- function(obj) {
  if (!inherits(obj, .ourgeo_spatial_classes) || !requireNamespace("terra", quietly = TRUE)) return(obj)
  tryCatch({
    if (inherits(obj, "SpatRaster")) {
      src <- terra::sources(obj)
      # File-backed: keep the reference. In memory: keep the values.
      if (length(src) && all(nzchar(src)) && all(file.exists(src))) terra::wrap(obj, proxy = TRUE)
      else terra::wrap(obj)
    } else terra::wrap(obj)
  }, error = function(e) obj)
}

# The user's objects in .GlobalEnv, packed for saving.
.ourgeo_snapshot_env <- function() {
  tmp <- new.env(parent = emptyenv())
  user <- setdiff(ls(envir = .GlobalEnv), .ourgeo_env$system_names %||% character(0))
  for (nm in user) {
    obj <- tryCatch(get(nm, envir = .GlobalEnv), error = function(e) NULL)
    if (!is.null(obj)) assign(nm, .ourgeo_pack_object(obj), envir = tmp)
  }
  # Attached packages are part of where the user was: a script that ran
  # library(sf) expects sf on the search path when the project reopens.
  attached <- sub("^package:", "", grep("^package:", search(), value = TRUE))
  assign(".ourgeo_attached", setdiff(attached, c("base", "stats", "graphics", "grDevices", "utils", "datasets", "methods")), envir = tmp)
  tmp
}

.ourgeo_strip_meta <- function(env) {
  for (nm in c(".ourgeo_save_meta", ".ourgeo_attached")) if (exists(nm, envir = env, inherits = FALSE)) rm(list = nm, envir = env)
}

.ourgeo_temp_path <- function(path) {
  roots <- unique(c(dirname(tempdir()), Sys.getenv(c("TMPDIR", "TEMP", "TMP"))))
  roots <- roots[nzchar(roots)]
  any(vapply(roots, function(r) startsWith(normalizePath(path, mustWork = FALSE), normalizePath(r, mustWork = FALSE)), logical(1)))
}

# Unpack a restored object, or say why it cannot come back. Returns
# list(value=, reason=) where reason is NULL on success.
.ourgeo_restore_object <- function(obj) {
  if (inherits(obj, c("PackedSpatRaster", "PackedSpatVector", "PackedSpatRasterDC", "PackedSpatExtent"))) {
    if (!requireNamespace("terra", quietly = TRUE)) return(list(value = NULL, reason = "terra is not installed"))
    out <- tryCatch(list(value = suppressWarnings(terra::unwrap(obj)), reason = NULL), error = function(e) {
      msg <- conditionMessage(e)
      file <- regmatches(msg, regexpr("file does not exist: .*$", msg))
      if (length(file)) {
        path <- sub("^file does not exist: ", "", file)
        list(value = NULL, reason = if (.ourgeo_temp_path(path)) "temporary raster file is gone" else paste0("raster file is missing: ", path))
      } else list(value = NULL, reason = paste0("raster could not be rebuilt: ", msg))
    })
    return(out)
  }
  if (inherits(obj, "DBIConnection")) {
    valid <- tryCatch(requireNamespace("DBI", quietly = TRUE) && DBI::dbIsValid(obj), error = function(e) FALSE)
    return(if (valid) list(value = obj, reason = NULL) else list(value = NULL, reason = "database connection"))
  }
  if (typeof(obj) == "externalptr") return(list(value = NULL, reason = "external pointer, which R cannot save"))
  if (inherits(obj, c("SpatRaster", "SpatVector"))) {
    # Saved raw by an older ouRGeo: the pointer inside is dead.
    ok <- tryCatch({ if (inherits(obj, "SpatRaster")) terra::nlyr(obj) else terra::geomtype(obj); TRUE }, error = function(e) FALSE)
    if (!ok) return(list(value = NULL, reason = "terra object saved without packing"))
  }
  list(value = obj, reason = NULL)
}

# ── Checkpoints ──────────────────────────────────────────────────────────────
.ourgeo_env$checkpoint <- NULL

# Compression is the whole cost of a snapshot. Measured on a 480 MB numeric
# vector: save()'s default gzip took 60 s, gzip level 1 took 11.5 s for a file
# 1% larger, and no compression took 0.5 s. A checkpoint stays on this
# computer and is rewritten every idle interval, so it is not compressed; a
# project bundle travels, so it gets the fast gzip.
.ourgeo_write_snapshot <- function(file_path, compress = "none") {
  tmp <- .ourgeo_snapshot_env()
  names <- ls(envir = tmp, all.names = TRUE)
  if (identical(compress, "fast")) save(list = names, file = file_path, envir = tmp, compress = "gzip", compression_level = 1)
  else save(list = names, file = file_path, envir = tmp, compress = FALSE)
  TRUE
}

.ourgeo_can_fork <- function() .Platform$OS.type == "unix" && requireNamespace("parallel", quietly = TRUE)

handle_checkpoint_start <- function(body) {
  file_path <- body$filePath %||% stop("filePath required")
  if (!is.null(.ourgeo_env$checkpoint)) return(json_response(list(success = TRUE, state = "busy")))
  started <- Sys.time()
  compress <- if (identical(body$compress, "fast")) "fast" else "none"
  if (!isTRUE(body$sync) && .ourgeo_can_fork()) {
    job <- parallel::mcparallel(.ourgeo_write_snapshot(file_path, compress), silent = TRUE, mc.set.seed = FALSE)
    .ourgeo_env$checkpoint <- list(job = job, file = file_path, started = started)
    return(json_response(list(success = TRUE, state = "running", async = TRUE)))
  }
  ok <- tryCatch(.ourgeo_write_snapshot(file_path, compress), error = function(e) conditionMessage(e))
  ms <- round(as.numeric(difftime(Sys.time(), started, units = "secs")) * 1000)
  if (isTRUE(ok)) json_response(list(success = TRUE, state = "done", ms = ms))
  else json_response(list(success = FALSE, state = "failed", error = ok, ms = ms))
}

handle_checkpoint_status <- function() {
  cp <- .ourgeo_env$checkpoint
  if (is.null(cp)) return(json_response(list(success = TRUE, state = "idle")))
  res <- parallel::mccollect(cp$job, wait = FALSE)
  if (is.null(res)) return(json_response(list(success = TRUE, state = "running")))
  .ourgeo_env$checkpoint <- NULL
  ms <- round(as.numeric(difftime(Sys.time(), cp$started, units = "secs")) * 1000)
  value <- res[[1]]
  if (isTRUE(value) && file.exists(cp$file)) json_response(list(success = TRUE, state = "done", ms = ms))
  else json_response(list(success = FALSE, state = "failed", ms = ms,
    error = if (inherits(value, "try-error")) as.character(value) else "The snapshot process stopped before finishing."))
}

# ── Restore ──────────────────────────────────────────────────────────────────
# Load a project snapshot into .GlobalEnv, unpacking what was packed and
# naming what could not be rebuilt. Restored objects land beside whatever is
# already there (the caller reset R first when that matters).
handle_snapshot_load <- function(body) {
  file_path <- body$filePath %||% stop("filePath required")
  tryCatch({
    tmp <- new.env(parent = emptyenv())
    load(file_path, envir = tmp)
    attached <- if (exists(".ourgeo_attached", envir = tmp, inherits = FALSE)) get(".ourgeo_attached", envir = tmp) else character(0)
    .ourgeo_strip_meta(tmp)
    not_restored <- list()
    # Packages first: unpacking a terra object needs terra loaded, and the
    # user's code expects the search path it left.
    for (pkg in rev(attached)) {
      ok <- tryCatch(suppressPackageStartupMessages(library(pkg, character.only = TRUE)), error = function(e) NULL)
      if (is.null(ok)) not_restored[[length(not_restored) + 1]] <- list(name = paste0("library(", pkg, ")"), reason = "package is not installed")
    }
    restored <- character(0)
    for (nm in ls(envir = tmp, all.names = TRUE)) {
      out <- .ourgeo_restore_object(get(nm, envir = tmp))
      if (is.null(out$reason)) {
        assign(nm, out$value, envir = .GlobalEnv)
        restored <- c(restored, nm)
      } else {
        not_restored[[length(not_restored) + 1]] <- list(name = nm, reason = out$reason)
        if (exists(nm, envir = .GlobalEnv, inherits = FALSE)) rm(list = nm, envir = .GlobalEnv)
      }
    }
    json_response(list(success = TRUE, restored = as.list(restored), notRestored = not_restored,
      rdataLoadedNames = as.list(intersect(restored, .ourgeo_env$system_names %||% character(0)))))
  }, error = function(e) error_response(conditionMessage(e)))
}

# ── Comparing versions ───────────────────────────────────────────────────────
.ourgeo_env$merge_sides <- NULL

.ourgeo_load_side <- function(path) {
  env <- new.env(parent = emptyenv())
  if (identical(path, "live")) {
    snap <- .ourgeo_snapshot_env()
    for (nm in ls(envir = snap, all.names = TRUE)) assign(nm, get(nm, envir = snap), envir = env)
  } else if (is.character(path) && length(path) == 1 && nzchar(path) && file.exists(path)) {
    load(path, envir = env)
  }
  .ourgeo_strip_meta(env)
  env
}

.ourgeo_same_object <- function(a, b) {
  tryCatch(identical(serialize(a, NULL, version = 3), serialize(b, NULL, version = 3)), error = function(e) FALSE)
}

.ourgeo_describe_object <- function(obj) {
  shown <- if (inherits(obj, c("PackedSpatRaster", "PackedSpatVector")) && requireNamespace("terra", quietly = TRUE)) tryCatch(suppressWarnings(terra::unwrap(obj)), error = function(e) obj) else obj
  text <- tryCatch(paste(utils::capture.output(utils::str(shown, max.level = 1, list.len = 12, vec.len = 3)), collapse = "\n"), error = function(e) "")
  list(class = paste(class(shown), collapse = ", "),
       size = tryCatch(format(utils::object.size(obj), units = "auto"), error = function(e) ""),
       str = substr(text, 1, 4000))
}

# Body: { sides: { base?: path, mine?: path|"live", theirs?: path } }.
# Keeps the three environments loaded for /project/merge-env/build; replying
# with, per object name, whether each side has it and which sides agree.
handle_merge_env_compare <- function(body) {
  sides <- body$sides %||% list()
  tryCatch({
    loaded <- lapply(c(base = "base", mine = "mine", theirs = "theirs"), function(s) .ourgeo_load_side(sides[[s]]))
    .ourgeo_env$merge_sides <- loaded
    all_names <- sort(unique(unlist(lapply(loaded, function(e) ls(envir = e, all.names = TRUE)))))
    items <- lapply(all_names, function(nm) {
      has <- vapply(loaded, function(e) exists(nm, envir = e, inherits = FALSE), logical(1))
      get_side <- function(s) if (has[[s]]) get(nm, envir = loaded[[s]]) else NULL
      same <- function(a, b) (!has[[a]] && !has[[b]]) || (has[[a]] && has[[b]] && .ourgeo_same_object(get_side(a), get_side(b)))
      list(name = nm, has = as.list(has),
           mineEqBase = same("mine", "base"), theirsEqBase = same("theirs", "base"), mineEqTheirs = same("mine", "theirs"),
           describe = lapply(Filter(function(s) has[[s]], c("base", "mine", "theirs")), function(s) c(list(side = s), .ourgeo_describe_object(get_side(s)))))
    })
    json_response(list(success = TRUE, items = items))
  }, error = function(e) error_response(conditionMessage(e)))
}

# Body: { filePath, choices: { name: "mine"|"theirs"|"both"|"none" } }.
# "both" keeps theirs under the name and mine under name_mine (§1.9).
handle_merge_env_build <- function(body) {
  sides <- .ourgeo_env$merge_sides %||% return(error_response("Compare the versions before building the merged environment."))
  file_path <- body$filePath %||% stop("filePath required")
  choices <- body$choices %||% list()
  tryCatch({
    out <- new.env(parent = emptyenv())
    all_names <- unique(unlist(lapply(sides, function(e) ls(envir = e, all.names = TRUE))))
    for (nm in all_names) {
      choice <- choices[[nm]] %||% "mine"
      put <- function(side, as = nm) if (exists(nm, envir = sides[[side]], inherits = FALSE)) assign(as, get(nm, envir = sides[[side]]), envir = out)
      if (choice == "mine") put("mine")
      else if (choice == "theirs") put("theirs")
      else if (choice == "both") {
        put("theirs")
        alt <- paste0(nm, "_mine"); n <- 1
        while (alt %in% all_names || exists(alt, envir = out, inherits = FALSE)) { n <- n + 1; alt <- paste0(nm, "_mine_", n) }
        put("mine", alt)
      }
    }
    save(list = ls(envir = out, all.names = TRUE), file = file_path, envir = out)
    .ourgeo_env$merge_sides <- NULL
    json_response(list(success = TRUE, names = as.list(ls(envir = out, all.names = TRUE))))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_merge_env_release <- function() {
  .ourgeo_env$merge_sides <- NULL
  ok_response()
}
