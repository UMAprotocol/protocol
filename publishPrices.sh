#!/bin/bash
# Usage: ./publishPrices.sh <ManualPriceFeed address> <network>
# Example:  ./publishPrices.s 0x5b48d54581246863913c704551b2CA6248223f32 develop
while sleep 15; do $(npm bin)/truffle exec ./scripts/PublishPrices.js --network $2 >>out.log 2>&1; done
