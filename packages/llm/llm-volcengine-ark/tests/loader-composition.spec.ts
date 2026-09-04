/**
 * Real-composition guard: LlmRuntime, settings-file, credentials-local, and
 * llm-volcengine-ark boot from a test-only cordis.yml through the actual
 * Loader + Include path. Both plan routes register, expose their settings
 * address, advertise the DeepSeek V4 catalog, and route a request to their own
 * endpoint and key — with no DeepSeek request-identity headers, which Ark does
 * not define.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as LlmVolcengineArk from '@deepseek-ai/dsh-llm-volcengine-ark'

const NS = 'llm-volcengine-ark'

/** A minimal complete text generation, enough to drive the stream to a stop finish. */
const textEvents = [
  '{"choices":[{"delta":{"content":"hello"}}]}',
  '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
  '[DONE]',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-llm-volcengine-ark-'))
  vi.stubEnv('DSH_HOME', root)
  await writeFile(join(root, 'settings.yaml'), '# personal settings\n')
  await writeFile(
    join(root, '.credentials.yaml'),
    'ARK_AGENT_PLAN_API_KEY: agent-key\nARK_CODING_PLAN_API_KEY: coding-key\n',
    { mode: 0o600 },
  )

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: settings',
    "  name: '@deepseek-ai/dsh-settings-file'",
    '  config:',
    `    path: ${JSON.stringify(join(root, 'settings.yaml'))}`,
    '    debounceMs: 10',
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    debounceMs: 10',
    '- id: llm-volcengine-ark',
    "  name: '@deepseek-ai/dsh-llm-volcengine-ark'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-llm-volcengine-ark', LlmVolcengineArk],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

/** Drive one provider stream to completion, asserting the terminal finish. */
async function drive(ctx: Context, provider: string): Promise<void> {
  let finished = false
  for await (const chunk of ctx.llm.stream({ provider, model: 'deepseek-v4-pro', messages: [] })) {
    if (chunk.type === 'finish') {
      finished = true
      expect(chunk.reason).toEqual({ kind: 'stop' })
    }
  }
  expect(finished).toBe(true)
}

describe('llm-volcengine-ark real composition', () => {
  it('registers both plans as configurable providers with live routes', async () => {
    const ctx = await loadComposition()

    expect(ctx.llm.listProviders()).toEqual([
      { id: 'volcengine-ark-agent', name: 'Volcengine Ark Agent Plan' },
      { id: 'volcengine-ark-coding', name: 'Volcengine Ark Coding Plan' },
    ])
    expect(ctx.llm.listConfigurableProviders()).toEqual([
      { provider: 'volcengine-ark-agent', displayName: 'Volcengine Ark Agent Plan', settingsNs: NS, settingsPath: ['providers', 'agent'] },
      { provider: 'volcengine-ark-coding', displayName: 'Volcengine Ark Coding Plan', settingsNs: NS, settingsPath: ['providers', 'coding'] },
    ])
  })

  it('advertises the DeepSeek V4 catalog on each route', async () => {
    const ctx = await loadComposition()

    await expect(ctx.llm.listModels('volcengine-ark-agent')).resolves.toEqual([
      { provider: 'volcengine-ark-agent', id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', inputModalities: ['text'] },
      { provider: 'volcengine-ark-agent', id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', inputModalities: ['text'] },
    ])
    await expect(ctx.llm.listModels('volcengine-ark-coding')).resolves.toEqual([
      { provider: 'volcengine-ark-coding', id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', inputModalities: ['text'] },
      { provider: 'volcengine-ark-coding', id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', inputModalities: ['text'] },
    ])
  })

  it('routes each plan to its own endpoint and key without DeepSeek identity headers', async () => {
    const ctx = await loadComposition()
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', async (input: unknown, init?: { headers?: Record<string, string> }) => {
      calls.push({ url: String(input), headers: init?.headers ?? {} })
      const body = textEvents.map(event => `data: ${event}\n\n`).join('')
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    await drive(ctx, 'volcengine-ark-agent')
    await drive(ctx, 'volcengine-ark-coding')

    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions')
    expect(calls[0]?.headers.authorization).toBe('Bearer agent-key')
    expect(calls[0]?.headers['x-deepseek-harness-user-id']).toBeUndefined()
    expect(calls[0]?.headers['x-deepseek-harness-session-id']).toBeUndefined()
    expect(calls[1]?.url).toBe('https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions')
    expect(calls[1]?.headers.authorization).toBe('Bearer coding-key')
  })
})
