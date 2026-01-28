#!/bin/bash
#
# Polymarket Notifier Local Runner
# Interactive script to run the Polymarket notifier in one-shot mode
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

prompt() {
    echo -e "${GREEN}[?]${NC} $1"
}

# Header
echo ""
echo "=============================================="
echo "    Polymarket Notifier - Local Runner"
echo "=============================================="
echo ""
info "This script will guide you through running the Polymarket notifier locally in one-shot mode."
echo ""

# Step 1: Determine UMA Protocol path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The script is in packages/monitor-v2/src/monitor-polymarket/
UMA_PROTOCOL_DEFAULT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

echo "=============================================="
echo "  Step 1: Repository Paths"
echo "=============================================="
echo ""

info "Detected UMA Protocol path: $UMA_PROTOCOL_DEFAULT"
prompt "Press Enter to use this path, or enter a different path:"
read -r UMA_PROTOCOL_INPUT
UMA_PROTOCOL="${UMA_PROTOCOL_INPUT:-$UMA_PROTOCOL_DEFAULT}"

# Validate UMA Protocol path
if [[ ! -d "$UMA_PROTOCOL/packages/monitor-v2" ]]; then
    error "Invalid UMA Protocol path: $UMA_PROTOCOL"
    error "Could not find packages/monitor-v2 directory"
    exit 1
fi
success "UMA Protocol path: $UMA_PROTOCOL"
echo ""

# Check for bot-configs repository
prompt "Enter the path to your bot-configs repository (required for .env generation):"
echo "  If you don't have it, clone it first:"
echo "  git clone https://github.com/UMAprotocol/bot-configs.git"
echo ""
read -r UMA_BOT_CONFIGS

if [[ -z "$UMA_BOT_CONFIGS" ]]; then
    error "bot-configs path is required"
    exit 1
fi

# Expand ~ if present
UMA_BOT_CONFIGS="${UMA_BOT_CONFIGS/#\~/$HOME}"

if [[ ! -d "$UMA_BOT_CONFIGS" ]]; then
    error "bot-configs directory not found: $UMA_BOT_CONFIGS"
    exit 1
fi

if [[ ! -f "$UMA_BOT_CONFIGS/scripts/print-env-file.js" ]]; then
    error "Invalid bot-configs repository: scripts/print-env-file.js not found"
    exit 1
fi
success "bot-configs path: $UMA_BOT_CONFIGS"
echo ""

# Export paths
export UMA_PROTOCOL
export UMA_BOT_CONFIGS

# Step 2: Install dependencies in bot-configs
echo "=============================================="
echo "  Step 2: Install Dependencies (bot-configs)"
echo "=============================================="
echo ""

prompt "Do you need to install/update dependencies in bot-configs? (y/N)"
read -r INSTALL_BOT_CONFIGS_DEPS

if [[ "$INSTALL_BOT_CONFIGS_DEPS" =~ ^[Yy]$ ]]; then
    info "Installing dependencies in bot-configs..."
    cd "$UMA_BOT_CONFIGS"
    yarn install
    success "bot-configs dependencies installed"
else
    info "Skipping bot-configs dependency installation"
fi
echo ""

# Step 3: Generate .env file
echo "=============================================="
echo "  Step 3: Generate .env File"
echo "=============================================="
echo ""

ENV_FILE="$UMA_PROTOCOL/packages/monitor-v2/src/monitor-polymarket/.env.local"

if [[ -f "$ENV_FILE" ]]; then
    warn "Existing .env.local found: $ENV_FILE"
    prompt "Do you want to regenerate it? (y/N)"
    read -r REGENERATE_ENV
    GENERATE_ENV=false
    if [[ "$REGENERATE_ENV" =~ ^[Yy]$ ]]; then
        GENERATE_ENV=true
    fi
else
    GENERATE_ENV=true
fi

