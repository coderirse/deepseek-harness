# @deepseek-ai/dsh-llm-volcengine-ark

[English](README.md) | 中文

火山方舟（Volcengine Ark）的 chat-completions 适配器，接入 Harness 的 LLM 能力接缝。火山方舟通过两个订阅套餐提供 DeepSeek V4 —— **Agent Plan** 和 **Coding Plan** —— 每个套餐都有独立的 OpenAI 兼容端点和独立的 API Key，因此本包将它们注册为两条不同的提供商路由：

| 提供商路由 | 显示名称 | 设置键 | 默认端点 |
|---|---|---|---|
| `volcengine-ark-agent` | Volcengine Ark Agent Plan | `providers.agent` | `https://ark.cn-beijing.volces.com/api/plan/v3` |
| `volcengine-ark-coding` | Volcengine Ark Coding Plan | `providers.coding` | `https://ark.cn-beijing.volces.com/api/coding/v3` |

线上格式即 DeepSeek 的 chat-completions 格式（思考通过 `reasoning_content`、努力档位通过 `reasoning_effort`），因此本包复用 [`DeepSeekAdapter`](../llm-deepseek/README.zh.md)，仅将提供商标签泛化、并关闭 DeepSeek 的请求身份请求头 —— 方舟不定义任何 `x-deepseek-harness-*` 请求头，且普通方舟 API Key 无法用于套餐端点，所以每个套餐各自解析自己的 Key。

## 配置

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

两个套餐共享同一个 `llm-volcengine-ark` 设置命名空间下的 `providers` 字典。每个 profile 携带与 DeepSeek 适配器 profile 相同的字段 —— `apiKeyEnv`、`baseURL`、`thinking`、`reasoningEffort`、`maxTokens`、`defaultContextWindow`、`models`、`streamIdleTimeoutMs`、`maxInlineRequestImageBytes`、`retryPolicy` —— 其中端点与凭证引用按套餐给出默认值。

本插件在挂载时注册两条路由，每条路由各用一个适配器实例。连接事实按请求、在可选的 `llm-volcengine-ark` 用户设置段与可选的凭证接缝上解析，因此更改 Key、端点或目录会作用于下一次请求而无需重启；唯一在注册时捕获的事实 —— 重试策略 —— 变更时原地重新注册其路由。

省略 `models` 时广告 `deepseek-v4-pro`（`DeepSeek-V4-Pro`）与 `deepseek-v4-flash`（`DeepSeek-V4-Flash`），各带 1,000,000 token 上下文窗口；显式列表会替换这些默认值，而 `models: []` 则不广告任何模型。目录条目通过 `ctx.llm.listModels(route)` 暴露给 Web 选择器，但仍是建议性的：未列出的模型 id 仍会原样透传。

`maxTokens` 每次请求默认 128,000 —— 方舟对其服务的 DeepSeek 模型拒绝高于该值的 `max_tokens`，返回 400 `InvalidParameter`，即便这些模型的官方输出上限更大。目录条目可自带 `maxTokens`，对该模型生效。

## 错误

适配器复用 DeepSeek 适配器的错误映射：非 2xx 响应抛出带稳定错误码的 `LlmError`（`AUTH`、`QUOTA`、`RATE_LIMIT`、`CONTEXT_WINDOW_EXCEEDED`、`INVALID_REQUEST`、`SERVER`、`HTTP_<status>`），传输失败抛出 `TRANSPORT`，而任何地方都没有 Key 的请求以 `MISSING_CREDENTIAL` 失败并指明凭证引用。

## 模型体验

### 火山方舟请求

#### 模型看到什么

被选中的 DeepSeek 模型收到 Harness 系统提示、消息历史、工具 schema、停止序列与调用配置，没有适配器编写的提示词。思考内容在带工具调用的回合回传、其余回合省略，与方舟所服务的 DeepSeek 线上格式一致。

#### Token 影响

输入由提供商的分词决定。有条件的思考回传增加了工具往返的上下文，而丢弃其他思考则避免再次为这些 token 付费。

#### KV 缓存影响

未改变的前缀可复用缓存，本适配器会在 usage 中报告。切换模型路由会切换到另一个缓存域。

### 火山方舟响应

#### 模型看到什么

思考、文本与原始字符串工具参数被翻译为 Harness 分块，供循环记录与组装。

#### Token 影响

生成的 token 遵循请求所记录的努力档位与 `maxTokens`。

#### KV 缓存影响

循环保留的响应分块追加到下一次请求，并保留其先前的可复用前缀。

## 已知限制与后续工作

- **不查询 `/models`** —— Agent Plan 没有可用的 `/models` 端点，Coding Plan 的目录是静态的，因此两个目录作为默认值随包发布而非被发现。部署可通过设置段修正它们。
- **仅支持 DeepSeek 方言** —— 适配器假定方舟为其 DeepSeek 模型所服务的 DeepSeek 思考线上格式。方舟的非 DeepSeek 模型（Doubao、Kimi、GLM）不在默认目录中，也不属于本包的范围。
- **设置中的 `models` 列表整体替换组合列表** —— 设置层合并是逐字段的，而数组是一个字段；按条目的目录合并需要键控结构。
