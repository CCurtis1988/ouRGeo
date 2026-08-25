import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { IpcMain, WebContents } from 'electron'
// Pure helpers live in the renderer tree so they are covered by the test suite.
import { parseErrorLine, hintFor } from '../../src/lib/markdown/knit-errors'

// Knit an R Markdown document with rmarkdown::render().
//
// Deliberately a CHILD Rscript rather than the app's R server:
//
//   * knitr's contract is a clean session. Rendering inside the live session
//     would let a document depend on objects the user happened to create in the
//     console, producing the classic "works for me, fails on knit" trap.
//   * a render can take minutes, and the R server executes serially — knitting
//     in-process would block every other feature for the duration.
//   * a child process can be killed, so Cancel is real.
//
// The cost is that console-created objects are invisible to the render. That is
// correct knitr behaviour, but it surprises people, so `hintFor` turns the
// resulting error into an explanation.

interface KnitRequest {
  id: string
  filePath: string
  format: 'html' | 'pdf' | 'word'
  rscriptPath?: string
}

const OUTPUT_FORMAT: Record<KnitRequest['format'], string> = {
  html: 'html_document',
  pdf: 'pdf_document',
  word: 'word_document',
}

const EXTENSION: Record<KnitRequest['format'], string> = {
  html: '.html', pdf: '.pdf', word: '.docx',
}

const running = new Map<string, ChildProcess>()

function send(wc: WebContents, channel: string, ...args: unknown[]): void {
  if (!wc.isDestroyed()) wc.send(channel, ...args)
}

export function registerKnitHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('knit:render', async (event, req: KnitRequest) => {
    const wc = event.sender
    if (!existsSync(req.filePath)) {
      return { success: false, error: `File not found: ${req.filePath}` }
    }

    const dir = dirname(req.filePath)
    const outFile = join(dir, basename(req.filePath).replace(/\.[^.]+$/, '') + EXTENSION[req.format])

    // Render the file on disk, from its own directory, so relative paths inside
    // the document (figures/, data/) resolve the way the author wrote them.
    const rExpr = [
      'options(warn = 1)',
      `rmarkdown::render(${JSON.stringify(req.filePath)},`,
      `  output_format = ${JSON.stringify(OUTPUT_FORMAT[req.format])},`,
      `  output_file = ${JSON.stringify(basename(outFile))},`,
      `  output_dir = ${JSON.stringify(dir)},`,
      '  knit_root_dir = dirname(normalizePath(' + JSON.stringify(req.filePath) + ')),',
      '  quiet = FALSE)',
    ].join('\n')

    return await new Promise((resolve) => {
      const child = spawn(req.rscriptPath || (process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'),
        ['-e', rExpr], { cwd: dir })
      running.set(req.id, child)

      let log = ''
      const onData = (buf: Buffer): void => {
        const text = buf.toString()
        log += text
        send(wc, `knit:progress:${req.id}`, text)
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)

      child.on('error', (err) => {
        running.delete(req.id)
        resolve({ success: false, error: `Could not start Rscript: ${err.message}`, log })
      })

      child.on('close', (code) => {
        running.delete(req.id)
        if (code === 0 && existsSync(outFile)) {
          resolve({ success: true, outputPath: outFile, log })
        } else {
          resolve({
            success: false,
            error: log.trim().split('\n').slice(-12).join('\n') || `Rscript exited with code ${code}`,
            hint: hintFor(log),
            errorLine: parseErrorLine(log),
            log,
          })
        }
      })
    })
  })

  ipcMain.handle('knit:cancel', (_e, id: string) => {
    const child = running.get(id)
    if (!child) return false
    child.kill()
    running.delete(id)
    return true
  })
}
