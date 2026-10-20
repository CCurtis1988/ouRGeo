# Project Files from R.
#
# The project's file library lives inside the .ourgeoproj bundle, which R
# cannot open, so these helpers ask ouRGeo's main process for it over a
# loopback door (electron/main/project-files/r-access.ts) whose address is in
# this session's environment. They are written to slot INTO ordinary R rather
# than replace it — the user keeps write.csv(), ggsave(), sf::st_write() and
# every other writer they know, and only the path changes:
#
#   sites <- read.csv(ourgeo_project_file("data/sites.csv"))
#   write.csv(summary, ourgeo_project_path("tables/summary.csv"), row.names = FALSE)
#   ggsave(ourgeo_project_path("figures/map.png"), p, width = 7, height = 5)
#
# A writer needs a path BEFORE the file exists, so ourgeo_project_path() hands
# out a staging path and remembers it; whatever the writer put there is saved
# into the project when the console command finishes (or at once, with
# ourgeo_project_commit()). A read of a name that is still staged commits it
# first, so write-then-read inside one script behaves the way it does on disk.
#
# Self-contained on purpose — base R plus curl and jsonlite (both already
# required through httr2), and no server helpers — because Knit sources this
# same file into its clean child session. A document that reads a project file
# in the console must knit, or the helpers would be the newest way to produce
# the "works in my console, fails on Knit" report the Knit button exists for.

.ourgeo_pf <- new.env(parent = emptyenv())
.ourgeo_pf$pending <- list()

.ourgeo_pf_or <- function(x, y) if (is.null(x)) y else x

.ourgeo_pf_request <- function(route, body = list()) {
  url <- Sys.getenv("OURGEO_PROJECT_FILES_URL")
  token <- Sys.getenv("OURGEO_PROJECT_FILES_TOKEN")
  if (!nzchar(url) || !nzchar(token)) {
    stop("Project Files are reachable only from R running inside ouRGeo (the console, ",
         "the toolbox, chunks and Knit). Outside ouRGeo, export the file from the ",
         "Project Files pane and use its path.", call. = FALSE)
  }
  if (!requireNamespace("curl", quietly = TRUE) || !requireNamespace("jsonlite", quietly = TRUE)) {
    stop("Project Files from R need the 'curl' and 'jsonlite' packages. Install them in the Packages panel.", call. = FALSE)
  }
  # An empty list serialises as [], which is not the object the door expects.
  payload <- if (length(body)) jsonlite::toJSON(body, auto_unbox = TRUE, null = "null") else "{}"
  handle <- curl::new_handle()
  # noproxy: a corporate http_proxy must never be asked to reach 127.0.0.1.
  curl::handle_setopt(handle, post = TRUE, postfields = as.character(payload), noproxy = "*", timeout = 600)
  curl::handle_setheaders(handle, Authorization = paste("Bearer", token), `Content-Type` = "application/json")
  response <- tryCatch(curl::curl_fetch_memory(paste0(url, "/v1/", route), handle = handle), error = function(e) {
    stop("ouRGeo did not answer the Project Files request (", conditionMessage(e), "). ",
         "If ouRGeo was restarted, restart R from the console menu.", call. = FALSE)
  })
  parsed <- tryCatch(jsonlite::fromJSON(rawToChar(response$content), simplifyVector = FALSE), error = function(e) list())
  if (response$status_code != 200) stop(.ourgeo_pf_or(parsed$error, paste("Project Files request failed with HTTP", response$status_code)), call. = FALSE)
  parsed
}

.ourgeo_pf_check_name <- function(name, what = "name") {
  if (!is.character(name) || length(name) != 1L || is.na(name) || !nzchar(trimws(name))) {
    stop("`", what, "` must be one file name, such as \"tables/summary.csv\".", call. = FALSE)
  }
  parts <- strsplit(gsub("\\\\", "/", name), "/", fixed = TRUE)[[1]]
  if (any(parts %in% c("..", "."))) {
    stop("\"", name, "\" steps outside the project. Folders here are labels such as \"figures/\", not locations on disk.", call. = FALSE)
  }
  invisible(name)
}

.ourgeo_pf_is_project <- function(location) is.null(location) || identical(tolower(location), "project")

