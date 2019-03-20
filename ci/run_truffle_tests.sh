#!/usr/bin/env bash
set -e

# Verifies persistent deployments stored in the networks/ directory.
check_deployment() {
    # $1 is network_id
    local fname=networks/$1.json
    local network_name=$2
    if [ -e $fname ]
    then
        echo "Checking ${network_name} deployment stored in ${fname}."
        $(npm bin)/truffle exec ./scripts/CheckDeploymentValidity.js --network $network_name
    else
        echo "No ${network_name} deployment to verify."
    fi
}

# Test migration
$(npm bin)/truffle migrate --reset --network ci

# Ensure the migration is recoverable with only the artifacts saved in networks/.
rm -rf build
$(npm bin)/truffle compile
$(npm bin)/apply-registry

# Verify the validity of the ci migration.
$(npm bin)/truffle exec ./scripts/CheckDeploymentValidity.js --network ci

# Verify the validity of mainnet and ropsten deployments if they exist.
check_deployment 1 mainnet
check_deployment 3 ropsten

# Run standard truffle tests
$(npm bin)/truffle test --network ci
