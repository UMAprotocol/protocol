#!/bin/bash

set -o errexit
set -o nounset

if [[ $(git branch | awk '/^\* / { print $2 }') = master ]]; then
  HASH=$(git merge-base HEAD~1 master)
  echo "You are using master, comparing changes with commit $HASH"
else
  HASH=$(git merge-base HEAD master)
  echo "You are not using master, comparing changes with commit $HASH"
fi

yarn lerna ls --since ${HASH} --include-dependents > lerna_output
if [[ $(cat lerna_output | grep @) ]]; then
  cat lerna_output | grep @ > lerna_packages
  echo "Packages to test:"
  cat lerna_packages
else
  echo "No packages for testing."
  touch lerna_packages
  exit 0;
fi
