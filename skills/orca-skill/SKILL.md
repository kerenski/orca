---
name: orca-skill
description: 开卡 SOP。用户说「开卡 / 跑一张卡 / 跑 issue #N / start-card」时使用：读 issue → 判档 → issue 评论起跑宣言 → 调 scripts/start-card.sh → 汇报 CARD_STARTED 摘要后停止，不跟进闭环。
---

# orca-skill

> 版本：v1.2（2026-08-26）｜目录名不带版本号，版本演进看本行 + git 历史，禁止并存多版本目录

## 适用范围

只负责「开卡」这一步：创建 worktree + controller 终端 + 注入初始指令。
开卡后的闭环（开发/审查/CI/PR）由 controller 在 worktree 终端里自主驱动，**本技能宿主不跟进**。
controller 采用事件驱动等待：派发任务后结束回合，被 DEV_SIGNAL 唤醒后跑 `poll-dev-local.sh --once` 硬验证；send 脚本自动启动看门狗兜底（忘发时代发，慢 ≤5 分钟）。过程状态外置于 `/tmp/<card>/`（card-state.md / worker.handle / controller.handle），收尾整目录清理。
完整设计见 `docs/Orca两层编排闭环流程-v2.md`（本文档为使用说明，脚本为事实源）。

## 触发词

开卡 / 跑一张卡 / 跑 issue #N / start-card

## 执行前提

- 在仓库主 worktree 根目录运行
- 依赖：`orca`（CLI 已与 Orca 应用配对）、`gh`（已登录）、`jq`
- 卡号格式如 `m1-fp-03`（小写字母数字连字符）；issue 为正整数
- **gh 必须显式 `-R <fork>`**：从 origin remote 解析 `FORK=$(git remote get-url origin | sed -E 's#.*github\.com[:/]([^/]+)/([^/]+)#\1/\2#' | sed 's#\.git$##')`；多 remote 下 gh 偏好 upstream>origin，不显式指向会把同号 issue 解析/评论到上游（含 PR——PR 与 issue 共享编号空间，REST 静默返回不报错；#61 实际事故：fork 中文 issue 被换成上游英文 PR 发给了 worker）

## 流程

1. 读需求：`gh issue view <N> -R $FORK --json title,body -q .body`
   ⚠ 卡号↔标题核对：issue 标题应含卡号对应任务名（本仓约定标题嵌卡号，如「M1-01 冻结卡片领域模型…」对应 m1-01）；对不上立即停，向用户确认，禁止盲目开卡
2. 判档（下表；**拿不准默认降一档**）
3. 起跑宣言（issue 评论，可并入看板记录）：
   `gh issue comment <N> -R $FORK --body "🚀 起跑：<card>，难度<档>，组合 <controller>/<worker>，理由：<一句话>"`
4. 调脚本（在主 worktree 根）：
   `bash $HOME/.orca-skill/scripts/start-card.sh --issue <N> --card <card> --tier <simple|medium|complex>`
5. 把脚本输出的 `CARD_STARTED` 摘要原样转述给用户，**然后停止**

## 判档表

| 档位 | 特征（满足其一） |
|------|------------------|
| simple | 预估 ≤1 人天；单文件/单页面；无跨模块依赖；纯样式或单接口小改 |
| medium | 预估 2 人天；跨 2-3 文件；前后端联动或新增单模块 |
| complex | 预估 ≥3 人天；多模块多文件；含红线（数据范围/权限/RBAC）、状态机、需强推理 |

组合（controller/worker）以 `$HOME/.orca-skill/tiers.json` 为唯一事实源，判档时查该文件。
覆盖默认组合：`--controller-cmd "<完整命令>"` / `--worker-agent "<id[ 参数]>"`。

## 禁止

- 不跟进开卡后的闭环（那是 controller 的事）
- 不手拼 orca 长命令序列——一律调本目录 `scripts/` 下脚本
- 同名 worktree 已存在时脚本会中止：确认废弃后加 `--force` 重开，或换卡号后缀（如 `<card>-r1`）
