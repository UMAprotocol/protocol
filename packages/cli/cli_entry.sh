#!/usr/bin/env bash

# Any errors in this script should immediately terminate execution.
set -e

# This script should be installed with the UMA project and symlinked to the "uma" file in the npm binary directory.
# Usage wherever the UMA package is installed:
# $(npm bin)/uma --network mainnet_ledger

# Platform independent way of evaluating symlinks to find the real location of the script.
SCRIPT_FILE=$(/usr/bin/env python -c "import os; print(os.path.realpath(\"$0\"))")
SCRIPT_DIR=$(dirname $SCRIPT_FILE)

# cd into the directory containing the cli file.
cd $SCRIPT_DIR

echo "Starting CLI..."
npx truffle exec ./cli.js "$@"
