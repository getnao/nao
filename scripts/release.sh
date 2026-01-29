#!/usr/bin/env bash
set -e

# Release script: bumps version, commits, and creates a git tag
# Usage: ./scripts/release.sh [patch|minor|major]
# Default: patch

BUMP_TYPE="${1:-patch}"

cd cli
python build.py --bump "$BUMP_TYPE" --skip-server
VERSION=$(grep '^version' pyproject.toml | sed 's/.*"\(.*\)"/\1/')
cd ..

git add -A
git commit -m "chore: bump version to $VERSION"
git tag "v$VERSION"

echo ""
echo "✅ Created tag v$VERSION. Run 'git push origin main --tags' to trigger the release."
