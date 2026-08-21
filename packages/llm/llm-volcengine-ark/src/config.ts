/**
 * Configuration schema and resolution for the Volcengine Ark adapter. The two
 * shipped plans are a fixed dict keyed by `agent` and `coding`, each resolving
 * to the same `DeepSeekConnectionOptions` shape the DeepSeek adapter already
 * serves; only the endpoint, credential reference, and display name differ.
 * @module @deepseek-ai/dsh-llm-volcengine-ark/config
 */

import z from '@deepseek-ai/schemastery'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_REQUEST_IMAGE_BYTES, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '@deepseek-ai/dsh-llm-deepseek'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from '@deepseek-ai/dsh-llm-deepseek'

/** One shipped plan: its provider route, selector label, settings key, and connection defaults. */
export interface ProviderDefinition {
  /** Provider route key used by `GenerateOptions.provider`. */
  provider: string
  /** Human-readable provider name for selectors and diagnostics. */
  displayName: string
  /** Key of this plan's profile under the `providers` settings dict. */
  settingsKey: 'agent' | 'coding'
  /** Endpoint base; `/chat/completions` is appended. */
  baseURL: string
  /** Credential reference (environment-variable name) resolved per request. */
  apiKeyEnv: string
}

/** The Agent Plan's OpenAI-compatible endpoint base. */
export const AGENT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3'
/** The Coding Plan's OpenAI-compatible endpoint base. */
export const CODING_BASE_URL = 'https://ark.cn-beijing.volces.com/api/coding/v3'
/** Credential reference (environment-variable name) for the Agent Plan's dedicated key. */
export const AGENT_API_KEY_ENV = 'ARK_AGENT_PLAN_API_KEY'
/** Credential reference (environment-variable name) for the Coding Plan's dedicated key. */
export const CODING_API_KEY_ENV = 'ARK_CODING_PLAN_API_KEY'

/** The two shipped plans, in display order. */
export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    provider: 'volcengine-ark-agent',
    displayName: 'Volcengine Ark Agent Plan',
    settingsKey: 'agent',
    baseURL: AGENT_BASE_URL,
    apiKeyEnv: AGENT_API_KEY_ENV,
  },
  {
    provider: 'volcengine-ark-coding',
    displayName: 'Volcengine Ark Coding Plan',
    settingsKey: 'coding',
    baseURL: CODING_BASE_URL,
    apiKeyEnv: CODING_API_KEY_ENV,
  },
]

/**
 * Default per-request output cap. Ark rejects `max_tokens` above 128,000 with
 * a 400 `InvalidParameter` for the DeepSeek models it serves, so this is the
 * safe ceiling rather than the models' larger official output limit.
 */
export const DEFAULT_MAX_TOKENS = 128_000

/** Advisory models shown by discovery consumers; both plans serve the same DeepSeek V4 models. */
export const DEFAULT_MODELS: DeepSeekCatalogModel[] = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: DEFAULT_CONTEXT_WINDOW },
]

