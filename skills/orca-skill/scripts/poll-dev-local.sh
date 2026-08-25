#!/usr/bin/env bash
# poll-dev-local.sh —— 同 worktree 内监控开发/修复完成（controller 与 worker 共用同一分支）
# v2 增强三项：① WORKER_DEAD 存活检测 ② 跨午夜重算日期 ③ 锚点精确整行匹配
#
# 完成信号（以开发日志为 sentinel + 实质改动硬判据）：
#   worker 每完成一轮任务（首轮开发 / 第 N 轮修复）后，自己写/追加开发日志：
#     开发日志/<日期>/<issue>-<card>.md
#   首轮完成任务写入锚点：  "## 开发任务（首轮）"
#   第 N 轮修复追加锚点：    "## Code Review #N"   （N 从 1 递增，保证唯一）
#   controller 轮询检测对应锚点（整行精确匹配）是否存在；存在即 worker 自认完成。
#
# 提交确认 + 实质改动校验（双判据，防 worker 幻觉式假完成）：
#   检测到 sentinel 锚点后，检查：
#     (a) ahead = 当前分支相对 origin/main 的领先提交数（ahead > baseline ⇒ 已提交）
#     (b) real  = diff(origin/main...HEAD) 中排除纯文档(开发日志/*.md/*.txt 等)后的业务文件改动数
#   组合判定：
#     ahead>baseline 且 real>=1  ⇒ DEV_DONE（确有实质代码改动）
#     ahead>baseline 且 real==0  ⇒ DEV_FAKE（只提交了日志/文档，未写实际代码，判假完成）
#     ahead==baseline            ⇒ 日志写了但没提交，自动催提交后继续等
#   注：worker 自报"N 文件改动/已 push"不可信，必须以 git diff 事实为准。
#
# 存活检测（v2）：
#   每轮先校验 --worker handle 仍在 orca terminal list 中；消失 → WORKER_DEAD，退出码 3
#
# controller 调用方式：
#   1) 阻塞等待首轮开发完成：
#        bash skills/orca-skill/scripts/poll-dev-local.sh --worker <handle> --issue <n> --card <c>
#   2) 等待第 N 轮修复完成（baseline 传上一轮结束时的 ahead；round 传当前修复轮次）：
#        bash skills/orca-skill/scripts/poll-dev-local.sh --worker <handle> --issue <n> --card <c> --round <N> <baseline>
#   3) 仅查一次状态（不做存活检测、不催提交）：
#        bash skills/orca-skill/scripts/poll-dev-local.sh --worker <handle> --issue <n> --card <c> [--round <N>] <baseline> --once
#
# 退出码：
#   0  开发/修复完成且确有实质改动（DEV_DONE:ahead=...:real=...:baseline=...）
#   2  超过 MAX_WAIT 仍无完成信号（且非假完成）
#   3  worker 终端已消失（WORKER_DEAD:<handle>）
#   4  假完成：已提交但 diff 无实质业务改动（DEV_FAKE:ahead=...:real=0）

set -uo pipefail

WORKER=""
ISSUE=""
CARD=""
ROUND=0          # 0 表示首轮开发；>=1 表示第 N 轮修复
BASELINE=0
ONCE=0
ARGS=("$@")
i=0
while [ $i -lt ${#ARGS[@]} ]; do
  case "${ARGS[$i]}" in
    --worker) WORKER="${ARGS[$((i+1))]}"; i=$((i+2));;
    --issue)  ISSUE="${ARGS[$((i+1))]}"; i=$((i+2));;
    --card)   CARD="${ARGS[$((i+1))]}"; i=$((i+2));;
    --round)  ROUND="${ARGS[$((i+1))]}"; i=$((i+2));;
    --once)   ONCE=1; i=$((i+1));;
    *)
      if [[ "${ARGS[$i]}" =~ ^[0-9]+$ ]]; then BASELINE="${ARGS[$i]}"; fi
      i=$((i+1));;
  esac
done

INTERVAL=60
MAX_WAIT=21600

if [[ -z "$ISSUE" || -z "$CARD" ]]; then
  echo "ERROR: 必须提供 --issue 和 --card" >&2
  exit 1
fi

BRANCH=$(git branch --show-current)
if [[ -z "$BRANCH" ]]; then
  echo "ERROR: 无法获取当前分支" >&2
  exit 1
fi

# 本轮要检测的锚点（整行内容，用 grep -Fxq 精确整行匹配，防 #1 误匹配 #10）
if [ "$ROUND" -eq 0 ]; then
  ANCHOR="## 开发任务（首轮）"
else
  ANCHOR="## Code Review #${ROUND}"
fi

