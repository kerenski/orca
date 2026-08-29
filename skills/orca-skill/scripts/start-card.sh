#!/usr/bin/env bash
# start-card.sh —— 开卡唯一入口：建 worktree + 起 controller + 注入初始指令
# 设计规格：docs/Orca两层编排闭环流程-v2.md §6
#
# 用法（在仓库主 worktree 根目录执行）：
#   bash <skill-directory>/scripts/start-card.sh --issue <n> --card <c> --tier simple|medium|complex \
#        [--controller-cmd "<cmd>"] [--worker-agent "<id[ 参数]>"] [--force] [--json]
#
# 退出码：1 参数/依赖错误；2 孤儿 worktree；3 执行错误

set -Eeuo pipefail

ISSUE=""
ISSUE_NUMBER=""
CARD=""
TIER=""
CTRL_CMD_OVERRIDE=""
WORKER_OVERRIDE=""
FORCE=0
JSON_MODE=0
RESULT_EMITTED=0
PROMPT_FILE=""
PTY_LOOKUP_ATTEMPTS=6

for arg in "$@"; do
  if [ "$arg" = "--json" ]; then
    JSON_MODE=1
    break
  fi
done

log() {
  if [ "$JSON_MODE" -eq 1 ]; then
    printf '%s\n' "$*" >&2
  else
    printf '%s\n' "$*"
  fi
}

emit_failure() {
  local exit_code="$1"
  local code="$2"
  local message="$3"
  local retryable="$4"
  local detail_key="${5-}"
  local detail_value="${6-}"
  trap - ERR
  set +e
  printf 'ERROR: %s\n' "$message" >&2
  if [ "$JSON_MODE" -eq 1 ] && [ "$RESULT_EMITTED" -eq 0 ]; then
    RESULT_EMITTED=1
    if command -v jq >/dev/null 2>&1; then
      if [ -n "$detail_key" ]; then
        jq -cn \
          --arg code "$code" \
          --arg message "$message" \
          --argjson retryable "$retryable" \
          --arg detailKey "$detail_key" \
          --arg detailValue "$detail_value" \
          '{schemaVersion:1,ok:false,error:{code:$code,message:$message,retryable:$retryable,details:{($detailKey):$detailValue}}}'
      else
        jq -cn \
          --arg code "$code" \
          --arg message "$message" \
          --argjson retryable "$retryable" \
          '{schemaVersion:1,ok:false,error:{code:$code,message:$message,retryable:$retryable}}'
      fi
    else
      printf '%s\n' '{"schemaVersion":1,"ok":false,"error":{"code":"dependency_missing","message":"Missing required dependency: jq","retryable":false,"details":{"dependency":"jq"}}}'
    fi
  fi
  exit "$exit_code"
}

on_unexpected_error() {
  emit_failure 3 "unknown" "Unexpected start-card execution failure" true
}
trap on_unexpected_error ERR
trap '[ -z "$PROMPT_FILE" ] || rm -f -- "$PROMPT_FILE"' EXIT

require_value() {
  local option="$1"
  local value="${2-}"
  if [ -z "$value" ] || [[ "$value" == --* ]]; then
    emit_failure 1 "invalid_parameters" "Missing value for ${option}" false "option" "$option"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --issue)
      require_value "$1" "${2-}"
      ISSUE="$2"
      shift 2
      ;;
    --card)
      require_value "$1" "${2-}"
      CARD="$2"
      shift 2
      ;;
    --tier)
      require_value "$1" "${2-}"
      TIER="$2"
      shift 2
      ;;
    --controller-cmd)
      require_value "$1" "${2-}"
      CTRL_CMD_OVERRIDE="$2"
      shift 2
      ;;
    --worker-agent)
      require_value "$1" "${2-}"
      WORKER_OVERRIDE="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --json)
      shift
      ;;
    *)
      emit_failure 1 "invalid_parameters" "Unknown option" false "option" "$1"
      ;;
  esac
done

if [[ ! "$ISSUE" =~ ^[0-9]{1,10}$ ]]; then
  emit_failure 1 "invalid_parameters" "--issue must be a positive integer" false "option" "--issue"
