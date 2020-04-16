#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)

# Lint JS
echo "Linting Solidity and js"
npm run lint
