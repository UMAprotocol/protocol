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
# This file is in protocol/core/scripts -- so we need to go up one directory to get to the base truffle directory.
cd $SCRIPT_DIR/../..

# Execute the script from within the scripts directory so all project artifacts/scripts are available.
# Note: if the user needs to pass in a file path, we will need to pass the original working directory to the script so
# we can correctly resolve the file location.
echo "Setting up UMA contracts..."
$(npm bin)/truffle compile > /dev/null || (echo "Contract compilation failed! Please check your @umaprotocol/protocol installation."; exit 1)
$(npm bin)/apply-registry > /dev/null || (echo "Could not read contract addresses! Please check your @umaprotocol/protocol installation."; exit 1)
echo "...UMA contracts set up successfully!"

echo "Starting Truffle..."
$(npm bin)/truffle exec ./scripts/cli/cli.js "$@"
