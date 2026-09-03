import { describe, it, expect } from 'vitest'
import { buildOurgeoCore, OURGEO_TOPICS, topicListing, readTopic } from './ai-skill-ourgeo'
import { actionById } from './ai-actions/registry'
import { BUILTIN_GROUP_LABELS } from './ai-actions/types'

// The core prompt is on every request for every provider, so its size is a
// running cost and its claims are what the model will repeat to the user.

describe('buildOurgeoCore', () => {
  const core = buildOurgeoCore()

  it('states the rule the application is built on', () => {
    expect(core).toMatch(/every GUI action echoes its R to the console/i)
  })

  it('names the tools the assistant actually has', () => {
    for (const t of ['run_ui_action', 'list_ui_actions', 'toolbox_tools', 'run_toolbox_tool', 'ourgeo_docs']) {
      expect(core).toContain(t)
    }
  })

  it('carries an action index whose every id resolves', () => {
    // The index is generated from the registry, so this is really a guard
    // against it being replaced with a hand-written list that then rots.
    const ids = [...core.matchAll(/\b([a-z]+:[a-zA-Z]+)\b/g)].map((m) => m[1])
    const known = ids.filter((id) => actionById(id))
    expect(known.length).toBeGreaterThan(50)
    // Every colon-separated token in the index must be a real action.
    expect(ids.length - known.length).toBe(0)
  })

  it('tells the model how to run a tutorial, not just what it can press', () => {
    expect(core).toMatch(/Look before you speak/)
    expect(core).toMatch(/One step at a time/)
    expect(core).toMatch(/Point rather than press/)
    expect(core).toMatch(/Never invent the interface/)
  })

  it('says the action ids are not R functions — the bug this text exists for', () => {
    // A local model wrote `map.addLayer(object = "pts_buf")` into a tutorial and
    // told the user to run it. R: could not find function "map.addLayer".
    expect(core).toMatch(/These are not R functions/)
    expect(core).toMatch(/could not find function/)
    expect(core).toMatch(/run_ui_action\(\{ id: "map:addLayer"/)
    expect(core).toMatch(/Never write an action id into R code/)
  })

  it('says what to do when an action fails — the twenty-turn spiral this prevents', () => {
    // Told only "Network Error" by map:addLayer, a local model rebuilt,
    // simplified and reprojected the user's buffer eight times over.
    expect(core).toMatch(/### When an action fails/)
    expect(core).toMatch(/Retry the same call \*\*once\*\* at most/)
    expect(core).toMatch(/Never work around a failed action by rebuilding, simplifying or renaming/)
  })

  it('explains the permission tiers, so a refusal is not a surprise', () => {
    expect(core).toMatch(/Autopilot/)
    expect(core).toMatch(/confirm/i)
  })

  it('stays inside its budget — this is on every request', () => {
    // ~4 chars per token: 7000 chars ≈ 1750 tokens, action index included.
    //
    // Raised from 6000 when the layout and plugin groups landed — 23 ids the
    // model genuinely needs, plus two sentences telling it plugins exist at
    // all (without which it would never open the topic that explains them).
    // This is a budget to defend, not a number to keep nudging: everything
    // here is paid for on every single request, including by a local model
    // with a 32k window. New material belongs in an `ourgeo_docs` topic
    // unless the model cannot act correctly without knowing it up front.
    expect(core.length).toBeLessThan(7000)
  })
})

describe('every action a topic names is real', () => {
  // A topic that names an action which does not exist sends the model down a
  // dead end and costs the user a turn — and it is the failure most likely to
  // creep in, because the docs and the registry are edited months apart.
  it('resolves every group:action token in every topic', () => {
    // Scoped to the SHIPPED groups. A topic legitimately shows an example id
    // from an imaginary plugin (`noaa-tides:quickSummary`), and there is no
    // way for that to resolve — but `ui:somethingMadeUp` must never appear.
    const groups = new Set(Object.keys(BUILTIN_GROUP_LABELS))
    const bad: string[] = []
    for (const [topic, body] of Object.entries(OURGEO_TOPICS)) {
      for (const m of body.matchAll(/(?<![\w-])([a-z][a-zA-Z]*):([a-zA-Z][a-zA-Z]*)(?![\w-])/g)) {
        if (!groups.has(m[1])) continue
        if (!actionById(m[0])) bad.push(`${topic}: ${m[0]}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('the topic reference', () => {
  it('covers every part of the application a tutorial might reach', () => {
    for (const topic of [
      'interface', 'toolbox', 'data-import', 'maps', 'drawing',
      'projects', 'documents', 'databases', 'shortcuts', 'troubleshooting', 'packages',
    ]) {
      expect(OURGEO_TOPICS[topic], topic).toBeTruthy()
      expect(OURGEO_TOPICS[topic].length, topic).toBeGreaterThan(400)
    }
  })

  it('lists every topic it can serve', () => {
    const listing = topicListing()
    for (const topic of Object.keys(OURGEO_TOPICS)) expect(listing).toContain(topic)
  })

  it('reads a topic, tolerantly', () => {
    expect(readTopic('maps')).toMatch(/Spatial Editor/)
    expect(readTopic('  MAPS ')).toMatch(/Spatial Editor/)
    expect(readTopic('data import')).toMatch(/Load Data/)
    expect(readTopic('doc')).toMatch(/Markdown/)
  })

  it('names the real topics when asked for one that is not there', () => {
    const out = readTopic('wombats')
    expect(out).toMatch(/No documentation topic/)
    expect(out).toContain('troubleshooting')
  })

  it('gets the knit contract right — the thing that most often catches people', () => {
    expect(OURGEO_TOPICS.documents).toMatch(/clean child Rscript/)
    expect(OURGEO_TOPICS.documents).toMatch(/pandoc/)
  })

  it('names the severed-connection failure, and says it is not about the data', () => {
    expect(OURGEO_TOPICS.troubleshooting).toMatch(/connection to the R server was severed/)
    expect(OURGEO_TOPICS.troubleshooting).toMatch(/never a reason to simplify geometry/)
  })

  it('says that a layer is a view onto an R object, not a copy', () => {
    expect(OURGEO_TOPICS.maps).toMatch(/view onto an R object/)
  })
})
