#!/usr/bin/env bash
# run-checks.sh —— 可选本地检查工具（不属于 controller/worker 流程硬闸）
# 流程质量由 PR 创建后的 GitHub CI 检测；本脚本仅供人工排查或用户明确要求时调用。检查链按仓库实际配置执行：
#   1) 仓库根 .orca-card.json 的 check_cmd/check_cmd_fast（显式配置，最高优先）
#   2) 栈探测：package.json scripts → lint/typecheck/test；pyproject.toml → ruff/mypy/pytest；go.mod → go vet/test
#   3) 都探不到 → 硬失败（fail loudly，避免手动检查时静默跳过）
#
# 用法：bash run-checks.sh [--fast] [--json]
# 输出：每条命令名 + 尾部摘要（默认各 tail 20 行；--json 输出 CHECKS_JSON 一行）
# 退出码：0 全部通过；1 任一失败；2 无法确定检查链（需人工写 .orca-card.json）

set -uo pipefail

JSON_MODE=0
TAIL_LINES=20

parse_args() {
  for a in "$@"; do
    case "$a" in
      --json) JSON_MODE=1;;
      --fast) :;;  # 在层 1 读取段处理
    esac
  done
}
parse_args "$@"

# ---- 层 1：显式配置 ----
if [ -f .orca-card.json ] && command -v jq >/dev/null 2>&1; then
  # --fast 时优先 check_cmd_fast（增量链），失败或未配置则回退 check_cmd（全量链）
  FAST=0
  for a in "$@"; do [ "$a" = "--fast" ] && FAST=1; done
  if [ "$FAST" = "1" ]; then
    CFG_CMD=$(jq -r '.check_cmd_fast // empty' .orca-card.json 2>/dev/null)
  fi
  [ -z "${CFG_CMD:-}" ] && CFG_CMD=$(jq -r '.check_cmd // empty' .orca-card.json 2>/dev/null)
  [ -n "${CFG_CMD:-}" ] && SRC=".orca-card.json$( [ "$FAST" = "1" ] && echo " --fast" )"
fi

# ---- 层 2：栈探测 ----
detect_cmds() {
  local -a c=()
  if [ -f package.json ]; then
    local mgr="npm"
    [ -f pnpm-lock.yaml ] && mgr="pnpm"
    [ -f yarn.lock ] && mgr="yarn"
    # 逐键独立探测（不能共享一次 jq 输出：末尾无换行时命令替换会丢行）
    if   [ "$(jq -r '.scripts | has("lint")' package.json 2>/dev/null)"      = "true" ]; then c+=("lint:${mgr} run lint"); fi
    if   [ "$(jq -r '.scripts | has("typecheck")' package.json 2>/dev/null)" = "true" ]; then c+=("typecheck:${mgr} run typecheck"); fi
    if   [ "$(jq -r '.scripts | has("test")' package.json 2>/dev/null)"      = "true" ]; then c+=("test:${mgr} run test"); fi
  elif [ -f pyproject.toml ] || [ -f setup.py ]; then
    c+=("lint:ruff check")
    c+=("typecheck:mypy app")
    c+=("test:pytest")
  elif [ -f go.mod ]; then
    c+=("vet:go vet ./...")
    c+=("test:go test ./...")
  fi
  [ ${#c[@]} -gt 0 ] && printf '%s\n' "${c[@]}"
}

declare -a NAMES=() CMDS=()
if [ -n "${CFG_CMD:-}" ]; then
  # check_cmd 支持多行：每行 "name:cmd"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    NAMES+=("${line%%:*}")
    CMDS+=("${line#*:}")
  done <<< "$CFG_CMD"
  SRC=".orca-card.json"
else
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    NAMES+=("${line%%:*}")
    CMDS+=("${line#*:}")
  done < <(detect_cmds)
  SRC="auto-detect"
fi

if [ ${#NAMES[@]} -eq 0 ]; then
  echo "CHECKS_ERROR: 无法确定本仓库检查链（无 .orca-card.json 且栈探测失败）。" >&2
  echo "  请在仓库根写 .orca-card.json，示例：{\"check_cmd\": \"lint:pnpm run lint\\ntypecheck:pnpm run typecheck\\ntest:pnpm run test\"}" >&2
  exit 2
fi

echo "  [checks] 来源=${SRC} 共 ${#NAMES[@]} 条检查链"
declare -a RESULTS=() EXITS=()
FAIL=0
for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"; cmd="${CMDS[$i]}"
  echo "  [checks] ▶ ${name}: ${cmd}"
  out=$(eval "$cmd" 2>&1); rc=$?
  echo "$out" | tail -"$TAIL_LINES" | sed 's/^/    /'
  echo "  [checks] ✦ ${name} exit=${rc}"
  RESULTS+=("${name}"); EXITS+=("$rc")
  [ "$rc" -ne 0 ] && FAIL=1
done

if [ "$JSON_MODE" = "1" ]; then
  summary=""
  for i in "${!RESULTS[@]}"; do
    summary+="${RESULTS[$i]}=${EXITS[$i]};"
  done
  echo "CHECKS_JSON:${summary%;}:fail=${FAIL}"
else
  if [ "$FAIL" -eq 0 ]; then
    echo "CHECKS_PASS:${#NAMES[@]}/${#NAMES[@]}"
  else
    echo "CHECKS_FAIL:详见上方各 exit 行"
  fi
fi
exit "$FAIL"
