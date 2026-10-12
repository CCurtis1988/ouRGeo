# Handlers: package management
# (extracted from server.R — behavior-preserving modularization)

package_path <- function(path) normalizePath(path, winslash = "/", mustWork = FALSE)

loaded_package_copy <- function(name, attached_only = FALSE) {
  attached <- paste0("package:", name) %in% search()
  if (attached_only && !attached) return(NULL)
  path <- if (attached) attr(as.environment(paste0("package:", name)), "path") else NULL
  if (name != "base" && isNamespaceLoaded(name)) {
    ns <- asNamespace(name)
    return(list(path = package_path(path %||% getNamespaceInfo(ns, "path")),
      version = as.character(getNamespaceVersion(ns))))
  }
  if (name == "base") return(list(path = package_path(file.path(.Library, "base")), version = as.character(getRversion())))
  if (is.null(path)) return(NULL)
  list(path = package_path(path), version = as.character(packageDescription(name, lib.loc = dirname(path))$Version))
}

valid_package_name <- function(name) {
  is.character(name) && length(name) == 1L && !is.na(name) && grepl("^[A-Za-z][A-Za-z0-9.]*$", name)
}

unload_package_copy <- function(name) {
  if (name %in% c("base", rownames(installed.packages(priority = "base")))) stop("Cannot unload base package")
  if (name %in% c("httpuv", "jsonlite", "later") && !is.null(.ourgeo_env$system_names)) {
    stop("Cannot unload ", name, " while it is running the ouRGeo R backend. Restart R to change this server package.")
  }
  if (isNamespaceLoaded(name)) {
    # unloadNamespace detaches BEFORE checking importers. Check them first so
    # a refused switch leaves the original package attached and usable.
    users <- getNamespaceUsers(asNamespace(name))
    if (length(users)) stop("Cannot unload ", name, ": it is imported by ", paste(users, collapse = ", "),
      ". Unload those packages first or restart R before switching versions.")
    unloadNamespace(name)
    if (isNamespaceLoaded(name)) stop("The namespace for ", name, " is still loaded. Restart R before switching versions.")
  } else if (paste0("package:", name) %in% search()) {
    detach(paste0("package:", name), unload = TRUE, character.only = TRUE)
  }
}

selected_package_copy <- function(body) {
  name <- body$name
  lib <- body$libPath
  if (!is.null(lib) && (!is.character(lib) || length(lib) != 1L || is.na(lib) || !nzchar(lib))) stop("Library path required")
  # Name-only callers retain R's default of reusing an existing namespace.
  current <- loaded_package_copy(name)
  if (is.null(lib) && !is.null(current)) lib <- dirname(current$path)
  path <- find.package(name, lib.loc = lib %||% .libPaths())
  lib <- normalizePath(lib %||% dirname(path), winslash = "/", mustWork = TRUE)
  version <- as.character(readRDS(file.path(path, "Meta", "package.rds"))$DESCRIPTION[["Version"]])
  if (!is.null(body$version) && !identical(body$version, version)) stop("The selected package version changed. Refresh Packages and select it again.")
  list(path = package_path(path), library = lib, version = version)
}

# Build the grouped library/package list. Shared by the /packages/list handler
# and the change-detected broadcast so both emit the identical shape.
build_libraries_list <- function() {
  # Cache installed.packages() since it's slow
  if (is.null(.ourgeo_env$packages_cache)) {
    .ourgeo_env$packages_cache <- installed.packages(lib.loc = unique(package_path(.libPaths())), noCache = TRUE)
  }
  ip <- .ourgeo_env$packages_cache

  # Currently attached packages
  attached <- sub("^package:", "", grep("^package:", search(), value = TRUE))
  attached_copies <- setNames(lapply(attached, loaded_package_copy, attached_only = TRUE), attached)

  # Base package names
  base_pkgs <- rownames(installed.packages(priority = "base"))

  # Group by LibPath — include all .libPaths() entries, even empty libraries
  lib_paths <- unique(c(package_path(.libPaths()), if (nrow(ip) > 0) ip[, "LibPath"] else character(0)))
  lapply(lib_paths, function(lp) {
    rows <- ip[ip[, "LibPath"] == lp, , drop = FALSE]
    pkg_names <- sort(rownames(rows))
    packages <- lapply(pkg_names, function(nm) {
      copy <- attached_copies[[nm]]
      list(
        name = nm,
        version = as.character(rows[nm, "Version"]),
        loaded = !is.null(copy) && identical(copy$path, package_path(file.path(lp, nm))) &&
          identical(copy$version, as.character(rows[nm, "Version"])),
        isBase = nm %in% base_pkgs
      )
    })
    list(path = lp, packages = packages)
  })
}

