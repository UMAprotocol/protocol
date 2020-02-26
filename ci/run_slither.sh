#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)
sudo chmod -R a+rwx /usr/local/lib/node_modules


run_slither() {
    cd $1
    mkdir -p node_modules/
    cp -r ../node_modules/@openzeppelin ./node_modules/@openzeppelin
    truffle compile 

    cd $PROTOCOL_DIR
    slither --exclude=naming-convention,solc-version,pragma,external-function,reentrancy-benign,reentrancy-no-eth,arbitrary-send,locked-ether,reentrancy-eth,uninitialized-state-variables,incorrect-equality,reentrancy-events,assembly,shadowing-local,low-level-calls,constant-function-state $1
}

run_slither $PROTOCOL_DIR/core
