#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)
sudo chmod -R a+rwx /usr/local/lib/node_modules

run_slither() {
    cd $1
    mkdir -p node_modules/
    cp -r ../node_modules/openzeppelin-solidity ./node_modules/openzeppelin-solidity
    truffle compile 

    cd $PROTOCOL_DIR
    slither --exclude=naming-convention $1
}

run_slither $PROTOCOL_DIR/core
