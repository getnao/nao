#!/bin/bash
set -e

echo "=== nao Chat Server Entrypoint ==="

# Default values
NAO_CONTEXT_SOURCE="${NAO_CONTEXT_SOURCE:-local}"
NAO_DEFAULT_PROJECT_PATH="${NAO_DEFAULT_PROJECT_PATH:-/app/context}"

echo "Context source: $NAO_CONTEXT_SOURCE"
echo "Target path: $NAO_DEFAULT_PROJECT_PATH"

# Initialize context based on source type
if [ "$NAO_CONTEXT_SOURCE" = "git" ]; then
    echo ""
    echo "=== Initializing Git Context ==="
    
    if [ -z "$NAO_CONTEXT_GIT_URL" ]; then
        echo "ERROR: NAO_CONTEXT_GIT_URL is required when NAO_CONTEXT_SOURCE=git"
        exit 1
    fi
    
    NAO_CONTEXT_GIT_BRANCH="${NAO_CONTEXT_GIT_BRANCH:-main}"
    
    # Build auth URL if token provided
    GIT_URL="$NAO_CONTEXT_GIT_URL"
    if [ -n "$NAO_CONTEXT_GIT_TOKEN" ]; then
        # Inject token into HTTPS URL
        GIT_URL=$(echo "$NAO_CONTEXT_GIT_URL" | sed "s|https://|https://${NAO_CONTEXT_GIT_TOKEN}@|")
        echo "Using authenticated git URL"
    fi
    
    # Clone or pull
    if [ -d "$NAO_DEFAULT_PROJECT_PATH/.git" ]; then
        echo "Repository exists, pulling latest..."
        cd "$NAO_DEFAULT_PROJECT_PATH"
        git fetch "$GIT_URL" "$NAO_CONTEXT_GIT_BRANCH" --depth=1
        git reset --hard FETCH_HEAD
        echo "✓ Context updated"
    else
        echo "Cloning repository..."
        # Ensure parent directory exists
        mkdir -p "$(dirname "$NAO_DEFAULT_PROJECT_PATH")"
        
        # Remove target if it exists but isn't a git repo
        if [ -d "$NAO_DEFAULT_PROJECT_PATH" ]; then
            rm -rf "$NAO_DEFAULT_PROJECT_PATH"
        fi
        
        git clone --branch "$NAO_CONTEXT_GIT_BRANCH" --depth 1 --single-branch "$GIT_URL" "$NAO_DEFAULT_PROJECT_PATH"
        echo "✓ Context cloned"
    fi
    
    # Validate context
    if [ ! -f "$NAO_DEFAULT_PROJECT_PATH/nao_config.yaml" ]; then
        echo "ERROR: nao_config.yaml not found in cloned repository"
        exit 1
    fi
    
    echo "✓ Context validated"

elif [ "$NAO_CONTEXT_SOURCE" = "local" ]; then
    echo ""
    echo "=== Validating Local Context ==="
    
    if [ ! -d "$NAO_DEFAULT_PROJECT_PATH" ]; then
        echo "ERROR: Context path does not exist: $NAO_DEFAULT_PROJECT_PATH"
        echo "For local mode, ensure the path is mounted as a Docker volume"
        echo "or use NAO_CONTEXT_SOURCE=git for git-based context."
        exit 1
    fi
    
    if [ ! -f "$NAO_DEFAULT_PROJECT_PATH/nao_config.yaml" ]; then
        echo "ERROR: nao_config.yaml not found in $NAO_DEFAULT_PROJECT_PATH"
        echo "Ensure the context path contains a valid nao project."
        exit 1
    fi
    
    echo "✓ Local context validated"

else
    echo "ERROR: Unknown NAO_CONTEXT_SOURCE: $NAO_CONTEXT_SOURCE"
    echo "Must be 'local' or 'git'"
    exit 1
fi

echo ""
echo "=== Starting Services ==="

# Generate BETTER_AUTH_SECRET if not provided
if [ -z "$BETTER_AUTH_SECRET" ]; then
    export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
    echo "⚠ BETTER_AUTH_SECRET not set — generated a random one."
    echo "  Sessions will not persist across restarts. Set BETTER_AUTH_SECRET for persistence."
fi

# Export the path for child processes
export NAO_DEFAULT_PROJECT_PATH

# Start supervisord (which manages FastAPI and Chat Server)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/nao.conf
