#!/usr/bin/env bash

CURRENT_DIR=$(pwd)

# This script assumes that you've started a hardhat node fork of Ethereum mainnet, and then impersonates accounts 
# that we'll need to use in this directory.
HARDHAT_NETWORK=localhost yarn hardhat run $CURRENT_DIR/packages/periphery/utils/setupFork.js --no-compile
