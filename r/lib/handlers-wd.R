# Working directory: read it, set it, and tell the UI when it moves.
#
# The directory is shown in the console header, so it has to stay honest no
# matter how it changed. A user typing setwd("…") into the console must move the
# label exactly as the picker does, which is why this is a broadcast on a
# fingerprint rather than something the renderer asks for once at startup.

handle_wd_get <- function() {
  json_response(list(
    success = TRUE,
    path    = getwd(),
    home    = path.expand("~"),
    sep     = .Platform$file.sep
  ))
}

handle_wd_set <- function(body) {
  path <- body$path
  if (is.null(path) || !nzchar(path)) return(error_response("A directory is required"))

  # path.expand covers a `~` typed by hand; normalizePath resolves `..` and
  # symlinks so the label matches what R will actually report afterwards.
  target <- path.expand(path)
  if (!dir.exists(target)) {
    return(error_response(paste0("No such directory: ", target)))
  }

  result <- tryCatch({
    setwd(target)
    NULL
  }, error = function(e) conditionMessage(e))

  if (!is.null(result)) return(error_response(result))

  now <- getwd()
  .ourgeo_env$wd <- now
  broadcast_system(list(type = "wd", data = list(path = now)))
  json_response(list(success = TRUE, path = now))
}

# Called after every execution, beside the environment and package sweeps: a
# setwd() buried in a script is exactly the case the header must not miss.
broadcast_wd_if_changed <- function() {
  now <- tryCatch(getwd(), error = function(e) NULL)
  if (is.null(now) || identical(now, .ourgeo_env$wd)) return(invisible(NULL))
  .ourgeo_env$wd <- now
  broadcast_system(list(type = "wd", data = list(path = now)))
  invisible(NULL)
}
