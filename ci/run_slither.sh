#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)
sudo chmod -R a+rwx /usr/local/lib/node_modules

run_slither() {
    cd $1
    # Slither appears to assume that node_modules will be in the directory $1, not the directory above.
    mkdir -p node_modules
    cp -r ../node_modules/openzeppelin-solidity ./node_modules/openzeppelin-solidity

    truffle compile 

    cd $PROTOCOL_DIR
    slither --exclude=naming-convention,solc-version,pragma,external-function,reentrancy-benign,reentrancy-no-eth,arbitrary-send,locked-ether,reentrancy-eth $1
}

run_slither $PROTOCOL_DIR/core
