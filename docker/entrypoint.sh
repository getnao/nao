#!/bin/bash
set -e

echo "=== nao Chat Server Entrypoint ==="

# Default values — cloud mode manages projects dynamically via the API
if [ "$NAO_MODE" = "cloud" ]; then
    NAO_CONTEXT_SOURCE="${NAO_CONTEXT_SOURCE:-api}"
    unset NAO_DEFAULT_PROJECT_PATH
else
    NAO_CONTEXT_SOURCE="${NAO_CONTEXT_SOURCE:-local}"
    NAO_DEFAULT_PROJECT_PATH="${NAO_DEFAULT_PROJECT_PATH:-/app/context}"
fi

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
    NAO_CONTEXT_GIT_SUBPATH="${NAO_CONTEXT_GIT_SUBPATH#/}"
    NAO_CONTEXT_GIT_SUBPATH="${NAO_CONTEXT_GIT_SUBPATH%/}"
    
    # Pick auth scheme from URL: SSH (deploy key) vs HTTPS (PAT or anonymous)
    GIT_URL="$NAO_CONTEXT_GIT_URL"
    case "$NAO_CONTEXT_GIT_URL" in
        git@*|ssh://*)
            if [ -z "$NAO_CONTEXT_GIT_SSH_KEY" ]; then
                echo "ERROR: SSH git URL requires NAO_CONTEXT_GIT_SSH_KEY"
                exit 1
            fi
            
            SSH_DIR="/tmp/.nao-ssh"
            mkdir -p "$SSH_DIR"
            chmod 700 "$SSH_DIR"
            
            SSH_KEY_FILE="$SSH_DIR/id_deploy"
            printf '%s\n' "$NAO_CONTEXT_GIT_SSH_KEY" > "$SSH_KEY_FILE"
            chmod 600 "$SSH_KEY_FILE"
            
            # Pre-pin GitHub host keys (sourced from https://api.github.com/meta)
            KNOWN_HOSTS_FILE="$SSH_DIR/known_hosts"
            cat > "$KNOWN_HOSTS_FILE" <<'EOF'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
EOF
            chmod 644 "$KNOWN_HOSTS_FILE"
            
            export GIT_SSH_COMMAND="ssh -i $SSH_KEY_FILE -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS_FILE -o StrictHostKeyChecking=yes"
            echo "Using SSH deploy key authentication"
            ;;
        https://*|http://*)
            if [ -n "$NAO_CONTEXT_GIT_TOKEN" ]; then
                GIT_URL=$(echo "$NAO_CONTEXT_GIT_URL" | sed "s|https://|https://${NAO_CONTEXT_GIT_TOKEN}@|")
                echo "Using HTTPS token authentication"
            fi
            ;;
        *)
            echo "ERROR: Unsupported NAO_CONTEXT_GIT_URL scheme: $NAO_CONTEXT_GIT_URL"
            echo "Use https://… (with optional NAO_CONTEXT_GIT_TOKEN) or git@…/ssh://… (with NAO_CONTEXT_GIT_SSH_KEY)"
            exit 1
            ;;
    esac
    
    # Clone or pull
    if [ -d "$NAO_DEFAULT_PROJECT_PATH/.git" ]; then
        echo "Repository exists, pulling latest..."
        cd "$NAO_DEFAULT_PROJECT_PATH"
        if [ -n "$NAO_CONTEXT_GIT_SUBPATH" ]; then
            git sparse-checkout set "$NAO_CONTEXT_GIT_SUBPATH"
        fi
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
        
        if [ -n "$NAO_CONTEXT_GIT_SUBPATH" ]; then
            echo "Sparse checkout: only fetching '$NAO_CONTEXT_GIT_SUBPATH'"
            git clone --branch "$NAO_CONTEXT_GIT_BRANCH" --depth 1 --single-branch \
                --filter=blob:none --sparse "$GIT_URL" "$NAO_DEFAULT_PROJECT_PATH"
            cd "$NAO_DEFAULT_PROJECT_PATH"
            git sparse-checkout set "$NAO_CONTEXT_GIT_SUBPATH"
        else
            git clone --branch "$NAO_CONTEXT_GIT_BRANCH" --depth 1 --single-branch "$GIT_URL" "$NAO_DEFAULT_PROJECT_PATH"
        fi
        echo "✓ Context cloned"
    fi
    
    # Resolve project path (subpath if set, else repo root)
    if [ -n "$NAO_CONTEXT_GIT_SUBPATH" ]; then
        NAO_DEFAULT_PROJECT_PATH="$NAO_DEFAULT_PROJECT_PATH/$NAO_CONTEXT_GIT_SUBPATH"
    fi
    
    # Validate context
    if [ ! -f "$NAO_DEFAULT_PROJECT_PATH/nao_config.yaml" ]; then
        echo "ERROR: nao_config.yaml not found in $NAO_DEFAULT_PROJECT_PATH"
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

elif [ "$NAO_CONTEXT_SOURCE" = "api" ]; then
    echo ""
    echo "=== API Context Mode ==="
    echo "Context will be deployed via nao deploy CLI command."
    export NAO_PROJECTS_DIR="${NAO_PROJECTS_DIR:-/app/projects}"
    mkdir -p "$NAO_PROJECTS_DIR"
    chown nao:nao "$NAO_PROJECTS_DIR"
    unset NAO_DEFAULT_PROJECT_PATH

else
    echo "ERROR: Unknown NAO_CONTEXT_SOURCE: $NAO_CONTEXT_SOURCE"
    echo "Must be 'local', 'git', or 'api'"
    exit 1
fi

echo ""
echo "=== Starting Services ==="

# Grant the nao user access to /dev/kvm if it exists (needed for Boxlite sandboxing)
if [ -e /dev/kvm ]; then
    KVM_GID=$(stat -c '%g' /dev/kvm)
    if ! getent group kvm > /dev/null 2>&1; then
        groupadd -g "$KVM_GID" kvm
    fi
    usermod -aG kvm nao
    echo "✓ Added nao user to kvm group (GID $KVM_GID)"
fi

# Generate BETTER_AUTH_SECRET if not provided
if [ -z "$BETTER_AUTH_SECRET" ]; then
    export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
    echo "⚠ BETTER_AUTH_SECRET not set — generated a random one."
    echo "  Sessions will not persist across restarts. Set BETTER_AUTH_SECRET for persistence."
fi

# Export the path for child processes
if [ "$NAO_MODE" != "cloud" ]; then
    export NAO_DEFAULT_PROJECT_PATH
fi

# Start supervisord (which manages FastAPI and Chat Server)
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/nao.conf
