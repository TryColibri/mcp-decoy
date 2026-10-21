#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
NAME=$(echo "$INPUT" | jq -r '.name')
REPO_PATH="$CLAUDE_PROJECT_DIR"
WORKTREE_PATH="${REPO_PATH}/.claude/worktrees/${NAME}"
BRANCH="worktree-${NAME}"

branch_exists() {
  git -C "$REPO_PATH" show-ref --verify --quiet "refs/heads/${BRANCH}"
}

worktree_exists() {
  git -C "$REPO_PATH" worktree list --porcelain | grep -Fxq "worktree ${WORKTREE_PATH}"
}

# Create the git worktree — redirect git output away from stdout!
mkdir -p "${REPO_PATH}/.claude/worktrees"

if branch_exists && worktree_exists; then
  echo "$WORKTREE_PATH"
  exit 0
fi

if branch_exists; then
  git -C "$REPO_PATH" worktree add "$WORKTREE_PATH" "$BRANCH" 1>&2
elif worktree_exists; then
  git -C "$WORKTREE_PATH" checkout -b "$BRANCH" 1>&2
else
  git -C "$REPO_PATH" worktree add -b "$BRANCH" "$WORKTREE_PATH" HEAD 1>&2
fi

cd "$WORKTREE_PATH"
pnpm install 1>&2

echo "$WORKTREE_PATH"
