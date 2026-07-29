#!/bin/sh

# Script to trigger bot execution from bucket $1 config file $2 against hub service URL $3

generate_post_data()
{
  cat <<EOF
{
  "bucket": "$BUCKET",
  "configFile": "$FILE"
}
EOF
}

BUCKET="$1"
FILE="$2"
HUB_URL="$3"
DATA=$(generate_post_data)

curl -s -S -X POST \
  -H "Content-Type: application/json" \
  -d "$(generate_post_data)" \
  "$HUB_URL"
