# Handlers: coordinate geometry — what a distance and a bearing mean here.
#
# The renderer can walk a geodesic on its own (`src/lib/draw/cogo.ts`), and for
# the geodesic basis it does: no round trip, no dependency on a serial R server
# while somebody is typing. What it cannot do is project. A grid bearing off a
# survey plat is measured from GRID north and its distance is a GRID distance,
# and turning that into a position needs the layer's own CRS — which means
# PROJ, which means R.
#
# Putting a second projection engine in the renderer (proj4js) was the obvious
# alternative and is the wrong one twice over: it is a dependency, and its
# disagreement with PROJ over datum shifts would land as metres of silent error
# when the geometry it produced was transformed BACK to the layer's CRS on save.
# One engine writes the geometry; the same engine should decide where it goes.
#
# `ourgeo_traverse()` at the bottom of this file is a user-facing name on
# purpose: it is echoed to the console, so the user gets a runnable line that
# reproduces the traverse they typed. Defined at startup, so the `system_names`
# snapshot at the end of server.R already keeps it out of their Environment
# panel and out of their project bundles.

# ---------------------------------------------------------------------------
# What the entry strip needs to know about a layer's coordinate system.
#
# `crs$input` alone cannot answer "is this projected?" — it is whatever string
# the CRS was created from. The strip needs the answer to pick its default
# basis and its default unit, so it asks for it rather than guessing from text.
# ---------------------------------------------------------------------------
handle_spatial_crs <- function(body) {
  if (!requireNamespace("sf", quietly = TRUE)) {
    return(error_response("sf package is not installed"))
  }
  tryCatch({
    crs <- if (!is.null(body$crs)) {
      sf::st_crs(if (is.numeric(body$crs)) as.integer(body$crs) else as.character(body$crs))
    } else {
      name <- body$name %||% stop("name or crs required")
      env <- resolve_env(body$envName %||% ".GlobalEnv")
      sf::st_crs(get(name, envir = env))
    }

    if (is.na(crs)) {
      return(json_response(list(
        success = TRUE,
        input = NULL, epsg = NULL, name = NULL,
        isGeographic = TRUE, unitName = NULL, unitToMetre = NULL
      )))
    }

    geographic <- isTRUE(sf::st_is_longlat(crs))
    # `units_gdal` is the CRS's own linear unit ("metre", "US survey foot").
    # A geographic CRS has none worth reporting — its axes are degrees, and a
    # distance in degrees is not a distance.
    unit_name <- if (geographic) NULL else tryCatch(crs$units_gdal, error = function(e) NULL)
    to_metre <- if (is.null(unit_name)) NULL else .ourgeo_unit_to_metre(unit_name)

    json_response(list(
      success = TRUE,
      input = crs$input %||% NULL,
      epsg = if (is.null(crs$epsg) || is.na(crs$epsg)) NULL else as.integer(crs$epsg),
      name = tryCatch(crs$Name, error = function(e) NULL) %||% NULL,
      isGeographic = geographic,
      unitName = unit_name,
      unitToMetre = to_metre
    ), digits = NA)
  }, error = function(e) error_response(conditionMessage(e)))
}

# The linear units a projected CRS is actually defined in. Anything else is
# reported as unknown rather than guessed: a wrong factor here would scale a
# whole traverse silently, which is the failure this feature exists to prevent.
.ourgeo_unit_to_metre <- function(unit_name) {
  switch(
    tolower(as.character(unit_name)),
    "metre" = 1, "meter" = 1, "m" = 1,
    "kilometre" = 1000, "kilometer" = 1000,
    "foot" = 0.3048, "international foot" = 0.3048, "ft" = 0.3048,
    "us survey foot" = 1200 / 3937, "foot_us" = 1200 / 3937,
    "link" = 0.201168, "chain" = 20.11684023368,
    NULL
  )
}

