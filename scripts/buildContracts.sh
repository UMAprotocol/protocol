#!/bin/bash
set -e

cd packages/core
rm -rf ./build
$(npm bin)/truffle compile
$(npm bin)/apply-registry
echo "Done building contracts"
