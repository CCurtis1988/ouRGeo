// Turning knitr's failures into something actionable.
//
// Pure functions, kept out of electron/main so they can be unit-tested with the
// rest of the renderer code — the main process imports them.

/** knitr reports failures as `Quitting from lines 42-47 (doc.Rmd)`. Surfacing
 *  the line lets the editor jump the caret to the failing chunk. */
export function parseErrorLine(log: string): number | null {
  const m = /Quitting from lines?\s+(\d+)/i.exec(log)
  return m ? Number(m[1]) : null
}

/** A human explanation for the common render failures. */
export function hintFor(log: string): string | null {
  if (/object '.*' not found/.test(log)) {
    // The single most likely confusion: "but it worked in the console".
    return 'Knit runs in a clean R session, so objects created in the console are not available. Load or compute them in a chunk.'
  }
  if (/pandoc.*not found|No such file or directory.*pandoc/i.test(log)) {
    return 'pandoc was not found. It is not an R package — install it from pandoc.org, or install the "pandoc" R package which bundles a copy.'
  }
  if (/LaTeX failed|pdflatex.*not found|tinytex/i.test(log)) {
    return 'PDF output needs a LaTeX installation. Install TinyTeX (tinytex::install_tinytex()), or knit to Word instead.'
  }
  if (/there is no package called/.test(log)) {
    const pkg = /there is no package called ['"]([^'"]+)['"]/.exec(log)?.[1]
    return pkg
      ? `The document uses the "${pkg}" package, which is not installed. Install it from the Packages panel.`
      : null
  }
  return null
}
