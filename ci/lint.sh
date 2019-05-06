#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)

# Lint JS
echo "Linting JS"
npm run prettier_check

# Lint Solidity
echo "Linting Solidity"
$(npm bin)/solhint --max-warnings=1 'v0/contracts/**/*.sol' 'v1/contracts/**/*.sol'
