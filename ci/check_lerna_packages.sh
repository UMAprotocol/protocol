#!/bin/bash

set -o errexit
set -o nounset

HASH=$(git merge-base HEAD master)
yarn lerna ls --since ${HASH} --include-dependents > lerna_output
cat lerna_output | grep @ > lerna_packages

if [ -s lerna_packages ]
then

  echo "edited packages:" && cat lerna_packages

else

  echo "No packages for testing."
  circleci-agent step halt;
  
fi
