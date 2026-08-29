#!/usr/bin/env bash
# send-review-round.sh —— 兼容 wrapper，直接调用 send-task.sh
# 保留别名兼容性；新代码请直接使用 send-task.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/send-task.sh" "$@"
