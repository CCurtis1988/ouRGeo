// The document skill: how to work with R Markdown and Markdown inside ouRGeo.
//
// Written because a local model produced a genuinely good earthquake report in
// which every figure chunk was a bare session variable (`p1`, `combined_plot`),
// no chunk loaded the data, and the headline counts were typed into the prose.
// All three are invisible from inside the model: running a chunk inline
// evaluates in the LIVE session and succeeds, and only the Knit button — a clean
// child Rscript (electron/main/knit.ts) — ever tells the truth. Nothing in the
// system prompt mentioned documents at all, so the model could not have known.
//
// Injected on every request, for every provider, next to the provenance rules.
// The single branch is on whether the document tools are attached: "write it
// into the tab" and "hand the user text to paste" are different instructions,
// and a model must never be told to use a tool it wasn't given.

export interface DocumentSkillOptions {
  /** Whether read_document / write_document / edit_document are attached. */
  hasDocumentTools: boolean
}

const CORE = `## Documents — R Markdown and Markdown

The editor holds documents as well as scripts. A \`.R\` script runs top to bottom in the live session. An \`.Rmd\` (R Markdown) document mixes prose with executable chunks and is **rendered in a separate R session**. A \`.md\` document is prose only — an \`{r}\` fence in a \`.md\` file never runs. \`.qmd\` edits exactly like \`.Rmd\`, but knitting one needs the Quarto CLI, which ouRGeo does not bundle.

### The rule that breaks most reports: an .Rmd must be self-contained

Knit spawns a **clean \`Rscript\`** whose working directory is the document's own folder. Nothing from the user's session exists inside it: no console objects, no attached packages, no \`options()\`. Every object a chunk uses must be created by an earlier chunk **in the same document**.

So a chunk whose whole body is a bare name — \`p1\`, \`combined_plot\`, \`eq_df\` — is always a bug. It succeeds when the chunk is run inline, because that path evaluates in the live session, and it fails the moment the user presses Knit.

### Promoting session work into a report

Never reference the object the session happens to hold. Move the code that **built** it into a chunk. Three ways to keep that affordable when the work is expensive:

- \`source("analysis.R")\` from a chunk, when that script is on disk and itself self-contained.
- \`saveRDS(eq, "data/eq.rds")\` in the session, then \`eq <- readRDS("data/eq.rds")\` in a chunk.
- \`cache=TRUE\` on the expensive chunk.

Paths inside a document are relative to the document. Never \`setwd()\` in a chunk, and never \`install.packages()\` in a chunk.

### Shape of a working document

\`\`\`\`
---
title: "Global Earthquakes, May 2025"
output: html_document
---

\`\`\`{r setup, include=FALSE}
knitr::opts_chunk$set(echo = TRUE, message = FALSE, warning = FALSE)
library(dplyr)
library(ggplot2)
\`\`\`

\`\`\`{r load-data}
eq <- readr::read_csv("data/earthquakes.csv")   # or the API call that fetched it
\`\`\`

## Magnitude distribution

The catalog holds \`r nrow(eq)\` events, the largest M\`r max(eq$mag)\`.

\`\`\`{r magnitude-hist, fig.width=8, fig.height=5}
ggplot(eq, aes(mag)) + geom_histogram(binwidth = 0.1)
\`\`\`
\`\`\`\`

Front matter first, then a \`setup\` chunk holding \`knitr::opts_chunk$set()\` and **every** \`library()\` call, then a chunk that loads or builds the data, then analysis chunks with the prose that reads them.

### Numbers belong in code, not in prose

Inline R code goes between backticks with a leading \`r\`:

    The catalog holds \`r nrow(eq)\` events, the largest M\`r max(eq$mag)\`.

Never type the figure itself. "The catalog holds 2,022 events" is stale the next time the document renders and cannot be checked — the provenance rules above, applied to documents. Summary tables in prose are the worst case: build them with \`knitr::kable()\` from the data instead of hand-typing a pipe table.

### Chunk mechanics

- Labels must be unique — knitr aborts on a duplicate. Label every chunk you write; that is also what lets ouRGeo keep a chunk's output attached to it while the document is edited.
- Options that matter: \`echo\` (show the code), \`eval\` (run it), \`include\` (show anything at all), \`message\` / \`warning\`, \`fig.width\` / \`fig.height\` / \`fig.cap\`, \`cache\`.
- \`knitr::kable()\` is **printed**, not \`cat()\`-ed. Markdown emitted by \`cat()\` renders as literal verbatim output unless the chunk carries \`results='asis'\`.
- A plot built inside a loop or a function needs an explicit \`print(p)\`; autoprinting only applies at top level.

### How this works in ouRGeo

- Ctrl+Shift+Enter, or the \`▶\` button on the chunk, runs one chunk **in the live session** and shows its output under the chunk. This is why a document can run perfectly inline and still fail to knit.
- An inline run honours only \`eval\`, \`fig.width\`, \`fig.height\`, \`dpi\`, \`warning\` and \`message\`. \`echo\`, \`include\` and \`results='asis'\` are knit-time options — inline output will not match the knitted document for those.
- Knit (the button beside the language selector) needs the file saved to disk, and needs pandoc, which is not an R package. PDF also needs a LaTeX install.
- **Do not test a knit by calling \`rmarkdown::render()\` through \`execute_r_code\`.** It renders in the live global environment, so it succeeds on exactly the documents the Knit button cannot render — which is how a broken report gets declared finished. If you want a real check, spawn a clean session the way Knit does: \`system2("Rscript", c("-e", shQuote('rmarkdown::render("report.Rmd")')), stdout = TRUE, stderr = TRUE)\`. Otherwise just ask the user to press Knit and report what it says.
- Publish (beside Knit) posts to the ouRGeo forum as **markdown**: the body is capped at 12,000 characters, raw HTML is dropped, and figures are uploaded separately. Keep raw HTML out of a document intended for Publish.
- The Visual (WYSIWYG) mode has no footnote support and shows \`$…$\` math literally.`

