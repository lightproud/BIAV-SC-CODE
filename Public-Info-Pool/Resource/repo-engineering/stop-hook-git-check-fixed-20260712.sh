#!/bin/bash
# stop-hook-git-check.sh — 修复版（守密人 2026-07-12 裁定项 3）
#
# 相对原版唯一变更：豁免「GitHub 平台生成、且已在 origin/main 祖先内」的提交
# （squash 合并主提交，committer=noreply@github.com，GitHub 侧实为 web-flow 签名
#  Verified）——它们是 main 历史，非本会话待推提交，不应要求 reset-author 重写。
#
# 安装（守密人本机执行一次）：
#   cp <本文件> ~/.claude/stop-hook-git-check.sh && chmod +x ~/.claude/stop-hook-git-check.sh

# Read the JSON input from stdin
input=$(cat)

# Check if stop hook is already active (recursion prevention)
stop_hook_active=$(echo "$input" | jq -r '.stop_hook_active')
if [[ "$stop_hook_active" = "true" ]]; then
  exit 0
fi

# Check if we're in a git repository - bail if not
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# Bail if there's no remote to push to. Every error path below asks the user
# to "push to the remote branch" — meaningless without a remote, and
# unsatisfiable if signing also requires a source. This case arises when CCR
# was launched against a local repo with no github remote (sources=[]) and
# the container's cwd has a leftover .git from a cached resume.
if [[ -z "$(git remote)" ]]; then
  exit 0
fi

# Check for uncommitted changes (both staged and unstaged)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "There are uncommitted changes in the repository. Please commit and push these changes to the remote branch." >&2
  exit 2
fi

# Check for untracked files that might be important
untracked_files=$(git ls-files --others --exclude-standard)
if [[ -n "$untracked_files" ]]; then
  echo "There are untracked files in the repository. Please commit and push these changes to the remote branch." >&2
  exit 2
fi

current_branch=$(git branch --show-current)
if [[ -n "$current_branch" ]]; then
  if git rev-parse "origin/$current_branch" >/dev/null 2>&1; then
    upstream="origin/$current_branch"
  else
    upstream="origin/HEAD"
  fi

  # Check for local commits that GitHub will show as "Unverified": either no
  # signature at all (%G? == N), or signed with a committer email other than
  # noreply@anthropic.com (the identity CCR's signing key is registered to).
  # Only run when commit signing is configured. Note: %G? is N for unsigned
  # commits; signed-but-locally-unverifiable commits report B/U/E, so this is
  # a reliable presence check even though CCR doesn't configure local verification.
  if [[ "$(git config --type=bool commit.gpgsign 2>/dev/null)" == "true" ]]; then
    unverifiable=$(git log --format='%h %G? %ce' "$upstream..HEAD" 2>/dev/null | awk '$2 == "N" || $3 != "noreply@anthropic.com"')
    # Exemption (2026-07-12, keeper-adjudicated): GitHub-authored commits
    # (squash-merge commits, committer noreply@github.com) that are already
    # in origin/main ancestry are platform-signed (web-flow key, shown as
    # Verified on GitHub) and are main history — not ours to rewrite. They
    # get swept in when the local branch is aligned to origin/main while
    # the remote feature branch is stale.
    if [[ -n "$unverifiable" ]] && git rev-parse origin/main >/dev/null 2>&1; then
      unverifiable=$(echo "$unverifiable" | while read -r h g ce; do
        if [[ "$ce" == "noreply@github.com" ]] && git merge-base --is-ancestor "$h" origin/main 2>/dev/null; then
          continue
        fi
        echo "$h $g $ce"
      done)
    fi
    if [[ -n "$unverifiable" ]]; then
      echo "There are commit(s) on branch '$current_branch' that GitHub will show as Unverified (missing signature, or committer email is not noreply@anthropic.com):" >&2
      echo "$unverifiable" >&2
      echo "Please run 'git config user.email noreply@anthropic.com && git config user.name Claude', then 'git commit --amend --no-edit --reset-author' for the tip commit, or 'git rebase --exec \"git commit --amend --no-edit --reset-author\" $upstream' for earlier commits, then push." >&2
      exit 2
    fi
  fi

  unpushed=$(git rev-list "$upstream..HEAD" --count 2>/dev/null) || unpushed=0
  if [[ "$unpushed" -gt 0 ]]; then
    if [[ "$upstream" == "origin/$current_branch" ]]; then
      echo "There are $unpushed unpushed commit(s) on branch '$current_branch'. Please push these changes to the remote repository." >&2
    else
      echo "Branch '$current_branch' has $unpushed unpushed commit(s) and no remote branch. Please push these changes to the remote repository." >&2
    fi
    exit 2
  fi
fi

exit 0
