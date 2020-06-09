''#!/bin/bash
set -e

if [ $# -ne 1 ]; then
    echo "Incorrect number of arguments supplied! First and only argument is bot's name. From this the monitor config will be inferred."
    echo "example: ./DeployBotMonitorConfig.sh ethbtc-mainnet-monitor"
    exit 1
fi

echo "🔥 Creating monitor config for bot" $1

gcloud logging metrics create $1 --description "$1 winston logging metric." --log-filter "jsonPayload.metadata.\"bot-identifier\"=\"$1\""

config = '
---
combiner: OR
conditions:
- conditionAbsent:
    aggregations:
    - alignmentPeriod: 60s
      perSeriesAligner: ALIGN_RATE
    duration: 600s
    filter: metric.type="logging.googleapis.com/user/ethbtc-mainnet-liquidator"
    trigger:
      percent: 100.0
  displayName: ethbtc-mainnet-liquidator-winston-logger
displayName: ethbtc-mainnet-liquidator
enabled: true
notificationChannels:
- projects/uma-protocol/notificationChannels/380379380929930537'