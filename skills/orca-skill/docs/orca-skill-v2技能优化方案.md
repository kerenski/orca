# orca-skill v2 技能优化方案

> 版本：v1.0｜2026-08-30
> 范围：`skills/orca-skill/scripts/` 全部 10 个脚本 + `templates/controller-prompt.tpl.md` + 整体流程
> 目标：降低代码重复与流程复杂度，同时保留已验证的防御性设计

---

## 1. 现状盘点

### 1.1 脚本清单

| 层 | 脚本 | 行数 |
|---|---|---|
| 开卡入口 | `start-card.sh` | 334 |
| Worker 管理 | `ensure-worker.sh` + `kimi-trust.sh` | 138 |
| 任务派发 | `send-dev-task.sh` + `send-review.sh` + `send-review-round.sh` | 323 |
| 状态监控 | `poll-dev-local.sh` + `wait-dev-watchdog.sh` | 359 |
| CI/质量 | `run-checks.sh` + `check-ci.sh` | 301 |
| **合计** | **10 个脚本** | **~1355 行** |

加上模板 `controller-prompt.tpl.md`（124 行），整个技能的核心文件共 ~1480 行。

### 1.2 流程全貌

```
开卡 (start-card.sh)
  ├─ 创建 worktree
  ├─ 创建 controller 终端 (LLM 驱动)
  └─ 注入 prompt (124 行模板)

Controller 会话 (模板驱动, 7 步)
  ├─ 第 0 步: 读 /tmp/<card>/card-state.md 恢复状态
  ├─ 第 1 步: ensure-worker.sh → 创建 worker 终端
  ├─ 第 2 步: send-dev-task.sh → 发开发指令 + 启动看门狗
  ├─ 第 3 步: 结束回合，等 DEV_SIGNAL 唤醒
  │         └─ 唤醒 → poll-dev-local.sh --once 硬验证
  ├─ 第 4 步: Code Review (拉 issue → 对账 → 红线检查)
  ├─ 第 5 步: send-review.sh → 发修复意见 → 再等唤醒 → 再验证
  ├─ 第 6 步: 开 draft PR → check-ci.sh → 等 CI
  └─ 第 7 步: 转 ready → 汇报 → 等确认合并 → 清理
```

---

## 2. 问题分析

### 2.1 代码层面：重复代码散布

以下逻辑在多个脚本中**几乎原样重复**，改一处漏一处的风险极高：

| 重复块 | 出现位置 | 单次行数 |
|---|---|---|
| FORK_REPO 解析 (`git remote get-url origin \| sed`) | start-card, send-dev-task, send-review, check-ci | ~4 行 |
| 参数解析 while-case | 所有脚本 | 10~20 行 |
| card-state.md 读写 | send-dev-task, send-review, poll-dev-local, 模板 | ~8 行 |
| worker_alive 检测 | poll-dev-local, wait-dev-watchdog | ~3 行 |
| real_changes 函数 | poll-dev-local, wait-dev-watchdog | ~5 行（完全相同） |
| log_exists / 锚点判定 | poll-dev-local, wait-dev-watchdog | ~4 行（几乎相同） |
| start_watchdog 函数 | send-dev-task, send-review | ~40 行（几乎相同） |

**后果**：修一个判定规则（比如改 real_changes 的排除列表）要改 2~3 个地方，行为不一致就会产生隐蔽 bug。

### 2.2 代码层面：职责重叠

`send-dev-task.sh`（159 行）和 `send-review.sh`（157 行）干的本质是同一件事：

```
组装消息 → 发给 worker → 落盘 card-state → 启动看门狗
```

区别仅在于消息模板和 round 参数。两者各自独立实现了完整的 `write_state` + `start_watchdog`（各 ~40 行相同代码）。`send-review-round.sh` 只是 `send-review.sh` 的 7 行别名。

### 2.3 流程层面：用 LLM 做确定性的事

Controller prompt 模板 124 行中，大部分步骤是**确定性的机械操作**：

