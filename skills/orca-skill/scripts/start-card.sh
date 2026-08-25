#!/usr/bin/env bash
# start-card.sh —— 开卡唯一入口：建 worktree + 起 controller + 注入初始指令
# 设计规格：方案/Orca两层编排闭环流程-v2.md §6
#
# 用法（在仓库主 worktree 根目录执行）：
#   bash skills/orca-skill/scripts/start-card.sh --issue <n> --card <c> --tier simple|medium|complex \
#        [--controller-cmd "<cmd>"] [--worker-agent "<id[ 参数]>"] [--force]
#
# 退出码：
#   0  成功（打印 CARD_STARTED 摘要）
#   1  参数/依赖/执行错误
#   2  孤儿 worktree 已存在且未加 --force

set -euo pipefail

ISSUE=""
CARD=""
TIER=""
CTRL_CMD_OVERRIDE=""
WORKER_OVERRIDE=""
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --issue)         ISSUE="$2"; shift 2;;
    --card)          CARD="$2"; shift 2;;
    --tier)          TIER="$2"; shift 2;;
    --controller-cmd) CTRL_CMD_OVERRIDE="$2"; shift 2;;
    --worker-agent)  WORKER_OVERRIDE="$2"; shift 2;;
    --force)         FORCE=1; shift;;
    *) echo "ERROR: 未知参数 $1" >&2; exit 1;;
  esac
done

# ---- 参数校验 ----
if [[ ! "$ISSUE" =~ ^[0-9]+$ ]]; then
  echo "ERROR: --issue 必须为正整数" >&2; exit 1
fi
if [[ ! "$CARD" =~ ^[a-z0-9-]+$ ]]; then
  echo "ERROR: --card 格式非法（^[a-z0-9-]+$，如 m1-fp-03）" >&2; exit 1
fi
case "$TIER" in
  simple|medium|complex) ;;
  *) echo "ERROR: --tier 必须为 simple|medium|complex" >&2; exit 1;;
esac

# ---- 依赖检查 ----
for dep in orca gh jq git; do
  command -v "$dep" >/dev/null 2>&1 || { echo "ERROR: 缺少依赖 $dep" >&2; exit 1; }
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIERS_FILE="${SCRIPT_DIR}/../tiers.json"

# ---- tier 默认组合：优先读 tiers.json（唯一事实源），缺失/字段为空时回退内置默认 ----
_builtin_ctrl() {
  case "$TIER" in
    simple)  echo "opencode -m opencode/hy3-free";;
    medium)  echo "opencode -m opencode/nemotron-3-ultra-free";;
    complex) echo "opencode -m opencode/mimo-v2.5-free";;
  esac
}
_builtin_worker() {
  case "$TIER" in
    simple)  echo "kimi";;
    medium)  echo "claude";;
    complex) echo "codex";;
  esac
}
CTRL_DEFAULT=$(jq -r --arg t "$TIER" '.tiers[$t].controller // empty' "$TIERS_FILE" 2>/dev/null)
WORKER_DEFAULT=$(jq -r --arg t "$TIER" '.tiers[$t].worker // empty' "$TIERS_FILE" 2>/dev/null)
[ -z "$CTRL_DEFAULT" ] && CTRL_DEFAULT=$(_builtin_ctrl)
[ -z "$WORKER_DEFAULT" ] && WORKER_DEFAULT=$(_builtin_worker)
# 注：worker 曾用 grok，实测 #38（complex 卡）grok 仅 commit 日志 md 即谎报"N 文件改动已 push"，
# 属幻觉式假完成，提示词压不住。故 medium/complex 默认不再用 grok，需显式 --worker-agent grok 才启用。
CTRL_CMD="${CTRL_CMD_OVERRIDE:-$CTRL_DEFAULT}"
WORKER_AGENT="${WORKER_OVERRIDE:-$WORKER_DEFAULT}"
TPL_FILE="${SCRIPT_DIR}/../templates/controller-prompt.tpl.md"
[ -f "$TPL_FILE" ] || { echo "ERROR: 模板缺失 $TPL_FILE" >&2; exit 1; }

REPO_SEL="path:$(pwd)"
# worktree 必须从当前开发分支切出（本 fork 的开发在 wecir-dev-v*，Orca 默认 base 是 origin/main，会缺技能与 M1 代码）
BASE_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
[ -n "$BASE_BRANCH" ] || { echo "ERROR: 无法确定当前分支（需在主 worktree 的命名分支上运行）" >&2; exit 1; }

# ---- 孤儿检查：同名 worktree（displayName == card） ----
OLD_PATH=$(orca worktree list --json 2>/dev/null | jq -r \
  ".result.worktrees[]? | select(.displayName == \"${CARD}\" and .isArchived != true) | .path" | head -1)
