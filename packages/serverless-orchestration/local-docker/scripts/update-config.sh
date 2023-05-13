# Script to convert JSON bot-configs to environment variables passed to the hub service.
# Also creates environment for the scheduler service.

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

# Update scheduler.env if bot-configs/schedule.json exists. Otherwise use empty environment.
CONFIG_DIR="$ROOT_DIR/bot-configs"
SCHEDULE_FILE="$CONFIG_DIR/schedule.json"
SCHEDULE_ENV_FILE="$ROOT_DIR/scheduler.env"
if [ -f "$SCHEDULE_FILE" ]; then
    # Verify all array objects in schedule.json have required fields.
    cat "$SCHEDULE_FILE" | jq -e '.[] | has("schedule") and has("bucket") and has("configFile")' > /dev/null
    [ $? -ne 0 ] && { echo "Error: $SCHEDULE_FILE does not contain required fields"; exit 1; }

    # Verify all bucket/configFile values in schedule.json exist as bot-configs files.
    cat "$SCHEDULE_FILE" | jq -r '.[] | [.bucket, .configFile] | @tsv' |
      while read -r bucket configFile
        do [ ! -f "$CONFIG_DIR/$bucket/$configFile" ] && { echo "Error: $CONFIG_DIR/$bucket/$configFile not found"; exit 1; }
      done

    echo "Processing $SCHEDULE_FILE ..."
    BOT_SCHEDULE=$(cat "$SCHEDULE_FILE" | jq tostring | sed -e 's/\\//g' -e 's/^\"//' -e 's/\"$//')
fi
echo "BOT_SCHEDULE=$BOT_SCHEDULE" > "$SCHEDULE_ENV_FILE"

# Convert JSON files under bot-configs to bot-config.env file.
CONVERT_SCRIPT="$ROOT_DIR/scripts/json-to-env.sh"
CONFIG_ENV_FILE="$ROOT_DIR/bot-config.env"
echo "Processing JSON files in $CONFIG_DIR and storing environment in $CONFIG_ENV_FILE ..."
rm -f "$CONFIG_ENV_FILE"
find "$CONFIG_DIR" -name "*.json" -exec sh "$CONVERT_SCRIPT" {} "$CONFIG_ENV_FILE" \;

exit 0
