#!/usr/bin/env bash

# This script assumes that you've started a hardhat node fork of Ethereum mainnet, and makes requests to the fork that
# modify it in preparation for running test scripts connected to it. For example, running `impersonateAccounts` unlocks
# accounts that we'll use to submit and vote on Admin proposals.

HARDHAT_NETWORK=localhost yarn hardhat run ./packages/core/scripts/admin-proposals/impersonateAccounts.js --no-compile
