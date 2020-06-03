#!/bin/bash
set -e

if [ $# -ne 1 ]; then
    echo "Incorrect number of arguments supplied! First and only argument is bot's name.From this the bot's config and service account will be inferred."
    echo "example: ./DeployBotGCP.sh ethbtc-monitor-bot"
    exit 1
fi

echo "Deploying" $1

paramToServiceAccount=$(echo $1 | cut -d'-' -f 1,3)
serviceAccountEmail=""

# Loop through all service accounts in GCP and validate that the provided bot name matches to a service account email.
for serviceAccount in $(gcloud iam service-accounts list --format="value(EMAIL)"); do
    if [ $paramToServiceAccount == $(echo $serviceAccount | cut -d'@' -f 1) ]; then
        serviceAccountEmail=$serviceAccount
    fi
done

if [ $serviceAccountEmail == "" ]; then
    echo "Bot name provided does not match to a service account."
    exit 1
fi

gsutil cp gs://bot-configs/$1.env ./.tempConfig

echo $serviceAccountEmail
