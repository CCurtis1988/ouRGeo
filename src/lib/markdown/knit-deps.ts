// Which knit formats are actually available, and what to say when one isn't.
//
// Knitting has four independent requirements and only two are R packages. The
// usual failure is missing pandoc, which R neither bundles nor can install as a
// normal dependency — so the raw render error is opaque. Resolving availability
// up front lets each menu item be disabled with a specific reason before the
// user clicks anything.

export interface KnitDeps {
  knitr: boolean
  rmarkdown: boolean
  pandoc: boolean
  pandocVersion?: string | null
  tinytex: boolean
  systemLatex: boolean
}

export type KnitFormat = 'html' | 'pdf' | 'word'

export interface FormatAvailability {
  format: KnitFormat
  label: string
  available: boolean
  /** Why it is unavailable, phrased as something the user can act on. */
  reason?: string
  /** A remedy the UI can offer as a button. */
  remedy?: { label: string; kind: 'install-rmarkdown' | 'install-pandoc' | 'install-tinytex' }
}

const LABEL: Record<KnitFormat, string> = { html: 'HTML', pdf: 'PDF', word: 'Word' }

export const KNIT_FORMATS: KnitFormat[] = ['html', 'pdf', 'word']

export function availabilityFor(format: KnitFormat, deps: KnitDeps | null): FormatAvailability {
  const base = { format, label: LABEL[format] }
  if (!deps) return { ...base, available: false, reason: 'Checking R packages…' }

  if (!deps.rmarkdown || !deps.knitr) {
    return {
      ...base,
      available: false,
      reason: 'Knitting requires the rmarkdown and knitr packages.',
      remedy: { label: 'Install rmarkdown', kind: 'install-rmarkdown' },
    }
  }

  if (!deps.pandoc) {
    return {
      ...base,
      available: false,
      // Being explicit about what pandoc IS matters: users reasonably assume
      // every R dependency is an R package, and RStudio bundles this one.
      reason: 'pandoc was not found. It is not an R package and R does not bundle it (RStudio ships its own copy).',
      remedy: { label: 'Install pandoc package', kind: 'install-pandoc' },
    }
  }

  if (format === 'pdf' && !deps.tinytex && !deps.systemLatex) {
    return {
      ...base,
      available: false,
      reason: 'PDF output needs a LaTeX installation. Word needs only pandoc, and knits today.',
      remedy: { label: 'Install TinyTeX (~200 MB)', kind: 'install-tinytex' },
    }
  }

  return { ...base, available: true }
}

export function allAvailability(deps: KnitDeps | null): FormatAvailability[] {
  return KNIT_FORMATS.map((f) => availabilityFor(f, deps))
}

/** R code for a remedy, run through the normal console so the user sees it. */
export function remedyCode(kind: NonNullable<FormatAvailability['remedy']>['kind']): string {
  switch (kind) {
    case 'install-rmarkdown':
      return 'install.packages(c("knitr", "rmarkdown"))'
    case 'install-pandoc':
      return 'install.packages("pandoc"); pandoc::pandoc_install()'
    case 'install-tinytex':
      return 'install.packages("tinytex"); tinytex::install_tinytex()'
  }
}
