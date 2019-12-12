#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)

# Verifies persistent deployments stored in the networks/ directory.
check_deployment() {
    # $1 is the operating directory
    cd $1

    # Remove the build directory.
    rm -rf build

    # Make sure the contracts are compiled and the registry is applied.
    $(npm bin)/truffle compile
    $(npm bin)/apply-registry

    # $2 is network_id
    local fname=networks/$2.json
    local network_name=$3
    if [ -e $fname ]
    then
        echo "Checking ${network_name} deployment stored in ${fname}."
        $(npm bin)/truffle exec ./scripts/CheckDeploymentValidity.js --network $network_name
    else
        echo "No ${network_name} deployment to verify."
        exit 1
    fi
}

run_tests() {
    # $1 is the operating directory
    cd $1

    # Test migration
    $(npm bin)/truffle migrate --reset --network ci

    # Check the ci deployment.
    check_deployment ./ 1234 ci

    # Run standard truffle tests
    $(npm bin)/truffle test --network ci
}

# Run tests for core.
run_tests $PROTOCOL_DIR/core

# Check the Kovan deployment.
check_deployment $PROTOCOL_DIR/core 42 kovan_mnemonic

# Check the Mainnet deployment.
check_deployment $PROTOCOL_DIR/core 1 mainnet_mnemonic