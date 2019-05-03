#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)
sudo chmod -R a+rwx /usr/local/lib/node_modules

run_slither() {
    cd $1
    truffle compile 
    slither --exclude=naming-convention,solc-version,pragma,external-function,reentrancy-benign,reentrancy-no-eth,arbitrary-send,locked-ether,reentrancy-eth .
}

run_slither $PROTOCOL_DIR/v0
run_slither $PROTOCOL_DIR/v1