# ---------------------------------------------------------------------------
# One leg (or several) of a traverse, in the basis the user chose.
#
# Returns the vertices in WGS84 — which is what the draft holds and what the
# map draws — plus the projected FRAME at the last of them: its easting and
# northing, the grid convergence there, and the point scale factor. The frame
# is what lets the renderer preview the NEXT leg as it is typed without asking
# again per keystroke; the vertex that is kept is always the one computed here.
# ---------------------------------------------------------------------------
handle_spatial_traverse <- function(body) {
  if (!requireNamespace("sf", quietly = TRUE)) {
    return(error_response("sf package is not installed"))
  }
  origin <- body$origin %||% return(error_response("origin required", 400L))
  legs <- body$legs %||% list()
  basis <- body$basis %||% "geodesic"

  tryCatch({
    origin <- as.numeric(unlist(origin))
    if (length(origin) != 2L || any(!is.finite(origin))) stop("origin must be [lng, lat]")
    dist <- vapply(legs, function(l) as.numeric(l$distance), numeric(1))
    azim <- vapply(legs, function(l) as.numeric(l$azimuth), numeric(1))

    crs <- if (identical(basis, "grid")) {
      if (!is.null(body$crs)) {
        sf::st_crs(if (is.numeric(body$crs)) as.integer(body$crs) else as.character(body$crs))
      } else {
        name <- body$name %||% stop("name or crs required for a grid traverse")
        sf::st_crs(get(name, envir = resolve_env(body$envName %||% ".GlobalEnv")))
      }
    } else NULL

    if (identical(basis, "grid") && (is.null(crs) || is.na(crs) || isTRUE(sf::st_is_longlat(crs)))) {
      stop("This layer has no projected coordinate system, so there is no grid to measure on. Use the geodesic basis.")
    }

    # No legs is a legitimate question, not a mistake: "where is this point on
    # the grid, and what does the projection do to a bearing there?" It is what
    # the entry strip asks the moment a start point is placed, so that even the
    # FIRST leg previews on the grid it will be committed on.
    verts <- if (length(dist) == 0L) {
      matrix(origin, nrow = 1L, dimnames = list(NULL, c("lng", "lat")))
    } else {
      ourgeo_traverse(origin, data.frame(distance = dist, azimuth = azim),
                      crs = if (is.null(crs)) NULL else crs, as_sfc = FALSE)
    }
    last <- verts[nrow(verts), ]

    # Full precision, deliberately: `json_response` rounds to four decimals by
    # default, and four decimals of longitude is eleven metres.
    json_response(list(
      success = TRUE,
      vertices = lapply(seq_len(nrow(verts)), function(i) as.numeric(verts[i, ])),
      frame = if (is.null(crs)) NULL else .ourgeo_grid_frame(last, crs)
    ), digits = NA)
  }, error = function(e) error_response(conditionMessage(e)))
}

# What the projection does to a bearing and a distance AT one point.
#
# Both are measured rather than looked up, because there is no general formula
# across every projection PROJ supports: the convergence is the direction a
# short step due north comes out as on the grid, and the point scale factor is
# how long a one-metre step comes out. Two tiny transforms, and they are right
# for a Lambert or an oblique Mercator as much as for a UTM zone.
.ourgeo_grid_frame <- function(lnglat, crs) {
  d <- 1 / 111320  # ~1 m in degrees of latitude
  pts <- sf::st_sfc(
    sf::st_point(c(lnglat[1], lnglat[2])),
    sf::st_point(c(lnglat[1], lnglat[2] + d)),
    crs = 4326L
  )
  xy <- sf::st_coordinates(sf::st_transform(pts, crs))
  dx <- xy[2, 1] - xy[1, 1]
  dy <- xy[2, 2] - xy[1, 2]
  north_len <- sqrt(dx * dx + dy * dy)

  # Convergence is TRUE azimuth minus GRID azimuth, which is the sense
  # `reduceGridLeg` adds in. A step of true azimuth 0 comes out on the grid at
  # atan2(dx, dy), so the convergence is the negative of that — east of a UTM
  # central meridian it is positive, matching (λ − λ0)·sin φ.
  convergence <- -atan2(dx, dy) * 180 / pi
  ground <- .ourgeo_geod_inverse(lnglat, c(lnglat[1], lnglat[2] + d))
  scale <- if (is.finite(ground) && ground > 0) north_len / ground else 1

  list(
    x = unname(xy[1, 1]), y = unname(xy[1, 2]),
    convergence = unname(convergence), scale = unname(scale)
  )
}

