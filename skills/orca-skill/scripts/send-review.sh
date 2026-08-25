#!/usr/bin/env bash
# send-review.sh —— 向 worker 发第 N 轮 review 修复意见（固定话术框架 + 意见文件内容）
# 话术要点来自 方案/Orca两层编排闭环流程-v2.md §7（内置在脚本里，controller 无需记忆）
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
1. 逐条修复上述意见；全部改完后本地检查链必须全绿：ruff check && mypy app && pytest。
2. 追加开发日志（开发日志/$(date +%Y-%m-%d)/${ISSUE}-${CARD}.md）：
   锚点必须是独立完整的一行：「## Code Review #${ROUND}」，其下写：本轮问题 / 修复方式 / commit 短哈希。
3. git add -A && git commit -m \"${ISSUE} ${CARD}: review #${ROUND} 修复\" && git push origin HEAD
4. 完成后只回复：「review #${ROUND} 修复完成，等待复核」。"

_send() {
  orca terminal send --terminal "$HANDLE" --text "$MSG" --enter --json >/dev/null 2>&1
}

if _send; then
  echo "REVIEW_SENT:${ISSUE}-${CARD} round=${ROUND} -> ${HANDLE}"
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
    exit 0
  fi
  echo "ERROR: 发送失败但 worker ${HANDLE} 仍在运行（可能 TUI 忙）。请稍后重发本命令，勿 --force 重建。" >&2
  exit 2
fi

# worker 真失效：提示重建，并强调重建后先 git pull 恢复分支再重发
echo "ERROR: worker ${HANDLE} 已失效（不存在或已退出）。请先 ensure-worker.sh --force 重建，并让新 worker 先 git pull origin HEAD 恢复分支进度后再重发本命令。" >&2
exit 3
