#!/bin/sh
set -e

# The truffle directory is passed in as the first argument.
TRUFFLE_DIR=$1

PROTOCOL_DIR=$(pwd)

# $1 is the truffle directory over which we want to run the coverage tool.
cd $TRUFFLE_DIR
$(npm bin)/truffle run coverage --network ci
