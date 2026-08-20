# Agent Note: Volcengine Ark as a two-route default provider

Status: implemented

English | [中文](2026-08-14-volcengine-ark-provider.zh.md)

## Problem

The harness shipped one first-class DeepSeek provider (`dsh-llm-deepseek`, route `deepseek-official`) plus the dormant pi-ai multi-provider twin. Volcengine Ark (火山方舟) serves DeepSeek V4 through two subscription plans — the Agent Plan and the Coding Plan — each with its own OpenAI-compatible endpoint (`/api/plan/v3` and `/api/coding/v3`) and its own API key, and a regular Ark key does not work with the plan endpoints. Surfacing those two plans through the Web Models page therefore needs two configurable provider routes, not one, and not a pi-ai hand-declared route (which would render as a user-added "custom" provider, not a shipped default).

## Decision

**One new plugin package, `@deepseek-ai/dsh-llm-volcengine-ark`, that registers two provider routes.** It owns `volcengine-ark-agent` (Agent Plan) and `volcengine-ark-coding` (Coding Plan), one `llm-volcengine-ark` settings namespace under a `providers` dict, and one adapter instance per route — the connection facts (endpoint, credential reference, catalog) differ per route, and a single instance's per-request resolution has no provider argument to pick between them.

**Reuse the DeepSeek adapter rather than forking its wire layer.** Ark serves the same DeepSeek chat-completions wire format (thinking via `reasoning_content`, effort via `reasoning_effort`), so the whole serialize/translate/sse stack is identical. `DeepSeekAdapter` is generalized with two backward-compatible constructor options instead of being copied: `label` (a string or per-provider function feeding `providerInfo()` and error messages, default `DeepSeek`) and `identity` (`deepseek` or `none`, default `deepseek`). Ark uses `identity: 'none'`, which drops the `x-deepseek-harness-*` request-identity headers Ark does not define; `resolveUserId` becomes optional because only the `deepseek` identity uses it.

**Both routes register at mount and resolve per request**, exactly like `deepseek-official`: the endpoints and key references default from the plugin schema (the Loader applies `Config` before `apply`, and schemastery materializes field defaults for absent object keys), so both plans appear on the Models page as configured rows needing only a key. `maxTokens` defaults to 128,000 because Ark rejects larger `max_tokens` with a 400 `InvalidParameter` for these models.

## Consequences

What shipped: the two routes with the plan endpoints and key references (`ARK_AGENT_PLAN_API_KEY`, `ARK_CODING_PLAN_API_KEY`); the `volcengine-ark` layout on the Models page (the direct-fetch editor with the DeepSeek wire-format model catalog, since both providers share it); a real-composition test booting the plugin through the Loader and asserting per-plan endpoint/key routing with no DeepSeek identity headers; and the base-bundle row wiring the plugin into every profile. `dsh-llm-deepseek` keeps its observable behavior — `label` and `identity` default to the previous values, and `serializeMessages`/`serializeRequest` gain a trailing `label` parameter with the same default. Ark's non-DeepSeek models (Doubao, Kimi, GLM) are out of scope: the catalog ships DeepSeek V4 only, and the Agent Plan has no `/models` endpoint to interrogate, so the catalogs are static defaults rather than discovered.

## Alternatives considered

- **Two pi-ai hand-declared routes** — renders as a user-added "custom" provider on the Models page and routes through the pi-ai library, not a shipped default with its own adapter.
- **A self-contained Ark adapter copying the DeepSeek wire layer** — duplicates ~570 lines of serialize/translate/sse that are byte-identical for a provider speaking the same wire format; a single maintenance hazard for zero behavioral difference.
- **One adapter instance for both routes** — the adapter's `options` thunk takes no provider, so it cannot resolve per-route endpoints; two instances keep the resolution per-route without widening the seam.
