import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, type ScryptOptions } from 'node:crypto'
import { ABOUT_YOU_FORMAT, validateAboutYouPayload, type AboutYouPayload } from '../../../src/lib/context/memory-transfer'

/** The portable About you file. It is JSON on the outside so a person can see
 * what it is, and sealed on the inside so it can sit in cloud storage or on a
 * USB stick: the profile store's key never leaves the OS keyring, so the
 * export carries its own key, derived from a passphrase the user chooses.
 *
 * The header (format, KDF and its parameters) is the GCM additional data. A
 * file whose cost parameters were edited down fails authentication rather
 * than decrypting with a weaker key. */
export const MEMORY_FILE_FORMAT = 'ourgeo-memory-backup'
export const MEMORY_FILE_VERSION = 1
export const MEMORY_FILE_MAX_BYTES = 8 * 1024 * 1024
export const MIN_PASSPHRASE_LENGTH = 8

interface KdfParams { name: 'scrypt'; N: number; r: number; p: number; salt: string }
interface SealedHeader { format: typeof MEMORY_FILE_FORMAT; version: typeof MEMORY_FILE_VERSION; kdf: KdfParams; cipher: 'aes-256-gcm' }
interface SealedFile extends SealedHeader { iv: string; tag: string; data: string }

// OWASP's scrypt floor (N=2^17, r=8, p=1): ~128 MiB and a fraction of a second.
const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 }
// A file names its own cost. Bound it, or a crafted export asks for gigabytes.
const MAX_N = 2 ** 20, MAX_MEMORY = 256 * 1024 * 1024

function deriveKey(passphrase: string, kdf: KdfParams): Promise<Buffer> {
  const options: ScryptOptions = { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r + 32 * 1024 * 1024 }
  return new Promise((resolve, reject) => scryptCallback(passphrase.normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, options, (error, key) => error ? reject(error) : resolve(key)))
}

const aad = (header: SealedHeader): Buffer => Buffer.from(JSON.stringify([header.format, header.version, header.cipher, header.kdf.name, header.kdf.N, header.kdf.r, header.kdf.p, header.kdf.salt]))

export function checkPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== 'string' || [...passphrase].length < MIN_PASSPHRASE_LENGTH) throw new Error(`Choose a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`)
  if (passphrase.length > 1024) throw new Error('Choose a passphrase shorter than 1024 characters.')
  return passphrase
}

export async function sealAboutYou(payload: AboutYouPayload, passphrase: string, kdf: Omit<KdfParams, 'name' | 'salt'> = DEFAULT_KDF): Promise<string> {
  const header: SealedHeader = { format: MEMORY_FILE_FORMAT, version: MEMORY_FILE_VERSION, kdf: { name: 'scrypt', ...kdf, salt: randomBytes(16).toString('base64') }, cipher: 'aes-256-gcm' }
  const key = await deriveKey(checkPassphrase(passphrase), header.kdf)
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(aad(header))
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    const file: SealedFile = { ...header, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
    return `${JSON.stringify(file, null, 2)}\n`
  } finally { key.fill(0) }
}

/** Either kind of export. The file says which it is; the passphrase is asked
 * for only when the file is sealed, so a plain import needs none. */
export async function readAboutYouFile(text: string, passphrase: string): Promise<{ payload: AboutYouPayload; protection: 'passphrase' | 'none' }> {
  if (Buffer.byteLength(text) > MEMORY_FILE_MAX_BYTES) throw new Error('This file is larger than any About you export. Choose the .ourgeomemory.json file ouRGeo wrote.')
  let file: { format?: unknown }
  // An edited plain file is the likely source of a syntax error; say so.
  try { file = JSON.parse(text) } catch (error) { throw new Error(`This file is not valid JSON (${error instanceof Error ? error.message : String(error)}). If you edited it, fix the JSON syntax, then import again.`) }
  if (file?.format === ABOUT_YOU_FORMAT) return { payload: validateAboutYouPayload(file), protection: 'none' }
  if (file?.format !== MEMORY_FILE_FORMAT) throw new Error('This file is not an ouRGeo memory export. Choose the .ourgeomemory.json file ouRGeo wrote.')
  if (!passphrase) throw new Error('This export is protected. Enter its passphrase, then import again.')
  return { payload: await openAboutYou(file as Partial<SealedFile>, passphrase), protection: 'passphrase' }
}

async function openAboutYou(file: Partial<SealedFile>, passphrase: string): Promise<AboutYouPayload> {
  if (file.version !== MEMORY_FILE_VERSION) throw new Error(`This export uses file version ${String(file.version)}; this ouRGeo reads version ${MEMORY_FILE_VERSION}. Update ouRGeo, then import it again.`)
  const kdf = file.kdf
  const b64 = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
  if (file.cipher !== 'aes-256-gcm' || !kdf || kdf.name !== 'scrypt' || !Number.isSafeInteger(kdf.N) || kdf.N < 2 ** 14 || kdf.N > MAX_N || (kdf.N & (kdf.N - 1)) !== 0
      || !Number.isSafeInteger(kdf.r) || kdf.r < 1 || kdf.r > 32 || !Number.isSafeInteger(kdf.p) || kdf.p < 1 || kdf.p > 16 || 128 * kdf.N * kdf.r > MAX_MEMORY
      || !b64(kdf.salt) || !b64(file.iv) || !b64(file.tag) || !b64(file.data)) throw new Error('This memory export is damaged. Export again from the original machine.')
  const header: SealedHeader = { format: MEMORY_FILE_FORMAT, version: MEMORY_FILE_VERSION, kdf: { name: 'scrypt', N: kdf.N, r: kdf.r, p: kdf.p, salt: kdf.salt }, cipher: 'aes-256-gcm' }
  const key = await deriveKey(checkPassphrase(passphrase), header.kdf)
  let plain: string
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv!, 'base64'))
    decipher.setAAD(aad(header))
    decipher.setAuthTag(Buffer.from(file.tag!, 'base64'))
    plain = Buffer.concat([decipher.update(Buffer.from(file.data!, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    // GCM cannot tell a wrong passphrase from an edited file; say both.
    throw new Error('Wrong passphrase, or the file was changed after export. Check the passphrase and try again.')
  } finally { key.fill(0) }
  return validateAboutYouPayload(JSON.parse(plain))
}
