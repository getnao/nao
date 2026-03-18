#!/usr/bin/env bash
set -e

# =============================================================================
# PR Preview Deployment Script
# =============================================================================
#
# Deploys a PR preview instance on the server.
# This script is designed to run on the GCP VM.
#
# USAGE:
#   ./preview-deploy.sh <PR_NUMBER> <SHORT_SHA> <IMAGE_TAG>
#
# EXAMPLE:
#   ./preview-deploy.sh 142 abc1234 ghcr.io/naolabs/chat/preview:pr-142-abc1234
#
# ENVIRONMENT:
#   GITHUB_TOKEN - Required for pulling from ghcr.io
#
# =============================================================================

PR_NUMBER="${1:?Error: PR_NUMBER required}"
SHORT_SHA="${2:?Error: SHORT_SHA required}"
IMAGE="${3:?Error: IMAGE tag required}"

PREVIEW_NAME="pr-${PR_NUMBER}-${SHORT_SHA}"
PREVIEW_PORT=$((5100 + PR_NUMBER))
CONTAINER_NAME="nao-preview-${PR_NUMBER}"
NGINX_CONF_DIR="/home/github-actions-demo/nginx/preview.d"

echo "=== Deploying PR Preview ==="
echo "  PR:        #${PR_NUMBER}"
echo "  Commit:    ${SHORT_SHA}"
echo "  Name:      ${PREVIEW_NAME}"
echo "  Port:      ${PREVIEW_PORT}"
echo "  Image:     ${IMAGE}"
echo ""

# Pull the image
echo "Pulling image..."
docker pull "$IMAGE"

# Stop existing container if running
echo "Stopping existing container..."
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true


# Run the container
echo "Starting container..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${PREVIEW_PORT}:5005" \
    -e "BETTER_AUTH_URL=https://${PREVIEW_NAME}.preview.getnao.io" \
    -e "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" \
    -e "NAO_CONTEXT_SOURCE=local" \
    -e "NAO_DEFAULT_PROJECT_PATH=/app/example" \
    "$IMAGE"

# Wait for container to be ready
echo "Waiting for container to start..."
sleep 10

# Run database seed
echo "Seeding database..."
docker exec "$CONTAINER_NAME" bun run apps/backend/scripts/db.seed.ts || {
    echo "Warning: Seeding failed, container may not be fully ready"
}

# Create nginx config
echo "Configuring nginx..."
mkdir -p "$NGINX_CONF_DIR"
echo "\"~^${PREVIEW_NAME}\" ${PREVIEW_PORT};" > "${NGINX_CONF_DIR}/${PREVIEW_NAME}.conf"

# Reload nginx
docker exec nginx nginx -s reload 2>/dev/null || {
    echo "Warning: Could not reload nginx - may need manual reload"
}

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Preview URL: https://${PREVIEW_NAME}.preview.getnao.io"
echo ""
echo "Test credentials:"
echo "  Email:    test@test.test"
echo "  Password: test1234"
