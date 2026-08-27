#!/usr/bin/env bash
# send-dev-task.sh —— 向 worker 发首轮开发指令（固定话术：日志 sentinel + commit/push）
# 话术要点来自 docs/Orca两层编排闭环流程-v2.md §7（内置在脚本里，controller 无需记忆）
#
# 用法：bash ${SCRIPT_DIR}/send-dev-task.sh --issue <n> --card <c> --worker <handle> [--extra "<补充要求>"]
# 输出：DEV_TASK_SENT:<issue>-<card> -> <handle>
# 退出码：0 成功；1 参数错误；2 发送失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISSUE=""
CARD=""
HANDLE=""
EXTRA=""

while [ $# -gt 0 ]; do
  case "$1" in
    --issue) ISSUE="$2"; shift 2;;
    --card)  CARD="$2"; shift 2;;
    --worker) HANDLE="$2"; shift 2;;
    --extra) EXTRA="$2"; shift 2;;
    *) echo "ERROR: 未知参数 $1" >&2; exit 1;;
  esac
done

if [[ ! "$ISSUE" =~ ^[0-9]+$ ]] || [[ ! "$CARD" =~ ^[a-z0-9-]+$ ]] || [ -z "$HANDLE" ]; then
  echo "ERROR: --issue/--card/--worker 均必填" >&2
  exit 1
fi

# gh 目标仓库：显式指向 fork（origin）。多 remote 下 gh 内置偏好 upstream > origin，
# 不显式 -R 会把 fork issue 号解析成上游同号 issue/PR（PR 与 issue 共享编号空间，REST 会静默返回 PR）
FORK_REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#.*github\.com[:/]([^/]+)/([^/]+)#\1/\2#' | sed 's#\.git$##')
if [ -z "$FORK_REPO" ] || [[ "$FORK_REPO" != *"/"* ]]; then
  echo "ERROR: 无法从 origin remote 解析 fork 仓库（git remote get-url origin）" >&2
  exit 1
fi

# 拉取 issue 标题与正文，内联进指令（避免 worker 自行 gh issue view 时跳过/读错）
ISSUE_TITLE=$(gh issue view "${ISSUE}" -R "$FORK_REPO" --json title -q .title 2>/dev/null || echo "")
ISSUE_BODY=$(gh issue view "${ISSUE}" -R "$FORK_REPO" --json body -q .body 2>/dev/null || echo "")
if [ -z "$ISSUE_BODY" ]; then
  echo "ERROR: 无法获取 ${FORK_REPO} issue #${ISSUE} 正文（gh issue view 失败或网络问题）" >&2
  exit 1
fi

# 身份防御：同号若为 PR 则 gh pr view 可查到（REST /issues/{n} 对 PR 静默返回，必须单独探）
if gh pr view "${ISSUE}" -R "$FORK_REPO" >/dev/null 2>&1; then
  echo "ERROR: ${FORK_REPO} #${ISSUE} 是 PR 不是 issue（编号碰撞），禁止作为开发任务发送" >&2
  exit 1
fi

# 缓存 issue 全文供 controller 第 4 步对账复用（同源保证：controller 与 worker 看到同一份，避免重复拉取与解析偏移）
mkdir -p "/tmp/${CARD}"
printf 'TITLE: %s\n\nBODY:\n%s\n' "${ISSUE_TITLE}" "${ISSUE_BODY}" > "/tmp/${CARD}/issue-body.md"

