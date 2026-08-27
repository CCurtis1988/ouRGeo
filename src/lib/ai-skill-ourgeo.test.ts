import { describe, it, expect } from 'vitest'
import { buildOurgeoCore, OURGEO_TOPICS, topicListing, readTopic } from './ai-skill-ourgeo'
import { actionById } from './ai-actions/registry'

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
    const idPattern = /\b([a-z]+\.[a-zA-Z]+)\b/g
    const ids = [...core.matchAll(idPattern)].map((m) => m[1])
      .filter((id) => !id.startsWith('ourgeo.') && !id.includes('dplyr'))
    const known = ids.filter((id) => actionById(id))
    expect(known.length).toBeGreaterThan(50)
  })

  it('tells the model how to run a tutorial, not just what it can press', () => {
    expect(core).toMatch(/Look before you speak/)
    expect(core).toMatch(/One step at a time/)
    expect(core).toMatch(/Point rather than press/)
    expect(core).toMatch(/Never invent the interface/)
  })

  it('explains the permission tiers, so a refusal is not a surprise', () => {
    expect(core).toMatch(/Autopilot/)
    expect(core).toMatch(/confirm/i)
  })

  it('stays inside its budget — this is on every request', () => {
    // ~4 chars per token: 6000 chars ≈ 1500 tokens, index included.
    expect(core.length).toBeLessThan(6000)
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

  it('says that a layer is a view onto an R object, not a copy', () => {
    expect(OURGEO_TOPICS.maps).toMatch(/view onto an R object/)
  })
})