| 步骤 | 需要 LLM 智能？ | 实际操作 |
|---|---|---|
| 第 0 步：读状态恢复 | 否 | cat 文件 |
| 第 1 步：创建 worker | 否 | 调 ensure-worker.sh |
| 第 2 步：发开发指令 | 否 | 调 send-dev-task.sh |
| 第 3 步：等唤醒 + 验证 | 否 | 被消息唤醒 → 调 poll-dev-local.sh |
| **第 4 步：Code Review** | **是** | **对账 + 红线检查（唯一需要 LLM 的环节）** |
| 第 5 步：发修复意见 | 否 | 调 send-review.sh |
| 第 6 步：开 PR + 等 CI | 否 | 调 check-ci.sh |
| 第 7 步：转 ready | 部分 | 调 gh pr ready + 汇报 |

LLM 本质上在当一个"带智能的 bash 脚本"——按模板指令依次调脚本。真正的智能只在第 4 步 review 时用到。但为了让 LLM 精确执行这些机械步骤，需要：

- 124 行的模板，每步写死调哪个脚本、传什么参数
- 大量自检、防御逻辑（占模板 1/3 篇幅）
- 状态文件做 compaction 逃生门
- 看门狗做 LLM 忘发/慢发的兜底

**复杂度形成恶性循环**：LLM 不确定 → 加防御 → 防御本身增加复杂度 → LLM 更难理解 → 需要更多防御。

### 2.4 流程层面：通信链路过长

Worker 和 Controller 之间的通信路径：

```
Worker (LLM)
  → 手动执行 orca terminal send (写在话术里，依赖 LLM 记住)
  → Controller 终端收到消息
  → Controller 被唤醒
  → 跑 poll-dev-local.sh --once 硬验证
```

为了弥补"Worker 可能忘发通知"，又加了看门狗：

```
看门狗 (bash 后台)
  → 每 3 分钟检查 git ahead
  → 发现涨了 → 代发 DEV_SIGNAL
  → 5 分钟后校验 controller 是否真醒
  → 没醒 → 重发一次 → 再没醒 → 放弃
```

双通道（Worker 主动通知 + 看门狗兜底）增加了状态同步的心智负担，且 Worker 主动通知路径本身就是不可靠的（依赖 LLM 执行话术里的 bash 命令）。

### 2.5 流程层面：异常分支膨胀

模板的「异常处置」章节已占 ~15 行，覆盖：

- 脚本缺失
- WORKER_DEAD → 重建 → git pull → 重发
- send-review 退出码 2（失败但 worker 活着）→ 稍等重发
- DEV_FAKE → 重建 → 重发 → 再 DEV_FAKE → 停止汇报人工
- TIMEOUT → 汇报 → 重试 1 次
- review 轮数 > 5 → 停止汇报人工
- worker 重建后 → 更新状态

每个分支都是真实事故催生的，但堆在一起让 controller（和维护者）的心智模型极其复杂。

---

## 3. 必须保留的复杂度

以下复杂度每个都有真实事故或量化数据支撑，**不应简化**：

| 复杂度 | 原因 |
|---|---|
| FORK_REPO 显式 `-R` | #61 事故：裸 gh 解析到上游同号 issue/PR |
| DEV_FAKE 双判据（ahead > baseline + real_changes ≥ 1） | Worker 幻觉式假完成真实发生过 |
| 看门狗后台进程 | OPTIMIZATION.md 量化：轮询模式 2400 万 tok/卡 |
| 事件驱动（派发后结束回合） | 同上，compaction + 缓存前缀存活 |
| /tmp/card/ 状态外置 | Compaction 失忆是 CLI agent 固有问题 |
| per-card 目录隔离 | 多卡并行场景需要 |
| PTY 轮询回补（start-card） | Orca CLI terminal create 的 PTY 延迟返回 |
| PR 真实 CI 硬闸（非 commit checks） | GitHub CI 只在 pull_request 事件触发 |

