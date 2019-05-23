#!/usr/bin/env bash

# Note: this script should be run from inside the trailofbits/eth-security-toolbox docker container with this
# repository mounted at ~/protocol.
# An example run command would look like the following:
# docker run -v `pwd`:/home/ethsec/protocol -w /home/ethsec/protocol trailofbits/eth-security-toolbox ci/run_echidna_tests.sh

# Note: this assumes the .sol and .yaml files are 1:1 and have the same name.
run_echidna_test() {
    local prefix=core/contracts/echidna_tests/
    local solidity_fname=$prefix$1.sol
    local config_fname=$prefix$1.yaml
    local contract_name=$2
    local output=$(echidna-test $solidity_fname $contract_name --config=$config_fname)
    echo "$output"
    local num_failures=$(echo $output | grep -ci "failed")
    if [ $num_failures -ne 0 ]
    then
        # If we found failures, exit.
        exit 1
    fi
}


run_echidna_test LeveragedReturnCalculatorTest Leveraged1xTest
run_echidna_test LeveragedReturnCalculatorTest Leveraged4xTest
run_echidna_test LeveragedReturnCalculatorTest LeveragedShort1xTest
run_echidna_test LeveragedReturnCalculatorTest LeveragedShort3xTest
