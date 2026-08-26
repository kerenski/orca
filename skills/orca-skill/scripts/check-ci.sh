#!/usr/bin/env bash
# check-ci.sh —— 查询 GitHub checks 并等全部跑完判定结果
#
# 重要前提（GitHub 机制）：
#   - 大多数仓库的 CI 只在 `pull_request` 事件触发（PR 才跑完整测试）。
#   - push 到分支时，该 commit 上可能根本没有 check runs，或只跑了一部分。
#   - 因此「PR 提交前的 commit checks 全绿」≠「PR 的真实 CI 全绿」。
#   - 要拿到 PR 真实 CI 结果，必须先把分支开成 PR，再查 PR 的 checks。
#
# 用法：
#   # 默认：查当前分支所属 open PR 的真实 CI（推荐，方向 A）
#   bash $HOME/.orca-skill/scripts/check-ci.sh [--timeout <sec>]
#
#   # 显式指定 PR 号（该 PR 必须已存在）
#   bash $HOME/.orca-skill/scripts/check-ci.sh --pr <number> [--timeout <sec>]
#
#   # 仅查某 commit 的 checks（仅供参考，不代表 PR CI，会打印 WARNING）
#   bash $HOME/.orca-skill/scripts/check-ci.sh --sha <sha> [--timeout <sec>]
#
# 退出码：
#   0  所有 checks 完成且通过（仅 pass/skipping，打印 CI_PASS:...）
#   1  有失败、取消或未知状态的 checks（打印 CI_FAIL:...）
#   2  超时仍有 checks 未完成
#   3  其他错误（含：无 open PR 且未指定 --sha / --pr；gh 调用失败）

set -uo pipefail

BRANCH=$(git branch --show-current 2>/dev/null || echo "")
SHA=""
PR_NUM=""
TIMEOUT=1800
INTERVAL=30

while [ $# -gt 0 ]; do
  case "$1" in
    --branch)  BRANCH="$2"; shift 2;;
    --sha)     SHA="$2"; shift 2;;
    --pr)      PR_NUM="$2"; shift 2;;
    --timeout) TIMEOUT="$2"; shift 2;;
    *) echo "ERROR: 未知参数 $1" >&2; exit 3;;
  esac
done

OWNER_REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#.*github\.com[:/]([^/]+)/([^/]+)#\1/\2#' | sed 's#\.git$##')
if [ -z "$OWNER_REPO" ] || [[ "$OWNER_REPO" != *"/"* ]]; then
  # 不硬编码兑底仓库：错仓库查 CI 比直接报错更危险（多 remote 下 gh 偏好 upstream，必须显式指向 origin fork）
  echo "ERROR: 无法从 origin remote 解析目标仓库（git remote get-url origin）" >&2
  exit 3
fi

