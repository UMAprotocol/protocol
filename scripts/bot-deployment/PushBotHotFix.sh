#!/bin/bash
set -e

if [ $# -eq 0 ]; then
    echo "Incorrect number of arguments supplied! First and only required argument is bot's name. Optionally include a config file."
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
    echo "Using no new enviroment variable. Keeping current configuration."
    gcloud compute instances update-container $1 \
        --container-image docker.io/umaprotocol/protocol:hotfix \
        --zone us-central1-a \
        --container-restart-policy on-failure \
        --container-stdin
fi

if [ $# -eq 2 ]; then
    echo "Pushing hot fix to" $1
    echo "Using enviroment variable config file" $2
    gcloud compute instances update-container $1 \
        --container-image docker.io/umaprotocol/protocol:hotfix \
        --container-env-file $2 \
        --zone us-central1-a \
        --container-restart-policy on-failure \
        --container-stdin
fi
