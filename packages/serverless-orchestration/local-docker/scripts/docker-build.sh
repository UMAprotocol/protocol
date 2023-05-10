# Script to build local docker image.

# Resolve provided root directory. Defaults to current directory if not provided.
if [ -z "$1" ]; then
    ROOT_DIR=$(pwd)
else
    [ ! -d "$1" ] && { echo "Error: $1 is not a directory"; exit 1; }
    ROOT_DIR=$(realpath "$1")
fi

# Verify required compose file exists.
[ ! -f "$ROOT_DIR/compose.yml" ] && { echo "Error: compose.yml file not found"; exit 1; }

# Build docker image.
echo "Building local docker image ..."
docker compose -f "$ROOT_DIR/compose.yml" -p local-serverless build

exit 0
