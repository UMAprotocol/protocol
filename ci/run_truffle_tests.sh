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
    fi
}

run_tests() {
    # $1 is the operating directory
    cd $1

    # Test migration
    $(npm bin)/truffle migrate --reset --network ci

    # Ensure the migration is recoverable with only the artifacts saved in networks/.
    rm -rf build
    $(npm bin)/truffle compile
    $(npm bin)/apply-registry

    # Verify the validity of the ci migration.
    $(npm bin)/truffle exec ./scripts/CheckDeploymentValidity.js --network ci

    # Run standard truffle tests
    $(npm bin)/truffle test --network ci
}

# Run tests for core.
run_tests $PROTOCOL_DIR/core

# Verify the validity of the core mainnet and ropsten deployments if they exist.
check_deployment $PROTOCOL_DIR/core 1 mainnet
check_deployment $PROTOCOL_DIR/core 3 ropsten
