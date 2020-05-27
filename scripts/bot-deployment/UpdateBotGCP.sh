#!/bin/bash
set -e

if [ $# -eq 0 ] || [ $# -gt 2 ]; then
    echo "Incorrect number of arguments supplied! First argument is the bot's name. Second argument (optional) is a config file with environment variables to supply to the bot."
    echo "example: ./UpdateBotGCP.sh ethbtc-monitor-bot [keep env variables]"
    echo "example: ./UpdateBotGCP.sh ethbtc-monitor-bot ./ethbtc-monitor-bot-env.txt [Update env variables]"
    exit 1
fi

if [ $# -eq 1 ]; then
    echo "Updating" $1
    echo "No configuration file provided. Keeping current configuration"
    gcloud compute instances update-container $1 \
        --container-image docker.io/umaprotocol/protocol:latest \
        --zone northamerica-northeast1-b \
        --container-restart-policy on-failure \
        --container-stdin

fi

if [ $# -eq 2 ]; then
    echo "Updating" $1
    echo "Using enviroment variable config file" $2
    gcloud compute instances update-container $1 \
        --container-image docker.io/umaprotocol/protocol:latest \
        --container-env-file $2 \
        --zone northamerica-northeast1-b \
        --container-restart-policy on-failure \
        --container-stdin
fi