.ourgeo_pf_describe <- function(result) {
  where <- if (nzchar(.ourgeo_pf_or(result$folder, ""))) paste0(result$folder, "/", result$name) else result$name
  switch(.ourgeo_pf_or(result$action, "added"),
         unchanged = paste0("Project Files: ", where, " is unchanged."),
         replaced = paste0("Project Files: updated ", where, " (", format(structure(result$bytes, class = "object_size"), units = "auto"), "). Save the project to keep it."),
         paste0("Project Files: added ", where, " (", format(structure(result$bytes, class = "object_size"), units = "auto"), "). Save the project to keep it."))
}

#' List the files in this project's library.
#'
#' @param pattern Optional regular expression matched against "folder/name".
#' @param location "project" for files inside the bundle, a linked folder's
#'   name for that folder, or NULL for all of them.
ourgeo_project_files <- function(pattern = NULL, location = NULL) {
  listing <- .ourgeo_pf_request("list")
  if (is.null(listing$project)) {
    message("This is the scratch workspace, which has no Project Files. Save the project to give it a library.")
  }
  files <- listing$files
  col <- function(field, default) vapply(files, function(f) { v <- f[[field]]; if (is.null(v)) default else v }, default)
  out <- data.frame(
    file = col("target", ""), name = col("name", ""), folder = col("folder", ""),
    location = col("location", ""), type = col("mediaType", ""), bytes = col("bytes", 0),
    saved = col("saved", FALSE), status = col("status", ""), updated = col("updated", ""),
    stringsAsFactors = FALSE
  )
  if (!is.null(location)) out <- out[tolower(out$location) == tolower(location), , drop = FALSE]
  if (!is.null(pattern)) out <- out[grepl(pattern, out$file), , drop = FALSE]
  rownames(out) <- NULL
  out
}

#' Path to a project file, for any function that reads one.
#'
#'   read.csv(ourgeo_project_file("data/sites.csv"))
#'   sf::st_read(ourgeo_project_file("boundary.gpkg"))
#'
#' A file inside the bundle is copied (read-only, keeping its name and
#' extension, which readers such as readxl and GDAL rely on) into this
#' session's temporary directory; a file in a linked folder is read where it
#' is. The copy is a snapshot: change the file by writing it back with
#' ourgeo_project_path().
#'
#' @param name The file's name as Project Files shows it, optionally after its
#'   logical folder: "sites.csv" or "data/sites.csv".
#' @param location "project" or a linked folder's name, when a name is in both.
ourgeo_project_file <- function(name, location = NULL) {
  .ourgeo_pf_check_name(name)
  # A file written earlier in this same command is still staged; commit it so
  # the read sees what the script just wrote, as it would on disk.
  if (length(.ourgeo_pf$pending)) ourgeo_project_commit(quiet = TRUE)
  found <- .ourgeo_pf_request("resolve", list(name = name, location = location))
  if (identical(found$kind, "linked")) return(found$path)
  dir <- file.path(tempdir(), "ourgeo-project-files", found$sha256)
  dest <- file.path(dir, found$name)
  if (!file.exists(dest) || file.size(dest) != found$bytes) {
    dir.create(dir, recursive = TRUE, showWarnings = FALSE)
    if (file.exists(dest)) { Sys.chmod(dest, "0644"); unlink(dest) }
    if (!file.copy(found$path, dest, overwrite = TRUE)) {
      stop("Could not copy \"", found$target, "\" out of the project into ", dir, ".", call. = FALSE)
    }
    # Read-only, so a writer pointed here by mistake fails loudly instead of
    # changing a copy nothing will ever save.
    Sys.chmod(dest, "0444")
  }
  normalizePath(dest, winslash = "/")
}

