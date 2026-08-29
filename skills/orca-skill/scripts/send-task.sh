#!/usr/bin/env bash
# send-task.sh —— 统一任务派发入口（合并 send-dev-task.sh + send-review.sh）
# --round 0 (默认) = 首轮开发指令（原 send-dev-task.sh）
# --round N (N≥1)  = 修复轮意见（原 send-review.sh）
#
# 用法：
#   bash ${SCRIPT_DIR}/send-task.sh --issue <n> --card <c> --worker <handle> [--extra "<补充>"]
#   bash ${SCRIPT_DIR}/send-task.sh --issue <n> --card <c> --worker <handle> --round <N> --file <意见md>
#
# 输出：TASK_SENT:<issue>-<card> round=<N> -> <handle>
# 退出码：0 成功；1 参数错误；2 发送失败；3 worker 已失效

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_lib.sh"

ISSUE=""
CARD=""
HANDLE=""
ROUND=0
FILE=""
EXTRA=""

while [ $# -gt 0 ]; do
  case "$1" in
    --issue)  ISSUE="$2"; shift 2;;
    --card)   CARD="$2"; shift 2;;
    --worker) HANDLE="$2"; shift 2;;
    --round)  ROUND="$2"; shift 2;;
    --file)   FILE="$2"; shift 2;;
    --extra)  EXTRA="$2"; shift 2;;
    *) echo "ERROR: 未知参数 $1" >&2; exit 1;;
  esac
done

if [[ ! "$ISSUE" =~ ^[0-9]+$ ]] || [[ ! "$CARD" =~ ^[a-z0-9-]+$ ]] || [ -z "$HANDLE" ]; then
  echo "ERROR: --issue/--card/--worker 均必填" >&2
  exit 1
fi

if [ "$ROUND" -ge 1 ] && [ -z "$FILE" ]; then
  echo "ERROR: --round >= 1 时 --file 必填（意见文件路径）" >&2
  exit 1
fi

if [ "$ROUND" -ge 1 ] && [ ! -f "$FILE" ]; then
  echo "ERROR: 意见文件不存在：$FILE" >&2
  exit 2
fi

ANCHOR=$(compute_anchor "$ROUND")