fi
ISSUE_NUMBER=$((10#$ISSUE))
if [ "$ISSUE_NUMBER" -lt 1 ] || [ "$ISSUE_NUMBER" -gt 1000000000 ]; then
  emit_failure 1 "invalid_parameters" "--issue must be between 1 and 1000000000" false "option" "--issue"
fi
if [[ ! "$CARD" =~ ^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$ ]]; then
  emit_failure 1 "invalid_parameters" "Invalid --card value" false "option" "--card"
fi
case "$TIER" in
  simple|medium|complex) ;;
  *) emit_failure 1 "invalid_parameters" "--tier must be simple, medium, or complex" false "option" "--tier" ;;
esac
for override in "$CTRL_CMD_OVERRIDE" "$WORKER_OVERRIDE"; do
  if [ "${#override}" -gt 512 ] || [[ "$override" == *$'\n'* ]] || [[ "$override" == *$'\r'* ]]; then
    emit_failure 1 "invalid_parameters" "Agent overrides must be single-line values up to 512 characters" false
  fi
done

for dep in jq orca gh git; do
  if ! command -v "$dep" >/dev/null 2>&1; then
    emit_failure 1 "dependency_missing" "Missing required dependency: ${dep}" false "dependency" "$dep"
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_lib.sh"
SKILL_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TIERS_FILE="${SKILL_ROOT}/tiers.json"
TPL_FILE="${SKILL_ROOT}/templates/controller-prompt.tpl.md"
[ -r "$TIERS_FILE" ] || emit_failure 1 "dependency_missing" "Tier configuration is missing" false
[ -r "$TPL_FILE" ] || emit_failure 1 "dependency_missing" "Controller template is missing" false

CTRL_DEFAULT="$(jq -er --arg tier "$TIER" '.tiers[$tier].controller | select(type == "string" and length > 0)' "$TIERS_FILE")" \
  || emit_failure 1 "dependency_missing" "Tier controller configuration is invalid" false
WORKER_DEFAULT="$(jq -er --arg tier "$TIER" '.tiers[$tier].worker | select(type == "string" and length > 0)' "$TIERS_FILE")" \
  || emit_failure 1 "dependency_missing" "Tier worker configuration is invalid" false
CTRL_CMD="${CTRL_CMD_OVERRIDE:-$CTRL_DEFAULT}"
WORKER_AGENT="${WORKER_OVERRIDE:-$WORKER_DEFAULT}"

REPO_SEL="path:$(pwd)"
FORK_REPO="$(resolve_fork_repo)" \
  || emit_failure 3 "worktree_invalid" "Unable to resolve the fork repository from origin" false
BASE_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null)" \
  || emit_failure 3 "worktree_invalid" "Unable to determine the current branch" false
[ -n "$BASE_BRANCH" ] || emit_failure 3 "worktree_invalid" "Unable to determine the current branch" false

WT_LIST_RESP="$(orca worktree list --json)" \
  || emit_failure 3 "unknown" "Unable to list Orca worktrees" true
OLD_PATH="$(jq -er --arg card "$CARD" '
  if .ok != true or (.result.worktrees | type) != "array" then error("invalid receipt") else
    [.result.worktrees[]
      | select(.isArchived != true)
      | select(.displayName == $card or (.displayName | test("^" + $card + "-[0-9]+$")))
      | .path
      | select(type == "string" and length > 0)
      | select(test("[\u0000-\u001f]") | not)][0] // ""
  end
' <<<"$WT_LIST_RESP")" || emit_failure 3 "invalid_script_output" "Orca returned an invalid worktree list receipt" false
if [ -n "$OLD_PATH" ]; then
  if [ "$FORCE" -eq 1 ]; then
    log "  [cleanup] Removing orphan worktree ${CARD}: ${OLD_PATH}"
    if [ -f "/tmp/${CARD}/watchdog.pid" ]; then
      kill "$(<"/tmp/${CARD}/watchdog.pid")" 2>/dev/null || true
    fi
    RM_RESP="$(orca worktree rm --worktree "path:${OLD_PATH}" --force --json)" \
      || emit_failure 3 "worktree_invalid" "Unable to remove the orphan worktree" false
    jq -e '.ok == true' >/dev/null 2>&1 <<<"$RM_RESP" \
      || emit_failure 3 "invalid_script_output" "Orca returned an invalid worktree remove receipt" false
    rm -rf -- "/tmp/${CARD}"
    sleep 2
  else
    emit_failure 2 "worktree_invalid" "An active worktree already exists for this card" false "worktreePath" "$OLD_PATH"
  fi
