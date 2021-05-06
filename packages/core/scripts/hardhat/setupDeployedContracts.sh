#!/usr/bin/env bash

NETWORK_NAME=$1

# Register contracts in Finder:
yarn hardhat setup-finder --network $NETWORK_NAME --registry --bridge --generichandler
