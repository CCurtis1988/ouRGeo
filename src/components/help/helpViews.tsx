// ── Help panel: view components ──────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from 'react'
import { Play, BookOpen, Package, Map } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient, HelpSearchResult } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { OURGEO_PANELS, POPULAR_PACKAGES, type OurGeoPanel } from './helpData'

// ---------------------------------------------------------------------------
// Iframe renderer with injected dark CSS
// ---------------------------------------------------------------------------
export function HtmlViewer({ html }: { html: string }) {
  return (
    <iframe
      srcDoc={html}
      sandbox="allow-same-origin"
      style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      title="Help content"
    />
  )
}

// ---------------------------------------------------------------------------
// Package chip
// ---------------------------------------------------------------------------
export function PkgChip({ pkg, onClick }: { pkg: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-0.5 text-xs rounded bg-geo-panel border border-geo-border text-geo-muted hover:text-foreground hover:border-geo-accent transition-colors"
    >
      {pkg}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Panel chip (icon + label, same style as PkgChip)
// ---------------------------------------------------------------------------
export function PanelChip({
  meta,
  onClick,
}: {
  meta: typeof OURGEO_PANELS[number]
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded bg-geo-panel border border-geo-border text-geo-muted hover:text-foreground hover:border-geo-accent transition-colors"
    >
      <meta.Icon className="w-3 h-3 flex-shrink-0" />
      {meta.label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Home view
// ---------------------------------------------------------------------------
export function HomeView({
  onPackage,
  onOurGeo,
}: {
  onPackage: (pkg: string) => void
  onOurGeo: () => void
}) {
  const [loadedPkgs, setLoadedPkgs] = useState<string[]>([])

  useEffect(() => {
    rClient.listEnvironments().then((res) => {
      if (!res.success) return
      const pkgs = res.environments
        .map((e) => e.name)
        .filter((n) => n.startsWith('package:'))
        .map((n) => n.replace('package:', ''))
        .filter((n) => !['base', 'utils', 'datasets', 'methods', 'grDevices', 'graphics', 'stats'].includes(n))
      setLoadedPkgs(pkgs)
    }).catch(() => {})
  }, [])

  return (
    <div className="p-4 space-y-5 overflow-y-auto h-full">
      {/* ouRGeo intro */}
      <section>
        <div className="flex items-baseline gap-2 mb-1">
          <h2 className="text-sm font-bold text-foreground">ouRGeo</h2>
          <span className="text-xs text-geo-muted">— Your R workspace for spatial analysis</span>
        </div>
        <p className="text-xs text-geo-muted leading-relaxed mb-2">
          Write code, explore maps, build charts, and analyze geographic data — all from one desktop app.
        </p>
        <button
          onClick={onOurGeo}
          className="text-xs text-geo-accent hover:underline"
        >
          Learn about ouRGeo →
        </button>
      </section>

      {loadedPkgs.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-geo-muted uppercase tracking-wider mb-2">Loaded Packages</h3>
          <div className="flex flex-wrap gap-1.5">
            {loadedPkgs.map((pkg) => (
              <PkgChip key={pkg} pkg={pkg} onClick={() => onPackage(pkg)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-geo-muted uppercase tracking-wider mb-2">Popular Packages</h3>
        <div className="flex flex-wrap gap-1.5">
          {POPULAR_PACKAGES.map((pkg) => (
            <PkgChip key={pkg} pkg={pkg} onClick={() => onPackage(pkg)} />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-geo-muted uppercase tracking-wider mb-2">Quick Tips</h3>
        <div className="space-y-1.5 text-xs text-geo-muted">
          <p>• Search for any R function or topic using the search box above.</p>
          <p>• Click a package name to see its exports and vignettes.</p>
          <p>• Use "Run Examples" to run a function's examples in the console.</p>
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ouRGeo overview view
// ---------------------------------------------------------------------------
export function OurGeoView({ onPanel }: { onPanel: (p: OurGeoPanel) => void }) {
  return (
    <div className="p-4 space-y-5 overflow-y-auto h-full">
      <section>
        <h2 className="text-sm font-bold text-foreground mb-2">What is ouRGeo?</h2>
        <p className="text-xs text-geo-muted leading-relaxed">
          ouRGeo is a desktop application that gives you a full R coding environment designed
          especially for geographic and spatial analysis. Think of it as a science lab for your
          data — you have everything you need in one place: a place to write your code, a place
          to see your results, tools for working with maps, and helpers that make common tasks
          easier.
        </p>
        <p className="text-xs text-geo-muted leading-relaxed mt-2">
          Everything runs on your own computer using a real R session, so your code and data
          stay private. Click any section below to learn what it does.
        </p>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-geo-muted uppercase tracking-wider mb-2">App Sections</h3>
        <div className="flex flex-wrap gap-1.5">
          {OURGEO_PANELS.map((p) => (
            <PanelChip key={p.id} meta={p} onClick={() => onPanel(p.id)} />
          ))}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ouRGeo panel detail view
// ---------------------------------------------------------------------------
export function OurGeoPanelView({ panel }: { panel: OurGeoPanel }) {
  const meta = OURGEO_PANELS.find((p) => p.id === panel)!

  const content: Record<OurGeoPanel, React.ReactNode> = {
    editor: (
      <>
        <p>
          The <strong>Code Editor</strong> is the big text area that takes up the top half of the
          screen. This is where you write your R programs, just like writing in a notebook — except
          the computer can read and run what you write.
        </p>
        <p>
          The editor uses the same engine as Visual Studio Code (a very popular coding tool), so it
          is fast and smart. It automatically colours different parts of your code to make them
          easier to read — keywords show up in one colour, function names in another, and text
          strings in another. This is called <em>syntax highlighting</em>.
        </p>
        <h4>Running code</h4>
        <ul>
          <li><strong>Ctrl + Enter</strong> — runs the single line your cursor is on, then moves the cursor to the next line. Great for stepping through code one line at a time.</li>
          <li><strong>Shift + Enter</strong> — runs everything you have highlighted (selected). Use this to run a whole block at once.</li>
        </ul>
        <h4>Working with files</h4>
        <ul>
          <li>You can have <strong>multiple tabs</strong> open at the same time — one tab per .R file.</li>
          <li><strong>Ctrl + S</strong> saves the current file. If the file has never been saved, it will ask you where to save it.</li>
          <li>Use the <strong>folder icon</strong> in the toolbar to open an existing .R file from your computer.</li>
          <li>An orange dot on a tab means you have unsaved changes.</li>
        </ul>
        <h4>Tips</h4>
        <ul>
          <li>You can drag the horizontal divider between the editor and the console up or down to give each more space.</li>
          <li>The editor remembers your cursor position when you switch between tabs.</li>
        </ul>
      </>
    ),

    console: (
      <>
        <p>
          The <strong>R Console</strong> is the panel in the bottom half of the screen. It is your
          live connection to R — every time you run code from the editor, the results, messages, and
          any errors appear here.
        </p>
        <p>
          Think of it like a conversation with R. You say something (run some code), and R replies
          with the answer right below it.
        </p>
        <h4>The input line</h4>
        <p>
          At the very bottom of the console you will see a line that starts with <code>&gt;</code>.
          This is the direct input line. You can type any R command here and press{' '}
          <strong>Enter</strong> to run it immediately — without going through the editor at all.
          It is perfect for quick one-off calculations or checking a value.
        </p>
        <h4>Command history</h4>
        <ul>
          <li>Press the <strong>Up arrow</strong> key in the input line to bring back the last command you ran. Keep pressing Up to go further back.</li>
          <li>Press the <strong>Down arrow</strong> to go forward through history again.</li>
        </ul>
        <h4>Reading the output</h4>
        <ul>
          <li>Normal output appears in the default text colour.</li>
          <li><strong>Errors</strong> appear in red. An error means R could not finish what you asked — read the message carefully for clues about what went wrong.</li>
          <li><strong>Warnings</strong> appear in yellow/orange. A warning means R finished, but something was a little unusual — it is worth checking.</li>
          <li><strong>Messages</strong> (like package loading notices) appear in a muted colour.</li>
        </ul>
        <h4>Tips</h4>
        <ul>
          <li>The console scrolls automatically to show the latest output.</li>
          <li>You can scroll up to read older output at any time.</li>
        </ul>
      </>
    ),

    environment: (
      <>
        <p>
          The <strong>Environment Panel</strong> is like looking inside R's backpack. Every time
          you create a variable — like <code>x &lt;- 5</code> or <code>myData &lt;- read.csv(...)</code>{' '}
          — R stores it in memory. The Environment panel shows you a live list of everything
          R is currently holding.
        </p>
        <p>
          Open it by clicking the <strong>stacked-layers icon</strong> in the toolbar at the top.
        </p>
        <h4>What you can see</h4>
        <ul>
          <li><strong>Variables</strong> — simple values like numbers and text.</li>
          <li><strong>Data frames</strong> — tables of data with rows and columns, like a spreadsheet.</li>
          <li><strong>Lists</strong> — collections of mixed items.</li>
          <li><strong>Spatial objects</strong> — geographic data like points, lines, or polygons.</li>
          <li><strong>Functions</strong> — code you have written and stored for reuse.</li>
        </ul>
        <h4>Inspecting objects</h4>
        <p>
          Click on any item in the list to open a detailed viewer. For data frames, you will see
          the full table. For vectors, you will see all the values. For spatial objects, you will
          see the geometry information.
        </p>
        <h4>Multiple environments</h4>
        <p>
          R actually has several environments layered on top of each other. The panel lets you
          browse the global environment (where your own variables live) as well as package
          environments. Use the dropdown at the top of the panel to switch.
        </p>
        <h4>Tips</h4>
        <ul>
          <li>If a variable disappears, you probably ran <code>rm(variableName)</code> or restarted R.</li>
          <li>Large data frames show a preview — click to see the full table.</li>
        </ul>
      </>
    ),

    packages: (
      <>
        <p>
          R packages are like apps you can install to give R new superpowers. On its own, R can
          already do a lot — but packages like <strong>ggplot2</strong> let you make beautiful
          charts, <strong>sf</strong> lets you work with maps, and <strong>dplyr</strong> makes
          working with tables much easier.
        </p>
        <p>
          Open the Packages panel by clicking the <strong>box/package icon</strong> in the toolbar.
        </p>
        <h4>Installing a package</h4>
        <p>
          Click the <strong>Install</strong> button and search for the package by name. ouRGeo
          fetches the list from CRAN — the official R package repository — and installs it for you.
          This only needs to be done once per computer.
        </p>
        <h4>Loading a package</h4>
        <p>
          Installing puts a package on your computer, but you also need to <em>load</em> it each
          session to use it. Click <strong>Load</strong> next to a package to run{' '}
          <code>library(packageName)</code>. A green indicator means it is currently loaded.
        </p>
        <h4>Unloading and updating</h4>
        <ul>
          <li><strong>Unload</strong> — removes the package from the current R session without uninstalling it.</li>
          <li><strong>Update</strong> — installs the latest version from CRAN if one is available.</li>
          <li><strong>Remove</strong> — completely uninstalls the package from your computer.</li>
        </ul>
        <h4>Library paths</h4>
        <p>
          R can store packages in multiple locations on your computer (called library paths). The
          panel shows packages grouped by their library. You can add a new library path using the
          button at the top.
        </p>
      </>
    ),

    spatial: (
      <>
        <p>
          The <strong>Spatial Editor</strong> is a specialised panel for working with geographic
          data — things like maps of countries, rivers, roads, building footprints, or any other
          data that has a location attached to it.
        </p>
        <p>
          Open it by clicking the <strong>globe icon</strong> in the toolbar.
        </p>
        <h4>What kinds of data can it show?</h4>
        <ul>
          <li><strong>Points</strong> — individual locations, like city centres or survey sample sites.</li>
          <li><strong>Lines</strong> — paths like roads, rivers, or routes.</li>
          <li><strong>Polygons</strong> — areas like countries, districts, or land parcels.</li>
          <li>Works with the popular <strong>sf</strong> and <strong>terra</strong> R packages.</li>
        </ul>
        <h4>How to use it</h4>
        <p>
          When you have a spatial object in R (created with <code>sf::st_read()</code>,{' '}
          <code>terra::vect()</code>, or similar), it will appear in the Spatial Editor's list.
          Click the object to display it on an interactive map — you can zoom in and out, pan
          around, and click on features to see their attributes.
        </p>
        <h4>Spatial operations</h4>
        <p>
          The Spatial Editor gives you quick access to common operations without needing to
          remember the exact function names:
        </p>
        <ul>
          <li>Buffer — expand features by a set distance.</li>
          <li>Clip — cut one layer to the shape of another.</li>
          <li>Dissolve — merge features that share the same attribute value.</li>
          <li>And more, depending on the selected geometry type.</li>
        </ul>
        <h4>Tips</h4>
        <ul>
          <li>Make sure your data is in a sensible coordinate reference system (CRS) before displaying it.</li>
          <li>Use <code>sf::st_transform()</code> in the console to reproject if needed.</li>
        </ul>
      </>
    ),

    plotting: (
      <>
        <p>
          The <strong>Plotting Panel</strong> automatically captures and displays any chart or graph
          that your R code draws — whether you use base R graphics, <strong>ggplot2</strong>,{' '}
          <strong>lattice</strong>, or any other standard plotting package.
        </p>
        <p>
          Open it by clicking the <strong>image/picture icon</strong> in the toolbar.
        </p>
        <h4>How it works</h4>
        <p>
          When you run code that creates a plot, ouRGeo captures the output in the background and
          displays it in this panel automatically. You do not need to do anything special — just
          write your plotting code and run it.
        </p>
        <h4>Navigating plots</h4>
        <ul>
          <li>If you run several plotting commands, you can browse through them using the <strong>left and right arrows</strong> at the top of the panel.</li>
          <li>The most recent plot is always shown first.</li>
        </ul>
        <h4>Exporting a plot</h4>
        <p>
          Click the <strong>Export</strong> button to save the current plot to your computer. You
          can choose:
        </p>
        <ul>
          <li><strong>PNG</strong> — great for web or presentations.</li>
          <li><strong>JPG</strong> — smaller file size, slightly lower quality.</li>
          <li><strong>PDF</strong> — best for printing or publication-quality figures.</li>
        </ul>
        <p>
          You can also set the width, height, and resolution (DPI) before exporting.
        </p>
        <h4>Tips</h4>
        <ul>
          <li>Use <code>ggplot2</code> for the most control over how your charts look.</li>
          <li>For maps, use the <strong>Spatial Editor</strong> — it renders and exports your maps.</li>
        </ul>
      </>
    ),

    ai: (
      <>
        <p>
          The <strong>AI Assistant</strong> is a built-in chat panel that lets you ask questions and
          get help with your R code — without ever leaving ouRGeo.
        </p>
        <p>
          Open it by clicking the <strong>robot/bot icon</strong> in the toolbar.
        </p>
        <h4>What can you ask it?</h4>
        <ul>
          <li><strong>Explain an error</strong> — paste the red error message from the console and ask "What does this mean and how do I fix it?"</li>
          <li><strong>Write code for you</strong> — describe what you want to do in plain English and ask for R code.</li>
          <li><strong>Explain existing code</strong> — paste some code and ask "What does this do?"</li>
          <li><strong>Suggest improvements</strong> — ask "Is there a better way to write this?"</li>
          <li><strong>Learn concepts</strong> — ask "What is the difference between a data frame and a tibble?"</li>
        </ul>
        <h4>Spatial analysis help</h4>
        <p>
          The AI understands spatial analysis concepts and packages like <strong>sf</strong>,{' '}
          <strong>terra</strong>, <strong>leaflet</strong>, and <strong>tmap</strong>. You can ask
          things like "How do I reproject my sf object to WGS84?" or "What is the fastest way to
          calculate the area of each polygon?"
        </p>
        <h4>Tips</h4>
        <ul>
          <li>Give context — mention the package you are using and what your data looks like.</li>
          <li>Copy code suggestions directly into the editor and run them.</li>
          <li>The chat history is preserved while ouRGeo is open.</li>
        </ul>
      </>
    ),

    toolbox: (
      <>
        <p>
          The <strong>Toolbox</strong> is a collection of ready-made spatial analysis tools
          presented as simple forms. Instead of having to remember exact function names and
          arguments, you fill in a few boxes and click <strong>Run</strong>.
        </p>
        <p>
          Open it by clicking the <strong>wrench icon</strong> in the toolbar.
        </p>
        <h4>Available tools</h4>
        <p>The Toolbox is organised into categories:</p>
        <ul>
          <li><strong>Buffer</strong> — expand each feature outward by a distance you choose. Useful for "everything within 500 metres of a road."</li>
          <li><strong>Clip</strong> — cut a layer to the boundary of another layer. Like using a cookie cutter on your data.</li>
          <li><strong>Dissolve</strong> — merge features that share the same value in a chosen column into single features.</li>
          <li><strong>Union / Intersect / Difference</strong> — combine or subtract two layers from each other.</li>
          <li><strong>Centroid</strong> — replace polygons with their centre points.</li>
          <li>And many more spatial and data manipulation tools.</li>
        </ul>
        <h4>Piping tools together</h4>
        <p>
          You can chain tools together in a pipeline — the output of one tool feeds directly into
          the next. This lets you build multi-step workflows without writing any code.
        </p>
        <h4>Tips</h4>
        <ul>
          <li>The Toolbox generates real R code behind the scenes — you can inspect or copy it.</li>
          <li>All outputs are saved as new objects in your R environment, so you can keep working with them.</li>
          <li>Make sure the spatial objects you want to use are already loaded in R before opening the Toolbox.</li>
        </ul>
      </>
    ),

    loaddata: (
      <>
        <p>
          The <strong>Load Data</strong> dialog is a step-by-step wizard that helps you bring data
          files from your computer into R. Instead of having to remember file-reading functions and
          their options, you pick a file, set a few options, and click Load.
        </p>
        <p>
          Open it by clicking the <strong>folder-with-arrow icon</strong> in the toolbar.
        </p>
        <h4>Supported file types</h4>
        <ul>
          <li><strong>CSV / TSV</strong> — plain text tables with comma or tab separators.</li>
          <li><strong>Excel (.xlsx, .xls)</strong> — spreadsheets, including specific sheet selection.</li>
          <li><strong>Shapefile (.shp)</strong> — the classic geographic vector format.</li>
          <li><strong>GeoJSON</strong> — a modern, web-friendly geographic format.</li>
          <li><strong>GeoPackage (.gpkg)</strong> — a modern single-file geographic database.</li>
          <li>And other formats supported by the <code>sf</code> and <code>readr</code> packages.</li>
        </ul>
        <h4>Preview before loading</h4>
        <p>
          After selecting a file, the dialog shows you a preview of the first few rows so you can
          check everything looks right before committing. You can adjust options like:
        </p>
        <ul>
          <li>Whether the first row is a header.</li>
          <li>The column separator character.</li>
          <li>How many rows to skip at the top.</li>
        </ul>
        <h4>Tips</h4>
        <ul>
          <li>The loaded object is given a name based on the file name — you can rename it in R afterwards.</li>
          <li>For very large files, use <code>data.table::fread()</code> in the editor for faster loading.</li>
        </ul>
      </>
    ),

    connector: (
      <>
        <p>
          The <strong>Data Connector</strong> lets you pull in data from external sources directly
          into ouRGeo — no manual downloading or file juggling required.
        </p>
        <p>
          Open it by clicking the <strong>cloud icon</strong> in the toolbar.
        </p>
        <h4>Kaggle datasets</h4>
        <p>
          Currently, the Data Connector supports <strong>Kaggle</strong> — one of the largest
          repositories of public datasets in the world, covering topics from climate data to
          satellite imagery to urban planning.
        </p>
        <p>To use it you need:</p>
        <ul>
          <li>A free <strong>Kaggle account</strong> (sign up at kaggle.com).</li>
          <li>Your <strong>Kaggle API key</strong> — found in your Kaggle profile settings under "API".</li>
          <li>The <strong>dataset reference</strong> — the part of the dataset URL after kaggle.com/datasets/ (for example, <code>username/dataset-name</code>).</li>
        </ul>
        <h4>How it works</h4>
        <ol>
          <li>Enter the dataset reference and your API key in the form.</li>
          <li>Click <strong>Browse Files</strong> to see what files are in the dataset.</li>
          <li>Select the file you want and click <strong>Load</strong>.</li>
          <li>ouRGeo downloads the file and loads it into R automatically.</li>
        </ol>
        <h4>Tips</h4>
        <ul>
          <li>Your API key is only stored in memory for the current session — it is never saved to disk.</li>
          <li>Large datasets may take a moment to download depending on your internet speed.</li>
          <li>After loading, the data appears in your Environment panel like any other R object.</li>
        </ul>
      </>
    ),
  }

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded bg-geo-panel border border-geo-border flex items-center justify-center flex-shrink-0">
          <meta.Icon className="w-3.5 h-3.5 text-geo-accent" />
        </div>
        <h2 className="text-sm font-bold text-foreground">{meta.label}</h2>
        <span className="text-xs text-geo-muted">{meta.tagline}</span>
      </div>
      <div className="text-xs text-geo-muted space-y-3 leading-relaxed ourgeo-panel-content">
        {content[panel]}
      </div>
      <style>{`
        .ourgeo-panel-content h4 { color: #e6edf3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 1.25em; margin-bottom: 0.5em; }
        .ourgeo-panel-content ul, .ourgeo-panel-content ol { padding-left: 1.25em; space-y: 0.25em; }
        .ourgeo-panel-content li { margin-bottom: 0.25em; }
        .ourgeo-panel-content strong { color: #e6edf3; font-weight: 600; }
        .ourgeo-panel-content em { color: #79c0ff; font-style: normal; }
        .ourgeo-panel-content code { background: #161b22; color: #79c0ff; padding: 1px 4px; border-radius: 3px; font-family: monospace; font-size: 11px; }
        .ourgeo-panel-content pre { background: #161b22; color: #79c0ff; padding: 8px 10px; border-radius: 4px; font-family: monospace; font-size: 11px; overflow-x: auto; margin-top: 0.5em; white-space: pre; }
        .ourgeo-panel-content p { margin-bottom: 0.5em; }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Search results view
// ---------------------------------------------------------------------------
export function ResultsView({
  results,
  onDoc,
  onPackage,
}: {
  results: HelpSearchResult[]
  onDoc: (topic: string, pkg?: string) => void
  onPackage: (pkg: string) => void
}) {
  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-geo-muted">
        No results found.
      </div>
    )
  }

  return (
    <div className="overflow-y-auto h-full">
      {results.map((r, i) => (
        <button
          key={i}
          onClick={() => onDoc(r.name, r.package)}
          className="w-full text-left px-4 py-2 border-b border-geo-border hover:bg-geo-panel transition-colors group"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-foreground">{r.name}</span>
            {r.package && (
              <span
                className="text-xs text-geo-accent hover:underline"
                onClick={(e) => { e.stopPropagation(); onPackage(r.package!) }}
              >
                {r.package}
              </span>
            )}
            {r.source === 'loaded' && (
              <span className="text-[10px] text-geo-success">loaded</span>
            )}
          </div>
          {r.title && (
            <div className="text-xs text-geo-muted mt-0.5 truncate">{r.title}</div>
          )}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Doc view
// ---------------------------------------------------------------------------
export function DocView({
  view,
  onPackage,
}: {
  view: { type: 'doc'; topic: string; pkg: string; html: string; examples: string }
  onPackage: (pkg: string) => void
}) {
  const addConsoleEntry = useSessionStore((s) => s.addConsoleEntry)

  const runExamples = useCallback(async () => {
    if (!view.examples) return
    addConsoleEntry('input', view.examples)
    await rClient.execute(view.examples)
  }, [view.examples, addConsoleEntry])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-geo-border flex-shrink-0 bg-geo-panel">
        <span className="text-xs font-medium text-foreground">{view.topic}</span>
        {view.pkg && (
          <button
            onClick={() => onPackage(view.pkg)}
            className="text-xs text-geo-accent hover:underline"
          >
            {view.pkg}
          </button>
        )}
        <div className="flex-1" />
        {view.examples && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-geo-muted hover:text-foreground gap-1"
            onClick={runExamples}
            title="Run examples in console"
          >
            <Play className="w-3 h-3" />
            Run Examples
          </Button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <HtmlViewer html={view.html} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Package view
// ---------------------------------------------------------------------------
export function PackageView({
  view,
  onDoc,
  onVignette,
}: {
  view: { type: 'package'; pkg: string; title: string; description: string; functions: string[]; vignettes: { name: string; title: string }[] }
  onDoc: (topic: string, pkg: string) => void
  onVignette: (pkg: string, name: string) => void
}) {
  const [fnSearch, setFnSearch] = useState('')
  const filtered = fnSearch
    ? view.functions.filter((f) => f.toLowerCase().includes(fnSearch.toLowerCase()))
    : view.functions

  return (
    <div className="overflow-y-auto h-full p-4 space-y-4">
      <div>
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-foreground">{view.pkg}</h2>
          <span className="text-xs text-geo-muted">{view.title}</span>
        </div>
        <p className="text-xs text-geo-muted mt-1 leading-relaxed">{view.description}</p>
      </div>

      {view.vignettes.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-geo-muted uppercase tracking-wider mb-2 flex items-center gap-1">
            <BookOpen className="w-3 h-3" /> Vignettes
          </h3>
          <div className="space-y-1">
            {view.vignettes.map((v) => (
              <button
                key={v.name}
                onClick={() => onVignette(view.pkg, v.name)}
                className="block w-full text-left text-xs text-geo-accent hover:underline px-2 py-1 rounded hover:bg-geo-panel transition-colors"
              >
                {v.title || v.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-xs font-semibold text-geo-muted uppercase tracking-wider flex items-center gap-1">
            <Package className="w-3 h-3" /> Exports ({view.functions.length})
          </h3>
          <input
            value={fnSearch}
            onChange={(e) => setFnSearch(e.target.value)}
            placeholder="filter..."
            className="ml-auto text-xs bg-geo-bg border border-geo-border rounded px-2 py-0.5 text-foreground placeholder:text-geo-muted focus:outline-none focus:border-geo-accent w-28"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {filtered.map((fn) => (
            <button
              key={fn}
              onClick={() => onDoc(fn, view.pkg)}
              className="px-2 py-0.5 text-xs rounded bg-geo-panel border border-geo-border text-geo-muted hover:text-foreground hover:border-geo-accent transition-colors font-mono"
            >
              {fn}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
