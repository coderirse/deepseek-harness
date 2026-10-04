/** Verify the updater configuration electron-builder seals into a Linux AppImage. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { load } from 'js-yaml'

const CONFIG_FILENAME = 'app-update.yml'
const CHANNEL = 'nightly'

function object(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`desktop Linux update config: ${label} must be an object`)
  }
  return value
}

/**
 * Resolve the one generic Linux feed from the final electron-builder configuration.
 * @param {unknown} publish - Final electron-builder publish setting.
 * @returns {{ publicUrl: string }} Resolved feed used by the packaged application.
 */
export function resolveLinuxAppUpdateFeed(publish) {
  if (!Array.isArray(publish) || publish.length !== 1) {
    throw new Error('desktop Linux update config: publish must contain exactly one provider')
  }
  const provider = object(publish[0], 'publish provider')
  if (provider.provider !== 'generic' || provider.channel !== CHANNEL) {
    throw new Error('desktop Linux update config: publish provider must be generic Nightly')
  }
  if (typeof provider.url !== 'string' || provider.url === '') {
    throw new Error('desktop Linux update config: publish provider URL must be a non-empty string')
  }
  return { publicUrl: provider.url }
}

/**
 * Verify the updater configuration inside an assembled Linux application directory.
 * electron-builder writes the file for AppImage targets; a missing or mismatched
 * configuration would silently disable updates, so packaging fails loud here instead.
 * @param {string} appOutDir - linux-unpacked application directory.
 * @param {{ publicUrl: string }} update - Expected update feed.
 * @returns {Promise<void>} Resolves when the packaged configuration matches the release destination.
 */
export async function verifyLinuxAppUpdateConfig(appOutDir, update) {
  const path = join(appOutDir, 'resources', CONFIG_FILENAME)
  let parsed
  try {
    parsed = load(await readFile(path, 'utf8'))
  }
  catch (error) {
    throw new Error(`desktop Linux update config: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const config = object(parsed, CONFIG_FILENAME)
  if (config.provider !== 'generic' || config.url !== update.publicUrl || config.channel !== CHANNEL) {
    throw new Error(`desktop Linux update config: ${path} does not match ${update.publicUrl}`)
  }
}
