#!/usr/bin/env bash
# wait-dev-watchdog.sh —— worker 等待看门狗（事件驱动等待的慢路径兜底，零 LLM 成本）
# 由 send-dev-task.sh / send-review.sh 在发送成功后自动 nohup 启动，controller 无需手动调用。
#
# 职责（每 CHECK_INTERVAL=300s 一轮）：
#   1. ahead > baseline（worker 已提交）→ 代发 DEV_SIGNAL（防 worker 忘发）→ 校验 controller 已醒 → 退出
#   2. worker handle 消失 → 向 controller 发 WORKER_DEAD → 退出
#   3. 日志锚点已写但未提交 → nudge 催提交（窗口期最多 2 次、间隔 ≥15 分钟）
#   4. 超过 MAX_WAIT → 向 controller 发 TIMEOUT（超时复检出假完成则发 DEV_FAKE）→ 退出
#   通知只是门铃：controller 醒后自行跑 poll-dev-local.sh --once 硬验证，DEV_DONE/DEV_FAKE 判定不归本脚本。
#
# 泄漏防护：MAX_WAIT 到点自杀；pid 文件被换轮的新看门狗覆盖时自查退出；卡收尾由模板第 7 步 kill + rm。
#
# 用法：bash wait-dev-watchdog.sh --card <c> --issue <n> --round <n> --worker <handle> [baseline] [--max-wait <s>]
# 退出码：0 任一职责触发后正常结束；1 配置错误（缺 controller.handle 等）

set -uo pipefail

CARD=""
ISSUE=""
ROUND=0
WORKER=""
BASELINE=""
MAX_WAIT=21600   # 与 poll-dev-local.sh 默认一致（6h）

ARGS=("$@")
i=0
while [ $i -lt ${#ARGS[@]} ]; do
  case "${ARGS[$i]}" in
    --card)     CARD="${ARGS[$((i+1))]}"; i=$((i+2));;
    --issue)    ISSUE="${ARGS[$((i+1))]}"; i=$((i+2));;
    --round)    ROUND="${ARGS[$((i+1))]}"; i=$((i+2));;
    --worker)   WORKER="${ARGS[$((i+1))]}"; i=$((i+2));;
    --baseline) BASELINE="${ARGS[$((i+1))]}"; i=$((i+2));;
    --max-wait) MAX_WAIT="${ARGS[$((i+1))]}"; i=$((i+2));;
    *)
      if [[ "${ARGS[$i]}" =~ ^[0-9]+$ ]] && [ -z "$BASELINE" ]; then BASELINE="${ARGS[$i]}"; fi
      i=$((i+1));;
  esac
done

[[ "$CARD" =~ ^[a-z0-9-]+$ ]] && [[ "$ISSUE" =~ ^[0-9]+$ ]] && [ -n "$WORKER" ] || {
  echo "ERROR: --card/--issue/--worker 必填" >&2; exit 1; }

CHECK_INTERVAL=300    # 每 5 分钟检查
NUDGE_MAX=2           # 窗口期最多催 2 次
NUDGE_GAP=900         # 催提交间隔 ≥15 分钟
AWAKE_CHECK_DELAY=300 # 代发 5 分钟后校验 controller 是否真醒

STATE_DIR="/tmp/${CARD}"
PID_FILE="${STATE_DIR}/watchdog.pid"
CTRL_HANDLE_FILE="${STATE_DIR}/controller.handle"

CTRL_HANDLE=$(cat "$CTRL_HANDLE_FILE" 2>/dev/null)
if [ -z "$CTRL_HANDLE" ]; then
  echo "watchdog: 缺 ${CTRL_HANDLE_FILE}，无法通知 controller，退出（worker 自发通知仍是快路径）" >&2
  exit 1
fi

# baseline 未传则启动时实测（send 脚本同源实测并打印，正常路径下二者相等）
if [ -z "$BASELINE" ]; then
  BASELINE=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
fi

mkdir -p "$STATE_DIR"
echo $$ > "$PID_FILE"
trap 'echo "watchdog: 收到终止信号，退出"; exit 0' TERM INT
echo "watchdog: card=${CARD} round=${ROUND} worker=${WORKER} baseline=${BASELINE} max_wait=${MAX_WAIT}s ctrl=${CTRL_HANDLE} pid=$$"

# ---- 判定原语与 poll-dev-local.sh 同源（锚点整行匹配、日志路径跨午夜重算） ----
if [ "$ROUND" -eq 0 ]; then
  ANCHOR="## 开发任务（首轮）"
