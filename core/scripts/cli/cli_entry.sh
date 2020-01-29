#!/usr/bin/env bash

# Platform independent way of evaluating symlinks to find the real location of the script.
SCRIPT_FILE=$(python -c "import os; print(os.path.realpath(\"$0\"))")
SCRIPT_DIR=$(dirname $SCRIPT_FILE)

# cd into the directory containing the cli file.
# This file is in protocol/core/scripts -- so we need to go up one directory to get to the base truffle directory.
cd $SCRIPT_DIR/../..

# Execute the script from within the scripts directory so all project artifacts/scripts are available.
# Note: if the user needs to pass in a file path, we will need to pass the original working directory to the script so
# we can correctly resolve the file location.
$(npm bin)/truffle compile
$(npm bin)/apply-registry
$(npm bin)/truffle exec -c ./scripts/cli/cli.js "$@"
