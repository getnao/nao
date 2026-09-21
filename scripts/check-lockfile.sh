#!/usr/bin/env bash
set -e

# Rewrites package-lock.json from package.json alone (no node_modules involved)
# and fails when that changes the file. npm derives the "dev"/"peer"/"optional"
# flags from whatever tree it finds on disk, so partial installs
# (npm install <pkg>, npm update, npm install --no-save) leave the lock in a shape
# that the next full install flips back — the flags alternate forever. Normalising
# through --package-lock-only makes the file a pure function of package.json and
# the npm version pinned in "engines".

cd "$(dirname "$0")/.."

BEFORE=$(mktemp)
trap 'rm -f "$BEFORE"' EXIT
cp package-lock.json "$BEFORE"

npm install --package-lock-only --ignore-scripts --no-audit --no-fund

if ! cmp -s package-lock.json "$BEFORE"; then
	echo ""
	echo "❌ package-lock.json was not in its canonical form and has been rewritten."
	echo "   Review and stage it, then commit again:"
	echo ""
	echo "     git add package-lock.json"
	echo ""
	exit 1
fi

echo "✅ package-lock.json is canonical"