handle_packages_list <- function() {
  json_response(list(success = TRUE, libraries = build_libraries_list()))
}

# ---------------------------------------------------------------------------
# Incremental package change tracking
#
# Mirrors the .GlobalEnv change-detection in util-env.R: after code runs we
# want the Packages panel (and the library()/require() autocomplete) to reflect
# newly installed or newly attached packages without a manual refresh. A full
# rebuild walks installed.packages() (slow), so we first compute a cheap
# signature and only rebuild + broadcast when it changes.
#
# The signature has two parts:
#   * installed — .libPaths() plus a count of package directories in each
#     (detects install/remove without reading every DESCRIPTION)
#   * attach    — search() plus loaded paths/versions (also detects switching
#     copies when the final search() names are unchanged)
# The slow installed.packages() cache is invalidated only when the installed
# part changes, so a bare library() call doesn't force a re-scan.
# ---------------------------------------------------------------------------
packages_state <- function() {
  attached <- sub("^package:", "", grep("^package:", search(), value = TRUE))
  copies <- vapply(attached, function(name) {
    copy <- loaded_package_copy(name, attached_only = TRUE)
    paste(name, copy$path, copy$version, sep = "@")
  }, "")
  attach_sig <- paste(c(search(), copies), collapse = ";")
  libs <- .libPaths()
  installed_sig <- tryCatch(
    paste0(
      paste(libs, collapse = ";"), "#",
      sum(vapply(libs, function(lp)
        length(list.dirs(lp, recursive = FALSE, full.names = FALSE)),
        integer(1)))
    ),
    error = function(e) paste(libs, collapse = ";")
  )
  list(attach = attach_sig, installed = installed_sig)
}

broadcast_packages_if_changed <- function() {
  st <- tryCatch(packages_state(), error = function(e) NULL)
  if (is.null(st)) return(invisible(NULL))
  fp <- paste0(st$installed, "||", st$attach)
  prev <- .ourgeo_env$pkg_fingerprint
  if (identical(fp, prev)) return(invisible(NULL))

  # Only a real install/remove (installed part changed) needs the slow re-scan.
  installed_changed <- is.null(prev) || !identical(sub("\\|\\|.*$", "", prev), st$installed)
  .ourgeo_env$pkg_fingerprint <- fp
  if (installed_changed) .ourgeo_env$packages_cache <- NULL

  libs <- tryCatch(build_libraries_list(), error = function(e) NULL)
  if (!is.null(libs)) broadcast_system(list(type = "packages", data = list(libraries = libs)))
  invisible(NULL)
}

handle_packages_load <- function(body) {
  name <- body$name
  if (!valid_package_name(name)) return(error_response("Valid package name required"))

  result <- tryCatch(
    withCallingHandlers(
      {
        target <- selected_package_copy(body)
        current <- loaded_package_copy(name)
        if (!is.null(current) && (!identical(current$path, target$path) || !identical(current$version, target$version))) {
          unload_package_copy(name)
          broadcast_console(paste("Unloaded", name, current$version, "from", dirname(current$path)))
        }
        library(name, lib.loc = target$library, character.only = TRUE)
        actual <- loaded_package_copy(name, attached_only = TRUE)
        if (is.null(actual) || !identical(actual$path, target$path) || !identical(actual$version, target$version)) {
          stop("R did not attach the selected package copy. Refresh Packages and restart R before trying again.")
        }
        list(success = TRUE)
      },
      message = function(m) {
        msg_text <- sub("\n$", "", conditionMessage(m))
        broadcast_console(msg_text)
        invokeRestart("muffleMessage")
      },
      warning = function(w) {
        broadcast_console(paste("Warning:", conditionMessage(w)), "stderr")
        invokeRestart("muffleWarning")
      }
    ),
    error = function(e) {
      list(success = FALSE, error = conditionMessage(e))
    }
  )

  # A stale GUI row can fail version validation without changing search().
  # Rebuild from disk on the ensuing refresh, including that failure case.
  .ourgeo_env$packages_cache <- NULL
  broadcast_packages_if_changed()

  if (isTRUE(result$success)) {
    ok_response()
  } else {
    error_response(result$error %||% "Failed to load package")
  }
}

