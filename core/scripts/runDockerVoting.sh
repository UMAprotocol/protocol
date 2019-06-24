#!/bin/bash
# Must run from the core/ directory.
if [ $1="--docker" ]; then
  node ./scripts/InitDockerConfig.js
fi

while true; do $(npm bin)/truffle exec ./scripts/Voting.js "$2"; sleep 60; done
