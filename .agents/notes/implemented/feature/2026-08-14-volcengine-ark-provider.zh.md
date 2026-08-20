# Agent Note：火山方舟作为双路由默认提供商

Status: implemented

[English](2026-08-14-volcengine-ark-provider.md) | 中文

## 问题

Harness 只内置了一个一等 DeepSeek 提供商（`dsh-llm-deepseek`，路由 `deepseek-official`），外加处于休眠态的 pi-ai 多提供商孪生实现。火山方舟（Volcengine Ark）通过两个订阅套餐提供 DeepSeek V4 —— Agent Plan 与 Coding Plan —— 每个套餐都有独立的 OpenAI 兼容端点（`/api/plan/v3` 与 `/api/coding/v3`）和独立的 API Key，且普通方舟 API Key 无法用于套餐端点。因此，在 Web 模型页面上呈现这两个套餐，需要两条可配置的提供商路由，而不是一条；也不能用 pi-ai 的手写声明路由（那样会渲染为用户自行添加的“自定义”提供商，而非内置默认）。

## 决策

**新增一个插件包 `@deepseek-ai/dsh-llm-volcengine-ark`，注册两条提供商路由。** 它拥有 `volcengine-ark-agent`（Agent Plan）与 `volcengine-ark-coding`（Coding Plan），共享一个 `llm-volcengine-ark` 设置命名空间下的 `providers` 字典，每条路由各用一个适配器实例 —— 连接事实（端点、凭证引用、目录）按路由不同，而单个实例的按请求解析没有 provider 参数可供区分。

**复用 DeepSeek 适配器，而不是分叉它的线上层。** 方舟服务的是同一种 DeepSeek chat-completions 线上格式（思考经 `reasoning_content`、努力档位经 `reasoning_effort`），因此整个 serialize/translate/sse 栈完全一致。`DeepSeekAdapter` 通过两个向后兼容的构造参数泛化，而不是复制：`label`（字符串或按 provider 的函数，供给 `providerInfo()` 与错误消息，默认 `DeepSeek`）和 `identity`（`deepseek` 或 `none`，默认 `deepseek`）。方舟使用 `identity: 'none'`，从而去掉方舟未定义的 `x-deepseek-harness-*` 请求身份请求头；`resolveUserId` 变为可选，因为只有 `deepseek` 身份会用到它。

**两条路由在挂载时注册、按请求解析**，与 `deepseek-official` 完全一致：端点与 Key 引用由插件 schema 默认给出（Loader 在 `apply` 前应用 `Config`，且 schemastery 会为缺省对象键物化字段默认值），因此两个套餐在模型页面上都表现为已配置的行、只需填 Key。`maxTokens` 默认为 128,000，因为方舟对这些模型拒绝更大的 `max_tokens`，返回 400 `InvalidParameter`。

## 后果

已交付：两条路由及其套餐端点与 Key 引用（`ARK_AGENT_PLAN_API_KEY`、`ARK_CODING_PLAN_API_KEY`）；模型页面上的 `volcengine-ark` 布局（直接 fetch 编辑器，加上 DeepSeek 线上格式的模型目录，因为两者共享同一目录）；一个真实组合测试，通过 Loader 启动该插件，断言按套餐的端点/Key 路由且不带 DeepSeek 身份请求头；以及把插件接入每个 profile 的 base-bundle 行。`dsh-llm-deepseek` 保持可观察行为不变 —— `label` 与 `identity` 默认回退到先前的值，`serializeMessages`/`serializeRequest` 增加一个带相同默认值的尾部 `label` 参数。方舟的非 DeepSeek 模型（Doubao、Kimi、GLM）不在范围内：目录只内置 DeepSeek V4，且 Agent Plan 没有可查询的 `/models` 端点，因此目录是静态默认值而非被发现所得。

## 备选方案

- **两条 pi-ai 手写声明路由** —— 在模型页面上渲染为用户自行添加的“自定义”提供商，且经由 pi-ai 库路由，而非自带适配器的内置默认。
- **自包含的方舟适配器，复制 DeepSeek 线上层** —— 复制约 570 行 serialize/translate/sse，这些代码对同一种线上格式的提供商而言逐字节相同；为行为零差异制造单一的维护风险。
- **两条路由共用一个适配器实例** —— 适配器的 `options` thunk 不接收 provider，无法按路由解析端点；两个实例在加宽接缝的前提下按路由解析。