handle_packages_install <- function(body) {
  code <- body$code %||% stop("code required")

  # Write a temp script that runs the install code and emits sentinel lines
  script_file <- tempfile(fileext = ".R")
  outfile     <- tempfile(fileext = ".txt")

  lib_paths <- paste0('"', .libPaths(), '"', collapse = ", ")
  script_body <- paste0(
    ".libPaths(c(", lib_paths, "))\n",
    "tryCatch({\n",
    "  ", code, "\n",
    "  cat('OURGEO_INSTALL_SUCCESS\\n')\n",
    "}, error = function(e) {\n",
    "  cat(paste0('OURGEO_INSTALL_ERROR:', conditionMessage(e), '\\n'))\n",
    "})\n",
    "cat('OURGEO_INSTALL_COMPLETE\\n')\n"
  )
  writeLines(script_body, script_file)

  # Launch Rscript non-blocking — stdout+stderr go to outfile
  rscript <- file.path(R.home("bin"), "Rscript")
  cmd <- sprintf("%s --no-save --no-restore %s >> %s 2>&1",
                 shQuote(rscript), shQuote(script_file), shQuote(outfile))
  system(cmd, wait = FALSE)

  job_id <- paste0("job_", as.character(runif(1)))
  .ourgeo_env$install_jobs[[job_id]] <- list(
    outfile  = outfile,
    script   = script_file,
    last_pos = 0L,
    success  = NULL
  )

  later::later(function() poll_install_job(job_id), 0.2)

  json_response(list(success = TRUE, status = "running"))
}

poll_install_job <- function(job_id) {
  job <- .ourgeo_env$install_jobs[[job_id]]
  if (is.null(job)) return()

  done    <- FALSE
  success <- NULL

  if (file.exists(job$outfile)) {
    size <- file.info(job$outfile)$size
    if (!is.na(size) && size > job$last_pos) {
      con <- file(job$outfile, "rb")
      seek(con, job$last_pos)
      raw_bytes <- readBin(con, "raw", n = size - job$last_pos)
      close(con)
      .ourgeo_env$install_jobs[[job_id]]$last_pos <- size

      lines <- strsplit(rawToChar(raw_bytes), "\n")[[1]]
      for (line in lines) {
        if (grepl("^OURGEO_INSTALL_SUCCESS$", line)) {
          success <- TRUE
        } else if (grepl("^OURGEO_INSTALL_ERROR:", line)) {
          success <- FALSE
        } else if (grepl("^OURGEO_INSTALL_COMPLETE$", line)) {
          done <- TRUE
        } else if (nchar(trimws(line)) > 0) {
          broadcast_console(trimws(line))
        }
      }
    }
  }

  if (done) {
    if (isTRUE(success)) .ourgeo_env$packages_cache <- NULL
    broadcast_system(list(type = "install_complete", success = isTRUE(success)))
    unlink(c(job$outfile, job$script))
    .ourgeo_env$install_jobs[[job_id]] <- NULL
  } else {
    later::later(function() poll_install_job(job_id), 0.2)
  }
}

handle_packages_unload <- function(body) {
  name <- body$name
  if (!valid_package_name(name)) return(error_response("Valid package name required"))

  result <- tryCatch(
    {
      current <- loaded_package_copy(name)
      if (!is.null(body$libPath) && (is.null(current) ||
          !identical(current$path, package_path(file.path(body$libPath, name))) ||
          (!is.null(body$version) && !identical(current$version, body$version)))) {
        stop("A different package copy is loaded. Refresh Packages before unloading.")
      }
      unload_package_copy(name)
      list(success = TRUE)
    },
    error = function(e) {
      list(success = FALSE, error = conditionMessage(e))
    }
  )

  .ourgeo_env$packages_cache <- NULL
  broadcast_packages_if_changed()

  if (isTRUE(result$success)) {
    ok_response()
  } else {
    error_response(result$error %||% "Failed to unload package")
  }
}

