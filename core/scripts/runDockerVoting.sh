#!/bin/bash
# Must run from the core/ directory.
node ./scripts/InitDockerConfig.js
while true; do $(npm bin)/truffle exec ./scripts/Voting.js "$@"; sleep 60; done
