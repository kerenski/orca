#!/usr/bin/env bash
# send-review.sh —— 向 worker 发第 N 轮 review 修复意见（固定话术框架 + 意见文件内容）
# 话术要点来自 docs/Orca两层编排闭环流程-v2.md §7（内置在脚本里，controller 无需记忆）
#
# 用法：bash $HOME/.orca-skill/scripts/send-review.sh --issue <n> --card <c> --round <N> --worker <handle> --file <意见md>
# 输出：REVIEW_SENT:<issue>-<card> round=<N> -> <handle>
# 退出码：0 成功；1 参数错误；2 意见文件不存在或发送失败

set -uo pipefail

ISSUE=""
CARD=""
ROUND=""
HANDLE=""
FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --issue)  ISSUE="$2"; shift 2;;
    --card)   CARD="$2"; shift 2;;
    --round)  ROUND="$2"; shift 2;;
    --worker) HANDLE="$2"; shift 2;;
    --file)   FILE="$2"; shift 2;;
    *) echo "ERROR: 未知参数 $1" >&2; exit 1;;
  esac
done

if [[ ! "$ISSUE" =~ ^[0-9]+$ ]] || [[ ! "$CARD" =~ ^[a-z0-9-]+$ ]] || [[ ! "$ROUND" =~ ^[0-9]+$ ]] || [ -z "$HANDLE" ] || [ -z "$FILE" ]; then
  echo "ERROR: --issue/--card/--round/--worker/--file 均必填" >&2
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "ERROR: 意见文件不存在：$FILE" >&2
  exit 2
fi

# 自校验（防首轮未完成就被发 review）：仅校验"当前 issue+card"的日志文件含首轮锚点，
# 不扫其他 issue 的日志（避免误判 #38 等遗留日志为本卡已完成首轮）。
ANCHOR_FILE=$(ls 开发日志/*/${ISSUE}-${CARD}.md 2>/dev/null | head -1)
if [ -z "$ANCHOR_FILE" ] || ! grep -q "## 开发任务（首轮）" "$ANCHOR_FILE"; then
  echo "ERROR: 未检测到本卡首轮开发日志锚点（开发日志/*/${ISSUE}-${CARD}.md 中无「## 开发任务（首轮）」），禁止发 review。" >&2
  echo "       请先确认 worker 首轮开发已完成（含开发日志），或改用 send-dev-task.sh 发首轮。" >&2
  exit 2
fi

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
5. push 成功后必须立即回敲 controller（这是 controller 结束回合后被唤醒的唯一快路径；看门狗最多延迟 5 分钟代发兜底）：
   CTRL_HANDLE=$(cat /tmp/${CARD}/controller.handle 2>/dev/null)
   [ -n \"\$CTRL_HANDLE\" ] && orca terminal send --terminal \"\$CTRL_HANDLE\" \
     --text \"DEV_SIGNAL ${CARD} round=${ROUND} head=\$(git rev-parse --short HEAD)\" --enter
   （文件不存在或发送失败则跳过，继续完成自身收尾即可）"

_send() {
  orca terminal send --terminal "$HANDLE" --text "$MSG" --enter --json >/dev/null 2>&1
}

# baseline 在 send 之前实测（此刻 worker 尚未收到本轮意见，ahead 稳定），显式传给看门狗与输出，避免 send 后双实测 race
BASELINE_AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)

WATCHDOG="$HOME/.orca-skill/scripts/wait-dev-watchdog.sh"
STATE_DIR="/tmp/${CARD}"

# 落盘自动化：send 成功后脚本已知全部字段，直接写 card-state.md（controller 无需再手写本轮落盘，省一个调用轮次）
write_state() {
  cat > "${STATE_DIR}/card-state.md" <<EOF
card=${CARD} issue=#${ISSUE}
当前步骤=${1}
worker=${HANDLE} baseline_ahead=${BASELINE_AHEAD} round=${2}
PR=${3:-无}
EOF
}

start_watchdog() {
  [ -f "$WATCHDOG" ] || { echo "  [watchdog] 脚本缺失 ${WATCHDOG}，跳过（controller 需自行轮询兜底）" >&2; return; }
  mkdir -p "$STATE_DIR"
  # 换轮：杀掉旧看门狗（其 baseline/round 已过时；TERM 延迟时旧进程靠 pid 自查退出）
  if [ -f "${STATE_DIR}/watchdog.pid" ]; then
    kill "$(cat "${STATE_DIR}/watchdog.pid" 2>/dev/null)" 2>/dev/null || true
    rm -f "${STATE_DIR}/watchdog.pid"
  fi
  nohup bash "$WATCHDOG" --card "$CARD" --issue "$ISSUE" --round "$ROUND" --worker "$HANDLE" --baseline "$BASELINE_AHEAD" \
    >>"${STATE_DIR}/watchdog.log" 2>&1 &
  echo "  [watchdog] 已启动 baseline=${BASELINE_AHEAD}（兜底代发 DEV_SIGNAL；controller 落盘 card-state 后即可结束回合）"
}

if _send; then
  echo "REVIEW_SENT:${ISSUE}-${CARD} round=${ROUND} -> ${HANDLE}"
  write_state 4 "$ROUND"
  echo "  [state] card-state.md 已落盘（步骤 4，等待 DEV_SIGNAL）"
  start_watchdog
  exit 0
fi

# send 失败：先判断 worker handle 是否还活着，避免误把「偶发发送失败」当成「handle 失效」而强制重建
ALIVE=$(orca terminal list --json 2>/dev/null | jq -r --arg h "$HANDLE" \
  '[.result.terminals[]? | select(.handle == $h)] | length')

if [ "$ALIVE" -gt 0 ]; then
  # worker 仍在：可能 TUI 忙/未就绪，重试一次
  sleep 3
  if _send; then
    echo "REVIEW_SENT:${ISSUE}-${CARD} round=${ROUND} -> ${HANDLE}（重试成功）"
    write_state 4 "$ROUND"
    echo "  [state] card-state.md 已落盘（步骤 4，等待 DEV_SIGNAL）"
    start_watchdog
    exit 0
  fi
  echo "ERROR: 发送失败但 worker ${HANDLE} 仍在运行（可能 TUI 忙）。请稍后重发本命令，勿 --force 重建。" >&2
  exit 2
fi

# worker 真失效：提示重建，并强调重建后先 git pull 恢复分支再重发
echo "ERROR: worker ${HANDLE} 已失效（不存在或已退出）。请先 ensure-worker.sh --force 重建，并让新 worker 先 git pull origin HEAD 恢复分支进度后再重发本命令。" >&2
exit 3