# ---- 自校验 ----
ANCHOR_FILE=$(ls 开发日志/*/${ISSUE}-${CARD}.md 2>/dev/null | head -1)

if [ "$ROUND" -eq 0 ]; then
  # 首轮：检测到首轮锚点则禁止重发
  if [ -n "$ANCHOR_FILE" ] && grep -q "## 开发任务（首轮）" "$ANCHOR_FILE"; then
    echo "ERROR: 检测到本卡首轮开发日志已存在（${ANCHOR_FILE}），当前应为 review 修复轮，禁止重发首轮。" >&2
    echo "       请改用：bash ${SCRIPT_DIR}/send-task.sh --issue ${ISSUE} --card ${CARD} --round <N> --worker ${HANDLE} --file <意见md>" >&2
    exit 1
  fi
else
  # 修复轮：未检测到首轮锚点则禁止发修复
  if [ -z "$ANCHOR_FILE" ] || ! grep -q "## 开发任务（首轮）" "$ANCHOR_FILE"; then
    echo "ERROR: 未检测到本卡首轮开发日志锚点，禁止发 review 修复轮。" >&2
    echo "       请先确认 worker 首轮开发已完成，或改用 --round 0 发首轮。" >&2
    exit 2
  fi
fi

# ---- 组装消息 ----
if [ "$ROUND" -eq 0 ]; then
  # 首轮：拉取 issue 标题与正文
  FORK_REPO=$(resolve_fork_repo) || { echo "ERROR: 无法从 origin remote 解析 fork 仓库" >&2; exit 1; }
  ISSUE_TITLE=$(gh issue view "${ISSUE}" -R "$FORK_REPO" --json title -q .title 2>/dev/null || echo "")
  ISSUE_BODY=$(gh issue view "${ISSUE}" -R "$FORK_REPO" --json body -q .body 2>/dev/null || echo "")
  if [ -z "$ISSUE_BODY" ]; then
    echo "ERROR: 无法获取 ${FORK_REPO} issue #${ISSUE} 正文（gh issue view 失败或网络问题）" >&2
    exit 1
  fi
  # 身份防御：同号若为 PR 则禁止
  if gh pr view "${ISSUE}" -R "$FORK_REPO" >/dev/null 2>&1; then
    echo "ERROR: ${FORK_REPO} #${ISSUE} 是 PR 不是 issue（编号碰撞），禁止作为开发任务发送" >&2
    exit 1
  fi
  # 缓存 issue 全文供 controller 对账复用
  mkdir -p "/tmp/${CARD}"
  printf 'TITLE: %s\n\nBODY:\n%s\n' "${ISSUE_TITLE}" "${ISSUE_BODY}" > "/tmp/${CARD}/issue-body.md"

  MSG="【开发任务 issue #${ISSUE} / ${CARD}】
任务名称：${ISSUE_TITLE}
以下为本 issue 的完整需求原文（须逐条对照实现，不得遗漏）：
==== ISSUE 需求原文开始 ====
${ISSUE_BODY}
==== ISSUE 需求原文结束 ====

实现要求：
1. 按上方需求原文逐项实现，尤其覆盖 issue 范围/锚点文档列明的所有验收项与交付物。
2. 完成后写开发日志：开发日志/$(date +%Y-%m-%d)/${ISSUE}-${CARD}.md（目录不存在则创建）。
   首行锚点必须是独立完整的一行：「## 开发任务（首轮）」，其下写：改动范围 / 改动概要 / commit 短哈希。
3. git add -A && git commit -m \"${ISSUE} ${CARD}: 开发完成（含开发日志）\" && git push origin HEAD
4. 只有同时满足 (1) git diff --stat origin/main...HEAD 含业务代码改动 且 (2) 开发日志已 commit，才允许回复：「开发完成，等待 review」。
5. 禁止裸 gh：确需用 gh 时必须显式加 -R <fork仓库>。
"
  [ -n "$EXTRA" ] && MSG="${MSG}

【补充要求】
${EXTRA}"

  STEP=3  # 落盘步骤
else
  # 修复轮
  REVIEW_BODY=$(cat "$FILE")
  MSG="【Code Review #${ROUND} 修复任务 issue #${ISSUE} / ${CARD}】
以下是需要逐条修复的 review 意见：

${REVIEW_BODY}

【修复要求】
1. 逐条修复上述意见。
2. 追加开发日志（开发日志/$(date +%Y-%m-%d)/${ISSUE}-${CARD}.md）：
   锚点必须是独立完整的一行：「## Code Review #${ROUND}」，其下写：本轮问题 / 修复方式 / commit 短哈希。
3. git add -A && git commit -m \"${ISSUE} ${CARD}: review #${ROUND} 修复\" && git push origin HEAD
4. 完成后只回复：「review #${ROUND} 修复完成，等待复核」。
5. 禁止裸 gh：确需用 gh 时必须显式加 -R <fork仓库>。
"
  STEP=4  # 落盘步骤
fi

# ---- 发送 + 重试 ----
BASELINE_AHEAD=$(ahead_count)

_send() {
  orca terminal send --terminal "$HANDLE" --text "$MSG" --enter --json >/dev/null 2>&1
}

if _send; then
  echo "TASK_SENT:${ISSUE}-${CARD} round=${ROUND} -> ${HANDLE}"
  write_card_state "$CARD" "$ISSUE" "$STEP" "$HANDLE" "$BASELINE_AHEAD" "$ROUND"
  echo "  [state] card-state.md 已落盘（步骤 ${STEP}，等待 DEV_SIGNAL）"
  start_watchdog "$CARD" "$ISSUE" "$ROUND" "$HANDLE" "$BASELINE_AHEAD" "$SCRIPT_DIR"
  exit 0
fi

# 重试：先判断 worker 是否还活着
if worker_alive "$HANDLE"; then
  sleep 3
  if _send; then
    echo "TASK_SENT:${ISSUE}-${CARD} round=${ROUND} -> ${HANDLE}（重试成功）"
    write_card_state "$CARD" "$ISSUE" "$STEP" "$HANDLE" "$BASELINE_AHEAD" "$ROUND"
    echo "  [state] card-state.md 已落盘（步骤 ${STEP}，等待 DEV_SIGNAL）"
    start_watchdog "$CARD" "$ISSUE" "$ROUND" "$HANDLE" "$BASELINE_AHEAD" "$SCRIPT_DIR"
    exit 0
  fi
  echo "ERROR: 发送失败但 worker ${HANDLE} 仍在运行（可能 TUI 忙）。请稍后重发本命令。" >&2
  exit 2
fi

echo "ERROR: worker ${HANDLE} 已失效。请先 ensure-worker.sh --force 重建，并 git pull 恢复分支后再重发。" >&2
exit 3
