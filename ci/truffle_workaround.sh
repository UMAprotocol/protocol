#!/bin/bash

# Note: this is a workaround for a strange truffle issue.
# The core idea is that truffle sees the absolute paths in old artifacts that are used outside of the core
# directory and it tries to add those absolute paths to the list of sources to compile. Normally, this
# wouldn't be an issue since those absolute paths wouldn't exist on the machine you're compiling on. However,
# because the published core contracts are compiled in the ci env, many of these absolute paths do match in
# this environment. This creates a very nasty situation where multiple versions of the same contracts are
# compiled and it's non-deterministic which one will be used by truffle. To avoid this, we just change the dir
# structure to disrupt the absolute paths. This means that truffle will not know how up-to-date the bytecode
# is, however, so testing will require a recompile for every contract.

cd ..
mkdir truffle_workaround
mv protocol truffle_workaround/
cd truffle_workaround/protocol
