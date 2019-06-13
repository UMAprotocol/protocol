#!/usr/bin/env bash

# Note: because we've forked the solidity-docgen library, providing the path alias doesn't have an effect. However,
# once external libraries are supported in v2 and we deprecate our fork, this will allow the docgen to find the
# openzeppelin directory. See https://github.com/OpenZeppelin/solidity-docgen/issues/24 for progress on that front.
OPEN_ZEPPELIN_DIR=$(pwd)/node_modules/openzeppelin-solidity
SOLC_ARGS="openzeppelin-solidity=$OPEN_ZEPPELIN_DIR" \
$(npm bin)/solidity-docgen -c ./core/contracts
