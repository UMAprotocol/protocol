#!/usr/bin/env bash

cd sponsor-dapp
output=$(CI=true npm run test)
echo "$output"
num_failures=$(echo $output | grep -ci "error")
if [ $num_failures -ne 0 ]
then
    # If we found failures, exit 1.
    exit 1
else
    # If not failures were found, exit 0.
    exit 0
fi
