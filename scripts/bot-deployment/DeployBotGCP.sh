#!/bin/bash
set -e

if [ $# -ne 1 ]; then
    echo "Incorrect number of arguments supplied! First and only argument is bot's name. From this the bot's config and service account will be inferred."
    echo "example: ./DeployBotGCP.sh ethbtc-mainnet-monitor"
    echo "To view all available configs run: gsutil ls gs://bot-configs"
    exit 1
fi

echo "🔥 Starting deployment script for bot" $1

# Bot names are <identifer>-<network>-<bot-type>. EG: ethbtc-liquidator-mainnet.
# This cut removes the network as this is not included in a service account. ethbtc-liquidator-mainnet becomes ethbtc-liquidator
paramToServiceAccount=$(echo $1 | cut -d'-' -f 1,3)
serviceAccountEmail=""

# Loop through all service accounts in GCP and validate that the provided bot name matches to a service account email.
for serviceAccount in $(gcloud iam service-accounts list --format="value(EMAIL)"); do
    if [ $paramToServiceAccount == $(echo $serviceAccount | cut -d'@' -f 1) ]; then
        serviceAccountEmail=$serviceAccount
    fi
done

if [ $serviceAccountEmail == "" ]; then
    echo "Bot name provided does not match to a service account"
    exit 1
fi

echo "📄 Bot service account found @" $serviceAccountEmail
echo "🤖 Pulling bot config from GCP bucket"

# Create a temp file to store the config. This will be cleaned up by the OS.
tempFile=$(mktemp -t UMA)

# Copy config files from GCP to the temp file
gsutil cp gs://bot-configs/$1.env $tempFile

echo "✍️  Config has been pulled and placed in a temp directory" $tempFile

# Check if there is an existing instance. If there is, then we will delete it to clear space for the new one.
existingImages=$(gcloud compute instances list --filter $1 --limit 1 | grep $1)
if [[ "$existingImages" == *"$1"* ]]; then
    echo "♻️  Deleting old bot.  ⚠️  Deleting an instance can take some time, please be patient.  ⚠️"
    
    # This will prompt the user to confirm y/N if they want o delete the instance. 
    gcloud compute instances delete $1 \
        --zone northamerica-northeast1-b

    echo "🎇  Old bot has been deleted!"
fi

# Deploy The bot to GCP using the config file and the service account
echo "🚀 Deploying bot to GCP"
gcloud compute instances create-with-container $1 \
    --container-image docker.io/umaprotocol/protocol:latest \
    --container-env-file $tempFile \
    --zone northamerica-northeast1-b \
    --container-restart-policy on-failure \
    --container-stdin \
    --service-account $serviceAccountEmail \
    --scopes cloud-platform

echo "🎉 Bot deployed!"
