#!/usr/bin/env bash
# send-dev-task.sh —— 向 worker 发首轮开发指令（固定话术：本地检查 + 日志 sentinel + commit/push）
# 话术要点来自 方案/Orca两层编排闭环流程-v2.md §7（内置在脚本里，controller 无需记忆）
#
# 用法：bash $HOME/.orca-skill/scripts/send-dev-task.sh --issue <n> --card <c> --worker <handle> [--extra "<补充要求>"]
# 输出：DEV_TASK_SENT:<issue>-<card> -> <handle>
# 退出码：0 成功；1 参数错误；2 发送失败

set -uo pipefail

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

# 拉取 issue 标题与正文，内联进指令（避免 worker 自行 gh issue view 时跳过/读错）
ISSUE_TITLE=$(gh issue view "${ISSUE}" --json title -q .title 2>/dev/null || echo "")
ISSUE_BODY=$(gh issue view "${ISSUE}" --json body -q .body 2>/dev/null || echo "")
if [ -z "$ISSUE_BODY" ]; then
  echo "ERROR: 无法获取 issue #${ISSUE} 正文（gh issue view 失败或网络问题）" >&2
  exit 1
fi

# 自校验（防 review 阶段被误调为首轮开发）：仅校验"当前 issue+card"的日志文件是否已有首轮锚点，
# 不扫其他 issue 的日志（避免误判 #38 等遗留日志为本卡修复轮）。
ANCHOR_FILE=$(ls 开发日志/*/${ISSUE}-${CARD}.md 2>/dev/null | head -1)
if [ -n "$ANCHOR_FILE" ] && grep -q "## 开发任务（首轮）" "$ANCHOR_FILE"; then
  echo "ERROR: 检测到本卡首轮开发日志已存在（${ANCHOR_FILE}），当前应为 review 修复轮，禁止使用 send-dev-task.sh 重发首轮。" >&2
  echo "       请改用：bash $HOME/.orca-skill/scripts/send-review.sh --issue ${ISSUE} --card ${CARD} --round <N> --worker <handle> --file <意见md>" >&2
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
2. 按改动范围先跑本地检查链（app/ 目录内）：ruff check && mypy app && pytest，必须全部返回 0。
3. 全部通过后，写开发日志：开发日志/$(date +%Y-%m-%d)/${ISSUE}-${CARD}.md（目录不存在则创建）。
   首行锚点必须是独立完整的一行：「## 开发任务（首轮）」，其下写：改动范围 / 改动概要 / commit 短哈希。
4. git add -A && git commit -m \"${ISSUE} ${CARD}: 开发完成（含开发日志）\" && git push origin HEAD
5. 只有同时满足 (1) git diff --stat origin/main...HEAD 含业务代码改动 且 (2) 三闸全部返回 0 且 (3) 开发日志已 commit，才允许回复：「开发完成，等待 review」。未完成上述任一项不得回复此句。"

if [ -n "$EXTRA" ]; then
  MSG="${MSG}

【补充要求】
${EXTRA}"
fi

if orca terminal send --terminal "$HANDLE" --text "$MSG" --enter --json >/dev/null 2>&1; then
  echo "DEV_TASK_SENT:${ISSUE}-${CARD} -> ${HANDLE}"
else
  echo "ERROR: 发送失败（handle 可能已失效，先跑 ensure-worker.sh --force 重建）" >&2
  exit 2
fi
