#!/bin/bash
set -e

if [ $# -ne 1 ]; then
    echo "Incorrect number of arguments supplied! First and only argument is bot's name. From this the monitor config will be inferred."
    echo "example: ./DeployBotMonitorConfig.sh ethbtc-mainnet-monitor"
    exit 1
fi

echo "🔥 Creating monitor config for bot" $1

# Create the logging metric. This uses the friendly name based on the `bot-identifier` field.
# This will capture all log messages that come from a bot and put them into a metric with the same
# name as the bot. EG all ethbtc-mainnet-monitor will be aggregated to a ethbtc-mainnet-monitor metric
gcloud logging metrics create $1 --description "$1 winston logging metric." --log-filter "jsonPayload.metadata.\"bot-identifier\"=\"$1\""

echo "🔎 Logging metric created!"

echo "📣 Fetching notification channel config from GCP"

# Fetch the notification channel to use with the monitoring policy.
# Note this command is relativly fradgile as it assumes that there is only one notification channel.
# Our current setup only has one notification channel: Pagerduty. if more were added (email, web, mobile)
# then this would need to be refactored to pull the apropriate channel name.
notificationChannel=$(gcloud alpha monitoring channels list --format='value(name)')

echo " Pulled notification channel from GCP @" $notificationChannel

# This YAML config below creates a monitor that trackes the logging metric created before.
# It sends an alert to the `notificationChannel` if the `filter` has not been seen for `duration`.
config="---
combiner: OR
conditions:
- conditionAbsent:
    aggregations:
    - alignmentPeriod: 60s
      perSeriesAligner: ALIGN_RATE
    duration: 600s
    filter: metric.type=\"logging.googleapis.com/user/$1\" AND resource.type=\"gce_instance\"
    trigger:
      percent: 100.0
  displayName: $1-winston-logger
displayName: $1
notificationChannels:
- $notificationChannel"

echo "👷‍♂️ Built monitor configuration object. Creating monitoring policy:" 
echo "$config"

# Finnally, create the monitoring policy to alert on the metric created.
gcloud alpha monitoring policies create --policy="$config"

echo "🎉 Logging metric has been creased and monitoring policy has been deployed"
