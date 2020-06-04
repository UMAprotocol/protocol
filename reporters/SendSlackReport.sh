#!/bin/bash
set -e

# This Script executes the UMA reporter and pipes the output into a text file which is sent as an attachment to slack.

if [ -z "${SLACK_TOKEN}" ] || [ -z "${SLACK_CHANNEL}" ]; then
    echo "SLACK_TOKEN or SLACK_CHANNEL env variables are not set!"
    exit 1
fi

# Run the daily reporter script and built the output string
echo "Generating daily report..."
OUTPUT=$(truffle exec ../reporters/index.js --network mainnet_mnemonic)

# The output from the node process contains single quotes. These need to be stripped out
OUTPUT="${OUTPUT//\'/$' '}"

# Configure the name of the file. Sample output: 2020-06-04-daily-report.txt
date=$(date +%F)
fileName=$date"-daily-report.txt"
echo "Saving daily report to file" $fileName
echo "${OUTPUT}" >$fileName

# Spesify the parameters to send to the slack API. All caps values need to be set as enviroment variables.
# Note that this SLACK_TOKEN is an API token, not a webhook.
message_title=$date" Daily Report"
filename=$fileName
path_to_file="./"$fileName

# Send a curl command to upload the file along with a message to the channel
echo "Sending file as slack message"
curl https://slack.com/api/files.upload -F token="${SLACK_TOKEN}" -F channels="${SLACK_CHANNEL}" -F title="${message_title}" -F filename="${filename}" -F file=@"${path_to_file}"

echo "Cleaning up and removing file"
rm $fileName
