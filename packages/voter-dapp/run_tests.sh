#!/usr/bin/env bash
set -e

# Set up blockchain env to render against.
yarn run truffle migrate --reset --network test

# Run react tests.
CI=true yarn run react-scripts test