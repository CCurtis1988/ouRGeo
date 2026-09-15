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
  # `courses` is the current name and carries curves; `legs` is what the
  # straight-only callers have always sent and still means the same thing.
  legs <- body$courses %||% body$legs %||% list()
  basis <- body$basis %||% "geodesic"

  tryCatch({
    origin <- as.numeric(unlist(origin))
    if (length(origin) != 2L || any(!is.finite(origin))) stop("origin must be [lng, lat]")
    num <- function(l, name) {
      v <- l[[name]]
      if (is.null(v)) NA_real_ else as.numeric(v)
    }
    courses <- if (length(legs) == 0L) NULL else data.frame(
      type     = vapply(legs, function(l) as.character(l$type %||% "line"), character(1)),
      distance = vapply(legs, function(l) num(l, "distance"), numeric(1)),
      azimuth  = vapply(legs, function(l) num(l, "azimuth"), numeric(1)),
      radius   = vapply(legs, function(l) num(l, "radius"), numeric(1)),
      delta    = vapply(legs, function(l) num(l, "delta"), numeric(1)),
      turn     = vapply(legs, function(l) as.character(l$turn %||% NA_character_), character(1)),
      samples  = vapply(legs, function(l) num(l, "samples"), numeric(1)),
      stringsAsFactors = FALSE
    )

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
    verts <- if (is.null(courses)) {
      matrix(origin, nrow = 1L, dimnames = list(NULL, c("lng", "lat")))
    } else {
      ourgeo_traverse(origin, courses, crs = if (is.null(crs)) NULL else crs, as_sfc = FALSE)
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
# With a `crs`, the courses are laid out on that CRS's own grid — plane
# arithmetic in projected coordinates, which is what a bearing off a survey plat
# means, and where a plat's curve is a TRUE circle — and the result comes back
# in WGS84 like everything else the drawing surface holds.
#
# `legs` is a data.frame of courses. The straight-course contract is unchanged:
#
#   data.frame(distance = c(150, 82), azimuth = c(45.5, 102))
#
# Curves are ADDITIVE COLUMNS, so a call written before they existed still means
# exactly what it meant — no `type` column reads as all-straight:
#
#   data.frame(
#     type     = c("line", "curve", "line"),
#     distance = c(150,    NA,      82),     # metres, straight courses
#     azimuth  = c(45.5,   NA,      102),    # degrees; NA on a TANGENT curve,
#                                            #   which inherits the previous
#                                            #   course's arrival azimuth
#     radius   = c(NA,     250,     NA),     # metres
#     delta    = c(NA,     45.5,    NA),     # degrees of central angle
#     turn     = c(NA,     "R",     NA)      # "L" or "R"
#   )
#
# A curve is emitted as vertices at roughly one degree of sweep. The drawing
# surface keeps it symbolically as a CIRCULARSTRING instead, so the two agree on
# where the curve GOES and differ in how they store it — worth knowing before
# comparing this geometry byte for byte with a saved layer.
# ---------------------------------------------------------------------------
ourgeo_traverse <- function(origin, legs, crs = NULL, as_sfc = TRUE) {
  origin <- as.numeric(origin)
  stopifnot(length(origin) == 2L)
  legs <- as.data.frame(legs, stringsAsFactors = FALSE)
  stopifnot(nrow(legs) >= 1L)
  courses <- .ourgeo_normalise_courses(legs)

  if (is.null(crs)) {
    pts <- matrix(origin, nrow = 1L)
    az_in <- NA_real_
    for (i in seq_len(nrow(courses))) {
      step <- .ourgeo_course_geodesic(pts[nrow(pts), ], courses[i, ], az_in)
      pts <- rbind(pts, step$pts)
      az_in <- step$az_out
    }
  } else {
    if (!requireNamespace("sf", quietly = TRUE)) stop("sf package is not installed")
    crs <- sf::st_crs(crs)
    start <- sf::st_coordinates(sf::st_transform(
      sf::st_sfc(sf::st_point(origin), crs = 4326L), crs
    ))
    # A projected CRS is not necessarily in metres — State Plane zones are
    # commonly US survey feet — and the courses arrive in metres. Scaling here
    # rather than at the caller keeps "150 m" meaning 150 m on every layer.
    per_unit <- .ourgeo_unit_to_metre(tryCatch(crs$units_gdal, error = function(e) "metre"))
    if (is.null(per_unit)) stop("This CRS's linear unit is not one ouRGeo can convert; use the geodesic basis.")
    grid <- courses
    grid$distance <- grid$distance / per_unit
    grid$radius <- grid$radius / per_unit
    xy <- matrix(c(start[1, 1], start[1, 2]), nrow = 1L)
    az_in <- NA_real_
    for (i in seq_len(nrow(grid))) {
      step <- .ourgeo_course_grid(xy[nrow(xy), ], grid[i, ], az_in)
      xy <- rbind(xy, step$pts)
      az_in <- step$az_out
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

# Vincenty's inverse solution: how far apart two points are, and on what
# azimuths the geodesic between them leaves and arrives.
#
# A curve needs the ARRIVAL azimuth. The tangent at the end of a curve is a
# quarter turn from the radius there, and the radius there is not simply the
# reverse of the radius at the start — a geodesic arrives on a different azimuth
# than it left on. Assuming otherwise put the start of a 122 m curve 2 mm out in
# the renderer before the same correction was made there.
.ourgeo_geod_inverse_full <- function(p1, p2) {
  a <- 6378137.0; f <- 1 / 298.257223563; b <- a * (1 - f)
  L <- (p2[1] - p1[1]) * pi / 180
  U1 <- atan((1 - f) * tan(p1[2] * pi / 180)); U2 <- atan((1 - f) * tan(p2[2] * pi / 180))
  sU1 <- sin(U1); cU1 <- cos(U1); sU2 <- sin(U2); cU2 <- cos(U2)
  lam <- L; ss <- 0; cs <- 0; sig <- 0; c2al <- 0; c2sm <- 0
  for (i in 1:200) {
    sl <- sin(lam); cl <- cos(lam)
    ss <- sqrt((cU2 * sl)^2 + (cU1 * sU2 - sU1 * cU2 * cl)^2)
    if (ss == 0) return(list(distance = 0, azi1 = 0, azi2 = 0))
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
  sl <- sin(lam); cl <- cos(lam)
  list(
    distance = b * A * (sig - dsig),
    azi1 = (atan2(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl) * 180 / pi) %% 360,
    azi2 = (atan2(cU1 * sl, -sU1 * cU2 + cU1 * sU2 * cl) * 180 / pi) %% 360
  )
}

# Distance only — what the point scale factor is derived from.
.ourgeo_geod_inverse <- function(p1, p2) .ourgeo_geod_inverse_full(p1, p2)$distance

# How many vertices a curve is cut into.
#
# The default is roughly one per degree of sweep, which is what makes the echoed
# `ourgeo_traverse()` draw a smooth curve on its own. The drawing surface asks
# for a specific count instead — a power of two — because it fits circular arcs
# through these points and needs every piece boundary and midpoint to land
# exactly on one, rather than interpolated between two.
.ourgeo_curve_samples <- function(course) {
  n <- suppressWarnings(as.integer(course$samples))
  if (length(n) == 1L && !is.na(n) && n >= 2L) return(min(n, 4096L))
  max(2L, as.integer(ceiling(abs(course$delta))))
}

# One course's worth of vertices, walking the WGS84 ellipsoid.
#
# A curve is a locus of constant geodesic radius about its centre, which meets
# every one of its radii at a right angle — so it leaves PC on the incoming
# tangent and arrives at PT on the deflected one with nothing to correct. It is
# emitted at roughly one degree of sweep per vertex: the drawing surface keeps
# the curve symbolically as a CIRCULARSTRING, and this is its linearisation, so
# the POSITIONS agree and the storage differs.
.ourgeo_course_geodesic <- function(p, course, az_in) {
  if (identical(course$type, "line")) {
    q <- .ourgeo_geod_direct(p, course$distance, course$azimuth)
    return(list(pts = matrix(q, nrow = 1L),
                az_out = .ourgeo_geod_inverse_full(p, q)$azi2))
  }
  az0 <- if (is.na(course$azimuth)) az_in else course$azimuth
  if (is.na(az0)) {
    stop("A tangent curve needs a course before it to be tangent to, or an azimuth of its own.")
  }
  sgn <- if (identical(course$turn, "L")) -1 else 1
  centre <- .ourgeo_geod_direct(p, course$radius, az0 + sgn * 90)
  radial0 <- .ourgeo_geod_inverse_full(centre, p)$azi1
  n <- .ourgeo_curve_samples(course)
  pts <- matrix(NA_real_, nrow = n, ncol = 2L)
  for (k in seq_len(n)) {
    pts[k, ] <- .ourgeo_geod_direct(centre, course$radius, radial0 + sgn * course$delta * k / n)
  }
  list(pts = pts,
       az_out = (.ourgeo_geod_inverse_full(centre, pts[n, ])$azi2 + sgn * 90) %% 360)
}

# The same, on a projected grid — where a plat's curve is a TRUE circle and the
# arithmetic is plane. `xy` and `radius` are in the CRS's own linear unit.
.ourgeo_course_grid <- function(xy, course, az_in) {
  if (identical(course$type, "line")) {
    th <- course$azimuth * pi / 180
    q <- c(xy[1] + course$distance * sin(th), xy[2] + course$distance * cos(th))
    return(list(pts = matrix(q, nrow = 1L), az_out = course$azimuth))
  }
  az0 <- if (is.na(course$azimuth)) az_in else course$azimuth
  if (is.na(az0)) {
    stop("A tangent curve needs a course before it to be tangent to, or an azimuth of its own.")
  }
  sgn <- if (identical(course$turn, "L")) -1 else 1
  ct <- (az0 + sgn * 90) * pi / 180
  centre <- c(xy[1] + course$radius * sin(ct), xy[2] + course$radius * cos(ct))
  radial0 <- atan2(xy[1] - centre[1], xy[2] - centre[2]) * 180 / pi
  n <- .ourgeo_curve_samples(course)
  pts <- matrix(NA_real_, nrow = n, ncol = 2L)
  for (k in seq_len(n)) {
    th <- (radial0 + sgn * course$delta * k / n) * pi / 180
    pts[k, ] <- c(centre[1] + course$radius * sin(th), centre[2] + course$radius * cos(th))
  }
  # On a plane the deflection IS the central angle, exactly.
  list(pts = pts, az_out = (az0 + sgn * course$delta) %% 360)
}

# Fill in the columns a straight-only call does not carry, so a two-column
# data.frame written before curves existed still means exactly what it meant.
.ourgeo_normalise_courses <- function(legs) {
  n <- nrow(legs)
  type <- if (is.null(legs$type)) rep("line", n) else as.character(legs$type)
  get <- function(name) if (is.null(legs[[name]])) rep(NA_real_, n) else as.numeric(legs[[name]])
  turn <- if (is.null(legs$turn)) rep(NA_character_, n) else toupper(substr(as.character(legs$turn), 1L, 1L))
  out <- data.frame(
    type = type, distance = get("distance"), azimuth = get("azimuth"),
    radius = get("radius"), delta = get("delta"), turn = turn,
    samples = get("samples"),
    stringsAsFactors = FALSE
  )
  bad <- !(out$type %in% c("line", "curve"))
  if (any(bad)) stop("Course type must be \"line\" or \"curve\"; got ", out$type[which(bad)[1]])
  if (any(out$type == "line" & (!is.finite(out$distance) | !is.finite(out$azimuth)))) {
    stop("Every straight course needs a distance and an azimuth.")
  }
  if (any(out$type == "curve" & (!is.finite(out$radius) | !is.finite(out$delta)))) {
    stop("Every curved course needs a radius and a delta.")
  }
  out
}
