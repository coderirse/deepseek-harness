# @deepseek-ai/dsh-llm-volcengine-ark

English | [中文](README.zh.md)

Volcengine Ark (火山方舟) chat-completions adapter for the harness LLM seam. Volcengine Ark ships DeepSeek V4 through two subscription plans — the **Agent Plan** and the **Coding Plan** — each with its own OpenAI-compatible endpoint and its own API key, so this package registers them as two distinct provider routes:

| Provider route | Display name | Settings key | Default endpoint |
|---|---|---|---|
| `volcengine-ark-agent` | Volcengine Ark Agent Plan | `providers.agent` | `https://ark.cn-beijing.volces.com/api/plan/v3` |
| `volcengine-ark-coding` | Volcengine Ark Coding Plan | `providers.coding` | `https://ark.cn-beijing.volces.com/api/coding/v3` |

The wire format is the DeepSeek chat-completions format (thinking via `reasoning_content`, effort via `reasoning_effort`), so the package reuses [`DeepSeekAdapter`](../llm-deepseek/README.md) with the provider label generalized and the DeepSeek request-identity headers disabled — Ark defines no `x-deepseek-harness-*` headers, and a regular Ark key does not work with the plan endpoints, so each plan resolves its own key.

## Config

```yaml
- id: llm-volcengine-ark
  name: '@deepseek-ai/dsh-llm-volcengine-ark'
  config:
    providers:
      agent:
        # apiKeyEnv defaults to ARK_AGENT_PLAN_API_KEY; baseURL defaults to /api/plan/v3
        reasoningEffort: high
      coding:
        # apiKeyEnv defaults to ARK_CODING_PLAN_API_KEY; baseURL defaults to /api/coding/v3
        maxTokens: 64000
```

Both plans share one `llm-volcengine-ark` settings namespace under a `providers` dict. Each profile carries the same fields as the DeepSeek adapter profile — `apiKeyEnv`, `baseURL`, `thinking`, `reasoningEffort`, `maxTokens`, `defaultContextWindow`, `models`, `streamIdleTimeoutMs`, `retryPolicy` — with per-plan defaults for the endpoint and credential reference.

The plugin registers both routes at mount, each with its own adapter instance. Connection facts resolve per request over the optional `llm-volcengine-ark` user-settings section and the optional credential seam, so a changed key, endpoint, or catalog reaches the next request without a restart; the one registration-captured fact — the retry policy — re-registers its route in place when it changes.

Omitting `models` advertises `deepseek-v4-pro` as `DeepSeek-V4-Pro` and `deepseek-v4-flash` as `DeepSeek-V4-Flash`, each with a 1,000,000-token context window; an explicit list replaces those defaults, while `models: []` advertises none. Catalog entries are exposed through `ctx.llm.listModels(route)` for the Web selector, but remain advisory: unlisted model ids still pass through unchanged.

`maxTokens` defaults to 128,000 per request — Ark rejects `max_tokens` above that with a 400 `InvalidParameter` for the DeepSeek models it serves, even though the models' official output limit is larger. A catalog entry may carry its own `maxTokens`, which wins for that model.

## Errors

The adapter reuses the DeepSeek adapter's error mapping: non-2xx responses throw `LlmError` with stable codes (`AUTH`, `QUOTA`, `RATE_LIMIT`, `CONTEXT_WINDOW_EXCEEDED`, `INVALID_REQUEST`, `SERVER`, `HTTP_<status>`), transport failures throw `TRANSPORT`, and a request with no key anywhere fails with `MISSING_CREDENTIAL` naming the credential reference.

## Model Experience

### Volcengine Ark request

#### What the model sees

The selected DeepSeek model receives the harness system prompt, message history, tool schemas, stop sequences, and call config without adapter-authored prompt prose. Reasoning is passed back on tool-call turns and omitted otherwise, matching the DeepSeek wire format Ark serves.

#### Token effect

Provider tokenization governs exact input. Conditional reasoning passback increases tool-round-trip context, while dropping other reasoning avoids paying those tokens again.

#### KV Cache effect

An unchanged assembled prefix is eligible for cache reuse, which this adapter reports in usage. A model-route change selects a different cache domain.

### Volcengine Ark response

#### What the model sees

Reasoning, text, and raw-string tool arguments are translated into harness chunks for the loop to log and assemble.

#### Token effect

Generated tokens follow the request's logged reasoning effort and `maxTokens`.

#### KV Cache effect

Loop-retained response blocks append to the next request and preserve its earlier reusable prefix.

## Known Limitations and Deferred Work

- **No `/models` interrogation** — the Agent Plan exposes no usable `/models` endpoint and the Coding Plan's catalog is static, so the two catalogs ship as defaults rather than being discovered. A deployment corrects them through the settings section.
- **DeepSeek-dialect only** — the adapter assumes the DeepSeek reasoning wire format Ark serves for its DeepSeek models. Ark's non-DeepSeek models (Doubao, Kimi, GLM) are not in the default catalog and are not this package's concern.
- **A settings `models` list replaces the composition list wholesale** — settings-layer merging is per-field, and arrays are one field; per-entry catalog merging would need a keyed shape.
