#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)

# Lint JS
echo "Linting Solidity and js"
yarn run lint

# Check dispute-router Solidity formatting
echo "Checking dispute-router Solidity formatting"
export PATH="$HOME/.foundry/bin:$PATH"
cd "$PROTOCOL_DIR/packages/core"
yarn dispute-router:fmt:check
