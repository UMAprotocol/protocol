#!/bin/bash
set -e

if [ $# -ne 1 ]; then
    echo "Incorrect number of arguments supplied! First and only argument is bot's name."
    echo "example: ./PushBotHotFix.sh ethbtc-monitor-bot"
    exit 1
fi

echo "Pushing hot fix to" $1
echo "Building docker container..."
docker build -t umaprotocol/protocol:hotfix .

echo "Pushing docker container to docker hub..."
docker push umaprotocol/protocol:hotfix

echo "Pushing docker container to docker hub..."
gcloud compute instances update-container $1 \
    --container-image docker.io/umaprotocol/protocol:hotfix \
    --zone us-central1-a \
    --container-restart-policy on-failure \
    --container-stdin