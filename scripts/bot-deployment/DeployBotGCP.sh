#!/bin/bash
set -e

if [ $# -ne 2 ]|| [ $# -gt 2 ]; then
    echo "Incorrect number of arguments supplied! First argument is bot's name. Second argument is path to config file."
    echo "example: ./DeployBotGCP.sh ethbtc-monitor-bot ./ethbtc-monitor-bot-env.txt"
    exit 1
fi

echo "Deploying" $1
echo "Using ENV file:" $2
gcloud compute instances create-with-container $1 \
    --container-image docker.io/umaprotocol/protocol:latest \
    --container-env-file $2 \
    --zone us-central1-a \
    --container-restart-policy on-failure \
    --container-stdin
