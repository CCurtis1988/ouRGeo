import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useContextStore } from '@/store/context'
import { useSessionStore } from '@/store/session'
import { describeAboutYouImport, type AboutYouImportMode, type AboutYouProtection } from '@/lib/context/memory-transfer'

const MIN_PASSPHRASE = 8

/** Moving About you memory to another machine. The profile store's key stays
 * in this machine's keyring, so a protected file carries its own
 * passphrase-derived key. A plain file is for organisations that do not want
 * a passphrase or that edit the JSON outside ouRGeo — an expert path: import
 * accepts only the exact format ouRGeo writes. Main picks the file and asks
 * before anything is written.
 *
 * Protection and import mode are radio pairs, not Switches: values acted on
 * when a button is pressed, and a Settings switch takes effect the moment it
 * moves. Passphrases never persist — cleared after each operation, never in
 * preferences. */
export function AboutYouTransfer(): React.ReactElement {
  const [protection, setProtection] = useState<AboutYouProtection>('passphrase')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [mode, setMode] = useState<AboutYouImportMode>('merge')
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [receipt, setReceipt] = useState<{ ok: boolean; text: string } | null>(null)
  const long = [...passphrase].length >= MIN_PASSPHRASE
  const canExport = protection === 'none' || (long && confirm === passphrase)
  const audit = (text: string): void => useSessionStore.getState().addConsoleEntry('info', `Context memory: ${text}`)
  const run = async (kind: 'export' | 'import'): Promise<void> => {
    setBusy(kind); setReceipt(null)
    try {
      const lease = await window.electronAPI.context.lease()
      if (kind === 'export') {
        const result = await window.electronAPI.context.exportAboutYou(protection, protection === 'passphrase' ? passphrase : '', lease.id)
        if (!result) { setReceipt({ ok: true, text: 'Export cancelled. Nothing was written.' }); return }
        const what = `${result.count} About you memor${result.count === 1 ? 'y' : 'ies'}`
        audit(`exported ${what} to ${result.path}${result.protection === 'none' ? ' as plain JSON (not encrypted)' : ''}.`)
        setReceipt({ ok: true, text: result.protection === 'none'
          ? `Exported ${what} as plain JSON to ${result.path}. The file is not encrypted: store it where only the right people can read it.`
          : `Exported ${what} to ${result.path}. Keep the passphrase: without it the file cannot be opened.` })
        setPassphrase(''); setConfirm('')
      } else {
        // As with backup restore: nothing sent under the old memory set may
        // carry on into a provider session after it is replaced.
        if (mode === 'replace') useContextStore.getState().revokeDelivery()
        const result = await window.electronAPI.context.importAboutYou(importPassphrase, mode, lease.id)
        if (!result) { setReceipt({ ok: true, text: 'Import cancelled. Your memory is unchanged.' }); return }
        useContextStore.setState({ globals: await window.electronAPI.context.listGlobal() })
        const text = describeAboutYouImport(result)
        setReceipt({ ok: true, text }); audit(text)
        setImportPassphrase('')
      }
    } catch (error) {
      setReceipt({ ok: false, text: String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally { setBusy(null) }
  }
  const field = 'block w-full bg-geo-bg border border-geo-border rounded p-1 text-xs text-foreground'
  const radio = (name: string, checked: boolean, onChange: () => void, label: string, hint: string): React.ReactElement =>
    <label className="flex items-start gap-2"><input type="radio" name={name} checked={checked} onChange={onChange} className="mt-0.5" />
      <span>{label}<span className="block text-[11px] text-geo-muted">{hint}</span></span></label>
  return <div className="space-y-3 rounded-lg border border-geo-border p-4 text-xs">
    <h4 className="font-semibold text-foreground">Move About you memory to another machine</h4>
    <p className="text-[11px] text-geo-muted">The encrypted backup above needs this machine’s keyring. An export is a JSON file that opens on any machine running ouRGeo. Only accepted About you memories are exported — not suggestions, project or conversation memories.</p>
    <fieldset className="space-y-1">
      <legend className="mb-1">Export as</legend>
      {radio('about-you-export-protection', protection === 'passphrase', () => setProtection('passphrase'), 'Protected with a passphrase', 'Encrypted. Safe to keep in cloud storage or on a USB stick; a lost passphrase cannot be recovered.')}
      {radio('about-you-export-protection', protection === 'none', () => setProtection('none'), 'Plain JSON (readable and editable)', 'Not encrypted: anyone with the file can read your memories. For organisations that manage files themselves. Editing is for expert users — the file must keep ouRGeo’s exact format.')}
    </fieldset>
    {protection === 'passphrase' ? <>
      <label className="block">Passphrase
        <input type="password" autoComplete="new-password" aria-label="Memory export passphrase" value={passphrase} onChange={e => setPassphrase(e.target.value)} className={field} />
      </label>
      <label className="block">Confirm passphrase
        <input type="password" autoComplete="new-password" aria-label="Confirm memory export passphrase" value={confirm} onChange={e => setConfirm(e.target.value)} className={field} />
      </label>
      {passphrase && !long && <p className="text-[11px] text-geo-muted">Use at least {MIN_PASSPHRASE} characters.</p>}
      {confirm && confirm !== passphrase && <p className="text-[11px] text-geo-muted">The passphrases do not match.</p>}
    </> : <p className="text-[11px] text-geo-error">This file will not be encrypted.</p>}
    <Button type="button" size="sm" variant="outline" disabled={!!busy || !canExport} onClick={() => void run('export')}>{busy === 'export' ? 'Exporting…' : protection === 'none' ? 'Export plain JSON…' : 'Export About you memory…'}</Button>

    <fieldset className="space-y-1 border-t border-geo-border pt-3">
      <legend className="mb-1">When importing</legend>
      {radio('about-you-import-mode', mode === 'merge', () => setMode('merge'), 'Add to my memory', 'Keep everything here; add what the file has that this machine does not.')}
      {radio('about-you-import-mode', mode === 'replace', () => setMode('replace'), 'Replace my memory', 'Make About you match the file. Memories here that the file does not contain are forgotten.')}
    </fieldset>
    <label className="block">Passphrase (protected files only)
      <input type="password" autoComplete="current-password" aria-label="Memory import passphrase" value={importPassphrase} onChange={e => setImportPassphrase(e.target.value)} className={field} />
    </label>
    <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => void run('import')}>{busy === 'import' ? 'Importing…' : mode === 'replace' ? 'Import and replace…' : 'Import About you memory…'}</Button>
    <p className="text-[11px] text-geo-muted">Either kind of export can be imported. A plain file that does not match ouRGeo’s format is refused as a whole, naming the memory and field to fix. Memories you forgot on this machine stay forgotten while their id is unchanged.</p>
    {receipt && <p role="status" className={receipt.ok ? 'text-geo-success' : 'text-geo-error'}>{receipt.text}</p>}
  </div>
}
