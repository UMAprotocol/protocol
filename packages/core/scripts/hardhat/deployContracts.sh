#!/usr/bin/env bash

# The type of oracle system to set up. Default is "dvm".
ORACLE_TYPE=$1
if [ ! "$ORACLE_TYPE" ]; 
then 
    echo "Must specify the type of oracle system to set up, like 'beacon-l1'"
    exit 1
fi
NETWORK_NAME=$2
if [ ! "$NETWORK_NAME" ]; 
then 
    echo "Must specify network name"
    exit 1
fi

if [ "$ORACLE_TYPE" == "sink-oracle" ]
then 
    yarn hardhat deploy --network $NETWORK_NAME --tags sink-oracle
elif [ "$ORACLE_TYPE" == "source-oracle-test" ]
then
    yarn hardhat deploy --network $NETWORK_NAME --tags sink-oracle,IdentifierWhitelist,MockOracle
elif [ "$ORACLE_TYPE" == "source-oracle" ]
then
    yarn hardhat deploy --network $NETWORK_NAME --tags sink-oracle,IdentifierWhitelist
else
    echo "unimplemented"
fi