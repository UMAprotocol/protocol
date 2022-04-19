#!/bin/bash

# Simple script that simply runs a command input as an environment variable. This is used to allow the docker image to
# run arbitrary commands by specifying them in the environment rather than the docker run command. Optionally, specify
#  UMA_PACKAGE as an ENV which lets you navigate to additional base packages installed within the container.
if [ -z ${UMA_PACKAGE+x} ]; then $COMMAND; else cd ../${UMA_PACKAGE} && $COMMAND; fi
