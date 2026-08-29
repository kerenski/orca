#!/usr/bin/env bash
# send-dev-task.sh —— 兼容 wrapper，内部调用 send-task.sh --round 0
# 新代码请直接使用 send-task.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/send-task.sh" --round 0 "$@"
