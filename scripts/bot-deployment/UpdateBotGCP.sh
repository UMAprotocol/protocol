#!/bin/bash
set -e

if [ $# -eq 0 ]; then
    echo "Incorrect number of arguments supplied! First argument is bot's name. Second optional argument is path to config file."
    echo "example: ./UpdateBotGCP.sh ethbtc-monitor-bot [keep env variables]"
    echo "example: ./UpdateBotGCP.sh ethbtc-monitor-bot ./ethbtc-monitor-bot-env.txt [Update env variables]"
    exit 1
fi

if [ $# -eq 1 ]; then
    echo "Updating" $1
    echo "No configuration file provided. Keeping current configuration"
    gcloud compute instances update-container $1 \
        --container-image docker.io/umaprotocol/protocol:latest \
        --zone us-central1-a \
        --container-restart-policy on-failure \
        --container-stdin

fi

if [ $# -eq 2 ]; then
    echo "Updating" $1
    echo "Using enviroment variable config file" $2
    gcloud compute instances update-container $1 \
        --container-image docker.io/umaprotocol/protocol:latest \
        --container-env-file $2 \
        --zone us-central1-a \
        --container-restart-policy on-failure \
        --container-stdin
fi
