---
name: orca-skill
description: 开卡 SOP。用户说「开卡 / 跑一张卡 / 跑 issue #N / start-card」时使用：读 issue → 判档 → issue 评论起跑宣言 → 调 scripts/start-card.sh → 汇报 CARD_STARTED 摘要后停止，不跟进闭环。
---

# orca-skill

> 版本：v2.0（2026-08-30）｜目录名不带版本号，版本演进看本行 + git 历史，禁止并存多版本目录

## 适用范围

只负责「开卡」这一步：创建 worktree + controller 终端 + 注入初始指令。
开卡后的闭环（开发/审查/CI/PR）由 controller 在 worktree 终端里自主驱动，**本技能宿主不跟进**。
controller 采用事件驱动等待：派发任务后结束回合，被唤醒后跑 `poll-dev-local.sh` 硬验证；send-task.sh 自动启动看门狗兜底。过程状态外置于 `/tmp/<card>/`（card-state.md / worker.handle / controller.handle），收尾整目录清理。

## 脚本架构

```
scripts/
  _lib.sh              ← 公共函数库（source 用，不直接执行）
  start-card.sh        ← 开卡入口（创建 worktree + controller 终端 + 注入 prompt）
  ensure-worker.sh     ← 幂等创建/复用 worker 终端
  send-task.sh         ← 统一任务派发（--round 0=首轮开发，--round N=修复轮）
  send-dev-task.sh     ← 兼容 wrapper → send-task.sh --round 0
  send-review.sh       ← 兼容 wrapper → send-task.sh
  send-review-round.sh ← 兼容 wrapper → send-task.sh
  poll-dev-local.sh    ← 一次性验证（检查 worker 是否完成）
  wait-dev-watchdog.sh ← 看门狗后台进程（检测提交、代发通知、催提交、超时）
  check-ci.sh          ← 查询 GitHub PR CI 状态
  run-checks.sh        ← 可选本地检查工具（不属于主流程硬闸）
  kimi-trust.sh        ← kimi 预信任 worktree 目录
```

新代码优先使用 `send-task.sh`；`send-dev-task.sh` / `send-review.sh` / `send-review-round.sh` 保留为兼容 wrapper。

## 触发词

开卡 / 跑一张卡 / 跑 issue #N / start-card

## 执行前提

- 在仓库主 worktree 根目录运行
- 依赖：`orca`（CLI 已与 Orca 应用配对）、`gh`（已登录）、`jq`、`git`
- 卡号格式如 `m1-fp-03`（1–64 位小写字母、数字、连字符，首尾不能为连字符）；issue 为正整数
- 脚本按 `0644` 打包，必须通过 `bash <技能目录>/scripts/start-card.sh` 调用，不能直接执行
- 开发态技能目录为仓库内 `skills/orca-skill`；应用打包后为 `process.resourcesPath/orca-skill`
- `tiers.json` 和 `templates/controller-prompt.tpl.md` 均按脚本所在技能目录相对解析
- **gh 必须显式 `-R <fork>`**：多 remote 下 gh 偏好 upstream>origin，不显式指向会把同号 issue 解析/评论到上游（#61 实际事故）

## 流程

1. 读需求：`gh issue view <N> -R $FORK --json title,body -q .body`
   ⚠ 卡号↔标题核对：issue 标题应含卡号对应任务名；对不上立即停，向用户确认
2. 判档（下表；**拿不准默认降一档**）
3. 起跑宣言（issue 评论）：
   `gh issue comment <N> -R $FORK --body "🚀 起跑：<card>，难度<档>，组合 <controller>/<worker>，理由：<一句话>"`
4. 调脚本（在主 worktree 根）：
   `bash <技能目录>/scripts/start-card.sh --issue <N> --card <card> --tier <simple|medium|complex>`
5. 把脚本输出的 `CARD_STARTED` 摘要原样转述给用户，**然后停止**

## 结构化调用

Main 或自动化调用时追加 `--json`。stdout 只产生一个 schema v1 成功或失败 JSON；过程日志写 stderr。调用方必须同时校验 JSON 和退出码：

- `0`：成功，`ok: true`，含 `controllerPtyId`、`worktreeId`、`worktreePath`、`branch`、`workerAgent`、`issue`、`card`、`tier`
- `1`：参数或依赖错误，`ok: false`
- `2`：同名孤儿 worktree，`ok: false`；确认废弃后可加 `--force`
- `3`：执行错误，`ok: false`

## 判档表

| 档位 | 特征（满足其一） |
|------|------------------|
| simple | 预估 ≤1 人天；单文件/单页面；无跨模块依赖；纯样式或单接口小改 |
| medium | 预估 2 人天；跨 2-3 文件；前后端联动或新增单模块 |
| complex | 预估 ≥3 人天；多模块多文件；含红线（数据范围/权限/RBAC）、状态机、需强推理 |

组合（controller/worker）以 `<技能目录>/tiers.json` 为唯一事实源。
覆盖默认组合：`--controller-cmd "<完整命令>"` / `--worker-agent "<id[ 参数]>"`。

## 禁止

- 不跟进开卡后的闭环（那是 controller 的事）
- 不手拼 orca 长命令序列——一律调本目录 `scripts/` 下脚本
- 同名 worktree 已存在时脚本会中止：确认废弃后加 `--force` 重开，或换卡号后缀（如 `<card>-r1`）
