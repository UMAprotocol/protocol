#!/bin/bash

set -o errexit
set -o nounset

HASH=$(git merge-base HEAD master)
yarn lerna ls --since ${HASH} --include-dependents > lerna_output
if [[ $(cat lerna_output | grep @) ]]; then
  cat lerna_output | grep @ > lerna_packages
  echo "Packages to test:"
  cat lerna_packages
else
  echo "No packages for testing."
  exit 0;
fi
