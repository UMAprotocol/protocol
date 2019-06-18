#!/bin/bash

while sleep 60; do $(npm bin)/truffle exec ./scripts/Voting.js "$@" &> out.log; done
