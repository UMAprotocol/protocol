#!/usr/bin/env bash
set -e

PROTOCOL_DIR=$(pwd)

cd $PROTOCOL_DIR/core
yarn run truffle compile