if [ -n "$OLD_PATH" ]; then
  if [ "$FORCE" -eq 1 ]; then
    echo "  [cleanup] 发现孤儿 worktree ${CARD}，--force 清理中：$OLD_PATH"
    orca worktree rm --worktree "path:${OLD_PATH}" --force --json >/dev/null \
      || { echo "ERROR: 清理失败，请手动执行：orca worktree rm --worktree path:${OLD_PATH} --force" >&2; exit 1; }
    sleep 2
  else
    echo "ABORT: worktree ${CARD} 已存在（$OLD_PATH）。确认废弃请加 --force 重开，或换卡号（如 ${CARD}-r1）" >&2
    exit 2
  fi
fi

# ---- 建 worktree（空白，不传 --agent；模型由 terminal create --command 传入） ----
echo "  [1/4] 创建 worktree ${CARD}（issue #${ISSUE}）..."
WT_RESP=$(orca worktree create --repo "$REPO_SEL" --name "$CARD" --issue "$ISSUE" --setup skip --base-branch "$BASE_BRANCH" --json)
WT_PATH=$(echo "$WT_RESP" | jq -r '.result.worktree.path // .result.path // empty')
if [ -z "$WT_PATH" ] || [ "$WT_PATH" = "null" ]; then
  echo "ERROR: 解析 worktree path 失败，原始回执：" >&2; echo "$WT_RESP" >&2; exit 1
fi
echo "  [1/4] worktree 就绪：$WT_PATH"

# ---- 起 controller ----
echo "  [2/4] 启动 controller：${CTRL_CMD}"
TERM_RESP=$(orca terminal create --worktree "path:${WT_PATH}" \
  --command "$CTRL_CMD" --title "#${ISSUE}-${CARD}-controller" --json)
CTRL_HANDLE=$(echo "$TERM_RESP" | jq -r '.result.terminal.handle // .result.handle // empty')
if [ -z "$CTRL_HANDLE" ] || [ "$CTRL_HANDLE" = "null" ]; then
  echo "ERROR: 解析 terminal handle 失败，原始回执：" >&2; echo "$TERM_RESP" >&2
  echo "提示：worktree 已建（$WT_PATH），可用 --force 重开" >&2
  exit 1
fi
echo "  [2/4] controller 终端：${CTRL_HANDLE}"

# ---- 渲染模板 ----
echo "  [3/4] 渲染初始指令模板..."
PROMPT_FILE="/tmp/ctrl_prompt_${CARD}.txt"
sed -e "s/{{ISSUE}}/${ISSUE}/g" \
    -e "s/{{CARD}}/${CARD}/g" \
    -e "s/{{WORKER_AGENT}}/${WORKER_AGENT}/g" \
    "$TPL_FILE" > "$PROMPT_FILE"

# ---- 等待并注入初始指令（以「指令内容真实出现在屏幕」为成功判据） ----
# 教训：就绪轮询（检测首页出现）+ send accepted 均不可靠——opencode 首页出现 ≠ 已能接收长指令，
# send accepted 只是字节写入 pty 的假阳性。改为 send 后读屏幕，校验指令关键词是否真实渲染出来。
echo "  [4/4] 注入初始指令（结果校验，最多 4 次）..."
INJECT_OK=0
for attempt in 1 2 3 4; do
  sleep 6
  orca terminal send --terminal "$CTRL_HANDLE" --text "$(cat "$PROMPT_FILE")" --enter --json >/dev/null 2>&1
  sleep 10
  SCR=$(orca terminal read --terminal "$CTRL_HANDLE" --screen 2>/dev/null)
  if echo "$SCR" | grep -qE "controller 会话|你是 issue|第 1 步|ensure-worker|send-dev-task"; then
    INJECT_OK=1
    break
  fi
  echo "  WARN: 第 ${attempt} 次注入后屏幕未见指令内容，重试..." >&2
done
if [ "$INJECT_OK" != "1" ]; then
  echo "ERROR: 初始指令注入失败（send 后屏幕未见指令内容）。controller=${CTRL_HANDLE}" >&2
  echo "  worktree 已建（$WT_PATH），可 --force 重开，或手动对 controller 补注入" >&2
  exit 1
fi
echo "  [4/4] 初始指令已注入（屏幕确认指令内容）"

echo ""
echo "CARD_STARTED"
echo "  issue        : #${ISSUE}"
echo "  card         : ${CARD}"
echo "  tier         : ${TIER}"
echo "  controller   : ${CTRL_HANDLE}"
echo "  worktree     : ${WT_PATH}"
echo "  branch       : kerenski/${CARD}"
echo "  worker       : ${WORKER_AGENT}"
echo "  看板记录行   : #${ISSUE} → 难度${TIER} → 组合(${CTRL_CMD}/${WORKER_AGENT})"
