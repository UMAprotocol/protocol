#!/bin/bash

# Simple script that simply runs a command input as an environment variable. Should be run from the core/ directory.
# Note: this is used to allow the docker image to run arbitrary commands by specifying them in the environment rather
# than the `docker run` command.
$COMMAND
