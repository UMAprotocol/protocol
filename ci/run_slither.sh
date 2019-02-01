#!/usr/bin/env bash

sudo env "PATH=$PATH" truffle compile 
sudo env "PATH=$PATH" slither --exclude=naming-convention,solc-version,pragma,external-function,reentrancy-benign,reentrancy-no-eth,arbitrary-send,reentrancy-eth .