#' Path for any function that writes a file, saved into the project afterwards.
#'
#'   write.csv(df, ourgeo_project_path("tables/summary.csv"), row.names = FALSE)
#'   ggsave(ourgeo_project_path("figures/map.png"), p, width = 7, height = 5)
#'   sf::st_write(roads, ourgeo_project_path("roads.gpkg"))
#'
#' The file is saved into Project Files when the console command finishes;
#' call ourgeo_project_commit() to save it sooner. Writing the same name again
#' replaces it, as writing over a file on disk would. Saving the PROJECT is what
#' writes it into the .ourgeoproj bundle.
#'
#' @param name File name, optionally after a logical folder: "figures/map.png".
#' @param folder Logical folder, if not given in `name`.
#' @param description Optional description shown in Project Files.
#' @param location "project" (inside the bundle) or a linked folder's name, to
#'   write the file into that folder on disk instead.
#' @param overwrite FALSE refuses to replace an existing file of that name.
ourgeo_project_path <- function(name, folder = NULL, description = NULL, location = "project", overwrite = TRUE) {
  .ourgeo_pf_check_name(name)
  if (.ourgeo_pf_is_project(location)) {
    status <- .ourgeo_pf_request("status")
    if (is.null(status$project)) {
      stop("This is the scratch workspace, which has no Project Files. Save the project (Project menu > Save As...) and run this again.", call. = FALSE)
    }
    if (!isTRUE(overwrite)) {
      taken <- ourgeo_project_files(location = "project")
      if (basename(name) %in% taken$name) stop("\"", name, "\" is already in the project. Use overwrite = TRUE to replace it.", call. = FALSE)
    }
    staging <- file.path(tempdir(), "ourgeo-project-out", paste0(format(Sys.time(), "%H%M%OS3"), "-", sample.int(1e9, 1)))
    dir.create(staging, recursive = TRUE, showWarnings = FALSE)
    path <- normalizePath(file.path(staging, basename(gsub("\\\\", "/", name))), winslash = "/", mustWork = FALSE)
    entry <- list(kind = "project", path = path, name = name, folder = folder, description = description, overwrite = isTRUE(overwrite))
  } else {
    linked <- .ourgeo_pf_request("linked", list(location = location))
    path <- normalizePath(file.path(linked$root, gsub("\\\\", "/", name)), winslash = "/", mustWork = FALSE)
    if (!isTRUE(overwrite) && file.exists(path)) stop("\"", name, "\" already exists in ", linked$name, ". Use overwrite = TRUE to replace it.", call. = FALSE)
    dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
    entry <- list(kind = "linked", path = path, name = name, folderId = linked$id, folderName = linked$name)
  }
  key <- paste(entry$kind, tolower(.ourgeo_pf_or(location, "project")), tolower(name))
  .ourgeo_pf$pending[[key]] <- entry
  path
}

#' Save an existing file into the project now.
#'
#'   ourgeo_project_save("~/Downloads/standards.pdf", "reference/standards.pdf")
ourgeo_project_save <- function(path, name = basename(path), folder = NULL, description = NULL, location = "project", overwrite = TRUE) {
  .ourgeo_pf_check_name(name)
  path <- normalizePath(path, winslash = "/", mustWork = FALSE)
  if (!file.exists(path) || dir.exists(path)) stop("There is no file at ", path, ".", call. = FALSE)
  if (.ourgeo_pf_is_project(location)) {
    result <- .ourgeo_pf_request("put", list(path = path, name = name, folder = folder, description = description, overwrite = isTRUE(overwrite)))
    message(.ourgeo_pf_describe(result))
    return(invisible(result))
  }
  dest <- ourgeo_project_path(name, location = location, overwrite = overwrite)
  if (!file.copy(path, dest, overwrite = TRUE)) stop("Could not copy ", path, " into ", location, ".", call. = FALSE)
  ourgeo_project_commit()
}

