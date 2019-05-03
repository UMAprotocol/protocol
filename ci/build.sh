#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)

cd $PROTOCOL_DIR/v0
$(npm bin)/truffle compile

cd $PROTOCOL_DIR/v1
$(npm bin)/truffle compile