fi

log "  [1/4] Creating worktree ${CARD} for issue #${ISSUE_NUMBER}..."
WT_RESP="$(orca worktree create \
  --repo "$REPO_SEL" \
  --name "$CARD" \
  --issue "$ISSUE_NUMBER" \
  --setup skip \
  --base-branch "$BASE_BRANCH" \
  --json)" || emit_failure 3 "unknown" "Unable to create the worktree" true
WT_FIELDS="$(jq -er '
  .result.worktree as $worktree
  | select(.ok == true)
  | select(($worktree.id | type) == "string" and ($worktree.id | length) > 0)
  | select(($worktree.path | type) == "string" and ($worktree.path | length) > 0)
  | select(($worktree.branch | type) == "string" and ($worktree.branch | length) > 0)
  | select([$worktree.id, $worktree.path, $worktree.branch] | all(test("[\u0000-\u001f]") | not))
  | [$worktree.id, $worktree.path, $worktree.branch] | @tsv
' <<<"$WT_RESP")" || emit_failure 3 "invalid_script_output" "Orca returned an invalid worktree create receipt" false
IFS=$'\t' read -r WT_ID WT_PATH WT_BRANCH <<<"$WT_FIELDS"

log "  [2/4] Starting controller: ${CTRL_CMD}"
TERM_RESP="$(orca terminal create \
  --worktree "id:${WT_ID}" \
  --command "$CTRL_CMD" \
  --title "#${ISSUE_NUMBER}-${CARD}-controller" \
  --json)" || emit_failure 3 "unknown" "Unable to create the controller terminal" true
