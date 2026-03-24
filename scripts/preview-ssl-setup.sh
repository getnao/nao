#!/usr/bin/env bash
set -e

# =============================================================================
# Wildcard SSL Certificate Setup for PR Previews
# =============================================================================
#
# This script sets up a wildcard SSL certificate for *.preview.getnao.io
# using acme.sh with GoDaddy DNS validation.
#
# PREREQUISITES:
# 1. SSH into the GCP VM
# 2. Get GoDaddy API credentials:
#    - Go to https://developer.godaddy.com/keys
#    - Create a "Production" API key (NOT "Test")
#    - You'll get a Key and Secret
#
# 3. Add DNS record in GoDaddy:
#    - Type: A
#    - Name: *.preview
#    - Value: <GCP VM IP address>
#    - TTL: 1 Hour (or default)
#
# USAGE:
#   export GD_Key="your_godaddy_api_key"
#   export GD_Secret="your_godaddy_api_secret"
#   ./preview-ssl-setup.sh
#
# =============================================================================

echo "=== Wildcard SSL Setup for *.preview.getnao.io ==="

# Check for required environment variables
if [ -z "$GD_Key" ] || [ -z "$GD_Secret" ]; then
    echo "ERROR: GoDaddy API credentials not set."
    echo ""
    echo "Please set the following environment variables:"
    echo "  export GD_Key=\"your_godaddy_api_key\""
    echo "  export GD_Secret=\"your_godaddy_api_secret\""
    echo ""
    echo "Get your API keys at: https://developer.godaddy.com/keys"
    echo "(Make sure to create a PRODUCTION key, not Test)"
    exit 1
fi

# Install acme.sh if not present
if [ ! -f ~/.acme.sh/acme.sh ]; then
    echo "Installing acme.sh..."
    curl https://get.acme.sh | sh -s email=admin@getnao.io
    source ~/.bashrc
fi

# Create certificate directory
sudo mkdir -p /etc/letsencrypt/live/preview.getnao.io

# Issue certificate using GoDaddy DNS
echo "Issuing wildcard certificate for *.preview.getnao.io..."
~/.acme.sh/acme.sh --issue \
    -d "*.preview.getnao.io" \
    --dns dns_gd \
    --dnssleep 120

# Install certificate to the expected location
echo "Installing certificate..."
~/.acme.sh/acme.sh --install-cert -d "*.preview.getnao.io" \
    --key-file /etc/letsencrypt/live/preview.getnao.io/privkey.pem \
    --fullchain-file /etc/letsencrypt/live/preview.getnao.io/fullchain.pem \
    --reloadcmd "docker exec nginx nginx -s reload 2>/dev/null || true"

# Create preview config directory for nginx
sudo mkdir -p /home/github-actions-demo/nginx/preview.d
sudo chown -R github-actions-demo:github-actions-demo /home/github-actions-demo/nginx/preview.d

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Certificate installed at:"
echo "  - /etc/letsencrypt/live/preview.getnao.io/fullchain.pem"
echo "  - /etc/letsencrypt/live/preview.getnao.io/privkey.pem"
echo ""
echo "The certificate will auto-renew via acme.sh cron job."
echo ""
echo "Next steps:"
echo "  1. Update nginx config to include the preview server block"
echo "  2. Restart nginx container with the new config"
