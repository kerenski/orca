# Wecir Dev 卡片协议 V1

`src/shared/wecir-dev/contracts.ts` 是 Renderer、Preload、Main 共用的唯一领域类型来源，`schemas.ts` 是 IPC 边界的运行时校验来源。所有请求、响应、队列项、Controller 指令、状态转换和分页结果都必须携带 `schemaVersion: 1`。

## 领域字段

- 仓库选择：已注册 `repositoryId`、本地 `path`、`executionHost: "local"`，可选 GitHub 标识。
- Issue/PR 引用：`kind`、正整数 `number`、仓库 owner/name，可选 URL 和标题。
- 依赖关系：`blocks`、`blocked_by` 或 `related`，且必须恰好指向 card 或 Issue/PR。
- 优先级：`critical`、`high`、`normal`、`low`。
- 分析结果：摘要、建议优先级、依赖、风险标记、验收标准和生成时间。
- card 记录：稳定 card 名称、仓库、引用、优先级、分析、依赖、状态、时间戳及运行句柄。
- 队列项：队列 ID、card ID、优先级、入队时间、重试次数和来源。
- Controller 指令：`start`、`stop`、`retry`、`remove`、`refresh`、`approve_merge`、`mark_stale`。
- 分页：`page`/`pageSize` 或 `cursor` 二选一，响应返回总数和下一页信息。

## 状态与错误

状态集合固定为 `queued`、`starting`、`controller_ready`、`worker_running`、`waiting_review`、`ci_running`、`waiting_merge`、`completed`、`failed`、`stale`、`removed`、`blocked`。`isValidWecirDevStatusTransition` 和 `WecirDevStatusTransitionSchema` 共同拒绝非法跳转；未知状态必须拒绝，不能静默视为成功。

错误码覆盖参数无效、仓库未注册、仓库路径不匹配、非本地执行主机、依赖缺失、脚本缺失、脚本输出非法、PTY 绑定失效、worktree 失效、GitHub 认证失败、超时和未知错误。

## Wire 兼容边界

第一版只支持本地 execution host。跨进程升级遵循 additive-only 规则：新增字段必须可选，旧客户端可省略新增字段；未知非危险字段在兼容层可忽略。新增状态或 IPC channel 必须先通过能力检查；未知状态不可当作成功处理。Schema 对已知对象使用严格字段集，并拒绝 `__proto__`、`prototype`、`constructor`、`token`、`apiKey`、`password` 和 `secret` 等危险字段。

## Renderer 导航边界

`cards` 是独立顶层视图，通过 `openWecirDevCardPage` / `closeWecirDevCardPage` 管理返回目标，并使用独立的 `wecir-dev-card` Zustand slice。它不得调用 `openTaskPage`，也不得读写 `taskPageData` 或官方 Tasks Drawer 状态。

顶层视图持久化接受 `cards`，旧版或未知值仍回退到 `terminal`。第一版卡片页只选择本地 Git 仓库；没有本地 Git 仓库、GitHub CLI 未安装或未认证时必须显示明确空状态，不把远端断联解释为本地任务不存在。

## Fixture

`src/shared/wecir-dev/fixtures/` 包含成功 card、失败响应和兼容旧字段的 JSON 样例，测试覆盖其关键形状及非法输入。
