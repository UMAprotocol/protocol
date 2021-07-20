#!/usr/bin/env bash

# This script assumes that you've started a hardhat node fork of Ethereum mainnet, and then impersonates accounts 
# that we'll need to use in this directory.

HARDHAT_NETWORK=localhost yarn hardhat run ./packages/core/scripts/admin-proposals/setupFork.js --no-compile
