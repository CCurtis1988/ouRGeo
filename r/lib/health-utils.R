# Shared with the independent diagnostics script; no package dependencies.
health_package_reason <- function(version, built, latest, loaded, r_version) {
  built <- sub("^R ([0-9.]+).*", "\\1", built)
  minor <- function(v) paste(head(strsplit(v, "\\.")[[1]], 2), collapse = ".")
  reasons <- c(if (!nzchar(version)) "missing",
    if (nzchar(version) && !loaded) "cannot load",
    if (nzchar(built) && minor(built) != minor(r_version)) paste0("rebuild for R ", minor(r_version)),
    if (nzchar(version) && nzchar(latest) && utils::compareVersion(latest, version) > 0) paste0("update to ", latest))
  paste(reasons, collapse = "; ")
}

# Inspect each library separately: row-name lookup hides shadowed installations.
health_package_copies <- function(libraries = .libPaths()) {
  libraries <- unique(normalizePath(libraries, winslash = "/", mustWork = TRUE))
  copies <- data.frame(name = character(), version = character(), library = character(),
    built = character(), active = logical(), removable = logical(), stringsAsFactors = FALSE)
  for (lib in libraries) {
    installed <- installed.packages(lib.loc = lib, noCache = TRUE)
    if (!nrow(installed)) next
    pkg <- installed[, "Package"]
    priority <- installed[, "Priority"]
    path <- file.path(lib, pkg)
    link <- Sys.readlink(path)
    copies <- rbind(copies, data.frame(name = pkg, version = installed[, "Version"],
      library = lib, built = sub("^R ([0-9.]+).*", "\\1", installed[, "Built"]),
      active = !pkg %in% copies$name,
      removable = (is.na(priority) | !priority %in% c("base", "recommended")) &
        file.access(lib, 2) == 0L & file.access(path, 2) == 0L & (is.na(link) | !nzchar(link)),
      stringsAsFactors = FALSE))
  }
  copies
}

health_duplicate_copies <- function(copies) {
  copies[duplicated(copies$name) | duplicated(copies$name, fromLast = TRUE), , drop = FALSE]
}

health_remove_copies <- function(targets, libraries = .libPaths()) {
  if (!nrow(targets) || any(!grepl("^[A-Za-z][A-Za-z0-9.]*$", targets$name)) ||
      anyDuplicated(targets[c("name", "library")])) stop("Invalid duplicate selection")
  copies <- health_duplicate_copies(health_package_copies(libraries))
  # Validate the entire plan against a fresh inventory before removing anything.
  for (i in seq_len(nrow(targets))) {
    target <- targets[i, ]
    found <- copies[copies$name == target$name & copies$library == target$library &
      copies$version == target$version, , drop = FALSE]
    if (nrow(found) != 1L || !found$removable) stop("Package copy changed or is protected; recheck packages: ", target$name)
  }
  for (pkg in unique(targets$name)) {
    if (sum(copies$name == pkg) <= sum(targets$name == pkg)) stop("Keep at least one installation of ", pkg)
  }
  for (i in seq_len(nrow(targets))) {
    target <- targets[i, ]
    message("Removing ", target$name, " ", target$version, " from ", target$library)
    remove.packages(target$name, lib = target$library)
    if (dir.exists(file.path(target$library, target$name))) stop("Could not remove ", target$name, " from ", target$library)
  }
}
