// Catching an interface action that has been mistaken for R.
//
// A local model, asked for a tutorial, produced this:
//
//     map.addLayer(object = "pts_buf")
//     map.zoomTo(layer = "pts_buf")
//
// and told the user to run it. R has no such function, so the console said
// `could not find function "map.addLayer"` and the user was left thinking
// ouRGeo had lost one of its own helpers.
//
// Three things caused it, and this module is the last of the three fixes:
// action ids no longer look like R (`map:addLayer`), the prompt now says
// plainly that they are not functions, and anything that still slips through is
// caught here — whichever side runs it.
//
// Deliberately matches BOTH separators. The dotted form is the one that reads
// as R, so it is exactly the form a confused model will keep producing, and the
// form already sitting in older transcripts.

import { actionById } from './registry'

const CALL = /(?:^|[\s;({])([a-z][a-zA-Z]*)[.:]([a-zA-Z][a-zA-Z0-9]*)\s*\(/gm

/**
 * The canonical action id, if this R code is really an action call.
 *
 * Returns null for ordinary R — including R that happens to use dotted names,
 * because the match has to resolve in the registry to count.
 */
export function actionCallInCode(code: string): string | null {
  for (const m of code.matchAll(CALL)) {
    const action = actionById(`${m[1]}:${m[2]}`)
    if (action) return action.id
  }
  return null
}

/** What to tell the model when it tries to run an action as R. */
export function actionCodeRefusal(id: string): string {
  return (
    `Refused: "${id}" is an ouRGeo interface action, not an R function. R has no such ` +
    'function and this would error with `could not find function`. Perform it with ' +
    `run_ui_action({ id: "${id}", params: … }) instead — and never write an action id as R ` +
    'code for the user to run.'
  )
}

/** What to tell the USER when they run one in the console — which happens when
 *  an assistant hands them one to paste. */
export function actionCodeHint(id: string): string {
  return (
    `"${id}" is an ouRGeo interface action, not an R function — there is no R equivalent, ` +
    'and nothing is missing from your R installation. It is something the app does: the AI ' +
    'assistant performs it directly, or you do it from the interface. If an assistant gave ' +
    'you this to run, it made a mistake; ask it to perform the action itself, or to tell you ' +
    'which button does it.'
  )
}
