#!/usr/bin/env bash
# send-review-round.sh —— send-review.sh 的易区分别名（B 治标之二）
# 两个名字指向同一逻辑；用本名能让 controller 更直观区分「发修复轮」(send-review-round.sh)
# 与「发首轮开发」(send-dev-task.sh)，降低张冠李戴概率。保留 send-review.sh 兼容性。
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/send-review.sh" "$@"
