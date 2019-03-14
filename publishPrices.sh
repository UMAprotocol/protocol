#!/bin/bash
# Usage: ./publishPrices.sh <network>
# Example:  ./publishPrices.sh develop
while sleep 15; do $(npm bin)/truffle exec ./scripts/PublishPrices.js --network $2 >>out.log 2>&1; done
