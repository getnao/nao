#!/usr/bin/env bash
set -e

# =============================================================================
# PR Preview Cleanup Script
# =============================================================================
#
# Removes a PR preview instance from the server.
# This script is designed to run on the GCP VM.
#
# USAGE:
#   ./preview-cleanup.sh <PR_NUMBER>
#
# EXAMPLE:
#   ./preview-cleanup.sh 142
#
# =============================================================================

PR_NUMBER="${1:?Error: PR_NUMBER required}"

CONTAINER_NAME="nao-preview-${PR_NUMBER}"
NGINX_CONF_DIR="/home/github-actions-demo/nginx/preview.d"

echo "=== Cleaning up PR Preview ==="
echo "  PR: #${PR_NUMBER}"
echo ""

# Stop and remove container
echo "Stopping container..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null || echo "  Container not found"

# Remove nginx configs (handles any commit SHA in the name)
echo "Removing nginx config..."
rm -f "${NGINX_CONF_DIR}/pr-${PR_NUMBER}-"*.conf

# Reload nginx
echo "Reloading nginx..."
docker exec nginx nginx -s reload 2>/dev/null || echo "  Could not reload nginx"


# Clean up docker images for this PR
echo "Cleaning up images..."
docker images --format "{{.Repository}}:{{.Tag}}" | grep -F ":pr-${PR_NUMBER}-" | xargs -r docker rmi 2>/dev/null || true

echo ""
echo "=== Cleanup Complete ==="