else
  ANCHOR="## Code Review #${ROUND}"
fi

log_exists() {
  local lf="开发日志/$(date +%Y-%m-%d)/${ISSUE}-${CARD}.md"
  [ -f "$lf" ] && grep -Fxq -- "$ANCHOR" "$lf" 2>/dev/null
}

worker_alive() {
  orca terminal list --json 2>/dev/null | jq -e --arg h "$WORKER" \
    '.result.terminals[]? | select(.handle == $h)' >/dev/null 2>&1
}

real_changes() {
  git -c core.quotepath=false diff --name-only "origin/main...HEAD" 2>/dev/null \
    | grep -vE '^开发日志/' \
    | grep -vE '^docs/' \
    | grep -vE '\.(md|txt|rst|markdown)$' \
    | grep -cE '.' || true
}

notify_ctrl() {
  orca terminal send --terminal "$CTRL_HANDLE" --text "$1" --enter --json >/dev/null 2>&1
}

# controller 醒后第一动作必是跑 --once 验证，屏幕出现其输出特征即视为已醒
ctrl_awake() {
  orca terminal read --terminal "$CTRL_HANDLE" --screen 2>/dev/null \
    | grep -qE 'DEV_DONE|DEV_FAKE|POLLING:|poll-dev-local'
}

nudge_commit() {
  orca terminal send --terminal "$WORKER" --text \
    "开发日志已写好但代码尚未提交。请立即执行：git add -A && git commit -m \"${ISSUE} ${CARD}: 开发/修复完成（含开发日志）\" && git push origin HEAD。完成后回复：已提交。" \
    --enter --json >/dev/null 2>&1 || true
  echo "watchdog: [nudge] 已催 worker(${WORKER}) 提交并推送"
}

still_mine() { # pid 文件被换轮的新看门狗覆盖 → 旧的自查退出
  [ "$(cat "$PID_FILE" 2>/dev/null)" = "$$" ]
}

dev_signal() {
  local head
  head=$(git rev-parse --short HEAD 2>/dev/null || echo "?")
  notify_ctrl "DEV_SIGNAL ${CARD} round=${ROUND} head=${head}"
  echo "watchdog: 已代发 DEV_SIGNAL round=${ROUND} head=${head}"
  sleep "$AWAKE_CHECK_DELAY"
  if still_mine && ! ctrl_awake; then
    echo "watchdog: controller 未见唤醒迹象，重发一次"
    notify_ctrl "DEV_SIGNAL ${CARD} round=${ROUND} head=${head}（重发）"
    sleep "$AWAKE_CHECK_DELAY"
    if still_mine && ! ctrl_awake; then
      echo "watchdog: controller 仍未醒，放弃重发（防注入风暴；等待 worker 自发通知或超时兜底）"
    fi
  fi
  exit 0
}

elapsed=0
nudged=0
last_nudge=0
while true; do
  still_mine || { echo "watchdog: 已被新看门狗替换（换轮），退出"; exit 0; }
  sleep "$CHECK_INTERVAL"
  elapsed=$((elapsed + CHECK_INTERVAL))
  still_mine || { echo "watchdog: 已被新看门狗替换（换轮），退出"; exit 0; }

  ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
  if [ "$ahead" -gt "$BASELINE" ]; then
    dev_signal
  fi

  if ! worker_alive; then
    notify_ctrl "WORKER_DEAD ${CARD} round=${ROUND} worker=${WORKER}"
    echo "watchdog: worker 已消失，已通知 controller"
    exit 0
  fi

  if log_exists \
     && [ "$nudged" -lt "$NUDGE_MAX" ] \
     && [ $((elapsed - last_nudge)) -ge "$NUDGE_GAP" ]; then
    nudge_commit
    nudged=$((nudged + 1))
    last_nudge=$elapsed
  fi

  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    # 超时复检：ahead 已涨但无业务改动 → 归为假完成而非单纯超时（与 poll-dev-local 口径一致）
    real=$(real_changes)
    if [ "$real" -eq 0 ]; then
      notify_ctrl "DEV_FAKE ${CARD} round=${ROUND} ahead=${ahead} real=0（超时复检：仅日志/文档提交）"
    else
      notify_ctrl "TIMEOUT ${CARD} round=${ROUND} elapsed=${elapsed}s baseline=${BASELINE} ahead=${ahead}"
    fi
    echo "watchdog: 超时（${elapsed}s），已通知 controller，退出"
    exit 0
  fi
done