# ---------------------------------------------------------------------------
# The traverse itself — and the R the console echoes.
#
# This is a user-facing function on purpose: every leg the Distance & Bearing
# strip places is echoed as one `ourgeo_traverse()` call, so a traverse typed
# by hand can be re-run in a script without ouRGeo. It is ouRGeo's own name,
# not the user's — it is defined at startup, so `system_names` (snapshotted at
# the end of server.R) already covers it, and it stays out of the Environment
# panel and out of project bundles.
#
# `crs = NULL` walks the WGS84 ellipsoid: Vincenty's direct solution, the same
# one `src/lib/draw/cogo.ts` implements, so the geometry this reproduces is the
# geometry that was on screen. The two must stay in step; each names the other.
#
# With a `crs`, the legs are laid out on that CRS's own grid — plane arithmetic
# in projected coordinates, which is what a bearing off a survey plat means —
# and the result comes back in WGS84 like everything else the drawing surface
# holds.
# ---------------------------------------------------------------------------
ourgeo_traverse <- function(origin, legs, crs = NULL, as_sfc = TRUE) {
  origin <- as.numeric(origin)
  stopifnot(length(origin) == 2L)
  d <- as.numeric(legs$distance)
  a <- as.numeric(legs$azimuth)
  stopifnot(length(d) == length(a), length(d) >= 1L)

  if (is.null(crs)) {
    pts <- matrix(origin, nrow = 1L)
    for (i in seq_along(d)) {
      pts <- rbind(pts, .ourgeo_geod_direct(pts[nrow(pts), ], d[i], a[i]))
    }
  } else {
    if (!requireNamespace("sf", quietly = TRUE)) stop("sf package is not installed")
    crs <- sf::st_crs(crs)
    start <- sf::st_coordinates(sf::st_transform(
      sf::st_sfc(sf::st_point(origin), crs = 4326L), crs
    ))
    # A projected CRS is not necessarily in metres — State Plane zones are
    # commonly US survey feet — and the legs arrive in metres. Scaling here
    # rather than at the caller keeps "150 m" meaning 150 m on every layer.
    per_unit <- .ourgeo_unit_to_metre(tryCatch(crs$units_gdal, error = function(e) "metre"))
    if (is.null(per_unit)) stop("This CRS's linear unit is not one ouRGeo can convert; use the geodesic basis.")
    xy <- matrix(c(start[1, 1], start[1, 2]), nrow = 1L)
    for (i in seq_along(d)) {
      s <- d[i] / per_unit
      th <- a[i] * pi / 180
      xy <- rbind(xy, c(xy[nrow(xy), 1] + s * sin(th), xy[nrow(xy), 2] + s * cos(th)))
    }
    back <- sf::st_transform(
      sf::st_sfc(lapply(seq_len(nrow(xy)), function(i) sf::st_point(xy[i, ])), crs = crs),
      4326L
    )
    pts <- sf::st_coordinates(back)[, 1:2, drop = FALSE]
  }

  colnames(pts) <- c("lng", "lat")
  if (!as_sfc) return(pts)
  if (!requireNamespace("sf", quietly = TRUE)) return(pts)
  sf::st_sfc(sf::st_linestring(pts), crs = 4326L)
}