ahead_count() {
  git rev-list --count "origin/main..HEAD" 2>/dev/null || echo 0
}

# 实质业务改动数：排除纯文档（开发日志目录、*.md、*.txt 等）后的 diff 改动文件数
# 只数文件、不数行，避免大文档误判；业务代码(.py/.ts/.js 等)计入
# 注意：-c core.quotepath=false 关闭中文路径的引号包裹，否则 grep 锚点 ^开发日志/ 会失配
real_changes() {
  git -c core.quotepath=false diff --name-only "origin/main...HEAD" 2>/dev/null \
    | grep -vE '^开发日志/' \
    | grep -vE '^docs/' \
    | grep -vE '\.(md|txt|rst|markdown)$' \
    | grep -cE '.' || true
}

# v2 增强①：worker 存活检测（handle 是否仍在 terminal list）
worker_alive() {
  [ -z "$WORKER" ] && return 0
  orca terminal list --json 2>/dev/null | jq -e --arg h "$WORKER" \
    '.result.terminals[]? | select(.handle == $h)' >/dev/null 2>&1
}

# v2 增强②：日志路径每轮重算（跨午夜不失效）
log_file_path() {
  echo "开发日志/$(date +%Y-%m-%d)/${ISSUE}-${CARD}.md"
}

# v2 增强③：锚点整行精确匹配（行首 ## 起的完整行）
log_exists() {
  local lf
  lf=$(log_file_path)
  [ -f "$lf" ] || return 1
  grep -Fxq -- "$ANCHOR" "$lf" 2>/dev/null
}

nudge_commit() {
  # 日志已写但没提交：催 worker 提交并推送（日志需随 commit 一起提交）
  [ -z "$WORKER" ] && return 0
  orca terminal send --terminal "$WORKER" --text \
    "开发日志已写好但代码尚未提交。请立即执行：git add -A && git commit -m \"${ISSUE} ${CARD}: 开发/修复完成（含开发日志）\" && git push origin ${BRANCH}。完成后回复：已提交。" \
    --enter --json >/dev/null 2>&1 || true
  echo "  [nudge] 已催 worker($WORKER) 提交并推送（含开发日志）"
}

elapsed=0
while true; do
  ahead=$(ahead_count)
  if [ "$ahead" -gt "$BASELINE" ]; then
    real=$(real_changes)
    if [ "$real" -ge 1 ]; then
      echo "DEV_DONE:ahead=${ahead}:real=${real}:baseline=${BASELINE}:round=${ROUND}"
      exit 0
    else
      # 已提交但 diff 无实质业务改动：判假完成（只提交了日志/文档）
      echo "DEV_FAKE:ahead=${ahead}:real=0:baseline=${BASELINE}:round=${ROUND}" >&2
      echo "  [fake] 已提交 ${ahead} 个 commit，但相对 origin/main 无业务代码改动（仅日志/文档）。" >&2
      echo "  [fake] 这是 worker 幻觉式假完成：请勿信其文字汇报，按异常处置重建 worker 或汇报人工。" >&2
      exit 4
    fi
  fi

  if [ "$ONCE" -eq 1 ]; then
    if log_exists; then
      real=$(real_changes)
      echo "POLLING:log_ready:ahead=${ahead}:real=${real}:baseline=${BASELINE}:round=${ROUND}"
    else
      echo "POLLING:waiting:ahead=${ahead}:baseline=${BASELINE}:round=${ROUND}"
    fi
    exit 0
  fi

  # v2 增强①：先验 worker 存活，死终端不空等
  if ! worker_alive; then
    echo "WORKER_DEAD:${WORKER}" >&2
    exit 3
  fi

  # 未提交：若日志 sentinel 已出现则催提交
  if log_exists; then
    echo "  [detect] 日志锚点已出现（${ANCHOR}）但 ahead=${ahead} (baseline=${BASELINE})，未提交"
    nudge_commit
  fi

  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    # 超时前再做一次实质改动判定：若已提交但无业务改动，归为假完成而非单纯超时
    if [ "$ahead" -gt "$BASELINE" ]; then
      real=$(real_changes)
      if [ "$real" -eq 0 ]; then
        echo "DEV_FAKE:ahead=${ahead}:real=0:baseline=${BASELINE}:round=${ROUND}" >&2
        echo "  [fake] 超时但已提交 ${ahead} 个 commit，却无业务代码改动（仅日志/文档），判假完成。" >&2
        exit 4
      fi
    fi
    echo "TIMEOUT: 分支 ${BRANCH} 超过 ${MAX_WAIT}s 无完成信号（期望锚点: ${ANCHOR}）" >&2
    exit 2
  fi
done
