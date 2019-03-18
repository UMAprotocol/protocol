#!/bin/bash
# Usage: ./publishPrices.sh <network>
# Example: ./publishPrices.sh develop
while sleep 60; do $(npm bin)/truffle exec ./scripts/PublishPrices.js --network $1 --keys priceFeed >>out.log 2>&1; done