---

## 4. 优化方案

### 4.1 代码层面：提取公共库 `_lib.sh`

**目标**：消除跨脚本重复，修一处即全局生效。

新建 `scripts/_lib.sh`，集中以下函数：

```bash
# scripts/_lib.sh —— 公共函数库（被所有脚本 source）

# ---- 仓库解析 ----
resolve_fork_repo() {
  local repo
  repo=$(git remote get-url origin 2>/dev/null \
    | sed -E 's#.*github\.com[:/]([^/]+)/([^/]+)#\1/\2#' \
    | sed 's#\.git$##')
  [[ "$repo" == *"/"* ]] || { echo "ERROR: 无法解析 fork 仓库" >&2; return 1; }
  echo "$repo"
}

# ---- 状态管理 ----
read_state()   { cat "/tmp/$1/card-state.md" 2>/dev/null; }
write_state()  { # card, step, handle, baseline, round, pr
  mkdir -p "/tmp/$1"
  cat > "/tmp/$1/card-state.md" <<EOF
card=$1 issue=#$(read_state_field "$1" issue)
当前步骤=$2
worker=$3 baseline_ahead=$4 round=$5
PR=${6:-无}
EOF
}

# ---- Worker 判定 ----
worker_alive() {
  [ -z "${1:-}" ] && return 0
  orca terminal list --json 2>/dev/null \
    | jq -e --arg h "$1" '.result.terminals[]? | select(.handle == $h)' >/dev/null 2>&1
}

# ---- Git 判定 ----
ahead_count() { git rev-list --count "origin/main..HEAD" 2>/dev/null || echo 0; }

real_changes() {
  git -c core.quotepath=false diff --name-only "origin/main...HEAD" 2>/dev/null \
    | grep -vE '^开发日志/|^docs/|\.(md|txt|rst|markdown)$' \
    | grep -cE '.' || true
}

# ---- 锚点检测 ----
log_anchor_exists() { # issue, card, round, anchor_text
  local lf="开发日志/$(date +%Y-%m-%d)/$1-$2.md"
  [ -f "$lf" ] && grep -Fxq -- "$4" "$lf" 2>/dev/null
}

# ---- 依赖检查 ----
require_deps() {
  for dep in "$@"; do
    command -v "$dep" >/dev/null 2>&1 || { echo "ERROR: 缺少依赖 $dep" >&2; return 1; }
  done
}
```

**预估收益**：每个脚本减少 30~60 行，总计消除 ~200 行重复代码。修 real_changes 的排除规则只需改一处。

### 4.2 代码层面：合并 send 脚本

将 `send-dev-task.sh` + `send-review.sh` + `send-review-round.sh`（323 行）合并为一个 `send-task.sh`（~180 行）：

```bash
# scripts/send-task.sh —— 统一任务派发入口
# --round 0 (默认) = 首轮开发（原 send-dev-task.sh）
# --round N (N≥1)  = 修复轮（原 send-review.sh）
# --file <md>       = 仅修复轮需要（意见文件）
# --extra "<text>"  = 可选补充要求

bash send-task.sh --issue 5 --card m1-fp-03 --worker term_xxx                    # 首轮
bash send-task.sh --issue 5 --card m1-fp-03 --worker term_xxx --round 1 --file /tmp/m1-fp-03/review-r1.md  # 修复
```

消息模板根据 `--round` 值自动选择。自校验逻辑（防首轮重发 / 防误用脚本）内置。`write_state` + `start_watchdog` 只写一份。保留 `send-dev-task.sh` 和 `send-review.sh` 作为薄 wrapper（兼容旧调用路径）：

```bash
# send-dev-task.sh → exec bash "$(dirname "$0")/send-task.sh" --round 0 "$@"
# send-review.sh   → exec bash "$(dirname "$0")/send-task.sh" "$@"
# send-review-round.sh → exec bash "$(dirname "$0")/send-task.sh" "$@"
```

