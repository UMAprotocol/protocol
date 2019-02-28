#!/usr/bin/env bash

sudo chmod -R a+rwx /usr/local/lib/node_modules
truffle compile 
slither --exclude=naming-convention,solc-version,pragma,external-function,reentrancy-benign,reentrancy-no-eth,arbitrary-send,locked-ether .
