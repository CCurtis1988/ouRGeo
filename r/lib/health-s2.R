# sf can load while S2 has a broken native-library link. Exercise the engine
# directly, without sf or the running backend, and retain its loader message.
health_s2_probe <- function() {
  loaded <- FALSE
  tryCatch({
    suppressWarnings(loadNamespace("s2"))
    loaded <- TRUE
    points <- c("POINT (0 0)", "POINT (1 1)", "POINT (-1 -1)")
    distance <- s2::s2_distance(points[1], "POINT (0.001 0)")
    if (length(distance) != 1L || !is.finite(distance) || abs(distance - 111.195) > 0.1)
      stop("Spherical distance test returned an unexpected result")
    buffers <- s2::s2_buffer_cells(points, distance = 100, max_cells = 1000)
    area <- s2::s2_area(buffers)
    if (length(buffers) != 3L || any(!is.finite(area)) ||
        any(area < pi * 100^2 * 0.99 | area > pi * 100^2 * 1.1) ||
        !isTRUE(all(s2::s2_is_valid(buffers))) || !isTRUE(all(s2::s2_contains(buffers, points))))
      stop("100-metre buffer, validity or containment test returned an unexpected result")
    list(ok = TRUE, loaded = TRUE,
      detail = "Spherical distance and three valid 100-metre point buffers passed.")
  }, error = function(e) list(ok = FALSE, loaded = loaded, detail = conditionMessage(e)))
}

health_s2_platform <- function(os = Sys.info()[["sysname"]]) {
  switch(os, Windows = "windows", Darwin = "macos", Linux = "linux", "other")
}

health_s2_repair_detail <- function(platform = health_s2_platform()) {
  switch(platform,
    windows = "Windows: reinstall the compatible CRAN binary using the selected R. Rtools is only needed for a manual source build; use the version matching R (https://cran.r-project.org/bin/windows/Rtools/).",
    macos = "macOS: reinstall the compatible CRAN binary for the selected R and its architecture. If this R has no binary support, use CRAN R (https://cran.r-project.org/bin/macosx/) or build manually with Xcode Command Line Tools, CMake, pkg-config and OpenSSL (brew install cmake pkg-config openssl).",
    linux = "Linux: rebuild S2 from CRAN source with bundled Abseil to avoid broken system Abseil links. Needs a C++17 compiler, make, CMake, pkg-config and OpenSSL headers. Debian/Ubuntu: sudo apt-get install build-essential cmake pkg-config libssl-dev; Fedora/RHEL: sudo dnf install gcc-c++ make cmake pkgconf-pkg-config openssl-devel; Arch: sudo pacman -S --needed base-devel cmake pkgconf openssl; openSUSE: sudo zypper install gcc-c++ make cmake pkg-config libopenssl-devel. Install missing system prerequisites, then retry the approved package repair.",
    "Reinstall S2 from CRAN with this R installation; see https://r-spatial.github.io/s2/ for system requirements.")
}

# A custom .Rprofile may prepend a library ahead of R_LIBS_USER. Installing
# into the latter would leave the broken copy active on the next launch.
health_s2_library <- function(user_lib, libraries = .libPaths()) {
  active <- which(dir.exists(file.path(libraries, "s2")))[1]
  candidates <- if (!is.na(active)) c(libraries[active], head(libraries, active - 1L)) else unique(c(libraries, user_lib))
  for (lib in candidates) {
    parent <- lib
    while (!dir.exists(parent) && dirname(parent) != parent) parent <- dirname(parent)
    path <- file.path(lib, "s2")
    link <- Sys.readlink(path)
    if (file.access(parent, 2) == 0L &&
        (!dir.exists(path) || file.access(path, 2) == 0L) && (is.na(link) || !nzchar(link))) return(lib)
  }
  stop("The active S2 library is protected and no earlier library is writable. In Packages, configure a writable library before it, restart R, then rerun Health check.")
}

health_s2_repair <- function(lib, platform = health_s2_platform(),
    pkg_type = getOption("pkgType"), install = utils::install.packages,
    which = Sys.which) {
  detail <- health_s2_repair_detail(platform)
  if (platform %in% c("windows", "macos")) {
    if (is.null(pkg_type) || identical(pkg_type, "source"))
      stop("This R installation does not support CRAN binaries. ", detail)
    message(detail)
    message('install.packages("s2", lib = ', encodeString(lib, quote = '"'), ', type = "binary")')
    install("s2", lib = lib, type = "binary")
  } else {
    missing <- c("cmake", "make", "pkg-config")[!nzchar(which(c("cmake", "make", "pkg-config")))]
    if (length(missing)) stop("Missing S2 build tools: ", paste(missing, collapse = ", "), ". ", detail)
    previous <- Sys.getenv("S2_FORCE_BUNDLED_ABSEIL", unset = NA_character_)
    on.exit(if (is.na(previous)) Sys.unsetenv("S2_FORCE_BUNDLED_ABSEIL") else
      Sys.setenv(S2_FORCE_BUNDLED_ABSEIL = previous), add = TRUE)
    Sys.setenv(S2_FORCE_BUNDLED_ABSEIL = "true")
    message(detail)
    message('Sys.setenv(S2_FORCE_BUNDLED_ABSEIL = "true")\ninstall.packages("s2", lib = ',
      encodeString(lib, quote = '"'), ', type = "source")')
    install("s2", lib = lib, type = "source")
  }
}
