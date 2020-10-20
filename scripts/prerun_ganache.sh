#!/usr/bin/env bash
set -e

# USAGE ./prerun_ganache.sh 'your command here'

TEMP_FILE=$(mktemp)
echo "Starting Ganache. Logs being written to $TEMP_FILE"


trap "pkill -f '/ganache-cli'" EXIT
yarn ganache-cli -e 1000000000 -l 9000000 -d -p 9545 $> $TEMP_FILE & 
$1
