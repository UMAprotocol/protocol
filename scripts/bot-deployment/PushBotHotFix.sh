#!/bin/bash
set -e

if [ $# -eq 0 ] || [ $# -gt 2 ]; then
    echo "Incorrect number of arguments supplied! First argument is the bot's name. Second argument (optional) is a config file with environment variables to supply to the bot."
    echo "example: ./scripts/bot-deployment/UpdateBotGCP.sh ethbtc-monitor-bot [keep env variables]"
    echo "example: ./scripts/bot-deployment/UpdateBotGCP.sh ethbtc-monitor-bot ./scripts/bot-deployment/ETHBTC-monitor-bot-env.txt [update env variables]"
    exit 1
fi

echo "Building docker container..."
docker build -t umaprotocol/protocol:hotfix .

echo "Pushing docker container to docker hub..."
docker push umaprotocol/protocol:hotfix

echo "Pushing docker container to docker hub..."
if [ $# -eq 1 ]; then
    echo "Pushing hot fix to" $1
    echo "No configuration file provided. Keeping current configuration"
    gcloud compute instances update-container $1 \
        --container-image docker.io/umaprotocol/protocol:hotfix \
        --zone northamerica-northeast1-b \
        --container-restart-policy on-failure \
        --container-stdin
fi

if [ $# -eq 2 ]; then
    echo "Pushing hot fix to" $1
    echo "Using enviroment variable config file" $2
    gcloud compute instances update-container $1 \
        --container-image docker.io/umaprotocol/protocol:hotfix \
        --container-env-file $2 \
        --zone northamerica-northeast1-b \
        --container-restart-policy on-failure \
        --container-stdin
fi
