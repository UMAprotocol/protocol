#!/usr/bin/env bash

run_test() {
    local test_dir=$1
    cd $test_dir
    output=$(CI=true npm run test)
    echo "$output"
    num_failures=$(echo $output | grep -ci "error")
    if [ $num_failures -ne 0 ]
    then
        # If we found failures, exit 1.
        exit 1
    fi
}

PROTOCOL_DIR=$(pwd)

run_test $PROTOCOL_DIR/voter-dapp
