// ── ouRGeo version history ────────────────────────────────────────────────
// Release notes, newest first. Maintainer-announced patch releases can have
// their own entry; older releases use a.b. The running version comes from
// package.json, injected at build time, rather than the history array.

export interface ReleaseNote {
  version: string
  date: string
  /** Short theme name for the release. */
  title: string
  /** One-sentence summary of what the release was about. */
  summary: string
  /** The handful of big-picture changes that defined the release. */
  highlights: string[]
}

export const VERSION_HISTORY: ReleaseNote[] = [
  {
    version: '1.16.3',
    date: 'October 2026',
    title: 'Guided Installation Health Check',
    summary:
      'Get started with a guided check of R, its packages, system resources and the AI assistant, with approval before repairs or credit use.',
    highlights: [
      'A dismissible invitation appears on first launch. Start the check when ready, or run it again from Settings → Health check; a saved summary records results and remaining steps.',
      'Check for R and approve its installation when needed. Repair missing, outdated or incompatible R packages, including the core dependencies that can prevent Rscript from connecting after an R upgrade.',
      'Save the project before a repair stops the R session, then reconnect after installation. Check backend readiness, writable folders, free storage, system memory, GPU memory and document-export tools.',
      'Configure a local AI server and choose Qwen models suited to the available memory and storage. Downloads need approval, and testing a cloud or subscription model asks before using credits or plan allowance.',
    ],
  },
  {
    version: '1.16.2',
    date: 'September 2026',
    title: 'Complete ChatGPT Replies',
    summary:
      'Keep the full ChatGPT subscription answer and its tool calls, and report a reply that ends without a final answer.',
    highlights: [
      'Completed stream items now supply answer text and tool calls even when the final response summary does not repeat them. Missing text suffixes are recovered once, without duplicating the streamed answer.',
      'Commentary and final-answer phases survive conversation history and replay, so a preamble is not mistaken for the completed answer on a later turn.',
      'Reasoning-only, commentary-only and interrupted replies show a recovery message instead of silently stopping. Partial text stays visible and in chat history; request IDs help diagnose failures when the provider supplies one.',
    ],
  },
  {
    version: '1.16.1',
    date: 'September 2026',
    title: 'Use Your ChatGPT Plan',
    summary:
      'Connect an eligible ChatGPT account and use its plan allowance and subscription credits to power the assistant.',
    highlights: [
      'OpenAI subscription (ChatGPT) is a provider in Settings → AI Assistant. Continue with ChatGPT opens browser authorisation; choose an account or workspace and a model from its eligible catalogue.',
      'Manage usage and credits opens ChatGPT Settings → Usage. Subscription inference uses the Responses API and the existing tool permissions; API billing remains a separately selected provider.',
      'Credentials stay in the main process and are saved only when a secure operating-system keyring is available. Accounts, sign-out and rotating token refreshes are managed by the app; projects never contain tokens.',
      'OpenAI account and workspace eligibility and preview limitations apply. Voice transcription still uses its own configured service.',
    ],
  },
  {
    version: '1.16.0',
    date: 'September 2026',
    title: 'Managed Plugin Services',
    summary:
      'Let an installed plugin run a managed native background service, with startup and shutdown owned by ouRGeo.',
    highlights: [
      'Plugins can declare a JavaScript background service and its files, with an explicit service permission for native system access. The host provides a private loopback connection, so users do not need a companion terminal or pairing key.',
      'Starts are deduplicated, and disabling a plugin, losing its renderer or quitting stops the service. Persistent plugin data lives outside the replaceable plugin folder; store packages preserve declared service assets.',
      'Plugin panels mount as React components with an error boundary per panel, preventing a failed panel from taking down the workspace.',
    ],
  },
  {
    version: '1.15',
    date: 'September 2026',
    title: 'Curves, Chats and a Plugin Store',
    summary:
      'Type the curve a deed is written in, keep your conversations with the project, and install plugins other people wrote \u2014 each one run by a moderator before it appeared.',
    highlights: [
      'Curved courses in Distance & Bearing. Press U and type the call the way the deed or plat writes it \u2014 "along a curve to the right, radius 250.00 feet, central angle 45\u00b030\u2032" \u2014 and the arc lands where the numbers say it does. Tangent and non-tangent curves, clothoid spirals, the spiral\u2013curve\u2013spiral a highway plan quotes as one unit, and a free curve between two headings.',
      'Any two elements define a curve, so type the two your plat happens to quote \u2014 radius, arc length, chord, tangent, external, mid-ordinate, central angle or degree of curve. ouRGeo works out the rest and prints all of them back, which is how you check a curve against the document it came from. Where two perfectly ordinary curves would fit the numbers you gave, it says so and names both rather than quietly picking one.',
      'What is written to your layer is a real curve \u2014 CIRCULARSTRING and COMPOUNDCURVE, not a densified polyline \u2014 so the radius survives a reprojection and a GeoPackage round trip. Closure now measures the arc a curve actually follows rather than its chord, so a figure with curves in it is judged by the right length.',
      'Arcs are circles on the ground now. Three-point arcs used to be fitted in raw longitude and latitude, where a circle on the map is an ellipse on the Earth: a 250 m radius arc through 90\u00b0 landed 25 m out at latitude 45 and nearly 47 m at latitude 60. Geometry you have already saved is untouched \u2014 it simply draws correctly from now on.',
      'A plugin store. Browse it in Settings \u2192 Plugins \u2192 Plugin Store\u2026, or at ourgeo.dev/plugins.html \u2014 data connectors, geoprocessing tools, panels and workflows written by other ouRGeo users. Every one has been installed and run by a moderator before it appeared.',
      'Installing happens inside ouRGeo and needs your free ourgeo.dev account, the same one the forum uses, because plugin downloads are not public. What you install still arrives switched off: turning it on stays your decision, exactly as it is for a plugin you were sent as a file.',
      'Publish your own. Publish\u2026 on any plugin you wrote builds it, uploads it and puts it in the queue; a moderator installs it, runs it, and either publishes it or sends it back with a note you can read. What people download is a built, minified bundle \u2014 your source is never published, and ouRGeo will not export or read back a plugin installed from the store.',
      'Show off what you built: attach several screenshots at once, watch each one resize and upload, and see which of them are on your store page and which are still waiting for you to submit. Pick the one that becomes the catalogue picture, reorder them, or remove one \u2014 and removing it takes it off the page rather than just out of the list.',
      'Updates are offered in Settings \u2192 Plugins and never applied for you, with the author\u2019s note about what changed. If a version is withdrawn after you installed it, ouRGeo switches that plugin off and tells you why in the console.',
      'Ratings and reviews, from people who have actually installed the plugin.',
      'The assistant can search the store and install from it, and will look there before offering to write you a plugin from scratch \u2014 an installed plugin is code somebody has already read and other people are already running.',
      'A plugin archive can no longer smuggle in code nobody read. ouRGeo used to pack its own compiled cache into an exported .ourgeoplugin and load it back without recompiling, which meant a hand-made archive could ship one thing to read and another to run. Both ends now leave it out, and imported archives are checked and bounded.',
      'The AI panel keeps as many conversations as you like instead of one. Start a new chat whenever you want and the last is still there \u2014 switch back from the header and carry on where you left off. Save the session as a project and its chats are kept with it, ready next time you open it, and they travel inside the .ourgeoproj so a project you send someone carries the conversations that shaped it.',
      'Chats in the scratch workspace last until you quit, like everything else in scratch \u2014 if a conversation turns out to be worth keeping, save the session as a project and it comes along.',
      'Each chat remembers the model it was held with, and switching back restores it \u2014 so a conversation written by a large cloud model is never quietly continued by a small local one. Chats name themselves from your first question, and you can rename or delete any of them.',
      'Use your Claude Pro or Max subscription as an AI provider. ouRGeo runs the Claude Code command-line tool you already installed and signed in to \u2014 no API key to paste, and ouRGeo never sees a credential of yours. Usage counts against your Claude plan.',
      'The context meter tells the truth. It used to report the total of every request a single answer made \u2014 several times the real figure on a long Autopilot turn \u2014 and only once the answer had finished. It now follows the live conversation as it grows.',
      'Much less of your Claude subscription spent per question: the session context ouRGeo sends now extends the cached conversation instead of invalidating it, and says only what has changed since the last turn. On a measured six-turn chat that was 21% fewer tokens overall and a third of the per-turn growth; on a two-turn chat, the difference between $0.0014 and $0.0235 for the same question.',
      'Local models get the time they need. ouRGeo no longer imposes a hidden five-minute deadline on a reply \u2014 a large prompt on a busy GPU used to fail with the words "fetch failed" and nothing else. Failures now name the server and what to do about it.',
      'Nothing you were reading disappears any more. A dropped connection used to replace a half-written answer with an empty one; pressing Stop used to delete it outright. Both keep what was said.',
      'Send does something the moment you press it, so a slow session can no longer turn one click into two messages.',
      'The open-data connectors answer again. NYC, Chicago and every other Socrata portal had been silently returning nothing \u2014 they were asking for a catalogue Socrata retired \u2014 and Canada\u2019s portal blamed your internet connection for problems that were never yours. Every connector now also carries a Help button that opens the API\u2019s own documentation, which is where the questions a connector cannot answer are answered.',
      'The USGS water connectors generate R that runs, and let you narrow the data: choose the gauge rather than taking a whole state, and the measurement \u2014 discharge, gage height, temperature, conductance, pH \u2014 rather than always discharge. Water quality and groundwater had been asking for NWIS services USGS has retired, and now use the endpoints that carry the data.',
      'Copy buttons throughout the app work again \u2014 they had been silently doing nothing since 1.12 while still showing a tick, along with the terminal\u2019s copy and paste.',
      'Hover any tab to read its full name, the file it came from, and whether it has unsaved changes.',
    ],
  },
  {
    version: '1.14',
    date: 'September 2026',
    title: 'Type It, Don\u2019t Eyeball It',
    summary:
      'Distance & Bearing \u2014 place the next point by typing how far and which way, on the grid your survey was measured on.',
    highlights: [
      'A Distance & Bearing tool beside Draw, for every kind of layer \u2014 lines, polygons and points. Press B, say where you are measuring from, then type each leg: 150 \u21b9 N45\u00b030\u2032E \u23ce, and the vertex lands exactly there.',
      'Bearings in the notation your notes are already written in: azimuths, degrees-minutes-seconds, quadrant bearings like N45\u00b030\u2032E, deflections (L/R) and angles right. Distances in metres, feet, US survey feet, chains, miles \u2014 or type 150ft and the unit comes with it.',
      'Distances are geodesic on the WGS 84 ellipsoid, computed with Vincenty\u2019s method rather than on a sphere, so a leg is the length you typed anywhere on Earth.',
      'A bearing off a plat means something different on a projected map, and ouRGeo now says which it is using. On a projected layer it measures on that layer\u2019s own grid \u2014 in the layer\u2019s own unit \u2014 so grid north and the scale factor are accounted for instead of quietly rotating your traverse by the convergence.',
      'On a point layer you place a reference point first \u2014 a temporary mark to measure from, not a row in your data \u2014 and every leg after it fills the row you are on and moves to the next, so the data viewer\u2019s row indicator walks the table exactly as it does when you click. Run out of rows and it asks whether to add another, as always.',
      'The reference point snaps if snapping is on, carries forward from the last point you placed, and can be moved anywhere at any time by clicking the map.',
      'It shows its working: where the leg lands as you type, the numbers written on the leg itself on the map, a list of everything entered in the words you entered it in, and \u2014 once a figure could close \u2014 how far it is from closing and the 1:N a surveyor judges it by.',
      'Finishing a traverse echoes a runnable ourgeo_traverse() call naming the origin, the legs and the CRS \u2014 because the geometry ouRGeo writes records the coordinates, not the distances and bearings they came from.',
      'The AI assistant can lay one out for you from a list of legs, staged for review like any drawn geometry.',
      'Fixed: coordinates in the R server\u2019s replies were rounded to four decimal places \u2014 eleven metres of longitude \u2014 which no feature had needed to more than four until this one did.',
    ],
  },
  {
    version: '1.13',
    date: 'September 2026',
    title: 'Run Anything',
    summary:
      'A real terminal inside ouRGeo \u2014 your own shell, beside the R console, for the half of the work that was never going to be R.',
    highlights: [
      'A Terminal tab beside the R console, always there. It is your own shell \u2014 bash, zsh, fish, PowerShell, whatever you use \u2014 with a real pseudo-terminal behind it, so top, vim, git and colour all work exactly as they do in a terminal window.',
      'Nothing starts until you click the tab. Open as many shells as you like from the + button, rename them, and pick a different shell from the arrow beside it; the tab shows a dot when a command finishes in one you are not watching.',
      'It opens in R\u2019s working directory, and the path in the header is a control: click it to change directory, copy it, open it in your file manager, or reconcile the two \u2014 send R to the shell\u2019s directory, or type cd to R\u2019s.',
      'Colours follow your code theme and the surface follows your app theme, the same way the editor does, so ls looks like it belongs in the window it is in.',
      'Search with Ctrl+Shift+F, copy and paste with Ctrl+Shift+C/V, and resize the text with Ctrl+= and Ctrl+- \u2014 everything else goes to the shell, including Ctrl+C, Ctrl+R and Ctrl+D.',
      'Settings \u2192 Terminal gives it its own pane beside the console instead of a tab, so both are visible at once \u2014 and after that you can drag it anywhere and ouRGeo leaves it there.',
      'Reload the window and your shells are still running, with their scrollback. Close ouRGeo and they are gone: terminal output is never written to disk, not into a project bundle and not into the session file.',
      'The AI assistant can use it, behind a Terminal switch in the panel footer that ships OFF and works only with Autopilot on. Every command it runs is typed into a tab you are watching and written to your R console.',
      'It is not a sandbox and is not offered as one \u2014 R\u2019s own system() reaches the same machine. What the switch means is that you decided, once and deliberately, that running commands on your computer is part of what the assistant does. Ask it to do things in R wherever R can do them.',
      'A second code editor: Settings \u2192 Workspace adds one, and documents drag between the two by their tabs or move with a right-click. Removing an editor never closes a document \u2014 they move to the one that remains.',
      'Panel drag grips now ship off. They appeared on every panel header on hover, which is a gesture that mostly fires by accident when you did not go looking for it; Settings \u2192 Workspace turns them on and can rearrange everything without them.',
      'Every on/off setting is now a switch rather than a checkbox, and the whole row is the control \u2014 a settings row takes effect the moment it moves, and there was never an OK button to press.',
    ],
  },
  {
    version: '1.12',
    date: 'September 2026',
    title: 'Say It Out Loud',
    summary:
      'Dictate to the AI assistant \u2014 on your own machine by default, with nothing uploaded and no account needed.',
    highlights: [
      'A microphone beside Send in the AI panel. Click it, talk, and the transcript lands in the message box at the cursor \u2014 so you can start typing a sentence and finish it out loud.',
      'It shows you it is listening: a ring around the microphone that moves with your voice, a timer, and a live level meter in Settings so you can check the right device is picked up before you rely on it.',
      'Transcription runs ON YOUR MACHINE by default. Whisper is downloaded once (43\u2013242 MB, your choice of model) and then works offline for ever \u2014 no account, no key, and nothing you say leaves the computer.',
      'Prefer something else? Point it at a server you run (whisper.cpp, Speaches, LocalAI), or at OpenAI, Groq, Deepgram, ElevenLabs Scribe or AssemblyAI. Deepgram shows words as you speak them.',
      'Every recording sent off your machine is recorded in the R console, with how long it was and where it went. The on-device engine never appears there, because there is nothing to report.',
      'Pick your microphone from the button itself (right-click) or in Settings \u2192 Voice input, along with the language, how long a pause should end a recording, and whether to send the message automatically.',
      'Auto-send is off by default: the assistant can run R, and a misheard instruction is worth reading before it goes.',
      'ouRGeo now asks your operating system for the microphone and nothing else \u2014 the app previously had no permission policy at all, and could have been granted location or notifications without anything appearing on screen.',
    ],
  },
  {
    version: '1.11',
    date: 'September 2026',
    title: 'Make It Do More',
    summary:
      'Plugins, and a workspace that goes where you put it — ouRGeo can now gain capabilities it did not ship with, without being rebuilt.',
    highlights: [
      'Plugins (Settings \u2192 Plugins): data connectors, geoprocessing tools, actions, toolbar buttons, panels and documentation, added while the app is running. Most are pure JSON and run no code at all.',
      'Ask the AI assistant for one in prose \u2014 "add a connector for this API" \u2014 and it probes the API, writes the spec, tests it against the real server, and asks you to turn it on.',
      'A plugin that ships code is compiled on the spot, runs with ouRGeo\u2019s own privileges, and arrives switched OFF. Enabling one is a decision you make, the way you decide to run install.packages().',
      'Plugins export and import as portable .ourgeoplugin files. One that fails to load is reported and skipped, never fatal \u2014 and one that takes the app down disables itself on the next launch rather than leaving you locked out.',
      'A workspace you arrange: four zones \u2014 left, centre, right and bottom \u2014 and any panel can go in any of them, split or tabbed, at whatever size you like. Drag a panel by the grip in its corner.',
      'Panels sharing a zone share it evenly \u2014 two take half each, three a third each \u2014 until you drag a divider between them. Double-click a divider to even them out again, and every zone starts each session evenly shared.',
      'Your arrangement is remembered between sessions, and you can save several as named presets and switch between them.',
      'Toolbar buttons can be reordered and hidden, and the assistant can rearrange all of it on request \u2014 with layout:reset always the way back.',
      'Fixed: opening a project restored its R objects but showed an empty Environment panel \u2014 everything the bundle loaded was being treated as though it were ouRGeo\u2019s own rather than yours.',
      'Fixed: the helper functions ouRGeo defines for generated code no longer end up in your project bundles, in your Environment panel, or deleted the moment you open a project.',
      'Fixed: when the assistant moved the map for you \u2014 zooming from landmark to landmark on a tour \u2014 the view never changed. Every map:setView now moves the map you are looking at, and the export extent follows it.',
      'Console recording gained a destination: the assistant can now record into a new document, or into a saved file that offers to write itself back when you stop.',
      'The Environment panel: right-clicking an environment offers Export, Make Copy, Rename and Delete, and Save is now called Export \u2014 it writes an .RData file to your computer.',
      'Environments you can work IN: right-click one and choose \u201cWork in this environment\u201d, and everything you run \u2014 console, toolbox, assistant \u2014 evaluates inside it. R looks names up outwards and never into an environment, so this is what lets you type x * a instead of env2$x; .GlobalEnv stays visible through it, and the prompt shows where you are. Switching echoes the R for it \u2014 evalq({ ... }, env2) \u2014 so the same move works in a script.',
      'Creating an environment now says how to reach what you put in it, in the console, at the moment you make it.',
      'Objects gained Copy To beside Move To \u2014 same name, another environment, the original left where it is.',
      'An environment is listed beside .GlobalEnv by default; Show in its right-click menu lists it inside .GlobalEnv instead, where R actually keeps it.',
      'Move To now offers the environments you can actually see: .GlobalEnv and your own while the eye is hiding what is not yours, every environment in the session when it is not.',
      'Fixed: \u201cMake Copy\u201d on an environment made a second name for the same environment rather than a copy \u2014 editing either one changed both.',
      'Fixed: R\u2019s refusals reach you. Naming an environment after a data frame, moving an object into a package environment, copying onto a name already taken \u2014 each one used to do nothing and say nothing.',
      'Fixed: exporting an environment no longer writes ouRGeo\u2019s own internal functions into your .RData file, and the console shows the exact save() that was run.',
      'Settings \u2192 Workspace: save the panel arrangement by name and switch between arrangements, export and import them as .ourgeolayout.json files, turn the drag grips off if you would rather they weren\u2019t there, and restore the shipped default in one click.',
      'Fixed: the grip in a panel\u2019s corner did nothing when you dragged it \u2014 dropping a panel into another zone now works, and an empty zone offers itself as a target so a panel can always be moved back.',
      'Move a dataset between panels from wherever you are: Add to Map in the data viewer\u2019s header sends a table to the spatial editor, and right-clicking a layer in Contents opens its attribute table.',
      'Sending an object that is already on the map now asks first \u2014 and offers to show you the layer you already have instead of adding a second copy of it.',
    ],
  },
  {
    version: '1.10',
    date: 'August 2026',
    title: 'Make It Yours',
    summary:
      'The Theme Studio — build your own themes on all three axes, with your own artwork, and share them as files.',
    highlights: [
      'Theme Studio (Settings → Appearance): create app themes, code themes and markdown themes of your own, always by copying one that already works.',
      'Every colour is editable and labelled with what it actually paints — ten interface colours and six editor-surface colours for an app theme — with live contrast warnings and a preview that updates as you type without touching the running app.',
      'Bring your own artwork: a backdrop image behind the code editor with its own opacity and grey-scale, and a card image for the theme picker. Both are embedded in the theme, so it travels with its pictures.',
      'An app theme also chooses the code and markdown palettes it starts with, and the basemap the Spatial Editor opens with under it.',
      'Themes export and import as portable .ourgeotheme.json files — and a file meant for one axis can never land in another\u2019s list.',
      'The AI assistant can build a theme to your description, check its own contrast, and switch you to it.',
      'Fixed a settings-file race that could corrupt theme.json and quietly reset the app to the Dark theme on the next launch.',
    ],
  },
  {
    version: '1.9',
    date: 'August 2026',
    title: 'Markdown & R Markdown',
    summary:
      '.md, .Rmd and .qmd become first-class documents — written, run, knitted and published without leaving ouRGeo.',
    highlights: [
      'Markdown and R Markdown documents in the code editor, with a formatting ribbon, a slash-command menu, and full R autocomplete inside chunks.',
      'Runnable chunks with inline output: run a chunk and its plots and printed results appear beneath it, right in the document.',
      'A Visual mode that edits the rendered document directly and round-trips back to source without reformatting what you wrote.',
      '“Chunk: current map” generates real tmap or ggplot2 code from the layers, symbology and view currently on the map — the same code the Export dialogs produce.',
      'Knit to HTML, PDF or Word in a clean R session, with each format pre-disabled and explained when its dependencies (pandoc, LaTeX) are missing.',
      'Publish an R Markdown document straight to the community forum as a new discussion, figures and all.',
      'Separate code-editor and markdown editor themes: 26 syntax palettes and 16 prose palettes, chosen independently of the app theme.',
    ],
  },
  {
    version: '1.8',
    date: 'July 2026',
    title: 'Raster & Imagery Connectors',
    summary:
      'The Data Connector gains a dedicated Raster / Image Layers category — industry-standard imagery services import straight to the map.',
    highlights: [
      'New Raster / Image Layers category in the Web APIs tab, gathering every raster-serving connector in one place with verified built-in servers for each.',
      'Esri Image Services connector (USGS 3DEP elevation, USDA NAIP aerial imagery) — the ImageServer workflow, now a first-class connector.',
      'OGC WCS connector: real raster data values (EMODnet bathymetry, DLR SRTM elevation) via scaled GetCoverage requests that auto-split around server read limits.',
      'OGC WMS connector: rendered map imagery (NASA GIBS satellite layers with time selection, terrestris OSM/SRTM) chunked and mosaicked into georeferenced rasters.',
      'ERDDAP Grids connector: gridded scientific data (NOAA sea-surface temperature and friends) — one variable, one time slice, real values.',
      'Raster imports can now land directly on the map: an "Add to map when done" option registers, styles, and zooms to the layer automatically.',
    ],
  },
  {
    version: '1.7',
    date: 'July 2026',
    title: 'The Raster Release',
    summary:
      'Rasters become a first-class data type — rendered, styled, analyzed, imported, and stored like everything else.',
    highlights: [
      'Rasters on the map: SpatRasters render as crisp, server-tiled layers in the Spatial Editor, with a band viewer and full symbology (RGB/pseudocolor/categorical, stretch controls, color ramps, histograms).',
      'A complete raster toolbox — 30+ tools covering processing (reproject, clip, resample, focal, terrain, hillshade, raster calculator), band math (NDVI and friends), and raster↔vector work like zonal statistics and extract-to-points.',
      'GeoTIFF and Cloud-Optimized GeoTIFF import: local files, COGs streamed by URL, and STAC raster assets from satellite catalogs.',
      'Tiled raster storage in .Rgeo databases (format v3): rasters save as compressed block pyramids and connect back instantly as lazy, file-backed objects.',
      'Map export parity — ggplot2 and tmap exports reproduce on-map raster symbology exactly (band, stretch, ramp).',
    ],
  },
  {
    version: '1.6',
    date: 'July 2026',
    title: 'Projects & Polish',
    summary:
      'A real project workflow plus a top-to-bottom refresh of the Settings and theming experience.',
    highlights: [
      'Project workflow: save and load portable .ourgeoproj bundles that snapshot the R environment and full UI state, with a scratch workspace that always launches clean.',
      'Redesigned Settings: collapsible, icon-led sections and an in-app version history.',
      'Scenic theme picker — each theme is shown as its own themed illustration, with subtle grey-scaled artwork painted behind the code editor.',
      'Retired the standalone Map Preview panel; all map-making now lives in the Spatial Editor.',
      'Package name autocompletion inside library()/require(), with the Packages pane auto-refreshing on install.',
      'Stability: fixed a black-screen restore after sleep and tightened memory cleanup on exit.',
    ],
  },
  {
    version: '1.5',
    date: 'July 2026',
    title: 'Scale & Depth',
    summary:
      'The largest release — a ground-up architecture overhaul plus databases and much richer map export.',
    highlights: [
      'Database support: connect to .Rgeo (DuckDB) databases, manage datasets, and edit database-backed spatial objects directly.',
      'First-class curved geometry via sfarc, plus auto-detected calculation CRS and configurable default CRS for new geometry.',
      'Expanded Data Connector with a Web APIs framework (Esri, OGC, WFS, STAC, SDMX, OData, CKAN, Socrata, ERDDAP, and more).',
      'Map export to both tmap and ggplot2 with legends, north arrows, scale bars, and graticules.',
      'Local model harness support (llama.cpp and others) for the AI assistant.',
      'Under the hood: modular R server, AI calls proxied through the main process, and a Vitest test suite — plus many data-editor and console improvements.',
    ],
  },
  {
    version: '1.4',
    date: 'April 2026',
    title: 'Data & Intelligence',
    summary:
      'Connected ouRGeo to the outside world and added guided, code-free workflows.',
    highlights: [
      'Data Connector for importing from popular open-data portals.',
      'Kaggle integration for pulling datasets straight into R.',
      'AI Assistant panel for in-app coding help.',
      'Toolbox: a GUI over a large set of classic R spatial and tabular operations, with the ability to pipe tools together.',
      'Plotting preview pane, a ggplot GUI editor, and an in-app Help panel.',
    ],
  },
  {
    version: '1.3',
    date: 'March 2026',
    title: 'Maps & Polish',
    summary:
      'Turned the workspace into a polished spatial app with real map editing.',
    highlights: [
      'Settings with switchable themes applied across the editor, data viewer, and map.',
      'Create-dataset dialog for vectors, matrices, data.frames, tibbles, and data.tables.',
      'Geometry drawing with snapping, a symbology editor, and multiple concurrent spatial editor sessions with user-defined extents.',
      'Map zoom and fit-to-extent controls, plus selection syncing between the data viewer and the map.',
      'Switchable R installation path, console recording, and zoomable UI text and icons.',
    ],
  },
  {
    version: '1.2',
    date: 'March 2026',
    title: 'The Workspace',
    summary:
      'Grew from an editor into a full R workspace with packages, environment, and data.',
    highlights: [
      'Package Manager to install and load packages, with actions echoed to the console.',
      'Environment pane to browse R objects, expandable by data type.',
      'First Spatial Editor pane for adding sf objects to a map.',
      'Inline data editing with smooth spreadsheet-style editing and column creation.',
    ],
  },
  {
    version: '1.1',
    date: 'March 2026',
    title: 'Foundation',
    summary:
      'A clean restart — the distilled core that everything else is built on.',
    highlights: [
      'A Monaco code editor wired to a live, embedded R console.',
      'File management: open, edit, create, and save .R files.',
      'Editor tabs that persist across sessions.',
    ],
  },
]

/**
 * The version the app reports, `a.b.c`, injected at build time from
 * `package.json` — the file electron-builder already reads to name the
 * installer.
 *
 * It used to be `VERSION_HISTORY[0].version`, which was right while every
 * version was a release. It is not any more: `a` and `b` are the releases the
 * maintainer announces (and the entries above are their notes), while `c`
 * moves with ordinary changes between them. Deriving the running version from
 * the release notes would have meant either a notes entry per patch — a
 * "What's new" dialog full of typo fixes — or a top entry whose version no
 * longer matched its own title.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : VERSION_HISTORY[0].version

/** The `a.b` release the running build belongs to, for matching it against the
 *  notes above, unless this build has its own announced patch entry. */
export function currentRelease(): string {
  return VERSION_HISTORY.some((release) => release.version === APP_VERSION)
    ? APP_VERSION
    : APP_VERSION.split('.').slice(0, 2).join('.')
}
