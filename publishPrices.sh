#!/bin/bash

while sleep 15; do $(npm bin)/truffle exec ./scripts/PublishPrices.js $1 --network $2 >>out.log 2>&1; done