const WITH_TOOLS = `### Writing documents

You have \`read_document\`, \`write_document\` and \`edit_document\`. They act on editor tabs the user can see, scroll and undo with Ctrl+Z; they never touch disk, so the user still saves with Ctrl+S or from the Knit prompt. Tell them that when you hand a document over.

- **Never assemble a document with \`writeLines()\`, \`cat()\` or a heredoc through \`execute_r_code\`.** Escaping backticks, quotes and backslashes inside an R string literal is how documents get silently corrupted. Pass the text to \`write_document\` instead.
- Build a long report with \`mode:"append"\`, one section per call — front matter and setup first, then a section at a time. It is far more reliable than one enormous replace.
- To change part of an existing document, \`read_document\` it and use \`edit_document\` on the exact text you want replaced. Do not rewrite the whole file to fix one chunk.
- The receipt each write returns lists the chunk labels found and any problems detected. Read it: it will tell you about a duplicate label or an unterminated fence before the user does.`

const WITHOUT_TOOLS = `### Writing documents

No document tools are attached this turn, so you cannot write into the editor. Give the user the complete document in one fenced block and say where to put it: New File → R Markdown, then paste.

Wrap it in a **four-backtick** fence so the \`{r}\` chunk fences inside it survive. Do not assemble the document with \`writeLines()\` or \`cat()\` through R — escaping backticks and quotes inside an R string literal is how documents get silently corrupted.`

const FAILURES = `### When a render fails

- \`object '…' not found\` — the document is not self-contained. A chunk is missing that loads or builds that object. It is not a problem with the user's session.
- \`there is no package called '…'\` — install it from the Packages panel.
- pandoc not found — it is not an R package; install it from pandoc.org or the \`pandoc\` R package that bundles a copy. LaTeX errors mean PDF output needs TinyTeX; Word output does not.
- \`Quitting from lines 42-47\` names the failing chunk. Fix that chunk.
- When a chunk errors while you are building a report — for example \`Error: 'to' must be of length 1\`, a vector reaching \`seq()\` or \`sprintf()\` where one value was expected — inspect the inputs (\`str()\`, \`length()\`, \`class()\`) and re-run that one chunk. Do not rewrite the document to route around an error you have not diagnosed, and do not report a document as finished while a chunk still errors.`

/** The document skill, with the authoring section matched to the tools actually
 *  attached this turn. */
export function buildDocumentSkill({ hasDocumentTools }: DocumentSkillOptions): string {
  return [CORE, hasDocumentTools ? WITH_TOOLS : WITHOUT_TOOLS, FAILURES].join('\n\n')
}
