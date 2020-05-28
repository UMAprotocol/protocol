#!/bin/bash
set -e

if [ $# -ne 1 ]; then
    echo "Incorrect number of arguments supplied! Expect destination directory for bot config files"
    echo "example: ./RetrieveBotConfigs.sh ./"
    exit 1
fi

gsutil cp gs://bot-configs/* $1/