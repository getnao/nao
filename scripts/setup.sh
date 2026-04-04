#!/bin/bash
set -e

echo "Setting up project..."

# Navigate to project root (one level up from scripts/)
cd "$(dirname "$0")/.."

# Use Node 22
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use

# Install all dependencies (root + all workspaces)
echo "Installing dependencies..."
npm install

# Run database migrations
echo "Running database migrations..."
npm run db:migrate -w @nao/backend

echo "Setup complete."
