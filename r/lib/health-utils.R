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
