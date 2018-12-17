#!/bin/bash

while sleep 15; do $(npm bin)/truffle exec ./scripts/PublishBitcoinEthPrice.js --network derivative_demo_mainnet >>out.log 2>&1; done