# 若未显式给 PR 号也未给 SHA，则按当前分支反查 open PR
if [ -z "$PR_NUM" ] && [ -z "$SHA" ]; then
  if [ -z "$BRANCH" ]; then
    echo "ERROR: 无法获取当前分支名，也无法定位 PR（可改用 --pr 或 --sha）" >&2
    exit 3
  fi
  PR_NUM=$(gh pr list --repo "$OWNER_REPO" --head "$BRANCH" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
  if [ -z "$PR_NUM" ]; then
    echo "ERROR: 当前分支 $BRANCH 没有 open PR，无法获取 PR 真实 CI。" >&2
    echo "       请先开 PR（gh pr create）或显式传 --pr <number>；" >&2
    echo "       若只想看 commit 级 checks（不代表 PR CI），传 --sha $(git rev-parse HEAD 2>/dev/null)。" >&2
    exit 3
  fi
  echo "  [ci] 分支 $BRANCH 命中 open PR #${PR_NUM}"
fi

# ---- 模式 A：查 PR 的真实 CI（结构化 JSON + bucket 判定）----
if [ -n "$PR_NUM" ]; then
  echo "  [ci] 查询 PR #${PR_NUM} 的 checks..."
  elapsed=0
  while true; do
    # gh pr checks --json 的 bucket 字段把 state 归类为 pass/fail/pending/skipping/cancel；
    # 仅 pass/skipping 视为成功，pending 等待，cancel/未知状态视为失败。
    # 注意：存在 pending/queued 的 check 时 gh pr checks 返回退出码 8（Checks pending），
    # 这是正常未完成态，不是错误——只有 8 之外的非 0 才是真错误（如鉴权/网络）。
    out=$(gh pr checks "$PR_NUM" --repo "$OWNER_REPO" --json bucket,name,state,link 2>/dev/null)
    rc=$?
    if [ "$rc" -ne 0 ] && [ "$rc" -ne 8 ]; then
      echo "ERROR: 调用 gh pr checks 失败（exit=$rc）" >&2
      exit 3
    fi

    if [ -z "$out" ] || [ "$out" = "[]" ]; then
      echo "  [ci] PR #${PR_NUM} 暂无 checks，继续等待..."
    else
      total=$(echo "$out" | jq 'length')
      failed=$(echo "$out" | jq '[.[] | select(.bucket != "pass" and .bucket != "skipping" and .bucket != "pending")] | length')
      pending=$(echo "$out" | jq '[.[] | select(.bucket == "pending")] | length')
      echo "  [ci] PR#${PR_NUM} total=${total} pending=${pending} failed=${failed} (elapsed=${elapsed}s)"
      echo "$out" | jq -r '.[] | "  - \(.name): \(.bucket)"'
      if [ "$failed" -gt 0 ]; then
        echo "$out" | jq -r '.[] | select(.bucket != "pass" and .bucket != "skipping" and .bucket != "pending") | "  ✗ \(.name) [\(.bucket)] → \(.link // "")"'
        echo "CI_FAIL:${failed}/${total}:pr=${PR_NUM}"
        exit 1
      fi
      if [ "$pending" -eq 0 ] && [ "$total" -gt 0 ]; then
        # 无失败/取消/未知状态且无 pending → 视为通过（仅 pass/skipping）
        echo "CI_PASS:${total}/${total}:pr=${PR_NUM}"
        exit 0
      fi
    fi
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
      echo "TIMEOUT: 超过 ${TIMEOUT}s PR #${PR_NUM} 仍有 checks 未完成" >&2
      exit 2
    fi
    sleep "$INTERVAL"
    elapsed=$((elapsed + INTERVAL))
  done
fi

# ---- 模式 B：仅查 commit 的 checks（仅供参考，不代表 PR CI）----
if [ -z "$SHA" ]; then
  SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
fi
if [ -z "$SHA" ]; then
  echo "ERROR: 无法获取 commit SHA" >&2
  exit 3
fi

echo "WARNING: 当前为 commit 级检查（--sha），其结果不代表 PR 真实 CI。" >&2
echo "         GitHub 多数仓库仅在 pull_request 事件跑完整 CI；未开 PR 时该 commit 可能无 checks。" >&2

api_url="https://api.github.com/repos/${OWNER_REPO}/commits/${SHA}/check-runs?per_page=100"

elapsed=0
while true; do
  resp=$(gh api "$api_url" 2>/dev/null) || {
    echo "ERROR: 调用 GitHub API 失败" >&2
    exit 3
  }

  # 取每个 workflow/job 的最新一次 run
  summary=$(echo "$resp" | jq -r '
    .check_runs
    | group_by(.name)
    | map(max_by(.started_at // .created_at))
    | {
        total: length,
        running: map(select(.status != "completed")) | length,
        success: map(select(.status == "completed" and (.conclusion == "success" or .conclusion == "neutral" or .conclusion == "skipped"))) | length,
        failed:  map(select(.status == "completed" and .conclusion != "success" and .conclusion != "neutral" and .conclusion != "skipped")) | length
      }
  ')

  total=$(echo "$summary" | jq -r '.total')
  running=$(echo "$summary" | jq -r '.running')
  success=$(echo "$summary" | jq -r '.success')
  failed=$(echo "$summary" | jq -r '.failed')

  if [ "$total" -eq 0 ]; then
    # 可能 CI 还没触发，等一会
    echo "  [ci] 当前 commit 暂无 checks，继续等待..."
    sleep "$INTERVAL"
    elapsed=$((elapsed + INTERVAL))
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
      echo "TIMEOUT: 超过 ${TIMEOUT}s 仍未检测到 checks" >&2
      exit 2
    fi
    continue
  fi

  echo "  [ci] checks=${total} running=${running} success=${success} failed=${failed} (elapsed=${elapsed}s)"

  if [ "$failed" -gt 0 ]; then
    details=$(echo "$resp" | jq -r '
      .check_runs
      | group_by(.name)
      | map(max_by(.started_at // .created_at))
      | map(select(.status == "completed" and .conclusion != "success" and .conclusion != "neutral" and .conclusion != "skipped"))
      | map("- " + .name + ": " + .conclusion + " (" + (.html_url // "") + ")")
      | join("\n")
    ')
    echo "CI_FAIL:${failed}/${total}:sha=${SHA}"
    echo "$details"
    exit 1
  fi

  if [ "$running" -eq 0 ] && [ "$success" -eq "$total" ]; then
    echo "CI_PASS:${total}/${total}:sha=${SHA}"
    exit 0
  fi

  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "TIMEOUT: 超过 ${TIMEOUT}s 仍有 checks 未完成" >&2
    exit 2
  fi

  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done
