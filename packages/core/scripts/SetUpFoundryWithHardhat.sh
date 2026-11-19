#!/bin/bash

# This script will configure the core hardhat instance to play nicely with Foundry.
# Check if you have foundry installed. If not, install it for you.

export PATH="$HOME/.foundry/bin:$PATH"
FOUNDRY_VERSION="${FOUNDRY_VERSION:-1.5.1}"

if ! command -v forge &>/dev/null; then
    echo "Foundry not installed. Installing foundry for you..."
    curl -fsSL https://foundry.paradigm.xyz | SHELL=/bin/bash bash
    foundryup --install "$FOUNDRY_VERSION"
fi

# Then, configure the core package to work with foundry. To do this we need to pull out the foundry standard library and
# place it in a way that it can be accessed within the core directory. This amounts the the manual steps listed here
# https://book.getfoundry.sh/config/hardhat#use-foundry-in-an-existing-hardhat-project without wanting to commit the
# foundry lib & standard lib to the repo.

if [ ! -d "./lib" ] || [ -z "$(ls -A ./lib)" ] || [ -z "$(ls -A ./lib/forge-std)" ]; then
    echo "Configuring UMA core to work with foundry std-lib"
    rm -rf ./lib
    mv .gitignore .gitignore.tmp
    mkdir temp
    cd temp
    forge init --force --no-git # Init the forge project to get the required libraries.
    mv ./lib ../                   # Move the required foundry components to root of core.
    cd ..
    rm -rf temp                    # Clean up.
    mv .gitignore.tmp .gitignore
fi

# Localize aliased OpenZeppelin v5 packages under packages/core/node_modules so tools like
# forge coverage can resolve relative imports during source analysis.
mkdir -p ./node_modules/@openzeppelin

if [ ! -e "./node_modules/@openzeppelin/contracts-v5" ] && [ -d "../../node_modules/@openzeppelin/contracts-v5" ]; then
    ln -s ../../../../node_modules/@openzeppelin/contracts-v5 ./node_modules/@openzeppelin/contracts-v5
fi

if [ ! -e "./node_modules/@openzeppelin/contracts-upgradeable-v5" ] && [ -d "../../node_modules/@openzeppelin/contracts-upgradeable-v5" ]; then
    ln -s ../../../../node_modules/@openzeppelin/contracts-upgradeable-v5 ./node_modules/@openzeppelin/contracts-upgradeable-v5
fi