**预估收益**：323 行 → ~180 行（含 wrapper），净减 ~140 行。消除 write_state / start_watchdog 重复。

### 4.3 代码层面：退役 poll-dev-local.sh 主循环模式

模板已全面切到 `--once` 模式，主循环模式（`while true; sleep 60; done`）仅向后兼容保留。

操作：
- 保留 `--once` 模式作为默认行为
- 删除主循环分支（~87 行）
- 如需向后兼容，加 deprecation warning 后下一版本彻底移除

**预估收益**：187 行 → ~100 行。

### 4.4 代码层面：异常检测下沉到脚本

当前 DEV_FAKE / WORKER_DEAD 等异常由 controller 模板的「异常处置」章节处理，需要 LLM 理解并执行分支逻辑。

将异常检测和初步处置下沉到 `poll-dev-local.sh`：

```bash
# poll-dev-local.sh --once 检测到 DEV_FAKE 时：
# 不再只返回退出码让 LLM 判断，而是直接处置
DEV_FAKE)
  # 自动重建 worker
  bash "$SCRIPT_DIR/ensure-worker.sh" --issue "$ISSUE" --card "$CARD" \
    --worker-agent "$WORKER_AGENT" --force
  # 返回新 worker handle
  echo "WORKER_REBUILT:<new_handle>"
  ;;

WORKER_DEAD)
  # 自动重建
  bash "$SCRIPT_DIR/ensure-worker.sh" --issue "$ISSUE" --card "$CARD" \
    --worker-agent "$WORKER_AGENT" --force
  echo "WORKER_REBUILT:<new_handle>"
  ;;
```

Controller 不再需要处理 WORKER_DEAD / DEV_FAKE / TIMEOUT 的分支——它只看到"开发完成了"或"worker 重建了，重新派发"。

**预估收益**：模板异常处置章节从 ~15 行缩减到 ~5 行，controller 心智负担大幅降低。

### 4.5 流程层面：砍掉 Worker 主动通知路径

当前双通道：Worker 手动执行 `orca terminal send` 通知 controller + 看门狗兜底。

Worker 主动通知路径的问题：
- 依赖 LLM 执行话术里的 bash 命令（不可靠）
- Worker 话术里要写 `CTRL_HANDLE=$(cat /tmp/${CARD}/controller.handle)` 这段复杂命令
- 看门狗已经在做完全相同的事（检查 ahead > baseline → 代发通知）

**简化**：从 Worker 话术中删除通知步骤，完全依赖看门狗。看门狗间隔从 180s 调整到 120s（唤醒延迟增加 ≤2 分钟，但看门狗本来就有 5 分钟的唤醒校验延迟，实际体验影响极小）。

```
# 旧流程
Worker 完成 → 手动发通知(不可靠) → Controller 醒 → 硬验证
                                         ↑ 看门狗兜底(可靠)

# 新流程
Worker 完成 → (什么都不用做) → 看门狗检测到 ahead 涨 → 代发通知 → Controller 醒 → 硬验证
```

**预估收益**：Worker 话术各减 4 行；消除"Worker 忘发"异常分支；看门狗成为唯一通知路径，心智模型更简单。

### 4.6 流程层面：Review 对账半自动化

当前第 4 步 Code Review 由 controller LLM 全量执行：拉 issue 全文 → 提取验收项 → 逐条对账 → 红线检查 → 写意见文件。这是整个流程中 LLM 消耗最大的环节。

**拆分方案**：

1. **机械对账脚本化**：新增 `auto-review.sh`，自动逐条检查 acceptance.md 中的验收项
   - 读 `/tmp/<card>/acceptance.md`（验收项清单）
   - 对每项执行 `git diff --stat` + 定点 `git diff` 定位实现
   - 输出 `/tmp/<card>/review-r<N>.md`（对账表：每项状态 + diff 位置）
   - 无法判断的项标记为 `?`（需 LLM 人工审查）

