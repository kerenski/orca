# Wecir Dev GitHub 卡片数据适配层

`getWecirDevGitHubCardData` 位于 Main 层，复用官方 GitHub 读取能力：

- `listWorkItems`：按 Tasks 相同的仓库来源、查询、分页和缓存语义读取 Issue/PR 列表。
- `getWorkItem` / `getWorkItemDetails`：补齐正文、标签、负责人、里程碑、状态、更新时间、Draft、评论和时间线引用。
- `getPRChecks` / `getPRCheckDetails`：为 PR 卡片提供检查摘要和可选的详情、注解、Job 信息。

适配器不读取或复制 Token、Cookie、Authorization Header，也不创建独立 GitHub client。所有 SSH、WSL、Enterprise、认证、缓存和限流路由均由已有 Main GitHub client 负责。

返回值包含 `schemaVersion: 1`、分页信息、成功项目和逐项 `itemErrors`。单个详情失败不会丢弃同批其他项目；列表侧保留官方 `ClassifiedError`，包括权限、限流、网络和无权限仓库分类。

桌面 IPC 通道为 `gh:wecirDevCardData`，远程 Runtime RPC 方法为 `github.wecirDevCardData`。新增字段均为可选或附加字段，旧 Tasks 通道和行为不变。
