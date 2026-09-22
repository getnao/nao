#!/usr/bin/env bash
set -e

# Installs the exact npm version declared in "packageManager". npm majors — and
# even minors — disagree on the "dev"/"peer"/"optional" flags they write into
# package-lock.json, so a single pinned version is what keeps the file stable
# across the team. Global installs are exempt from engine-strict, so this works
# even when the npm currently on PATH is the wrong one.

cd "$(dirname "$0")/.."

PINNED=$(node -p "require('./package.json').packageManager.replace('npm@', '')")
CURRENT=$(npm --version)

if [ "$CURRENT" = "$PINNED" ]; then
	echo "✅ npm $PINNED"
	exit 0
fi

echo "Replacing npm $CURRENT with the pinned npm $PINNED..."
npm install -g "npm@$PINNED"

INSTALLED=$(npm --version)
if [ "$INSTALLED" != "$PINNED" ]; then
	echo "❌ npm on PATH is still $INSTALLED — make sure your global npm prefix comes first in PATH"
	exit 1
fi

echo "✅ npm $PINNED"
