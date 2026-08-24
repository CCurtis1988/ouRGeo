# Handlers: R help search/doc/package/vignettes
# (extracted from server.R — behavior-preserving modularization)

handle_help_search <- function(body) {
  query <- body$query %||% ""
  limit <- as.integer(body$limit %||% 20L)

  if (!nzchar(trimws(query)))
    return(json_response(list(success = TRUE, results = list())))

  # Tier 1: apropos() — fast search in loaded namespaces
  loaded_matches <- tryCatch(apropos(query, ignore.case = TRUE), error = function(e) character(0))
  loaded_items <- lapply(head(loaded_matches, 10L), function(nm) {
    pkg <- tryCatch({
      env <- environment(get(nm))
      if (identical(env, .GlobalEnv)) ".GlobalEnv"
      else environmentName(env)
    }, error = function(e) NULL)
    list(name = nm, package = pkg, type = "function", source = "loaded")
  })

  # Tier 2: help.search() — comprehensive indexed search
  hs <- tryCatch(
    suppressWarnings(utils::help.search(query, ignore.case = TRUE, verbose = FALSE)),
    error = function(e) NULL
  )
  search_items <- if (!is.null(hs) && nrow(hs$matches) > 0) {
    m <- head(hs$matches, limit)
    lapply(seq_len(nrow(m)), function(i)
      list(name = m$Name[i], package = m$Package[i],
           title = m$Title[i], type = m$Type[i], source = "index"))
  } else list()

  # Merge, deduplicate by name+package
  all_items <- c(loaded_items, search_items)
  seen <- character(0)
  unique_items <- Filter(function(x) {
    key <- paste0(x$name, "::", x$package %||% "")
    if (key %in% seen) return(FALSE)
    seen <<- c(seen, key)
    TRUE
  }, all_items)

  json_response(list(success = TRUE, result = list(results = head(unique_items, limit))))
}

handle_help_doc <- function(body) {
  topic <- body$topic %||% return(error_response("topic required", 400L))
  pkg   <- if (!is.null(body$package) && nzchar(body$package %||% "")) body$package else NULL

  h <- tryCatch(
    if (!is.null(pkg))
      utils::help(topic, package = (pkg))
    else
      utils::help(topic),
    error = function(e) NULL
  )

  if (is.null(h) || length(h) == 0)
    return(error_response(paste0("No documentation found for '", topic, "'"), 404L))

  rd <- tryCatch(utils:::.getHelpFile(h), error = function(e) NULL)
  if (is.null(rd))
    return(error_response(paste0("Could not read help file for '", topic, "'"), 404L))

  DARK_CSS <- paste0(
    "body{background:#0f1117;color:#e6edf3;font-family:system-ui,sans-serif;",
    "font-size:13px;margin:16px;line-height:1.5;}",
    "h2,h3,h4{color:#e6edf3;margin-top:1.2em;margin-bottom:0.4em;}",
    "code,pre{background:#161b22;color:#79c0ff;padding:2px 5px;border-radius:3px;",
    "font-family:monospace;font-size:12px;}",
    "pre{padding:10px;overflow-x:auto;}",
    "a{color:#4493f8;text-decoration:none;}",
    "a:hover{text-decoration:underline;}",
    "table{border-collapse:collapse;width:100%;}",
    "td,th{padding:5px 8px;border-bottom:1px solid #21262d;vertical-align:top;}",
    "hr{border-color:#21262d;}",
    "dt{font-weight:600;color:#79c0ff;}"
  )

  tmp_html <- tempfile(fileext = ".html")
  tryCatch(
    tools::Rd2HTML(rd, out = tmp_html, package = pkg %||% ""),
    error = function(e) return(error_response(conditionMessage(e)))
  )
  body_html <- paste(readLines(tmp_html, warn = FALSE), collapse = "\n")
  unlink(tmp_html)

  # Extract body content from R's generated HTML
  body_match <- regmatches(body_html, regexpr("(?s)<body[^>]*>(.*)</body>", body_html, perl = TRUE))
  inner_html <- if (length(body_match) > 0) {
    sub("(?s)<body[^>]*>", "", sub("</body>.*$", "", body_match, perl = TRUE), perl = TRUE)
  } else body_html

  full_html <- paste0(
    "<html><head><style>", DARK_CSS, "</style></head><body>",
    inner_html,
    "</body></html>"
  )

  examples <- tryCatch({
    example_blocks <- Filter(function(b) identical(attr(b, "Rd_tag"), "\\examples"), rd)
    if (length(example_blocks) > 0) {
      tmp_ex <- tempfile(fileext = ".R")
      tools::Rd2ex(rd, out = tmp_ex)
      ex <- paste(readLines(tmp_ex, warn = FALSE), collapse = "\n")
      unlink(tmp_ex)
      trimws(ex)
    } else ""
  }, error = function(e) "")

  actual_pkg <- tryCatch({
    f <- tryCatch(get(topic, envir = as.environment("package:base")), error = function(e) NULL)
    if (is.null(f)) f <- tryCatch(get(topic), error = function(e) NULL)
    if (!is.null(f) && is.function(f)) environmentName(environment(f)) else pkg %||% ""
  }, error = function(e) pkg %||% "")

  json_response(list(
    success = TRUE,
    result  = list(html = full_html, topic = topic, package = actual_pkg, examples = examples)
  ))
}

handle_help_package <- function(body) {
  pkg <- body$package %||% return(error_response("package required", 400L))
  tryCatch({
    desc <- utils::packageDescription(pkg)
    if (identical(desc, NA)) return(error_response(paste0("Package '", pkg, "' not installed"), 404L))
    fns  <- tryCatch(sort(getNamespaceExports(pkg)), error = function(e) character(0))
    json_response(list(
      success = TRUE,
      result  = list(
        package     = pkg,
        title       = desc$Title %||% pkg,
        version     = desc$Version %||% "",
        description = desc$Description %||% "",
        functions   = as.list(fns)
      )
    ))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_help_vignettes <- function(body) {
  pkg <- body$package %||% return(error_response("package required", 400L))
  tryCatch({
    vigs <- vignette(package = pkg)$results
    if (nrow(vigs) == 0)
      return(json_response(list(success = TRUE, vignettes = list())))
    items <- lapply(seq_len(nrow(vigs)), function(i)
      list(name = vigs[i, "Item"], title = vigs[i, "Title"]))
    json_response(list(success = TRUE, result = list(vignettes = items)))
  }, error = function(e) error_response(conditionMessage(e)))
}

handle_help_vignette <- function(body) {
  pkg  <- body$package %||% return(error_response("package required", 400L))
  name <- body$name    %||% return(error_response("name required", 400L))
  tryCatch({
    vig_dir   <- system.file("doc", package = pkg)
    html_path <- file.path(vig_dir, paste0(name, ".html"))
    if (!file.exists(html_path))
      return(error_response("Vignette HTML not available", 404L))
    html <- paste(readLines(html_path, warn = FALSE), collapse = "\n")
    json_response(list(success = TRUE, result = list(html = html, name = name)))
  }, error = function(e) error_response(conditionMessage(e)))
}

# ---------------------------------------------------------------------------
# Selection query handler
# ---------------------------------------------------------------------------

