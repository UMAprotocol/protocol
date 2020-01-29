#!/usr/bin/env bash

python -c "import os; print(os.path.realpath($0))"

# cd into the directory containing the cli file (cononicalizing any symlinks), and grab absolute paths of all scripts.
SCRIPTS_DIR="$(dirname "$(readlink "$0")")"
echo $SCRIPTS_DIR
cd $SCRIPTS_DIR
TRUFFLE_BIN=$(npm bin)/truffle
CLI_FILE=$SCRIPTS_DIR/cli.js

# Execute the script from within the scripts directory so all project artifacts are available. 
$TUFFLE_BIN exec -c $CLI_FILE "$@"
