#!/bin/bash
set -e

if [ $# -ne 1 ]; then
    echo "Incorrect number of arguments supplied! First and only argument is bot's name. From this the bot's config will be inferred."
    echo "example: ./DeployBotCR.sh ethbtc-mainnet-reporter"
    echo "To view all available configs run: gsutil ls gs://bot-configs"
    exit 1
fi

echo "🔥 Starting GCP Cloud Run deployment script for bot" $1

echo "🤖 Pulling bot config from GCP bucket"

# Create a temp file to store the config. This will be cleaned up by the OS.
tempFile=$(mktemp -t UMA)

# Copy config files from GCP to the temp file.
gsutil cp gs://bot-configs/$1.yml $tempFile

echo "✍️  Config has been pulled and placed in a temp directory" $tempFile

echo "🚀 Deploying cloud run instance to GCP"

# Deploy The bot to GCP using the config file. If the deployed GCP cloud run instance already exists then this will
# replace it with the latest config file. Else, this will create a new cloud run instance.
gcloud beta run services replace $tempFile \
    --platform managed \
    --region=us-central1
echo "🎉 Bot deployed!"

echo "🧭 Fetching cloud run instance URL"

# Fetch the cloud run URL created for the service.
cloudRunURL=$(gcloud run services describe $1 --platform managed --region us-central1 --format 'value(status.url)')

echo "🛣  Cloud run URL has been pulled as" $cloudRunURL
# Fetch the project ID and use this to construct the default service account.
# Note1: the default service account email is always <project_number>--compute@developer.gserviceaccount.com
# Note2: this command assumes that the GCP account account only has 1 project associated with it.
serviceAccountEmail=$(gcloud projects list --filter="$PROJECT" --format="value(PROJECT_NUMBER)")"-compute@developer.gserviceaccount.com"

echo "📄 Using default service account for project @" $serviceAccountEmail

# Lastly, creat the scheduler job. This will either create a new schedular job (if it does not exist already)
# or will update the existing job with the provided configuration.
schedularExists=0
for serviceAccount in $(gcloud scheduler jobs list --format="value(ID)"); do
    if [ $1 == $serviceAccount ]; then
        schedularExists=1
    fi
done

if [ $schedularExists == 0 ]; then
    echo "⏱  Creating new cloud scheduler to run the cloud run instance"
    gcloud scheduler jobs create http $1 \
        --schedule="0 12 * * *" \
        --uri=$cloudRunURL \
        --oidc-service-account-email=$serviceAccountEmail \
        --http-method=get \
        --description="Daily reporter cron job to send messages at 8am ET"
    echo "🎊 Scheduler created!"
fi

if [ $schedularExists == 1 ]; then
    echo "⏱  Updating existing cloud scheduler to run the cloud run instance"
    gcloud scheduler jobs update http $1 \
        --schedule="0 12 * * *" \
        --uri=$cloudRunURL \
        --oidc-service-account-email=$serviceAccountEmail \
        --http-method=get \
        --description="Daily reporter cron job to send messages at 8am ET"
    echo "🎊 Scheduler updated!"
fi
