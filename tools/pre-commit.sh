#!/bin/sh
# Pre-commit guard: the generated HTML must match a fresh build.
#
# The site is generated from tools/, but the output is committed. Editing a page
# module and forgetting to rebuild leaves the site stale with no visible symptom,
# so this refuses the commit instead.
#
# Install with:  ln -s ../../tools/pre-commit.sh .git/hooks/pre-commit

set -e

cd "$(git rev-parse --show-toplevel)"

# Only relevant when something that feeds the build changed.
if ! git diff --cached --name-only | grep -qE '^(tools/.*\.py|.*\.html)$'; then
  exit 0
fi

python3 tools/build.py >/dev/null

if ! git diff --quiet -- '*.html'; then
  echo "pre-commit: generated HTML is stale after rebuilding." >&2
  echo "            commit the rebuilt index.html / install.html." >&2
  git diff --stat -- '*.html' >&2
  exit 1
fi

python3 tools/check-links.py
