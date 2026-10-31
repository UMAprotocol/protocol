#!/bin/sh

# Parse the BOT_SCHEDULE environment variable and construct the crontab
echo "$BOT_SCHEDULE" | jq -r '.[] | [.schedule, .bucket, .configFile] | @tsv' |
  while IFS=$'\t' read -r schedule bucket configFile
    do echo "$schedule /scheduler/run-bots.sh $bucket $configFile $HUB_URL" >> /tmp/crontab
  done

crontab /tmp/crontab
crond -f 
