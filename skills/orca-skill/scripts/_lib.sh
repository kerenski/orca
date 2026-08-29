#!/usr/bin/env bash
# _lib.sh —— orca-skill 公共函数库
# 被 scripts/ 下其他脚本 source，不可直接执行
# 约定：source 本文件不产生副作用，不修改调用者变量

# ---- 仓库解析 ----

# resolve_fork_repo
# 解析 origin remote 的 owner/repo 格式（显式指向 fork，防双 remote 下 gh 解析到上游）
# 输出: stdout 打印 owner/repo
# 返回: 0=成功, 1=解析失败
resolve_fork_repo() {
  local repo
  repo=$(git remote get-url origin 2>/dev/null \
    | sed -E 's#.*github\.com[:/]([^/]+)/([^/]+)#\1/\2#' \
    | sed 's#\.git$##')
  if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    return 1
  fi
  printf '%s\n' "$repo"
}

# ---- 依赖检查 ----

# require_deps <cmd1> [cmd2] ...
# 检查命令行工具是否存在，缺少则输出错误并返回 1
require_deps() {
  local dep
  for dep in "$@"; do
    if ! command -v "$dep" >/dev/null 2>&1; then
      echo "ERROR: 缺少依赖 ${dep}" >&2
      return 1
    fi
  done
}

# ---- Git 判定 ----

# ahead_count
# 当前分支相对 origin/main 的领先提交数
# 输出: stdout 打印数字
ahead_count() {
  git rev-list --count "origin/main..HEAD" 2>/dev/null || echo 0
}

# real_changes
# 排除纯文档后的业务文件改动数（只数文件、不数行）
real_changes() {
  git -c core.quotepath=false diff --name-only "origin/main...HEAD" 2>/dev/null \
    | grep -vE '^开发日志/' \
    | grep -vE '^docs/' \
    | grep -vE '\.(md|txt|rst|markdown)$' \
    | grep -cE '.' || true
}

# ---- Worker 判定 ----

# worker_alive [handle]
# 检查 worker terminal 是否仍在 orca terminal list 中
# 未传 handle 时使用 $WORKER（兼容旧调用）
worker_alive() {
  local handle="${1:-${WORKER:-}}"
  [ -z "$handle" ] && return 0
  orca terminal list --json 2>/dev/null | jq -e --arg h "$handle" \
    '.result.terminals[]? | select(.handle == $h)' >/dev/null 2>&1
}

# ---- 锚点与日志 ----

# compute_anchor <round>
# 根据轮次计算日志锚点内容（整行精确匹配用）
compute_anchor() {
  if [ "${1:-0}" -eq 0 ]; then
    echo "## 开发任务（首轮）"
  else
    echo "## Code Review #${1}"
  fi
}

# log_file_path <issue> <card>
# 返回当日开发日志路径
log_file_path() {
  echo "开发日志/$(date +%Y-%m-%d)/${1}-${2}.md"
}

# log_exists <issue> <card> <anchor>
# 检查日志锚点是否存在（整行精确匹配，防 #1 误匹配 #10）
log_exists() {
  local lf
  lf=$(log_file_path "$1" "$2")
  [ -f "$lf" ] && grep -Fxq -- "$3" "$lf" 2>/dev/null
}

# ---- 状态管理 ----

# write_card_state <card> <issue> <step> <handle> <baseline> <round> [pr]
# 将当前状态落盘到 /tmp/<card>/card-state.md
write_card_state() {
  local card="$1" issue="$2" step="$3" handle="$4" baseline="$5" round="$6" pr="${7:-无}"
  mkdir -p "/tmp/${card}"
  cat > "/tmp/${card}/card-state.md" <<EOF
card=${card} issue=#${issue}
当前步骤=${step}
worker=${handle} baseline_ahead=${baseline} round=${round}
PR=${pr}
EOF
}

# ---- 催提交 ----

# nudge_commit <handle> <issue> <card>
# 催 worker 提交并推送（日志需随 commit 一起提交）
nudge_commit() {
  local handle="${1:-${WORKER:-}}"
  [ -z "$handle" ] && return 0
  orca terminal send --terminal "$handle" --text \
    "开发日志已写好但代码尚未提交。请立即执行：git add -A && git commit -m \"${2} ${3}: 开发/修复完成（含开发日志）\" && git push origin HEAD。完成后回复：已提交。" \
    --enter --json >/dev/null 2>&1 || true
  echo "  [nudge] 已催 worker(${handle}) 提交并推送"
}

# ---- 看门狗 ----

# start_watchdog <card> <issue> <round> <handle> <baseline> <script_dir>
# 启动看门狗（杀旧、启新、探测存活）
# 依赖外部变量: 无（全部参数显式传入）
start_watchdog() {
  local card="$1" issue="$2" round="$3" handle="$4" baseline="$5" script_dir="$6"
  local state_dir="/tmp/${card}"
  local watchdog="${script_dir}/wait-dev-watchdog.sh"

  if [ ! -f "$watchdog" ]; then
    echo "ERROR: 看门狗脚本不存在：${watchdog}" >&2
    echo "       这意味着主 worktree 的 orca-skill 代码过旧或未同步" >&2
    echo "       请在主 worktree 执行：git pull origin HEAD" >&2
    exit 1
  fi

  if [ ! -f "${state_dir}/controller.handle" ]; then
    echo "ERROR: controller.handle 不存在：${state_dir}/controller.handle" >&2
    echo "       这是 start-card.sh 的 bug（应在开卡时写入），请报告开发者" >&2
    exit 1
  fi

  mkdir -p "$state_dir"
  # 换轮：杀掉旧看门狗
  if [ -f "${state_dir}/watchdog.pid" ]; then
    kill "$(cat "${state_dir}/watchdog.pid" 2>/dev/null)" 2>/dev/null || true
    rm -f "${state_dir}/watchdog.pid"
  fi

  nohup bash "$watchdog" --card "$card" --issue "$issue" \
    --round "$round" --worker "$handle" --baseline "$baseline" \
    >>"${state_dir}/watchdog.log" 2>&1 &
  local watchdog_pid=$!

  sleep 1
  if kill -0 "$watchdog_pid" 2>/dev/null; then
    echo "  [watchdog] 已启动 PID=${watchdog_pid} baseline=${baseline}"
  else
    echo "ERROR: 看门狗启动失败，PID=${watchdog_pid} 已退出" >&2
    echo "       查看日志：cat ${state_dir}/watchdog.log" >&2
    exit 1
  fi
}
