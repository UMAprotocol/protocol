#!/bin/bash

# This script will configure the core hardhat instance to play nicely with Foundry.
# Check if you have foundry installed. If not, install it for you.

export PATH="$HOME/.foundry/bin:$PATH"
FOUNDRY_VERSION="${FOUNDRY_VERSION:-nightly-70cd140131cd49875c6f31626bdfae08eba35386}"

if ! command -v forge &>/dev/null; then
    echo "Foundry not installed. Installing foundry for you..."
    curl -fsSL https://foundry.paradigm.xyz | SHELL=/bin/bash bash
    foundryup --install "$FOUNDRY_VERSION"
fi

# Then, configure the core package to work with foundry. To do this we need to pull out the foundry standard library and
# place it in a way that it can be accessed within the core directory. This amounts the manual steps listed here
# https://book.getfoundry.sh/config/hardhat#use-foundry-in-an-existing-hardhat-project without wanting to commit the
# foundry lib & standard lib to the repo.

if [ ! -d "./lib" ] || [ -z "$(ls -A ./lib)" ] || [ -z "$(ls -A ./lib/forge-std)" ]; then
    echo "Configuring UMA core to work with foundry std-lib"
    rm -rf ./lib
    mv .gitignore .gitignore.tmp
    mkdir temp
    cd temp
    forge init --force --no-commit # Init the forge project to get the required libraries.
    mv ./lib ../                   # Move the required foundry components to root of core.
    cd ..
    rm -rf temp                    # Clean up.
    mv .gitignore.tmp .gitignore
fi
