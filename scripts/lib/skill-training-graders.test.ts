import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error — plain ESM helper without type declarations
import { GRADERS, gradeEpisode, setActionIds } from '../skill-training/lib/graders.mjs'
// @ts-expect-error — plain ESM helper without type declarations
import { parseVerdicts } from '../skill-training/lib/judge.mjs'

// Spec §5.5(3): each grader must pass a correct trace and catch a seeded defect
// in it. Anything missed here is a harness bug that would misreport a model.

type Tool = { name: string; input: Record<string, unknown>; result: string }
const ep = (final: string, tools: Tool[] = []) => ({ final, tools, error: null })
const task = (user = 'how many?', extra = {}) => ({ id: 't', turns: [{ user }], graders: [], ...extra })
const r = (code: string, result = 'ok'): Tool => ({ name: 'execute_r_code', input: { code }, result })
const ui = (id: string, result = 'Done.'): Tool => ({ name: 'run_ui_action', input: { id }, result })
const stateCtx = (state: unknown) => ({ call: async () => state, task: task() })
const rCtx = (output: string) => ({ call: async () => ({ output }), task: task() })

const RUBRIC = { required: ['Settings is in the toolbar'], forbidden: ['Settings is in the map'] }
const verdict = (met: boolean, present: boolean) => async () => ({ required: [{ index: 0, met }], forbidden: [{ index: 0, present }] })

const CASES: [string, unknown, () => [unknown, unknown], unknown, unknown?][] = [
  ['r_state', 'exists("x")', () => [ep(''), ep('')], rCtx('<<TRUE>>'), rCtx('<<FALSE>>')],
  ['app_state', 's.layers.length === 1', () => [ep(''), ep('')], stateCtx({ layers: [{ name: 'a' }] }), stateCtx({ layers: [] })],
  ['tool_called', { name: 'run_ui_action', where: "i.id === 'map:addLayer'" }, () => [ep('', [ui('map:addLayer')]), ep('', [ui('map:zoomTo')])], {}],
  ['tool_called', 'execute_r_code', () => [ep('', [{ ...r('1'), name: 'mcp__ourgeo__execute_r_code' }]), ep('', [])], {}],
  ['tool_not_called', 'execute_r_code', () => [ep('', [ui('a:b')]), ep('', [r('1')])], {}],
  ['max_tool_calls', 1, () => [ep('', [r('1')]), ep('', [r('1'), r('2')])], {}],
  ['r_code_not_regex', 'unlink', () => [ep('', [r('sum(1)')]), ep('', [r('unlink("x")')])], {}],
  ['answer_regex', '100 counties', () => [ep('There are 100 counties.'), ep('There are many.')], {}],
  ['answer_not_regex', '100', () => [ep('Run nrow(nc).'), ep('It is 100.')], {}],
  ['no_action_id_in_r', true, () => [ep('', [r('sf::st_read("a")')]), ep('', [r('map:addLayer("nc")')])], {}],
  ['no_action_id_in_r', true, () => [ep('```r\nnrow(nc)\n```'), ep('```r\nmap.addLayer(nc)\n```')], {}],
  ['max_retries', 1, () => {
    const bad = { ...ui('map:addLayer', 'Failed: no such object') }
    return [ep('', [bad, bad]), ep('', [bad, bad, bad])]
  }, {}],
  ['no_unknown_tools', true, () => [ep('', [r('1')]), ep('', [{ name: 'make_map', input: {}, result: 'x' }])], {}],
  ['no_unknown_tools', true, () => [ep('', [ui('map:addLayer')]), ep('', [ui('map:add', 'Unknown action map:add')])], {}],
  ['numbers_grounded', true, () => [ep('The mean is 137.5.', [r('m', '[1] 137.5')]), ep('The mean is 912.5.', [r('m', '[1] 137.5')])], { task: task() }],
  ['rubric', RUBRIC, () => [ep('In the toolbar.'), ep('In the map.')], { judge: verdict(true, false) }, { judge: verdict(true, true) }],
  ['rubric', RUBRIC, () => [ep('In the toolbar.'), ep('Somewhere.')], { judge: verdict(true, false) }, { judge: verdict(false, false) }],
  ['no_unrun_claims', true, () => [ep('Run this: `nrow(x)`'), ep('I ran it and the result is large.')], {}],
]

