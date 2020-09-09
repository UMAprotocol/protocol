#!/bin/sh
set -e

# The truffle directory is passed in as the first argument.
TRUFFLE_DIR=$1

PROTOCOL_DIR=$(pwd)

# $1 is the truffle directory over which we want to run the coverage tool.
cd $TRUFFLE_DIR
# Truffle compile can take a lot of memory, which I've experienced with the solc-0.6 compatible versions,
# so I explicitly increase the javascript heap size.
# More details here: https://github.com/trufflesuite/truffle/issues/957
# Truffle compile for DecodeTransactionData
node --max-old-space-size=4096 $(npm bin)/truffle compile
node --max-old-space-size=4096 $(npm bin)/truffle run coverage && cat coverage/lcov.info | $(npm bin)/coveralls --verbose