2. **LLM 只做智能审查**：controller 只需审查标记为 `?` 的项 + 代码质量 + 设计合理性

**预估收益**：Review 阶段 LLM 调用量减少 50%+（机械对账不再消耗 LLM token）。

### 4.7 流程层面：模板精简

综合以上优化，controller prompt 模板可从 124 行精简到 ~50 行：

**精简前**（7 步 + 异常处置 + 红线 + 落盘规则 + 唤醒例程）：124 行

**精简后**（3 步 + 简要异常说明）：

```
你是 issue N (card) 的 controller，职责：管 worker、review、开 PR。
代码由 worker 写，不由你写。机械操作一律调脚本。

【恢复】cat /tmp/<card>/card-state.md → 有步骤号则从中断处继续

【派发】ensure-worker → send-task → 结束回合等唤醒

【唤醒】被唤醒后：
  1. poll-dev-local.sh --once → DEV_DONE 则继续；WORKER_REBUILT 则重新派发
  2. Code Review（仅 DEV_DONE 后）→ auto-review.sh 机械对账 → LLM 审查标记 ? 的项
  3. 有问题 → send-task --round N --file review.md → 结束回合
  4. 无问题 → check-ci → 开 PR → 等 CI 全绿 → 转 ready → 汇报

【红线】不建子分支；不读 worker TUI；gh 一律 -R <fork>；draft PR 不自动 merge
```

**预估收益**：模板从 124 行 → ~50 行。LLM 理解成本大幅降低，compaction 后恢复更容易。

---

## 5. 实施路径

| 阶段 | 内容 | 预估减行数 | 风险 | 依赖 |
|---|---|---|---|---|
| **P1** | 提取 `_lib.sh`，消除跨脚本重复 | ~200 行 | 低（纯重构） | 无 |
| **P2** | 合并 send 脚本为 `send-task.sh` | ~140 行 | 中（模板调用路径同步改） | P1 |
| **P3** | 退役 poll 主循环模式 | ~87 行 | 低（模板已不用） | 无 |
| **P4** | 异常检测下沉到脚本层 | 模板减 ~10 行 | 中（需验证自动重建路径） | P1 |
| **P5** | 砍掉 Worker 主动通知路径 | 话术减 ~8 行 | 低（看门狗已覆盖） | P4 |
| **P6** | Review 对账半自动化 | 新增 ~100 行脚本 | 中（对账准确度取决于验收项格式） | P1 |
| **P7** | 模板精简到 ~50 行 | ~74 行 | 中（需同步改异常处置） | P4+P5+P6 |

**总计**：脚本层净减 ~350 行（1355 → ~1000），模板净减 ~74 行（124 → ~50）。

---

## 6. 验证方案

每个阶段完成后，开 1 张 medium 卡验证功能不回退：

| 检查项 | 通过标准 |
|---|---|
| 开卡 → worker 启动 → 开发完成 → review → PR CI 绿 → 合并 | 全流程跑通 |
| DEV_FAKE 拦截 | 故意提交空 commit，看门狗正确检测并重建 worker |
| Worker 重建 | kill worker 终端，看门狗正确通知并重建 |
| Compaction 恢复 | 手动触发 compaction，controller 从 card-state.md 恢复 |
| 多卡并行 | 同时开 2 张卡，状态隔离无冲突 |
| 脚本兼容 | 旧调用路径（send-dev-task.sh / send-review.sh）仍可用 |

---

## 7. 不在本次范围

| 排除项 | 原因 |
|---|---|
| 轮间接力（原 OPTIMIZATION.md Phase 3） | 待 Phase 1+2 数据验证后决策 |
| Controller 自触发 `/compact` | TUI 用户侧命令，agent 无法对自己发起 |
| Worker 侧大改 | 成本大头是读代码库的固有开销 |
| start-card.sh PTY 轮询逻辑 | Orca CLI 行为的必要 workaround |
| run-checks.sh | 可选手动工具，不属于主流程 |