describe('skill-training grader mutations', () => {
  beforeAll(() => setActionIds(['map:addLayer', 'map:zoomTo']))
  it.each(CASES.map((c, i) => [i, c[0], c] as const))('case %i %s: passes correct, catches mutant', async (_i, type, c) => {
    const [, spec, make, ctx, mutantCtx] = c
    const [good, bad] = make()
    expect((await GRADERS[type](spec, good, ctx)).pass, 'correct trace').toBe(true)
    expect((await GRADERS[type](spec, bad, mutantCtx ?? ctx)).pass, 'seeded defect').toBe(false)
  })

  it('every grader has a case', () => {
    const covered = new Set([...CASES.map(c => c[0]), 'knits'])
    expect(Object.keys(GRADERS).filter(g => !covered.has(g))).toEqual([])
  })

  it('rubric: an empty answer fails without spending a judge call', async () => {
    const never = async () => { throw new Error('judge called') }
    expect((await GRADERS.rubric(RUBRIC, ep('  '), { judge: never })).pass).toBe(false)
  })

  it('judge replies are schema-checked, never guessed at', () => {
    const rubric = { required: ['a', 'b'] }
    expect(parseVerdicts('{"required":[{"index":0,"met":true},{"index":1,"met":false}],"forbidden":[]}', rubric).required[1].met).toBe(false)
    expect(() => parseVerdicts('{"required":[{"index":0,"met":true}],"forbidden":[]}', rubric)).toThrow()
    expect(() => parseVerdicts('{"required":[{"index":0,"met":"yes"},{"index":1,"met":true}],"forbidden":[]}', rubric)).toThrow()
    expect(() => parseVerdicts('looks fine', rubric)).toThrow()
  })

  it('matches run_toolbox_tool by its real toolId, however the task names it', async () => {
    const run = (input: Record<string, unknown>) => ep('', [{ name: 'run_toolbox_tool', input, result: 'Ran.' }])
    const spec = { name: 'run_toolbox_tool', where: "(i.tool || i.id) === 'sf-centroid'" }
    expect((await GRADERS.tool_called(spec, run({ toolId: 'sf-centroid', values: {} }), {})).pass).toBe(true)
    expect((await GRADERS.tool_called(spec, run({ toolId: 'sf-buffer', values: {} }), {})).pass).toBe(false)
  })

  it('a dry run is not a run', async () => {
    const dry = ep('', [{ name: 'run_toolbox_tool', input: { toolId: 'sf-centroid', dryRun: true }, result: 'preview' }])
    expect((await GRADERS.tool_called('run_toolbox_tool', dry, {})).pass).toBe(false)
  })

  it('counts a workspace dimension as stated by the host, but not an invented number', async () => {
    const ctx = { task: task(), call: async () => ({ output: '<<32,11>>' }) }
    expect((await GRADERS.numbers_grounded(true, ep('A 32 by 11 data frame.'), ctx)).pass).toBe(true)
    expect((await GRADERS.numbers_grounded(true, ep('A 33 by 11 data frame.'), ctx)).pass).toBe(false)
  })

  it('counts prefetched evidence, not only tool results', async () => {
    const prefetched = { ...ep('It has 137 rows.'), turns: [{ trace: { selected: [{ content: 'rows: 137' }] } }] }
    expect((await GRADERS.numbers_grounded(true, prefetched, { task: task() })).pass).toBe(true)
  })

  it('reads a space-grouped number as one value', async () => {
    const good = ep('Total 14 060 habitantes.', [r('sum(x)', '[1] 14060')])
    expect((await GRADERS.numbers_grounded(true, good, { task: task() })).pass).toBe(true)
    expect((await GRADERS.numbers_grounded(true, ep('Total 14 060 habitantes.', [r('sum(x)', '[1] 15000')]), { task: task() })).pass).toBe(false)
  })

  it('reads a decimal comma as a decimal, not as thousands', async () => {
    const fr = (shown: string) => ep(`La moyenne est ${shown}.`, [r('mean(x)', '[1] 7.33')])
    expect((await GRADERS.numbers_grounded(true, fr('7,33'), { task: task() })).pass).toBe(true)
    expect((await GRADERS.numbers_grounded(true, fr('9,44'), { task: task() })).pass).toBe(false)
  })

  it('an explanation is not a claim of unrun results, but a stated value is', async () => {
    expect((await GRADERS.no_unrun_claims(true, ep('The result is a single polygon with holes.'), {})).pass).toBe(true)
    expect((await GRADERS.no_unrun_claims(true, ep('The result is 45.2.'), {})).pass).toBe(false)
    expect((await GRADERS.no_unrun_claims(true, ep('I computed it for you.'), {})).pass).toBe(false)
  })

  it('reads a thousands separator in tool output as one number', async () => {
    const good = ep('There are 10,000 rows.', [r('nrow(x)', '[1] "10,000"')])
    expect((await GRADERS.numbers_grounded(true, good, { task: task() })).pass).toBe(true)
  })

  it('a failed required grader or a timeout fails the episode', async () => {
    const t = task('q', { graders: [{ answer_regex: 'yes' }] })
    expect((await gradeEpisode(t, ep('yes'), {})).pass).toBe(true)
    expect((await gradeEpisode(t, ep('no'), {})).pass).toBe(false)
    expect((await gradeEpisode(t, { ...ep('yes'), error: 'EPISODE_TIMEOUT' }, {})).pass).toBe(false)
  })

  const hasKnitr = (() => { try { execFileSync('Rscript', ['-e', 'library(knitr)'], { stdio: 'pipe' }); return true } catch { return false } })()
  it.skipIf(!hasKnitr)('knits: a chunk naming a session-only object fails in a clean session', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'grader-knit-'))
    const doc = (body: string) => stateCtx({ activeTabId: 1, tabs: [{ id: 1, fileName: 'a.Rmd', language: 'rmarkdown', content: `\`\`\`{r}\n${body}\n\`\`\`\n` }] })
    const ctx = (body: string) => ({ ...doc(body), work, rEnv: {} })
    expect((await GRADERS.knits('active', ep(''), ctx('x <- 1; x + 1'))).pass).toBe(true)
    expect((await GRADERS.knits('active', ep(''), ctx('nrow(session_only_object)'))).pass).toBe(false)
    fs.rmSync(work, { recursive: true, force: true })
  }, 60_000)
})
