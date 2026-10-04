/** Verify the updater configuration electron-builder seals into a Linux AppImage. */

/**
 * Resolve the one generic Linux feed from the final electron-builder configuration.
 * @param publish - Final electron-builder publish setting.
 * @returns Resolved feed used by the packaged application.
 */
export function resolveLinuxAppUpdateFeed(publish: unknown): { readonly publicUrl: string }

/**
 * Verify the updater configuration inside an assembled Linux application directory.
 * @param appOutDir - linux-unpacked application directory.
 * @param update - Expected update feed.
 * @returns Resolves when the packaged configuration matches the release destination.
 */
export function verifyLinuxAppUpdateConfig(appOutDir: string, update: { readonly publicUrl: string }): Promise<void>
