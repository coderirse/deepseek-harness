/** The public command launcher selection per Desktop platform. */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareDesktopCli } from '../scripts/prepare-cli.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

it.each(['darwin', 'linux', 'win32'] as const)('copies the %s launcher template under the installed command name', async (platform) => {
  const destination = join(await mkdtemp(join(import.meta.dirname, 'prepare-cli-')), 'cli')
  temporaryDirectories.push(destination)
  prepareDesktopCli(destination, platform)
  const command = join(destination, 'bin', platform === 'win32' ? 'dsh.cmd' : 'dsh')
  const template = await readFile(join(import.meta.dirname, '..', 'cli', platform === 'win32' ? 'dsh.cmd' : platform === 'darwin' ? 'dsh' : 'dsh-linux'))
  expect(await readFile(command)).toEqual(template)
  const mode = (await stat(command)).mode & 0o777
  expect(platform === 'win32' ? mode !== 0o755 : mode === 0o755).toBe(true)
})

it('keeps the POSIX command name dsh for the Linux template', async () => {
  const destination = join(await mkdtemp(join(import.meta.dirname, 'prepare-cli-')), 'cli')
  temporaryDirectories.push(destination)
  prepareDesktopCli(destination, 'linux')
  const launcher = await readFile(join(destination, 'bin', 'dsh'), 'utf8')
  expect(launcher).toContain('deepseek-harness')
  expect(launcher).not.toContain('MacOS')
})
