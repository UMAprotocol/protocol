#!/bin/sh
set -e

# The truffle directory is passed in as the first argument.
TRUFFLE_DIR=$1

PROTOCOL_DIR=$(pwd)

# Fix MultiRole contract to work with coverage.
TMP=$(mktemp)
MULTIROLE_PATH=$PROTOCOL_DIR/core/contracts/MultiRole.sol

# Copy original to tmp
cp $MULTIROLE_PATH $TMP

# Modify MultiRole file.
$PROTOCOL_DIR/ci/fix_multirole_for_cov.py $MULTIROLE_PATH

# $1 is the truffle directory over which we want to run the coverage tool.
cd $TRUFFLE_DIR
cp -R $PROTOCOL_DIR/common ./
cp -R $PROTOCOL_DIR/node_modules ./
$(npm bin)/solidity-coverage

# Copy back original MultiRole file to leave directory in a consistent state.
cp $TMP $MULTIROLE_PATH
