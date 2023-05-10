# Script to trigger bot execution from bucket $1 config file $2 against hub docker service.

DOCKER_HOST="docker" # Replace with hostname of docker host where hub service is run.
DOCKER_PORT="8080" # Replace with port that is exposed to host by hub docker service.

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
DATA=$(generate_post_data)

curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "$(generate_post_data)" \
  "http://$DOCKER_HOST:$DOCKER_PORT"
