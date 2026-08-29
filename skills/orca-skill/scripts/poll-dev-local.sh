#!/usr/bin/env bash
# poll-dev-local.sh —— 一次性验证：检查 worker 是否完成开发/修复（controller 被唤醒后调用）
#
# 判据（双判据，防 worker 幻觉式假完成）：
#   (a) ahead = 当前分支相对 origin/main 的领先提交数（ahead > baseline ⇒ 已提交）
#   (b) real  = diff(origin/main...HEAD) 中排除纯文档后的业务文件改动数
#   组合：ahead>baseline 且 real>=1 ⇒ DEV_DONE；ahead>baseline 且 real==0 ⇒ DEV_FAKE
#
# 用法：
#   bash <skill-directory>/scripts/poll-dev-local.sh --worker <handle> --issue <n> --card <c> [--round <N>] <baseline>
#
# 退出码：
#   0  完成且有实质改动（DEV_DONE）或等待中（POLLING）
#   3  worker 终端已消失（WORKER_DEAD:<handle>）
#   4  假完成：已提交但 diff 无实质业务改动（DEV_FAKE）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_lib.sh"

WORKER=""
ISSUE=""
CARD=""
ROUND=0
BASELINE=0
ARGS=("$@")
i=0
while [ $i -lt ${#ARGS[@]} ]; do
  case "${ARGS[$i]}" in
    --worker) WORKER="${ARGS[$((i+1))]}"; i=$((i+2));;
    --issue)  ISSUE="${ARGS[$((i+1))]}"; i=$((i+2));;
    --card)   CARD="${ARGS[$((i+1))]}"; i=$((i+2));;
    --round)  ROUND="${ARGS[$((i+1))]}"; i=$((i+2));;
    *)
      if [[ "${ARGS[$i]}" =~ ^[0-9]+$ ]]; then BASELINE="${ARGS[$i]}"; fi
      i=$((i+1));;
  esac
done

if [[ -z "$ISSUE" || -z "$CARD" ]]; then
  echo "ERROR: 必须提供 --issue 和 --card" >&2
  exit 1
fi

ANCHOR=$(compute_anchor "$ROUND")
ahead=$(ahead_count)

# ---- worker 存活检测（不阻塞，仅警告） ----
if ! worker_alive "$WORKER"; then
  echo "WORKER_DEAD:${WORKER}" >&2
  exit 3
fi

# ---- 判定 ----
if [ "$ahead" -gt "$BASELINE" ]; then
  real=$(real_changes)
  if log_exists "$ISSUE" "$CARD" "$ANCHOR"; then
    if [ "$real" -ge 1 ]; then
      echo "DEV_DONE:ahead=${ahead}:real=${real}:baseline=${BASELINE}:round=${ROUND}"
      exit 0
    else
      echo "DEV_FAKE:ahead=${ahead}:real=0:baseline=${BASELINE}:round=${ROUND}" >&2
      echo "  [fake] 已提交 ${ahead} 个 commit，但相对 origin/main 无业务代码改动（仅日志/文档）。" >&2
      echo "  [fake] 这是 worker 幻觉式假完成：请勿信其文字汇报，按异常处置重建 worker 或汇报人工。" >&2
      exit 4
    fi
  fi
  # 已提交但缺日志锚点
  echo "POLLING:log_missing:ahead=${ahead}:baseline=${BASELINE}:round=${ROUND}"
  exit 0
fi

# 未提交
if log_exists "$ISSUE" "$CARD" "$ANCHOR"; then
  # 日志写了但没提交，催一次
  nudge_commit "$WORKER" "$ISSUE" "$CARD"
  echo "POLLING:log_ready_nudge:ahead=${ahead}:baseline=${BASELINE}:round=${ROUND}"
else
  echo "POLLING:waiting:ahead=${ahead}:baseline=${BASELINE}:round=${ROUND}"
fi
exit 0
