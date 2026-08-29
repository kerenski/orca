#!/usr/bin/env bash
# ensure-worker.sh —— 幂等创建/复用 worker terminal（controller 在 worktree 内调用）
# 含：同名复用、--force 重建、kimi 预信任、创建后等待就绪
#
# 用法（在卡的 worktree 内执行，controller 会话的工作目录即 worktree）：
#   bash <skill-directory>/scripts/ensure-worker.sh --issue <n> --card <c> --worker-agent "<id[ 参数]>" [--force]
#
# 输出：WORKER_READY:<handle>（controller 从中取 handle）
# 退出码：0 成功/复用；1 错误

set -euo pipefail

ISSUE=""
CARD=""
WORKER_AGENT=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --issue)       ISSUE="$2"; shift 2;;
    --card)        CARD="$2"; shift 2;;
    --worker-agent) WORKER_AGENT="$2"; shift 2;;
    --force)       FORCE=1; shift;;
    *) echo "ERROR: 未知参数 $1" >&2; exit 1;;
  esac
done

if [[ ! "$ISSUE" =~ ^[0-9]+$ ]] || [[ ! "$CARD" =~ ^[a-z0-9-]+$ ]] || [ -z "$WORKER_AGENT" ]; then
  echo "ERROR: --issue/--card/--worker-agent 均必填（worker-agent 形如 \"opencode\" 或 \"kimi --model xxx\"）" >&2
  exit 1
fi

command -v orca >/dev/null 2>&1 || { echo "ERROR: 缺少依赖 orca" >&2; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "ERROR: 缺少依赖 jq" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- 状态目录（Phase 2b 迁移）：handle/seq 统一在 /tmp/<card>/ 下，与 card-state.md 同处，收尾 rm -rf 一次清干净 ----
STATE_DIR="/tmp/${CARD}"
mkdir -p "$STATE_DIR"
LEGACY_HANDLE_FILE="/tmp/orca-worker-${CARD}.handle"
LEGACY_SEQ_FILE="/tmp/orca-worker-${CARD}.seq"

# 读取时兼容旧路径（在跑的旧卡不中断）；写入一律新路径，读到即完成迁移
effective_handle_file() {
  if [ -f "${STATE_DIR}/worker.handle" ]; then echo "${STATE_DIR}/worker.handle"
  elif [ -f "$LEGACY_HANDLE_FILE" ]; then echo "$LEGACY_HANDLE_FILE"
  else echo "${STATE_DIR}/worker.handle"; fi
}
HANDLE_FILE=$(effective_handle_file)

# ---- 幂等：按持久化 handle 文件复用（不能用标题匹配——claude/codex 启动后会把
#      terminal 标题覆盖成自身名，导致按标题永远查不到、每轮都新建 worker） ----

if [ "$FORCE" -eq 0 ] && [ -f "$HANDLE_FILE" ]; then
  SAVED=$(cat "$HANDLE_FILE")
  if orca terminal list --json 2>/dev/null | jq -e --arg h "$SAVED" \
      '.result.terminals[]? | select(.handle == $h)' >/dev/null 2>&1; then
    echo "$SAVED" > "${STATE_DIR}/worker.handle"   # 旧路径读到则迁移落盘新路径
    echo "WORKER_READY:${SAVED}（复用已记录 worker，handle 文件 ${STATE_DIR}/worker.handle）"
    exit 0
  fi
  echo "  [warn] 记录中的 worker ${SAVED} 已失效，重建"
fi

# --force：关闭已记录的旧 worker
if [ "$FORCE" -eq 1 ] && [ -f "$HANDLE_FILE" ]; then
  OLD=$(cat "$HANDLE_FILE")
  echo "  [force] 关闭旧 worker 终端 ${OLD}"
  orca terminal close --terminal "$OLD" --tab --json >/dev/null 2>&1 || true
  sleep 2
fi

# ---- kimi 预信任（kimi 首启新 worktree 弹 Trust 确认，无人值守会退出） ----
if [[ "$WORKER_AGENT" == kimi* ]]; then
  echo "  [kimi] 预信任当前 worktree：$(pwd)"
  bash "${SCRIPT_DIR}/kimi-trust.sh" "$(pwd)"
fi

# ---- 生成带序号的 worker 标题（仅真正新建时递增；复用分支已提前 exit 0，不会执行到这里） ----
if [ -f "${STATE_DIR}/worker.seq" ]; then
  SEQ=$(($(cat "${STATE_DIR}/worker.seq") + 1))
elif [ -f "$LEGACY_SEQ_FILE" ]; then
  SEQ=$(($(cat "$LEGACY_SEQ_FILE") + 1))   # 旧序号接续，避免标题序号回退
else
  SEQ=1
fi
echo "$SEQ" > "${STATE_DIR}/worker.seq"
TITLE="#${ISSUE}-${CARD}-worker-${SEQ}"

# ---- 创建 worker 终端（当前目录即 worktree，用 active 选择器） ----
echo "  [worker] 启动 worker：${WORKER_AGENT}"
RESP=$(orca terminal create --worktree active \
  --command "$WORKER_AGENT" --title "$TITLE" --json)
HANDLE=$(echo "$RESP" | jq -r '.result.terminal.handle // .result.handle // empty')
if [ -z "$HANDLE" ] || [ "$HANDLE" = "null" ]; then
  echo "ERROR: 解析 terminal handle 失败，原始回执：" >&2; echo "$RESP" >&2; exit 1
fi

# ---- 等待 agent TUI 就绪 ----
echo "  [worker] 等待 TUI 初始化（8s）..."
sleep 8
echo "$HANDLE" > "${STATE_DIR}/worker.handle"
echo "WORKER_READY:${HANDLE}"
