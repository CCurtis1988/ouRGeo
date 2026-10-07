# Run with rlang (also installed with dplyr), without a model:
# Rscript tests/fixtures/context/schema.R
`%||%` <- function(x, y) if (is.null(x)) y else x
json_response <- identity
error_response <- function(message) list(success = FALSE, error = message)
source("r/lib/context.R")

roads <- data.frame(id = 1:3, income = c(20, 30, 40))
answer <- handle_context_schema(list(name = "roads", envName = ".GlobalEnv"))
stopifnot(answer$success, identical(vapply(answer$columns, `[[`, character(1), "name"), c("id", "income")))
stopifnot(is.null(answer$rows), is.null(answer$values))

other <- new.env(parent = emptyenv())
other$roads <- data.frame(other_column = 1)
answer <- handle_context_schema(list(name = "roads", envName = "other"))
stopifnot(answer$success, identical(answer$columns[[1]]$name, "other_column"))

evaluations <- 0L
makeActiveBinding("danger", function(value) { evaluations <<- evaluations + 1L; roads }, .GlobalEnv)
stopifnot(!handle_context_schema(list(name = "danger"))$success, evaluations == 0L)
delayedAssign("promise_data", { evaluations <<- evaluations + 1L; roads }, assign.env = .GlobalEnv)
delayedAssign("promise_environment", { evaluations <<- evaluations + 1L; other }, assign.env = .GlobalEnv)
stopifnot(!handle_context_schema(list(name = "promise_data"))$success, evaluations == 0L)
stopifnot(!handle_context_schema(list(name = "roads", envName = "promise_environment"))$success, evaluations == 0L)
stopifnot(!handle_context_schema(list(name = "system('false')"))$success)

lazy <- structure(list(), class = "tbl_sql")
stopifnot(!handle_context_schema(list(name = "lazy"))$success)

print.called <- FALSE
print.dangerous <- function(x, ...) { print.called <<- TRUE; stop("Do not print") }
safe <- roads
class(safe) <- c("dangerous", "data.frame")
stopifnot(handle_context_schema(list(name = "safe"))$success, !print.called)
column <- 1
attr(column, "class") <- rep(paste(rep("x", 5000), collapse = ""), 100)
attr(column, "units") <- character()
oversized <- structure(list(value = column), class = "data.frame", row.names = 1L)
answer <- handle_context_schema(list(name = "oversized"))
stopifnot(answer$success, nchar(answer$columns[[1L]]$type) <= 1031L,
          identical(answer$columns[[1L]]$typeCompleteness, "partial"), is.null(answer$columns[[1L]]$units))
cat("Schema isolation, no row disclosure, active/lazy bindings and print-method checks passed.\n")
