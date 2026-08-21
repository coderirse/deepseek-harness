import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_REQUEST_IMAGE_BYTES } from '@deepseek-ai/dsh-llm-deepseek'
import {
  AGENT_API_KEY_ENV,
  AGENT_BASE_URL,
  CODING_API_KEY_ENV,
  CODING_BASE_URL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODELS,
  resolveProfiles,
} from '../src/config.ts'

describe('resolveProfiles', () => {
  it('resolves both plans with per-plan endpoint and credential defaults', () => {
    const profiles = resolveProfiles({})

    expect(profiles.get('volcengine-ark-agent')).toMatchObject({
      baseURL: AGENT_BASE_URL,
      apiKeyEnv: AGENT_API_KEY_ENV,
      maxTokens: DEFAULT_MAX_TOKENS,
      models: DEFAULT_MODELS,
      maxRequestImageBytes: DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    })
    expect(profiles.get('volcengine-ark-coding')).toMatchObject({
      baseURL: CODING_BASE_URL,
      apiKeyEnv: CODING_API_KEY_ENV,
      maxTokens: DEFAULT_MAX_TOKENS,
      models: DEFAULT_MODELS,
      maxRequestImageBytes: DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    })
  })

  it('applies per-plan overrides from the providers dict', () => {
    const profiles = resolveProfiles({
      providers: {
        agent: { baseURL: 'https://gateway.example/plan', apiKeyEnv: 'CUSTOM_AGENT_KEY', maxTokens: 64000, maxRequestImageBytes: 8 * 1024 * 1024 },
        coding: { models: [{ id: 'deepseek-v4-flash' }] },
      },
    })

    expect(profiles.get('volcengine-ark-agent')).toMatchObject({
      baseURL: 'https://gateway.example/plan',
      apiKeyEnv: 'CUSTOM_AGENT_KEY',
      maxTokens: 64000,
      maxRequestImageBytes: 8 * 1024 * 1024,
    })
    expect(profiles.get('volcengine-ark-coding')!.models).toEqual([{ id: 'deepseek-v4-flash' }])
  })

  it('rejects a thinking/effort pair the adapter cannot honor', () => {
    expect(() => resolveProfiles({
      providers: { coding: { thinking: 'disabled', reasoningEffort: 'high' } },
    })).toThrow(/reasoningEffort "off"/)
  })

  it('rejects a duplicate catalog id for the offending provider route', () => {
    expect(() => resolveProfiles({
      providers: { agent: { models: [{ id: 'dup' }, { id: 'dup' }] } },
    })).toThrow(/volcengine-ark-agent.*duplicate catalog model "dup"/)
  })

  it('rejects a non-positive maxRequestImageBytes', () => {
    expect(() => resolveProfiles({
      providers: { agent: { maxRequestImageBytes: 0 } },
    })).toThrow(/maxRequestImageBytes must be a positive safe integer/)
  })
})
