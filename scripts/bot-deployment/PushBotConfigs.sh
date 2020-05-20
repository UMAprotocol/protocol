#!/bin/bash
set -e

if [ $# -ne 1 ]; then
    echo "Incorrect number of arguments supplied! Expect directory containing configs to push"
    echo "example: ./PushBotConfigs.sh ./configs/"
    exit 1
fi

gsutil cp $1/*.env gs://bot-configs/