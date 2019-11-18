#!/bin/bash
# Usage: ./scripts/publishPrices.sh <args to pass to PublishPrices>
# Example: ./scripts/publishPrices.sh --network mainnet --keys priceFeed
# Note: this script must be run from the core/ directory (not core/scripts/).

while true; do $(npm bin)/truffle exec ./scripts/PublishPrices.js "$@" >>out.log 2>&1; sleep 3600; done
