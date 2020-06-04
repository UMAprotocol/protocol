#!/bin/bash
set -e

# This Script executes the UMA reporter and pipes the output into a text file which is sent as an attachment to slack.
if [ -z "${BOT_IDENTIFIER}" ] || [ -z "${SLACK_TOKEN}" ] || [ -z "${SLACK_CHANNEL}" ]; then
    echo "BOT_IDENTIFIER, SLACK_TOKEN or SLACK_CHANNEL env variables are not set!"
    exit 1
fi

# Run the daily reporter script and built the output string.
echo "Generating daily report"
reportOutput=$(npx truffle exec ../reporters/index.js --network mainnet_mnemonic)

# The output from the node process contains single quotes. These need to be stripped out
reportOutput="${reportOutput//\'/$' '}"

# Configure the name of the file. Sample output: 2020-06-04-daily-report.txt.
date=$(date +%F)
fileName=$date"-"$BOT_IDENTIFIER"-daily-report.txt"
echo "Saving daily report to file" $fileName
echo "${reportOutput}" >$fileName

# Spesify the parameters to send to the slack API. All caps values need to be set as enviroment variables.
# Note that this SLACK_TOKEN is an API token, not a webhook.
message_title=$date" Daily Report"
pathToFile="./"$fileName

# Send a curl command to upload the file along with a message to the channel.
# We'll store the response data in a file to verify that it was uploaded properly.
echo "Sending file as slack message"
responseFile="response.json"
curl https://slack.com/api/files.upload -F token="${SLACK_TOKEN}" -F channels="${SLACK_CHANNEL}" -F title="${message_title}" -F fileName="${fileName}" -F file=@"${pathToFile}" > $responseFile

# Verify that the 'ok' property of the response data is "true".
uploadSuccess=$(cat $responseFile | jq '.ok')
if [ "$uploadSuccess" = true ] ; then
    echo 'File upload succeeded!'
else
    echo 'File upload failed!'
    # Do something here
fi

echo "Cleaning up and removing files"
rm $fileName
rm $responseFile
