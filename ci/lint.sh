#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)

# Lint JS
echo "Linting Solidity and js"
yarn run lint