#' Save files written to ourgeo_project_path() into the project now, rather than
#' when the command finishes. Returns what was saved.
ourgeo_project_commit <- function(quiet = FALSE, report = message) {
  pending <- .ourgeo_pf$pending
  done <- list(); rescans <- list()
  for (key in names(pending)) {
    entry <- pending[[key]]
    # Not written yet: a path handed out for a writer that has not run. Keep it.
    if (!file.exists(entry$path)) next
    .ourgeo_pf$pending[[key]] <- NULL
    if (identical(entry$kind, "linked")) {
      rescans[[entry$folderId]] <- entry$folderName
      done[[length(done) + 1L]] <- data.frame(file = entry$name, location = entry$folderName, action = "written", stringsAsFactors = FALSE)
      next
    }
    result <- tryCatch(
      .ourgeo_pf_request("put", list(path = entry$path, name = entry$name, folder = entry$folder, description = entry$description, overwrite = entry$overwrite)),
      error = function(e) {
        # Keep the staged bytes: the error names a recovery move, and the user
        # can then save them with ourgeo_project_save() without re-running.
        report(paste0("Project Files: ", entry$name, " was not saved: ", conditionMessage(e),
                      "\n  The written file is kept at ", entry$path, " — ourgeo_project_save(\"", entry$path, "\", \"", entry$name, "\") saves it once fixed."))
        NULL
      })
    if (is.null(result)) next
    unlink(dirname(entry$path), recursive = TRUE)
    if (!quiet) report(.ourgeo_pf_describe(result))
    done[[length(done) + 1L]] <- data.frame(file = entry$name, location = "project", action = result$action, stringsAsFactors = FALSE)
  }
  for (id in names(rescans)) {
    scanned <- tryCatch(.ourgeo_pf_request("rescan", list(id = id)), error = function(e) list(issue = conditionMessage(e)))
    if (!quiet || !is.null(scanned$issue)) {
      report(paste0("Project Files: wrote into linked folder ", rescans[[id]],
                    if (!is.null(scanned$issue)) paste0(" (rescan: ", scanned$issue, ")") else " and rescanned it."))
    }
  }
  invisible(if (length(done)) do.call(rbind, done) else data.frame(file = character(0), location = character(0), action = character(0)))
}

# Called by ouRGeo after every console command and chunk. A path handed out
# but never written to is forgotten with a note, rather than kept for ever and
# committed by some later, unrelated command.
.ourgeo_pf_finish_command <- function(report) {
  if (!length(.ourgeo_pf$pending)) return(invisible(NULL))
  tryCatch(ourgeo_project_commit(report = report), error = function(e) report(paste("Project Files:", conditionMessage(e))))
  for (key in names(.ourgeo_pf$pending)) {
    entry <- .ourgeo_pf$pending[[key]]
    report(paste0("Project Files: nothing was written to ", entry$name, ", so it was not saved."))
    if (identical(entry$kind, "project")) unlink(dirname(entry$path), recursive = TRUE)
  }
  .ourgeo_pf$pending <- list()
  invisible(NULL)
}

#' Save the plot showing in ouRGeo's Plots panel to a file — the plot-export
#' dialog's own R, and `ggsave()`'s counterpart for any plot, base graphics
#' included.
#'
#'   ourgeo_save_plot(ourgeo_project_path("figures/plot.png"), width = 7, height = 5, dpi = 300)
#'
#' @param plot NULL for the most recent plot, or the id the export dialog names.
ourgeo_save_plot <- function(file, width = 7, height = 5, units = c("in", "cm", "px"), dpi = 300, plot = NULL) {
  units <- match.arg(units)
  history <- if (exists(".ourgeo_env", envir = globalenv())) get(".ourgeo_env", envir = globalenv()) else NULL
  recorded <- if (is.null(history)) NULL else if (is.null(plot)) history$last_plot else history$plot_history[[as.character(plot)]]
  if (is.null(recorded)) {
    stop(if (is.null(history)) "There is no Plots panel in this session. Save with ggsave(), or png() + dev.off()."
         else if (is.null(plot)) "There is no plot to save yet. Draw one first."
         else "That plot is no longer held by this R session. Re-run the code that drew it.", call. = FALSE)
  }
  inches <- switch(units, `in` = c(width, height), cm = c(width, height) / 2.54, px = c(width, height) / dpi)
  ext <- tolower(tools::file_ext(file))
  if (ext == "pdf") grDevices::pdf(file, width = inches[1], height = inches[2])
  else if (ext %in% c("jpg", "jpeg")) grDevices::jpeg(file, width = round(inches[1] * dpi), height = round(inches[2] * dpi), res = dpi, quality = 95)
  else if (ext == "png") grDevices::png(file, width = round(inches[1] * dpi), height = round(inches[2] * dpi), res = dpi)
  else stop("Save the plot as .png, .jpg or .pdf.", call. = FALSE)
  device <- grDevices::dev.cur()
  on.exit(if (device %in% grDevices::dev.list()) grDevices::dev.off(device), add = TRUE)
  grDevices::replayPlot(recorded)
  invisible(file)
}
