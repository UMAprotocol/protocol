#!/bin/bash
set -e

if [ $# -ne 3 ]; then
    echo "Incorrect number of arguments supplied! First argument is bot's name. Second argument is path to config file. Third is the service account the bot should run as."
    echo "example: ./DeployBotGCP.sh ethbtc-monitor-bot ./ethbtc-monitor-bot-env.txt ethbtc-account@project-name.iam.gserviceaccount.com"
    exit 1
fi

echo "Deploying" $1
echo "Using ENV file:" $2
echo "Running as Service Account:" $3
gcloud compute instances create-with-container $1 \
    --container-image docker.io/umaprotocol/protocol:latest \
    --container-env-file $2 \
    --zone northamerica-northeast1-b \
    --container-restart-policy on-failure \
    --container-stdin \
    --service-account $3 \
    --scopes cloud-platform
