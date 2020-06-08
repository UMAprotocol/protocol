#!/bin/bash
set -eEuo pipefail

echo "Starting Send Slack script"

# This Script executes the UMA reporter and pipes the output into a text file which is sent as an attachment to slack.
if [ -z "${BOT_IDENTIFIER}" ] || [ -z "${SLACK_TOKEN}" ] || [ -z "${SLACK_CHANNEL}" ]; then
    echo "BOT_IDENTIFIER, SLACK_TOKEN or SLACK_CHANNEL env variables are not set!"
    exit 1
fi

# Run the daily reporter script and built the output string.
echo "Generating daily report"
reportOutput=$(npx truffle exec ../reporters/index.js --network mainnet_mnemonic)
echo $reportOutput

# The output from the node process contains single quotes. These need to be stripped out
reportOutput="${reportOutput//\'/$' '}"

# Configure the name of the file. Sample output: 2020-06-04-daily-report.txt.
date=$(date +%F)
fileName=$date"-"$BOT_IDENTIFIER"-daily-report.txt"
echo "Saving daily report to file" $fileName
echo "${reportOutput}" >$fileName

# Spesify the parameters to send to the slack API. All caps values need to be set as enviroment variables.
# Note that this SLACK_TOKEN is an API token, not a webhook.
messageTitle="$date $BOT_IDENTIFIER Daily Report"
pathToFile="./"$fileName

# Send a curl command to upload the file along with a message to the channel. Store response log for debugging.
responseFileName="response.json"
echo "Sending file as slack message"
curl https://slack.com/api/files.upload -F token="${SLACK_TOKEN}" -F channels="${SLACK_CHANNEL}" -F title="${messageTitle}" -F fileName="${fileName}" -F file=@"${pathToFile}"

echo "Cleaning up and removing files"
rm $fileName

# Exit with success state
exit 0