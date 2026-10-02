# Runs independently of server.R: diagnostics and repairs must work even when
# httpuv/jsonlite or a compiled dependency cannot load after an R upgrade.
args <- commandArgs(trailingOnly = TRUE)
script_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)[1]
source(file.path(dirname(normalizePath(sub("^--file=", "", script_arg))), "lib", "health-utils.R"))
mode <- if (length(args)) args[1] else "runtime"
emit <- function(...) {
  values <- vapply(list(...), function(x) gsub("[\t\r\n]", " ", as.character(x)), "")
  cat("OURGEO_HEALTH\t", paste(values, collapse = "\t"), "\n", sep = "")
}
catalog <- list(
  Core = c("httpuv", "jsonlite", "later", "httr2"),
  Spatial = c("sf", "terra", "ggplot2", "tmap", "ggspatial", "maptiles", "tidyterra", "png", "geojsonsf", "geos"),
  Curves = "sfarc",
  Database = c("DBI", "duckdb", "dplyr", "data.table"),
  Documents = c("knitr", "rmarkdown")
)
# R expands its standard R_LIBS_USER placeholders during startup. Creating this
# library makes it visible to future Rscript sessions, without editing profiles.
user_lib <- strsplit(Sys.getenv("R_LIBS_USER"), .Platform$path.sep, fixed = TRUE)[[1]]
user_lib <- if (length(user_lib) && nzchar(user_lib[1])) path.expand(user_lib[1]) else .libPaths()[1]
emit("runtime", as.character(getRversion()), user_lib)
if (mode == "runtime") quit(status = 0)

if (mode == "repair") {
  targets <- args[-1]
  if (!length(targets) || any(!grepl("^[A-Za-z][A-Za-z0-9.]*$", targets))) stop("Invalid package selection")
  dir.create(user_lib, recursive = TRUE, showWarnings = FALSE)
  if (file.access(user_lib, 2) != 0L) stop("Your R user library is not writable: ", user_lib)
  .libPaths(c(user_lib, .libPaths()))
  options(repos = c(CRAN = "https://cloud.r-project.org"), timeout = 300, warn = 1)
  cran <- setdiff(targets, "sfarc")
  if (length(cran)) install.packages(cran, lib = user_lib)
  if ("sfarc" %in% targets) {
    if (!requireNamespace("remotes", quietly = TRUE)) install.packages("remotes", lib = user_lib)
    remotes::install_github("CCurtis1988/sfarc", lib = user_lib, upgrade = "never")
  }
  # install.packages can warn and still exit 0. The caller always re-probes
  # loading, versions and Built metadata before marking a repair successful.
  quit(status = 0)
}

options(timeout = 15)
installed <- installed.packages()
available <- tryCatch(suppressWarnings(available.packages(repos = "https://cloud.r-project.org")), error = function(e) matrix(character(), 0, 0))
# CRAN metadata also gives us dependencies when a core package is missing.
dep_db <- if (nrow(available)) available else installed
deps <- unique(unlist(tools::package_dependencies(catalog$Core, db = dep_db,
  which = c("Depends", "Imports", "LinkingTo"), recursive = TRUE)))
deps <- setdiff(deps, c("R", unlist(catalog), installed[installed[, "Priority"] %in% c("base", "recommended"), "Package"]))
catalog$`Core dependency` <- deps
updates_checked <- nrow(available) > 0
emit("updates", updates_checked)
for (group in names(catalog)) for (pkg in catalog[[group]]) {
  ver <- if (pkg %in% rownames(installed)) installed[pkg, "Version"] else ""
  built <- if (pkg %in% rownames(installed)) installed[pkg, "Built"] else ""
  built <- sub("^R ([0-9.]+).*", "\\1", built)
  latest <- if (updates_checked && pkg %in% rownames(available)) available[pkg, "Version"] else ""
  loaded <- tryCatch(suppressWarnings(requireNamespace(pkg, quietly = TRUE)), error = function(e) FALSE)
  reason <- health_package_reason(ver, built, latest, loaded, as.character(getRversion()))
  emit("package", pkg, group, ver, latest, built, loaded, reason)
}
parent <- user_lib
while (!dir.exists(parent) && dirname(parent) != parent) parent <- dirname(parent)
emit("library", user_lib, file.access(parent, 2) == 0L)
pandoc <- nzchar(Sys.which("pandoc")) || tryCatch(requireNamespace("rmarkdown", quietly = TRUE) && rmarkdown::pandoc_available(), error = function(e) FALSE)
emit("tools", pandoc, nzchar(Sys.which("pdflatex")) || nzchar(Sys.which("xelatex")))