# 自校验（防 review 阶段被误调为首轮开发）：仅校验"当前 issue+card"的日志文件是否已有首轮锚点，
# 不扫其他 issue 的日志（避免误判 #38 等遗留日志为本卡修复轮）。
ANCHOR_FILE=$(ls 开发日志/*/${ISSUE}-${CARD}.md 2>/dev/null | head -1)
if [ -n "$ANCHOR_FILE" ] && grep -q "## 开发任务（首轮）" "$ANCHOR_FILE"; then
  echo "ERROR: 检测到本卡首轮开发日志已存在（${ANCHOR_FILE}），当前应为 review 修复轮，禁止使用 send-dev-task.sh 重发首轮。" >&2
  echo "       请改用：bash ${SCRIPT_DIR}/send-review.sh --issue ${ISSUE} --card ${CARD} --round <N> --worker <handle> --file <意见md>" >&2
  exit 1
fi

MSG="【开发任务 issue #${ISSUE} / ${CARD}】
任务名称：${ISSUE_TITLE}
以下为本 issue 的完整需求原文（须逐条对照实现，不得遗漏）：
==== ISSUE 需求原文开始 ====
${ISSUE_BODY}
==== ISSUE 需求原文结束 ====

实现要求：
1. 按上方需求原文逐项实现，尤其覆盖 issue 范围/锚点文档列明的所有验收项与交付物（如步骤数、字段集 V2.0 各项、关联模板/预览等）。
2. 完成后写开发日志：开发日志/$(date +%Y-%m-%d)/${ISSUE}-${CARD}.md（目录不存在则创建）。
   首行锚点必须是独立完整的一行：「## 开发任务（首轮）」，其下写：改动范围 / 改动概要 / commit 短哈希。
3. git add -A && git commit -m \"${ISSUE} ${CARD}: 开发完成（含开发日志）\" && git push origin HEAD
4. 只有同时满足 (1) git diff --stat origin/main...HEAD 含业务代码改动 且 (2) 开发日志已 commit，才允许回复：「开发完成，等待 review」。未完成上述任一项不得回复此句。PR 真实 CI 是最终质量闸。
5. push 成功后必须立即回敲 controller（这是 controller 结束回合后被唤醒的唯一快路径；看门狗最多延迟 5 分钟代发兜底）：
   CTRL_HANDLE=$(cat /tmp/${CARD}/controller.handle 2>/dev/null)
   [ -n \"\$CTRL_HANDLE\" ] && orca terminal send --terminal \"\$CTRL_HANDLE\" \
     --text \"DEV_SIGNAL ${CARD} round=0 head=\$(git rev-parse --short HEAD)\" --enter
  （文件不存在或发送失败则跳过，继续完成自身收尾即可）
6. 禁止裸 gh：此 worktree 是双 remote（fork kerenski/orca + upstream stablyai/orca），同号 issue/PR 内容不同，
   运行不带 -R 的 gh issue/pr 命令会解析到上游英文内容（#61 实测事故）。确需用 gh 时必须显式加 -R kerenski/orca。
"

if [ -n "$EXTRA" ]; then
  MSG="${MSG}

【补充要求】
${EXTRA}"
fi

# baseline 在 send 之前实测（此刻 worker 尚未收到任务，ahead 绝对稳定），显式传给看门狗与输出，避免 send 后双实测 race
BASELINE_AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)

WATCHDOG="${SCRIPT_DIR}/wait-dev-watchdog.sh"
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
  # 看门狗脚本存在性检查：硬失败，避免静默跳过导致 controller 永久挂起
  if [ ! -f "$WATCHDOG" ]; then
    echo "ERROR: 看门狗脚本不存在：${WATCHDOG}" >&2
    echo "       这意味着主 worktree 的 orca-skill 代码过旧或未同步" >&2
    echo "       请在主 worktree 执行：git pull origin HEAD" >&2
    echo "       然后重新开卡：bash ${SCRIPT_DIR}/start-card.sh --issue ${ISSUE} --card ${CARD} --tier <tier> --force" >&2
    exit 1
  fi

  # controller.handle 存在性检查：看门狗依赖它发送通知
  if [ ! -f "${STATE_DIR}/controller.handle" ]; then
    echo "ERROR: controller.handle 不存在：${STATE_DIR}/controller.handle" >&2
    echo "       这是 start-card.sh 的 bug（应在 send 前写入），请报告开发者" >&2
    exit 1
  fi

  mkdir -p "$STATE_DIR"
  # 换轮：杀掉旧看门狗（其 baseline/round 已过时；TERM 延迟时旧进程靠 pid 自查退出）
  if [ -f "${STATE_DIR}/watchdog.pid" ]; then
    kill "$(cat "${STATE_DIR}/watchdog.pid" 2>/dev/null)" 2>/dev/null || true
    rm -f "${STATE_DIR}/watchdog.pid"
  fi

  nohup bash "$WATCHDOG" --card "$CARD" --issue "$ISSUE" --round 0 --worker "$HANDLE" --baseline "$BASELINE_AHEAD" \
    >>"${STATE_DIR}/watchdog.log" 2>&1 &
  local watchdog_pid=$!

  # 等待看门狗真正启动（写入 pid 文件并存活）
  sleep 1
  if kill -0 "$watchdog_pid" 2>/dev/null; then
    echo "  [watchdog] 已启动 PID=${watchdog_pid} baseline=${BASELINE_AHEAD}（兜底代发 DEV_SIGNAL；controller 落盘 card-state 后即可结束回合）"
  else
    echo "ERROR: 看门狗启动失败，PID=${watchdog_pid} 已退出" >&2
    echo "       查看日志：cat ${STATE_DIR}/watchdog.log" >&2
    exit 1
  fi
}

if orca terminal send --terminal "$HANDLE" --text "$MSG" --enter --json >/dev/null 2>&1; then
  echo "DEV_TASK_SENT:${ISSUE}-${CARD} -> ${HANDLE}"
  write_state 3 0
  echo "  [state] card-state.md 已落盘（步骤 3，等待 DEV_SIGNAL）"
  start_watchdog
else
  echo "ERROR: 发送失败（handle 可能已失效，先跑 ensure-worker.sh --force 重建）" >&2
  exit 2
fi
