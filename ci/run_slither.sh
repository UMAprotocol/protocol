#!/usr/bin/env bash

slither --exclude=naming-convention,solc-version,pragma,external-function,reentrancy-benign,reentrancy-no-eth,arbitrary-send,reentrancy-eth .
