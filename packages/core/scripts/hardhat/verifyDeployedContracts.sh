#!/usr/bin/env bash

# The network to verify Etherscan contracts for
NETWORK_NAME=$1

yarn hardhat --network $NETWORK_NAME etherscan-verify --license AGPL-3.0 --force-license