if [[ "$GENERATE_ENV" == "true" ]]; then
    info "Generating .env.local file..."

    node "$UMA_BOT_CONFIGS/scripts/print-env-file.js" \
        "$UMA_BOT_CONFIGS/serverless-bots/uma-config-5m.json" polymarket-polygon-notifier \
        | grep -Ev '^(SLACK_CONFIG|PAGER_DUTY_V2_CONFIG|DISCORD_CONFIG|DISCORD_TICKET_CONFIG|REDIS_URL|NODE_OPTIONS)=' \
        > "$ENV_FILE"

    # Add local-specific settings
    printf 'LOCAL_NO_DATASTORE=true\nNODE_OPTIONS=--max-old-space-size=16000\n' >> "$ENV_FILE"

    # Set POLLING_DELAY=0 for one-shot mode
    if grep -q '^POLLING_DELAY=' "$ENV_FILE"; then
        sed -i 's/^POLLING_DELAY=.*/POLLING_DELAY=0/' "$ENV_FILE"
    else
        echo 'POLLING_DELAY=0' >> "$ENV_FILE"
    fi

    success ".env.local generated at: $ENV_FILE"
else
    info "Using existing .env.local file"
    # Ensure POLLING_DELAY=0 for one-shot mode
    if grep -q '^POLLING_DELAY=' "$ENV_FILE"; then
        sed -i 's/^POLLING_DELAY=.*/POLLING_DELAY=0/' "$ENV_FILE"
    else
        echo 'POLLING_DELAY=0' >> "$ENV_FILE"
    fi
fi
echo ""

# Step 4: Build monitor-v2
echo "=============================================="
echo "  Step 4: Build monitor-v2 Package"
echo "=============================================="
echo ""

MONITOR_V2_DIR="$UMA_PROTOCOL/packages/monitor-v2"
DIST_FILE="$MONITOR_V2_DIR/dist/monitor-polymarket/index.js"

if [[ -f "$DIST_FILE" ]]; then
    info "Existing build found: $DIST_FILE"
    prompt "Do you want to rebuild? (y/N)"
    read -r REBUILD
    BUILD_NEEDED=false
    if [[ "$REBUILD" =~ ^[Yy]$ ]]; then
        BUILD_NEEDED=true
    fi
else
    BUILD_NEEDED=true
fi

if [[ "$BUILD_NEEDED" == "true" ]]; then
    info "Building monitor-v2 package..."
    cd "$MONITOR_V2_DIR"

    prompt "Do you need to install dependencies first? (y/N)"
    read -r INSTALL_DEPS
    if [[ "$INSTALL_DEPS" =~ ^[Yy]$ ]]; then
        yarn install
    fi

    yarn build
    success "monitor-v2 built successfully"
else
    info "Skipping build, using existing dist"
fi
echo ""

# Step 5: Run the notifier
echo "=============================================="
echo "  Step 5: Run Polymarket Notifier"
echo "=============================================="
echo ""

info "Configuration summary:"
echo "  - UMA Protocol: $UMA_PROTOCOL"
echo "  - bot-configs: $UMA_BOT_CONFIGS"
echo "  - ENV file: $ENV_FILE"
echo "  - Mode: one-shot (POLLING_DELAY=0)"
echo ""

prompt "Ready to run the Polymarket notifier. Continue? (Y/n)"
read -r RUN_CONFIRM

if [[ "$RUN_CONFIRM" =~ ^[Nn]$ ]]; then
    info "Aborted. You can run manually with:"
    echo ""
    echo "  cd $MONITOR_V2_DIR"
    echo "  DOTENV_CONFIG_PATH=$ENV_FILE DOTENV_CONFIG_OVERRIDE=true \\"
    echo "    node -r dotenv/config ./dist/monitor-polymarket/index.js"
    echo ""
    exit 0
fi

info "Starting Polymarket Notifier..."
echo ""
echo "----------------------------------------------"
echo ""

cd "$MONITOR_V2_DIR"
DOTENV_CONFIG_PATH="$ENV_FILE" DOTENV_CONFIG_OVERRIDE=true \
    node -r dotenv/config ./dist/monitor-polymarket/index.js

echo ""
echo "----------------------------------------------"
success "Polymarket Notifier finished"
