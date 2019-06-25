#!/bin/bash
# Must run from the core/ directory.
while true; do $(npm bin)/truffle exec ./scripts/Voting.js "$@"; sleep 60; done