handle_packages_addlibpath <- function(body) {
  path <- body$path %||% stop("path required")
  path <- normalizePath(path, mustWork = FALSE)

  # Create directory if it doesn't exist
  if (!dir.exists(path)) {
    dir.create(path, recursive = TRUE, showWarnings = FALSE)
    if (!dir.exists(path))
      return(error_response(paste("Failed to create directory:", path)))
  }

  # Add to current session .libPaths()
  .libPaths(unique(c(path, .libPaths())))

  # Persist to ~/.Rprofile inside an ouRGeo-managed block
  tryCatch({
    rprofile   <- path.expand("~/.Rprofile")
    begin_mark <- "## ouRGeo:libpaths:begin"
    end_mark   <- "## ouRGeo:libpaths:end"

    lines <- if (file.exists(rprofile)) readLines(rprofile, warn = FALSE) else character(0)
    bi <- which(lines == begin_mark)
    ei <- which(lines == end_mark)

    managed <- character(0)
    if (length(bi) == 1 && length(ei) == 1 && bi < ei) {
      block <- lines[(bi + 1):(ei - 1)]
      m <- regmatches(block, regexpr('"[^"]+"', block))
      managed <- gsub('"', '', m)
    }
    managed <- unique(c(managed, path))

    path_lines <- paste0('    "', managed, '"')
    if (length(path_lines) > 1)
      path_lines[-length(path_lines)] <- paste0(path_lines[-length(path_lines)], ",")

    new_block <- c(
      begin_mark,
      "local({",
      "  paths <- c(",
      path_lines,
      "  )",
      "  .libPaths(unique(c(paths, .libPaths())))",
      "})",
      end_mark
    )

    if (length(bi) == 1 && length(ei) == 1 && bi < ei) {
      before <- if (bi > 1) lines[1:(bi - 1)] else character(0)
      after  <- if (ei < length(lines)) lines[(ei + 1):length(lines)] else character(0)
      new_lines <- c(before, new_block, after)
    } else {
      sep <- if (length(lines) > 0) "" else character(0)
      new_lines <- c(lines, sep, new_block)
    }
    writeLines(new_lines, rprofile)
  }, error = function(e) {
    broadcast_console(
      paste("Warning: Could not persist library path to .Rprofile:", conditionMessage(e)),
      "stderr"
    )
  })

  .ourgeo_env$packages_cache <- NULL
  json_response(list(success = TRUE, path = path, libPaths = as.list(.libPaths())))
}

handle_packages_check_version <- function(body) {
  name     <- body$name
  lib_path <- body$libPath

  tryCatch({
    desc          <- packageDescription(name, lib.loc = lib_path)
    installed_ver <- if (!isFALSE(desc)) desc$Version else NA_character_

    cran_ver <- tryCatch({
      pkgs <- available.packages(repos = "https://cran.r-project.org")
      if (name %in% rownames(pkgs)) pkgs[name, "Version"] else NA_character_
    }, error = function(e) NA_character_)

    up_to_date <- !is.na(cran_ver) && !is.na(installed_ver) &&
                  package_version(installed_ver) >= package_version(cran_ver)

    json_response(list(
      success  = TRUE,
      installed = if (is.na(installed_ver)) NULL else installed_ver,
      cran      = if (is.na(cran_ver)) NULL else cran_ver,
      upToDate  = up_to_date
    ))
  }, error = function(e) {
    error_response(conditionMessage(e))
  })
}

handle_packages_cran_list <- function() {
  if (!is.null(.ourgeo_env$cran_pkg_cache)) {
    return(json_response(list(success = TRUE, packages = .ourgeo_env$cran_pkg_cache)))
  }

  result <- tryCatch({
    pkgs <- available.packages(
      repos = "https://cran.r-project.org",
      fields = c("Package", "Title")
    )
    pkg_list <- lapply(seq_len(nrow(pkgs)), function(i) {
      list(
        name  = as.character(pkgs[i, "Package"]),
        title = as.character(pkgs[i, "Title"])
      )
    })
    .ourgeo_env$cran_pkg_cache <- pkg_list
    list(success = TRUE, packages = pkg_list)
  }, error = function(e) {
    list(success = FALSE, error = conditionMessage(e), packages = list())
  })

  json_response(result)
}

# ---------------------------------------------------------------------------
# Object viewer handlers
# ---------------------------------------------------------------------------

# Helper: resolve an object by access path (supports $, [[ ]] notation)