# Vincenty's direct solution on WGS84 — where you arrive going `s` metres from
# `p` on azimuth `az`. Written out rather than taken from a package so that the
# echoed R needs nothing installed beyond sf, and so that it is line for line
# the solution the renderer uses.
.ourgeo_geod_direct <- function(p, s, az) {
  a <- 6378137.0; f <- 1 / 298.257223563; b <- a * (1 - f)
  if (s == 0) return(p)
  a1 <- az * pi / 180
  sa1 <- sin(a1); ca1 <- cos(a1)
  tU1 <- (1 - f) * tan(p[2] * pi / 180)
  cU1 <- 1 / sqrt(1 + tU1^2); sU1 <- tU1 * cU1
  s1 <- atan2(tU1, ca1)
  sal <- cU1 * sa1
  c2al <- 1 - sal^2
  u2 <- c2al * (a^2 - b^2) / b^2
  A <- 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
  B <- u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
  sig <- s / (b * A); c2sm <- 0; ss <- 0; cs <- 0
  for (i in 1:100) {
    c2sm <- cos(2 * s1 + sig); ss <- sin(sig); cs <- cos(sig)
    dsig <- B * ss * (c2sm + B / 4 * (cs * (-1 + 2 * c2sm^2) -
      B / 6 * c2sm * (-3 + 4 * ss^2) * (-3 + 4 * c2sm^2)))
    prev <- sig
    sig <- s / (b * A) + dsig
    if (abs(sig - prev) < 1e-12) break
  }
  tmp <- sU1 * ss - cU1 * cs * ca1
  lat2 <- atan2(sU1 * cs + cU1 * ss * ca1, (1 - f) * sqrt(sal^2 + tmp^2))
  lam <- atan2(ss * sa1, cU1 * cs - sU1 * ss * ca1)
  C <- f / 16 * c2al * (4 + f * (4 - 3 * c2al))
  L <- lam - (1 - C) * f * sal * (sig + C * ss * (c2sm + C * cs * (-1 + 2 * c2sm^2)))
  lng2 <- ((p[1] + L * 180 / pi + 180) %% 360) - 180
  c(lng2, lat2 * 180 / pi)
}

# Vincenty's inverse solution, distance only — used to measure what a one-metre
# step actually is on the ground when deriving the point scale factor.
.ourgeo_geod_inverse <- function(p1, p2) {
  a <- 6378137.0; f <- 1 / 298.257223563; b <- a * (1 - f)
  L <- (p2[1] - p1[1]) * pi / 180
  U1 <- atan((1 - f) * tan(p1[2] * pi / 180)); U2 <- atan((1 - f) * tan(p2[2] * pi / 180))
  sU1 <- sin(U1); cU1 <- cos(U1); sU2 <- sin(U2); cU2 <- cos(U2)
  lam <- L; ss <- 0; cs <- 0; sig <- 0; c2al <- 0; c2sm <- 0
  for (i in 1:200) {
    sl <- sin(lam); cl <- cos(lam)
    ss <- sqrt((cU2 * sl)^2 + (cU1 * sU2 - sU1 * cU2 * cl)^2)
    if (ss == 0) return(0)
    cs <- sU1 * sU2 + cU1 * cU2 * cl
    sig <- atan2(ss, cs)
    sal <- cU1 * cU2 * sl / ss
    c2al <- 1 - sal^2
    c2sm <- if (c2al == 0) 0 else cs - 2 * sU1 * sU2 / c2al
    C <- f / 16 * c2al * (4 + f * (4 - 3 * c2al))
    prev <- lam
    lam <- L + (1 - C) * f * sal * (sig + C * ss * (c2sm + C * cs * (-1 + 2 * c2sm^2)))
    if (abs(lam - prev) < 1e-12) break
  }
  u2 <- c2al * (a^2 - b^2) / b^2
  A <- 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
  B <- u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
  dsig <- B * ss * (c2sm + B / 4 * (cs * (-1 + 2 * c2sm^2) -
    B / 6 * c2sm * (-3 + 4 * ss^2) * (-3 + 4 * c2sm^2)))
  b * A * (sig - dsig)
}
