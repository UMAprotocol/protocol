#!/bin/sh
set -e

# The truffle directory is passed in as the first argument.
TRUFFLE_DIR=$1

PROTOCOL_DIR=$(pwd)

# Note: the following is necessary because the vanilla solidity-coverage tool is outdated and not compatible with solidity 0.5.0+.
# We can may be able to get rid of the curl below once solidity-parser merges PR #18.
# There may also be an option to use solidity-coverage@beta package, but we have yet to test that.
curl https://raw.githubusercontent.com/maxsam4/solidity-parser/solidity-0.5/build/parser.js > node_modules/solidity-parser-sc/build/parser.js

# $1 is the truffle directory over which we want to run the coverage tool.
cd $TRUFFLE_DIR
cp -R $PROTOCOL_DIR/common ./
cp -R $PROTOCOL_DIR/node_modules ./
$(npm bin)/solidity-coverage