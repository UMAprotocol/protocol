#!/usr/bin/env bash
NETWORK_NAME=$1
if [ ! "$NETWORK_NAME" ]; 
then 
    echo "Must specify network name"
    exit 1
fi

# The network to verify Etherscan contracts for
yarn hardhat etherscan-verify --license AGPL-3.0 --force-license --network $NETWORK_NAME
