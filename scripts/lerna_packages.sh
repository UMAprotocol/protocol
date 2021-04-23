#!/bin/bash

cd ..
mkdir truffle_workaround
mv protocol truffle_workaround/
cd truffle_workaround/protocol
HASH=$(git merge-base HEAD master)
yarn lerna ls --since ${HASH} --include-dependents > lerna_output
cat lerna_output | grep @ > lerna_packages
echo "edited packages:" && cat lerna_packages
