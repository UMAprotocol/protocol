# Script to parse bot-configs and start or update docker services.

# Resolve provided root directory. Defaults to current directory if not provided.
if [ -z "$1" ]; then
    ROOT_DIR=$(pwd)
else
    [ ! -d "$1" ] && { echo "Error: $1 is not a directory"; exit 1; }
    ROOT_DIR=$(realpath "$1")
fi

# Verify required files exist.
[ ! -f "$ROOT_DIR/docker-compose.yml" ] && { echo "Error: docker-compose.yml file not found"; exit 1; }
[ ! -f "$ROOT_DIR/hub.env" ] && { echo "Error: hub.env file not found"; exit 1; }
[ ! -f "$ROOT_DIR/spoke.env" ] && { echo "Error: spoke.env file not found"; exit 1; }
[ ! -f "$ROOT_DIR/scripts/update-config.sh" ] && { echo "Error: scripts/update-config.sh file not found"; exit 1; }

# Convert JSON files under bot-configs to bot-config.env file and update scheduler.env.
sh "$ROOT_DIR/scripts/update-config.sh" "$ROOT_DIR"

# Make sure the conversion script did not error.
[ $? != 0 ] && exit 1

# Start or update hub and spoke services.
echo "Starting or updating hub and spoke services ..."
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d

exit $?
