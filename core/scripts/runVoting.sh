#!/bin/bash
# Must run from the core/ directory.

while sleep 60; do $(npm bin)/truffle exec ./scripts/Voting.js "$@" &> out.log; done
