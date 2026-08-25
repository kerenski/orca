#!/usr/bin/env bash
# kimi-trust.sh —— 预信任一个 worktree 目录，让 kimi 交互模式不再弹「Trust this folder?」
# 用法: bash skills/orca-skill/scripts/kimi-trust.sh <worktree-absolute-path>
# 原理: kimi 把信任状态存在 ~/.kimi-code/workspace-trust/wd_<name>_<sha256(path)[:12]>
#       内容为 {"root":"<path>","trustedAt":<ms>}。预置后 kimi --yolo 不会退出。
set -euo pipefail

WT_PATH="${1:-}"
if [ -z "$WT_PATH" ]; then
  echo "用法: bash skills/orca-skill/scripts/kimi-trust.sh <worktree-absolute-path>" >&2
  exit 1
fi

# 转绝对路径
WT_PATH="$(cd "$WT_PATH" 2>/dev/null && pwd)"
if [ -z "$WT_PATH" ]; then
  echo "ERROR: 路径不存在: $1" >&2
  exit 1
fi

NAME="$(basename "$WT_PATH")"
HASH="$(printf '%s' "$WT_PATH" | shasum -a 256 | cut -c1-12)"
KEY="wd_${NAME}_${HASH}"
TRUST_DIR="$HOME/.kimi-code/workspace-trust"
TRUST_FILE="$TRUST_DIR/$KEY"
TRUSTED_AT="$(date +%s)000"

mkdir -p "$TRUST_DIR"
if [ -f "$TRUST_FILE" ]; then
  echo "OK: 已信任 $WT_PATH (key=$KEY)"
else
  printf '{"root":"%s","trustedAt":%s}\n' "$WT_PATH" "$TRUSTED_AT" > "$TRUST_FILE"
  echo "DONE: 已为 $WT_PATH 写入 kimi 信任 (key=$KEY)"
fi
