#!/bin/bash
# Usage: ./scripts/publishPrices.sh <network>
# Example: ./scripts/publishPrices.sh develop
# Note: this script must be run from the top level directory (not scripts/).
while sleep 60; do $(npm bin)/truffle exec ./scripts/PublishPrices.js --network $1 --keys priceFeed >>out.log 2>&1; done
