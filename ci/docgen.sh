#!/usr/bin/env bash

# Note: because we've forked the solidity-docgen library, providing the path alias doesn't have an effect. However,
# once external libraries are supported in v2 and we deprecate our fork, this will allow the docgen to find the
# openzeppelin directory. See https://github.com/OpenZeppelin/solidity-docgen/issues/24 for progress on that front.
$(npm bin)/solidity-docgen -i ./core/contracts -t documentation --contract-pages -x adoc -e core/contracts/oracle/test,core/contracts/tokenized_derivative/echidna_tests