TERM_FIELDS="$(jq -er '
  .result.terminal as $terminal
  | select(.ok == true)
  | select(($terminal.handle | type) == "string" and ($terminal.handle | length) > 0)
  | select(($terminal.worktreeId | type) == "string" and ($terminal.worktreeId | length) > 0)
  | select($terminal.ptyId == null or (($terminal.ptyId | type) == "string" and ($terminal.ptyId | length) > 0))
  | select([$terminal.handle, $terminal.worktreeId, ($terminal.ptyId // "")] | all(test("[\u0000-\u001f]") | not))
  | [$terminal.handle, $terminal.worktreeId, ($terminal.ptyId // "")] | @tsv
' <<<"$TERM_RESP")" || emit_failure 3 "invalid_script_output" "Orca returned an invalid terminal create receipt" false
IFS=$'\t' read -r CTRL_HANDLE TERM_WORKTREE_ID CTRL_PTY_ID <<<"$TERM_FIELDS"
if [ "$TERM_WORKTREE_ID" != "$WT_ID" ]; then
  emit_failure 3 "pty_binding_lost" "The controller terminal is bound to a different worktree" false
fi

PTY_LOOKUP_ATTEMPT=0
while [ -z "$CTRL_PTY_ID" ] && [ "$PTY_LOOKUP_ATTEMPT" -lt "$PTY_LOOKUP_ATTEMPTS" ]; do
  PTY_LOOKUP_ATTEMPT=$((PTY_LOOKUP_ATTEMPT + 1))
  SHOW_RESP="$(orca terminal show --terminal "$CTRL_HANDLE" --json)" \
    || emit_failure 3 "pty_binding_lost" "Unable to resolve the controller PTY" true
  SHOW_FIELDS="$(jq -er '
    .result.terminal as $terminal
    | select(.ok == true)
    | select(($terminal.handle | type) == "string" and ($terminal.handle | length) > 0)
    | select(($terminal.worktreeId | type) == "string" and ($terminal.worktreeId | length) > 0)
    | select($terminal.ptyId == null or (($terminal.ptyId | type) == "string" and ($terminal.ptyId | length) > 0))
    | select([$terminal.handle, $terminal.worktreeId, ($terminal.ptyId // "")] | all(test("[\u0000-\u001f]") | not))
    | [$terminal.handle, $terminal.worktreeId, ($terminal.ptyId // "")] | @tsv
  ' <<<"$SHOW_RESP")" || emit_failure 3 "invalid_script_output" "Orca returned an invalid terminal show receipt" false
  IFS=$'\t' read -r SHOW_HANDLE SHOW_WORKTREE_ID SHOW_PTY_ID <<<"$SHOW_FIELDS"
  if [ "$SHOW_HANDLE" != "$CTRL_HANDLE" ] || [ "$SHOW_WORKTREE_ID" != "$WT_ID" ]; then
    emit_failure 3 "pty_binding_lost" "The resolved controller PTY binding does not match" false
  fi
  CTRL_PTY_ID="$SHOW_PTY_ID"
  if [ -z "$CTRL_PTY_ID" ]; then
    sleep 1
  fi
done
if [ -z "$CTRL_PTY_ID" ]; then
  emit_failure 3 "pty_binding_lost" "The controller PTY was not ready before timeout" true
fi

mkdir -p -- "/tmp/${CARD}"
printf '%s\n' "$CTRL_HANDLE" > "/tmp/${CARD}/controller.handle"

log "  [3/4] Rendering the controller prompt..."
PROMPT_FILE="/tmp/ctrl_prompt_${CARD}_$$.txt"
PROMPT_CONTENT="$(<"$TPL_FILE")"
PROMPT_SKILL_ROOT="${SKILL_ROOT//\\/\\\\}"
PROMPT_SKILL_ROOT="${PROMPT_SKILL_ROOT//\$/\\\$}"
PROMPT_SKILL_ROOT="${PROMPT_SKILL_ROOT//\`/\\\`}"
PROMPT_SKILL_ROOT="${PROMPT_SKILL_ROOT//\"/\\\"}"
PROMPT_CONTENT="${PROMPT_CONTENT//\{\{ISSUE\}\}/$ISSUE_NUMBER}"
PROMPT_CONTENT="${PROMPT_CONTENT//\{\{CARD\}\}/$CARD}"
PROMPT_CONTENT="${PROMPT_CONTENT//\{\{WORKER_AGENT\}\}/$WORKER_AGENT}"
PROMPT_CONTENT="${PROMPT_CONTENT//\{\{FORK_REPO\}\}/$FORK_REPO}"
PROMPT_CONTENT="${PROMPT_CONTENT//\{\{SKILL_DIR\}\}/$PROMPT_SKILL_ROOT}"
printf '%s\n' "$PROMPT_CONTENT" > "$PROMPT_FILE"

log "  [4/4] Injecting the initial controller prompt..."
INJECT_OK=0
for attempt in 1 2 3 4; do
  sleep 6
  if SEND_RESP="$(orca terminal send --terminal "$CTRL_HANDLE" --text "$(<"$PROMPT_FILE")" --enter --json 2>/dev/null)" \
    && jq -e '.ok == true' >/dev/null 2>&1 <<<"$SEND_RESP"; then
    sleep 10
    if SCR="$(orca terminal read --terminal "$CTRL_HANDLE" --screen 2>/dev/null)" \
      && grep -qE "controller 会话|你是 issue|第 1 步|ensure-worker|send-dev-task" <<<"$SCR"; then
      INJECT_OK=1
      break
    fi
  fi
  printf '  WARN: prompt injection attempt %s was not visible; retrying\n' "$attempt" >&2
done
if [ "$INJECT_OK" -ne 1 ]; then
  emit_failure 3 "unknown" "The initial controller prompt could not be verified" true
fi

if [ "$JSON_MODE" -eq 1 ]; then
  RESULT_EMITTED=1
  jq -cn \
    --arg controllerPtyId "$CTRL_PTY_ID" \
    --arg worktreeId "$WT_ID" \
    --arg worktreePath "$WT_PATH" \
    --arg branch "$WT_BRANCH" \
    --arg workerAgent "$WORKER_AGENT" \
    --argjson issue "$ISSUE_NUMBER" \
    --arg card "$CARD" \
    --arg tier "$TIER" \
    '{schemaVersion:1,ok:true,controllerPtyId:$controllerPtyId,worktreeId:$worktreeId,worktreePath:$worktreePath,branch:$branch,workerAgent:$workerAgent,issue:$issue,card:$card,tier:$tier}'
else
  printf '\nCARD_STARTED\n'
  printf '  issue        : #%s\n' "$ISSUE_NUMBER"
  printf '  card         : %s\n' "$CARD"
  printf '  tier         : %s\n' "$TIER"
  printf '  controller   : %s\n' "$CTRL_PTY_ID"
  printf '  worktree     : %s\n' "$WT_PATH"
  printf '  branch       : %s\n' "$WT_BRANCH"
  printf '  worker       : %s\n' "$WORKER_AGENT"
fi
