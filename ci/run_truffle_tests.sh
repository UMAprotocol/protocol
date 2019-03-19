#!/usr/bin/env bash
set -e

# Test migration
$(npm bin)/truffle migrate --reset --network ci

# Ensure the migration is recoverable with only the artifacts saved in networks/.
rm -rf build
$(npm bin)/truffle compile
$(npm bin)/apply-registry

# Verify the validity of the deployment
$(npm bin)/truffle exec ./scripts/CheckDeploymentValidity.js --network ci

# Run standard truffle tests
$(npm bin)/truffle test --network ci