/** Configuration for one plan's provider route. */
export interface VolcengineArkProviderProfile {
  /** Credential reference (environment-variable name) resolved per request; defaults per plan. */
  apiKeyEnv?: string
  /** Endpoint base; defaults per plan. */
  baseURL?: string
  /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort (default `high`); `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'high' | 'max'
  /** Default per-request output cap (default 128,000); a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  defaultContextWindow?: number
  /** Advisory models shown by discovery consumers; defaults to V4 Pro and V4 Flash. */
  models?: DeepSeekCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Maximum accumulated base64 image payload per request (default 20 MiB). */
  maxRequestImageBytes?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

/** Plugin configuration: the two shipped plans. */
export interface Config {
  providers?: {
    agent?: VolcengineArkProviderProfile
    coding?: VolcengineArkProviderProfile
  }
}

const catalogModel: z<DeepSeekCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

/** Fields both plans share; per-plan endpoints and references stay out so each profile defaults its own. */
const profileFields = {
  thinking: z.union(['enabled', 'disabled']),
  reasoningEffort: z.union(['off', 'high', 'max']),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  models: z.array(catalogModel).default(DEFAULT_MODELS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  maxRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_IMAGE_BYTES),
  retryPolicy: RetryPolicySchema,
}

const agentProfile: z<VolcengineArkProviderProfile> = z.object({
  ...profileFields,
  apiKeyEnv: z.string().role('credential-ref').default(AGENT_API_KEY_ENV),
  baseURL: z.string().default(AGENT_BASE_URL),
})

const codingProfile: z<VolcengineArkProviderProfile> = z.object({
  ...profileFields,
  apiKeyEnv: z.string().role('credential-ref').default(CODING_API_KEY_ENV),
  baseURL: z.string().default(CODING_BASE_URL),
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  providers: z.object({
    agent: agentProfile,
    coding: codingProfile,
  }),
})

/**
 * Validate and detach the advisory model catalog.
 * @param provider - the provider route whose catalog is being resolved.
 * @param models - configured models, or undefined to serve the defaults.
 * @returns the detached, validated catalog.
 */
function resolveModels(provider: string, models: readonly DeepSeekCatalogModel[] | undefined): DeepSeekCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (model.id.length === 0) {
      throw new Error(`llm-volcengine-ark: provider "${provider}" catalog model ids must be non-empty`)
    }
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-volcengine-ark: provider "${provider}" catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-volcengine-ark: provider "${provider}" catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-volcengine-ark: provider "${provider}" catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    if (seen.has(model.id)) {
      throw new Error(`llm-volcengine-ark: provider "${provider}" duplicate catalog model "${model.id}"`)
    }
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    }
  })
}

/**
 * The one explicit resolve step from raw config to validated connection facts,
 * per route. Programmatic construction may bypass Schemastery normalization,
 * so every default and bound is re-judged here — for the composition entry at
 * load (fail loud) and for each settings snapshot at its first use.
 * @param config - raw plugin config or resolved settings snapshot.
 * @returns validated connection facts keyed by provider route.
 */
export function resolveProfiles(config: Config): Map<string, DeepSeekConnectionOptions> {
  const resolved = new Map<string, DeepSeekConnectionOptions>()
  for (const definition of PROVIDER_DEFINITIONS) {
    const source = config.providers?.[definition.settingsKey] ?? {}
    if (source.thinking === 'disabled'
      && source.reasoningEffort !== undefined
      && source.reasoningEffort !== 'off') {
      throw new Error(
        `llm-volcengine-ark: provider "${definition.provider}" can only configure reasoningEffort "off" when thinking is disabled`,
      )
    }
    if (source.defaultContextWindow !== undefined
      && (!Number.isInteger(source.defaultContextWindow) || source.defaultContextWindow <= 0)) {
      throw new Error(`llm-volcengine-ark: provider "${definition.provider}" defaultContextWindow must be a positive integer`)
    }
    if (source.maxTokens !== undefined
      && (!Number.isSafeInteger(source.maxTokens) || source.maxTokens <= 0)) {
      throw new Error(`llm-volcengine-ark: provider "${definition.provider}" maxTokens must be a positive safe integer`)
    }
    const streamIdleTimeoutMs = source.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
    const maxRequestImageBytes = source.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES
    if (!Number.isSafeInteger(maxRequestImageBytes) || maxRequestImageBytes <= 0) {
      throw new Error(`llm-volcengine-ark: provider "${definition.provider}" maxRequestImageBytes must be a positive safe integer`)
    }
    if (!Number.isFinite(streamIdleTimeoutMs)
      || streamIdleTimeoutMs <= 0
      || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
      throw new Error(
        `llm-volcengine-ark: provider "${definition.provider}" streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
      )
    }
    resolved.set(definition.provider, {
      apiKeyEnv: credentialRef(source.apiKeyEnv ?? definition.apiKeyEnv),
      baseURL: source.baseURL ?? definition.baseURL,
      defaults: {
        thinking: source.thinking,
        reasoningEffort: source.reasoningEffort,
      },
      maxTokens: source.maxTokens ?? DEFAULT_MAX_TOKENS,
      defaultContextWindow: source.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
      models: resolveModels(definition.provider, source.models),
      streamIdleTimeoutMs,
      maxRequestImageBytes,
      retryPolicy: resolveRetryPolicy(
        source.retryPolicy,
        `llm-volcengine-ark: provider "${definition.provider}" retryPolicy`,
      ),
    })
  }
  return resolved
}
