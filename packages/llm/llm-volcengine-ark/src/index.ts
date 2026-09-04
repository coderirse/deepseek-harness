/**
 * Volcengine Ark (火山方舟) LLM provider plugin. Volcengine Ark ships DeepSeek
 * models through two subscription plans, each with its own OpenAI-compatible
 * endpoint and its own API key, so this plugin registers two provider routes —
 * `volcengine-ark-agent` (Agent Plan, `/api/plan/v3`) and
 * `volcengine-ark-coding` (Coding Plan, `/api/coding/v3`) — on `ctx.llm`,
 * reusing the DeepSeek chat-completions adapter that speaks the same wire
 * format. Connection facts resolve per request over the optional
 * `llm-volcengine-ark` user-settings section and the optional credential seam,
 * so a changed key, endpoint, or catalog reaches the very next request without
 * a restart; the one registration-captured fact — the retry policy — is
 * re-read in place when it changes.
 *
 * @module @deepseek-ai/dsh-llm-volcengine-ark
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { Config, PROVIDER_DEFINITIONS, resolveProfiles } from './config.ts'

export { Config, DEFAULT_MAX_TOKENS, DEFAULT_MODELS, PROVIDER_DEFINITIONS, resolveProfiles } from './config.ts'
export type { ProviderDefinition, VolcengineArkProviderProfile } from './config.ts'

export const name = 'llm-volcengine-ark'
export const inject = ['llm']

const NS = 'llm-volcengine-ark'

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: Map<string, DeepSeekConnectionOptions> | undefined
  const profiles = (): Map<string, DeepSeekConnectionOptions> => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveProfiles(raw)
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      // Static composition resolves before anything registers, so this branch
      // only sees a live settings snapshot failing a beyond-schema bound:
      // keep serving the last good facts and say so once per bad snapshot.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-volcengine-ark: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  profiles()

  const resolveApiKey = async (connection: DeepSeekConnectionOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-volcengine-ark', ref)
    } else {
      // Without the seam there is no managed store to rank against, so the
      // environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-volcengine-ark', ref)
      }
    }
    throw new LlmError(
      `llm-volcengine-ark: no API key for ${ref}; store it through the credentials`
      + ' service (the web Models page writes it), or export it in the launching environment',
      'MISSING_CREDENTIAL',
    )
  }

  // One adapter instance per route: the connection facts differ per route
  // (endpoint, credential reference, catalog), and one instance's per-request
  // resolution has no provider argument to pick between them.
  const adapters = new Map<string, DeepSeekAdapter>()
  for (const definition of PROVIDER_DEFINITIONS) {
    adapters.set(definition.provider, new DeepSeekAdapter({
      options: () => {
        const profile = profiles().get(definition.provider)
        // A profile exists for every shipped route by construction of
        // `resolveProfiles`; the guard here is for the type checker only.
        if (profile === undefined) {
          throw new LlmError(
            `llm-volcengine-ark: no resolved profile for provider route "${definition.provider}"`,
            'INVALID_REQUEST',
          )
        }
        return profile
      },
      resolveApiKey,
      label: definition.displayName,
      identity: 'none',
      // Ark speaks the plain OpenAI-compatible wire format, so the official
      // API's plugin-contributed extension fields never apply here.
      prepareExtensions: () => Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
    }))
  }

  ctx.llm.registerConfigurableProviders(PROVIDER_DEFINITIONS.map(definition => ({
    provider: definition.provider,
    displayName: definition.displayName,
    settingsNs: NS,
    settingsPath: ['providers', definition.settingsKey],
  })))

  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. The
  // registry captures each route's retry policy at registration, so a change
  // re-registers that route in place (same adapter instance, one synchronous
  // section) instead of publishing an empty route set.
  const registrations = new Map<string, AdapterRegistrationHandle>()
  const registeredPolicies = new Map<string, ResolvedRetryPolicy>()
  const ensureRegistrationFacts = (): void => {
    for (const definition of PROVIDER_DEFINITIONS) {
      const profile = profiles().get(definition.provider)
      const adapter = adapters.get(definition.provider)
      if (profile === undefined || adapter === undefined) continue
      const policy = profile.retryPolicy
      const registration = registrations.get(definition.provider)
      if (registration === undefined) {
        registrations.set(
          definition.provider,
          ctx.llm.registerAdapter([definition.provider], adapter),
        )
        registeredPolicies.set(definition.provider, policy)
      } else if (!deepEqualJson(policy, registeredPolicies.get(definition.provider))) {
        registration.replace([definition.provider])
        registeredPolicies.set(definition.provider, policy)
      }
    }
  }
  ensureRegistrationFacts()

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource: (source) => {
        current = source
      },
      onChange: ensureRegistrationFacts,
    })
  })
}
