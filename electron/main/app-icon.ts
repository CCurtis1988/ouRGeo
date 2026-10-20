import { join } from 'node:path'

// Vite emits the same artwork beside the main bundle in dev and in app.asar.
// Build resources alone are not shipped as runtime assets by electron-builder.
export const APP_ICON_PATH = join(__dirname, 'icon.png')
