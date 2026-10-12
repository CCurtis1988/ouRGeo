# Real, isolated installed packages: no network and no changes to user libraries.
local({
  root <- tempfile("ourgeo-package-copies-")
  dir.create(root)
  on.exit(unlink(root, recursive = TRUE), add = TRUE)
  libs <- file.path(root, c("first library", "second library", "same version library", "broken library"))
  invisible(lapply(libs, dir.create))
  libs <- normalizePath(libs, winslash = "/")
  .libPaths(c(libs, .libPaths()))
  original_paths <- .libPaths()
  pkg <- "ourgeoPackageFixture"
  importer <- "ourgeoPackageImporter"

  install_fixture <- function(lib, name, version, imports = FALSE, broken = FALSE) {
    src <- file.path(root, paste0(name, "-", basename(lib)))
    dir.create(file.path(src, "R"), recursive = TRUE)
    desc <- c(Package = name, Version = version, Title = "Package selection fixture",
      Description = "Tests loading an exact installed package copy.",
      Author = "ouRGeo", Maintainer = "ouRGeo <tests@example.com>", License = "MIT",
      if (imports) c(Imports = pkg))
    write.dcf(as.data.frame(as.list(desc)), file.path(src, "DESCRIPTION"))
    if (imports) {
      writeLines(c(paste0("importFrom(", pkg, ", fixture_version)"), "export(importer_version)"), file.path(src, "NAMESPACE"))
      code <- "importer_version <- function() fixture_version()"
    } else {
      writeLines("export(fixture_version)", file.path(src, "NAMESPACE"))
      code <- c(paste0("fixture_version <- function() '", version, "'"),
        paste0(".onLoad <- function(libname, pkgname) { options(ourgeo.fixture.events = c(getOption('ourgeo.fixture.events'), 'load-", version, "')); ",
          if (broken) "stop('Fixture cannot load')" else "invisible(NULL)", " }"),
        paste0(".onUnload <- function(libpath) options(ourgeo.fixture.events = c(getOption('ourgeo.fixture.events'), 'unload-", version, "'))"))
    }
    writeLines(code, file.path(src, "R", "fixture.R"))
    output <- system2(file.path(R.home("bin"), if (.Platform$OS.type == "windows") "R.exe" else "R"),
      shQuote(c("CMD", "INSTALL", "--no-byte-compile", "--no-test-load", "--no-help", "--no-demo", paste0("--library=", lib), src)),
      stdout = TRUE, stderr = TRUE)
    if (!is.null(attr(output, "status"))) stop(paste(output, collapse = "\n"))
  }
  install_fixture(libs[1], pkg, "1.0")
  install_fixture(libs[2], pkg, "2.0")
  install_fixture(libs[3], pkg, "1.0")
  install_fixture(libs[4], pkg, "3.0", broken = TRUE)
  install_fixture(libs[1], importer, "1.0", imports = TRUE)

  .ourgeo_env <- new.env(parent = emptyenv())
  .ourgeo_env$packages_cache <- NULL
  .ourgeo_env$pkg_fingerprint <- NULL
  .ourgeo_env$broadcasts <- list()
  `%||%` <- function(x, y) if (!is.null(x)) x else y
  json_response <- function(data, ...) data
  ok_response <- function(...) list(success = TRUE)
  error_response <- function(msg, ...) list(success = FALSE, error = msg)
  broadcast_console <- function(...) invisible(NULL)
  broadcast_system <- function(data) .ourgeo_env$broadcasts <- c(.ourgeo_env$broadcasts, list(data))
  source("r/lib/handlers-packages.R", local = TRUE)
  attached_copies <- function() {
    libraries <- build_libraries_list()
    unlist(lapply(libraries, function(lib) {
      if (any(vapply(lib$packages, function(p) p$name == pkg && p$loaded, logical(1)))) lib$path else character()
    }), use.names = FALSE)
  }
  load_copy <- function(i, version) handle_packages_load(list(name = pkg, libPath = libs[i], version = version))
  unload_copy <- function(i, version) handle_packages_unload(list(name = pkg, libPath = libs[i], version = version))
  assert_loaded <- function(i, version) {
    stopifnot(identical(attached_copies(), libs[i]),
      identical(as.character(getNamespaceVersion(pkg)), version),
      identical(package_path(getNamespaceInfo(asNamespace(pkg), "path")), file.path(libs[i], pkg)))
  }

  stopifnot(length(attached_copies()) == 0L)
  stopifnot(load_copy(2, "2.0")$success)
  assert_loaded(2, "2.0")
  stopifnot(get("fixture_version", as.environment(paste0("package:", pkg)))() == "2.0")
  # A stale row or invalid target must not unload the current namespace.
  stopifnot(!load_copy(1, "9.0")$success)
  stopifnot(!handle_packages_load(list(name = pkg, libPath = file.path(root, "missing")))$success)
  assert_loaded(2, "2.0")
  # Name-only callers preserve the currently loaded copy.
  stopifnot(handle_packages_load(list(name = pkg))$success)
  assert_loaded(2, "2.0")
  # A changed installation must refresh even when a stale request is refused
  # before search() or the loaded namespace changes.
  metadata_path <- file.path(libs[1], pkg, "Meta", "package.rds")
  metadata <- readRDS(metadata_path)
  changed <- metadata
  changed$DESCRIPTION[["Version"]] <- "1.1"
  saveRDS(changed, metadata_path)
  stopifnot(!load_copy(1, "1.0")$success)
  updated <- Filter(function(lib) lib$path == libs[1], build_libraries_list())[[1]]
  stopifnot(Filter(function(p) p$name == pkg, updated$packages)[[1]]$version == "1.1")
  saveRDS(metadata, metadata_path)
  .ourgeo_env$packages_cache <- NULL
  # Switching preserves search() names but must still update the GUI.
  before_search <- search()
  before_state <- packages_state()$attach
  before_broadcasts <- length(.ourgeo_env$broadcasts)
  stopifnot(load_copy(1, "1.0")$success)
  assert_loaded(1, "1.0")
  stopifnot(identical(tail(getOption("ourgeo.fixture.events"), 2), c("unload-2.0", "load-1.0")),
    identical(before_search, search()), !identical(before_state, packages_state()$attach),
    length(.ourgeo_env$broadcasts) > before_broadcasts)
  stopifnot(get("fixture_version", as.environment(paste0("package:", pkg)))() == "1.0")
  # Equal versions in different libraries still represent different copies.
  stopifnot(load_copy(3, "1.0")$success)
  assert_loaded(3, "1.0")
  stopifnot(identical(tail(getOption("ourgeo.fixture.events"), 2), c("unload-1.0", "load-1.0")))
  stopifnot(!unload_copy(1, "1.0")$success)
  assert_loaded(3, "1.0")
  stopifnot(unload_copy(3, "1.0")$success, !isNamespaceLoaded(pkg), length(attached_copies()) == 0L)
  # An imported-only namespace also needs unloading when switching copies.
  loadNamespace(pkg, lib.loc = libs[1])
  stopifnot(length(attached_copies()) == 0L, load_copy(2, "2.0")$success)
  assert_loaded(2, "2.0")
  library(importer, lib.loc = libs[1], character.only = TRUE)
  refused <- load_copy(1, "1.0")
  stopifnot(!refused$success, grepl(importer, refused$error), !unload_copy(2, "2.0")$success)
  assert_loaded(2, "2.0")
  stopifnot(handle_packages_unload(list(name = importer, libPath = libs[1], version = "1.0"))$success)
  stopifnot(load_copy(1, "1.0")$success)
  assert_loaded(1, "1.0")
  # If the new namespace fails after unloading, no stale loaded row survives.
  failed <- load_copy(4, "3.0")
  stopifnot(!failed$success, grepl("Fixture cannot load", failed$error),
    !isNamespaceLoaded(pkg), length(attached_copies()) == 0L)
  # Loads from user code are also attributed to their actual library.
  library(pkg, lib.loc = libs[2], character.only = TRUE)
  assert_loaded(2, "2.0")
  before_broadcasts <- length(.ourgeo_env$broadcasts)
  broadcast_packages_if_changed()
  stopifnot(length(.ourgeo_env$broadcasts) > before_broadcasts)
  stopifnot(identical(original_paths, .libPaths()))
  stopifnot(!handle_packages_unload(list(name = "base"))$success)
  .ourgeo_env$system_names <- c("server")
  protected <- handle_packages_unload(list(name = "jsonlite"))
  stopifnot(!protected$success, grepl("R backend", protected$error))
  unloadNamespace(pkg)
  cat("Package copy loading acceptance passed\n")
})
