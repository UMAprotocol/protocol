# Script to convert JSON bot-configs to environment variables passed to the hub service.

# Resolve provided root directory. Defaults to current directory if not provided.
if [ -z "$1" ]; then
    ROOT_DIR=$(pwd)
else
    [ ! -d "$1" ] && { echo "Error: $1 is not a directory"; exit 1; }
    ROOT_DIR=$(realpath "$1")
fi

# Verify required files and directories exist.
[ ! -d "$ROOT_DIR/bot-configs" ] && { echo "Error: bot-configs directory not found"; exit 1; }
[ ! -f "$ROOT_DIR/scripts/json-to-env.sh" ] && { echo "Error: scripts/json-to-env.sh file not found"; exit 1; }

# Convert JSON files under bot-configs to bot-config.env file.
CONVERT_SCRIPT="$ROOT_DIR/scripts/json-to-env.sh"
CONFIG_DIR="$ROOT_DIR/bot-configs"
ENV_FILE="$ROOT_DIR/bot-config.env"
echo "Processing JSON files in $CONFIG_DIR and storing environment in $ENV_FILE ..."
rm -f "$ENV_FILE"
find "$CONFIG_DIR" -name "*.json" -exec sh "$CONVERT_SCRIPT" {} "$ENV_FILE" \;

exit 0
