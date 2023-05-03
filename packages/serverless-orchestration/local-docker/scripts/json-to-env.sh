# Script to stringify json file $1 and append to env file $2.
# This is used by update-bot-config.sh script.
# Requires jq being installed.

echo "Processing $1 ..."
BUCKET=$(basename $(dirname "$1"))
FILE=$(basename "$1")
CONFIG=$(cat "$1" | jq tostring | sed -e 's/\\//g' -e 's/^\"//' -e 's/\"$//')
echo $BUCKET-$FILE="$CONFIG" >> "$2"
